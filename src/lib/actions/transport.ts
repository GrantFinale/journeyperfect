"use server"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { requireTripAccess } from "@/lib/auth-trip"
import { revalidatePath } from "next/cache"
import { parseTransportTextWithAI } from "@/lib/transport-parser-ai"
import { z } from "zod"
import { hasFeature } from "@/lib/features"
import { formatDateInTimezone } from "@/lib/utils"

export type TransportModeValue = "FERRY" | "TRAIN" | "BUS"

export interface TransportInput {
  mode: TransportModeValue
  operator: string
  serviceNumber?: string | null
  departureLocation: string
  departureTerminal?: string | null
  departureAddress?: string | null
  departureLat?: number | null
  departureLng?: number | null
  departureTime: string
  departureTimezone?: string
  arrivalLocation?: string | null
  arrivalTerminal?: string | null
  arrivalAddress?: string | null
  arrivalLat?: number | null
  arrivalLng?: number | null
  arrivalTime?: string | null
  arrivalTimezone?: string
  confirmationNumber?: string | null
  bookingLink?: string | null
  seatInfo?: string | null
  vehicleOnBoard?: boolean
  passengerCount?: number | null
  price?: number | null
  priceCurrency?: string | null
  checkInMinsBefore?: number | null
  notes?: string | null
}

export interface ParsedTransport extends Omit<TransportInput, "departureTime"> {
  departureTime: string | null
  confidence: number
}

const transportSchema = z.object({
  mode: z.enum(["FERRY", "TRAIN", "BUS"]),
  operator: z.string().min(1),
  serviceNumber: z.string().nullish(),
  departureLocation: z.string().min(1),
  departureTerminal: z.string().nullish(),
  departureAddress: z.string().nullish(),
  departureLat: z.number().nullish(),
  departureLng: z.number().nullish(),
  departureTime: z.string(),
  departureTimezone: z.string().default("UTC"),
  arrivalLocation: z.string().nullish(),
  arrivalTerminal: z.string().nullish(),
  arrivalAddress: z.string().nullish(),
  arrivalLat: z.number().nullish(),
  arrivalLng: z.number().nullish(),
  arrivalTime: z.string().nullish(),
  arrivalTimezone: z.string().default("UTC"),
  confirmationNumber: z.string().nullish(),
  bookingLink: z.string().nullish(),
  seatInfo: z.string().nullish(),
  vehicleOnBoard: z.boolean().default(false),
  passengerCount: z.number().nullish(),
  price: z.number().nullish(),
  priceCurrency: z.string().nullish(),
  checkInMinsBefore: z.number().nullish(),
  notes: z.string().nullish(),
})

type TransportParsed = z.infer<typeof transportSchema>

const MODE_LABEL: Record<TransportModeValue, string> = {
  FERRY: "Ferry",
  TRAIN: "Train",
  BUS: "Bus",
}

/** "Lake Express · Muskegon, MI → Milwaukee, WI" */
function segmentTitle(p: TransportParsed): string {
  const service = [p.operator, p.serviceNumber].filter(Boolean).join(" ").trim()
  const route = [p.departureLocation, p.arrivalLocation].filter(Boolean).join(" → ")
  const head = service || MODE_LABEL[p.mode]
  return route ? `${head} · ${route}` : head
}

/**
 * Build the DB payload + the itinerary item that shadows it.
 * Bucketed by the DEPARTURE timezone so the leg lands on the right day
 * even when the crossing changes time zone (Muskegon ET → Milwaukee CT).
 */
