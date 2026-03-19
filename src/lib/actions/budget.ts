"use server"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { revalidatePath } from "next/cache"
import { z } from "zod"

const budgetItemSchema = z.object({
  category: z.enum(["FLIGHTS","LODGING","ACTIVITIES","DINING","TRANSPORT","SHOPPING","OTHER"]),
  title: z.string().min(1),
  amount: z.number().min(0),
  isEstimate: z.boolean().default(true),
  paidAt: z.string().optional(),
  notes: z.string().optional(),
})

export async function getBudgetSummary(tripId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  await prisma.trip.findFirstOrThrow({ where: { id: tripId, userId: session.user.id } })

  const items = await prisma.budgetItem.findMany({
    where: { tripId },
    orderBy: { createdAt: "desc" },
  })

  const total = items.reduce((sum, i) => sum + i.amount, 0)
  const committed = items.filter(i => !i.isEstimate).reduce((sum, i) => sum + i.amount, 0)
  const estimated = items.filter(i => i.isEstimate).reduce((sum, i) => sum + i.amount, 0)

  const byCategory = items.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + item.amount
    return acc
  }, {} as Record<string, number>)

  return { items, total, committed, estimated, byCategory }
}

export async function createBudgetItem(tripId: string, data: z.infer<typeof budgetItemSchema>) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  await prisma.trip.findFirstOrThrow({ where: { id: tripId, userId: session.user.id } })

  const parsed = budgetItemSchema.parse(data)
  const item = await prisma.budgetItem.create({
    data: {
      tripId,
      ...parsed,
      ...(parsed.paidAt && { paidAt: new Date(parsed.paidAt) }),
    },
  })

  revalidatePath(`/trip/${tripId}/budget`)
  return item
}

export async function updateBudgetItem(tripId: string, itemId: string, data: Partial<z.infer<typeof budgetItemSchema>>) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  await prisma.trip.findFirstOrThrow({ where: { id: tripId, userId: session.user.id } })

  const updated = await prisma.budgetItem.update({
    where: { id: itemId },
    data: {
      ...data,
      ...(data.paidAt && { paidAt: new Date(data.paidAt) }),
    },
  })

  revalidatePath(`/trip/${tripId}/budget`)
  return updated
}

export async function deleteBudgetItem(tripId: string, itemId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  await prisma.trip.findFirstOrThrow({ where: { id: tripId, userId: session.user.id } })
  await prisma.budgetItem.delete({ where: { id: itemId } })
  revalidatePath(`/trip/${tripId}/budget`)
}
