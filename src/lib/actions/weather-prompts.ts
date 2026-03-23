"use server"

import { requireTripAccess } from "@/lib/auth-trip"
import { prisma } from "@/lib/db"
import { getWeatherForecast, getWeatherAlerts, type DayForecast } from "@/lib/weather"
import { hasFeature } from "@/lib/features"
import { revalidatePath } from "next/cache"

export type WeatherSwapSuggestion = {
  id: string
  outdoorActivityName: string
  outdoorActivityId: string
  outdoorDate: string
  outdoorDateLabel: string
  rainProbability: number
  weatherCondition: string
  weatherEmoji: string
  // Suggestion: indoor alternative from wishlist
  indoorAlternativeName?: string
  indoorAlternativeId?: string
  // Suggestion: better weather day
  betterDate?: string
  betterDateLabel?: string
  betterWeather?: string
}

export async function checkWeatherConflicts(tripId: string): Promise<WeatherSwapSuggestion[]> {
  let userId: string
  try {
    const access = await requireTripAccess(tripId)
    userId = access.userId
  } catch {
    return []
  }

  // Check paid plan
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true },
  })
  if (!user || !hasFeature(user.plan, "weatherAlerts")) return []

  const trip = await prisma.trip.findFirst({
    where: { id: tripId },
    include: {
      destinations: { orderBy: { position: "asc" } },
      itineraryItems: {
        where: { type: "ACTIVITY" },
        include: { activity: true },
      },
      activities: {
        where: { status: "WISHLIST", indoorOutdoor: "INDOOR" },
        take: 10,
      },
    },
  })
  if (!trip) return []

  // Get coordinates
  let lat = trip.destinationLat
  let lng = trip.destinationLng
  if (lat == null || lng == null) {
    const dest = trip.destinations.find((d) => d.lat && d.lng)
    lat = dest?.lat ?? null
    lng = dest?.lng ?? null
  }
  if (lat == null || lng == null) return []

  // Only check if trip starts within 3 days
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tripStart = new Date(trip.startDate)
  tripStart.setHours(0, 0, 0, 0)
  const daysUntilStart = Math.round((tripStart.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  if (daysUntilStart > 3 || daysUntilStart < -Math.round((trip.endDate.getTime() - trip.startDate.getTime()) / (1000 * 60 * 60 * 24))) {
    return []
  }

  const forecasts = await getWeatherForecast(lat, lng)
  if (forecasts.length === 0) return []

  const forecastMap = new Map<string, DayForecast>()
  for (const f of forecasts) {
    forecastMap.set(f.date, f)
  }

  const suggestions: WeatherSwapSuggestion[] = []

  // Find outdoor scheduled activities with bad weather
  const outdoorItems = trip.itineraryItems.filter(
    (item) => item.activity && item.activity.indoorOutdoor === "OUTDOOR"
  )

  for (const item of outdoorItems) {
    const dateStr = item.date.toISOString().split("T")[0]
    const forecast = forecastMap.get(dateStr)
    if (!forecast || forecast.precipitationPct < 60) continue

    const suggestion: WeatherSwapSuggestion = {
      id: `swap-${item.id}`,
      outdoorActivityName: item.title,
      outdoorActivityId: item.activityId || "",
      outdoorDate: dateStr,
      outdoorDateLabel: new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
      }),
      rainProbability: forecast.precipitationPct,
      weatherCondition: forecast.condition,
      weatherEmoji: forecast.emoji,
    }

    // Find an indoor alternative from wishlist
    const indoorAlt = trip.activities.find((a) => a.status === "WISHLIST" && a.indoorOutdoor === "INDOOR")
    if (indoorAlt) {
      suggestion.indoorAlternativeName = indoorAlt.name
      suggestion.indoorAlternativeId = indoorAlt.id
    }

    // Find a better day within forecast range
    for (const f of forecasts) {
      if (f.date === dateStr) continue
      if (f.precipitationPct < 30 && f.date >= new Date().toISOString().split("T")[0]) {
        const tripEnd = trip.endDate.toISOString().split("T")[0]
        const tripStartStr = trip.startDate.toISOString().split("T")[0]
        if (f.date >= tripStartStr && f.date <= tripEnd) {
          suggestion.betterDate = f.date
          suggestion.betterDateLabel = new Date(f.date + "T12:00:00").toLocaleDateString("en-US", {
            weekday: "long",
            month: "short",
            day: "numeric",
          })
          suggestion.betterWeather = `${f.emoji} ${f.condition}`
          break
        }
      }
    }

    suggestions.push(suggestion)
  }

  return suggestions
}

export async function swapWithIndoor(
  tripId: string,
  outdoorActivityId: string,
  indoorActivityId: string,
  date: string
) {
  await requireTripAccess(tripId, "EDITOR")

  // Find the itinerary item for the outdoor activity on this date
  const itineraryItem = await prisma.itineraryItem.findFirst({
    where: { tripId, activityId: outdoorActivityId, date: new Date(date) },
  })
  if (!itineraryItem) throw new Error("Itinerary item not found")

  const indoorActivity = await prisma.activity.findFirstOrThrow({
    where: { id: indoorActivityId, tripId },
  })

  // Update itinerary item to point to indoor activity
  await prisma.itineraryItem.update({
    where: { id: itineraryItem.id },
    data: {
      activityId: indoorActivityId,
      title: indoorActivity.name,
      durationMins: indoorActivity.durationMins,
    },
  })

  // Update activity statuses
  await prisma.activity.update({
    where: { id: indoorActivityId },
    data: { status: "SCHEDULED" },
  })
  await prisma.activity.update({
    where: { id: outdoorActivityId },
    data: { status: "WISHLIST" },
  })

  revalidatePath(`/trip/${tripId}`)
  revalidatePath(`/trip/${tripId}/itinerary`)
}
