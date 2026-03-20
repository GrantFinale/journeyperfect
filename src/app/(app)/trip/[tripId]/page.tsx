import { notFound } from "next/navigation"
import Link from "next/link"
import { getTrip } from "@/lib/actions/trips"
import { getBudgetSummary } from "@/lib/actions/budget"
import { getItinerary, type ItineraryItemFull } from "@/lib/actions/itinerary"
import { getTripAffiliates } from "@/lib/actions/affiliates"
import { formatDate, formatTime, tripDuration, formatCurrency } from "@/lib/utils"
import { AffiliateBar } from "@/components/affiliate-links"
import {
  Plane,
  Hotel,
  CalendarDays,
  DollarSign,
  Star,
  FileText,
  Settings,
  ChevronRight,
  MapPin,
  Clock,
  Map,
  ArrowRight,
} from "lucide-react"

export default async function TripOverviewPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params

  let trip: Awaited<ReturnType<typeof getTrip>>
  let budget: Awaited<ReturnType<typeof getBudgetSummary>>
  let allItems: ItineraryItemFull[] = []
  let affiliateLinks: Awaited<ReturnType<typeof getTripAffiliates>> = []

  try {
    ;[trip, budget, allItems, affiliateLinks] = await Promise.all([
      getTrip(tripId),
      getBudgetSummary(tripId),
      getItinerary(tripId),
      getTripAffiliates(tripId),
    ])
  } catch {
    notFound()
  }

  // Next 3 upcoming itinerary items (date >= today)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const nextUpItems = allItems
    .filter((item) => new Date(item.date) >= today)
    .slice(0, 3)

  const duration = tripDuration(trip.startDate, trip.endDate)
  const daysUntil = Math.ceil(
    (new Date(trip.startDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  )

  const quickLinks = [
    {
      href: `/trip/${tripId}/itinerary`,
      icon: CalendarDays,
      label: "Itinerary",
      desc: `${trip._count.itineraryItems} items`,
    },
    {
      href: `/trip/${tripId}/activities`,
      icon: Star,
      label: "Activities",
      desc: `${trip._count.activities} saved`,
    },
    {
      href: `/trip/${tripId}/budget`,
      icon: DollarSign,
      label: "Budget",
      desc: formatCurrency(budget.total),
    },
    { href: `/trip/${tripId}/documents`, icon: FileText, label: "Documents", desc: "Travel docs" },
    {
      href: `/trip/${tripId}/settings`,
      icon: Settings,
      label: "Trip Settings",
      desc: "Hotels, flights & travelers",
    },
  ]

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{trip.title}</h1>
          <div className="flex items-center gap-3 mt-2 text-sm text-gray-500">
            <span className="flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" />
              {trip.destination}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {duration} days
            </span>
            <span className="flex items-center gap-1">
              <Map className="w-3.5 h-3.5" />
              {formatDate(trip.startDate, "MMM d")} – {formatDate(trip.endDate, "MMM d, yyyy")}
            </span>
          </div>
        </div>
        <Link
          href={`/trip/${tripId}/settings`}
          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <Settings className="w-5 h-5" />
        </Link>
      </div>

      {/* Countdown or status banner */}
      {daysUntil > 0 && (
        <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-5 mb-6">
          <div className="text-center">
            <div className="text-3xl font-bold text-indigo-700">{daysUntil}</div>
            <div className="text-sm text-indigo-600">days until departure</div>
            <div className="text-xs text-indigo-500 mt-1">
              {formatDate(trip.startDate, "EEEE, MMMM d, yyyy")}
            </div>
          </div>
        </div>
      )}
      {daysUntil <= 0 && daysUntil >= -duration && (
        <div className="bg-green-50 border border-green-100 rounded-2xl p-5 mb-6 text-center">
          <div className="text-green-700 font-semibold">🎉 You&apos;re on your trip!</div>
          <div className="text-green-600 text-sm mt-1">
            {trip.destination} · Day {Math.abs(daysUntil) + 1} of {duration}
          </div>
        </div>
      )}

      {/* Next Up */}
      {nextUpItems.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">Next Up</h2>
            <Link
              href={`/trip/${tripId}/itinerary`}
              className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-medium"
            >
              View itinerary
              <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="space-y-2">
            {nextUpItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 bg-gray-50 rounded-xl px-3.5 py-2.5"
              >
                <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                  <CalendarDays className="w-4 h-4 text-indigo-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900 text-sm truncate">{item.title}</div>
                  <div className="text-xs text-gray-500">
                    {formatDate(item.date, "EEE, MMM d")}
                    {item.startTime && <> at {formatTime(item.startTime)}</>}
                    {item.durationMins > 0 && <> &middot; {item.durationMins} min</>}
                  </div>
                </div>
                <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide shrink-0">
                  {item.type.replace(/_/g, " ")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Flight/Hotel summary cards */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-white border border-gray-100 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Plane className="w-4 h-4 text-indigo-500" />
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Flights</span>
          </div>
          <div className="text-2xl font-bold text-gray-900">{trip.flights.length}</div>
          {trip.flights.length > 0 ? (
            <div className="text-xs text-gray-500 mt-1 truncate">
              {trip.flights[0].departureAirport} → {trip.flights[0].arrivalAirport}
            </div>
          ) : (
            <Link
              href={`/trip/${tripId}/settings`}
              className="text-xs text-indigo-500 hover:underline"
            >
              Add flights
            </Link>
          )}
        </div>
        <div className="bg-white border border-gray-100 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Hotel className="w-4 h-4 text-purple-500" />
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Hotels</span>
          </div>
          <div className="text-2xl font-bold text-gray-900">{trip.hotels.length}</div>
          {trip.hotels.length > 0 ? (
            <div className="text-xs text-gray-500 mt-1 truncate">{trip.hotels[0].name}</div>
          ) : (
            <Link
              href={`/trip/${tripId}/settings`}
              className="text-xs text-indigo-500 hover:underline"
            >
              Add hotels
            </Link>
          )}
        </div>
      </div>

      {/* Affiliate booking links */}
      {affiliateLinks.length > 0 && (
        <div className="mb-6">
          <AffiliateBar links={affiliateLinks} />
        </div>
      )}

      {/* Quick navigation */}
      <div className="space-y-2">
        {quickLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="flex items-center gap-4 bg-white border border-gray-100 rounded-2xl p-4 hover:border-indigo-200 hover:shadow-sm transition-all group"
          >
            <div className="w-9 h-9 bg-gray-50 rounded-xl flex items-center justify-center group-hover:bg-indigo-50 transition-colors">
              <link.icon className="w-4 h-4 text-gray-600 group-hover:text-indigo-600 transition-colors" />
            </div>
            <div className="flex-1">
              <div className="font-medium text-gray-900 text-sm">{link.label}</div>
              <div className="text-xs text-gray-500">{link.desc}</div>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-indigo-500 transition-colors" />
          </Link>
        ))}
      </div>

      {/* Travelers */}
      {trip.travelers.length > 0 && (
        <div className="mt-6 bg-white border border-gray-100 rounded-2xl p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Travelers</h3>
          <div className="flex flex-wrap gap-2">
            {trip.travelers.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 rounded-full text-xs text-gray-700"
              >
                <span>👤</span>
                {t.traveler.name}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
