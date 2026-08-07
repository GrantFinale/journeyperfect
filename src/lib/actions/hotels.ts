"use server"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { requireTripAccess } from "@/lib/auth-trip"
import { revalidatePath } from "next/cache"
import { parseHotelTextWithAI } from "@/lib/hotel-parser-ai"
import { z } from "zod"
import { hasFeature } from "@/lib/features"

const hotelSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  checkIn: z.string(),
  checkOut: z.string(),
  confirmationNumber: z.string().optional(),
  bookingLink: z.string().optional(),
  notes: z.string().optional(),
  isVacationRental: z.boolean().default(false),
  price: z.number().optional(),
  priceCurrency: z.string().optional(),
  roomCount: z.number().default(1),
  roomType: z.string().optional(),
  city: z.string().optional(),
  googlePlaceId: z.string().optional(),
  photoRef: z.string().optional(),
})

type HotelPlaceLookup = {
  googlePlaceId?: string
  photoRef?: string
  city?: string
  lat?: number
  lng?: number
}

/**
 * Best-effort Google Places (v1) lookup for a hotel.
 *
 * Internal helper — NOT exported, because this file is `"use server"` and every
 * export must be an async server action. Never throws: returns `null` on any
 * failure so callers can treat enrichment as purely optional.
 */
async function lookupHotelPlace(name: string, address?: string | null): Promise<HotelPlaceLookup | null> {
  try {
    const apiKey = process.env.GOOGLE_PLACES_KEY || process.env.NEXT_PUBLIC_GOOGLE_PLACES_KEY
    if (!apiKey || apiKey === "build-placeholder") return null

    const textQuery = [name, address].filter(Boolean).join(" ").trim()
    if (!textQuery) return null

    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.location,places.photos,places.addressComponents",
      },
      body: JSON.stringify({ textQuery, maxResultCount: 1 }),
      // Prevent sending Referer header — the key has HTTP referrer restrictions
      // and server-side calls get a 403 if a Referer is sent.
      referrer: "",
      referrerPolicy: "no-referrer",
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => "")
      console.error("[lookupHotelPlace] API error:", res.status, errText)
      return null
    }

    const data = await res.json()
    const place = data?.places?.[0]
    if (!place) return null

    // Prefer the structured addressComponents path for city.
    let city: string | undefined
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const components: any[] = Array.isArray(place.addressComponents) ? place.addressComponents : []
    if (components.length > 0) {
      for (const wanted of ["locality", "postal_town", "administrative_area_level_2"]) {
        const match = components.find(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (c: any) => Array.isArray(c?.types) && c.types.includes(wanted)
        )
        const label = match?.longText || match?.shortText
        if (label) {
          city = label
          break
        }
      }
    }
    if (!city && typeof place.formattedAddress === "string") {
      // Fallback: "Street, City, Region PostCode, Country" → take the segment
      // two before the last (country is last, region/postcode second-to-last).
      const segments = place.formattedAddress.split(",").map((s: string) => s.trim()).filter(Boolean)
      const candidate = segments.length >= 3 ? segments[segments.length - 3] : undefined
      if (candidate) city = candidate
    }

    const lat = typeof place.location?.latitude === "number" ? place.location.latitude : undefined
    const lng = typeof place.location?.longitude === "number" ? place.location.longitude : undefined

    return {
      googlePlaceId: typeof place.id === "string" ? place.id : undefined,
      // RAW resource name (e.g. "places/XXX/photos/YYY") — the client encodes it.
      photoRef: typeof place.photos?.[0]?.name === "string" ? place.photos[0].name : undefined,
      city,
      lat,
      lng,
    }
  } catch (err) {
    console.error("[lookupHotelPlace] Error:", err)
    return null
  }
}

export async function getCheckInTimeForDate(tripId: string, checkInDate: Date): Promise<string> {
  // Look for flights arriving on the same day as hotel check-in
  const dayStart = new Date(checkInDate)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(checkInDate)
  dayEnd.setHours(23, 59, 59, 999)

  const arrivingFlights = await prisma.flight.findMany({
    where: {
      tripId,
      arrivalTime: { gte: dayStart, lte: dayEnd },
    },
    orderBy: { arrivalTime: "desc" },
    select: { arrivalTime: true },
  })

  if (arrivingFlights.length > 0) {
    // Set check-in to 1 hour after the latest flight arrival
    const latestArrival = arrivingFlights[0].arrivalTime
    const checkInTime = new Date(latestArrival.getTime() + 60 * 60 * 1000)
    return checkInTime.toTimeString().slice(0, 5)
  }

  // Default: 3:00 PM standard check-in time
  return "15:00"
}

