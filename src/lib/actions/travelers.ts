"use server"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { requireTripAccess } from "@/lib/auth-trip"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import type { Prisma } from "@prisma/client"

const travelerSchema = z.object({
  name: z.string().min(1).max(100),
  birthDate: z.string().optional(),
  sex: z.enum(["male", "female", "other"]).optional(),
  photoUrl: z.string().optional(),
  tags: z.array(z.string()).default([]),
  isDefault: z.boolean().default(false),
})

export async function getTravelerProfiles() {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  return prisma.travelerProfile.findMany({
    where: { userId: session.user.id },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  })
}

export async function createTravelerProfile(data: z.infer<typeof travelerSchema>) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  const parsed = travelerSchema.parse(data)

  if (parsed.isDefault) {
    await prisma.travelerProfile.updateMany({
      where: { userId: session.user.id },
      data: { isDefault: false },
    })
  }

  const profile = await prisma.travelerProfile.create({
    data: {
      userId: session.user.id,
      name: parsed.name,
      tags: parsed.tags,
      isDefault: parsed.isDefault,
      sex: parsed.sex ?? null,
      photoUrl: parsed.photoUrl ?? null,
      ...(parsed.birthDate && { birthDate: new Date(parsed.birthDate) }),
    },
  })

  revalidatePath("/settings")
  return profile
}

export async function updateTravelerProfile(profileId: string, data: Partial<z.infer<typeof travelerSchema>>) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  await prisma.travelerProfile.findFirstOrThrow({
    where: { id: profileId, userId: session.user.id },
  })

  if (data.isDefault) {
    await prisma.travelerProfile.updateMany({
      where: { userId: session.user.id },
      data: { isDefault: false },
    })
  }

  const updateData: Record<string, unknown> = {}
  if (data.name !== undefined) updateData.name = data.name
  if (data.tags !== undefined) updateData.tags = data.tags
  if (data.isDefault !== undefined) updateData.isDefault = data.isDefault
  if (data.birthDate !== undefined) updateData.birthDate = data.birthDate ? new Date(data.birthDate) : null
  if (data.sex !== undefined) updateData.sex = data.sex ?? null
  if (data.photoUrl !== undefined) updateData.photoUrl = data.photoUrl ?? null

  const updated = await prisma.travelerProfile.update({
    where: { id: profileId },
    data: updateData,
  })

  revalidatePath("/settings")
  return updated
}

export async function deleteTravelerProfile(profileId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  await prisma.travelerProfile.findFirstOrThrow({
    where: { id: profileId, userId: session.user.id },
  })

  await prisma.travelerProfile.delete({ where: { id: profileId } })
  revalidatePath("/settings")
}

export async function updateTravelerPreferences(profileId: string, preferences: Prisma.InputJsonValue) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  await prisma.travelerProfile.findFirstOrThrow({
    where: { id: profileId, userId: session.user.id },
  })

  const updated = await prisma.travelerProfile.update({
    where: { id: profileId },
    data: { preferences },
  })

  revalidatePath("/settings/travelers")
  return updated
}

export type TravelerProfileResult = Awaited<ReturnType<typeof createTravelerProfile>>

export async function addTravelerToTrip(tripId: string, profileId: string) {
  const { userId } = await requireTripAccess(tripId, "EDITOR")
  await prisma.travelerProfile.findFirstOrThrow({ where: { id: profileId, userId } })

  await prisma.tripTraveler.upsert({
    where: { tripId_travelerProfileId: { tripId, travelerProfileId: profileId } },
    create: { tripId, travelerProfileId: profileId },
    update: {},
  })

  revalidatePath(`/trip/${tripId}/settings`)
}

export async function removeTravelerFromTrip(tripId: string, profileId: string) {
  await requireTripAccess(tripId, "EDITOR")

  await prisma.tripTraveler.delete({
    where: { tripId_travelerProfileId: { tripId, travelerProfileId: profileId } },
  })

  revalidatePath(`/trip/${tripId}/settings`)
}
