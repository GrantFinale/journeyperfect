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
  showFreeTime?: boolean
  freeTimeMinGapHours?: number
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

export async function getUserTimezone(): Promise<string> {
  const session = await auth()
  if (!session?.user?.id) return "America/New_York"

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { timezone: true },
  })

  return user?.timezone || "America/New_York"
}

export async function updateTimezone(timezone: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  const validTimezones = [
    "AUTO",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/Anchorage",
    "Pacific/Honolulu",
  ]

  if (!validTimezones.includes(timezone)) {
    throw new Error("Invalid timezone")
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { timezone },
  })

  revalidatePath("/settings")
  return { timezone }
}
