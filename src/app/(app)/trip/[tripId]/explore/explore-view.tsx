"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { toast } from "sonner"
import {
  searchPlaces,
  cycleActivityInterest,
  removeFromShortlist,
  updateActivityPriority,
  addToItineraryFromExplore,
} from "@/lib/actions/activities"
import { cn } from "@/lib/utils"
import {
  Search,
  Star,
  MapPin,
  Loader2,
  ChevronDown,
  Bookmark,
  X,
  Calendar,
  ChevronRight,
  GripVertical,
  Clock,
  Sparkles,
  LayoutGrid,
  CalendarDays,
} from "lucide-react"
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
  useDroppable,
} from "@dnd-kit/core"
import { useDraggable } from "@dnd-kit/core"

/* ─── Types ────────────────────────────────────────────────────────────────── */

type Activity = {
  id: string
  name: string
  description: string | null
  address: string | null
  lat: number | null
  lng: number | null
  googlePlaceId: string | null
  category: string | null
  durationMins: number
  costPerAdult: number
  priority: string
  status: string
  rating: number | null
  imageUrl: string | null
  notes: string | null
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
  dineIn?: boolean
  delivery?: boolean
  takeout?: boolean
  openNow?: boolean
}

type ItineraryItem = {
  id: string
  date: string
  startTime?: string
  endTime?: string
  title: string
  type: string
  activityId?: string
  durationMins: number
}

type Destination = { name: string; lat?: number | null; lng?: number | null }

interface Props {
  tripId: string
  trip: { destination: string; startDate: string; endDate: string }
  savedActivities: Activity[]
  itineraryItems: ItineraryItem[]
  destinations: Destination[]
  arrivalCities: string[]
  travelerTags?: string[]
}

/* ─── Constants ────────────────────────────────────────────────────────────── */

const ACTIVITY_FILTERS = [
  { label: "Outdoor", query: "outdoor park nature hiking" },
  { label: "Cultural", query: "museum gallery cultural heritage" },
  { label: "Food & Drink", query: "food drink market tour tasting" },
  { label: "Nightlife", query: "nightlife bar club lounge" },
  { label: "Family", query: "family kids children amusement" },
  { label: "Tours", query: "guided tour walking tour" },
  { label: "Shopping", query: "shopping market boutique" },
  { label: "Landmarks", query: "landmark monument historic" },
]

const DINING_FILTERS = [
  { label: "American", query: "american restaurant" },
  { label: "Mexican", query: "mexican restaurant" },
  { label: "Italian", query: "italian restaurant" },
  { label: "Asian", query: "asian restaurant sushi ramen" },
  { label: "Quick", query: "fast food quick service" },
  { label: "Sit-down", query: "casual dining restaurant" },
  { label: "Fine Dining", query: "fine dining upscale" },
  { label: "Cafe", query: "cafe coffee shop" },
  { label: "Bar", query: "bar pub cocktail" },
]

const PRICE_LABEL: Record<string, string> = {
  PRICE_LEVEL_FREE: "Free",
  PRICE_LEVEL_INEXPENSIVE: "$",
  PRICE_LEVEL_MODERATE: "$$",
  PRICE_LEVEL_EXPENSIVE: "$$$",
  PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
}

const INTEREST_STATES: Record<string, { label: string; color: string; bgColor: string; icon: "outline" | "light" | "dark" | "gold" }> = {
  LOW: { label: "Looks Cool", color: "text-sky-500", bgColor: "bg-sky-50 border-sky-200", icon: "light" },
  HIGH: { label: "Really Want To", color: "text-indigo-600", bgColor: "bg-indigo-50 border-indigo-200", icon: "dark" },
  MUST_DO: { label: "Must Do!", color: "text-amber-600", bgColor: "bg-amber-50 border-amber-200", icon: "gold" },
}

/* ─── Helpers ──────────────────────────────────────────────────────────────── */

type LocationOption = { label: string; value: string; lat?: number | null; lng?: number | null }

function buildLocationOptions(
  destinations: Destination[],
  arrivalCities: string[],
  fallback: string
): LocationOption[] {
  const seen = new Set<string>()
  const opts: LocationOption[] = []
  for (const d of destinations) {
    const key = d.name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    opts.push({ label: d.name, value: d.name, lat: d.lat, lng: d.lng })
  }
  for (const c of arrivalCities) {
    const key = c.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    opts.push({ label: c, value: c })
  }
  if (opts.length === 0 && fallback) opts.push({ label: fallback, value: fallback })
  opts.push({ label: "Other location...", value: "__other__" })
  return opts
}

function getLocationBias(selected: string, opts: LocationOption[]): string | undefined {
  const o = opts.find((x) => x.value === selected)
  if (o?.lat != null && o?.lng != null) return `${o.lat},${o.lng}`
  return undefined
}

