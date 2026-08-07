"use server"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { requireTripAccess } from "@/lib/auth-trip"
import { getPlanLimits, type Plan } from "@/lib/plans"
import { revalidatePath } from "next/cache"
import { nanoid } from "nanoid"
import { z } from "zod"

const createTripSchema = z.object({
  title: z.string().min(1).max(100),
  destinations: z.array(z.object({ name: z.string().min(1), lat: z.number().optional(), lng: z.number().optional() })).min(1),
  destination: z.string().optional(), // backward compat
  destinationLat: z.number().optional(),
  destinationLng: z.number().optional(),
  startDate: z.string(),
  endDate: z.string(),
  notes: z.string().optional(),
  originLabel: z.string().nullable().optional(),
  originAddress: z.string().nullable().optional(),
  originLat: z.number().nullable().optional(),
  originLng: z.number().nullable().optional(),
})

export async function createTrip(data: z.infer<typeof createTripSchema>) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  const parsed = createTripSchema.parse(data)

  // Plan limit check
  const tripCount = await prisma.trip.count({ where: { userId: session.user.id } })
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { plan: true, homeAddress: true, homeCity: true, homeLat: true, homeLng: true },
  })
  const limits = getPlanLimits((user?.plan as Plan) ?? "FREE")
  if (tripCount >= limits.maxTrips) {
    throw new Error(`PLAN_LIMIT: You've reached your ${limits.maxTrips} trip limit. Upgrade to add more.`)
  }

  const destinationSummary = parsed.destinations.map((d) => d.name).join(", ")

  // Prefill origin from the user's saved home address when the caller supplied none
  const hasOrigin =
    parsed.originLabel != null ||
    parsed.originAddress != null ||
    parsed.originLat != null ||
    parsed.originLng != null

  const origin = hasOrigin
    ? {
        originLabel: parsed.originLabel ?? null,
        originAddress: parsed.originAddress ?? null,
        originLat: parsed.originLat ?? null,
        originLng: parsed.originLng ?? null,
      }
    : {
        originLabel: user?.homeAddress || user?.homeCity ? "Home" : null,
        // Trip has no originCity column — fall back to homeCity when no street address is saved
        originAddress: user?.homeAddress ?? user?.homeCity ?? null,
        originLat: user?.homeLat ?? null,
        originLng: user?.homeLng ?? null,
      }

  const trip = await prisma.trip.create({
    data: {
      userId: session.user.id,
      title: parsed.title,
      destination: destinationSummary,
      destinationLat: parsed.destinationLat,
      destinationLng: parsed.destinationLng,
      startDate: new Date(parsed.startDate),
      endDate: new Date(parsed.endDate),
      notes: parsed.notes,
      ...origin,
      destinations: {
        create: parsed.destinations.map((d, i) => ({
          name: d.name,
          lat: d.lat,
          lng: d.lng,
          position: i,
        })),
      },
    },
  })

  revalidatePath("/dashboard")
  return trip
}

export async function getTrips() {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  return prisma.trip.findMany({
    where: { userId: session.user.id },
    include: {
      destinations: { orderBy: { position: "asc" } },
      travelers: { include: { traveler: true } },
      _count: { select: { activities: true, itineraryItems: true } },
    },
    orderBy: { startDate: "asc" },
    take: 100,
  })
}

export async function getTrip(tripId: string) {
  // Verify access (owner or collaborator)
  await requireTripAccess(tripId)

  const trip = await prisma.trip.findFirst({
    where: { id: tripId },
    include: {
      destinations: { orderBy: { position: "asc" } },
      travelers: { include: { traveler: true } },
      hotels: { orderBy: { checkIn: "asc" } },
      rentalCars: { orderBy: { pickupTime: "asc" } },
      flights: { orderBy: { departureTime: "asc" } },
      transportSegments: { orderBy: { departureTime: "asc" } },
      vehicle: true,
      _count: { select: { activities: true, budgetItems: true, itineraryItems: true } },
    },
  })

  if (!trip) throw new Error("Trip not found")
  return trip
}

