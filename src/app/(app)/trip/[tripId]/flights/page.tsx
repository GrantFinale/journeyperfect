import { notFound } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Lock, Plane } from "lucide-react"
import { prisma } from "@/lib/db"
import { requireTripAccess } from "@/lib/auth-trip"
import { getUpgradeMessage, hasFeature } from "@/lib/features"
import { getFlightSearchesForTrip, suggestTripFlightQuery } from "@/lib/actions/flight-search"
import type { FlightSearchSummary } from "@/lib/flights/views"
import type { FlightQuery } from "@/lib/flights/types"
import { FlightsView } from "./flights-view"

export default async function FlightsPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params

  let access: Awaited<ReturnType<typeof requireTripAccess>>
  try {
    access = await requireTripAccess(tripId)
  } catch {
    notFound()
  }
  const { trip, userId } = access

  const [user, counts] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { plan: true } }),
    prisma.trip.findUnique({
      where: { id: tripId },
      select: { _count: { select: { flights: true, travelers: true } } },
    }),
  ])
  const plan = user?.plan ?? "FREE"

  if (!hasFeature(plan, "flightSearch")) {
    return <UpgradeGate tripId={tripId} message={getUpgradeMessage("flightSearch")} />
  }

  // Neither of these should take the page down: no saved searches and no
  // suggestion just means an empty form.
  const [searches, suggested] = await Promise.all([
    getFlightSearchesForTrip(tripId).catch((): FlightSearchSummary[] => []),
    suggestTripFlightQuery(tripId).catch((): FlightQuery | null => null),
  ])

  return (
    <FlightsView
      tripId={tripId}
      trip={{
        destination: trip.destination,
        startDate: trip.startDate.toISOString().split("T")[0],
        endDate: trip.endDate.toISOString().split("T")[0],
        travelerCount: counts?._count.travelers ?? 0,
      }}
      initialSearches={searches}
      suggestedQuery={suggested}
      canTrack={hasFeature(plan, "flightPriceTracking")}
      flightCount={counts?._count.flights ?? 0}
    />
  )
}

function UpgradeGate({ tripId, message }: { tripId: string; message: string }) {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 md:py-8">
      <Link
        href={`/trip/${tripId}`}
        className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 mb-6"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to overview
      </Link>
      <div className="bg-white border border-gray-100 rounded-2xl px-6 py-14 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-indigo-50 mb-4">
          <Lock className="w-8 h-8 text-indigo-300" aria-hidden="true" />
        </div>
        <h1 className="text-lg font-semibold text-gray-900 mb-1 flex items-center justify-center gap-2">
          <Plane className="w-4 h-4 text-indigo-500" aria-hidden="true" />
          Flight search
        </h1>
        <p className="text-gray-500 text-sm mb-1 max-w-sm mx-auto">
          Compare fares across airlines, watch a route for price drops, and add the flight you book straight to your plan.
        </p>
        <p className="text-gray-400 text-xs mb-6 max-w-sm mx-auto">{message}</p>
        <Link
          href="/settings/billing"
          className="inline-block px-6 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition-colors"
        >
          Upgrade to unlock
        </Link>
        <p className="mt-4 text-xs text-gray-400">
          Already booked?{" "}
          <Link href={`/trip/${tripId}/settings?tab=travel`} className="text-indigo-600 hover:underline font-medium">
            Add your flights in Trip Settings
          </Link>
        </p>
      </div>
    </div>
  )
}
