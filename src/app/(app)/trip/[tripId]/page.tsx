import { notFound } from "next/navigation"
import Link from "next/link"
import { auth } from "@/lib/auth"
import { getTrip } from "@/lib/actions/trips"
import { getBudgetSummary } from "@/lib/actions/budget"
import { getTripCostSummary } from "@/lib/actions/costs"
import { getItinerary, type ItineraryItemFull } from "@/lib/actions/itinerary"
import { getSmartSuggestions } from "@/lib/actions/affiliates"
import { getPlacesApiKey } from "@/lib/actions/user"
import { getUserTimezone } from "@/lib/actions/preferences"
import { checkWeatherConflicts } from "@/lib/actions/weather-prompts"
import { formatDate, formatDateInTimezone, formatTime, tripDuration, formatCurrency } from "@/lib/utils"
import { AffiliateSmartSuggestions, BookingReturnPrompt } from "@/components/affiliate-links"
import { ForwardingEmail } from "@/components/forwarding-email"
import { CalendarExportButton } from "@/components/calendar-export"
import { WeatherReschedulePrompt } from "@/components/weather-reschedule-prompt"
import { TripOverviewMap } from "./overview-map"
import {
  Plane,
  Hotel,
  Car,
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
  Package,
  Navigation,
} from "lucide-react"

