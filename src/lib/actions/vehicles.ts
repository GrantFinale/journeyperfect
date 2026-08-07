"use server"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { requireTripAccess } from "@/lib/auth-trip"
import { revalidatePath } from "next/cache"
import { z } from "zod"

// NOT exported: a "use server" module may only export async functions.
// `VehicleInput` below is a type-only export, which is erased at compile time.
const vehicleSchema = z.object({
  make: z.string().min(1),
  model: z.string().min(1),
  year: z.number().int().optional().nullable(),
  color: z.string().optional().nullable(),
  licensePlate: z.string().optional().nullable(),
  licensePlateState: z.string().optional().nullable(),
  nickname: z.string().optional().nullable(),
  isDefault: z.boolean().optional(),
})

export type VehicleInput = z.infer<typeof vehicleSchema>

export async function listVehicles() {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  return prisma.vehicle.findMany({
    where: { userId: session.user.id },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  })
}

export async function createVehicle(data: VehicleInput) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  const userId = session.user.id
  const parsed = vehicleSchema.parse(data)

  const createData = {
    userId,
    make: parsed.make,
    model: parsed.model,
    year: parsed.year ?? null,
    color: parsed.color ?? null,
    licensePlate: parsed.licensePlate ?? null,
    licensePlateState: parsed.licensePlateState ?? null,
    nickname: parsed.nickname ?? null,
    isDefault: parsed.isDefault ?? false,
  }

  const vehicle = parsed.isDefault
    ? (
        await prisma.$transaction([
          prisma.vehicle.updateMany({
            where: { userId },
            data: { isDefault: false },
          }),
          prisma.vehicle.create({ data: createData }),
        ])
      )[1]
    : await prisma.vehicle.create({ data: createData })

  revalidatePath("/settings")
  return vehicle
}

export async function updateVehicle(vehicleId: string, data: Partial<VehicleInput>) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  const userId = session.user.id

  await prisma.vehicle.findFirstOrThrow({
    where: { id: vehicleId, userId },
  })

  const parsed = vehicleSchema.partial().parse(data)

  const updateData: Record<string, unknown> = {}
  if (parsed.make !== undefined) updateData.make = parsed.make
  if (parsed.model !== undefined) updateData.model = parsed.model
  if (parsed.year !== undefined) updateData.year = parsed.year ?? null
  if (parsed.color !== undefined) updateData.color = parsed.color ?? null
  if (parsed.licensePlate !== undefined) updateData.licensePlate = parsed.licensePlate ?? null
  if (parsed.licensePlateState !== undefined) updateData.licensePlateState = parsed.licensePlateState ?? null
  if (parsed.nickname !== undefined) updateData.nickname = parsed.nickname ?? null
  if (parsed.isDefault !== undefined) updateData.isDefault = parsed.isDefault

  const updated = parsed.isDefault
    ? (
        await prisma.$transaction([
          prisma.vehicle.updateMany({
            where: { userId, id: { not: vehicleId } },
            data: { isDefault: false },
          }),
          prisma.vehicle.update({ where: { id: vehicleId }, data: updateData }),
        ])
      )[1]
    : await prisma.vehicle.update({ where: { id: vehicleId }, data: updateData })

  revalidatePath("/settings")
  return updated
}

export async function deleteVehicle(vehicleId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  await prisma.vehicle.findFirstOrThrow({
    where: { id: vehicleId, userId: session.user.id },
  })

  await prisma.vehicle.delete({ where: { id: vehicleId } })
  revalidatePath("/settings")
}

export async function setTripVehicle(tripId: string, vehicleId: string | null) {
  const { userId } = await requireTripAccess(tripId, "EDITOR")

  if (vehicleId) {
    await prisma.vehicle.findFirstOrThrow({ where: { id: vehicleId, userId } })
  }

  const updated = await prisma.trip.update({
    where: { id: tripId },
    data: { vehicleId },
    select: { vehicleId: true },
  })

  revalidatePath(`/trip/${tripId}`)
  return { vehicleId: updated.vehicleId }
}
