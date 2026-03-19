"use server"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { revalidatePath } from "next/cache"

async function requireAdmin() {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")
  const user = await prisma.user.findUnique({ where: { id: session.user.id } })
  if (!user?.isAdmin) throw new Error("Forbidden")
  return user
}

export async function getAdminStats() {
  await requireAdmin()
  const [totalUsers, totalTrips, activeTrips] = await Promise.all([
    prisma.user.count(),
    prisma.trip.count(),
    prisma.trip.count({ where: { status: "ACTIVE" } }),
  ])
  return { totalUsers, totalTrips, activeTrips }
}

export async function getAdminUsers() {
  await requireAdmin()
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      plan: true,
      isAdmin: true,
      createdAt: true,
      _count: { select: { trips: true } },
    },
    orderBy: { createdAt: "desc" },
  })
  return users
}

export async function toggleUserAdmin(userId: string) {
  await requireAdmin()
  const target = await prisma.user.findUnique({ where: { id: userId } })
  if (!target) throw new Error("User not found")
  await prisma.user.update({
    where: { id: userId },
    data: { isAdmin: !target.isAdmin },
  })
  revalidatePath("/admin/users")
}

export async function getAdminConfigs() {
  await requireAdmin()
  const configs = await prisma.appConfig.findMany({ orderBy: { key: "asc" } })
  return configs
}

export async function updateAdminConfig(key: string, value: string) {
  await requireAdmin()
  await prisma.appConfig.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  })
  revalidatePath("/admin")
}

export async function getAdminTrips(options?: { userId?: string; search?: string }) {
  await requireAdmin()
  const where: any = {}
  if (options?.userId) where.userId = options.userId
  if (options?.search) {
    where.OR = [
      { title: { contains: options.search, mode: "insensitive" } },
      { destination: { contains: options.search, mode: "insensitive" } },
    ]
  }
  return prisma.trip.findMany({
    where,
    include: {
      user: { select: { name: true, email: true } },
      _count: { select: { itineraryItems: true, flights: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  })
}

export async function deleteAdminTrip(tripId: string) {
  await requireAdmin()
  await prisma.trip.delete({ where: { id: tripId } })
  revalidatePath("/admin/trips")
}

export async function updateUserPlan(userId: string, plan: string) {
  await requireAdmin()
  await prisma.user.update({
    where: { id: userId },
    data: { plan: plan as any },
  })
  revalidatePath("/admin/users")
}

export async function deleteAdminConfig(key: string) {
  await requireAdmin()
  await prisma.appConfig.delete({ where: { key } }).catch(() => {})
  revalidatePath("/admin/settings")
}
