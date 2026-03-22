"use server"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { requireTripAccess } from "@/lib/auth-trip"
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
  await requireTripAccess(tripId, "EDITOR")

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
  await requireTripAccess(tripId, "EDITOR")

  const updated = await prisma.activity.update({
    where: { id: activityId, tripId },
    data: {
      ...data,
      ...(data.fixedDateTime && { fixedDateTime: new Date(data.fixedDateTime) }),
    },
  })

  revalidatePath(`/trip/${tripId}/activities`)
  return updated
}

export async function deleteActivity(tripId: string, activityId: string) {
  await requireTripAccess(tripId, "EDITOR")
  await prisma.activity.delete({ where: { id: activityId, tripId } })
  revalidatePath(`/trip/${tripId}/activities`)
}

// Categories that should NOT appear in the Activities page
// (they belong to other sections: dining, flights, lodging, transport)
const EXCLUDED_ACTIVITY_CATEGORIES = [
  "restaurant",
  "flight",
  "flights",
  "hotel",
  "lodging",
  "rental_car",
  "car_rental",
]

export async function getActivities(tripId: string) {
  await requireTripAccess(tripId)

  return prisma.activity.findMany({
    where: {
      tripId,
      OR: [
        { category: null },
        {
          NOT: {
            category: { in: EXCLUDED_ACTIVITY_CATEGORIES },
          },
        },
      ],
    },
    orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
  })
}

// Places search cache — 15 min TTL, keyed by query+location
const placesSearchCache = new Map<string, { results: any[]; expiry: number }>()
const PLACES_CACHE_TTL = 15 * 60 * 1000 // 15 minutes
const MAX_CACHE_SIZE = 500

function cacheSet<K, V>(cache: Map<K, V>, key: K, value: V) {
  if (cache.size >= MAX_CACHE_SIZE) {
    const first = cache.keys().next().value
    if (first !== undefined) cache.delete(first)
  }
  cache.set(key, value)
}

// Google Places search — runs server-side to keep API key secret
// Uses the Places API (New) endpoint: places:searchText
export async function getAllActivitiesForTrip(tripId: string) {
  await requireTripAccess(tripId)

  return prisma.activity.findMany({
    where: { tripId },
    orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
  })
}

export async function cycleActivityInterest(tripId: string, data: {
  googlePlaceId: string
  name: string
  address?: string
  lat?: number
  lng?: number
  rating?: number
  imageUrl?: string
  category?: string
  durationMins?: number
  currentPriority?: string | null // current state, null if not saved
}) {
  await requireTripAccess(tripId, "EDITOR")

  // Find existing activity by googlePlaceId
  const existing = await prisma.activity.findFirst({
    where: { tripId, googlePlaceId: data.googlePlaceId },
  })

  if (!existing) {
    // Not saved -> create with WISHLIST/LOW (Looks Cool)
    const activity = await prisma.activity.create({
      data: {
        tripId,
        name: data.name,
        address: data.address,
        lat: data.lat,
        lng: data.lng,
        googlePlaceId: data.googlePlaceId,
        rating: data.rating,
        imageUrl: data.imageUrl,
        category: data.category,
        durationMins: data.durationMins || 120,
        costPerAdult: 0,
        costPerChild: 0,
        priority: "LOW",
        status: "WISHLIST",
        indoorOutdoor: "BOTH",
        reservationNeeded: false,
        isFixed: false,
      },
    })
    revalidatePath(`/trip/${tripId}/explore`)
    return { activity, newPriority: "LOW" as const, action: "created" as const }
  }

  // Cycle: LOW -> HIGH -> MUST_DO -> delete
  if (existing.priority === "LOW") {
    const activity = await prisma.activity.update({
      where: { id: existing.id },
      data: { priority: "HIGH" },
    })
    revalidatePath(`/trip/${tripId}/explore`)
    return { activity, newPriority: "HIGH" as const, action: "updated" as const }
  }

  if (existing.priority === "HIGH") {
    const activity = await prisma.activity.update({
      where: { id: existing.id },
      data: { priority: "MUST_DO" },
    })
    revalidatePath(`/trip/${tripId}/explore`)
    return { activity, newPriority: "MUST_DO" as const, action: "updated" as const }
  }

  if (existing.priority === "MUST_DO") {
    await prisma.activity.delete({ where: { id: existing.id } })
    revalidatePath(`/trip/${tripId}/explore`)
    return { activity: null, newPriority: null, action: "deleted" as const }
  }

  // MEDIUM priority -> treat as LOW for cycling
  const activity = await prisma.activity.update({
    where: { id: existing.id },
    data: { priority: "HIGH" },
  })
  revalidatePath(`/trip/${tripId}/explore`)
  return { activity, newPriority: "HIGH" as const, action: "updated" as const }
}

