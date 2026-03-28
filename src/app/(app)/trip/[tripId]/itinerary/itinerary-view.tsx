"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  runOptimizer,
  runAIOptimizer,
  deleteItineraryItem,
  createItineraryItem,
  reorderItineraryItems,
  updateItineraryItemNotes,
  updateItineraryItem,
} from "@/lib/actions/itinerary"
import {
  updateActivityPriority,
  updateActivityStatus,
  removeActivityFromWishlist,
} from "@/lib/actions/activities"
import type { ItineraryItemResult } from "@/lib/actions/itinerary"
import { formatDate, formatTime } from "@/lib/utils"
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  useDroppable,
} from "@dnd-kit/core"
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  Plane,
  Hotel,
  Star,
  UtensilsCrossed,
  Bus,
  Clock,
  Sparkles,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Coffee,
  PenLine,
  Check,
  X,
  ExternalLink,
  LayoutList,
  CalendarClock,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { CalendarExportButton } from "@/components/calendar-export"
import { WeatherBar } from "@/components/weather-bar"
import { FlightStatusBadge } from "@/components/flight-status-badge"
import { AirportMapLink } from "@/components/airport-info"
import type { TripWeatherData } from "@/lib/weather"
import { groupByDay } from "@/lib/itinerary-utils"
import type { GroupedDay } from "@/lib/itinerary-utils"

import { WishlistPanel } from "./wishlist-panel"
import type { WishlistActivity } from "./wishlist-panel"
import { TimelineView } from "./timeline-view"
import { TravelConnector } from "./travel-connector"
import { DragOnboarding, markOnboardingSeen } from "./drag-onboarding"

// ─── Types ──────────────────────────────────────────────────────────────────

type ItineraryItem = {
  id: string
  date: Date
  startTime: string | null
  endTime: string | null
  type: string
  title: string
  notes: string | null
  userNotes: string | null
  durationMins: number
  travelTimeToNextMins: number
  costEstimate: number
  position: number
  isConfirmed: boolean
  flight?: {
    airline: string | null
    flightNumber: string | null
    departureAirport: string | null
    arrivalAirport: string | null
  } | null
  activity?: {
    lat: number | null
    lng: number | null
    address: string | null
    name: string
  } | null
  hotel?: {
    lat: number | null
    lng: number | null
    address: string | null
    name: string
  } | null
  activityId?: string | null
}

type HotelInfo = {
  id: string
  name: string
  lat: number | null
  lng: number | null
  checkIn: Date
  checkOut: Date
}

type FreeTimeBlock = {
  startTime: string
  endTime: string
  durationMins: number
  date: string
  afterItemIndex: number
}

// ─── Utility functions ──────────────────────────────────────────────────────

const DAY_START_HOUR = 8
const DAY_END_HOUR = 22

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number)
  return h * 60 + (m || 0)
}

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`
}

function formatDuration(mins: number) {
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function formatFreeTimeDuration(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m} min`
  if (m === 0) return `${h} hour${h !== 1 ? "s" : ""}`
  return `${h}.${Math.round((m / 60) * 10)} hours`
}

function computeFreeTimeBlocks(
  dayItems: ItineraryItem[],
  minGapMinutes: number = 120
): FreeTimeBlock[] {
  const blocks: FreeTimeBlock[] = []
  const dayStartMins = DAY_START_HOUR * 60
  const dayEndMins = DAY_END_HOUR * 60

  const timed = dayItems
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => item.startTime)
    .sort((a, b) => timeToMinutes(a.item.startTime!) - timeToMinutes(b.item.startTime!))

  if (timed.length === 0) {
    const gap = dayEndMins - dayStartMins
    if (gap >= minGapMinutes) {
      blocks.push({
        startTime: minutesToTime(dayStartMins),
        endTime: minutesToTime(dayEndMins),
        durationMins: gap,
        date: "",
        afterItemIndex: -1,
      })
    }
    return blocks
  }

  const firstStart = timeToMinutes(timed[0].item.startTime!)
  if (firstStart - dayStartMins >= minGapMinutes) {
    blocks.push({
      startTime: minutesToTime(dayStartMins),
      endTime: minutesToTime(firstStart),
      durationMins: firstStart - dayStartMins,
      date: "",
      afterItemIndex: -1,
    })
  }

  for (let i = 0; i < timed.length - 1; i++) {
    const currentEnd = timed[i].item.endTime
      ? timeToMinutes(timed[i].item.endTime!)
      : timeToMinutes(timed[i].item.startTime!) + timed[i].item.durationMins
    const nextStart = timeToMinutes(timed[i + 1].item.startTime!)
    const gap = nextStart - currentEnd
    if (gap >= minGapMinutes) {
      blocks.push({
        startTime: minutesToTime(currentEnd),
        endTime: minutesToTime(nextStart),
        durationMins: gap,
        date: "",
        afterItemIndex: timed[i].idx,
      })
    }
  }

  const lastItem = timed[timed.length - 1]
  const lastEnd = lastItem.item.endTime
    ? timeToMinutes(lastItem.item.endTime!)
    : timeToMinutes(lastItem.item.startTime!) + lastItem.item.durationMins
  if (dayEndMins - lastEnd >= minGapMinutes) {
    blocks.push({
      startTime: minutesToTime(lastEnd),
      endTime: minutesToTime(dayEndMins),
      durationMins: dayEndMins - lastEnd,
      date: "",
      afterItemIndex: lastItem.idx,
    })
  }

  return blocks
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function typeIcon(type: string) {
  switch (type) {
    case "FLIGHT": return <Plane className="w-4 h-4" />
    case "HOTEL_CHECK_IN":
    case "HOTEL_CHECK_OUT": return <Hotel className="w-4 h-4" />
    case "ACTIVITY": return <Star className="w-4 h-4" />
    case "MEAL": return <UtensilsCrossed className="w-4 h-4" />
    case "TRANSIT": return <Bus className="w-4 h-4" />
    case "BUFFER": return <Coffee className="w-4 h-4" />
    default: return <Clock className="w-4 h-4" />
  }
}

