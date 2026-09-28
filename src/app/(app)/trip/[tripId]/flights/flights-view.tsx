"use client"

import { useMemo, useRef, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { format } from "date-fns"
import {
  AlertCircle,
  ArrowLeftRight,
  ArrowRight,
  BellRing,
  Info,
  Loader2,
  Plane,
  RefreshCw,
  Search,
  TrendingDown,
  TrendingUp,
} from "lucide-react"
import {
  getFlightSearch,
  getFlightSearchesForTrip,
  searchFlights,
} from "@/lib/actions/flight-search"
import type { FlightOfferView, FlightSearchSummary } from "@/lib/flights/views"
import type { CabinClass, FlightQuery, PriceInsight } from "@/lib/flights/types"
import { cn, formatCurrency } from "@/lib/utils"
import { AirportCombobox } from "./airport-combobox"
import { FlightOfferCard } from "./flight-offer-card"
import { PriceHistoryChart, type PricePoint } from "./price-history-chart"
import { TrackPriceButton } from "./track-price-button"

/* ─── Types ────────────────────────────────────────────────────────────────── */

interface Props {
  tripId: string
  trip: { destination: string; startDate: string; endDate: string; travelerCount: number }
  initialSearches: FlightSearchSummary[]
  suggestedQuery: FlightQuery | null
  /** Plan gate for tracking, resolved on the server. */
  canTrack: boolean
  /** Existing `Flight` rows on the trip. */
  flightCount: number
}

type FormState = {
  origin: string
  destination: string
  departDate: string
  returnDate: string
  roundTrip: boolean
  cabin: CabinClass
  adults: number
  children: number
}

type Results = {
  searchId: string
  offers: FlightOfferView[]
  insight?: PriceInsight
  fromCache: boolean
  retrievedAt: string | null
}

type SortKey = "price" | "duration" | "stops"

const CABINS: { value: CabinClass; label: string }[] = [
  { value: "economy", label: "Economy" },
  { value: "premium_economy", label: "Premium economy" },
  { value: "business", label: "Business" },
  { value: "first", label: "First" },
]

const SORTS: { key: SortKey; label: string }[] = [
  { key: "price", label: "Cheapest" },
  { key: "duration", label: "Fastest" },
  { key: "stops", label: "Fewest stops" },
]

const CURRENCY = "USD"

/* ─── Helpers ──────────────────────────────────────────────────────────────── */

function initialForm(suggested: FlightQuery | null, trip: Props["trip"]): FormState {
  return {
    origin: suggested?.origin ?? "",
    destination: suggested?.destination ?? "",
    departDate: suggested?.departDate ?? trip.startDate,
    returnDate: suggested?.returnDate ?? trip.endDate,
    roundTrip: suggested ? Boolean(suggested.returnDate) : true,
    cabin: suggested?.cabin ?? "economy",
    adults: suggested?.adults ?? Math.max(1, trip.travelerCount),
    children: suggested?.children ?? 0,
  }
}

function formFromSearch(s: FlightSearchSummary): FormState {
  const cabin = CABINS.some((c) => c.value === s.cabin) ? (s.cabin as CabinClass) : "economy"
  return {
    origin: s.origin,
    destination: s.destination,
    departDate: s.departDate,
    returnDate: s.returnDate ?? "",
    roundTrip: Boolean(s.returnDate),
    cabin,
    adults: s.adults,
    children: s.children,
  }
}

function toQuery(f: FormState): FlightQuery {
  return {
    origin: f.origin,
    destination: f.destination,
    departDate: f.departDate,
    returnDate: f.roundTrip && f.returnDate ? f.returnDate : undefined,
    cabin: f.cabin,
    adults: f.adults,
    children: f.children,
    currency: CURRENCY,
  }
}

function validate(f: FormState): string | null {
  if (!/^[A-Z]{3}$/.test(f.origin)) return "Pick a departure airport."
  if (!/^[A-Z]{3}$/.test(f.destination)) return "Pick an arrival airport."
  if (f.origin === f.destination) return "Departure and arrival airports need to differ."
  if (!f.departDate) return "Choose a departure date."
  if (f.roundTrip && !f.returnDate) return "Choose a return date, or switch to one way."
  if (f.roundTrip && f.returnDate < f.departDate) return "The return date is before the departure date."
  if (f.adults < 1) return "At least one adult is required."
  return null
}

function sortOffers(offers: FlightOfferView[], sort: SortKey): FlightOfferView[] {
  const out = offers.slice()
  switch (sort) {
    case "duration":
      out.sort((a, b) => a.durationMins - b.durationMins || a.totalPrice - b.totalPrice)
      break
    case "stops":
      out.sort((a, b) => a.stops - b.stops || a.totalPrice - b.totalPrice)
      break
    default:
      out.sort((a, b) => a.totalPrice - b.totalPrice || a.durationMins - b.durationMins)
  }
  return out
}

/** "Sat, Oct 3" from yyyy-MM-dd, built in local time so the day doesn't drift. */
function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number)
  if (!y || !m || !d) return date
  return format(new Date(y, m - 1, d), "EEE, MMM d")
}