function getTripDays(startDate: string, endDate: string): { date: string; label: string }[] {
  const days: { date: string; label: string }[] = []
  const start = new Date(startDate + "T00:00:00")
  const end = new Date(endDate + "T00:00:00")
  const current = new Date(start)
  while (current <= end) {
    const dateStr = current.toISOString().split("T")[0]
    const label = current.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    days.push({ date: dateStr, label })
    current.setDate(current.getDate() + 1)
  }
  return days
}

const TIME_SLOTS = Array.from({ length: 15 }, (_, i) => {
  const hour = 8 + i
  return {
    time: `${String(hour).padStart(2, "0")}:00`,
    label: hour <= 12 ? `${hour}${hour === 12 ? "pm" : "am"}` : `${hour - 12}pm`,
  }
})

/* ─── Subcomponents ────────────────────────────────────────────────────────── */

function InterestButton({
  placeId,
  currentPriority,
  onCycle,
}: {
  placeId: string
  currentPriority: string | null
  onCycle: (placeId: string) => void
}) {
  const [flash, setFlash] = useState<string | null>(null)
  const state = currentPriority ? INTEREST_STATES[currentPriority] : null

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation()
    onCycle(placeId)

    // Determine what the NEXT state will be
    let nextLabel: string
    if (!currentPriority) nextLabel = "Looks Cool"
    else if (currentPriority === "LOW") nextLabel = "Really Want To"
    else if (currentPriority === "HIGH") nextLabel = "Must Do!"
    else if (currentPriority === "MUST_DO") nextLabel = "Removed"
    else nextLabel = "Really Want To"

    setFlash(nextLabel)
    setTimeout(() => setFlash(null), 1200)
  }

  return (
    <button
      onClick={handleClick}
      className="relative p-1.5 rounded-full transition-all hover:scale-110 active:scale-95"
      title={state?.label || "Save"}
    >
      {/* Flash label */}
      {flash && (
        <span className="absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-900 text-white z-10 animate-flash-label">
          {flash}
        </span>
      )}

      {!state && (
        <Bookmark className="w-5 h-5 text-white drop-shadow-md" />
      )}
      {state?.icon === "light" && (
        <Bookmark className="w-5 h-5 text-sky-400 fill-sky-400 drop-shadow-md" />
      )}
      {state?.icon === "dark" && (
        <Bookmark className="w-5 h-5 text-indigo-500 fill-indigo-500 drop-shadow-md" />
      )}
      {state?.icon === "gold" && (
        <Star className="w-5 h-5 text-amber-400 fill-amber-400 drop-shadow-md" />
      )}
    </button>
  )
}

function BrowseCard({
  place,
  interestPriority,
  onCycleInterest,
  onSelect,
}: {
  place: Place
  interestPriority: string | null
  onCycleInterest: (placeId: string) => void
  onSelect: (place: Place) => void
}) {
  const state = interestPriority ? INTEREST_STATES[interestPriority] : null

  return (
    <div
      className={cn(
        "bg-white border rounded-2xl overflow-hidden hover:shadow-md transition-all cursor-pointer group",
        state ? state.bgColor : "border-gray-100"
      )}
      onClick={() => onSelect(place)}
    >
      {/* Hero image */}
      <div className="relative aspect-video overflow-hidden">
        {place.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={place.imageUrl} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-indigo-50 to-purple-50 flex items-center justify-center">
            <Star className="w-8 h-8 text-indigo-200" />
          </div>
        )}
        {/* Interest button overlay */}
        <div className="absolute top-2 right-2">
          <InterestButton
            placeId={place.googlePlaceId}
            currentPriority={interestPriority}
            onCycle={onCycleInterest}
          />
        </div>
      </div>

      {/* Content */}
      <div className="p-3.5 space-y-1.5">
        <h3 className="font-semibold text-gray-900 text-sm leading-tight truncate">
          {place.name}
        </h3>

        {/* Stats row */}
        <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
          {place.priceLevel && PRICE_LABEL[place.priceLevel] && (
            <span className="font-semibold text-gray-700">
              {PRICE_LABEL[place.priceLevel]}
            </span>
          )}
          {place.rating != null && (
            <span className="flex items-center gap-0.5 text-yellow-600 font-medium">
              <Star className="w-3 h-3 fill-current" />
              {place.rating.toFixed(1)}
            </span>
          )}
          {place.types?.length > 0 && (
            <span className="capitalize truncate max-w-[120px]">
              {place.types
                .filter((t) => !["point_of_interest", "establishment", "food", "store"].includes(t))
                .slice(0, 1)
                .map((t) => t.replace(/_/g, " "))
                .join(", ")}
            </span>
          )}
        </div>

        {/* Location */}
        <div className="flex items-start gap-1 text-xs text-gray-400">
          <MapPin className="w-3 h-3 shrink-0 mt-0.5" />
          <span className="line-clamp-1">{place.address}</span>
        </div>
      </div>
    </div>
  )
}

/* ─── Shortlist Mini Card (draggable) ──────────────────────────────────────── */

