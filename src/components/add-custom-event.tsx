"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import {
  X,
  Search,
  Loader2,
  Star,
  MapPin,
  Clock,
  ChevronDown,
  Plus,
} from "lucide-react"
import {
  createCustomEvent,
  searchPlaceByName,
} from "@/lib/actions/custom-events"

/* ─── Types ───────────────────────────────────────────────────────────────── */

export type PlaceResult = {
  googlePlaceId: string
  name: string
  address: string
  lat?: number
  lng?: number
  rating?: number
  ratingCount?: number
  phone?: string
  website?: string
  mapsUrl?: string
  imageUrl?: string | null
  types?: string[]
  hours?: string[]
}

interface AddCustomEventProps {
  tripId: string
  tripDates: { start: string; end: string }
  destinations: { name: string; lat?: number | null; lng?: number | null }[]
  defaultDate?: string
  defaultTime?: string
  onCreated?: () => void
  onClose: () => void
}

/* ─── Duration options ────────────────────────────────────────────────────── */

const DURATION_OPTIONS = [
  { label: "30m", value: 30 },
  { label: "1h", value: 60 },
  { label: "1.5h", value: 90 },
  { label: "2h", value: 120 },
  { label: "3h", value: 180 },
  { label: "4h", value: 240 },
]

/* ─── Main Component ──────────────────────────────────────────────────────── */

