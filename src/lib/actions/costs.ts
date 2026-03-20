"use server"
import { prisma } from "@/lib/db"
import { requireTripAccess } from "@/lib/auth-trip"

export async function getTripCostSummary(tripId: string) {
  await requireTripAccess(tripId)

  const [flights, hotels, budgetItems] = await Promise.all([
    prisma.flight.findMany({ where: { tripId }, select: { price: true, priceCurrency: true } }),
    prisma.hotel.findMany({ where: { tripId }, select: { price: true, priceCurrency: true, roomCount: true, checkIn: true, checkOut: true } }),
    prisma.budgetItem.findMany({ where: { tripId }, select: { amount: true, category: true, isEstimate: true } }),
  ])

  const flightTotal = flights.reduce((sum, f) => sum + (f.price || 0), 0)

  const hotelTotal = hotels.reduce((sum, h) => {
    if (!h.price) return sum
    const nights = Math.ceil((h.checkOut.getTime() - h.checkIn.getTime()) / 86400000)
    return sum + (h.price * nights * h.roomCount)
  }, 0)

  const budgetTotal = budgetItems.reduce((sum, b) => sum + b.amount, 0)
  const budgetCommitted = budgetItems.filter(b => !b.isEstimate).reduce((sum, b) => sum + b.amount, 0)

  return {
    flights: flightTotal,
    hotels: hotelTotal,
    activities: budgetItems.filter(b => b.category === "ACTIVITIES").reduce((sum, b) => sum + b.amount, 0),
    dining: budgetItems.filter(b => b.category === "DINING").reduce((sum, b) => sum + b.amount, 0),
    transport: budgetItems.filter(b => b.category === "TRANSPORT").reduce((sum, b) => sum + b.amount, 0),
    other: budgetItems.filter(b => !["FLIGHTS", "LODGING", "ACTIVITIES", "DINING", "TRANSPORT"].includes(b.category)).reduce((sum, b) => sum + b.amount, 0),
    totalPaid: flightTotal + hotelTotal + budgetCommitted,
    totalEstimated: budgetItems.filter(b => b.isEstimate).reduce((sum, b) => sum + b.amount, 0),
    grandTotal: flightTotal + hotelTotal + budgetTotal,
  }
}