function DraggableShortlistItem({
  activity,
  onRemove,
  onCyclePriority,
  isMobile,
  onMobileTap,
}: {
  activity: Activity
  onRemove: (id: string) => void
  onCyclePriority: (id: string, current: string) => void
  isMobile: boolean
  onMobileTap: (activity: Activity) => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `shortlist-${activity.id}`,
    data: { activity },
    disabled: isMobile,
  })

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50, opacity: isDragging ? 0.5 : 1 }
    : undefined

  const state = INTEREST_STATES[activity.priority]

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 px-2 py-1.5 rounded-lg group/item hover:bg-gray-50 transition-colors",
        isDragging && "shadow-lg bg-white ring-2 ring-indigo-300"
      )}
      onClick={() => isMobile && onMobileTap(activity)}
    >
      {!isMobile && (
        <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing shrink-0 text-gray-300 hover:text-gray-500">
          <GripVertical className="w-3.5 h-3.5" />
        </div>
      )}
      {activity.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={activity.imageUrl} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0" />
      ) : (
        <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
          <Star className="w-4 h-4 text-gray-300" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-gray-900 truncate">{activity.name}</div>
        <div className="text-[10px] text-gray-400">{activity.durationMins} min</div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onCyclePriority(activity.id, activity.priority)
        }}
        className="shrink-0 p-0.5"
        title={state?.label}
      >
        {state?.icon === "light" && <Bookmark className="w-3.5 h-3.5 text-sky-400 fill-sky-400" />}
        {state?.icon === "dark" && <Bookmark className="w-3.5 h-3.5 text-indigo-500 fill-indigo-500" />}
        {state?.icon === "gold" && <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />}
        {!state && <Bookmark className="w-3.5 h-3.5 text-gray-300" />}
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onRemove(activity.id)
        }}
        className="shrink-0 p-0.5 text-gray-300 hover:text-red-500 opacity-0 group-hover/item:opacity-100 transition-opacity"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

/* ─── Itinerary Drop Zone ──────────────────────────────────────────────────── */

function TimeSlotDropZone({
  date,
  time,
  label,
  items,
}: {
  date: string
  time: string
  label: string
  items: ItineraryItem[]
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `drop-${date}-${time}`,
    data: { date, time },
  })

  const slotItems = items.filter(
    (i) => i.date === date && i.startTime && i.startTime.startsWith(time.split(":")[0])
  )

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex gap-2 items-start py-1 px-2 rounded-lg transition-colors min-h-[32px]",
        isOver ? "bg-indigo-50 ring-1 ring-indigo-300" : "hover:bg-gray-50"
      )}
    >
      <span className="text-[10px] text-gray-400 w-10 shrink-0 pt-1 font-mono">{label}</span>
      <div className="flex-1 min-w-0">
        {slotItems.length > 0 ? (
          slotItems.map((item) => (
            <div
              key={item.id}
              className="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded-md mb-0.5 truncate"
            >
              {item.title}
              {item.durationMins > 0 && <span className="text-indigo-400 ml-1">({item.durationMins}m)</span>}
            </div>
          ))
        ) : (
          <div className="text-[10px] text-gray-300 pt-1">
            {isOver ? "Drop here" : ""}
          </div>
        )}
      </div>
    </div>
  )
}

/* ─── Mobile Day Selector Bottom Sheet ─────────────────────────────────────── */

