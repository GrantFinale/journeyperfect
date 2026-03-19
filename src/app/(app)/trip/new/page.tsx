"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createTrip } from "@/lib/actions/trips"
import { parseAndPreviewFlight, createFlightsBatch } from "@/lib/actions/flights"
import { toast } from "sonner"
import { MapPin, Calendar, ArrowRight, ArrowLeft, Plus, X, Plane, ChevronDown, ChevronUp, Loader2 } from "lucide-react"
import PlacesAutocomplete from "@/components/places-autocomplete"

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

export default function NewTripPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    title: "",
    destinations: [{ name: "" }] as { name: string; lat?: number; lng?: number }[],
    startDate: "",
    endDate: "",
    notes: "",
  })

  // Flight paste state
  const [flightPasteOpen, setFlightPasteOpen] = useState(false)
  const [flightText, setFlightText] = useState("")
  const [parsing, setParsing] = useState(false)
  const [parsedFlights, setParsedFlights] = useState<ParsedFlightPreview[]>([])
  const [parseError, setParseError] = useState("")
  const [parsedBy, setParsedBy] = useState<"ai" | "regex" | null>(null)

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

  async function handleParseFlight() {
    if (!flightText.trim()) return
    setParsing(true)
    setParseError("")
    try {
      const result = await parseAndPreviewFlight(flightText)
      if (result.flights.length === 0) {
        setParseError("Could not detect any flights. Please fill in dates manually.")
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

      // Auto-fill dates from parsed flights
      const departures = previews
        .map((f) => f.departureTime)
        .filter(Boolean)
        .map((t) => new Date(t!))
      const arrivals = previews
        .map((f) => f.arrivalTime)
        .filter(Boolean)
        .map((t) => new Date(t!))
      const allDates = [...departures, ...arrivals]

      if (allDates.length > 0) {
        const earliest = new Date(Math.min(...allDates.map((d) => d.getTime())))
        const latest = new Date(Math.max(...allDates.map((d) => d.getTime())))
        const startStr = earliest.toISOString().slice(0, 10)
        const endStr = latest.toISOString().slice(0, 10)
        setForm((f) => ({
          ...f,
          startDate: f.startDate || startStr,
          endDate: f.endDate || endStr,
        }))
      }

      if (result.parsedBy === "regex") {
        toast.info("Parsed with basic matching — some details may be missing. For better results, paste the full confirmation email.")
      } else if (result.parsedBy === "ai") {
        toast.success(`Parsed ${result.flights.length} flight${result.flights.length > 1 ? "s" : ""} with AI — please verify the details`)
      } else {
        toast.success(`Parsed ${result.flights.length} flight${result.flights.length > 1 ? "s" : ""}`)
      }
    } catch {
      setParseError("Failed to parse flight email. Please fill in dates manually.")
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
      weekday: "short",
      month: "short",
      day: "numeric",
    }) + " " + d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    })
  }

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

      // Create flights if any were parsed
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
          try {
            await createFlightsBatch(trip.id, flightsToCreate)
          } catch {
            toast.error("Trip created but flights could not be added")
          }
        }
      }

      toast.success("Trip created!")
      router.push(`/trip/${trip.id}`)
    } catch {
      toast.error("Failed to create trip")
      setLoading(false)
    }
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-12">
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-6">
          {[1, 2].map((s) => (
            <div
              key={s}
              className={`h-1.5 flex-1 rounded-full transition-colors ${s <= step ? "bg-indigo-600" : "bg-gray-200"}`}
            />
          ))}
        </div>
        <h1 className="text-2xl font-bold text-gray-900">
          {step === 1 ? "Where are you going?" : "When is the trip?"}
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          {step === 1 ? "Give your trip a name and destinations" : "Select your travel dates"}
        </p>
      </div>

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
                      placeholder="Search for a city..."
                      className="w-full pl-9 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
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
                Have a flight confirmation? Paste it here to auto-fill dates
              </span>
              {flightPasteOpen ? (
                <ChevronUp className="w-4 h-4 text-gray-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-400" />
              )}
            </button>

            {flightPasteOpen && (
              <div className="px-4 pb-4 space-y-3 border-t border-gray-100">
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
              disabled={!form.startDate || !form.endDate || loading}
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