export async function createHotel(tripId: string, data: z.infer<typeof hotelSchema>) {
  await requireTripAccess(tripId, "EDITOR")

  const parsed = hotelSchema.parse(data)
  const hotel = await prisma.hotel.create({
    data: {
      tripId,
      ...parsed,
      checkIn: new Date(parsed.checkIn),
      checkOut: new Date(parsed.checkOut),
    },
  })

  // Best-effort Google Places enrichment: photo, placeId, city (and coords if
  // the caller didn't supply any). A Places failure must NEVER fail creation.
  try {
    const place = await lookupHotelPlace(parsed.name, parsed.address)
    if (place) {
      const patch: {
        googlePlaceId?: string
        photoRef?: string
        city?: string
        lat?: number
        lng?: number
      } = {}
      if (place.googlePlaceId && !hotel.googlePlaceId) patch.googlePlaceId = place.googlePlaceId
      if (place.photoRef && !hotel.photoRef) patch.photoRef = place.photoRef
      if (place.city && !hotel.city) patch.city = place.city
      if (hotel.lat == null && hotel.lng == null && place.lat != null && place.lng != null) {
        patch.lat = place.lat
        patch.lng = place.lng
      }
      if (Object.keys(patch).length > 0) {
        await prisma.hotel.update({ where: { id: hotel.id }, data: patch })
        // Mutate in-memory so the returned record carries the new fields.
        Object.assign(hotel, patch)
      }
    }
  } catch {
    // Places enrichment is best-effort — don't fail hotel creation
  }

  // Legacy geocode fallback — only if Places didn't give us coordinates
  if (hotel.lat == null && hotel.lng == null && (parsed.address || parsed.name)) {
    try {
      const gKey = process.env.GOOGLE_PLACES_KEY || process.env.NEXT_PUBLIC_GOOGLE_PLACES_KEY || ""
      if (gKey && gKey !== "build-placeholder") {
        const query = encodeURIComponent(parsed.address || parsed.name)
        const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${query}&key=${gKey}`)
        const data = await res.json()
        if (data.results?.[0]?.geometry?.location) {
          const { lat, lng } = data.results[0].geometry.location
          await prisma.hotel.update({ where: { id: hotel.id }, data: { lat, lng } })
          hotel.lat = lat
          hotel.lng = lng
        }
      }
    } catch {
      // Geocoding is best-effort — don't fail hotel creation
    }
  }

  // Determine check-in time based on arriving flights
  const checkInDate = new Date(parsed.checkIn)
  const checkInTime = await getCheckInTimeForDate(tripId, checkInDate)

  // Auto-create check-in and check-out itinerary items
  await prisma.itineraryItem.createMany({
    data: [
      {
        tripId,
        hotelId: hotel.id,
        date: checkInDate,
        startTime: checkInTime,
        type: "HOTEL_CHECK_IN",
        title: `🏨 Check in: ${parsed.name}`,
        durationMins: 30,
        position: 0,
        isConfirmed: true,
      },
      {
        tripId,
        hotelId: hotel.id,
        date: new Date(parsed.checkOut),
        startTime: "11:00",
        type: "HOTEL_CHECK_OUT",
        title: `🏨 Check out: ${parsed.name}`,
        durationMins: 30,
        position: 0,
        isConfirmed: true,
      },
    ],
  })

  // Auto-create BudgetItem for hotel cost
  if (parsed.price) {
    const checkInDate = new Date(parsed.checkIn)
    const checkOutDate = new Date(parsed.checkOut)
    const nights = Math.ceil((checkOutDate.getTime() - checkInDate.getTime()) / 86400000)
    const roomCount = parsed.roomCount || 1
    const totalCost = parsed.price * nights * roomCount
    await prisma.budgetItem.create({
      data: {
        tripId,
        category: "LODGING",
        title: `${parsed.name} (${nights} night${nights > 1 ? "s" : ""}${roomCount > 1 ? `, ${roomCount} rooms` : ""})`,
        amount: totalCost,
        isEstimate: false,
      },
    })
  }

  revalidatePath(`/trip/${tripId}`)
  revalidatePath(`/trip/${tripId}/itinerary`)
  return hotel
}

export async function parseAndPreviewHotel(text: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { plan: true },
  })

  // AI parsing is a paid feature (reuse aiFlightParsing gate for now)
  if (!user || !hasFeature(user.plan, "aiFlightParsing")) {
    throw new Error("UPGRADE_REQUIRED:AI hotel parsing requires a paid plan. Please enter hotel details manually or upgrade your plan.")
  }

  try {
    const aiResult = await parseHotelTextWithAI(text, session.user.id)
    if (aiResult && aiResult.hotels.length > 0) {
      return aiResult
    }
  } catch (err) {
    console.error("[parseAndPreviewHotel] AI parser threw:", err)
  }

  throw new Error("PARSE_FAILED:Could not parse hotel details. Please enter them manually.")
}

export async function createHotelsBatch(tripId: string, hotels: z.infer<typeof hotelSchema>[]) {
  await requireTripAccess(tripId, "EDITOR")

  // Pre-compute check-in times for each hotel (needs async flight lookups)
  const parsedHotels = hotels.map((h) => hotelSchema.parse(h))
  const checkInTimes = await Promise.all(
    parsedHotels.map((parsed) => getCheckInTimeForDate(tripId, new Date(parsed.checkIn)))
  )

  const created = await prisma.$transaction(
    parsedHotels.map((parsed, i) => {
      const checkInDate = new Date(parsed.checkIn)
      const checkOutDate = new Date(parsed.checkOut)
      return prisma.hotel.create({
        data: {
          tripId,
          ...parsed,
          checkIn: checkInDate,
          checkOut: checkOutDate,
          itineraryItems: {
            createMany: {
              data: [
                {
                  tripId,
                  date: checkInDate,
                  startTime: checkInTimes[i],
                  type: "HOTEL_CHECK_IN" as const,
                  title: `Check in: ${parsed.name}`,
                  durationMins: 30,
                  position: 0,
                  isConfirmed: true,
                },
                {
                  tripId,
                  date: checkOutDate,
                  startTime: "11:00",
                  type: "HOTEL_CHECK_OUT" as const,
                  title: `Check out: ${parsed.name}`,
                  durationMins: 30,
                  position: 0,
                  isConfirmed: true,
                },
              ],
            },
          },
        },
      })
    })
  )

  // Best-effort Places enrichment for the batch — run in parallel, tolerate
  // individual failures, and never fail the batch create.
  try {
    await Promise.allSettled(
      created.map(async (hotel) => {
        const place = await lookupHotelPlace(hotel.name, hotel.address)
        if (!place) return
        const patch: {
          googlePlaceId?: string
          photoRef?: string
          city?: string
          lat?: number
          lng?: number
        } = {}
        if (place.googlePlaceId && !hotel.googlePlaceId) patch.googlePlaceId = place.googlePlaceId
        if (place.photoRef && !hotel.photoRef) patch.photoRef = place.photoRef
        if (place.city && !hotel.city) patch.city = place.city
        if (hotel.lat == null && hotel.lng == null && place.lat != null && place.lng != null) {
          patch.lat = place.lat
          patch.lng = place.lng
        }
        if (Object.keys(patch).length === 0) return
        await prisma.hotel.update({ where: { id: hotel.id }, data: patch })
        Object.assign(hotel, patch)
      })
    )
  } catch {
    // Places enrichment is best-effort — don't fail batch creation
  }

  // Create BudgetItems for hotels with prices
  for (let i = 0; i < hotels.length; i++) {
    const parsed = hotelSchema.parse(hotels[i])
    if (parsed.price) {
      const checkInDate = new Date(parsed.checkIn)
      const checkOutDate = new Date(parsed.checkOut)
      const nights = Math.ceil((checkOutDate.getTime() - checkInDate.getTime()) / 86400000)
      const roomCount = parsed.roomCount || 1
      const totalCost = parsed.price * nights * roomCount
      await prisma.budgetItem.create({
        data: {
          tripId,
          category: "LODGING",
          title: `${parsed.name} (${nights} night${nights > 1 ? "s" : ""}${roomCount > 1 ? `, ${roomCount} rooms` : ""})`,
          amount: totalCost,
          isEstimate: false,
        },
      })
    }
  }

  revalidatePath(`/trip/${tripId}`)
  revalidatePath(`/trip/${tripId}/itinerary`)
  return created
}

export async function updateHotel(tripId: string, hotelId: string, data: Partial<z.infer<typeof hotelSchema>>) {
  await requireTripAccess(tripId, "EDITOR")

  const before = await prisma.hotel.findFirst({ where: { id: hotelId, tripId } })

  let updated = await prisma.hotel.update({
    where: { id: hotelId, tripId },
    data: {
      ...data,
      ...(data.checkIn && { checkIn: new Date(data.checkIn) }),
      ...(data.checkOut && { checkOut: new Date(data.checkOut) }),
    },
  })

  const nameChanged = data.name !== undefined && data.name !== before?.name
  const addressChanged = data.address !== undefined && data.address !== before?.address

  // Re-run the Places lookup when the identity of the hotel changed.
  // Caller-supplied fields always win — we only fill/refresh what wasn't passed.
  if (nameChanged || addressChanged) {
    try {
      const place = await lookupHotelPlace(updated.name, updated.address)
      if (place) {
        const patch: {
          googlePlaceId?: string
          photoRef?: string
          city?: string
          lat?: number
          lng?: number
        } = {}
        if (place.googlePlaceId && data.googlePlaceId === undefined) patch.googlePlaceId = place.googlePlaceId
        if (place.photoRef && data.photoRef === undefined) patch.photoRef = place.photoRef
        if (place.city && data.city === undefined) patch.city = place.city
        // Only touch coords if the caller did NOT pass explicit ones.
        if (data.lat === undefined && data.lng === undefined && place.lat != null && place.lng != null) {
          patch.lat = place.lat
          patch.lng = place.lng
        }
        if (Object.keys(patch).length > 0) {
          updated = await prisma.hotel.update({ where: { id: hotelId, tripId }, data: patch })
        }
      }
    } catch {
      // Places refresh is best-effort — never fail the update
    }
  }

  // Keep the auto-created HOTEL_CHECK_IN / HOTEL_CHECK_OUT itinerary items in
  // sync. Without this, correcting a mistyped check-in date left the itinerary
  // pinned to the wrong day with no way to fix it.
  if (data.checkIn !== undefined || data.checkOut !== undefined || nameChanged) {
    try {
      const items = await prisma.itineraryItem.findMany({
        where: { tripId, hotelId, type: { in: ["HOTEL_CHECK_IN", "HOTEL_CHECK_OUT"] } },
      })
      for (const item of items) {
        const isCheckIn = item.type === "HOTEL_CHECK_IN"
        const patch: { date?: Date; title?: string } = {}

        if (isCheckIn && data.checkIn !== undefined) patch.date = new Date(data.checkIn)
        if (!isCheckIn && data.checkOut !== undefined) patch.date = new Date(data.checkOut)

        if (nameChanged) {
          // Preserve whichever title style the item was created with.
          const prefix = item.title.startsWith("🏨 ") ? "🏨 " : ""
          patch.title = `${prefix}${isCheckIn ? "Check in" : "Check out"}: ${updated.name}`
        }

        if (Object.keys(patch).length > 0) {
          await prisma.itineraryItem.update({ where: { id: item.id }, data: patch })
        }
      }
    } catch (err) {
      // Itinerary sync is best-effort — never fail the hotel update
      console.error("[updateHotel] itinerary sync failed:", err)
    }
  }

  revalidatePath(`/trip/${tripId}`)
  // Check-in/out dates may have moved, so the itinerary view must refresh too.
  revalidatePath(`/trip/${tripId}/itinerary`)
  return updated
}

/**
 * Backfill Places photo/city for hotels created before those columns existed.
 * Never throws — returns `null` on failure so the client renders a placeholder.
 */
export async function backfillHotelPhoto(
  tripId: string,
  hotelId: string
): Promise<{ photoRef: string | null; city: string | null } | null> {
  try {
    await requireTripAccess(tripId, "EDITOR")

    const hotel = await prisma.hotel.findFirst({ where: { id: hotelId, tripId } })
    if (!hotel) return null

    // Already backfilled — don't spend a Places call.
    if (hotel.photoRef) {
      return { photoRef: hotel.photoRef, city: hotel.city ?? null }
    }

    const place = await lookupHotelPlace(hotel.name, hotel.address)
    if (!place) return { photoRef: null, city: hotel.city ?? null }

    const patch: {
      googlePlaceId?: string
      photoRef?: string
      city?: string
      lat?: number
      lng?: number
    } = {}
    if (place.googlePlaceId && !hotel.googlePlaceId) patch.googlePlaceId = place.googlePlaceId
    if (place.photoRef) patch.photoRef = place.photoRef
    if (place.city && !hotel.city) patch.city = place.city
    if (hotel.lat == null && hotel.lng == null && place.lat != null && place.lng != null) {
      patch.lat = place.lat
      patch.lng = place.lng
    }

    if (Object.keys(patch).length > 0) {
      await prisma.hotel.update({ where: { id: hotelId, tripId }, data: patch })
      revalidatePath(`/trip/${tripId}`)
    }

    return {
      photoRef: patch.photoRef ?? hotel.photoRef ?? null,
      city: patch.city ?? hotel.city ?? null,
    }
  } catch (err) {
    console.error("[backfillHotelPhoto] Error:", err)
    return null
  }
}

export async function deleteHotel(tripId: string, hotelId: string) {
  await requireTripAccess(tripId, "EDITOR")
  await prisma.hotel.delete({ where: { id: hotelId, tripId } })
  revalidatePath(`/trip/${tripId}`)
}
