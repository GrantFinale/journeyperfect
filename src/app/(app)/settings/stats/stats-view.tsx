"use client"

import Link from "next/link"
import type { TravelStats } from "@/lib/actions/travel-stats"
import {
  Plane,
  Hotel,
  MapPin,
  Star,
  Calendar,
  TrendingUp,
  Globe,
  Clock,
  BarChart3,
} from "lucide-react"

function formatNumber(n: number): string {
  return n.toLocaleString()
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function statusColor(status: string): string {
  switch (status) {
    case "PLANNING":
      return "bg-blue-100 text-blue-700"
    case "ACTIVE":
      return "bg-green-100 text-green-700"
    case "COMPLETED":
      return "bg-gray-100 text-gray-700"
    case "ARCHIVED":
      return "bg-gray-50 text-gray-500"
    default:
      return "bg-gray-100 text-gray-600"
  }
}

export function StatsView({ stats }: { stats: TravelStats }) {
  const maxAirlineCount = stats.topAirlines.length > 0 ? stats.topAirlines[0].count : 1

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Travel Statistics</h1>
        <p className="text-gray-500 text-sm mt-0.5">Your travel journey at a glance</p>
      </div>

      {stats.totalTrips === 0 ? (
        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-12 text-center">
          <Globe className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">
            No trips yet. Create your first trip to start tracking your travel stats!
          </p>
          <Link
            href="/dashboard"
            className="inline-block mt-4 px-4 py-2 bg-indigo-600 text-white text-sm rounded-xl hover:bg-indigo-700 transition-colors"
          >
            Go to Dashboard
          </Link>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            <div className="bg-white border border-gray-100 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Globe className="w-4 h-4 text-indigo-500" />
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Trips</span>
              </div>
              <div className="text-2xl font-bold text-gray-900">{stats.totalTrips}</div>
            </div>
            <div className="bg-white border border-gray-100 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <MapPin className="w-4 h-4 text-emerald-500" />
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Cities</span>
              </div>
              <div className="text-2xl font-bold text-gray-900">{stats.totalCities}</div>
            </div>
            <div className="bg-white border border-gray-100 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Plane className="w-4 h-4 text-blue-500" />
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Flights</span>
              </div>
              <div className="text-2xl font-bold text-gray-900">{stats.totalFlights}</div>
            </div>
            <div className="bg-white border border-gray-100 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Hotel className="w-4 h-4 text-purple-500" />
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Hotel Nights</span>
              </div>
              <div className="text-2xl font-bold text-gray-900">{stats.totalHotelNights}</div>
            </div>
          </div>

          {/* More stats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            <div className="bg-white border border-gray-100 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Star className="w-4 h-4 text-amber-500" />
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Activities</span>
              </div>
              <div className="text-2xl font-bold text-gray-900">{stats.totalActivities}</div>
            </div>
            <div className="bg-white border border-gray-100 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-cyan-500" />
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Avg Trip</span>
              </div>
              <div className="text-2xl font-bold text-gray-900">{stats.avgTripDuration} days</div>
            </div>
            <div className="bg-white border border-gray-100 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-rose-500" />
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Distance Flown</span>
              </div>
              <div className="text-2xl font-bold text-gray-900">{formatNumber(stats.totalDistanceKm)} km</div>
            </div>
          </div>

          {/* Fun facts */}
          {stats.totalDistanceKm > 0 && (
            <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-5 mb-8">
              <h2 className="text-sm font-semibold text-indigo-700 mb-3">Fun Facts</h2>
              <div className="space-y-2 text-sm text-indigo-800">
                {stats.funFacts.earthCircumferences >= 0.1 && (
                  <p>
                    You&apos;ve flown far enough to circle the Earth{" "}
                    <span className="font-bold">{stats.funFacts.earthCircumferences}x</span>
                  </p>
                )}
                {stats.funFacts.moonDistance > 0 && (
                  <p>
                    That&apos;s <span className="font-bold">{stats.funFacts.moonDistance}%</span> of the way to the Moon!
                  </p>
                )}
                {stats.mostVisitedCity && (
                  <p>
                    Your most visited destination is{" "}
                    <span className="font-bold">{stats.mostVisitedCity}</span>
                  </p>
                )}
                {stats.longestTrip && (
                  <p>
                    Longest trip: <span className="font-bold">{stats.longestTrip.title}</span> ({stats.longestTrip.days} days)
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Trips by Status */}
          {stats.tripsByStatus.length > 0 && (
            <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-8">
              <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Trips by Status
              </h2>
              <div className="flex flex-wrap gap-2">
                {stats.tripsByStatus.map((s) => (
                  <span
                    key={s.status}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium ${statusColor(s.status)}`}
                  >
                    {s.status.charAt(0) + s.status.slice(1).toLowerCase()}: {s.count}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Passport - Cities Visited */}
          {stats.citiesVisited.length > 0 && (
            <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-8">
              <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <MapPin className="w-4 h-4" />
                Your Passport
              </h2>
              <div className="flex flex-wrap gap-2">
                {stats.citiesVisited.map((city) => (
                  <span
                    key={city}
                    className="px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-full text-xs text-gray-700 font-medium"
                  >
                    {city}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Top Airlines */}
          {stats.topAirlines.length > 0 && (
            <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-8">
              <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                Top Airlines
              </h2>
              <div className="space-y-2">
                {stats.topAirlines.map((a) => (
                  <div key={a.airline} className="flex items-center gap-3">
                    <span className="text-xs text-gray-600 w-28 truncate shrink-0">{a.airline}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 rounded-full flex items-center justify-end pr-2 transition-all"
                        style={{ width: `${Math.max(20, (a.count / maxAirlineCount) * 100)}%` }}
                      >
                        <span className="text-[10px] font-bold text-white">{a.count}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Trip Timeline */}
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Trip Timeline
            </h2>
            <div className="space-y-3">
              {stats.tripTimeline.map((trip) => (
                <Link
                  key={trip.id}
                  href={`/trip/${trip.id}`}
                  className="flex items-center gap-4 p-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 text-sm truncate group-hover:text-indigo-600 transition-colors">
                      {trip.title}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {trip.destination} &middot; {formatDate(trip.startDate)} - {formatDate(trip.endDate)}
                    </div>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide shrink-0 ${statusColor(trip.status)}`}
                  >
                    {trip.status.toLowerCase()}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
