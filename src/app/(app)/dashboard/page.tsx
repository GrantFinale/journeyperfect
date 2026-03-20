import Link from "next/link"
import { auth } from "@/lib/auth"
import { getTrips } from "@/lib/actions/trips"
import { getCollaborativeTrips } from "@/lib/actions/collaborators"
import { Plus, MapPin, Calendar, ChevronRight, Plane, Users, Eye, Pencil } from "lucide-react"
import { formatDate, tripDuration } from "@/lib/utils"
import { ForwardingEmail } from "@/components/forwarding-email"

export default async function DashboardPage() {
  const session = await auth()
  const [trips, sharedTrips] = await Promise.all([getTrips(), getCollaborativeTrips()])

  const now = new Date()
  const activeTrips = trips.filter(
    (t) => t.status === "ACTIVE" || (new Date(t.startDate) <= now && new Date(t.endDate) >= now)
  )
  const upcomingTrips = trips.filter((t) => new Date(t.startDate) > now && t.status !== "ACTIVE")
  const pastTrips = trips.filter((t) => new Date(t.endDate) < now && t.status !== "ACTIVE")

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {session?.user?.name ? `Hi, ${session.user.name.split(" ")[0]} 👋` : "My Trips"}
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {trips.length === 0
              ? "Plan your first adventure"
              : `${trips.length} trip${trips.length !== 1 ? "s" : ""} planned`}
          </p>
        </div>
        <Link
          href="/trip/new"
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New trip
        </Link>
      </div>

      {/* Forwarding email hint */}
      {session?.user?.id && trips.length > 0 && (
        <div className="mb-6">
          <ForwardingEmail userId={session.user.id} variant="compact" />
        </div>
      )}

      {/* Empty state */}
      {trips.length === 0 && (
        <div className="text-center py-20">
          <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Plane className="w-8 h-8 text-indigo-600" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">No trips yet</h2>
          <p className="text-gray-500 mb-6">Create your first trip to get started</p>
          <Link
            href="/trip/new"
            className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Plan a trip
          </Link>
        </div>
      )}

      {/* Active trips */}
      {activeTrips.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Happening now
          </h2>
          <div className="space-y-3">
            {activeTrips.map((trip) => (
              <TripCard key={trip.id} trip={trip} active />
            ))}
          </div>
        </section>
      )}

      {/* Upcoming trips */}
      {upcomingTrips.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Upcoming</h2>
          <div className="space-y-3">
            {upcomingTrips.map((trip) => (
              <TripCard key={trip.id} trip={trip} />
            ))}
          </div>
        </section>
      )}

      {/* Past trips */}
      {pastTrips.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Past trips</h2>
          <div className="space-y-3">
            {pastTrips.map((trip) => (
              <TripCard key={trip.id} trip={trip} past />
            ))}
          </div>
        </section>
      )}

      {/* Shared with you */}
      {sharedTrips.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            <span className="flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" />
              Shared with you
            </span>
          </h2>
          <div className="space-y-3">
            {sharedTrips.map((trip) => (
              <SharedTripCard key={trip.id} trip={trip} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function TripCard({
  trip,
  active,
  past,
}: {
  trip: Awaited<ReturnType<typeof getTrips>>[0]
  active?: boolean
  past?: boolean
}) {
  const duration = tripDuration(trip.startDate, trip.endDate)
  return (
    <Link
      href={`/trip/${trip.id}`}
      className="block bg-white border border-gray-100 rounded-2xl p-5 hover:border-indigo-200 hover:shadow-sm transition-all group"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {active && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-50 text-green-700 text-xs font-medium rounded-full">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                Active
              </span>
            )}
            {past && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 text-gray-500 text-xs font-medium rounded-full">
                Completed
              </span>
            )}
            <h3 className="font-semibold text-gray-900 truncate">{trip.title}</h3>
          </div>
          <div className="flex items-center gap-3 text-sm text-gray-500">
            <span className="flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" />
              {trip.destination}
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              {formatDate(trip.startDate, "MMM d")} – {formatDate(trip.endDate, "MMM d, yyyy")}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
            <span>
              {duration} day{duration !== 1 ? "s" : ""}
            </span>
            {trip._count.activities > 0 && <span>{trip._count.activities} activities</span>}
            {trip.travelers.length > 0 && (
              <span>
                {trip.travelers.length} traveler{trip.travelers.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-indigo-500 shrink-0 mt-1 transition-colors" />
      </div>
    </Link>
  )
}

function SharedTripCard({
  trip,
}: {
  trip: Awaited<ReturnType<typeof getCollaborativeTrips>>[0]
}) {
  const duration = tripDuration(trip.startDate, trip.endDate)
  return (
    <Link
      href={`/trip/${trip.id}`}
      className="block bg-white border border-gray-100 rounded-2xl p-5 hover:border-indigo-200 hover:shadow-sm transition-all group"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${
              trip.collaboratorRole === "EDITOR"
                ? "bg-green-50 text-green-700"
                : "bg-gray-100 text-gray-600"
            }`}>
              {trip.collaboratorRole === "EDITOR" ? <Pencil className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              {trip.collaboratorRole === "EDITOR" ? "Editor" : "Viewer"}
            </span>
            <h3 className="font-semibold text-gray-900 truncate">{trip.title}</h3>
          </div>
          <div className="flex items-center gap-3 text-sm text-gray-500">
            <span className="flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" />
              {trip.destination}
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              {formatDate(trip.startDate, "MMM d")} &ndash; {formatDate(trip.endDate, "MMM d, yyyy")}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
            {trip.user?.name && <span>by {trip.user.name}</span>}
            <span>
              {duration} day{duration !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-indigo-500 shrink-0 mt-1 transition-colors" />
      </div>
    </Link>
  )
}