function buildSegmentData(tripId: string, p: TransportParsed) {
  const depTime = new Date(p.departureTime)
  const arrTime = p.arrivalTime ? new Date(p.arrivalTime) : null

  const depTz = p.departureTimezone || "UTC"
  const localDate = formatDateInTimezone(depTime, "yyyy-MM-dd", depTz)
  const localTime = formatDateInTimezone(depTime, "HH:mm", depTz)
  const arrTz = p.arrivalTimezone || depTz
  const localEndTime = arrTime ? formatDateInTimezone(arrTime, "HH:mm", arrTz) : null

  const durationMins = arrTime
    ? Math.max(Math.ceil((arrTime.getTime() - depTime.getTime()) / 60000), 1)
    : 60

  return {
    depTime,
    arrTime,
    durationMins,
    segment: {
      tripId,
      mode: p.mode,
      operator: p.operator,
      serviceNumber: p.serviceNumber ?? null,
      departureLocation: p.departureLocation,
      departureTerminal: p.departureTerminal ?? null,
      departureAddress: p.departureAddress ?? null,
      departureLat: p.departureLat ?? null,
      departureLng: p.departureLng ?? null,
      departureTime: depTime,
      departureTimezone: depTz,
      arrivalLocation: p.arrivalLocation ?? null,
      arrivalTerminal: p.arrivalTerminal ?? null,
      arrivalAddress: p.arrivalAddress ?? null,
      arrivalLat: p.arrivalLat ?? null,
      arrivalLng: p.arrivalLng ?? null,
      arrivalTime: arrTime,
      arrivalTimezone: arrTz,
      confirmationNumber: p.confirmationNumber ?? null,
      bookingLink: p.bookingLink ?? null,
      seatInfo: p.seatInfo ?? null,
      vehicleOnBoard: p.vehicleOnBoard ?? false,
      passengerCount: p.passengerCount ?? null,
      price: p.price ?? null,
      priceCurrency: p.priceCurrency ?? "USD",
      checkInMinsBefore: p.checkInMinsBefore ?? null,
      notes: p.notes ?? null,
    },
    itineraryItem: {
      tripId,
      date: new Date(localDate + "T00:00:00Z"),
      startTime: localTime,
      endTime: localEndTime,
      type: "TRANSPORT" as const,
      title: segmentTitle(p),
      durationMins,
      position: 0,
      isConfirmed: true,
      costEstimate: p.price ?? 0,
    },
  }
}

async function extendTripEndDate(tripId: string, latest: Date | null) {
  if (!latest) return
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, select: { endDate: true } })
  if (trip && latest > trip.endDate) {
    await prisma.trip.update({ where: { id: tripId }, data: { endDate: latest } })
  }
}

export async function parseAndPreviewTransport(
  text: string
): Promise<{ segments: ParsedTransport[]; confidence: number }> {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { plan: true },
  })

  // AI parsing is a paid feature
  if (!user || !hasFeature(user.plan, "aiTransportParsing")) {
    throw new Error("UPGRADE_REQUIRED:AI booking parsing requires a paid plan. Please enter the ferry, train or bus details manually or upgrade your plan.")
  }

  try {
    const aiResult = await parseTransportTextWithAI(text, session.user.id)
    if (aiResult && aiResult.segments.length > 0) {
      return { segments: aiResult.segments as ParsedTransport[], confidence: aiResult.confidence }
    }
  } catch (err) {
    console.error("[parseAndPreviewTransport] AI parser threw:", err)
  }

  // AI failed — tell user to enter manually
  throw new Error("PARSE_FAILED:Could not parse the booking details. Please enter them manually.")
}

export async function createTransportSegment(tripId: string, data: TransportInput) {
  await requireTripAccess(tripId, "EDITOR")

  const parsed = transportSchema.parse(data)
  const built = buildSegmentData(tripId, parsed)

  const segment = await prisma.transportSegment.create({ data: built.segment })

  // Auto-create itinerary item
  await prisma.itineraryItem.create({
    data: { ...built.itineraryItem, transportSegmentId: segment.id },
  })

  // Auto-create BudgetItem for the fare
  if (parsed.price) {
    await prisma.budgetItem.create({
      data: {
        tripId,
        category: "TRANSPORT",
        title: segmentTitle(parsed),
        amount: parsed.price,
        currency: parsed.priceCurrency || "USD",
        isEstimate: false,
      },
    })
  }

  // Auto-update trip end date if this leg runs past the current end
  await extendTripEndDate(tripId, built.arrTime ?? built.depTime)

  revalidatePath(`/trip/${tripId}`)
  revalidatePath(`/trip/${tripId}/itinerary`)
  return segment
}

