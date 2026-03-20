"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { createTrip } from "@/lib/actions/trips"
import { parseAndPreviewFlight, createFlightsBatch } from "@/lib/actions/flights"
import { getUserPlan, getPlacesApiKey, getUserId } from "@/lib/actions/user"
import { checkPendingEmails, markEmailsProcessed, type PendingEmailItem } from "@/lib/actions/inbound-emails"
import { hasFeature } from "@/lib/features"
import { toast } from "sonner"
import {
  MapPin, Calendar, ArrowRight, ArrowLeft, Plus, X, Plane, ChevronDown, ChevronUp,
  Loader2, Sparkles, Mail, Copy, Check, Hotel, Car, UtensilsCrossed, Ticket, RefreshCw,
} from "lucide-react"
import PlacesAutocomplete from "@/components/places-autocomplete"

// ─── Trip name generator ────────────────────────────────────────────────────

function generateTripName(destinations: string[], startDate?: string): string {
  if (destinations.length === 0) return "My Trip"

  // Clean destination names (take city name only)
  const cities = destinations.map((d) => {
    // Strip state/country suffixes like "Austin, TX" -> "Austin"
    return d.split(",")[0].trim()
  })

  // Determine season/occasion from start date
  let seasonTag = ""
  if (startDate) {
    const date = new Date(startDate)
    const month = date.getMonth() // 0-indexed
    const year = date.getFullYear()
    const currentYear = new Date().getFullYear()

    // Holiday detection
    if (month === 11 && date.getDate() >= 20) seasonTag = "Holiday"
    else if (month === 2 && date.getDate() >= 10 && date.getDate() <= 25) seasonTag = "Spring Break"
    else if (month === 5 || month === 6 || month === 7) seasonTag = "Summer"
    else if (month === 8 || month === 9) seasonTag = "Fall"
    else if (month === 11 || month === 0 || month === 1) seasonTag = "Winter"
    else if (month === 2 || month === 3 || month === 4) seasonTag = "Spring"

    // Add year if trip is next year or later
    if (year > currentYear) {
      seasonTag = seasonTag ? `${seasonTag} ${year}` : `${year}`
    }
  }

  // Fun suffixes
  const suffixes = ["Getaway", "Adventure", "Trip", "Escape", "Journey"]
  const suffix = suffixes[Math.floor(Math.random() * 3)] // bias toward first 3

  if (cities.length === 1) {
    return seasonTag ? `${cities[0]} ${seasonTag} ${suffix}` : `${cities[0]} ${suffix}`
  }
  if (cities.length === 2) {
    return seasonTag
      ? `${cities[0]} & ${cities[1]} ${seasonTag}`
      : `${cities[0]} & ${cities[1]} ${suffix}`
  }
  // 3+ cities
  return seasonTag
    ? `${cities[0]}, ${cities[1]} & More — ${seasonTag}`
    : `${cities.slice(0, 2).join(", ")} & More`
}

// ─── Type icons ─────────────────────────────────────────────────────────────

function TypeIcon({ type, className }: { type: string | null; className?: string }) {
  const cn = className || "w-4 h-4"
  switch (type) {
    case "flight": return <Plane className={cn} />
    case "hotel": return <Hotel className={cn} />
    case "rental_car": return <Car className={cn} />
    case "restaurant": return <UtensilsCrossed className={cn} />
    case "event": return <Ticket className={cn} />
    default: return <Mail className={cn} />
  }
}

function typeLabel(type: string | null): string {
  switch (type) {
    case "flight": return "Flight"
    case "hotel": return "Hotel"
    case "rental_car": return "Rental Car"
    case "restaurant": return "Restaurant"
    case "event": return "Event"
    default: return "Email"
  }
}

