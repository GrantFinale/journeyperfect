import { auth } from "./auth"
import { prisma } from "./db"

export type TripAccessRole = "OWNER" | "VIEWER" | "EDITOR"

/**
 * Session-free access check, for callers that already know who the user is
 * (the MCP server authenticates with an API key, not a NextAuth session).
 * Throws the same errors as `requireTripAccess` so the two stay interchangeable.
 */
export async function requireTripAccessForUser(
  userId: string,
  tripId: string,
  requiredRole: "VIEWER" | "EDITOR" = "VIEWER"
) {
  // Check if owner
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId },
  })
  if (trip) return { trip, role: "OWNER" as const, userId }

  // Check if collaborator
  const collab = await prisma.tripCollaborator.findFirst({
    where: {
      tripId,
      userId,
      status: "ACCEPTED",
    },
  })
  if (!collab) throw new Error("Trip not found")

  if (requiredRole === "EDITOR" && collab.role === "VIEWER") {
    throw new Error("You don't have edit access to this trip")
  }

  const collabTrip = await prisma.trip.findUnique({ where: { id: tripId } })
  if (!collabTrip) throw new Error("Trip not found")

  return { trip: collabTrip, role: collab.role, userId }
}

/** Boolean form of `requireTripAccessForUser`: never throws. */
export async function userHasTripAccess(
  userId: string,
  tripId: string,
  requiredRole: "VIEWER" | "EDITOR" = "VIEWER"
): Promise<boolean> {
  try {
    await requireTripAccessForUser(userId, tripId, requiredRole)
    return true
  } catch {
    return false
  }
}

export async function requireTripAccess(tripId: string, requiredRole: "VIEWER" | "EDITOR" = "VIEWER") {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")
  return requireTripAccessForUser(session.user.id, tripId, requiredRole)
}
