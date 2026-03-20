import { auth } from "./auth"
import { prisma } from "./db"

export async function requireTripAccess(tripId: string, requiredRole: "VIEWER" | "EDITOR" = "VIEWER") {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  // Check if owner
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId: session.user.id },
  })
  if (trip) return { trip, role: "OWNER" as const, userId: session.user.id }

  // Check if collaborator
  const collab = await prisma.tripCollaborator.findFirst({
    where: {
      tripId,
      userId: session.user.id,
      status: "ACCEPTED",
    },
  })
  if (!collab) throw new Error("Trip not found")

  if (requiredRole === "EDITOR" && collab.role === "VIEWER") {
    throw new Error("You don't have edit access to this trip")
  }

  const collabTrip = await prisma.trip.findUnique({ where: { id: tripId } })
  if (!collabTrip) throw new Error("Trip not found")

  return { trip: collabTrip, role: collab.role, userId: session.user.id }
}