function typeColor(type: string | null): string {
  switch (type) {
    case "flight": return "bg-blue-50 border-blue-200 text-blue-700"
    case "hotel": return "bg-purple-50 border-purple-200 text-purple-700"
    case "rental_car": return "bg-green-50 border-green-200 text-green-700"
    case "restaurant": return "bg-orange-50 border-orange-200 text-orange-700"
    case "event": return "bg-pink-50 border-pink-200 text-pink-700"
    default: return "bg-gray-50 border-gray-200 text-gray-700"
  }
}

// ─── Parse summary from parsedData ──────────────────────────────────────────

function emailSummary(email: PendingEmailItem): string {
  const data = email.parsedData
  if (!data) return email.subject || "Confirmation email"

  if (email.type === "flight" && data.flights) {
    const flights = data.flights as Array<Record<string, string>>
    if (flights.length > 0) {
      const f = flights[0]
      const route = [f.departureAirport || f.departureCity, f.arrivalAirport || f.arrivalCity]
        .filter(Boolean).join(" -> ")
      const label = [f.airline, f.flightNumber].filter(Boolean).join(" ")
      return label ? `${label} (${route})` : route || email.subject
    }
  }
  if (email.type === "hotel" && data.hotels) {
    const hotels = data.hotels as Array<Record<string, string>>
    if (hotels.length > 0) return hotels[0].name || email.subject
  }
  if (email.type === "rental_car" && data.rentalCars) {
    const cars = data.rentalCars as Array<Record<string, string>>
    if (cars.length > 0) {
      return [cars[0].company, cars[0].vehicleType].filter(Boolean).join(" ") || email.subject
    }
  }
  return email.subject || "Confirmation email"
}

// ─── Extract destinations & dates from pending emails ───────────────────────

function extractAutoFillData(emails: PendingEmailItem[]) {
  const destinations: string[] = []
  const dates: Date[] = []

  for (const email of emails) {
    const data = email.parsedData
    if (!data) continue

    if (email.type === "flight" && data.flights) {
      const flights = data.flights as Array<Record<string, string>>
      for (const f of flights) {
        if (f.arrivalCity && !destinations.includes(f.arrivalCity)) {
          destinations.push(f.arrivalCity)
        }
        if (f.departureTime) dates.push(new Date(f.departureTime))
        if (f.arrivalTime) dates.push(new Date(f.arrivalTime))
      }
    }
    if (email.type === "hotel" && data.hotels) {
      const hotels = data.hotels as Array<Record<string, string>>
      for (const h of hotels) {
        if (h.city && !destinations.includes(h.city)) destinations.push(h.city)
        if (h.checkIn) dates.push(new Date(h.checkIn))
        if (h.checkOut) dates.push(new Date(h.checkOut))
      }
    }
    if (email.type === "rental_car" && data.rentalCars) {
      const cars = data.rentalCars as Array<Record<string, string>>
      for (const c of cars) {
        if (c.pickupTime) dates.push(new Date(c.pickupTime))
        if (c.dropoffTime) dates.push(new Date(c.dropoffTime))
      }
    }
  }

  const validDates = dates.filter((d) => !isNaN(d.getTime()))
  const startDate = validDates.length > 0
    ? new Date(Math.min(...validDates.map((d) => d.getTime()))).toISOString().slice(0, 10)
    : undefined
  const endDate = validDates.length > 0
    ? new Date(Math.max(...validDates.map((d) => d.getTime()))).toISOString().slice(0, 10)
    : undefined

  return { destinations, startDate, endDate }
}

// ─── Parsed flight preview interface ────────────────────────────────────────

interface ParsedFlightPreview {
  airline?: string
  flightNumber?: string
  departureAirport?: string
  departureCity?: string
  departureTime?: string
  departureTimezone?: string
  arrivalAirport?: string
  arrivalCity?: string
  arrivalTime?: string
  arrivalTimezone?: string
  confirmationNumber?: string
  cabin?: string
  confidence: number
}

// ─── Main page component ────────────────────────────────────────────────────

