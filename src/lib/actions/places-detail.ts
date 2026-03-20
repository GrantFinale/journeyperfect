"use server"

import { auth } from "@/lib/auth"

export async function getPlaceDetails(placeId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  const apiKey = process.env.GOOGLE_PLACES_KEY || process.env.NEXT_PUBLIC_GOOGLE_PLACES_KEY
  if (!apiKey || apiKey === "build-placeholder") return null

  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "id,displayName,formattedAddress,location,rating,userRatingCount,types,photos,priceLevel,currentOpeningHours,regularOpeningHours,websiteUri,nationalPhoneNumber,goodForChildren,servesVegetarianFood,dineIn,delivery,takeout",
      },
    })
    if (!res.ok) return null
    const data = await res.json()

    return {
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
  } catch {
    return null
  }
}