function typeColor(type: string) {
  switch (type) {
    case "FLIGHT": return "bg-blue-50 text-blue-600 border-blue-100"
    case "HOTEL_CHECK_IN":
    case "HOTEL_CHECK_OUT": return "bg-purple-50 text-purple-600 border-purple-100"
    case "ACTIVITY": return "bg-indigo-50 text-indigo-600 border-indigo-100"
    case "MEAL": return "bg-orange-50 text-orange-600 border-orange-100"
    case "TRANSIT": return "bg-gray-50 text-gray-600 border-gray-200"
    case "BUFFER": return "bg-yellow-50 text-yellow-600 border-yellow-100"
    default: return "bg-gray-50 text-gray-600 border-gray-200"
  }
}

function FreeTimeBlockCard({
  block,
  onAddActivity,
  wishlistItems,
  onQuickAddFromWishlist,
}: {
  block: FreeTimeBlock
  onAddActivity: (startTime: string) => void
  wishlistItems?: WishlistActivity[]
  onQuickAddFromWishlist?: (activityId: string, startTime: string) => void
}) {
  const [showSuggestions, setShowSuggestions] = useState(false)

  // Filter wishlist items that fit in this gap, sorted by priority
  const fittingItems = (wishlistItems || [])
    .filter((a) => a.durationMins <= block.durationMins)
    .sort((a, b) => {
      const priorityOrder: Record<string, number> = { MUST_DO: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }
      return (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3)
    })

  function handleAddClick() {
    if (fittingItems.length > 0 && onQuickAddFromWishlist) {
      setShowSuggestions(!showSuggestions)
    } else {
      onAddActivity(block.startTime)
    }
  }

  return (
    <div className="flex items-start gap-3">
      <div className="w-5" />
      <div className="flex flex-col items-center mt-1">
        <div className="w-7 h-7 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center shrink-0 bg-gray-50">
          <Clock className="w-3.5 h-3.5 text-gray-400" />
        </div>
      </div>
      <div className="flex-1 min-w-0 pb-2">
        <div className="px-3 py-2.5 bg-gray-50 border border-dashed border-gray-200 rounded-xl">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span className="font-medium">Free Time</span>
              <span className="text-gray-300">·</span>
              <span>{formatFreeTimeDuration(block.durationMins)}</span>
              <span className="text-[11px] text-gray-400">
                {formatTime(block.startTime)} – {formatTime(block.endTime)}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={handleAddClick}
                className="flex items-center gap-1 px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors font-medium"
              >
                <Plus className="w-3.5 h-3.5" />
                Add
                {fittingItems.length > 0 && (
                  <span className="text-[10px] text-gray-400 ml-0.5">({fittingItems.length})</span>
                )}
              </button>
              {fittingItems.length > 0 && (
                <button
                  onClick={() => onAddActivity(block.startTime)}
                  className="px-2 py-1 text-[10px] text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                  title="Manual add"
                >
                  Custom
                </button>
              )}
            </div>
          </div>

          {/* Wishlist suggestions dropdown */}
          {showSuggestions && fittingItems.length > 0 && (
            <div className="mt-2 border-t border-gray-200 pt-2 space-y-1 max-h-48 overflow-y-auto">
              <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide mb-1">
                From your wishlist
              </p>
              {fittingItems.map((activity) => (
                <button
                  key={activity.id}
                  onClick={() => {
                    onQuickAddFromWishlist?.(activity.id, block.startTime)
                    setShowSuggestions(false)
                  }}
                  className="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-left hover:bg-white rounded-lg transition-colors group"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={cn(
                        "w-1.5 h-1.5 rounded-full shrink-0",
                        activity.priority === "MUST_DO" ? "bg-green-500" : "bg-amber-400"
                      )}
                    />
                    <span className="text-xs text-gray-700 truncate">{activity.name}</span>
                  </div>
                  <span className="text-[10px] text-gray-400 shrink-0">
                    {formatDuration(activity.durationMins)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SortableItineraryItem({
  item,
  prevItem,
  nextItem,
  isFirst,
  isLast,
  onDelete,
  tripId,
  onUpdateNotes,
  hotel,
}: {
  item: ItineraryItem
  prevItem?: ItineraryItem | null
  nextItem?: ItineraryItem | null
  isFirst: boolean
  isLast: boolean
  onDelete: (id: string) => void
  tripId: string
  onUpdateNotes: (itemId: string, notes: string) => void
  hotel?: HotelInfo | null
}) {
  const [editingNote, setEditingNote] = useState(false)
  const [noteText, setNoteText] = useState(item.userNotes || "")
  const [saving, setSaving] = useState(false)
  const noteRef = useRef<HTMLTextAreaElement>(null)

  const isFixed = item.type === "FLIGHT" || item.type === "HOTEL_CHECK_IN" || item.type === "HOTEL_CHECK_OUT"

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: isFixed })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  }

  async function handleSaveNote() {
    setSaving(true)
    try {
      await updateItineraryItemNotes(tripId, item.id, noteText)
      onUpdateNotes(item.id, noteText)
      setEditingNote(false)
      toast.success("Note saved")
    } catch {
      toast.error("Failed to save note")
    } finally {
      setSaving(false)
    }
  }

  // Compute travel from hotel to first item
  const fromLat = isFirst && hotel ? hotel.lat : (prevItem?.activity?.lat || prevItem?.hotel?.lat)
  const fromLng = isFirst && hotel ? hotel.lng : (prevItem?.activity?.lng || prevItem?.hotel?.lng)
  const fromName = isFirst && hotel ? hotel.name : (prevItem?.activity?.name || prevItem?.hotel?.name || prevItem?.title || "")
  const toLat = item.activity?.lat || item.hotel?.lat
  const toLng = item.activity?.lng || item.hotel?.lng
  const toName = item.activity?.name || item.hotel?.name || item.title

  return (
    <div ref={setNodeRef} style={style}>
      {/* Travel connector BETWEEN items */}
      {(isFirst || prevItem) && item.type !== "FLIGHT" && item.type !== "HOTEL_CHECK_IN" && item.type !== "HOTEL_CHECK_OUT" && (
        <TravelConnector
          fromLat={fromLat}
          fromLng={fromLng}
          toLat={toLat}
          toLng={toLng}
          fromName={fromName || ""}
          toName={toName}
        />
      )}
      <div
        className={cn(
          "flex items-start gap-3 group rounded-xl transition-shadow",
          !isFixed && "cursor-grab active:cursor-grabbing hover:shadow-md"
        )}
        {...(!isFixed ? { ...attributes, ...listeners } : {})}
      >
        {/* Timeline dot */}
        <div className="flex flex-col items-center mt-1">
          <div
            className={cn(
              "w-7 h-7 rounded-lg border flex items-center justify-center shrink-0",
              typeColor(item.type)
            )}
          >
            {typeIcon(item.type)}
          </div>
          {!isLast && (
            <div className="w-0.5 bg-gray-100 flex-1 min-h-4 mt-1" />
          )}
        </div>
        <div className="flex-1 min-w-0 pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="font-medium text-gray-900 text-sm leading-tight">
                {item.type === "FLIGHT" && item.flight
                  ? `${item.flight.airline || ""} ${item.flight.flightNumber || "Flight"}${item.flight.departureAirport || item.flight.arrivalAirport ? ` · ${[item.flight.departureAirport, item.flight.arrivalAirport].filter(Boolean).join(" → ")}` : ""}`.trim()
                  : item.title}
              </div>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500">
                {item.startTime && <span>{formatTime(item.startTime)}</span>}
                <span>{formatDuration(item.durationMins)}</span>
                {item.costEstimate > 0 && <span>${item.costEstimate.toFixed(0)}</span>}
                {item.isConfirmed && <span className="text-green-600 font-medium">Confirmed</span>}
              </div>
              {item.notes && <p className="text-xs text-gray-400 mt-0.5">{item.notes}</p>}
              {item.userNotes && !editingNote && (
                <div className="mt-1 flex items-start gap-1.5">
                  <PenLine className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700 italic whitespace-pre-wrap">{item.userNotes}</p>
                </div>
              )}
              {editingNote && (
                <div className="mt-2 space-y-1.5">
                  <textarea
                    ref={noteRef}
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Write a personal note or story about this..."
                    rows={2}
                    className="w-full px-3 py-2 border border-amber-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-amber-50/50 resize-none"
                    autoFocus
                  />
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={handleSaveNote}
                      disabled={saving}
                      className="flex items-center gap-1 px-2.5 py-1 bg-amber-500 text-white text-[11px] font-medium rounded-md hover:bg-amber-600 disabled:opacity-50 transition-colors"
                    >
                      <Check className="w-3 h-3" />
                      {saving ? "Saving..." : "Save"}
                    </button>
                    <button
                      onClick={() => {
                        setEditingNote(false)
                        setNoteText(item.userNotes || "")
                      }}
                      className="flex items-center gap-1 px-2.5 py-1 text-gray-500 text-[11px] rounded-md hover:bg-gray-100 transition-colors"
                    >
                      <X className="w-3 h-3" />
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {item.type === "FLIGHT" && item.flight?.flightNumber && (() => {
                const depDate = new Date(item.date)
                const now = new Date()
                const diffHours = (depDate.getTime() - now.getTime()) / (1000 * 60 * 60)
                if (diffHours > -12 && diffHours < 24) {
                  return (
                    <div className="mt-1">
                      <FlightStatusBadge
                        flightNumber={item.flight.flightNumber}
                        departureDate={depDate.toISOString().split("T")[0]}
                      />
                    </div>
                  )
                }
                return null
              })()}
              {item.type === "FLIGHT" && item.flight && (
                <div className="flex items-center gap-3 mt-1">
                  {item.flight.departureAirport && (
                    <AirportMapLink airportCode={item.flight.departureAirport} label={`${item.flight.departureAirport} map`} className="inline-flex items-center gap-1 text-[11px] text-indigo-600 hover:text-indigo-700 font-medium" />
                  )}
                  {item.flight.arrivalAirport && (
                    <AirportMapLink airportCode={item.flight.arrivalAirport} label={`${item.flight.arrivalAirport} map`} className="inline-flex items-center gap-1 text-[11px] text-indigo-600 hover:text-indigo-700 font-medium" />
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                onClick={() => {
                  setEditingNote(!editingNote)
                  setNoteText(item.userNotes || "")
                }}
                className={cn(
                  "p-1 transition-all",
                  editingNote
                    ? "text-amber-600"
                    : item.userNotes
                      ? "text-amber-400 hover:text-amber-600"
                      : "opacity-0 group-hover:opacity-100 text-gray-400 hover:text-amber-600"
                )}
                title="Add a personal note"
              >
                <PenLine className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => onDelete(item.id)}
                className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
      {/* Travel back to hotel after last item */}
      {isLast && hotel && item.type !== "FLIGHT" && item.type !== "HOTEL_CHECK_IN" && item.type !== "HOTEL_CHECK_OUT" && (
        <TravelConnector
          fromLat={item.activity?.lat || item.hotel?.lat}
          fromLng={item.activity?.lng || item.hotel?.lng}
          toLat={hotel.lat}
          toLng={hotel.lng}
          fromName={item.activity?.name || item.hotel?.name || item.title}
          toName={hotel.name}
          label={undefined}
        />
      )}
    </div>
  )
}

// Droppable day zone for wishlist items
function DroppableDayZone({ dateStr, children }: { dateStr: string; children: React.ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id: `day-${dateStr}` })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "transition-all rounded-xl",
        isOver && "ring-2 ring-indigo-400 ring-offset-2 bg-indigo-50/30"
      )}
    >
      {children}
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────────

interface Props {
  tripId: string
  initialItems: ItineraryItem[]
  tripStartDate: Date
  tripEndDate: Date
  weather: TripWeatherData | null
  isPaid?: boolean
  wishlistActivities?: WishlistActivity[]
  hotels?: HotelInfo[]
}

export function ItineraryView({
  tripId,
  initialItems,
  tripStartDate,
  tripEndDate,
  weather,
  isPaid,
  wishlistActivities: initialWishlist = [],
  hotels = [],
}: Props) {
  const router = useRouter()
  const [items, setItems] = useState<ItineraryItem[]>(initialItems)
  const [wishlist, setWishlist] = useState<WishlistActivity[]>(initialWishlist)
  const [viewMode, setViewMode] = useState<"events" | "timeline">("events")
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const reorderingRef = useRef(false)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)

  useEffect(() => {
    if (!reorderingRef.current) {
      setItems(initialItems)
    }
  }, [initialItems])

  useEffect(() => {
    setWishlist(initialWishlist)
  }, [initialWishlist])

  // Show onboarding when wishlist has items and user hasn't seen it
  useEffect(() => {
    if (wishlist.length > 0) {
      const seen = typeof window !== "undefined" && localStorage.getItem("jp_plan_onboarding_seen")
      if (!seen) setShowOnboarding(true)
    }
  }, [wishlist.length])

  const [optimizing, setOptimizing] = useState(false)
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set())
  const [addingToDay, setAddingToDay] = useState<string | null>(null)
  const [showFreeTime, setShowFreeTime] = useState(false)
  const [minGapHours, setMinGapHours] = useState<number>(2)
  const [newItemForm, setNewItemForm] = useState({
    title: "",
    type: "CUSTOM",
    startTime: "",
    durationMins: 60,
  })

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
    useSensor(KeyboardSensor)
  )

  const weatherByDate = new Map(
    weather?.forecasts.map((f) => [f.date, f]) ?? []
  )

  const days = groupByDay(items)

  const allDays: GroupedDay<ItineraryItem>[] = (() => {
    const dayMap = new Map(days.map((d) => [d.dateStr, d]))
    const result: GroupedDay<ItineraryItem>[] = []
    const start = new Date(tripStartDate)
    const end = new Date(tripEndDate)
    const curYear = start.getUTCFullYear()
    const curMonth = start.getUTCMonth()
    const curDay = start.getUTCDate()
    const cur = new Date(Date.UTC(curYear, curMonth, curDay, 12, 0, 0))
    const endTime = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate(), 12, 0, 0)).getTime()
    while (cur.getTime() <= endTime) {
      const dateStr = `${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, "0")}-${String(cur.getUTCDate()).padStart(2, "0")}`
      result.push(dayMap.get(dateStr) || { date: new Date(cur), dateStr, items: [] })
      cur.setUTCDate(cur.getUTCDate() + 1)
    }
    for (const day of days) {
      if (!result.some((r) => r.dateStr === day.dateStr)) {
        result.push(day)
      }
    }
    result.sort((a, b) => a.dateStr.localeCompare(b.dateStr))
    return result
  })()

  // Find hotel for a given date
  function getHotelForDate(dateStr: string): HotelInfo | null {
    for (const h of hotels) {
      const checkIn = new Date(h.checkIn).toISOString().split("T")[0]
      const checkOut = new Date(h.checkOut).toISOString().split("T")[0]
      if (dateStr >= checkIn && dateStr <= checkOut) return h
    }
    return hotels[0] || null
  }

  async function handleAutoPlan() {
    setOptimizing(true)
    reorderingRef.current = false // Allow state sync after refresh
    try {
      if (isPaid) {
        const result = await runAIOptimizer(tripId)
        toast.success(`Auto-plan scheduled ${result.scheduledItems.length} activities!`)
      } else {
        const result = await runOptimizer(tripId)
        toast.success(`Auto-plan scheduled ${result.scheduledItems.length} activities!`)
      }
      // Re-fetch itinerary items with full relations (including activity lat/lng)
      const { getItinerary } = await import("@/lib/actions/itinerary")
      const freshItems = await getItinerary(tripId)
      setItems(freshItems as ItineraryItem[])
      // Also refresh wishlist since items moved to SCHEDULED
      const { getAllActivitiesForTrip } = await import("@/lib/actions/activities")
      const allActivities = await getAllActivitiesForTrip(tripId)
      setWishlist(allActivities.filter((a: any) => a.status === "WISHLIST") as WishlistActivity[])
      router.refresh()
    } catch (e) {
      const msg = e instanceof Error && e.message === "UPGRADE_REQUIRED"
        ? "AI auto-plan requires a paid plan. Using basic optimizer."
        : "Auto-plan failed. Make sure you have activities on your wishlist."
      toast.error(msg)
      // Fallback to basic optimizer if AI fails
      if (e instanceof Error && e.message === "UPGRADE_REQUIRED") {
        try {
          const result = await runOptimizer(tripId)
          toast.success(`Auto-plan scheduled ${result.scheduledItems.length} activities!`)
          router.refresh()
        } catch {
          // Already showed error
        }
      }
    } finally {
      setOptimizing(false)
    }
  }

  async function handleDelete(itemId: string) {
    // If the item has an activityId, return it to wishlist
    const item = items.find((i) => i.id === itemId)
    try {
      await deleteItineraryItem(tripId, itemId)
      setItems((prev) => prev.filter((i) => i.id !== itemId))
      if (item?.activityId) {
        try {
          await updateActivityStatus(tripId, item.activityId, "WISHLIST")
          router.refresh()
        } catch {
          // Activity may have been deleted
        }
      }
      toast.success("Item removed")
    } catch {
      toast.error("Failed to remove item")
    }
  }

  async function handleAddItem(dateStr: string) {
    if (!newItemForm.title) {
      toast.error("Title is required")
      return
    }
    try {
      const item: ItineraryItemResult = await createItineraryItem(tripId, {
        date: dateStr,
        title: newItemForm.title,
        type: newItemForm.type as "CUSTOM",
        startTime: newItemForm.startTime || undefined,
        durationMins: newItemForm.durationMins,
        costEstimate: 0,
        position: 99,
      })
      setItems((prev) => [...prev, {
        id: item.id,
        date: item.date,
        startTime: item.startTime,
        endTime: item.endTime,
        type: item.type,
        title: item.title,
        notes: item.notes,
        userNotes: null,
        durationMins: item.durationMins,
        travelTimeToNextMins: item.travelTimeToNextMins,
        costEstimate: item.costEstimate,
        position: item.position,
        isConfirmed: item.isConfirmed,
      }])
      setAddingToDay(null)
      setNewItemForm({ title: "", type: "CUSTOM", startTime: "", durationMins: 60 })
      toast.success("Item added")
    } catch {
      toast.error("Failed to add item")
    }
  }

  // Handle dropping a wishlist item onto a day
  async function handleWishlistDrop(activityId: string, dateStr: string) {
    const activity = wishlist.find((a) => a.id === activityId)
    if (!activity) return

    markOnboardingSeen()
    setShowOnboarding(false)

    // Find next available time slot
    const dayItems = items.filter((i) => {
      const d = new Date(i.date)
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
      return key === dateStr
    })

    let startTime = "09:00"
    if (dayItems.length > 0) {
      const sorted = [...dayItems]
        .filter((i) => i.startTime)
        .sort((a, b) => timeToMinutes(a.startTime!) - timeToMinutes(b.startTime!))
      if (sorted.length > 0) {
        const lastItem = sorted[sorted.length - 1]
        const lastEnd = lastItem.endTime
          ? timeToMinutes(lastItem.endTime)
          : timeToMinutes(lastItem.startTime!) + lastItem.durationMins
        // Add 30 min buffer for travel
        startTime = minutesToTime(lastEnd + 30)
      }
    }

    // Calculate end time
    const startMins = timeToMinutes(startTime)
    const endMins = startMins + activity.durationMins
    const endTime = minutesToTime(endMins)

    // Optimistically remove from wishlist
    setWishlist((prev) => prev.filter((a) => a.id !== activityId))

    try {
      const item = await createItineraryItem(tripId, {
        date: dateStr,
        title: activity.name,
        type: "ACTIVITY",
        startTime,
        durationMins: activity.durationMins,
        costEstimate: 0,
        position: dayItems.length,
        activityId: activity.id,
      })

      setItems((prev) => [...prev, {
        id: item.id,
        date: item.date,
        startTime: item.startTime,
        endTime: item.endTime || endTime,
        type: item.type,
        title: item.title,
        notes: item.notes,
        userNotes: null,
        durationMins: item.durationMins,
        travelTimeToNextMins: item.travelTimeToNextMins,
        costEstimate: item.costEstimate,
        position: item.position,
        isConfirmed: item.isConfirmed,
        activityId: activity.id,
        activity: {
          lat: activity.lat,
          lng: activity.lng,
          address: activity.address,
          name: activity.name,
        },
      }])

      await updateActivityStatus(tripId, activity.id, "SCHEDULED")
      toast.success(`${activity.name} added to Day ${allDays.findIndex((d) => d.dateStr === dateStr) + 1}`)
    } catch {
      // Revert on failure
      setWishlist((prev) => [...prev, activity])
      toast.error("Failed to add to itinerary")
    }
  }

  // Handle dropping an itinerary item back to wishlist
  async function handleReturnToWishlist(itemId: string) {
    const item = items.find((i) => i.id === itemId)
    if (!item || !item.activityId) {
      toast.error("This item can't be returned to the wishlist")
      return
    }

    // Optimistically remove from itinerary
    setItems((prev) => prev.filter((i) => i.id !== itemId))

    try {
      await deleteItineraryItem(tripId, itemId)
      await updateActivityStatus(tripId, item.activityId, "WISHLIST")
      // Refresh to get the activity back in wishlist
      router.refresh()
      toast.success("Returned to wishlist")
    } catch {
      // Revert
      setItems((prev) => [...prev, item])
      toast.error("Failed to return to wishlist")
    }
  }

  function handleDragEnd(event: DragEndEvent, dayDateStr: string) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const dayItems = items.filter((i) => {
      const d = new Date(i.date)
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
      return key === dayDateStr
    })
    const oldIndex = dayItems.findIndex((i) => i.id === active.id)
    const newIndex = dayItems.findIndex((i) => i.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(dayItems, oldIndex, newIndex)
    reorderingRef.current = true

    setItems((prev) => {
      const otherItems = prev.filter((i) => {
        const d = new Date(i.date)
        const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
        return key !== dayDateStr
      })
      const updated = reordered.map((item, idx) => ({ ...item, position: idx }))
      return [...otherItems, ...updated]
    })

    const updates = reordered.map((item, idx) => ({
      id: item.id,
      position: idx,
      date: dayDateStr,
    }))
    reorderItineraryItems(tripId, updates)
      .then(() => {
        setTimeout(() => { reorderingRef.current = false }, 1000)
      })
      .catch(() => {
        toast.error("Failed to save new order")
        reorderingRef.current = false
        router.refresh()
      })
  }

  // Global drag handler for wishlist -> day drops
  function handleGlobalDragStart(event: DragStartEvent) {
    setActiveDragId(event.active.id as string)
  }

  function handleGlobalDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveDragId(null)

    if (!over) return

    const activeId = active.id as string
    const overId = over.id as string

    // Wishlist item dropped on a day
    if (overId.startsWith("day-")) {
      const dateStr = overId.replace("day-", "")
      const isWishlistItem = wishlist.some((a) => a.id === activeId)
      if (isWishlistItem) {
        handleWishlistDrop(activeId, dateStr)
        return
      }
    }

    // Itinerary item dropped on wishlist zone
    if (overId === "wishlist-drop-zone") {
      handleReturnToWishlist(activeId)
      return
    }
  }

  function handleUpdateNotes(itemId: string, userNotes: string) {
    setItems((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, userNotes: userNotes || null } : i))
    )
  }

  function toggleDay(dateStr: string) {
    setCollapsedDays((prev) => {
      const next = new Set(prev)
      if (next.has(dateStr)) next.delete(dateStr)
      else next.add(dateStr)
      return next
    })
  }

  async function handleTimelineResize(itemId: string, newDurationMins: number) {
    // Calculate new endTime
    const item = items.find((i) => i.id === itemId)
    if (!item || !item.startTime) return

    const startMins = timeToMinutes(item.startTime)
    const endMins = startMins + newDurationMins
    const newEndTime = minutesToTime(endMins)

    // Optimistic update
    setItems((prev) =>
      prev.map((i) =>
        i.id === itemId ? { ...i, durationMins: newDurationMins, endTime: newEndTime } : i
      )
    )

    try {
      await updateItineraryItem(tripId, itemId, {
        durationMins: newDurationMins,
      })
    } catch {
      toast.error("Failed to update duration")
      router.refresh()
    }
  }

  async function handleTimelineMove(itemId: string, newStartTime: string, newDurationMins: number) {
    const item = items.find((i) => i.id === itemId)
    if (!item) return

    const startMins = timeToMinutes(newStartTime)
    const endMins = startMins + newDurationMins
    const newEndTime = minutesToTime(endMins)

    // Optimistic update
    setItems((prev) =>
      prev.map((i) =>
        i.id === itemId ? { ...i, startTime: newStartTime, endTime: newEndTime, durationMins: newDurationMins } : i
      )
    )

    try {
      await updateItineraryItem(tripId, itemId, {
        startTime: newStartTime,
        durationMins: newDurationMins,
      })
    } catch {
      toast.error("Failed to move item")
      router.refresh()
    }
  }

  async function handleQuickAddFromWishlist(activityId: string, startTime: string, dateStr: string) {
    const activity = wishlist.find((a) => a.id === activityId)
    if (!activity) return

    const startMins = timeToMinutes(startTime)
    const endMins = startMins + activity.durationMins
    const endTime = minutesToTime(endMins)

    // Optimistically remove from wishlist
    setWishlist((prev) => prev.filter((a) => a.id !== activityId))

    try {
      const dayItems = items.filter((i) => {
        const d = new Date(i.date)
        const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
        return key === dateStr
      })

      const item = await createItineraryItem(tripId, {
        date: dateStr,
        title: activity.name,
        type: "ACTIVITY",
        startTime,
        durationMins: activity.durationMins,
        costEstimate: 0,
        position: dayItems.length,
        activityId: activity.id,
      })

      setItems((prev) => [...prev, {
        id: item.id,
        date: item.date,
        startTime: item.startTime,
        endTime: item.endTime || endTime,
        type: item.type,
        title: item.title,
        notes: item.notes,
        userNotes: null,
        durationMins: item.durationMins,
        travelTimeToNextMins: item.travelTimeToNextMins,
        costEstimate: item.costEstimate,
        position: item.position,
        isConfirmed: item.isConfirmed,
        activityId: activity.id,
        activity: {
          lat: activity.lat,
          lng: activity.lng,
          address: activity.address,
          name: activity.name,
        },
      }])

      await updateActivityStatus(tripId, activity.id, "SCHEDULED")
      toast.success(`${activity.name} added!`)
    } catch {
      setWishlist((prev) => [...prev, activity])
      toast.error("Failed to add to itinerary")
    }
  }

  async function handleRemoveFromWishlist(activityId: string) {
    setWishlist((prev) => prev.filter((a) => a.id !== activityId))
    try {
      await removeActivityFromWishlist(tripId, activityId)
    } catch {
      toast.error("Failed to remove")
      router.refresh()
    }
  }

  async function handleTogglePriority(activityId: string) {
    const activity = wishlist.find((a) => a.id === activityId)
    if (!activity) return

    const newPriority = activity.priority === "MUST_DO" ? "LOW" : "MUST_DO"
    setWishlist((prev) =>
      prev.map((a) => (a.id === activityId ? { ...a, priority: newPriority } : a))
    )

    try {
      await updateActivityPriority(tripId, activityId, newPriority as "MUST_DO" | "LOW")
    } catch {
      toast.error("Failed to update priority")
      router.refresh()
    }
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleGlobalDragStart}
      onDragEnd={handleGlobalDragEnd}
    >
      {/* Caveat font for onboarding */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        href="https://fonts.googleapis.com/css2?family=Caveat:wght@400;700&display=swap"
        rel="stylesheet"
      />

      {showOnboarding && <DragOnboarding onDismiss={() => setShowOnboarding(false)} />}

      <div className="flex h-full">
        {/* Main itinerary panel */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Plan</h1>
                <p className="text-gray-500 text-sm mt-0.5">{items.length} items planned</p>
              </div>
              <div className="flex items-center gap-2">
                <CalendarExportButton tripId={tripId} />

                {/* View toggle */}
                <div className="flex items-center bg-gray-100 rounded-xl p-0.5">
                  <button
                    onClick={() => setViewMode("events")}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors",
                      viewMode === "events"
                        ? "bg-white text-gray-900 shadow-sm"
                        : "text-gray-500 hover:text-gray-700"
                    )}
                  >
                    <LayoutList className="w-4 h-4" />
                    <span className="hidden sm:inline">Events</span>
                  </button>
                  <button
                    onClick={() => setViewMode("timeline")}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors",
                      viewMode === "timeline"
                        ? "bg-white text-gray-900 shadow-sm"
                        : "text-gray-500 hover:text-gray-700"
                    )}
                  >
                    <CalendarClock className="w-4 h-4" />
                    <span className="hidden sm:inline">Timeline</span>
                  </button>
                </div>

                {/* Free time toggle */}
                {viewMode === "events" && (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setShowFreeTime(!showFreeTime)}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium rounded-xl border transition-colors",
                        showFreeTime
                          ? "bg-gray-900 text-white border-gray-900"
                          : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                      )}
                    >
                      <Clock className="w-4 h-4" />
                      <span className="hidden sm:inline">Free time</span>
                    </button>
                    {showFreeTime && (
                      <select
                        value={minGapHours}
                        onChange={(e) => setMinGapHours(Number(e.target.value))}
                        className="px-2 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value={1}>1h+</option>
                        <option value={2}>2h+</option>
                        <option value={3}>3h+</option>
                      </select>
                    )}
                  </div>
                )}

                {/* Auto-plan button */}
                <button
                  onClick={handleAutoPlan}
                  disabled={optimizing}
                  className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-medium rounded-xl hover:from-violet-700 hover:to-indigo-700 disabled:opacity-50 transition-all shadow-sm"
                >
                  <Sparkles className="w-4 h-4" />
                  {optimizing ? "Planning..." : "Auto-plan"}
                </button>
              </div>
            </div>

            {/* Weather bar */}
            {weather && (
              <WeatherBar
                forecasts={weather.forecasts}
                tripStart={weather.tripStart}
                tripEnd={weather.tripEnd}
                alerts={weather.alerts}
              />
            )}

            {/* Timeline view */}
            {viewMode === "timeline" ? (
              <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden p-4">
                <TimelineView
                  days={allDays}
                  onResizeItem={handleTimelineResize}
                  onMoveItem={handleTimelineMove}
                />
              </div>
            ) : (
              /* Events view (day list) */
              <div className="space-y-6">
                {allDays.map((day, dayIdx) => {
                  const isCollapsed = collapsedDays.has(day.dateStr)
                  const dayWeather = weatherByDate.get(day.dateStr)
                  const hotel = getHotelForDate(day.dateStr)
                  const freeTimeBlocks = showFreeTime
                    ? computeFreeTimeBlocks(day.items, minGapHours * 60).map((b) => ({
                        ...b,
                        date: day.dateStr,
                      }))
                    : []

                  return (
                    <DroppableDayZone key={day.dateStr} dateStr={day.dateStr}>
                      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
                        {/* Day header */}
                        <button
                          onClick={() => toggleDay(day.dateStr)}
                          className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-indigo-50 flex flex-col items-center justify-center">
                              <span className="text-[10px] text-indigo-500 font-medium leading-none">
                                {formatDate(day.date, "EEE")}
                              </span>
                              <span className="text-lg font-bold text-indigo-700 leading-none">
                                {formatDate(day.date, "d")}
                              </span>
                            </div>
                            <div className="text-left">
                              <div className="font-semibold text-gray-900 text-sm flex items-center gap-1.5">
                                <span>Day {dayIdx + 1} · {formatDate(day.date, "MMMM d, yyyy")}</span>
                                {dayWeather && (
                                  <span className="inline-flex items-center gap-1 text-xs font-normal text-gray-500 ml-1">
                                    <span>{dayWeather.emoji}</span>
                                    <span>{dayWeather.highTemp}&deg;/{dayWeather.lowTemp}&deg;</span>
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-gray-500">
                                {day.items.length} item{day.items.length !== 1 ? "s" : ""}
                              </div>
                            </div>
                          </div>
                          {isCollapsed ? (
                            <ChevronDown className="w-4 h-4 text-gray-400" />
                          ) : (
                            <ChevronUp className="w-4 h-4 text-gray-400" />
                          )}
                        </button>

                        {/* Day items */}
                        {!isCollapsed && (
                          <div className="px-5 pb-4">
                            {day.items.length === 0 && !showFreeTime && (
                              <div className="text-center py-6 text-gray-400 text-sm">
                                No items yet — drag from wishlist or add one below
                              </div>
                            )}
                            <DndContext
                              sensors={sensors}
                              collisionDetection={closestCenter}
                              onDragEnd={(event) => handleDragEnd(event, day.dateStr)}
                            >
                              <SortableContext
                                items={day.items.map((i) => i.id)}
                                strategy={verticalListSortingStrategy}
                              >
                                <div className="space-y-0 mb-3">
                                  {/* Free time before first item */}
                                  {showFreeTime && freeTimeBlocks
                                    .filter((b) => b.afterItemIndex === -1)
                                    .map((block, bi) => (
                                      <FreeTimeBlockCard
                                        key={`free-pre-${bi}`}
                                        block={block}
                                        onAddActivity={(startTime) => {
                                          setAddingToDay(day.dateStr)
                                          setNewItemForm((f) => ({ ...f, startTime }))
                                        }}
                                        wishlistItems={wishlist}
                                        onQuickAddFromWishlist={(activityId, startTime) =>
                                          handleQuickAddFromWishlist(activityId, startTime, day.dateStr)
                                        }
                                      />
                                    ))}

                                  {day.items.map((item, i) => (
                                    <div key={item.id}>
                                      <SortableItineraryItem
                                        item={item}
                                        prevItem={i > 0 ? day.items[i - 1] : null}
                                        nextItem={i < day.items.length - 1 ? day.items[i + 1] : null}
                                        isFirst={i === 0}
                                        isLast={i === day.items.length - 1}
                                        onDelete={handleDelete}
                                        tripId={tripId}
                                        onUpdateNotes={handleUpdateNotes}
                                        hotel={hotel}
                                      />

                                      {/* Free time after this item */}
                                      {showFreeTime && freeTimeBlocks
                                        .filter((b) => b.afterItemIndex === i)
                                        .map((block, bi) => (
                                          <FreeTimeBlockCard
                                            key={`free-${i}-${bi}`}
                                            block={block}
                                            onAddActivity={(startTime) => {
                                              setAddingToDay(day.dateStr)
                                              setNewItemForm((f) => ({ ...f, startTime }))
                                            }}
                                            wishlistItems={wishlist}
                                            onQuickAddFromWishlist={(activityId, startTime) =>
                                              handleQuickAddFromWishlist(activityId, startTime, day.dateStr)
                                            }
                                          />
                                        ))}
                                    </div>
                                  ))}
                                </div>
                              </SortableContext>
                            </DndContext>

                            {/* Add item inline form */}
                            {addingToDay === day.dateStr ? (
                              <div className="bg-gray-50 rounded-xl p-3 space-y-2 mt-2">
                                <input
                                  type="text"
                                  placeholder="Item title *"
                                  value={newItemForm.title}
                                  onChange={(e) => setNewItemForm((f) => ({ ...f, title: e.target.value }))}
                                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                  autoFocus
                                />
                                <div className="flex gap-2">
                                  <select
                                    value={newItemForm.type}
                                    onChange={(e) => setNewItemForm((f) => ({ ...f, type: e.target.value }))}
                                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                                  >
                                    <option value="CUSTOM">Custom</option>
                                    <option value="ACTIVITY">Activity</option>
                                    <option value="MEAL">Meal</option>
                                    <option value="TRANSIT">Transit</option>
                                    <option value="BUFFER">Buffer</option>
                                  </select>
                                  <input
                                    type="time"
                                    value={newItemForm.startTime}
                                    onChange={(e) => setNewItemForm((f) => ({ ...f, startTime: e.target.value }))}
                                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                  />
                                  <input
                                    type="number"
                                    placeholder="Min"
                                    value={newItemForm.durationMins}
                                    onChange={(e) =>
                                      setNewItemForm((f) => ({ ...f, durationMins: parseInt(e.target.value) || 60 }))
                                    }
                                    className="w-16 px-2 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                  />
                                </div>
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => setAddingToDay(null)}
                                    className="flex-1 py-2 border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-gray-100 transition-colors"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    onClick={() => handleAddItem(day.dateStr)}
                                    className="flex-1 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition-colors"
                                  >
                                    Add
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                onClick={() => setAddingToDay(day.dateStr)}
                                className="flex items-center gap-2 text-xs text-gray-400 hover:text-indigo-600 transition-colors mt-1"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                Add item
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </DroppableDayZone>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Wishlist sidebar */}
        <WishlistPanel
          tripId={tripId}
          activities={wishlist}
          onRemove={handleRemoveFromWishlist}
          onTogglePriority={handleTogglePriority}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
      </div>
    </DndContext>
  )
}
