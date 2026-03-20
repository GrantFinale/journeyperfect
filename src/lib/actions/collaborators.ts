"use server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { revalidatePath } from "next/cache"

export async function inviteCollaborator(tripId: string, email: string, role: "VIEWER" | "EDITOR") {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  // Must be owner to invite
  await prisma.trip.findFirstOrThrow({ where: { id: tripId, userId: session.user.id } })

  // Check if already invited
  const existing = await prisma.tripCollaborator.findUnique({
    where: { tripId_email: { tripId, email: email.toLowerCase() } },
  })
  if (existing) throw new Error("Already invited")

  // Check if the invitee already has an account
  const invitee = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })

  await prisma.tripCollaborator.create({
    data: {
      tripId,
      email: email.toLowerCase(),
      role,
      status: invitee ? "ACCEPTED" : "PENDING", // auto-accept if they have an account
      userId: invitee?.id,
      invitedBy: session.user.id,
    },
  })

  revalidatePath(`/trip/${tripId}/settings`)
  return { success: true }
}

export async function getCollaborators(tripId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  return prisma.tripCollaborator.findMany({
    where: { tripId },
    include: { user: { select: { name: true, email: true, image: true } } },
    orderBy: { createdAt: "asc" },
  })
}

export async function removeCollaborator(tripId: string, collaboratorId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  await prisma.trip.findFirstOrThrow({ where: { id: tripId, userId: session.user.id } })
  await prisma.tripCollaborator.delete({ where: { id: collaboratorId } })
  revalidatePath(`/trip/${tripId}/settings`)
}

export async function updateCollaboratorRole(tripId: string, collaboratorId: string, role: "VIEWER" | "EDITOR") {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  await prisma.trip.findFirstOrThrow({ where: { id: tripId, userId: session.user.id } })
  await prisma.tripCollaborator.update({
    where: { id: collaboratorId },
    data: { role },
  })
  revalidatePath(`/trip/${tripId}/settings`)
}

// Get trips the current user collaborates on (for dashboard)
export async function getCollaborativeTrips() {
  const session = await auth()
  if (!session?.user?.id) return []

  const collabs = await prisma.tripCollaborator.findMany({
    where: { userId: session.user.id, status: "ACCEPTED" },
    include: {
      trip: {
        include: {
          user: { select: { name: true } },
          _count: { select: { itineraryItems: true, flights: true } },
        },
      },
    },
  })

  return collabs.map(c => ({ ...c.trip, collaboratorRole: c.role }))
}

// Auto-accept pending invites for a user who just signed up/logged in
export async function acceptPendingInvites() {
  const session = await auth()
  if (!session?.user?.id || !session.user.email) return

  await prisma.tripCollaborator.updateMany({
    where: {
      email: session.user.email.toLowerCase(),
      status: "PENDING",
      userId: null,
    },
    data: {
      userId: session.user.id,
      status: "ACCEPTED",
    },
  })
}
