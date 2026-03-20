"use client"

import { useState, useRef, useEffect } from "react"
import { toast } from "sonner"
import { createActivity, deleteActivity, updateActivity, searchPlaces } from "@/lib/actions/activities"
import { getPlaceDetails } from "@/lib/actions/places-detail"
import { getActivityNotes, addActivityNote, deleteActivityNote, addActivityExpense } from "@/lib/actions/activity-notes"
import { priorityColor, priorityLabel, formatCurrency } from "@/lib/utils"
import { cn } from "@/lib/utils"
import {
  Star,
  Plus,
  Trash2,
  Search,
  MapPin,
  Clock,
  DollarSign,
  X,
  ExternalLink,
  ChevronDown,
  Lock,
  CalendarDays,
  Check,
  Loader2,
  MessageSquare,
  Send,
  Receipt,
  Globe,
  Phone,
  Sparkles,
} from "lucide-react"
import { ActivityBookingLinks, ViatorDestinationBanner } from "@/components/affiliate-links"

type Activity = {
  id: string
  name: string
  description: string | null
  address: string | null
  category: string | null
  durationMins: number
  costPerAdult: number
  costPerChild: number
  priority: string
  status: string
  rating: number | null
  imageUrl: string | null
  reservationNeeded: boolean
  bookingLink: string | null
  websiteUrl?: string | null
  hoursJson?: string | null
  notes: string | null
  indoorOutdoor: string
  isFixed: boolean
  fixedDateTime: Date | string | null
}

type Place = {
  googlePlaceId: string
  name: string
  address: string
  lat?: number
  lng?: number
  rating?: number
  ratingCount?: number
  imageUrl?: string | null
  types: string[]
  primaryType?: string
  priceLevel?: string
  goodForChildren?: boolean
  openNow?: boolean
  weekdayHours?: string[]
}

type ActivityNoteItem = {
  id: string
  text: string
  createdAt: string | Date
  user: { name: string | null; image: string | null }
}

type Destination = { name: string; lat?: number | null; lng?: number | null }

const PRIORITY_OPTIONS = ["MUST_DO", "HIGH", "MEDIUM", "LOW"] as const

const QUICK_FILTERS = [
  { label: "Museums", query: "museum art gallery" },
  { label: "Outdoors/Parks", query: "outdoor park nature garden" },
  { label: "Tours", query: "guided tour walking tour" },
  { label: "Shopping", query: "shopping mall market boutique" },
  { label: "Nightlife", query: "nightlife club bar lounge" },
  { label: "Family/Kids", query: "family kids children amusement" },
  { label: "Sports", query: "sports stadium arena recreation" },
  { label: "Landmarks", query: "landmark monument historic site" },
]

const PRICE_LABEL: Record<string, string> = {
  PRICE_LEVEL_FREE: "Free",
  PRICE_LEVEL_INEXPENSIVE: "$",
  PRICE_LEVEL_MODERATE: "$$",
  PRICE_LEVEL_EXPENSIVE: "$$$",
  PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
}

interface Props {
  tripId: string
  initialActivities: Activity[]
  destination: string
  destinations: Destination[]
  arrivalCities: string[]
  travelerTags?: string[]
  dietaryRestrictions?: string[]
}

/* ─── Helpers ──────────────────────────────────────────────────────────────── */

type LocationOption = { label: string; value: string; lat?: number | null; lng?: number | null }

function buildLocationOptions(
  destinations: Destination[],
  arrivalCities: string[],
  fallbackDestination: string
): LocationOption[] {
  const seen = new Set<string>()
  const options: LocationOption[] = []

  for (const d of destinations) {
    const key = d.name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    options.push({ label: d.name, value: d.name, lat: d.lat, lng: d.lng })
  }

  for (const city of arrivalCities) {
    const key = city.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    options.push({ label: city, value: city })
  }

  if (options.length === 0 && fallbackDestination) {
    options.push({ label: fallbackDestination, value: fallbackDestination })
  }

  options.push({ label: "Other location...", value: "__other__" })
  return options
}

function getLocationBias(
  selectedLocation: string,
  options: LocationOption[]
): string | undefined {
  const opt = options.find((o) => o.value === selectedLocation)
  if (opt?.lat != null && opt?.lng != null) {
    return `${opt.lat},${opt.lng}`
  }
  return undefined
}

/* ─── Component ────────────────────────────────────────────────────────────── */

