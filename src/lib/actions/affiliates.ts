"use server"

import { auth } from "@/lib/auth"
import {
  getTripAffiliateLinks,
  getActivityAffiliateLinks,
  getHotelBookingLink,
  getRentalCarLink,
  type AffiliateLink,
} from "@/lib/affiliates"
import { prisma } from "@/lib/db"

export async function getTripAffiliates(tripId: string): Promise<AffiliateLink[]> {
  const session = await auth()
  if (!session?.user?.id) return []

  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId: session.user.id },
    select: { destination: true, startDate: true, endDate: true },
  })
  if (!trip) return []

  return getTripAffiliateLinks({
    destination: trip.destination,
    startDate: trip.startDate.toISOString().split("T")[0],
    endDate: trip.endDate.toISOString().split("T")[0],
  })
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
