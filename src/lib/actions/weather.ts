"use server"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { requireTripAccess } from "@/lib/auth-trip"
import {
  getWeatherForecast,
  getWeatherAlerts,
  type TripWeatherData,
} from "@/lib/weather"
import { hasFeature } from "@/lib/features"

export async function getTripWeather(tripId: string): Promise<TripWeatherData | null> {
  let userId: string
  try {
    const access = await requireTripAccess(tripId)
    userId = access.userId
  } catch {
    return null
  }

  const trip = await prisma.trip.findFirst({
    where: { id: tripId },
    include: {
      destinations: { orderBy: { position: "asc" } },
      itineraryItems: {
        where: { type: "ACTIVITY" },
        select: {
          date: true,
          title: true,
          activity: {
            select: { indoorOutdoor: true, isFixed: true },
          },
        },
      },
    },
  })
  if (!trip) return null

  // Use destinationLat/Lng if available, otherwise fall back to first destination with coords
  let lat: number | null = trip.destinationLat
  let lng: number | null = trip.destinationLng

  if (lat == null || lng == null) {
    const dest = trip.destinations.find((d) => d.lat && d.lng)
    lat = dest?.lat ?? null
    lng = dest?.lng ?? null
  }

  // Fallback: geocode the destination name using Open-Meteo geocoding (free, no key)
  if (lat == null || lng == null) {
    const searchName = trip.destinations[0]?.name || trip.destination
    if (searchName) {
      try {
        const geoRes = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(searchName)}&count=1&language=en&format=json`
        )
        if (geoRes.ok) {
          const geoData = await geoRes.json()
          if (geoData.results?.[0]) {
            lat = geoData.results[0].latitude
            lng = geoData.results[0].longitude
            // Save coordinates for next time
            if (trip.destinations[0] && lat != null && lng != null) {
              await prisma.tripDestination.update({
                where: { id: trip.destinations[0].id },
                data: { lat, lng },
              }).catch(() => {}) // non-critical, don't fail
            }
          }
        }
      } catch {
        // Geocoding failed, no weather
      }
    }
  }

  if (lat == null || lng == null) return null

  const tripStart = trip.startDate.toISOString().split("T")[0]
  const tripEnd = trip.endDate.toISOString().split("T")[0]

  const forecasts = await getWeatherForecast(lat, lng)
  if (forecasts.length === 0) return null

  // Build activity list with dates from itinerary items
  const activitiesWithDates = trip.itineraryItems
    .filter((item) => item.activity)
    .map((item) => ({
      name: item.title,
      date: item.date.toISOString().split("T")[0],
      indoorOutdoor: item.activity!.indoorOutdoor,
      isFixed: item.activity!.isFixed,
    }))

  const alerts = getWeatherAlerts(forecasts, activitiesWithDates)

  // Only show weather alerts for paid plans
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true },
  })
  const showAlerts = user && hasFeature(user.plan, "weatherAlerts")

  return { forecasts, alerts: showAlerts ? alerts : [], tripStart, tripEnd }
}
