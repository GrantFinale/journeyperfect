"use server"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { revalidatePath } from "next/cache"

export async function getPreferences() {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  return prisma.userPreferences.findUnique({
    where: { userId: session.user.id },
  })
}

export async function updatePreferences(data: {
  airportArrivalBufferMins?: number
  pacingStyle?: "CHILL" | "LEISURELY" | "MODERATE" | "ACTIVE" | "PACKED"
  avgDailyBudget?: number
  wakeUpTime?: string
  bedTime?: string
  mealStylePrefs?: string[]
  activityMix?: string[]
  mobilityNotes?: string
  maxDailyTravelMins?: number
}) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  const prefs = await prisma.userPreferences.upsert({
    where: { userId: session.user.id },
    create: { userId: session.user.id, ...data },
    update: data,
  })

  revalidatePath("/settings")
  return prefs
}
