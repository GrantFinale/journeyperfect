"use server"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { revalidatePath } from "next/cache"

export async function getUserPlan(): Promise<string> {
  const session = await auth()
  if (!session?.user?.id) return "FREE"
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { plan: true } })
  return user?.plan || "FREE"
}

export async function getUserId(): Promise<string | null> {
  const session = await auth()
  return session?.user?.id ?? null
}

export async function getPlacesApiKey(): Promise<string> {
  // NEXT_PUBLIC_ vars are baked at build time — in Docker they're "build-placeholder"
  // Use the runtime GOOGLE_PLACES_KEY instead, which is available at request time
  const key = process.env.GOOGLE_PLACES_KEY || process.env.NEXT_PUBLIC_GOOGLE_PLACES_KEY || ""
  if (key === "build-placeholder") return ""
  return key
}

type HomeAddress = {
  homeAddress: string | null
  homeCity: string | null
  homeLat: number | null
  homeLng: number | null
}

export async function getHomeAddress(): Promise<HomeAddress> {
  const empty: HomeAddress = { homeAddress: null, homeCity: null, homeLat: null, homeLng: null }

  const session = await auth()
  if (!session?.user?.id) return empty

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { homeAddress: true, homeCity: true, homeLat: true, homeLng: true },
  })

  return user ?? empty
}

export async function updateHomeAddress(data: {
  homeAddress?: string | null
  homeCity?: string | null
  homeLat?: number | null
  homeLng?: number | null
}): Promise<HomeAddress> {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  const updated = await prisma.user.update({
    where: { id: session.user.id },
    data: {
      ...(data.homeAddress !== undefined && { homeAddress: data.homeAddress }),
      ...(data.homeCity !== undefined && { homeCity: data.homeCity }),
      ...(data.homeLat !== undefined && { homeLat: data.homeLat }),
      ...(data.homeLng !== undefined && { homeLng: data.homeLng }),
    },
    select: { homeAddress: true, homeCity: true, homeLat: true, homeLng: true },
  })

  revalidatePath("/settings")
  return updated
}
