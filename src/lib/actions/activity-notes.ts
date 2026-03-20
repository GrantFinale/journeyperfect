"use server"

import { requireTripAccess } from "@/lib/auth-trip"
import { prisma } from "@/lib/db"
import { revalidatePath } from "next/cache"

export async function getActivityNotes(tripId: string, activityId: string) {
  await requireTripAccess(tripId)
  return prisma.activityNote.findMany({
    where: { activityId, tripId },
    include: { user: { select: { name: true, image: true } } },
    orderBy: { createdAt: "asc" },
  })
}

export async function addActivityNote(tripId: string, activityId: string, text: string) {
  const { userId } = await requireTripAccess(tripId, "EDITOR")
  const note = await prisma.activityNote.create({
    data: { activityId, tripId, userId, text },
    include: { user: { select: { name: true, image: true } } },
  })
  revalidatePath(`/trip/${tripId}`)
  return note
}

export async function deleteActivityNote(tripId: string, noteId: string) {
  const { userId } = await requireTripAccess(tripId, "EDITOR")
  // Only the author can delete their note
  const note = await prisma.activityNote.findFirstOrThrow({ where: { id: noteId, tripId } })
  if (note.userId !== userId) throw new Error("Can only delete your own notes")
  await prisma.activityNote.delete({ where: { id: noteId } })
  revalidatePath(`/trip/${tripId}`)
}

// Add an expense linked to an activity
export async function addActivityExpense(
  tripId: string,
  activityId: string,
  data: { description: string; amount: number; currency?: string; paidBy?: string }
) {
  const { userId } = await requireTripAccess(tripId, "EDITOR")

  const activity = await prisma.activity.findFirstOrThrow({
    where: { id: activityId, tripId },
  })

  // Create a budget item linked to this activity
  await prisma.budgetItem.create({
    data: {
      tripId,
      title: `${activity.name}: ${data.description}`,
      amount: data.amount,
      currency: data.currency || "USD",
      category: "ACTIVITIES",
      isEstimate: false,
      paidBy: data.paidBy || userId,
    },
  })

  revalidatePath(`/trip/${tripId}`)
}
