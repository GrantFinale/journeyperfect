"use server"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

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
