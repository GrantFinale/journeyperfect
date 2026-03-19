import { notFound } from "next/navigation"
import { getTripBySlug } from "@/lib/actions/trips"
import { formatDate, tripDuration } from "@/lib/utils"
import Link from "next/link"

export default async function SharedTripPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const trip = await getTripBySlug(slug)

  if (!trip) notFound()

  const duration = tripDuration(trip.startDate, trip.endDate)

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      <div className="max-w-2xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-white rounded-full text-xs text-gray-500 shadow-sm border border-gray-100 mb-6">
            <div className="w-4 h-4 rounded bg-indigo-600 flex items-center justify-center text-white font-bold text-[8px]">
              JP
            </div>
            Shared via JourneyPerfect
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">{trip.title}</h1>
          <p className="text-gray-600">
            {trip.destination} · {formatDate(trip.startDate, "MMM d")} –{" "}
            {formatDate(trip.endDate, "MMM d, yyyy")} · {duration} days
          </p>
        </div>

        {/* Travelers */}
        {trip.travelers.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-4 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Travelers</h2>
            <div className="flex flex-wrap gap-2">
              {trip.travelers.map((t) => (
                <span key={t.id} className="px-3 py-1 bg-gray-50 rounded-full text-sm text-gray-700">
                  {t.traveler.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Flights */}
        {trip.flights.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-4 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">✈️ Flights</h2>
            {trip.flights.map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-3 py-2 border-b last:border-0 border-gray-50"
              >
                <span className="font-mono text-sm text-gray-500">{f.flightNumber}</span>
                <span className="font-medium text-gray-900">
                  {f.departureAirport} → {f.arrivalAirport}
                </span>
                <span className="text-xs text-gray-500 ml-auto">
                  {formatDate(f.departureTime, "MMM d")}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Hotels */}
        {trip.hotels.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-4 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">🏨 Accommodations</h2>
            {trip.hotels.map((h) => (
              <div key={h.id} className="py-2 border-b last:border-0 border-gray-50">
                <div className="font-medium text-gray-900">{h.name}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  Check in {formatDate(h.checkIn, "MMM d")} · Check out{" "}
                  {formatDate(h.checkOut, "MMM d")}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Itinerary highlights */}
        {trip.itineraryItems.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-4 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">📅 Itinerary</h2>
            <div className="space-y-2">
              {trip.itineraryItems.slice(0, 10).map((item) => (
                <div key={item.id} className="flex items-center gap-3 text-sm">
                  <span className="text-gray-400 w-14 shrink-0 text-xs">{item.startTime || "–"}</span>
                  <span className="text-gray-900">{item.title}</span>
                </div>
              ))}
              {trip.itineraryItems.length > 10 && (
                <p className="text-xs text-gray-400 pt-1">
                  +{trip.itineraryItems.length - 10} more items
                </p>
              )}
            </div>
          </div>
        )}

        {/* Activities */}
        {trip.activities.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-4 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">⭐ Scheduled Activities</h2>
            <div className="space-y-1">
              {trip.activities.map((a) => (
                <div key={a.id} className="text-sm text-gray-800 py-1">
                  {a.name}
                  {a.address && (
                    <span className="text-xs text-gray-400 ml-2">{a.address}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CTA */}
        <div className="text-center mt-8">
          <p className="text-sm text-gray-500 mb-4">Want to plan your own trip like this?</p>
          <Link
            href="/"
            className="inline-block px-6 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 transition-colors text-sm"
          >
            Plan your trip with JourneyPerfect →
          </Link>
        </div>
      </div>
    </div>
  )
}
