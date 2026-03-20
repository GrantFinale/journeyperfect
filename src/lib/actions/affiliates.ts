"use server"

import { auth } from "@/lib/auth"
import {
  getTripAffiliateLinks,
  getActivityAffiliateLinks,
  getHotelBookingLink,
  getRentalCarLink,
  getTravelInsuranceLink,
  getAmazonPackingLink,
  getViatorDestinationLink,
  type AffiliateLink,
} from "@/lib/affiliates"
import { prisma } from "@/lib/db"
import { requireTripAccess } from "@/lib/auth-trip"

export async function getTripAffiliates(tripId: string): Promise<AffiliateLink[]> {
  try {
    await requireTripAccess(tripId)
  } catch {
    return []
  }

  const trip = await prisma.trip.findFirst({
    where: { id: tripId },
    select: { destination: true, startDate: true, endDate: true },
  })
  if (!trip) return []

  return getTripAffiliateLinks({
    destination: trip.destination,
    startDate: trip.startDate.toISOString().split("T")[0],
    endDate: trip.endDate.toISOString().split("T")[0],
  })
}

export async function getSmartSuggestions(tripId: string) {
  try {
    await requireTripAccess(tripId)
  } catch {
    return []
  }

  const trip = await prisma.trip.findFirst({
    where: { id: tripId },
    include: {
      flights: { select: { id: true, arrivalAirport: true } },
      hotels: { select: { id: true } },
      activities: { select: { id: true } },
      destinations: { orderBy: { position: "asc" }, select: { name: true } },
    },
  })
  if (!trip) return []

  const suggestions: {
    id: string
    icon: string
    title: string
    description: string
    link: AffiliateLink
    variant: "blue" | "green" | "amber" | "purple"
    trackType?: "car" | "hotel" | "flight"
  }[] = []

  const destination = trip.destination
  const startDate = trip.startDate.toISOString().split("T")[0]
  const endDate = trip.endDate.toISOString().split("T")[0]
  const daysUntilTrip = Math.ceil((trip.startDate.getTime() - Date.now()) / 86400000)

  // 1. Hotel suggestion: flights exist but no hotels
  if (trip.flights.length > 0 && trip.hotels.length === 0) {
    const link = await getHotelBookingLink(destination, startDate, endDate)
    suggestions.push({
      id: "hotel",
      icon: "\u{1F3E8}",
      title: "You have flights but no hotel yet",
      description: `Find accommodations in ${destination} for your trip`,
      link,
      variant: "blue",
      trackType: "hotel",
    })
  }

  // 2. Car rental: has arrival airport
  if (trip.flights.length > 0 && trip.flights.some(f => f.arrivalAirport)) {
    const link = await getRentalCarLink(destination, startDate, endDate)
    suggestions.push({
      id: "car",
      icon: "\u{1F697}",
      title: `Getting around ${destination}?`,
      description: "Rent a car from the airport for easy travel between activities",
      link,
      variant: "green",
      trackType: "car",
    })
  }

  // 3. Travel insurance: trip is 1-30 days away
  if (daysUntilTrip > 0 && daysUntilTrip <= 30) {
    const link = await getTravelInsuranceLink(destination)
    suggestions.push({
      id: "insurance",
      icon: "\u{1F6E1}\uFE0F",
      title: daysUntilTrip <= 7 ? "Traveling this week!" : "Your trip is coming up",
      description: "Protect your trip with travel insurance \u2014 covers cancellations, medical, and lost luggage",
      link,
      variant: "amber",
    })
  }

  // 4. Packing: trip is 1-14 days away
  if (daysUntilTrip > 0 && daysUntilTrip <= 14) {
    const link = await getAmazonPackingLink(destination)
    suggestions.push({
      id: "packing",
      icon: "\u{1F392}",
      title: `Packing for ${destination}?`,
      description: "Browse travel essentials \u2014 adapters, packing cubes, and more",
      link,
      variant: "purple",
    })
  }

  return suggestions
}

export async function getActivityAffiliates(
  activityName: string,
  destination: string
): Promise<AffiliateLink[]> {
  const session = await auth()
  if (!session?.user?.id) return []
  return getActivityAffiliateLinks(activityName, destination)
}

export async function getHotelAffiliate(
  destination: string,
  checkIn?: string,
  checkOut?: string
): Promise<AffiliateLink> {
  return getHotelBookingLink(destination, checkIn, checkOut)
}

export async function getCarRentalAffiliate(
  location: string,
  pickupDate?: string,
  dropoffDate?: string
): Promise<AffiliateLink> {
  return getRentalCarLink(location, pickupDate, dropoffDate)
}

export async function getViatorDestinationAffiliate(
  destination: string
): Promise<AffiliateLink> {
  return getViatorDestinationLink(destination)
}