export default async function TripOverviewPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params

  let trip: Awaited<ReturnType<typeof getTrip>>
  let budget: Awaited<ReturnType<typeof getBudgetSummary>>
  let costSummary: Awaited<ReturnType<typeof getTripCostSummary>>
  let allItems: ItineraryItemFull[] = []
  let smartSuggestions: Awaited<ReturnType<typeof getSmartSuggestions>> = []
  let weatherConflicts: Awaited<ReturnType<typeof checkWeatherConflicts>> = []

  let apiKey = ""
  let userTimezone = "America/New_York"
  const session = await auth()

  try {
    ;[trip, budget, costSummary, allItems, smartSuggestions, apiKey, userTimezone, weatherConflicts] = await Promise.all([
      getTrip(tripId),
      getBudgetSummary(tripId),
      getTripCostSummary(tripId),
      getItinerary(tripId),
      getSmartSuggestions(tripId),
      getPlacesApiKey(),
      getUserTimezone(),
      checkWeatherConflicts(tripId),
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
  // Calculate days until trip using date-only comparison (no timezone drift)
  // Use user's timezone preference (falls back to America/New_York; "AUTO" resolved client-side)
  const effectiveTimezone = userTimezone === "AUTO" ? "America/New_York" : userTimezone
  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: effectiveTimezone }) // YYYY-MM-DD
  const todayMidnight = new Date(todayStr + "T00:00:00")
  const startMidnight = new Date(trip.startDate + "T00:00:00")
  const daysUntil = Math.round(
    (startMidnight.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24)
  )

  // Build map markers from activities and hotels
  const mapMarkers: { lat: number; lng: number; label: string; type: "activity" | "hotel" | "flight" | "restaurant" | "transit"; day?: number }[] = []
  const tripStart = new Date(trip.startDate)

  for (const hotel of trip.hotels) {
    if (hotel.lat && hotel.lng) {
      mapMarkers.push({ lat: hotel.lat, lng: hotel.lng, label: hotel.name, type: "hotel" })
    }
  }

  for (const item of allItems) {
    const it = item as any
    if (it.activity?.lat && it.activity?.lng) {
      const dayIdx = Math.floor((new Date(it.date).getTime() - tripStart.getTime()) / (1000 * 60 * 60 * 24))
      mapMarkers.push({
        lat: it.activity.lat,
        lng: it.activity.lng,
        label: it.title,
        type: it.type === "MEAL" ? "restaurant" : "activity",
        day: dayIdx,
      })
    }
  }

  const quickLinks = [
    {
      href: `/trip/${tripId}/itinerary`,
      icon: CalendarDays,
      label: "Itinerary",
      desc: `${trip._count.itineraryItems} items`,
    },
    {
      href: `/trip/${tripId}/map`,
      icon: Navigation,
      label: "Map",
      desc: `${mapMarkers.length} locations`,
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
    { href: `/trip/${tripId}/packing`, icon: Package, label: "Packing", desc: "Packing checklist" },
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
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900">{trip.title}</h1>
          <div className="flex items-center gap-3 mt-2 text-sm text-gray-500 flex-wrap">
            <span className="flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{trip.destination}</span>
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              {duration} days
            </span>
            <span className="flex items-center gap-1">
              <Map className="w-3.5 h-3.5 shrink-0" />
              {formatDate(trip.startDate, "MMM d")} – {formatDate(trip.endDate, "MMM d, yyyy")}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <CalendarExportButton tripId={tripId} />
          <Link
            href={`/trip/${tripId}/settings`}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <Settings className="w-5 h-5" />
          </Link>
        </div>
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
          <div className="text-green-700 font-semibold">You&apos;re on your trip!</div>
          <div className="text-green-600 text-sm mt-1">
            {trip.destination} · Day {Math.abs(daysUntil) + 1} of {duration}
          </div>
        </div>
      )}

      {/* Weather rescheduling prompts */}
      {weatherConflicts.length > 0 && (
        <WeatherReschedulePrompt tripId={tripId} suggestions={weatherConflicts} />
      )}

      {/* Forwarding email */}
      {session?.user?.id && (
        <div className="mb-6">
          <ForwardingEmail userId={session.user.id} variant="card" />
        </div>
      )}

      {/* Next Up */}
      {nextUpItems.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">Next Up</h2>
            <Link
              href={`/trip/${tripId}/itinerary`}
              className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-medium p-2 -m-2"
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
                <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide shrink-0 hidden sm:block">
                  {item.type.replace(/_/g, " ")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Flight/Hotel/Car summary cards - each tile is fully clickable */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Link
          href={`/trip/${tripId}/settings?tab=flights`}
          className="bg-white border border-gray-100 rounded-2xl p-4 hover:border-indigo-200 hover:shadow-sm transition-all group block"
        >
          <div className="flex items-center gap-2 mb-2">
            <Plane className="w-4 h-4 text-indigo-500" />
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide flex-1">Flights</span>
            <ChevronRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-indigo-500 transition-colors" />
          </div>
          {trip.flights.length > 0 ? (
            <div className="space-y-1.5 mt-1">
              {trip.flights.map((flight) => (
                <div
                  key={flight.id}
                  className="text-xs text-gray-700 truncate"
                >
                  {[flight.airline, flight.flightNumber].filter(Boolean).join(" ") || "Flight"}{" "}
                  {flight.departureAirport && flight.arrivalAirport
                    ? `${flight.departureAirport}\u2192${flight.arrivalAirport}`
                    : ""}{" "}
                  <span className="text-gray-400">
                    {formatDateInTimezone(flight.departureTime, "MMM d", flight.departureTimezone || undefined)}
                  </span>
                </div>
              ))}
              <span className="text-xs text-indigo-500 inline-block mt-1">
                {trip.flights.length} flight{trip.flights.length !== 1 ? "s" : ""}
              </span>
            </div>
          ) : (
            <span className="text-xs text-indigo-500 inline-block">
              Add flights
            </span>
          )}
        </Link>
        <Link
          href={`/trip/${tripId}/settings?tab=hotels`}
          className="bg-white border border-gray-100 rounded-2xl p-4 hover:border-indigo-200 hover:shadow-sm transition-all group block"
        >
          <div className="flex items-center gap-2 mb-2">
            <Hotel className="w-4 h-4 text-purple-500" />
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide flex-1">Hotels</span>
            <ChevronRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-indigo-500 transition-colors" />
          </div>
          {trip.hotels.length > 0 ? (
            <div className="space-y-1.5 mt-1">
              {trip.hotels.map((hotel) => (
                <div
                  key={hotel.id}
                  className="text-xs text-gray-700 truncate"
                >
                  {hotel.name}{" "}
                  <span className="text-gray-400">
                    {formatDate(hotel.checkIn, "MMM d")}&ndash;{formatDate(hotel.checkOut, "MMM d")}
                  </span>
                </div>
              ))}
              <span className="text-xs text-indigo-500 inline-block mt-1">
                {trip.hotels.length} hotel{trip.hotels.length !== 1 ? "s" : ""}
              </span>
            </div>
          ) : (
            <span className="text-xs text-indigo-500 inline-block">
              Add hotels
            </span>
          )}
        </Link>
        <Link
          href={`/trip/${tripId}/settings?tab=cars`}
          className="bg-white border border-gray-100 rounded-2xl p-4 hover:border-indigo-200 hover:shadow-sm transition-all group block"
        >
          <div className="flex items-center gap-2 mb-2">
            <Car className="w-4 h-4 text-green-600" />
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide flex-1">Rental Cars</span>
            <ChevronRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-indigo-500 transition-colors" />
          </div>
          {trip.rentalCars.length > 0 ? (
            <div className="space-y-1.5 mt-1">
              {trip.rentalCars.map((car) => (
                <div
                  key={car.id}
                  className="text-xs text-gray-700 truncate"
                >
                  {car.company || car.vehicleType || "Rental Car"}{" "}
                  <span className="text-gray-400">
                    {formatDate(car.pickupTime, "MMM d")}&ndash;{formatDate(car.dropoffTime, "MMM d")}
                  </span>
                </div>
              ))}
              <span className="text-xs text-indigo-500 inline-block mt-1">
                {trip.rentalCars.length} rental{trip.rentalCars.length !== 1 ? "s" : ""}
              </span>
            </div>
          ) : (
            <span className="text-xs text-indigo-500 inline-block">
              Add rental car
            </span>
          )}
        </Link>
      </div>

      {/* Trip Cost Summary — clickable to budget page */}
      {costSummary.grandTotal > 0 && (
        <Link href={`/trip/${tripId}/budget`} className="block bg-white border border-gray-100 rounded-2xl p-5 mb-6 hover:border-indigo-200 hover:shadow-sm transition-all group">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-green-600" />
              <h2 className="text-sm font-semibold text-gray-700">Trip Cost Estimate</h2>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-indigo-500 transition-colors" />
          </div>
          <div className="text-2xl font-bold text-gray-900 mb-3">
            {formatCurrency(costSummary.grandTotal)}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {costSummary.flights > 0 && (
              <div className="flex items-center gap-2 bg-blue-50 rounded-xl px-3 py-2">
                <Plane className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span className="text-xs text-blue-800">Flights</span>
                <span className="text-xs font-semibold text-blue-900 ml-auto">{formatCurrency(costSummary.flights)}</span>
              </div>
            )}
            {costSummary.hotels > 0 && (
              <div className="flex items-center gap-2 bg-purple-50 rounded-xl px-3 py-2">
                <Hotel className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                <span className="text-xs text-purple-800">Hotels</span>
                <span className="text-xs font-semibold text-purple-900 ml-auto">{formatCurrency(costSummary.hotels)}</span>
              </div>
            )}
            {costSummary.activities > 0 && (
              <div className="flex items-center gap-2 bg-amber-50 rounded-xl px-3 py-2">
                <Star className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span className="text-xs text-amber-800">Activities</span>
                <span className="text-xs font-semibold text-amber-900 ml-auto">{formatCurrency(costSummary.activities)}</span>
              </div>
            )}
          </div>
        </Link>
      )}

      {/* Booking return prompt (shown when user returns from affiliate click) */}
      <div className="mb-4">
        <BookingReturnPrompt tripId={tripId} />
      </div>

      {/* Contextual suggestions */}
      {smartSuggestions.length > 0 && (
        <div className="mb-6">
          <AffiliateSmartSuggestions suggestions={smartSuggestions} tripId={tripId} />
        </div>
      )}

      {/* Trip Map Preview */}
      {mapMarkers.length > 0 && apiKey && (
        <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Navigation className="w-4 h-4 text-indigo-500" />
              Trip Map
            </h2>
            <Link
              href={`/trip/${tripId}/map`}
              className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-medium p-2 -m-2"
            >
              Full map
              <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <TripOverviewMap
            markers={mapMarkers}
            apiKey={apiKey}
            center={
              trip.destinationLat && trip.destinationLng
                ? { lat: trip.destinationLat, lng: trip.destinationLng }
                : undefined
            }
          />
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
            <div className="w-9 h-9 bg-gray-50 rounded-xl flex items-center justify-center group-hover:bg-indigo-50 transition-colors shrink-0">
              <link.icon className="w-4 h-4 text-gray-600 group-hover:text-indigo-600 transition-colors" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-gray-900 text-sm">{link.label}</div>
              <div className="text-xs text-gray-500">{link.desc}</div>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-indigo-500 transition-colors shrink-0" />
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