export async function updateTrip(tripId: string, data: Partial<z.infer<typeof createTripSchema>>) {
  await requireTripAccess(tripId, "EDITOR")

  const updated = await prisma.trip.update({
    where: { id: tripId },
    data: {
      ...(data.title && { title: data.title }),
      ...(data.destination && { destination: data.destination }),
      ...(data.startDate && { startDate: new Date(data.startDate) }),
      ...(data.endDate && { endDate: new Date(data.endDate) }),
      ...(data.notes !== undefined && { notes: data.notes }),
      ...(data.originLabel !== undefined && { originLabel: data.originLabel }),
      ...(data.originAddress !== undefined && { originAddress: data.originAddress }),
      ...(data.originLat !== undefined && { originLat: data.originLat }),
      ...(data.originLng !== undefined && { originLng: data.originLng }),
    },
  })

  revalidatePath(`/trip/${tripId}`)
  return updated
}

export async function deleteTrip(tripId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  await prisma.trip.findFirstOrThrow({ where: { id: tripId, userId: session.user.id } })
  await prisma.trip.delete({ where: { id: tripId } })
  revalidatePath("/dashboard")
}

export async function shareTrip(tripId: string) {
  await requireTripAccess(tripId, "EDITOR")

  const slug = nanoid(21)
  const updated = await prisma.trip.update({
    where: { id: tripId },
    data: { shareSlug: slug, isPublic: true },
  })

  revalidatePath(`/trip/${tripId}`)
  return { isPublic: updated.isPublic, shareSlug: updated.shareSlug }
}

export async function unshareTrip(tripId: string) {
  await requireTripAccess(tripId, "EDITOR")

  const updated = await prisma.trip.update({
    where: { id: tripId },
    data: { isPublic: false },
  })

  revalidatePath(`/trip/${tripId}`)
  return { isPublic: updated.isPublic, shareSlug: updated.shareSlug }
}

export async function getTripBySlug(slug: string) {
  return prisma.trip.findFirst({
    where: { shareSlug: slug, isPublic: true },
    include: {
      destinations: { orderBy: { position: "asc" } },
      travelers: { include: { traveler: true } },
      hotels: { orderBy: { checkIn: "asc" } },
      rentalCars: { orderBy: { pickupTime: "asc" } },
      flights: { orderBy: { departureTime: "asc" } },
      transportSegments: { orderBy: { departureTime: "asc" } },
      itineraryItems: { orderBy: [{ date: "asc" }, { position: "asc" }] },
      activities: { where: { status: "SCHEDULED" } },
    },
  })
}

// ─── Multi-destination actions ──────────────────────────────────────────────

async function updateDestinationSummary(tripId: string) {
  const destinations = await prisma.tripDestination.findMany({
    where: { tripId },
    orderBy: { position: "asc" },
  })
  const summary = destinations.map((d) => d.name).join(", ")
  await prisma.trip.update({
    where: { id: tripId },
    data: { destination: summary },
  })
}

export async function addDestination(tripId: string, name: string, lat?: number, lng?: number) {
  await requireTripAccess(tripId, "EDITOR")

  // Get the next position
  const maxPos = await prisma.tripDestination.findFirst({
    where: { tripId },
    orderBy: { position: "desc" },
    select: { position: true },
  })

  const destination = await prisma.tripDestination.create({
    data: {
      tripId,
      name,
      lat,
      lng,
      position: (maxPos?.position ?? -1) + 1,
    },
  })

  await updateDestinationSummary(tripId)
  revalidatePath(`/trip/${tripId}`)
  return destination
}

export async function removeDestination(tripId: string, destinationId: string) {
  await requireTripAccess(tripId, "EDITOR")

  await prisma.tripDestination.delete({
    where: { id: destinationId },
  })

  await updateDestinationSummary(tripId)
  revalidatePath(`/trip/${tripId}`)
}

export async function reorderDestinations(
  tripId: string,
  updates: { id: string; position: number }[]
) {
  await requireTripAccess(tripId, "EDITOR")

  await prisma.$transaction(
    updates.map((u) =>
      prisma.tripDestination.update({
        where: { id: u.id },
        data: { position: u.position },
      })
    )
  )

  await updateDestinationSummary(tripId)
  revalidatePath(`/trip/${tripId}`)
}