export function ActivitiesView({ tripId, initialActivities, destination, destinations, arrivalCities, travelerTags = [], dietaryRestrictions = [] }: Props) {
  const locationOptions = buildLocationOptions(destinations, arrivalCities, destination)

  const [activities, setActivities] = useState<Activity[]>(initialActivities)
  const [selectedLocation, setSelectedLocation] = useState(locationOptions[0]?.value ?? destination)
  const [customLocation, setCustomLocation] = useState("")
  const [activeFilter, setActiveFilter] = useState<string | null>(null)
  const [customQuery, setCustomQuery] = useState("")
  const [searchResults, setSearchResults] = useState<Place[]>([])
  const [loading, setLoading] = useState(false)
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set())
  const [showAddForm, setShowAddForm] = useState(false)
  const [filterPriority, setFilterPriority] = useState<string>("ALL")
  const [filterStatus, setFilterStatus] = useState<string>("ALL")
  const [addForm, setAddForm] = useState({
    name: "",
    address: "",
    category: "",
    durationMins: 120,
    costPerAdult: 0,
    priority: "MEDIUM" as const,
    notes: "",
    reservationNeeded: false,
    bookingLink: "",
    isFixed: false,
    fixedDateTime: "",
  })

  // Auto-suggest state
  const [suggestions, setSuggestions] = useState<Place[]>([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false)
  const suggestionsLoaded = useRef(false)

  // Hours expand state for activities with hoursJson
  const [expandedActivityHours, setExpandedActivityHours] = useState<string | null>(null)

  // Notes state
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set())
  const [notesByActivity, setNotesByActivity] = useState<Record<string, ActivityNoteItem[]>>({})
  const [notesLoading, setNotesLoading] = useState<Set<string>>(new Set())
  const [noteInputs, setNoteInputs] = useState<Record<string, string>>({})
  const [noteCounts, setNoteCounts] = useState<Record<string, number>>({})
  const [sendingNote, setSendingNote] = useState<Set<string>>(new Set())

  // Expense state
  const [expenseOpen, setExpenseOpen] = useState<string | null>(null)
  const [expenseForm, setExpenseForm] = useState({ description: "", amount: "", currency: "USD" })
  const [expenseAdded, setExpenseAdded] = useState<Set<string>>(new Set())
  const [sendingExpense, setSendingExpense] = useState(false)

  const noteInputRef = useRef<HTMLInputElement>(null)

  const effectiveLocation = selectedLocation === "__other__" ? customLocation : selectedLocation
  const locationBias = getLocationBias(selectedLocation, locationOptions)

  const filtered = activities.filter((a) => {
    if (filterPriority !== "ALL" && a.priority !== filterPriority) return false
    if (filterStatus !== "ALL" && a.status !== filterStatus) return false
    return true
  })

  // Auto-suggest on mount
  useEffect(() => {
    if (suggestionsLoaded.current) return
    suggestionsLoaded.current = true

    const city = locationOptions[0]?.value || destination
    if (!city) return

    const hasChildren = travelerTags.some((t) => t === "child" || t === "toddler" || t === "infant")
    const queryPrefix = hasChildren ? "family friendly activities" : "top things to do"
    const query = `${queryPrefix} in ${city}`

    setSuggestionsLoading(true)
    const bias = locationOptions[0]?.lat != null && locationOptions[0]?.lng != null
      ? `${locationOptions[0].lat},${locationOptions[0].lng}`
      : undefined

    searchPlaces(query, bias)
      .then((result) => {
        if (result.results.length > 0) {
          setSuggestions(result.results)
        }
      })
      .catch(() => {
        // Silently fail — suggestions are optional
      })
      .finally(() => {
        setSuggestionsLoading(false)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSearch(filterQuery?: string, keyword?: string) {
    const city = effectiveLocation || destination
    const parts = [filterQuery, keyword, city].filter(Boolean)
    if (parts.length === 0) return

    setLoading(true)
    try {
      const result = await searchPlaces(parts.join(" "), locationBias || undefined)
      setSearchResults(result.results)
      if (result.error && result.results.length === 0) {
        toast.error(result.error || "No results found")
      }
    } catch {
      toast.error("Search failed")
    } finally {
      setLoading(false)
    }
  }

  function handleFilterSelect(filter: (typeof QUICK_FILTERS)[number]) {
    const next = activeFilter === filter.query ? null : filter.query
    setActiveFilter(next)
    handleSearch(next || undefined, customQuery || undefined)
  }

  function handleSearchSubmit() {
    handleSearch(activeFilter || undefined, customQuery || undefined)
  }

  async function handleSaveFromSearch(place: Place) {
    const key = place.googlePlaceId
    if (savedIds.has(key) || savingIds.has(key)) return

    setSavingIds((prev) => new Set([...prev, key]))
    try {
      // Fetch additional details from Google Places
      const details = await getPlaceDetails(place.googlePlaceId)

      const activity = await createActivity(tripId, {
        name: place.name,
        address: place.address,
        lat: place.lat,
        lng: place.lng,
        googlePlaceId: place.googlePlaceId,
        rating: place.rating,
        imageUrl: place.imageUrl || undefined,
        priority: "MEDIUM",
        durationMins: 120,
        costPerAdult: 0,
        costPerChild: 0,
        category: place.types[0] || undefined,
        indoorOutdoor: "BOTH",
        reservationNeeded: false,
        isFixed: false,
        // Include details from Places Detail API
        websiteUrl: details?.website || undefined,
        hoursJson: details?.hours ? JSON.stringify(details.hours) : undefined,
      })
      setActivities((prev) => [activity as unknown as Activity, ...prev])
      setSavedIds((prev) => new Set([...prev, key]))
      toast.success(`${place.name} added to activities`)
    } catch {
      toast.error("Failed to save activity")
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }

  async function handleAddManual() {
    if (!addForm.name) {
      toast.error("Name is required")
      return
    }
    try {
      const activity = await createActivity(tripId, {
        ...addForm,
        costPerChild: 0,
        indoorOutdoor: "BOTH",
        isFixed: addForm.isFixed,
        fixedDateTime: addForm.isFixed && addForm.fixedDateTime ? addForm.fixedDateTime : undefined,
        bookingLink: addForm.bookingLink || undefined,
      })
      setActivities((prev) => [activity as unknown as Activity, ...prev])
      setShowAddForm(false)
      setAddForm({
        name: "",
        address: "",
        category: "",
        durationMins: 120,
        costPerAdult: 0,
        priority: "MEDIUM",
        notes: "",
        reservationNeeded: false,
        bookingLink: "",
        isFixed: false,
        fixedDateTime: "",
      })
      toast.success("Activity added")
    } catch {
      toast.error("Failed to add activity")
    }
  }

  async function handleDelete(activityId: string) {
    try {
      await deleteActivity(tripId, activityId)
      setActivities((prev) => prev.filter((a) => a.id !== activityId))
      toast.success("Activity removed")
    } catch {
      toast.error("Failed to remove activity")
    }
  }

  async function handlePriorityChange(activityId: string, priority: string) {
    try {
      await updateActivity(tripId, activityId, { priority: priority as "MUST_DO" | "HIGH" | "MEDIUM" | "LOW" })
      setActivities((prev) => prev.map((a) => (a.id === activityId ? { ...a, priority } : a)))
    } catch {
      toast.error("Failed to update priority")
    }
  }

  async function handleToggleFixed(activityId: string, currentlyFixed: boolean) {
    try {
      await updateActivity(tripId, activityId, { isFixed: !currentlyFixed, ...(!currentlyFixed ? {} : { fixedDateTime: undefined }) })
      setActivities((prev) =>
        prev.map((a) =>
          a.id === activityId
            ? { ...a, isFixed: !currentlyFixed, fixedDateTime: !currentlyFixed ? a.fixedDateTime : null }
            : a
        )
      )
      toast.success(currentlyFixed ? "Date unlocked" : "Date locked")
    } catch {
      toast.error("Failed to update")
    }
  }

  async function handleToggleNotes(activityId: string) {
    const isExpanded = expandedNotes.has(activityId)
    if (isExpanded) {
      setExpandedNotes((prev) => {
        const next = new Set(prev)
        next.delete(activityId)
        return next
      })
      return
    }

    // Expand and load notes
    setExpandedNotes((prev) => new Set([...prev, activityId]))
    if (!notesByActivity[activityId]) {
      setNotesLoading((prev) => new Set([...prev, activityId]))
      try {
        const notes = await getActivityNotes(tripId, activityId)
        setNotesByActivity((prev) => ({ ...prev, [activityId]: notes as unknown as ActivityNoteItem[] }))
        setNoteCounts((prev) => ({ ...prev, [activityId]: notes.length }))
      } catch {
        toast.error("Failed to load notes")
      } finally {
        setNotesLoading((prev) => {
          const next = new Set(prev)
          next.delete(activityId)
          return next
        })
      }
    }
  }

  async function handleAddNote(activityId: string) {
    const text = (noteInputs[activityId] || "").trim()
    if (!text) return

    setSendingNote((prev) => new Set([...prev, activityId]))
    try {
      const note = await addActivityNote(tripId, activityId, text)
      setNotesByActivity((prev) => ({
        ...prev,
        [activityId]: [...(prev[activityId] || []), note as unknown as ActivityNoteItem],
      }))
      setNoteCounts((prev) => ({ ...prev, [activityId]: (prev[activityId] || 0) + 1 }))
      setNoteInputs((prev) => ({ ...prev, [activityId]: "" }))
    } catch {
      toast.error("Failed to add note")
    } finally {
      setSendingNote((prev) => {
        const next = new Set(prev)
        next.delete(activityId)
        return next
      })
    }
  }

  async function handleDeleteNote(activityId: string, noteId: string) {
    try {
      await deleteActivityNote(tripId, noteId)
      setNotesByActivity((prev) => ({
        ...prev,
        [activityId]: (prev[activityId] || []).filter((n) => n.id !== noteId),
      }))
      setNoteCounts((prev) => ({ ...prev, [activityId]: Math.max(0, (prev[activityId] || 1) - 1) }))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete note")
    }
  }

  async function handleAddExpense(activityId: string) {
    const amount = parseFloat(expenseForm.amount)
    if (!expenseForm.description || isNaN(amount) || amount <= 0) {
      toast.error("Please fill in description and a valid amount")
      return
    }

    setSendingExpense(true)
    try {
      await addActivityExpense(tripId, activityId, {
        description: expenseForm.description,
        amount,
        currency: expenseForm.currency,
      })
      setExpenseAdded((prev) => new Set([...prev, activityId]))
      setExpenseForm({ description: "", amount: "", currency: "USD" })
      setTimeout(() => {
        setExpenseAdded((prev) => {
          const next = new Set(prev)
          next.delete(activityId)
          return next
        })
        setExpenseOpen(null)
      }, 1500)
    } catch {
      toast.error("Failed to add expense")
    } finally {
      setSendingExpense(false)
    }
  }

  function parseHoursJson(hoursJson: string | null | undefined): string[] | null {
    if (!hoursJson) return null
    try {
      const parsed = JSON.parse(hoursJson)
      if (Array.isArray(parsed)) return parsed
      return null
    } catch {
      return null
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900">Activities</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {activities.length} saved · {activities.filter((a) => a.status === "SCHEDULED").length} scheduled
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition-colors shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Add activity</span>
          <span className="sm:hidden">Add</span>
        </button>
      </div>

      {/* Auto-suggested activities */}
      {!suggestionsDismissed && (suggestionsLoading || suggestions.length > 0) && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-600" />
              <h2 className="text-sm font-semibold text-indigo-900">Suggested for your trip</h2>
              <span className="text-xs text-indigo-500">
                in {locationOptions[0]?.value || destination}
              </span>
            </div>
            <button
              onClick={() => setSuggestionsDismissed(true)}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors flex items-center gap-1"
            >
              <X className="w-3 h-3" />
              Dismiss
            </button>
          </div>
          {suggestionsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-4">
              {suggestions.map((place) => (
                <div
                  key={place.googlePlaceId}
                  className="bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-100 rounded-2xl overflow-hidden hover:border-indigo-200 hover:shadow-sm transition-all"
                >
                  {/* Image */}
                  {place.imageUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={place.imageUrl} alt="" className="w-full h-36 object-cover" />
                  ) : (
                    <div className="w-full h-36 bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center">
                      <Star className="w-8 h-8 text-indigo-200" />
                    </div>
                  )}

                  <div className="p-4 space-y-2.5">
                    {/* Name + rating */}
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-gray-900 text-sm leading-tight">
                        {place.name}
                      </h3>
                      {place.rating != null && (
                        <span className="flex items-center gap-0.5 text-yellow-600 text-xs shrink-0 font-medium">
                          <Star className="w-3.5 h-3.5 fill-current" />
                          {place.rating.toFixed(1)}
                        </span>
                      )}
                    </div>

                    {/* Address */}
                    <div className="flex items-start gap-1 text-xs text-gray-500">
                      <MapPin className="w-3 h-3 shrink-0 mt-0.5" />
                      <span className="line-clamp-1">{place.address}</span>
                    </div>

                    {/* Kids-friendly badge */}
                    {place.goodForChildren && (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 bg-green-50 border border-green-100 rounded-lg text-xs font-medium text-green-700">
                        Kids friendly
                      </div>
                    )}

                    {/* Add to trip button */}
                    <button
                      onClick={() => handleSaveFromSearch(place)}
                      disabled={savedIds.has(place.googlePlaceId) || savingIds.has(place.googlePlaceId)}
                      className={cn(
                        "w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium rounded-xl transition-colors",
                        savedIds.has(place.googlePlaceId)
                          ? "bg-green-50 text-green-700 cursor-default"
                          : savingIds.has(place.googlePlaceId)
                            ? "bg-indigo-100 text-indigo-500 cursor-wait"
                            : "bg-indigo-600 text-white hover:bg-indigo-700"
                      )}
                    >
                      {savedIds.has(place.googlePlaceId) ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          Added
                        </>
                      ) : savingIds.has(place.googlePlaceId) ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Adding...
                        </>
                      ) : (
                        <>
                          <Plus className="w-3.5 h-3.5" />
                          Add to trip
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Location selector */}
      <div className="mb-4">
        <label className="block text-xs font-medium text-gray-500 mb-1.5">Search in</label>
        <div className="relative inline-block w-full sm:w-72">
          <select
            value={selectedLocation}
            onChange={(e) => setSelectedLocation(e.target.value)}
            className="w-full appearance-none pl-3 pr-8 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {locationOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        </div>
        {selectedLocation === "__other__" && (
          <input
            type="text"
            placeholder="Enter a city or area..."
            value={customLocation}
            onChange={(e) => setCustomLocation(e.target.value)}
            className="mt-2 w-full sm:w-72 pl-3 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        )}
      </div>

      {/* Search field */}
      <div className="flex gap-2 mb-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder={`Search "museums", "parks", "tours"...`}
            value={customQuery}
            onChange={(e) => setCustomQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearchSubmit()}
            className="w-full pl-9 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <button
          onClick={handleSearchSubmit}
          disabled={loading}
          className="px-5 py-3 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-800 disabled:opacity-50 transition-colors"
        >
          Search
        </button>
      </div>

      {/* Quick filter pills */}
      <div className="flex gap-2 flex-wrap mb-6">
        {QUICK_FILTERS.map((filter) => (
          <button
            key={filter.query}
            onClick={() => handleFilterSelect(filter)}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-full border transition-colors",
              activeFilter === filter.query
                ? "bg-indigo-600 text-white border-indigo-600"
                : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300 hover:text-indigo-600"
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        </div>
      )}

      {/* Viator destination banner */}
      {!loading && searchResults.length > 0 && effectiveLocation && (
        <ViatorDestinationBanner destination={effectiveLocation} />
      )}

      {/* Search results */}
      {!loading && searchResults.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-900">Search Results</h2>
            <button
              onClick={() => setSearchResults([])}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              Clear results
            </button>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            {searchResults.map((place) => (
              <div
                key={place.googlePlaceId}
                className="bg-white border border-gray-100 rounded-2xl overflow-hidden hover:border-gray-200 hover:shadow-sm transition-all"
              >
                {/* Image */}
                {place.imageUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={place.imageUrl} alt="" className="w-full h-40 object-cover" />
                ) : (
                  <div className="w-full h-40 bg-gradient-to-br from-indigo-50 to-purple-50 flex items-center justify-center">
                    <Star className="w-8 h-8 text-indigo-200" />
                  </div>
                )}

                <div className="p-4 space-y-2.5">
                  {/* Name + rating */}
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-gray-900 text-sm leading-tight">
                      {place.name}
                    </h3>
                    {place.rating != null && (
                      <span className="flex items-center gap-0.5 text-yellow-600 text-xs shrink-0 font-medium">
                        <Star className="w-3.5 h-3.5 fill-current" />
                        {place.rating.toFixed(1)}
                        {place.ratingCount != null && (
                          <span className="text-gray-400 font-normal ml-0.5">
                            ({place.ratingCount.toLocaleString()})
                          </span>
                        )}
                      </span>
                    )}
                  </div>

                  {/* Address */}
                  <div className="flex items-start gap-1 text-xs text-gray-500">
                    <MapPin className="w-3 h-3 shrink-0 mt-0.5" />
                    <span className="line-clamp-2">{place.address}</span>
                  </div>

                  {/* Price + open status */}
                  <div className="flex items-center gap-2 text-xs">
                    {place.priceLevel && PRICE_LABEL[place.priceLevel] && (
                      <span className="font-semibold text-gray-700">
                        {PRICE_LABEL[place.priceLevel]}
                      </span>
                    )}
                    {place.openNow != null && (
                      <span className={cn("font-medium", place.openNow ? "text-green-600" : "text-red-500")}>
                        {place.openNow ? "Open now" : "Closed"}
                      </span>
                    )}
                  </div>

                  {/* Kids-friendly badge */}
                  {place.goodForChildren && (
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-green-50 border border-green-100 rounded-lg text-xs font-medium text-green-700">
                      Kids friendly
                    </div>
                  )}

                  {/* Type tags */}
                  {place.types.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      {place.types
                        .filter((t) => !["point_of_interest", "establishment", "food", "store"].includes(t))
                        .slice(0, 4)
                        .map((type) => (
                          <span
                            key={type}
                            className="px-1.5 py-0.5 text-[10px] bg-indigo-50 text-indigo-600 rounded capitalize"
                          >
                            {type.replace(/_/g, " ")}
                          </span>
                        ))}
                    </div>
                  )}

                  {/* Add to trip button */}
                  <button
                    onClick={() => handleSaveFromSearch(place)}
                    disabled={savedIds.has(place.googlePlaceId) || savingIds.has(place.googlePlaceId)}
                    className={cn(
                      "w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium rounded-xl transition-colors",
                      savedIds.has(place.googlePlaceId)
                        ? "bg-green-50 text-green-700 cursor-default"
                        : savingIds.has(place.googlePlaceId)
                          ? "bg-indigo-100 text-indigo-500 cursor-wait"
                          : "bg-indigo-600 text-white hover:bg-indigo-700"
                    )}
                  >
                    {savedIds.has(place.googlePlaceId) ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        Added
                      </>
                    ) : savingIds.has(place.googlePlaceId) ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Adding...
                      </>
                    ) : (
                      <>
                        <Plus className="w-3.5 h-3.5" />
                        Add to trip
                      </>
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add manual form */}
      {showAddForm && (
        <div className="bg-white border border-indigo-200 rounded-2xl p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Add Activity</h3>
            <button onClick={() => setShowAddForm(false)} className="p-2">
              <X className="w-4 h-4 text-gray-400" />
            </button>
          </div>
          <div className="space-y-3">
            <input
              type="text"
              placeholder="Activity name *"
              value={addForm.name}
              onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                placeholder="Address"
                value={addForm.address}
                onChange={(e) => setAddForm((f) => ({ ...f, address: e.target.value }))}
                className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <input
                type="text"
                placeholder="Category (museum, beach, etc.)"
                value={addForm.category}
                onChange={(e) => setAddForm((f) => ({ ...f, category: e.target.value }))}
                className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Duration (min)</label>
                <input
                  type="number"
                  value={addForm.durationMins}
                  onChange={(e) => setAddForm((f) => ({ ...f, durationMins: parseInt(e.target.value) || 60 }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Cost/adult ($)</label>
                <input
                  type="number"
                  value={addForm.costPerAdult}
                  onChange={(e) => setAddForm((f) => ({ ...f, costPerAdult: parseFloat(e.target.value) || 0 }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Priority</label>
                <select
                  value={addForm.priority}
                  onChange={(e) => setAddForm((f) => ({ ...f, priority: e.target.value as typeof addForm.priority }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                >
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p} value={p}>{priorityLabel(p)}</option>
                  ))}
                </select>
              </div>
            </div>
            <input
              type="url"
              placeholder="Booking link (optional)"
              value={addForm.bookingLink}
              onChange={(e) => setAddForm((f) => ({ ...f, bookingLink: e.target.value }))}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <textarea
              placeholder="Notes..."
              value={addForm.notes}
              onChange={(e) => setAddForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
            <label className="flex items-center gap-2 text-sm text-gray-700 p-1">
              <input
                type="checkbox"
                checked={addForm.reservationNeeded}
                onChange={(e) => setAddForm((f) => ({ ...f, reservationNeeded: e.target.checked }))}
                className="rounded"
              />
              Reservation required
            </label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-gray-700 p-1">
                <input
                  type="checkbox"
                  checked={addForm.isFixed}
                  onChange={(e) => setAddForm((f) => ({ ...f, isFixed: e.target.checked, fixedDateTime: e.target.checked ? f.fixedDateTime : "" }))}
                  className="rounded"
                />
                <Lock className="w-3.5 h-3.5 text-gray-400" />
                Date is locked (tickets purchased in advance)
              </label>
              {addForm.isFixed && (
                <div className="flex items-center gap-2 ml-6">
                  <CalendarDays className="w-4 h-4 text-gray-400" />
                  <input
                    type="datetime-local"
                    value={addForm.fixedDateTime}
                    onChange={(e) => setAddForm((f) => ({ ...f, fixedDateTime: e.target.value }))}
                    className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              )}
            </div>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setShowAddForm(false)}
                className="flex-1 py-2.5 border border-gray-200 text-gray-700 text-sm rounded-xl hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddManual}
                className="flex-1 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition-colors"
              >
                Add activity
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Priority / status filters for saved activities */}
      <div className="flex items-center gap-3 mb-4 overflow-x-auto pb-1">
        <div className="flex gap-1 shrink-0">
          {["ALL", ...PRIORITY_OPTIONS].map((p) => (
            <button
              key={p}
              onClick={() => setFilterPriority(p)}
              className={cn(
                "px-3 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap",
                filterPriority === p
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              )}
            >
              {p === "ALL" ? "All" : priorityLabel(p)}
            </button>
          ))}
        </div>
        <div className="h-4 w-px bg-gray-200 shrink-0" />
        <div className="flex gap-1 shrink-0">
          {["ALL", "WISHLIST", "SCHEDULED", "DONE"].map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={cn(
                "px-3 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap",
                filterStatus === s
                  ? "bg-gray-900 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              )}
            >
              {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Activity list */}
      {filtered.length === 0 && (
        <div className="text-center py-16">
          <Star className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">No activities yet</p>
          <p className="text-gray-400 text-xs mt-1">Search for places or add one manually</p>
        </div>
      )}

      <div className="space-y-3">
        {filtered.map((activity) => {
          const hours = parseHoursJson(activity.hoursJson)
          return (
          <div
            key={activity.id}
            className="bg-white border border-gray-100 rounded-2xl p-4 hover:border-gray-200 transition-colors group"
          >
            <div className="flex items-start gap-3">
              {activity.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={activity.imageUrl}
                  alt=""
                  className="w-16 h-16 rounded-xl object-cover shrink-0"
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-gray-900 text-sm truncate">{activity.name}</h3>
                      <span
                        className={cn(
                          "px-2 py-0.5 text-[11px] font-medium rounded-full shrink-0",
                          priorityColor(activity.priority)
                        )}
                      >
                        {priorityLabel(activity.priority)}
                      </span>
                      {activity.status === "SCHEDULED" && (
                        <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-green-50 text-green-700 shrink-0">
                          Scheduled
                        </span>
                      )}
                      {activity.isFixed && (
                        <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-indigo-50 text-indigo-700 flex items-center gap-0.5 shrink-0">
                          <Lock className="w-2.5 h-2.5" />
                          Locked
                        </span>
                      )}
                      {activity.reservationNeeded && (
                        <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-amber-50 text-amber-700 shrink-0">
                          Reservation needed
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
                      {activity.address && (
                        <span className="flex items-center gap-1 truncate max-w-[200px]">
                          <MapPin className="w-3 h-3 shrink-0" />
                          <span className="truncate">{activity.address}</span>
                        </span>
                      )}
                      <span className="flex items-center gap-1 shrink-0">
                        <Clock className="w-3 h-3" />
                        {activity.durationMins} min
                      </span>
                      {activity.costPerAdult > 0 && (
                        <span className="flex items-center gap-1 shrink-0">
                          <DollarSign className="w-3 h-3" />
                          {formatCurrency(activity.costPerAdult)}/adult
                        </span>
                      )}
                      {activity.rating && (
                        <span className="flex items-center gap-1 text-yellow-600 shrink-0">
                          <Star className="w-3 h-3 fill-current" />
                          {activity.rating}
                        </span>
                      )}
                      {activity.isFixed && activity.fixedDateTime && (
                        <span className="flex items-center gap-1 text-indigo-600 shrink-0">
                          <CalendarDays className="w-3 h-3" />
                          {new Date(activity.fixedDateTime).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>
                      )}
                    </div>

                    {/* Website & phone from Places Detail */}
                    {(activity.websiteUrl || activity.bookingLink) && (
                      <div className="flex items-center gap-3 mt-1 text-xs">
                        {activity.websiteUrl && (
                          <a
                            href={activity.websiteUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-indigo-600 hover:text-indigo-800 transition-colors"
                          >
                            <Globe className="w-3 h-3" />
                            Website
                          </a>
                        )}
                      </div>
                    )}

                    {activity.notes && (
                      <p className="text-xs text-gray-400 mt-1 line-clamp-2">{activity.notes}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {activity.bookingLink && (
                      <a
                        href={activity.bookingLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 text-gray-400 hover:text-indigo-600 transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                    <button
                      onClick={() => handleDelete(activity.id)}
                      className="p-2 text-gray-400 hover:text-red-500 transition-colors sm:opacity-0 sm:group-hover:opacity-100"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Hours section (collapsible) */}
                {hours && hours.length > 0 && (
                  <div className="mt-2">
                    <button
                      onClick={() =>
                        setExpandedActivityHours(
                          expandedActivityHours === activity.id ? null : activity.id
                        )
                      }
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
                    >
                      <Clock className="w-3 h-3" />
                      {expandedActivityHours === activity.id ? "Hide hours" : "Show hours"}
                    </button>
                    {expandedActivityHours === activity.id && (
                      <div className="mt-1.5 pl-4 space-y-0.5 text-[11px] text-gray-500">
                        {hours.map((line, i) => (
                          <div key={i}>{line}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Priority selector + lock toggle */}
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <span className="text-[11px] text-gray-400">Priority:</span>
                  <div className="flex gap-1">
                    {PRIORITY_OPTIONS.map((p) => (
                      <button
                        key={p}
                        onClick={() => handlePriorityChange(activity.id, p)}
                        className={cn(
                          "px-2 py-1 text-[10px] font-medium rounded-md transition-colors",
                          activity.priority === p
                            ? priorityColor(p)
                            : "text-gray-400 hover:text-gray-600"
                        )}
                      >
                        {priorityLabel(p)}
                      </button>
                    ))}
                  </div>
                  <div className="h-3 w-px bg-gray-200" />
                  <button
                    onClick={() => handleToggleFixed(activity.id, activity.isFixed)}
                    className={cn(
                      "flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md transition-colors",
                      activity.isFixed
                        ? "bg-indigo-50 text-indigo-700"
                        : "text-gray-400 hover:text-gray-600"
                    )}
                  >
                    <Lock className="w-2.5 h-2.5" />
                    {activity.isFixed ? "Locked" : "Lock date"}
                  </button>
                </div>

                {/* Affiliate booking links */}
                <ActivityBookingLinks activityName={activity.name} destination={effectiveLocation} />

                {/* Notes & Expenses row */}
                <div className="flex items-center gap-2 mt-2.5 pt-2.5 border-t border-gray-50">
                  <button
                    onClick={() => handleToggleNotes(activity.id)}
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors",
                      expandedNotes.has(activity.id)
                        ? "bg-indigo-50 text-indigo-700"
                        : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                    )}
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    Notes & Stories
                    {(noteCounts[activity.id] ?? 0) > 0 && (
                      <span className="ml-0.5 px-1.5 py-0.5 text-[10px] font-semibold bg-indigo-100 text-indigo-700 rounded-full">
                        {noteCounts[activity.id]}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => setExpenseOpen(expenseOpen === activity.id ? null : activity.id)}
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors",
                      expenseOpen === activity.id
                        ? "bg-green-50 text-green-700"
                        : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                    )}
                  >
                    <Receipt className="w-3.5 h-3.5" />
                    Add Expense
                  </button>
                </div>

                {/* Notes panel */}
                {expandedNotes.has(activity.id) && (
                  <div className="mt-2 bg-gray-50 rounded-xl p-3 space-y-3">
                    {notesLoading.has(activity.id) ? (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
                      </div>
                    ) : (
                      <>
                        {(notesByActivity[activity.id] || []).length === 0 && (
                          <p className="text-xs text-gray-400 text-center py-2">
                            No notes yet. Share a memory or story!
                          </p>
                        )}
                        {(notesByActivity[activity.id] || []).map((note) => (
                          <div key={note.id} className="flex items-start gap-2 group/note">
                            <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center text-[10px] font-semibold text-indigo-700 shrink-0 mt-0.5">
                              {note.user.image ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={note.user.image} alt="" className="w-6 h-6 rounded-full object-cover" />
                              ) : (
                                (note.user.name || "?").charAt(0).toUpperCase()
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-gray-700">
                                  {note.user.name || "You"}
                                </span>
                                <span className="text-[10px] text-gray-400">
                                  {new Date(note.createdAt).toLocaleDateString(undefined, {
                                    month: "short",
                                    day: "numeric",
                                    hour: "numeric",
                                    minute: "2-digit",
                                  })}
                                </span>
                              </div>
                              <p className="text-xs text-gray-600 mt-0.5 whitespace-pre-wrap">{note.text}</p>
                            </div>
                            <button
                              onClick={() => handleDeleteNote(activity.id, note.id)}
                              className="opacity-0 group-hover/note:opacity-100 p-1 text-gray-300 hover:text-red-500 transition-all shrink-0"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </>
                    )}
                    {/* Add note input */}
                    <div className="flex items-center gap-2 pt-1">
                      <input
                        ref={noteInputRef}
                        type="text"
                        placeholder="Add a note or story..."
                        value={noteInputs[activity.id] || ""}
                        onChange={(e) =>
                          setNoteInputs((prev) => ({ ...prev, [activity.id]: e.target.value }))
                        }
                        onKeyDown={(e) => e.key === "Enter" && handleAddNote(activity.id)}
                        className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                      />
                      <button
                        onClick={() => handleAddNote(activity.id)}
                        disabled={sendingNote.has(activity.id) || !(noteInputs[activity.id] || "").trim()}
                        className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors"
                      >
                        {sendingNote.has(activity.id) ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Send className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* Expense inline form */}
                {expenseOpen === activity.id && (
                  <div className="mt-2 bg-green-50 border border-green-100 rounded-xl p-3">
                    {expenseAdded.has(activity.id) ? (
                      <div className="flex items-center justify-center gap-2 py-2 text-green-700 text-sm font-medium">
                        <Check className="w-4 h-4" />
                        Added!
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-green-800 mb-1">Quick Expense</div>
                        <input
                          type="text"
                          placeholder='Description (e.g. "Souvenirs")'
                          value={expenseForm.description}
                          onChange={(e) => setExpenseForm((f) => ({ ...f, description: e.target.value }))}
                          className="w-full px-3 py-2 border border-green-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                        />
                        <div className="flex gap-2">
                          <input
                            type="number"
                            placeholder="Amount"
                            value={expenseForm.amount}
                            onChange={(e) => setExpenseForm((f) => ({ ...f, amount: e.target.value }))}
                            className="flex-1 px-3 py-2 border border-green-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                          />
                          <select
                            value={expenseForm.currency}
                            onChange={(e) => setExpenseForm((f) => ({ ...f, currency: e.target.value }))}
                            className="px-3 py-2 border border-green-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                          >
                            <option value="USD">USD</option>
                            <option value="EUR">EUR</option>
                            <option value="GBP">GBP</option>
                            <option value="JPY">JPY</option>
                            <option value="CAD">CAD</option>
                            <option value="AUD">AUD</option>
                            <option value="CHF">CHF</option>
                            <option value="MXN">MXN</option>
                          </select>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              setExpenseOpen(null)
                              setExpenseForm({ description: "", amount: "", currency: "USD" })
                            }}
                            className="flex-1 py-2 border border-green-200 text-green-700 text-xs rounded-lg hover:bg-green-100 transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleAddExpense(activity.id)}
                            disabled={sendingExpense}
                            className="flex-1 py-2 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
                          >
                            {sendingExpense ? "Adding..." : "Add Expense"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          )
        })}
      </div>
    </div>
  )
}
