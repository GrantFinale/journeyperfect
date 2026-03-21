"use server"

import { auth } from "@/lib/auth"

// Cache place details for 1 hour (place data doesn't change often)
const placeDetailsCache = new Map<string, { data: any; expiry: number }>()
const DETAIL_CACHE_TTL = 60 * 60 * 1000 // 1 hour
const MAX_CACHE_SIZE = 500

function cacheSet<K, V>(cache: Map<K, V>, key: K, value: V) {
  if (cache.size >= MAX_CACHE_SIZE) {
    const first = cache.keys().next().value
    if (first !== undefined) cache.delete(first)
  }
  cache.set(key, value)
}

export async function getPlaceDetails(placeId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  // Check cache
  const cached = placeDetailsCache.get(placeId)
  if (cached && Date.now() < cached.expiry) {
    return cached.data
  }

  const apiKey = process.env.GOOGLE_PLACES_KEY || process.env.NEXT_PUBLIC_GOOGLE_PLACES_KEY
  if (!apiKey || apiKey === "build-placeholder") return null

  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "id,displayName,formattedAddress,location,rating,userRatingCount,types,photos,priceLevel,currentOpeningHours,regularOpeningHours,websiteUri,nationalPhoneNumber,goodForChildren,servesVegetarianFood,dineIn,delivery,takeout",
      },
      referrer: "",
      referrerPolicy: "no-referrer",
    })
    if (!res.ok) return null
    const data = await res.json()

    const result = {
      name: data.displayName?.text,
      address: data.formattedAddress,
      lat: data.location?.latitude,
      lng: data.location?.longitude,
      rating: data.rating,
      ratingCount: data.userRatingCount,
      types: data.types,
      priceLevel: data.priceLevel,
      website: data.websiteUri,
      phone: data.nationalPhoneNumber,
      goodForChildren: data.goodForChildren,
      hours:
        data.regularOpeningHours?.weekdayDescriptions ||
        data.currentOpeningHours?.weekdayDescriptions,
      openNow: data.currentOpeningHours?.openNow,
    }

    // Cache it
    cacheSet(placeDetailsCache, placeId, { data: result, expiry: Date.now() + DETAIL_CACHE_TTL })

    return result
  } catch {
    return null
  }
}