export default function NewTripPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [userPlan, setUserPlan] = useState<string>("FREE")
  const [placesKey, setPlacesKey] = useState<string>("")
  const [userId, setUserId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Email-first state
  const [pendingEmails, setPendingEmails] = useState<PendingEmailItem[]>([])
  const [polling, setPolling] = useState(false)
  const [hasChecked, setHasChecked] = useState(false)
  const [autoFilled, setAutoFilled] = useState(false)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Manual form toggle
  const [manualOpen, setManualOpen] = useState(false)

  // Form state
  const [form, setForm] = useState({
    title: "",
    destinations: [{ name: "" }] as { name: string; lat?: number; lng?: number }[],
    startDate: "",
    endDate: "",
    notes: "",
  })

  // Flight paste state (for manual form)
  const [flightPasteOpen, setFlightPasteOpen] = useState(false)
  const [flightText, setFlightText] = useState("")
  const [parsing, setParsing] = useState(false)
  const [parsedFlights, setParsedFlights] = useState<ParsedFlightPreview[]>([])
  const [parseError, setParseError] = useState("")
  const [parsedBy, setParsedBy] = useState<"ai" | "regex" | null>(null)

  const isPaid = hasFeature(userPlan, "aiFlightParsing")

  // Initialize
  useEffect(() => {
    getUserPlan().then(setUserPlan)
    getPlacesApiKey().then(setPlacesKey)
    getUserId().then(setUserId)
  }, [])

  // Copy email to clipboard
  function handleCopy() {
    if (!userId) return
    const email = `trips+${userId}@inbound.journeyperfect.com`
    navigator.clipboard.writeText(email).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // Poll for pending emails
  const pollEmails = useCallback(async () => {
    try {
      const emails = await checkPendingEmails()
      if (emails.length > 0) {
        setPendingEmails(emails)
        setHasChecked(true)
      }
    } catch {
      // Silently ignore polling errors
    }
  }, [])

  // Start/stop polling
  function startPolling() {
    setPolling(true)
    setHasChecked(true)
    // Immediate check
    pollEmails()
    // Poll every 5 seconds
    if (pollingRef.current) clearInterval(pollingRef.current)
    pollingRef.current = setInterval(pollEmails, 5000)
  }

  function stopPolling() {
    setPolling(false)
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [])

  // Auto-fill form when pending emails change
  useEffect(() => {
    if (pendingEmails.length === 0 || autoFilled) return

    const { destinations, startDate, endDate } = extractAutoFillData(pendingEmails)

    setForm((f) => ({
      ...f,
      title: f.title || generateTripName(destinations, startDate),
      destinations: destinations.length > 0
        ? destinations.map((name) => ({ name }))
        : f.destinations,
      startDate: f.startDate || startDate || "",
      endDate: f.endDate || endDate || "",
    }))
    setAutoFilled(true)
  }, [pendingEmails, autoFilled])

  // Form helpers
  const updateField = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const updateDestination = (index: number, value: string) => {
    setForm((f) => {
      const destinations = [...f.destinations]
      destinations[index] = { ...destinations[index], name: value }
      return { ...f, destinations }
    })
  }

  const updateDestinationPlace = (index: number, place: { name: string; lat?: number; lng?: number }) => {
    setForm((f) => {
      const destinations = [...f.destinations]
      destinations[index] = { name: place.name, lat: place.lat, lng: place.lng }
      return { ...f, destinations }
    })
  }

  const addDestination = () => {
    setForm((f) => ({ ...f, destinations: [...f.destinations, { name: "" }] }))
  }

  const removeDestination = (index: number) => {
    setForm((f) => ({
      ...f,
      destinations: f.destinations.filter((_, i) => i !== index),
    }))
  }

  const hasValidDestinations = form.destinations.length > 0 && form.destinations[0].name.trim() !== ""

  // Flight parsing for manual form
  async function handleParseFlight() {
    if (!flightText.trim()) return
    setParsing(true)
    setParseError("")
    try {
      const result = await parseAndPreviewFlight(flightText)
      if (!result || result.flights.length === 0) {
        setParseError("Could not parse flight details. Please enter them manually.")
        setParsedFlights([])
        setParsing(false)
        return
      }

      const previews: ParsedFlightPreview[] = result.flights.map((f) => ({
        ...f,
        departureTime: f.departureTime ? new Date(f.departureTime).toISOString() : undefined,
        arrivalTime: f.arrivalTime ? new Date(f.arrivalTime).toISOString() : undefined,
      }))
      setParsedFlights(previews)
      setParsedBy(result.parsedBy || null)

      // Auto-fill dates
      const departures = previews.map((f) => f.departureTime).filter(Boolean).map((t) => new Date(t!))
      const arrivals = previews.map((f) => f.arrivalTime).filter(Boolean).map((t) => new Date(t!))
      const allDates = [...departures, ...arrivals]

      if (allDates.length > 0) {
        const earliest = new Date(Math.min(...allDates.map((d) => d.getTime())))
        const latest = new Date(Math.max(...allDates.map((d) => d.getTime())))
        setForm((f) => ({
          ...f,
          startDate: f.startDate || earliest.toISOString().slice(0, 10),
          endDate: f.endDate || latest.toISOString().slice(0, 10),
        }))
      }

      if (result.parsedBy === "regex") {
        toast.info("Parsed with basic matching — some details may be missing.")
      } else {
        toast.success(`Parsed ${result.flights.length} flight${result.flights.length > 1 ? "s" : ""}`)
      }
    } catch {
      setParseError("Failed to parse flight email.")
    }
    setParsing(false)
  }

  function removeFlight(index: number) {
    setParsedFlights((prev) => prev.filter((_, i) => i !== index))
  }

  function formatDateTime(iso?: string) {
    if (!iso) return "Unknown"
    const d = new Date(iso)
    return d.toLocaleDateString("en-US", {
      weekday: "short", month: "short", day: "numeric",
    }) + " " + d.toLocaleTimeString("en-US", {
      hour: "numeric", minute: "2-digit",
    })
  }

  // Submit — create trip from email flow or manual form
  async function handleSubmit() {
    const validDestinations = form.destinations.filter((d) => d.name.trim() !== "")
    if (!form.title || validDestinations.length === 0 || !form.startDate || !form.endDate) {
      toast.error("Please fill in all required fields")
      return
    }
    setLoading(true)
    try {
      const trip = await createTrip({
        title: form.title,
        destinations: validDestinations,
        startDate: form.startDate,
        endDate: form.endDate,
        notes: form.notes,
      })

      // Create flights if any were parsed manually
      if (parsedFlights.length > 0) {
        const flightsToCreate = parsedFlights
          .filter((f) => f.departureTime && f.arrivalTime)
          .map((f) => ({
            airline: f.airline,
            flightNumber: f.flightNumber,
            departureAirport: f.departureAirport,
            departureCity: f.departureCity,
            departureTime: f.departureTime!,
            departureTimezone: f.departureTimezone || "UTC",
            arrivalAirport: f.arrivalAirport,
            arrivalCity: f.arrivalCity,
            arrivalTime: f.arrivalTime!,
            arrivalTimezone: f.arrivalTimezone || "UTC",
            confirmationNumber: f.confirmationNumber,
            cabin: f.cabin,
          }))
        if (flightsToCreate.length > 0) {
          try { await createFlightsBatch(trip.id, flightsToCreate) }
          catch { toast.error("Trip created but flights could not be added") }
        }
      }

      // Mark pending emails as processed
      if (pendingEmails.length > 0) {
        const emailIds = pendingEmails.map((e) => e.id)
        await markEmailsProcessed(emailIds).catch(() => {})
      }

      stopPolling()
      toast.success("Trip created!")
      router.push(`/trip/${trip.id}`)
    } catch {
      toast.error("Failed to create trip")
      setLoading(false)
    }
  }

  // Check if form is complete enough to submit
  const canSubmit = form.title && hasValidDestinations && form.startDate && form.endDate && !loading

  return (
    <div className="max-w-lg mx-auto px-4 py-12">
      {/* ─── Path 1: Email-first hero ─────────────────────────────────── */}
      <div className="mb-8">
        <div className="bg-gradient-to-br from-indigo-50 via-blue-50 to-purple-50 border border-indigo-100 rounded-2xl p-6 relative overflow-hidden">
          {/* Decorative background circles */}
          <div className="absolute -top-8 -right-8 w-32 h-32 bg-indigo-100/40 rounded-full blur-2xl" />
          <div className="absolute -bottom-8 -left-8 w-24 h-24 bg-purple-100/40 rounded-full blur-2xl" />

          <div className="relative">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-5 h-5 text-indigo-500" />
              <h1 className="text-xl font-bold text-gray-900">The easiest way to plan a trip</h1>
            </div>
            <p className="text-sm text-gray-600 leading-relaxed mb-5">
              Forward your confirmation emails — flights, hotels, rental cars, event tickets — and
              we&apos;ll build your entire trip automatically.
            </p>

            {/* Forwarding email address */}
            {userId ? (
              <button
                onClick={handleCopy}
                className="flex items-center gap-2 px-4 py-3 bg-white border border-indigo-200 rounded-xl hover:bg-indigo-50 transition-all group w-full shadow-sm"
              >
                <Mail className="w-4 h-4 text-indigo-500 shrink-0" />
                <span className="font-mono text-sm text-gray-800 truncate">
                  trips+{userId}@inbound.journeyperfect.com
                </span>
                {copied ? (
                  <span className="shrink-0 text-green-600 text-xs font-semibold flex items-center gap-1 ml-auto">
                    <Check className="w-3.5 h-3.5" /> Copied!
                  </span>
                ) : (
                  <span className="shrink-0 text-indigo-400 text-xs ml-auto group-hover:text-indigo-600 flex items-center gap-1">
                    <Copy className="w-3.5 h-3.5" /> Copy
                  </span>
                )}
              </button>
            ) : (
              <div className="h-12 bg-white/50 border border-indigo-200 rounded-xl animate-pulse" />
            )}

            <p className="text-[11px] text-gray-400 mt-2.5 leading-relaxed">
              Works with United, Delta, American, Southwest, Booking.com, Hilton, Marriott, Enterprise, Hertz, OpenTable, Ticketmaster, and more.
            </p>

            {/* Check for emails button / polling area */}
            <div className="mt-5">
              {!polling && !hasChecked && (
                <button
                  onClick={startPolling}
                  disabled={!userId}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm"
                >
                  <Mail className="w-4 h-4" />
                  Check for emails
                </button>
              )}

              {(polling || hasChecked) && pendingEmails.length === 0 && (
                <div className="text-center py-4">
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <div className={`${polling ? "animate-bounce" : ""}`}>
                      <Mail className="w-6 h-6 text-indigo-400" />
                    </div>
                    {polling && (
                      <RefreshCw className="w-4 h-4 text-indigo-400 animate-spin" />
                    )}
                  </div>
                  <p className="text-sm text-gray-500 font-medium">
                    {polling ? "Waiting for your forwarded emails..." : "No emails found yet"}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {polling
                      ? "Forward a confirmation email to the address above and we'll detect it automatically"
                      : "Forward your confirmation emails and check again"
                    }
                  </p>
                  {!polling && (
                    <button
                      onClick={startPolling}
                      className="mt-3 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                    >
                      Check again
                    </button>
                  )}
                  {polling && (
                    <button
                      onClick={stopPolling}
                      className="mt-3 text-xs text-gray-400 hover:text-gray-600"
                    >
                      Stop checking
                    </button>
                  )}
                </div>
              )}

              {/* Parsed email cards */}
              {pendingEmails.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-px bg-indigo-200" />
                    <span className="text-xs font-semibold text-indigo-600 uppercase tracking-wider">
                      {pendingEmails.length} item{pendingEmails.length !== 1 ? "s" : ""} detected
                    </span>
                    <div className="flex-1 h-px bg-indigo-200" />
                  </div>

                  {pendingEmails.map((email) => (
                    <div
                      key={email.id}
                      className={`flex items-start gap-3 border rounded-xl px-4 py-3 ${typeColor(email.type)} transition-all animate-in fade-in slide-in-from-bottom-2`}
                    >
                      <div className="mt-0.5">
                        <TypeIcon type={email.type} className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{emailSummary(email)}</p>
                        <p className="text-xs opacity-70 mt-0.5">{typeLabel(email.type)}</p>
                      </div>
                      <Check className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                    </div>
                  ))}

                  {polling && (
                    <div className="flex items-center justify-center gap-2 py-2">
                      <RefreshCw className="w-3.5 h-3.5 text-indigo-400 animate-spin" />
                      <span className="text-xs text-indigo-500">Checking for more...</span>
                      <button
                        onClick={stopPolling}
                        className="text-xs text-gray-400 hover:text-gray-600 ml-2"
                      >
                        Done
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ─── Auto-filled trip preview (from emails) ───────────────────── */}
      {pendingEmails.length > 0 && (
        <div className="mb-8 space-y-4 animate-in fade-in slide-in-from-bottom-4">
          <h2 className="text-lg font-bold text-gray-900">Looking good? Review and create your trip</h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Trip name</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => updateField("title", e.target.value)}
              className={`w-full px-4 py-3 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all ${
                autoFilled && form.title ? "border-indigo-300 bg-indigo-50/30 ring-1 ring-indigo-200" : "border-gray-200"
              }`}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Destinations</label>
            <div className="space-y-2">
              {form.destinations.map((dest, index) => (
                <div key={index} className="relative flex items-center gap-2">
                  <div className="relative flex-1">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 z-10" />
                    <PlacesAutocomplete
                      value={dest.name}
                      onChange={(val) => updateDestination(index, val)}
                      onSelect={(place) => updateDestinationPlace(index, place)}
                      placeholder={isPaid ? "Search for a city..." : "Type a city name..."}
                      className={`w-full pl-9 pr-4 py-3 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all ${
                        autoFilled && dest.name ? "border-indigo-300 bg-indigo-50/30 ring-1 ring-indigo-200" : "border-gray-200"
                      }`}
                      disabled={!isPaid}
                      apiKey={placesKey}
                    />
                  </div>
                  {form.destinations.length > 1 && (
                    <button
                      onClick={() => removeDestination(index)}
                      className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              onClick={addDestination}
              className="mt-2 flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-700 font-medium transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add destination
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Start date</label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => updateField("startDate", e.target.value)}
                  className={`w-full pl-9 pr-4 py-3 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all ${
                    autoFilled && form.startDate ? "border-indigo-300 bg-indigo-50/30 ring-1 ring-indigo-200" : "border-gray-200"
                  }`}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">End date</label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="date"
                  value={form.endDate}
                  min={form.startDate}
                  onChange={(e) => updateField("endDate", e.target.value)}
                  className={`w-full pl-9 pr-4 py-3 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all ${
                    autoFilled && form.endDate ? "border-indigo-300 bg-indigo-50/30 ring-1 ring-indigo-200" : "border-gray-200"
                  }`}
                />
              </div>
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm text-base"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Creating trip...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Create trip
              </>
            )}
          </button>
        </div>
      )}

      {/* ─── Path 2: Manual form (collapsible) ────────────────────────── */}
      <div className="border border-gray-200 rounded-2xl overflow-hidden">
        <button
          onClick={() => setManualOpen(!manualOpen)}
          className="w-full flex items-center justify-between px-5 py-4 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <span>Or set up manually</span>
          {manualOpen ? (
            <ChevronUp className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          )}
        </button>

        {manualOpen && (
          <div className="px-5 pb-6 border-t border-gray-100">
            <ManualForm
              form={form}
              updateField={updateField}
              updateDestination={updateDestination}
              updateDestinationPlace={updateDestinationPlace}
              addDestination={addDestination}
              removeDestination={removeDestination}
              hasValidDestinations={hasValidDestinations}
              isPaid={isPaid}
              placesKey={placesKey}
              flightPasteOpen={flightPasteOpen}
              setFlightPasteOpen={setFlightPasteOpen}
              flightText={flightText}
              setFlightText={setFlightText}
              parsing={parsing}
              handleParseFlight={handleParseFlight}
              parseError={parseError}
              parsedFlights={parsedFlights}
              parsedBy={parsedBy}
              removeFlight={removeFlight}
              formatDateTime={formatDateTime}
              loading={loading}
              handleSubmit={handleSubmit}
              canSubmit={!!canSubmit}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Manual form component (extracted for clarity) ──────────────────────────

function ManualForm({
  form, updateField, updateDestination, updateDestinationPlace,
  addDestination, removeDestination, hasValidDestinations,
  isPaid, placesKey, flightPasteOpen, setFlightPasteOpen,
  flightText, setFlightText, parsing, handleParseFlight,
  parseError, parsedFlights, parsedBy, removeFlight, formatDateTime,
  loading, handleSubmit, canSubmit,
}: {
  form: { title: string; destinations: { name: string; lat?: number; lng?: number }[]; startDate: string; endDate: string; notes: string }
  updateField: (k: string, v: string) => void
  updateDestination: (index: number, value: string) => void
  updateDestinationPlace: (index: number, place: { name: string; lat?: number; lng?: number }) => void
  addDestination: () => void
  removeDestination: (index: number) => void
  hasValidDestinations: boolean
  isPaid: boolean
  placesKey: string
  flightPasteOpen: boolean
  setFlightPasteOpen: (v: boolean) => void
  flightText: string
  setFlightText: (v: string) => void
  parsing: boolean
  handleParseFlight: () => void
  parseError: string
  parsedFlights: ParsedFlightPreview[]
  parsedBy: "ai" | "regex" | null
  removeFlight: (i: number) => void
  formatDateTime: (iso?: string) => string
  loading: boolean
  handleSubmit: () => void
  canSubmit: boolean
}) {
  const [step, setStep] = useState(1)

  return (
    <div className="pt-4">
      {/* Progress bar */}
      <div className="flex items-center gap-2 mb-6">
        {[1, 2].map((s) => (
          <div
            key={s}
            className={`h-1.5 flex-1 rounded-full transition-colors ${s <= step ? "bg-indigo-600" : "bg-gray-200"}`}
          />
        ))}
      </div>
      <h2 className="text-lg font-bold text-gray-900 mb-1">
        {step === 1 ? "Where are you going?" : "When is the trip?"}
      </h2>
      <p className="text-gray-500 text-sm mb-4">
        {step === 1 ? "Give your trip a name and destinations" : "Select your travel dates"}
      </p>

      {step === 1 && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Trip name *</label>
            <input
              type="text"
              placeholder="e.g. Tokyo Summer Adventure"
              value={form.title}
              onChange={(e) => updateField("title", e.target.value)}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Destinations *</label>
            <div className="space-y-2">
              {form.destinations.map((dest, index) => (
                <div key={index} className="relative flex items-center gap-2">
                  <div className="relative flex-1">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 z-10" />
                    <PlacesAutocomplete
                      value={dest.name}
                      onChange={(val) => updateDestination(index, val)}
                      onSelect={(place) => updateDestinationPlace(index, place)}
                      placeholder={isPaid ? "Search for a city..." : "Type a city name..."}
                      className="w-full pl-9 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      disabled={!isPaid}
                      apiKey={placesKey}
                    />
                  </div>
                  {form.destinations.length > 1 && (
                    <button
                      onClick={() => removeDestination(index)}
                      className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              onClick={addDestination}
              className="mt-2 flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-700 font-medium transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add destination
            </button>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Notes (optional)</label>
            <textarea
              placeholder="Ideas, goals, or notes for this trip..."
              value={form.notes}
              onChange={(e) => updateField("notes", e.target.value)}
              rows={3}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
            />
          </div>
          <button
            onClick={() => setStep(2)}
            disabled={!form.title || !hasValidDestinations}
            className="w-full flex items-center justify-center gap-2 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Next
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          {/* Flight email paste section */}
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setFlightPasteOpen(!flightPasteOpen)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <span className="flex items-center gap-2">
                <Plane className="w-4 h-4 text-indigo-500" />
                {isPaid
                  ? "Have a flight confirmation? Paste it here to auto-fill dates"
                  : "Upgrade to auto-import flights from confirmation emails"
                }
              </span>
              {flightPasteOpen ? (
                <ChevronUp className="w-4 h-4 text-gray-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-400" />
              )}
            </button>

            {flightPasteOpen && (
              <div className="px-4 pb-4 space-y-3 border-t border-gray-100">
                {!isPaid ? (
                  <div className="mt-3 text-center py-6">
                    <Sparkles className="w-8 h-8 text-indigo-400 mx-auto mb-3" />
                    <p className="text-sm font-medium text-gray-900 mb-1">AI Flight Import</p>
                    <p className="text-xs text-gray-500 mb-4">Paste any airline confirmation email and we&apos;ll automatically extract all your flight details.</p>
                    <a href="/settings/billing" className="inline-block px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors">
                      Upgrade to Personal — $9/mo
                    </a>
                  </div>
                ) : (
                  <>
                    <textarea
                      placeholder="Paste your flight confirmation email here..."
                      value={flightText}
                      onChange={(e) => setFlightText(e.target.value)}
                      rows={5}
                      className="w-full mt-3 px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none font-mono text-xs"
                    />
                    <button
                      type="button"
                      onClick={handleParseFlight}
                      disabled={!flightText.trim() || parsing}
                      className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-700 text-sm font-medium rounded-lg hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {parsing ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Parsing...
                        </>
                      ) : (
                        <>
                          <Plane className="w-3.5 h-3.5" />
                          Parse flights
                        </>
                      )}
                    </button>

                    {parseError && (
                      <p className="text-sm text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
                        {parseError}
                      </p>
                    )}

                    {parsedFlights.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                            Detected flights
                          </p>
                          {parsedBy && (
                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                              parsedBy === "ai"
                                ? "bg-indigo-100 text-indigo-700"
                                : "bg-gray-100 text-gray-600"
                            }`}>
                              {parsedBy === "ai" ? "AI parsed" : "Basic match"}
                            </span>
                          )}
                        </div>
                        {parsedFlights.map((flight, i) => (
                          <div
                            key={i}
                            className="flex items-start justify-between gap-2 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2.5"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-gray-900">
                                {[flight.airline, flight.flightNumber].filter(Boolean).join(" ") || "Flight"}
                              </p>
                              <p className="text-xs text-gray-600 mt-0.5">
                                {flight.departureAirport || "?"} → {flight.arrivalAirport || "?"}
                              </p>
                              <p className="text-xs text-gray-500 mt-0.5">
                                {formatDateTime(flight.departureTime)} → {formatDateTime(flight.arrivalTime)}
                              </p>
                              {flight.confirmationNumber && (
                                <p className="text-xs text-gray-400 mt-0.5">
                                  Conf: {flight.confirmationNumber}
                                </p>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => removeFlight(i)}
                              className="p-1 text-gray-400 hover:text-gray-600 rounded"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Start date *</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => updateField("startDate", e.target.value)}
                className="w-full pl-9 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">End date *</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="date"
                value={form.endDate}
                min={form.startDate}
                onChange={(e) => updateField("endDate", e.target.value)}
                className="w-full pl-9 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setStep(1)}
              className="flex items-center gap-2 px-4 py-3 border border-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="flex-1 flex items-center justify-center gap-2 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "Creating..." : "Create trip"}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
