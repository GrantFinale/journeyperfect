"use server"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import {
  getWeatherForecast,
  getWeatherAlerts,
  type TripWeatherData,
} from "@/lib/weather"
import { hasFeature } from "@/lib/features"

export async function getTripWeather(tripId: string): Promise<TripWeatherData | null> {
  const session = await auth()
  if (!session?.user?.id) return null

  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId: session.user.id },
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
    where: { id: session.user.id },
    select: { plan: true },
  })
  const showAlerts = user && hasFeature(user.plan, "weatherAlerts")

  return { forecasts, alerts: showAlerts ? alerts : [], tripStart, tripEnd }
}