function MobileDaySelector({
  days,
  onSelect,
  onClose,
  activityName,
}: {
  days: { date: string; label: string }[]
  onSelect: (date: string, time: string) => void
  onClose: () => void
  activityName: string
}) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null)

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl max-h-[70vh] overflow-y-auto p-4 pb-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm text-gray-900">
            Add &quot;{activityName}&quot; to itinerary
          </h3>
          <button onClick={onClose} className="p-1">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {!selectedDay ? (
          <div className="space-y-1">
            <p className="text-xs text-gray-500 mb-2">Pick a day:</p>
            {days.map((day) => (
              <button
                key={day.date}
                onClick={() => setSelectedDay(day.date)}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-gray-50 text-left"
              >
                <span className="text-sm font-medium text-gray-800">{day.label}</span>
                <ChevronRight className="w-4 h-4 text-gray-400" />
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            <button
              onClick={() => setSelectedDay(null)}
              className="text-xs text-indigo-600 mb-2 flex items-center gap-1"
            >
              <ChevronRight className="w-3 h-3 rotate-180" />
              Back to days
            </button>
            <p className="text-xs text-gray-500 mb-2">Pick a time:</p>
            {TIME_SLOTS.map((slot) => (
              <button
                key={slot.time}
                onClick={() => {
                  onSelect(selectedDay, slot.time)
                  onClose()
                }}
                className="w-full text-left px-3 py-2 rounded-xl hover:bg-indigo-50 text-sm text-gray-700"
              >
                {slot.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ─── Main Component ───────────────────────────────────────────────────────── */

export function ExploreView({
  tripId,
  trip,
  savedActivities: initialActivities,
  itineraryItems: initialItinerary,
  destinations,
  arrivalCities,
  travelerTags = [],
}: Props) {
  const locationOptions = buildLocationOptions(destinations, arrivalCities, trip.destination)
  const tripDays = getTripDays(trip.startDate, trip.endDate)

  // Core state
  const [mode, setMode] = useState<"browse" | "plan">("browse")
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<"activities" | "dining">("activities")
  const [searchQuery, setSearchQuery] = useState("")
  const [activeFilter, setActiveFilter] = useState<string | null>(null)
  const [selectedLocation, setSelectedLocation] = useState(locationOptions[0]?.value ?? trip.destination)
  const [customLocation, setCustomLocation] = useState("")
  const [searchResults, setSearchResults] = useState<Place[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null)

  // Saved activities as local state
  const [activities, setActivities] = useState<Activity[]>(initialActivities)
  const [itinerary, setItinerary] = useState<ItineraryItem[]>(initialItinerary)

  // Interest map: googlePlaceId -> priority
  const interestMap = new Map<string, string>()
  for (const a of activities) {
    if (a.googlePlaceId && (a.status === "WISHLIST" || a.status === "SCHEDULED")) {
      interestMap.set(a.googlePlaceId, a.priority)
    }
  }

  // Mobile state
  const [mobileDaySelector, setMobileDaySelector] = useState<Activity | null>(null)
  const [isMobile, setIsMobile] = useState(false)

  // Auto-suggest
  const [suggestions, setSuggestions] = useState<Place[]>([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const suggestionsLoaded = useRef(false)

  // Cycling interest feedback
  const [cyclingIds, setCyclingIds] = useState<Set<string>>(new Set())

  const effectiveLocation = selectedLocation === "__other__" ? customLocation : selectedLocation
  const locationBias = getLocationBias(selectedLocation, locationOptions)

  const filters = activeTab === "activities" ? ACTIVITY_FILTERS : DINING_FILTERS

  // Shortlist: all WISHLIST activities
  const shortlist = activities.filter((a) => a.status === "WISHLIST")
  const mustDoItems = shortlist.filter((a) => a.priority === "MUST_DO")
  const highItems = shortlist.filter((a) => a.priority === "HIGH")
  const lowItems = shortlist.filter((a) => a.priority === "LOW")
  const mediumItems = shortlist.filter((a) => a.priority === "MEDIUM")

  // Detect mobile
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener("resize", check)
    return () => window.removeEventListener("resize", check)
  }, [])

  // Auto-suggest on mount
  useEffect(() => {
    if (suggestionsLoaded.current) return
    suggestionsLoaded.current = true

    const city = locationOptions[0]?.value || trip.destination
    if (!city) return

    const hasKids = travelerTags.some((t) => t === "child" || t === "toddler")
    const prefix = hasKids ? "family friendly things to do" : "top things to do"
    const query = `${prefix} in ${city}`

    setSuggestionsLoading(true)
    const bias = locationOptions[0]?.lat != null && locationOptions[0]?.lng != null
      ? `${locationOptions[0].lat},${locationOptions[0].lng}`
      : undefined

    searchPlaces(query, bias)
      .then((r) => { if (r.results.length > 0) setSuggestions(r.results) })
      .catch(() => {})
      .finally(() => setSuggestionsLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Handlers
  async function handleSearch(filterQuery?: string, keyword?: string) {
    const city = effectiveLocation || trip.destination
    const typePrefix = activeTab === "dining" ? "restaurant " : ""
    const parts = [typePrefix, filterQuery, keyword, city].filter(Boolean)
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

  function handleFilterSelect(filter: { query: string }) {
    const next = activeFilter === filter.query ? null : filter.query
    setActiveFilter(next)
    handleSearch(next || undefined, searchQuery || undefined)
  }

  function handleSearchSubmit() {
    handleSearch(activeFilter || undefined, searchQuery || undefined)
  }

  async function handleCycleInterest(placeId: string) {
    if (cyclingIds.has(placeId)) return
    setCyclingIds((prev) => new Set([...prev, placeId]))

    // Find the place data from search results or suggestions
    const place = [...searchResults, ...suggestions].find((p) => p.googlePlaceId === placeId)
    if (!place) {
      setCyclingIds((prev) => { const n = new Set(prev); n.delete(placeId); return n })
      return
    }

    const currentPriority = interestMap.get(placeId) || null

    try {
      const result = await cycleActivityInterest(tripId, {
        googlePlaceId: place.googlePlaceId,
        name: place.name,
        address: place.address,
        lat: place.lat,
        lng: place.lng,
        rating: place.rating,
        imageUrl: place.imageUrl || undefined,
        category: place.types?.[0],
        durationMins: activeTab === "dining" ? 90 : 120,
        currentPriority,
      })

      if (result.action === "deleted") {
        setActivities((prev) => prev.filter((a) => a.googlePlaceId !== placeId))
      } else if (result.action === "created") {
        setActivities((prev) => [result.activity as Activity, ...prev])
      } else {
        setActivities((prev) =>
          prev.map((a) => (a.googlePlaceId === placeId ? { ...a, priority: result.newPriority! } : a))
        )
      }
    } catch {
      toast.error("Failed to update interest")
    } finally {
      setCyclingIds((prev) => { const n = new Set(prev); n.delete(placeId); return n })
    }
  }

  async function handleRemoveFromShortlist(activityId: string) {
    try {
      await removeFromShortlist(tripId, activityId)
      setActivities((prev) => prev.filter((a) => a.id !== activityId))
      toast.success("Removed from shortlist")
    } catch {
      toast.error("Failed to remove")
    }
  }

  async function handleCyclePriority(activityId: string, currentPriority: string) {
    const nextMap: Record<string, "MUST_DO" | "HIGH" | "LOW"> = {
      LOW: "HIGH",
      HIGH: "MUST_DO",
      MUST_DO: "LOW",
      MEDIUM: "HIGH",
    }
    const next = nextMap[currentPriority] || "HIGH"

    try {
      await updateActivityPriority(tripId, activityId, next)
      setActivities((prev) =>
        prev.map((a) => (a.id === activityId ? { ...a, priority: next } : a))
      )
    } catch {
      toast.error("Failed to update priority")
    }
  }

  async function handleAddToItinerary(activityId: string, date: string, time: string) {
    try {
      const item = await addToItineraryFromExplore(tripId, activityId, date, time)
      setItinerary((prev) => [...prev, {
        id: item.id,
        date,
        startTime: time,
        endTime: item.endTime || undefined,
        title: item.title,
        type: item.type,
        activityId: item.activityId || undefined,
        durationMins: item.durationMins,
      }])
      setActivities((prev) =>
        prev.map((a) => (a.id === activityId ? { ...a, status: "SCHEDULED" } : a))
      )
      toast.success("Added to itinerary!")
    } catch {
      toast.error("Failed to add to itinerary")
    }
  }

  // DnD
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )
  const [draggedActivity, setDraggedActivity] = useState<Activity | null>(null)

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data?.current
    if (data?.activity) setDraggedActivity(data.activity)
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggedActivity(null)
    const { active, over } = event
    if (!over) return

    const overId = String(over.id)
    if (!overId.startsWith("drop-")) return

    const data = active.data?.current
    if (!data?.activity) return

    const parts = overId.split("-")
    const date = parts[1]
    const time = parts.slice(2).join(":")
    handleAddToItinerary(data.activity.id, date, time)
  }

  const shortlistCount = shortlist.length + mediumItems.length

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex h-[calc(100vh-57px)] md:h-screen overflow-hidden">
        {/* Browse Area */}
        <div className={cn(
          "flex-1 overflow-y-auto transition-all",
          mode === "plan" && !isMobile ? "w-[60%]" : "w-full"
        )}>
          <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-5 gap-3">
              <div className="min-w-0">
                <h1 className="text-2xl font-bold text-gray-900">Explore</h1>
                <p className="text-gray-500 text-sm mt-0.5">
                  Discover activities and dining for your trip
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setMode(mode === "browse" ? "plan" : "browse")}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl border transition-colors",
                    mode === "plan"
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-white text-gray-700 border-gray-200 hover:border-indigo-300"
                  )}
                >
                  {mode === "plan" ? <LayoutGrid className="w-3.5 h-3.5" /> : <CalendarDays className="w-3.5 h-3.5" />}
                  {mode === "plan" ? "Browse" : "Plan"}
                </button>
              </div>
            </div>

            {/* Tab switcher */}
            <div className="flex gap-1 p-1 bg-gray-100 rounded-xl mb-4 w-fit">
              <button
                onClick={() => { setActiveTab("activities"); setSearchResults([]); setActiveFilter(null) }}
                className={cn(
                  "px-4 py-1.5 text-xs font-medium rounded-lg transition-colors",
                  activeTab === "activities" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                )}
              >
                Activities
              </button>
              <button
                onClick={() => { setActiveTab("dining"); setSearchResults([]); setActiveFilter(null) }}
                className={cn(
                  "px-4 py-1.5 text-xs font-medium rounded-lg transition-colors",
                  activeTab === "dining" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                )}
              >
                Dining
              </button>
            </div>

            {/* Location selector */}
            <div className="mb-3">
              <div className="relative inline-block w-full sm:w-72">
                <select
                  value={selectedLocation}
                  onChange={(e) => setSelectedLocation(e.target.value)}
                  className="w-full appearance-none pl-3 pr-8 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {locationOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
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

            {/* Search bar */}
            <div className="flex gap-2 mb-3">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder={activeTab === "activities" ? `Search "museums", "parks", "tours"...` : `Search "sushi", "Italian", "BBQ"...`}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearchSubmit()}
                  className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <button
                onClick={handleSearchSubmit}
                disabled={loading}
                className="px-4 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                Search
              </button>
            </div>

            {/* Filter chips — horizontal scroll on mobile */}
            <div className="flex gap-2 overflow-x-auto pb-2 mb-4 -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap scrollbar-hide">
              {filters.map((filter) => (
                <button
                  key={filter.query}
                  onClick={() => handleFilterSelect(filter)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium rounded-full border transition-colors whitespace-nowrap shrink-0",
                    activeFilter === filter.query
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300 hover:text-indigo-600"
                  )}
                >
                  {filter.label}
                </button>
              ))}
            </div>

            {/* Auto-suggested */}
            {!loading && searchResults.length === 0 && (suggestionsLoading || suggestions.length > 0) && (
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="w-4 h-4 text-indigo-600" />
                  <h2 className="text-sm font-semibold text-indigo-900">Suggested for your trip</h2>
                </div>
                {suggestionsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {suggestions.map((place) => (
                      <BrowseCard
                        key={place.googlePlaceId}
                        place={place}
                        interestPriority={interestMap.get(place.googlePlaceId) || null}
                        onCycleInterest={handleCycleInterest}
                        onSelect={setSelectedPlace}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Loading */}
            {loading && (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
              </div>
            )}

            {/* Search results */}
            {!loading && searchResults.length > 0 && (
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-gray-900">
                    {searchResults.length} results
                  </h2>
                  <button
                    onClick={() => setSearchResults([])}
                    className="text-xs text-gray-400 hover:text-gray-600"
                  >
                    Clear
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {searchResults.map((place) => (
                    <BrowseCard
                      key={place.googlePlaceId}
                      place={place}
                      interestPriority={interestMap.get(place.googlePlaceId) || null}
                      onCycleInterest={handleCycleInterest}
                      onSelect={setSelectedPlace}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Empty state */}
            {!loading && searchResults.length === 0 && suggestions.length === 0 && !suggestionsLoading && (
              <div className="text-center py-20">
                <Search className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                <p className="text-gray-500 text-sm">
                  Search for {activeTab === "activities" ? "activities" : "restaurants"} or pick a filter
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Itinerary Panel (plan mode, desktop) */}
        {mode === "plan" && !isMobile && (
          <div className="w-[40%] border-l border-gray-200 bg-gray-50 overflow-y-auto">
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-900 text-sm">Itinerary</h2>
                <button
                  onClick={() => setMode("browse")}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Shortlist in plan mode - draggable items */}
              {shortlistCount > 0 && (
                <div className="mb-4 bg-white rounded-xl border border-gray-100 p-3">
                  <h3 className="text-xs font-semibold text-gray-600 mb-2">
                    Drag items to a time slot
                  </h3>
                  <div className="space-y-0.5">
                    {[...mustDoItems, ...highItems, ...lowItems, ...mediumItems].map((a) => (
                      <DraggableShortlistItem
                        key={a.id}
                        activity={a}
                        onRemove={handleRemoveFromShortlist}
                        onCyclePriority={handleCyclePriority}
                        isMobile={false}
                        onMobileTap={() => {}}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Day-by-day timeline */}
              {tripDays.map((day) => (
                <div key={day.date} className="mb-4">
                  <h3 className="text-xs font-semibold text-gray-700 mb-1 sticky top-0 bg-gray-50 py-1">
                    {day.label}
                  </h3>
                  <div className="bg-white rounded-xl border border-gray-100 p-2 space-y-0">
                    {TIME_SLOTS.map((slot) => (
                      <TimeSlotDropZone
                        key={`${day.date}-${slot.time}`}
                        date={day.date}
                        time={slot.time}
                        label={slot.label}
                        items={itinerary}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Shortlist Sidebar (browse mode) */}
        {mode === "browse" && !isMobile && sidebarOpen && (
          <div className="w-80 border-l border-gray-200 bg-white overflow-y-auto">
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-900 text-sm">Shortlist</h2>
                <button onClick={() => setSidebarOpen(false)} className="p-1">
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              </div>

              {shortlistCount === 0 && (
                <div className="text-center py-8">
                  <Bookmark className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                  <p className="text-xs text-gray-400">Tap the bookmark icon on any card to save it</p>
                </div>
              )}

              {/* Must Do */}
              {mustDoItems.length > 0 && (
                <div className="mb-3">
                  <h3 className="text-xs font-semibold text-amber-600 mb-1 flex items-center gap-1">
                    <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                    Must Do ({mustDoItems.length})
                  </h3>
                  <div className="space-y-0.5">
                    {mustDoItems.map((a) => (
                      <DraggableShortlistItem
                        key={a.id}
                        activity={a}
                        onRemove={handleRemoveFromShortlist}
                        onCyclePriority={handleCyclePriority}
                        isMobile={false}
                        onMobileTap={() => {}}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Really Want To */}
              {highItems.length > 0 && (
                <div className="mb-3">
                  <h3 className="text-xs font-semibold text-indigo-600 mb-1 flex items-center gap-1">
                    <Bookmark className="w-3 h-3 fill-indigo-500 text-indigo-500" />
                    Really Want To ({highItems.length})
                  </h3>
                  <div className="space-y-0.5">
                    {highItems.map((a) => (
                      <DraggableShortlistItem
                        key={a.id}
                        activity={a}
                        onRemove={handleRemoveFromShortlist}
                        onCyclePriority={handleCyclePriority}
                        isMobile={false}
                        onMobileTap={() => {}}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Looks Cool */}
              {(lowItems.length > 0 || mediumItems.length > 0) && (
                <div className="mb-3">
                  <h3 className="text-xs font-semibold text-sky-500 mb-1 flex items-center gap-1">
                    <Bookmark className="w-3 h-3 fill-sky-400 text-sky-400" />
                    Looks Cool ({lowItems.length + mediumItems.length})
                  </h3>
                  <div className="space-y-0.5">
                    {[...lowItems, ...mediumItems].map((a) => (
                      <DraggableShortlistItem
                        key={a.id}
                        activity={a}
                        onRemove={handleRemoveFromShortlist}
                        onCyclePriority={handleCyclePriority}
                        isMobile={false}
                        onMobileTap={() => {}}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Floating shortlist pill (browse mode, sidebar closed) */}
        {mode === "browse" && !sidebarOpen && shortlistCount > 0 && !isMobile && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="fixed bottom-6 right-6 z-30 flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-full shadow-lg hover:bg-indigo-700 transition-colors"
          >
            <Bookmark className="w-4 h-4 fill-white" />
            {shortlistCount} saved
          </button>
        )}

        {/* Mobile floating shortlist pill */}
        {shortlistCount > 0 && isMobile && !sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="fixed bottom-20 right-4 z-30 flex items-center gap-2 px-3.5 py-2 bg-indigo-600 text-white text-xs font-medium rounded-full shadow-lg"
          >
            <Bookmark className="w-3.5 h-3.5 fill-white" />
            {shortlistCount} saved
          </button>
        )}

        {/* Mobile shortlist bottom sheet */}
        {isMobile && sidebarOpen && (
          <div className="fixed inset-0 z-40">
            <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} />
            <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl max-h-[75vh] overflow-y-auto pb-24">
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-semibold text-gray-900 text-sm">Shortlist ({shortlistCount})</h2>
                  <button onClick={() => setSidebarOpen(false)} className="p-1">
                    <X className="w-4 h-4 text-gray-400" />
                  </button>
                </div>

                {/* Must Do */}
                {mustDoItems.length > 0 && (
                  <div className="mb-3">
                    <h3 className="text-xs font-semibold text-amber-600 mb-1">Must Do</h3>
                    {mustDoItems.map((a) => (
                      <DraggableShortlistItem
                        key={a.id}
                        activity={a}
                        onRemove={handleRemoveFromShortlist}
                        onCyclePriority={handleCyclePriority}
                        isMobile={true}
                        onMobileTap={(act) => setMobileDaySelector(act)}
                      />
                    ))}
                  </div>
                )}

                {/* Really Want To */}
                {highItems.length > 0 && (
                  <div className="mb-3">
                    <h3 className="text-xs font-semibold text-indigo-600 mb-1">Really Want To</h3>
                    {highItems.map((a) => (
                      <DraggableShortlistItem
                        key={a.id}
                        activity={a}
                        onRemove={handleRemoveFromShortlist}
                        onCyclePriority={handleCyclePriority}
                        isMobile={true}
                        onMobileTap={(act) => setMobileDaySelector(act)}
                      />
                    ))}
                  </div>
                )}

                {/* Looks Cool */}
                {(lowItems.length + mediumItems.length > 0) && (
                  <div className="mb-3">
                    <h3 className="text-xs font-semibold text-sky-500 mb-1">Looks Cool</h3>
                    {[...lowItems, ...mediumItems].map((a) => (
                      <DraggableShortlistItem
                        key={a.id}
                        activity={a}
                        onRemove={handleRemoveFromShortlist}
                        onCyclePriority={handleCyclePriority}
                        isMobile={true}
                        onMobileTap={(act) => setMobileDaySelector(act)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Mobile Plan Mode (full-screen itinerary) */}
        {mode === "plan" && isMobile && (
          <div className="fixed inset-0 z-40 bg-gray-50 overflow-y-auto pb-24">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between z-10">
              <h2 className="font-semibold text-gray-900 text-sm">Plan Itinerary</h2>
              <button
                onClick={() => setMode("browse")}
                className="text-xs text-indigo-600 font-medium"
              >
                Back to Browse
              </button>
            </div>

            <div className="p-4">
              {/* Shortlist for mobile tap-to-add */}
              {shortlistCount > 0 && (
                <div className="mb-4 bg-white rounded-xl border border-gray-100 p-3">
                  <h3 className="text-xs font-semibold text-gray-600 mb-2">Tap to add to itinerary</h3>
                  {[...mustDoItems, ...highItems, ...lowItems, ...mediumItems].map((a) => (
                    <DraggableShortlistItem
                      key={a.id}
                      activity={a}
                      onRemove={handleRemoveFromShortlist}
                      onCyclePriority={handleCyclePriority}
                      isMobile={true}
                      onMobileTap={(act) => setMobileDaySelector(act)}
                    />
                  ))}
                </div>
              )}

              {/* Day-by-day timeline */}
              {tripDays.map((day) => {
                const dayItems = itinerary.filter((i) => i.date === day.date)
                return (
                  <div key={day.date} className="mb-4">
                    <h3 className="text-xs font-semibold text-gray-700 mb-1">{day.label}</h3>
                    <div className="bg-white rounded-xl border border-gray-100 p-3">
                      {dayItems.length > 0 ? (
                        <div className="space-y-1">
                          {dayItems.map((item) => (
                            <div key={item.id} className="text-xs bg-indigo-50 text-indigo-700 px-2.5 py-1.5 rounded-lg">
                              {item.startTime && <span className="font-mono text-indigo-400 mr-1">{item.startTime}</span>}
                              {item.title}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-300 text-center py-3">No items yet</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Mobile Day Selector */}
        {mobileDaySelector && (
          <MobileDaySelector
            days={tripDays}
            activityName={mobileDaySelector.name}
            onSelect={(date, time) => handleAddToItinerary(mobileDaySelector.id, date, time)}
            onClose={() => setMobileDaySelector(null)}
          />
        )}

        {/* Detail panel for selected place */}
        {selectedPlace && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
            <div className="absolute inset-0 bg-black/40" onClick={() => setSelectedPlace(null)} />
            <div className="relative bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[80vh] overflow-y-auto">
              {selectedPlace.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={selectedPlace.imageUrl} alt="" className="w-full h-48 object-cover rounded-t-2xl" />
              )}
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-bold text-lg text-gray-900">{selectedPlace.name}</h2>
                  <button onClick={() => setSelectedPlace(null)} className="p-1 shrink-0">
                    <X className="w-5 h-5 text-gray-400" />
                  </button>
                </div>

                <div className="flex items-center gap-3 mt-2 text-sm text-gray-500">
                  {selectedPlace.rating != null && (
                    <span className="flex items-center gap-1 text-yellow-600 font-medium">
                      <Star className="w-4 h-4 fill-current" />
                      {selectedPlace.rating.toFixed(1)}
                      {selectedPlace.ratingCount != null && (
                        <span className="text-gray-400 font-normal">({selectedPlace.ratingCount.toLocaleString()})</span>
                      )}
                    </span>
                  )}
                  {selectedPlace.priceLevel && PRICE_LABEL[selectedPlace.priceLevel] && (
                    <span className="font-semibold">{PRICE_LABEL[selectedPlace.priceLevel]}</span>
                  )}
                </div>

                <div className="flex items-start gap-1.5 mt-3 text-sm text-gray-500">
                  <MapPin className="w-4 h-4 shrink-0 mt-0.5" />
                  {selectedPlace.address}
                </div>

                {selectedPlace.types?.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap mt-3">
                    {selectedPlace.types
                      .filter((t) => !["point_of_interest", "establishment", "food", "store"].includes(t))
                      .slice(0, 6)
                      .map((type) => (
                        <span key={type} className="px-2 py-0.5 text-xs bg-indigo-50 text-indigo-600 rounded-full capitalize">
                          {type.replace(/_/g, " ")}
                        </span>
                      ))}
                  </div>
                )}

                <div className="mt-4">
                  <InterestButton
                    placeId={selectedPlace.googlePlaceId}
                    currentPriority={interestMap.get(selectedPlace.googlePlaceId) || null}
                    onCycle={handleCycleInterest}
                  />
                  <span className="ml-2 text-sm text-gray-500">
                    {interestMap.get(selectedPlace.googlePlaceId)
                      ? INTEREST_STATES[interestMap.get(selectedPlace.googlePlaceId)!]?.label || "Saved"
                      : "Tap to save"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* DnD Overlay */}
        <DragOverlay>
          {draggedActivity && (
            <div className="flex items-center gap-2 px-3 py-2 bg-white rounded-lg shadow-xl border border-indigo-200">
              {draggedActivity.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={draggedActivity.imageUrl} alt="" className="w-8 h-8 rounded object-cover" />
              ) : (
                <div className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center">
                  <Star className="w-4 h-4 text-gray-300" />
                </div>
              )}
              <span className="text-xs font-medium text-gray-900">{draggedActivity.name}</span>
            </div>
          )}
        </DragOverlay>
      </div>

      {/* CSS animations for flash label */}
      <style jsx global>{`
        @keyframes flash-label {
          0% { opacity: 0; transform: translate(-50%, 4px) scale(0.8); }
          15% { opacity: 1; transform: translate(-50%, 0) scale(1); }
          85% { opacity: 1; transform: translate(-50%, 0) scale(1); }
          100% { opacity: 0; transform: translate(-50%, -4px) scale(0.8); }
        }
        .animate-flash-label {
          animation: flash-label 1.2s ease-out forwards;
        }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </DndContext>
  )
}
