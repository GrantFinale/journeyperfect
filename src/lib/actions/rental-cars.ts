"use server"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { requireTripAccess } from "@/lib/auth-trip"
import { revalidatePath } from "next/cache"
import { parseRentalCarTextWithAI } from "@/lib/rental-car-parser-ai"
import { z } from "zod"
import { hasFeature } from "@/lib/features"

const rentalCarSchema = z.object({
  company: z.string().optional(),
  confirmationNumber: z.string().optional(),
  vehicleType: z.string().optional(),
  pickupLocation: z.string().optional(),
  pickupAddress: z.string().optional(),
  pickupTime: z.string(),
  pickupTimezone: z.string().default("UTC"),
  dropoffLocation: z.string().optional(),
  dropoffAddress: z.string().optional(),
  dropoffTime: z.string(),
  dropoffTimezone: z.string().default("UTC"),
  price: z.number().optional(),
  priceCurrency: z.string().optional(),
  bookingLink: z.string().optional(),
  notes: z.string().optional(),
})

export async function createRentalCar(tripId: string, data: z.infer<typeof rentalCarSchema>) {
  await requireTripAccess(tripId, "EDITOR")

  const parsed = rentalCarSchema.parse(data)
  const pickupTime = new Date(parsed.pickupTime)
  const dropoffTime = new Date(parsed.dropoffTime)

  const rentalCar = await prisma.rentalCar.create({
    data: {
      tripId,
      ...parsed,
      pickupTime,
      dropoffTime,
    },
  })

  // Auto-create pickup and dropoff itinerary items
  const pickupTitle = `${parsed.company || "Car"} pickup${parsed.pickupLocation ? ` at ${parsed.pickupLocation}` : ""}`
  const dropoffTitle = `${parsed.company || "Car"} dropoff${parsed.dropoffLocation ? ` at ${parsed.dropoffLocation}` : ""}`

  await prisma.itineraryItem.createMany({
    data: [
      {
        tripId,
        rentalCarId: rentalCar.id,
        date: pickupTime,
        startTime: pickupTime.toTimeString().slice(0, 5),
        type: "RENTAL_CAR_PICKUP",
        title: pickupTitle,
        durationMins: 30,
        position: 0,
        isConfirmed: true,
      },
      {
        tripId,
        rentalCarId: rentalCar.id,
        date: dropoffTime,
        startTime: dropoffTime.toTimeString().slice(0, 5),
        type: "RENTAL_CAR_DROPOFF",
        title: dropoffTitle,
        durationMins: 30,
        position: 0,
        isConfirmed: true,
      },
    ],
  })

  // Auto-create BudgetItem for rental car cost
  if (parsed.price) {
    const days = Math.ceil((dropoffTime.getTime() - pickupTime.getTime()) / 86400000) || 1
    await prisma.budgetItem.create({
      data: {
        tripId,
        category: "TRANSPORT",
        title: `${parsed.company || "Car rental"} (${days} day${days > 1 ? "s" : ""})${parsed.vehicleType ? ` - ${parsed.vehicleType}` : ""}`,
        amount: parsed.price,
        isEstimate: false,
      },
    })
  }

  revalidatePath(`/trip/${tripId}`)
  revalidatePath(`/trip/${tripId}/itinerary`)
  return rentalCar
}

export async function updateRentalCar(tripId: string, carId: string, data: Partial<z.infer<typeof rentalCarSchema>>) {
  await requireTripAccess(tripId, "EDITOR")

  const updated = await prisma.rentalCar.update({
    where: { id: carId, tripId },
    data: {
      ...data,
      ...(data.pickupTime && { pickupTime: new Date(data.pickupTime) }),
      ...(data.dropoffTime && { dropoffTime: new Date(data.dropoffTime) }),
    },
  })

  revalidatePath(`/trip/${tripId}`)
  return updated
}

export async function deleteRentalCar(tripId: string, carId: string) {
  await requireTripAccess(tripId, "EDITOR")
  await prisma.rentalCar.delete({ where: { id: carId, tripId } })
  revalidatePath(`/trip/${tripId}`)
}

export async function parseAndPreviewRentalCar(text: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { plan: true },
  })

  // AI parsing is a paid feature (reuse aiFlightParsing gate)
  if (!user || !hasFeature(user.plan, "aiFlightParsing")) {
    throw new Error("UPGRADE_REQUIRED:AI rental car parsing requires a paid plan. Please enter rental car details manually or upgrade your plan.")
  }

  try {
    const aiResult = await parseRentalCarTextWithAI(text, session.user.id)
    if (aiResult && aiResult.rentalCars.length > 0) {
      return aiResult
    }
  } catch (err) {
    console.error("[parseAndPreviewRentalCar] AI parser threw:", err)
  }

  throw new Error("PARSE_FAILED:Could not parse rental car details. Please enter them manually.")
}

export async function getRentalCars(tripId: string) {
  await requireTripAccess(tripId)

  return prisma.rentalCar.findMany({
    where: { tripId },
    orderBy: { pickupTime: "asc" },
  })
}