export function AddCustomEvent({
  tripId,
  tripDates,
  destinations,
  defaultDate,
  defaultTime,
  onCreated,
  onClose,
}: AddCustomEventProps) {
  const [mode, setMode] = useState<"place" | "custom">("custom")
  const [isMobile, setIsMobile] = useState(false)
  const [saving, setSaving] = useState(false)

  // Place search state
  const [placeQuery, setPlaceQuery] = useState("")
  const [placeResults, setPlaceResults] = useState<PlaceResult[]>([])
  const [placeSearching, setPlaceSearching] = useState(false)
  const [selectedPlace, setSelectedPlace] = useState<PlaceResult | null>(null)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Form state
  const [title, setTitle] = useState("")
  const [address, setAddress] = useState("")
  const [date, setDate] = useState(defaultDate || tripDates.start)
  const [startTime, setStartTime] = useState(defaultTime || "")
  const [durationMins, setDurationMins] = useState(60)
  const [notes, setNotes] = useState("")
  const [confirmationNumber, setConfirmationNumber] = useState("")
  const [bookingUrl, setBookingUrl] = useState("")
  const [provider, setProvider] = useState("")
  const [showReservation, setShowReservation] = useState(false)

  // Geocoded lat/lng from address
  const [lat, setLat] = useState<number | undefined>(undefined)
  const [lng, setLng] = useState<number | undefined>(undefined)

  // Mobile detection
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener("resize", check)
    return () => window.removeEventListener("resize", check)
  }, [])

  // Get location bias from first destination
  const locationBias =
    destinations[0]?.lat != null && destinations[0]?.lng != null
      ? `${destinations[0].lat},${destinations[0].lng}`
      : undefined

  // Debounced place search
  const handlePlaceSearch = useCallback(
    (query: string) => {
      setPlaceQuery(query)
      if (searchTimeout.current) clearTimeout(searchTimeout.current)
      if (!query.trim() || query.length < 2) {
        setPlaceResults([])
        return
      }
      searchTimeout.current = setTimeout(async () => {
        setPlaceSearching(true)
        try {
          const results = await searchPlaceByName(query, locationBias)
          setPlaceResults(results || [])
        } catch {
          setPlaceResults([])
        } finally {
          setPlaceSearching(false)
        }
      }, 400)
    },
    [locationBias]
  )

  // Select a place result
  function handleSelectPlace(place: PlaceResult) {
    setSelectedPlace(place)
    setTitle(place.name)
    setAddress(place.address)
    setLat(place.lat)
    setLng(place.lng)
    setPlaceResults([])
    setPlaceQuery("")
  }

  // Geocode address (using place search as fallback)
  async function geocodeAddress() {
    if (!address.trim() || lat != null) return
    try {
      const results = await searchPlaceByName(address, locationBias)
      if (results && results.length > 0) {
        setLat(results[0].lat)
        setLng(results[0].lng)
      }
    } catch {
      // silently fail
    }
  }

  // Submit
  async function handleSubmit() {
    if (!title.trim()) {
      toast.error("Title is required")
      return
    }
    if (!date) {
      toast.error("Date is required")
      return
    }

    // Try geocoding address if no coordinates yet
    if (address && !lat) {
      await geocodeAddress()
    }

    setSaving(true)
    try {
      await createCustomEvent(tripId, {
        title: title.trim(),
        date,
        startTime: startTime || undefined,
        durationMins,
        address: address || undefined,
        lat,
        lng,
        notes: notes || undefined,
        googlePlaceId: selectedPlace?.googlePlaceId,
        imageUrl: selectedPlace?.imageUrl || undefined,
        category: selectedPlace?.types?.[0],
        rating: selectedPlace?.rating,
        confirmationNumber: confirmationNumber || undefined,
        bookingUrl: bookingUrl || undefined,
        provider: provider || undefined,
      })
      toast.success(`"${title}" added to your plan`)
      onCreated?.()
      onClose()
    } catch {
      toast.error("Failed to add event")
    } finally {
      setSaving(false)
    }
  }

  // Container classes for mobile full-screen vs desktop modal
  const containerClass = isMobile
    ? "fixed inset-0 z-50 bg-white flex flex-col"
    : "fixed inset-0 z-50 flex items-center justify-center"

  const panelClass = isMobile
    ? "flex-1 overflow-y-auto"
    : "bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-lg max-h-[90vh] overflow-y-auto"

  return (
    <div className={containerClass}>
      {/* Backdrop (desktop only) */}
      {!isMobile && (
        <div
          className="absolute inset-0 bg-black/30 backdrop-blur-sm"
          onClick={onClose}
        />
      )}

      <div className={cn(panelClass, "relative z-10")}>
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">
            Add Custom Event
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode tabs */}
        <div className="px-4 pt-3">
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => {
                setMode("place")
                setSelectedPlace(null)
                setTitle("")
                setAddress("")
                setLat(undefined)
                setLng(undefined)
              }}
              className={cn(
                "flex-1 py-2 text-sm font-medium rounded-md transition-colors",
                mode === "place"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              )}
            >
              Find a Place
            </button>
            <button
              onClick={() => {
                setMode("custom")
                setSelectedPlace(null)
              }}
              className={cn(
                "flex-1 py-2 text-sm font-medium rounded-md transition-colors",
                mode === "custom"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              )}
            >
              Custom Event
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {/* ─── Find a Place Mode ─────────────────────────────────────── */}
          {mode === "place" && (
            <>
              {/* Place search input */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by business name..."
                  value={placeQuery}
                  onChange={(e) => handlePlaceSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  autoFocus={!isMobile}
                />
                {placeSearching && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 animate-spin" />
                )}
              </div>

              {/* Place results */}
              {placeResults.length > 0 && (
                <div className="space-y-2 max-h-[240px] overflow-y-auto">
                  {placeResults.map((place) => (
                    <button
                      key={place.googlePlaceId}
                      onClick={() => handleSelectPlace(place)}
                      className="w-full text-left flex items-start gap-3 p-2.5 rounded-xl border border-gray-100 hover:border-indigo-200 hover:bg-indigo-50/50 transition-colors"
                    >
                      {place.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={place.imageUrl}
                          alt=""
                          className="w-12 h-12 rounded-lg object-cover shrink-0"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                          <MapPin className="w-5 h-5 text-gray-400" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {place.name}
                        </p>
                        <p className="text-xs text-gray-500 truncate">
                          {place.address}
                        </p>
                        {place.rating && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                            <span className="text-xs text-gray-600">
                              {place.rating}
                            </span>
                            {place.ratingCount && (
                              <span className="text-xs text-gray-400">
                                ({place.ratingCount.toLocaleString()})
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Selected place summary */}
              {selectedPlace && (
                <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3">
                  <div className="flex items-start gap-3">
                    {selectedPlace.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={selectedPlace.imageUrl}
                        alt=""
                        className="w-14 h-14 rounded-lg object-cover shrink-0"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
                        <MapPin className="w-6 h-6 text-indigo-400" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">
                        {selectedPlace.name}
                      </p>
                      <p className="text-xs text-gray-600 truncate">
                        {selectedPlace.address}
                      </p>
                      {selectedPlace.rating && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                          <span className="text-xs text-gray-600">
                            {selectedPlace.rating}
                          </span>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => {
                        setSelectedPlace(null)
                        setTitle("")
                        setAddress("")
                        setLat(undefined)
                        setLng(undefined)
                      }}
                      className="p-0.5 text-gray-400 hover:text-gray-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ─── Custom Event Mode ─────────────────────────────────────── */}
          {mode === "custom" && (
            <>
              {/* Title */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Event title <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Dinner at Joe's, Museum visit..."
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  autoFocus={!isMobile}
                />
              </div>

              {/* Address */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Address{" "}
                  <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="123 Main St or business name"
                    value={address}
                    onChange={(e) => {
                      setAddress(e.target.value)
                      setLat(undefined)
                      setLng(undefined)
                    }}
                    onBlur={geocodeAddress}
                    className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
            </>
          )}

          {/* ─── Shared Form Fields ────────────────────────────────────── */}

          {/* Date and Time row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Date <span className="text-red-400">*</span>
              </label>
              <input
                type="date"
                value={date}
                min={tripDates.start}
                max={tripDates.end}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Start time{" "}
                <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Duration */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Duration
            </label>
            <div className="flex flex-wrap gap-2">
              {DURATION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setDurationMins(opt.value)}
                  className={cn(
                    "px-3 py-1.5 text-sm rounded-lg border transition-colors",
                    durationMins === opt.value
                      ? "bg-indigo-50 border-indigo-300 text-indigo-700 font-medium"
                      : "border-gray-200 text-gray-600 hover:border-gray-300"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Notes{" "}
              <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              placeholder="Any additional details..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
          </div>

          {/* Reservation info toggle */}
          {!showReservation ? (
            <button
              onClick={() => setShowReservation(true)}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
            >
              <ChevronDown className="w-3.5 h-3.5" />
              Add reservation details
            </button>
          ) : (
            <div className="space-y-3 border-t border-gray-100 pt-3">
              <p className="text-xs font-medium text-gray-700">
                Reservation details{" "}
                <span className="text-gray-400 font-normal">(optional)</span>
              </p>
              <input
                type="text"
                placeholder="Confirmation number"
                value={confirmationNumber}
                onChange={(e) => setConfirmationNumber(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <input
                type="text"
                placeholder="Provider (e.g. OpenTable, Viator)"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <input
                type="url"
                placeholder="Booking URL"
                value={bookingUrl}
                onChange={(e) => setBookingUrl(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          )}
        </div>

        {/* Footer with submit button */}
        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-4 py-3">
          <button
            onClick={handleSubmit}
            disabled={saving || !title.trim() || !date}
            className="w-full py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Adding...
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                Add to Plan
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