function stampLabel(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : format(d, "MMM d, h:mm a")
}

function cabinLabel(cabin: string): string {
  return CABINS.find((c) => c.value === cabin)?.label ?? cabin
}

function todayKey(): string {
  return new Date().toLocaleDateString("en-CA")
}

/* ─── Component ────────────────────────────────────────────────────────────── */

export function FlightsView({
  tripId,
  trip,
  initialSearches,
  suggestedQuery,
  canTrack,
  flightCount,
}: Props) {
  const [form, setForm] = useState<FormState>(() => initialForm(suggestedQuery, trip))
  const [searches, setSearches] = useState<FlightSearchSummary[]>(initialSearches)
  const [results, setResults] = useState<Results | null>(null)
  const [pricePoints, setPricePoints] = useState<PricePoint[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sort, setSort] = useState<SortKey>("price")
  const [nonstopOnly, setNonstopOnly] = useState(false)
  const resultsRef = useRef<HTMLDivElement>(null)

  const activeSearch = results ? searches.find((s) => s.id === results.searchId) ?? null : null

  const visibleOffers = useMemo(() => {
    if (!results) return []
    const filtered = nonstopOnly ? results.offers.filter((o) => o.stops === 0) : results.offers
    return sortOffers(filtered, sort)
  }, [results, sort, nonstopOnly])

  const cheapestId = useMemo(() => {
    if (!results || results.offers.length === 0) return null
    return results.offers.reduce((a, b) => (b.totalPrice < a.totalPrice ? b : a)).id
  }, [results])

  const validationError = validate(form)

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function swap() {
    setForm((f) => ({ ...f, origin: f.destination, destination: f.origin }))
  }

  function scrollToResults() {
    // Give React a frame to render the results block first.
    requestAnimationFrame(() => {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    })
  }

  async function refreshSearches() {
    try {
      setSearches(await getFlightSearchesForTrip(tripId))
    } catch {
      // Non-fatal: the list is a convenience; the results still show.
    }
  }

  async function loadPricePoints(searchId: string) {
    try {
      const detail = await getFlightSearch(searchId)
      setPricePoints(detail?.pricePoints ?? null)
    } catch {
      setPricePoints(null)
    }
  }

  async function runSearch() {
    const problem = validate(form)
    if (problem) {
      setError(problem)
      return
    }
    setLoading(true)
    setError(null)
    setPricePoints(null)
    try {
      const res = await searchFlights(tripId, toQuery(form))
      setResults({
        searchId: res.searchId,
        offers: res.offers,
        insight: res.insight,
        fromCache: res.fromCache,
        retrievedAt: res.retrievedAt,
      })
      scrollToResults()
      // The search row exists now, so both of these can refresh in the background.
      void refreshSearches()
      void loadPricePoints(res.searchId)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ""
      setResults(null)
      setError(
        msg === "UPGRADE_REQUIRED"
          ? "Flight search is available on paid plans."
          : msg ||
              "We couldn't reach the fare provider. Please try again in a moment."
      )
    } finally {
      setLoading(false)
    }
  }

  async function openSearch(s: FlightSearchSummary) {
    if (openingId) return
    setOpeningId(s.id)
    setError(null)
    try {
      const detail = await getFlightSearch(s.id)
      if (!detail) {
        toast.error("That search is no longer available")
        return
      }
      setForm(formFromSearch(detail.search))
      setResults({
        searchId: detail.search.id,
        offers: detail.offers,
        fromCache: true,
        retrievedAt: detail.search.lastCheckedAt ?? null,
      })
      setPricePoints(detail.pricePoints)
      scrollToResults()
    } catch {
      toast.error("Couldn't load that search")
    } finally {
      setOpeningId(null)
    }
  }

  function handleTrackingChange(searchId: string, next: { isTracking: boolean; targetPrice?: number }) {
    setSearches((prev) =>
      prev.map((s) =>
        s.id === searchId ? { ...s, isTracking: next.isTracking, targetPrice: next.targetPrice ?? null } : s
      )
    )
  }

  const retrieved = results ? stampLabel(results.retrievedAt) : null
  const minDate = todayKey()

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 md:py-8">
      {/* Header */}
      <header className="mb-5">
        <h1 className="text-xl md:text-2xl font-bold text-gray-900">Flights</h1>
        <p className="text-sm text-gray-500 mt-1">
          Compare fares for {trip.destination}, watch the price, and add the one you book to your plan.
        </p>
        {flightCount > 0 && (
          <p className="mt-2 text-xs text-gray-500">
            This trip already has {flightCount} flight{flightCount === 1 ? "" : "s"}.{" "}
            <Link href={`/trip/${tripId}/settings?tab=travel`} className="text-indigo-600 hover:underline font-medium">
              Manage them in Trip Settings
            </Link>
          </p>
        )}
      </header>

      {/* Search form */}
      <section className="bg-white border border-gray-100 rounded-2xl p-4 sm:p-5 mb-4">
        <div className="flex items-center gap-1 mb-4">
          {[
            { value: true, label: "Round trip" },
            { value: false, label: "One way" },
          ].map((opt) => (
            <button
              key={opt.label}
              type="button"
              onClick={() => update("roundTrip", opt.value)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-full border transition-colors",
                form.roundTrip === opt.value
                  ? "bg-gray-900 border-gray-900 text-white"
                  : "border-gray-200 text-gray-600 hover:bg-gray-50"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-3 sm:gap-2 items-start">
          <AirportCombobox
            label="From"
            direction="from"
            value={form.origin}
            onChange={(code) => update("origin", code)}
            placeholder="Home airport"
          />
          <div className="flex sm:flex-col justify-center sm:pt-6 -my-1 sm:my-0">
            <button
              type="button"
              onClick={swap}
              aria-label="Swap airports"
              className="p-2 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
            >
              <ArrowLeftRight className="w-4 h-4 rotate-90 sm:rotate-0" />
            </button>
          </div>
          <AirportCombobox
            label="To"
            direction="to"
            value={form.destination}
            onChange={(code) => update("destination", code)}
            placeholder={`Airport near ${trip.destination}`}
          />
        </div>

        <div className="grid grid-cols-2 gap-3 mt-1">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Depart</label>
            <input
              type="date"
              value={form.departDate}
              min={minDate}
              onChange={(e) => update("departDate", e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Return</label>
            <input
              type="date"
              value={form.roundTrip ? form.returnDate : ""}
              min={form.departDate || minDate}
              disabled={!form.roundTrip}
              onChange={(e) => update("returnDate", e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-400"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-[1fr_auto_auto] gap-3 mt-3">
          <div className="col-span-2 sm:col-span-1">
            <label className="block text-xs font-medium text-gray-500 mb-1">Cabin</label>
            <select
              value={form.cabin}
              onChange={(e) => update("cabin", e.target.value as CabinClass)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {CABINS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Adults</label>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={9}
              value={form.adults}
              onChange={(e) => update("adults", Math.max(1, Math.min(9, Number(e.target.value) || 1)))}
              className="w-full sm:w-20 px-3 py-2.5 border border-gray-200 rounded-xl text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Children</label>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={9}
              value={form.children}
              onChange={(e) => update("children", Math.max(0, Math.min(9, Number(e.target.value) || 0)))}
              className="w-full sm:w-20 px-3 py-2.5 border border-gray-200 rounded-xl text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-2">
          <button
            type="button"
            onClick={runSearch}
            disabled={loading || Boolean(validationError)}
            title={validationError ?? undefined}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {loading ? "Searching…" : results ? "Search again" : "Search flights"}
          </button>
          {validationError && !loading && (
            <span className="text-xs text-gray-400">{validationError}</span>
          )}
        </div>
      </section>

      {/* Indicative-pricing note — always visible so nobody mistakes a quote for a fare */}
      <p className="flex items-start gap-1.5 text-[11px] text-gray-400 px-1 mb-6">
        <Info className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
        <span>
          Prices are indicative and can change by the minute — confirm the fare on the booking site.
          {retrieved && (
            <>
              {" "}
              Fetched {retrieved}
              {results?.fromCache ? " (cached)" : ""}.
            </>
          )}
        </span>
      </p>

      {/* Results */}
      <div ref={resultsRef} className="scroll-mt-4">
        {loading && (
          <div className="space-y-3" aria-busy="true" aria-live="polite">
            <div className="flex items-center gap-2 text-sm text-gray-500 px-1">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
              Checking fares for {form.origin} &rarr; {form.destination}…
            </div>
            {[0, 1, 2].map((i) => (
              <div key={i} className="bg-white border border-gray-100 rounded-2xl p-4 animate-pulse">
                <div className="flex justify-between gap-3">
                  <div className="h-4 w-40 bg-gray-100 rounded" />
                  <div className="h-5 w-20 bg-gray-100 rounded" />
                </div>
                <div className="mt-4 h-4 w-3/4 bg-gray-100 rounded" />
                <div className="mt-2 h-3 w-1/2 bg-gray-100 rounded" />
              </div>
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="bg-white border border-red-100 rounded-2xl p-5 text-center">
            <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" aria-hidden="true" />
            <p className="text-sm text-gray-700">{error}</p>
            <button
              type="button"
              onClick={runSearch}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Try again
            </button>
          </div>
        )}

        {!loading && !error && results && (
          <section className="mb-8">
            {/* Results header: count, insight, tracking */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <h2 className="text-sm font-semibold text-gray-900">
                {results.offers.length === 0
                  ? "No fares found"
                  : `${visibleOffers.length} of ${results.offers.length} option${results.offers.length === 1 ? "" : "s"}`}
              </h2>
              {results.insight && results.insight.level !== "UNKNOWN" && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-full",
                    results.insight.level === "LOW" && "bg-emerald-50 text-emerald-700",
                    results.insight.level === "TYPICAL" && "bg-gray-100 text-gray-600",
                    results.insight.level === "HIGH" && "bg-amber-50 text-amber-700"
                  )}
                >
                  {results.insight.level === "HIGH" ? (
                    <TrendingUp className="w-3 h-3" aria-hidden="true" />
                  ) : (
                    <TrendingDown className="w-3 h-3" aria-hidden="true" />
                  )}
                  Prices are {results.insight.level.toLowerCase()} for this route
                  {results.insight.typicalLow != null && results.insight.typicalHigh != null && (
                    <span className="tabular-nums text-current/70">
                      {" "}
                      (usually {formatCurrency(results.insight.typicalLow, CURRENCY)}–
                      {formatCurrency(results.insight.typicalHigh, CURRENCY)})
                    </span>
                  )}
                </span>
              )}
              <div className="ml-auto">
                <TrackPriceButton
                  key={results.searchId}
                  searchId={results.searchId}
                  isTracking={activeSearch?.isTracking ?? false}
                  targetPrice={activeSearch?.targetPrice ?? null}
                  currency={CURRENCY}
                  canTrack={canTrack}
                  onChange={(next) => handleTrackingChange(results.searchId, next)}
                />
              </div>
            </div>

            {/* Price history for this search */}
            {pricePoints && pricePoints.length > 0 && (
              <div className="bg-white border border-gray-100 rounded-2xl p-4 mb-4">
                <h3 className="text-xs font-semibold text-gray-700 mb-2">Price history</h3>
                <PriceHistoryChart
                  points={pricePoints}
                  targetPrice={activeSearch?.targetPrice ?? null}
                  currency={CURRENCY}
                />
              </div>
            )}

            {results.offers.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 mb-3">
                {SORTS.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setSort(s.key)}
                    className={cn(
                      "px-2.5 py-1 text-xs font-medium rounded-full border transition-colors",
                      sort === s.key
                        ? "bg-indigo-600 border-indigo-600 text-white"
                        : "border-gray-200 text-gray-600 hover:bg-gray-50"
                    )}
                  >
                    {s.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setNonstopOnly((v) => !v)}
                  aria-pressed={nonstopOnly}
                  className={cn(
                    "px-2.5 py-1 text-xs font-medium rounded-full border transition-colors",
                    nonstopOnly
                      ? "bg-gray-900 border-gray-900 text-white"
                      : "border-gray-200 text-gray-600 hover:bg-gray-50"
                  )}
                >
                  Nonstop only
                </button>
              </div>
            )}

            {results.offers.length === 0 ? (
              <div className="bg-white border border-gray-100 rounded-2xl px-6 py-12 text-center">
                <Plane className="w-10 h-10 text-gray-200 mx-auto mb-3" aria-hidden="true" />
                <p className="text-sm text-gray-600">No fares came back for these dates.</p>
                <p className="text-xs text-gray-400 mt-1">
                  Try a nearby airport, shift the dates a day, or drop the cabin class.
                </p>
              </div>
            ) : visibleOffers.length === 0 ? (
              <div className="bg-white border border-gray-100 rounded-2xl px-6 py-10 text-center">
                <p className="text-sm text-gray-600">Every option on this route has at least one stop.</p>
                <button
                  type="button"
                  onClick={() => setNonstopOnly(false)}
                  className="mt-2 text-xs font-medium text-indigo-600 hover:text-indigo-700"
                >
                  Show all options
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {visibleOffers.map((offer) => (
                  <FlightOfferCard
                    key={offer.id}
                    offer={offer}
                    searchId={results.searchId}
                    tripId={tripId}
                    badge={offer.id === cheapestId ? "Cheapest" : null}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {!loading && !error && !results && searches.length === 0 && (
          <div className="text-center py-14">
            <Plane className="w-12 h-12 text-gray-200 mx-auto mb-3" aria-hidden="true" />
            <p className="text-gray-500 text-sm">
              Pick your airports and dates to compare fares for this trip.
            </p>
          </div>
        )}
      </div>

      {/* Saved searches */}
      {searches.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2 px-1">
            <h2 className="text-sm font-semibold text-gray-900">Your searches</h2>
            <span className="text-xs text-gray-400 tabular-nums">{searches.length}</span>
          </div>
          <ul className="bg-white border border-gray-100 rounded-2xl divide-y divide-gray-100 overflow-hidden">
            {searches.map((s) => {
              const isActive = results?.searchId === s.id
              const opening = openingId === s.id
              const dropped =
                s.lowestPrice != null && s.lastPrice != null && s.lastPrice > s.lowestPrice
              return (
                <li key={s.id} className={cn("flex items-stretch", isActive && "bg-indigo-50/40")}>
                  <button
                    type="button"
                    onClick={() => openSearch(s)}
                    disabled={Boolean(openingId)}
                    className="flex-1 min-w-0 flex items-start gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors disabled:cursor-wait"
                  >
                    <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0 mt-0.5">
                      {opening ? (
                        <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" />
                      ) : s.isTracking ? (
                        <BellRing className="w-4 h-4 text-indigo-600" />
                      ) : (
                        <Plane className="w-4 h-4 text-indigo-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {s.origin} &rarr; {s.destination}
                        {s.returnDate && <span className="text-gray-400"> &rarr; {s.origin}</span>}
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        {dayLabel(s.departDate)}
                        {s.returnDate ? ` – ${dayLabel(s.returnDate)}` : " · One way"}
                        {" · "}
                        {cabinLabel(s.cabin)}
                        {" · "}
                        {s.adults + s.children} traveler{s.adults + s.children === 1 ? "" : "s"}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5 tabular-nums truncate">
                        {s.lastPrice != null ? (
                          <>
                            <span className="text-gray-700 font-medium">{formatCurrency(s.lastPrice, CURRENCY)}</span>
                            {dropped && s.lowestPrice != null && (
                              <> · low {formatCurrency(s.lowestPrice, CURRENCY)}</>
                            )}
                          </>
                        ) : (
                          `${s.offerCount} option${s.offerCount === 1 ? "" : "s"}`
                        )}
                        {s.lastCheckedAt && stampLabel(s.lastCheckedAt) && (
                          <> · checked {stampLabel(s.lastCheckedAt)}</>
                        )}
                      </p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-gray-300 shrink-0 mt-2 hidden sm:block" aria-hidden="true" />
                  </button>
                  <div className="flex items-center pr-3">
                    <TrackPriceButton
                      searchId={s.id}
                      isTracking={s.isTracking}
                      targetPrice={s.targetPrice ?? null}
                      currency={CURRENCY}
                      canTrack={canTrack}
                      onChange={(next) => handleTrackingChange(s.id, next)}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
          {searches.some((s) => s.isTracking) && (
            <p className="mt-2 px-1 text-[11px] text-gray-400">
              Tracked routes are re-checked automatically; you&apos;ll be notified when a fare drops.
            </p>
          )}
        </section>
      )}
    </div>
  )
}
