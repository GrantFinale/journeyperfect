"use server"

import { prisma } from "@/lib/db"
import { requireTripAccess } from "@/lib/auth-trip"
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
  await requireTripAccess(tripId)

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
  await requireTripAccess(tripId, "EDITOR")

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
  await requireTripAccess(tripId, "EDITOR")

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

export type BudgetItemResult = Awaited<ReturnType<typeof createBudgetItem>>
export type BudgetSummaryResult = Awaited<ReturnType<typeof getBudgetSummary>>

export async function deleteBudgetItem(tripId: string, itemId: string) {
  await requireTripAccess(tripId, "EDITOR")
  await prisma.budgetItem.delete({ where: { id: itemId } })
  revalidatePath(`/trip/${tripId}/budget`)
}