export async function createTransportSegmentsBatch(tripId: string, segments: TransportInput[]) {
  await requireTripAccess(tripId, "EDITOR")

  const created = await prisma.$transaction(
    segments.map((s) => {
      const parsed = transportSchema.parse(s)
      const built = buildSegmentData(tripId, parsed)
      return prisma.transportSegment.create({
        data: {
          ...built.segment,
          itineraryItems: { create: built.itineraryItem },
        },
      })
    })
  )

  // Create BudgetItems for priced legs and find the latest arrival
  let latest: Date | null = null
  for (const s of segments) {
    const parsed = transportSchema.parse(s)
    const end = parsed.arrivalTime ? new Date(parsed.arrivalTime) : new Date(parsed.departureTime)
    if (!latest || end > latest) latest = end
    if (parsed.price) {
      await prisma.budgetItem.create({
        data: {
          tripId,
          category: "TRANSPORT",
          title: segmentTitle(parsed),
          amount: parsed.price,
          currency: parsed.priceCurrency || "USD",
          isEstimate: false,
        },
      })
    }
  }

  await extendTripEndDate(tripId, latest)

  revalidatePath(`/trip/${tripId}`)
  revalidatePath(`/trip/${tripId}/itinerary`)
  return created
}

export async function updateTransportSegment(
  tripId: string,
  segmentId: string,
  data: Partial<TransportInput>
) {
  await requireTripAccess(tripId, "EDITOR")

  const updated = await prisma.transportSegment.update({
    where: { id: segmentId, tripId },
    data: {
      ...data,
      ...(data.departureTime && { departureTime: new Date(data.departureTime) }),
      ...(data.arrivalTime !== undefined && {
        arrivalTime: data.arrivalTime ? new Date(data.arrivalTime) : null,
      }),
    },
  })

  // Keep the shadow itinerary item in step with the booking
  const depTz = updated.departureTimezone || "UTC"
  const localDate = formatDateInTimezone(updated.departureTime, "yyyy-MM-dd", depTz)
  const localTime = formatDateInTimezone(updated.departureTime, "HH:mm", depTz)
  const localEndTime = updated.arrivalTime
    ? formatDateInTimezone(updated.arrivalTime, "HH:mm", updated.arrivalTimezone || depTz)
    : null
  const service = [updated.operator, updated.serviceNumber].filter(Boolean).join(" ").trim()
  const route = [updated.departureLocation, updated.arrivalLocation].filter(Boolean).join(" → ")

  await prisma.itineraryItem.updateMany({
    where: { transportSegmentId: segmentId, tripId },
    data: {
      date: new Date(localDate + "T00:00:00Z"),
      startTime: localTime,
      endTime: localEndTime,
      title: route ? `${service || MODE_LABEL[updated.mode]} · ${route}` : service || MODE_LABEL[updated.mode],
    },
  })

  await extendTripEndDate(tripId, updated.arrivalTime ?? updated.departureTime)

  revalidatePath(`/trip/${tripId}`)
  revalidatePath(`/trip/${tripId}/itinerary`)
  return updated
}

export async function deleteTransportSegment(tripId: string, segmentId: string) {
  await requireTripAccess(tripId, "EDITOR")

  // FK is SetNull, so remove the shadow itinerary items explicitly first
  await prisma.itineraryItem.deleteMany({ where: { transportSegmentId: segmentId, tripId } })
  await prisma.transportSegment.delete({ where: { id: segmentId, tripId } })

  revalidatePath(`/trip/${tripId}`)
  revalidatePath(`/trip/${tripId}/itinerary`)
}
