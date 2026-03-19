"use server"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { revalidatePath } from "next/cache"
import { nanoid } from "nanoid"
import { z } from "zod"

const createTripSchema = z.object({
  title: z.string().min(1).max(100),
  destination: z.string().min(1).max(200),
  destinationLat: z.number().optional(),
  destinationLng: z.number().optional(),
  startDate: z.string(),
  endDate: z.string(),
  notes: z.string().optional(),
})

export async function createTrip(data: z.infer<typeof createTripSchema>) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  const parsed = createTripSchema.parse(data)

  const trip = await prisma.trip.create({
    data: {
      userId: session.user.id,
      title: parsed.title,
      destination: parsed.destination,
      destinationLat: parsed.destinationLat,
      destinationLng: parsed.destinationLng,
      startDate: new Date(parsed.startDate),
      endDate: new Date(parsed.endDate),
      notes: parsed.notes,
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
      travelers: { include: { traveler: true } },
      _count: { select: { activities: true, itineraryItems: true } },
    },
    orderBy: { startDate: "asc" },
  })
}

export async function getTrip(tripId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId: session.user.id },
    include: {
      travelers: { include: { traveler: true } },
      hotels: { orderBy: { checkIn: "asc" } },
      flights: { orderBy: { departureTime: "asc" } },
      _count: { select: { activities: true, budgetItems: true } },
    },
  })

  if (!trip) throw new Error("Trip not found")
  return trip
}

export async function updateTrip(tripId: string, data: Partial<z.infer<typeof createTripSchema>>) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  const trip = await prisma.trip.findFirst({ where: { id: tripId, userId: session.user.id } })
  if (!trip) throw new Error("Trip not found")

  const updated = await prisma.trip.update({
    where: { id: tripId },
    data: {
      ...(data.title && { title: data.title }),
      ...(data.destination && { destination: data.destination }),
      ...(data.startDate && { startDate: new Date(data.startDate) }),
      ...(data.endDate && { endDate: new Date(data.endDate) }),
      ...(data.notes !== undefined && { notes: data.notes }),
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
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  await prisma.trip.findFirstOrThrow({ where: { id: tripId, userId: session.user.id } })

  const slug = nanoid(21)
  const updated = await prisma.trip.update({
    where: { id: tripId },
    data: { shareSlug: slug, isPublic: true },
  })

  revalidatePath(`/trip/${tripId}`)
  return updated
}

export async function unshareTrip(tripId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  await prisma.trip.findFirstOrThrow({ where: { id: tripId, userId: session.user.id } })

  const updated = await prisma.trip.update({
    where: { id: tripId },
    data: { isPublic: false },
  })

  revalidatePath(`/trip/${tripId}`)
  return updated
}

export async function getTripBySlug(slug: string) {
  return prisma.trip.findFirst({
    where: { shareSlug: slug, isPublic: true },
    include: {
      travelers: { include: { traveler: true } },
      hotels: { orderBy: { checkIn: "asc" } },
      flights: { orderBy: { departureTime: "asc" } },
      itineraryItems: { orderBy: [{ date: "asc" }, { position: "asc" }] },
      activities: { where: { status: "SCHEDULED" } },
    },
  })
}
