"use server"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { revalidatePath } from "next/cache"
import { z } from "zod"

const activitySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  address: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  googlePlaceId: z.string().optional(),
  category: z.string().optional(),
  durationMins: z.number().int().min(15).default(120),
  costPerAdult: z.number().min(0).default(0),
  costPerChild: z.number().min(0).default(0),
  priority: z.enum(["MUST_DO", "HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
  isFixed: z.boolean().default(false),
  fixedDateTime: z.string().optional(),
  indoorOutdoor: z.enum(["INDOOR", "OUTDOOR", "BOTH"]).default("BOTH"),
  reservationNeeded: z.boolean().default(false),
  bookingLink: z.string().optional(),
  websiteUrl: z.string().optional(),
  imageUrl: z.string().optional(),
  rating: z.number().optional(),
  hoursJson: z.string().optional(),
  bestTimeOfDay: z.string().optional(),
  notes: z.string().optional(),
})

export async function createActivity(tripId: string, data: z.infer<typeof activitySchema>) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  await prisma.trip.findFirstOrThrow({ where: { id: tripId, userId: session.user.id } })

  const parsed = activitySchema.parse(data)
  const activity = await prisma.activity.create({
    data: {
      tripId,
      ...parsed,
      ...(parsed.fixedDateTime && { fixedDateTime: new Date(parsed.fixedDateTime) }),
    },
  })

  revalidatePath(`/trip/${tripId}/activities`)
  return activity
}

export async function updateActivity(tripId: string, activityId: string, data: Partial<z.infer<typeof activitySchema>>) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  await prisma.trip.findFirstOrThrow({ where: { id: tripId, userId: session.user.id } })

  const updated = await prisma.activity.update({
    where: { id: activityId },
    data: {
      ...data,
      ...(data.fixedDateTime && { fixedDateTime: new Date(data.fixedDateTime) }),
    },
  })

  revalidatePath(`/trip/${tripId}/activities`)
  return updated
}

export async function deleteActivity(tripId: string, activityId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  await prisma.trip.findFirstOrThrow({ where: { id: tripId, userId: session.user.id } })
  await prisma.activity.delete({ where: { id: activityId } })
  revalidatePath(`/trip/${tripId}/activities`)
}

export async function getActivities(tripId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  await prisma.trip.findFirstOrThrow({ where: { id: tripId, userId: session.user.id } })

  return prisma.activity.findMany({
    where: { tripId },
    orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
  })
}

// Google Places search — runs server-side to keep API key secret
export async function searchPlaces(query: string, locationBias?: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PLACES_KEY
  if (!apiKey || apiKey === "build-placeholder") {
    return { results: [], error: "Places API not configured" }
  }

  try {
    const params = new URLSearchParams({
      query,
      key: apiKey,
      ...(locationBias && { location: locationBias }),
    })

    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/textsearch/json?${params}`,
      { next: { revalidate: 60 } }
    )

    if (!res.ok) {
      return { results: [], error: "Places API request failed" }
    }

    const data = await res.json()

    if (data.status === "REQUEST_DENIED") {
      return { results: [], error: "Places API key invalid or restricted" }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results = (data.results || []).slice(0, 10).map((place: any) => ({
      googlePlaceId: place.place_id,
      name: place.name,
      address: place.formatted_address,
      lat: place.geometry?.location?.lat,
      lng: place.geometry?.location?.lng,
      rating: place.rating,
      imageUrl: place.photos?.[0]?.photo_reference
        ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${place.photos[0].photo_reference}&key=${apiKey}`
        : null,
      types: place.types || [],
    }))

    return { results, error: null }
  } catch {
    return { results: [], error: "Failed to search places" }
  }
}
