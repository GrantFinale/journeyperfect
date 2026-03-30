"use server"

import { requireTripAccess } from "@/lib/auth-trip"
import { prisma } from "@/lib/db"
import { revalidatePath } from "next/cache"
import { z } from "zod"

const customEventSchema = z.object({
  title: z.string().min(1),
  date: z.string(), // YYYY-MM-DD
  startTime: z.string().optional(), // HH:MM
  durationMins: z.number().int().min(15).default(60),
  address: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  notes: z.string().optional(),
  // For place/business mode
  googlePlaceId: z.string().optional(),
  imageUrl: z.string().optional(),
  category: z.string().optional(),
  rating: z.number().optional(),
  // Reservation info (optional)
  confirmationNumber: z.string().optional(),
  bookingUrl: z.string().optional(),
  provider: z.string().optional(),
})

export type CustomEventInput = z.infer<typeof customEventSchema>

export async function createCustomEvent(tripId: string, data: CustomEventInput) {
  await requireTripAccess(tripId, "EDITOR")
  const parsed = customEventSchema.parse(data)

  // Create Activity record
  const activity = await prisma.activity.create({
    data: {
      tripId,
      name: parsed.title,
      address: parsed.address,
      lat: parsed.lat,
      lng: parsed.lng,
      googlePlaceId: parsed.googlePlaceId,
      imageUrl: parsed.imageUrl,
      category: parsed.category,
      rating: parsed.rating,
      durationMins: parsed.durationMins,
      status: "SCHEDULED",
      priority: "HIGH",
      indoorOutdoor: "BOTH",
      costPerAdult: 0,
      costPerChild: 0,
      bookingLink: parsed.bookingUrl,
    },
  })

  // Compute endTime from startTime + duration
  const endMins = parsed.startTime
    ? parseInt(parsed.startTime.split(":")[0]) * 60 +
      parseInt(parsed.startTime.split(":")[1]) +
      parsed.durationMins
    : undefined
  const endTime = endMins
    ? `${String(Math.floor(endMins / 60)).padStart(2, "0")}:${String(endMins % 60).padStart(2, "0")}`
    : undefined

  const item = await prisma.itineraryItem.create({
    data: {
      tripId,
      activityId: activity.id,
      date: new Date(parsed.date + "T12:00:00Z"),
      startTime: parsed.startTime || null,
      endTime: endTime || null,
      type: "ACTIVITY",
      title: parsed.title,
      durationMins: parsed.durationMins,
      notes: parsed.notes,
      costEstimate: 0,
      position: 99,
    },
  })

  // Create reservation if confirmation info provided
  if (parsed.confirmationNumber || parsed.bookingUrl || parsed.provider) {
    await prisma.reservation.create({
      data: {
        itineraryItemId: item.id,
        confirmationNumber: parsed.confirmationNumber,
        bookingUrl: parsed.bookingUrl,
        provider: parsed.provider,
        status: "CONFIRMED",
      },
    })
  }

  revalidatePath(`/trip/${tripId}/itinerary`)
  return { activity, item }
}

// Search Google Places by exact name for place/business lookup
export async function searchPlaceByName(query: string, locationBias?: string) {
  const apiKey =
    process.env.GOOGLE_PLACES_KEY || process.env.NEXT_PUBLIC_GOOGLE_PLACES_KEY
  if (!apiKey || apiKey === "build-placeholder") {
    return null
  }

  try {
    const body: Record<string, unknown> = {
      textQuery: query,
      maxResultCount: 5,
    }

    if (locationBias) {
      const parts = locationBias.split(",").map((s) => parseFloat(s.trim()))
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        body.locationBias = {
          circle: {
            center: { latitude: parts[0], longitude: parts[1] },
            radius: 50000,
          },
        }
      }
    }

    const res = await fetch(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask":
            "places.displayName,places.formattedAddress,places.location,places.rating,places.photos,places.types,places.websiteUri,places.internationalPhoneNumber,places.regularOpeningHours,places.userRatingCount,places.googleMapsUri,places.id",
        },
        body: JSON.stringify(body),
        cache: "no-store",
      }
    )

    if (!res.ok) return null

    const data = await res.json()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data.places || []).map((place: any) => ({
      googlePlaceId: place.id,
      name: place.displayName?.text || "",
      address: place.formattedAddress || "",
      lat: place.location?.latitude,
      lng: place.location?.longitude,
      rating: place.rating,
      ratingCount: place.userRatingCount,
      phone: place.internationalPhoneNumber,
      website: place.websiteUri,
      mapsUrl: place.googleMapsUri,
      imageUrl: place.photos?.[0]?.name
        ? `https://places.googleapis.com/v1/${place.photos[0].name}/media?maxWidthPx=400&key=${apiKey}`
        : null,
      types: place.types || [],
      hours: place.regularOpeningHours?.weekdayDescriptions,
    }))
  } catch {
    return null
  }
}