export async function addToItineraryFromExplore(tripId: string, activityId: string, date: string, startTime: string) {
  await requireTripAccess(tripId, "EDITOR")

  const activity = await prisma.activity.findFirstOrThrow({
    where: { id: activityId, tripId },
  })

  // Calculate end time
  const [h, m] = startTime.split(":").map(Number)
  const endMins = h * 60 + m + activity.durationMins
  const endTime = `${String(Math.floor(endMins / 60)).padStart(2, "0")}:${String(endMins % 60).padStart(2, "0")}`

  // Get next position for that day
  const lastItem = await prisma.itineraryItem.findFirst({
    where: { tripId, date: new Date(date) },
    orderBy: { position: "desc" },
    select: { position: true },
  })

  const item = await prisma.itineraryItem.create({
    data: {
      tripId,
      activityId: activity.id,
      date: new Date(date),
      startTime,
      endTime,
      type: activity.category === "restaurant" ? "MEAL" : "ACTIVITY",
      title: activity.name,
      durationMins: activity.durationMins,
      costEstimate: activity.costPerAdult,
      position: (lastItem?.position ?? -1) + 1,
    },
  })

  // Update activity status to SCHEDULED
  await prisma.activity.update({
    where: { id: activityId },
    data: { status: "SCHEDULED" },
  })

  revalidatePath(`/trip/${tripId}/explore`)
  revalidatePath(`/trip/${tripId}/itinerary`)
  return item
}

export async function removeFromShortlist(tripId: string, activityId: string) {
  await requireTripAccess(tripId, "EDITOR")
  await prisma.activity.delete({ where: { id: activityId, tripId } })
  revalidatePath(`/trip/${tripId}/explore`)
}

export async function updateActivityPriority(tripId: string, activityId: string, priority: "MUST_DO" | "HIGH" | "LOW") {
  await requireTripAccess(tripId, "EDITOR")
  const activity = await prisma.activity.update({
    where: { id: activityId, tripId },
    data: { priority },
  })
  revalidatePath(`/trip/${tripId}/explore`)
  return activity
}

export async function searchPlaces(query: string, locationBias?: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  const apiKey = process.env.GOOGLE_PLACES_KEY || process.env.NEXT_PUBLIC_GOOGLE_PLACES_KEY
  if (!apiKey || apiKey === "build-placeholder") {
    return { results: [], error: "Places API not configured" }
  }

  // Check cache
  const cacheKey = `${query}|${locationBias || ""}`
  const cached = placesSearchCache.get(cacheKey)
  if (cached && Date.now() < cached.expiry) {
    return { results: cached.results, error: null }
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = {
      textQuery: query,
      maxResultCount: 10,
    }

    // Add location bias if provided (lat,lng string)
    if (locationBias && locationBias.includes(",")) {
      const [lat, lng] = locationBias.split(",").map(Number)
      if (!isNaN(lat) && !isNaN(lng)) {
        body.locationBias = {
          circle: { center: { latitude: lat, longitude: lng }, radius: 50000 }
        }
      }
    }

    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.types,places.photos,places.priceLevel,places.currentOpeningHours,places.servesVegetarianFood,places.goodForChildren,places.servesBeer,places.servesWine,places.dineIn,places.delivery,places.takeout,places.primaryType",
      },
      body: JSON.stringify(body),
      // Prevent sending Referer header — server-side calls with HTTP referrer
      // restrictions on the API key will get 403 if a Referer is sent
      referrer: "",
      referrerPolicy: "no-referrer",
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => "")
      console.error("[searchPlaces] API error:", res.status, errText)
      return { results: [], error: "Places search failed" }
    }

    const data = await res.json()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results = (data.places || []).map((place: any) => ({
      googlePlaceId: place.id,
      name: place.displayName?.text || "",
      address: place.formattedAddress || "",
      lat: place.location?.latitude,
      lng: place.location?.longitude,
      rating: place.rating,
      ratingCount: place.userRatingCount,
      types: place.types || [],
      primaryType: place.primaryType,
      priceLevel: place.priceLevel,
      imageUrl: place.photos?.[0]?.name
        ? `/api/places/photo/${encodeURIComponent(place.photos[0].name)}`
        : null,
      // Dining-specific attributes
      goodForChildren: place.goodForChildren,
      dineIn: place.dineIn,
      delivery: place.delivery,
      takeout: place.takeout,
      servesVegetarianFood: place.servesVegetarianFood,
      servesBeer: place.servesBeer,
      servesWine: place.servesWine,
      openNow: place.currentOpeningHours?.openNow,
      weekdayHours: place.currentOpeningHours?.weekdayDescriptions,
    }))

    // Cache results
    cacheSet(placesSearchCache, cacheKey, { results, expiry: Date.now() + PLACES_CACHE_TTL })

    return { results, error: null }
  } catch (err) {
    console.error("[searchPlaces] Error:", err)
    return { results: [], error: "Failed to search places" }
  }
}
