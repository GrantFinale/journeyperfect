"use client"

import { useState, useEffect, useRef, useMemo } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { runOptimizer, runAIOptimizer, deleteItineraryItem, createItineraryItem, reorderItineraryItems, updateItineraryItemNotes } from "@/lib/actions/itinerary"
import type { ItineraryItemResult } from "@/lib/actions/itinerary"
import { formatDate, formatTime } from "@/lib/utils"
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
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
  GripVertical,
  PenLine,
  Check,
  X,
  ToggleLeft,
  ToggleRight,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { CalendarExportButton } from "@/components/calendar-export"
import { WeatherBar } from "@/components/weather-bar"
import { FlightStatusBadge } from "@/components/flight-status-badge"
import { AirportMapLink } from "@/components/airport-info"
import type { TripWeatherData } from "@/lib/weather"

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
}

type FreeTimeBlock = {
  startTime: string
  endTime: string
  durationMins: number
  date: string
  afterItemIndex: number // index in the day's items array, -1 means before first item
}

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

function computeFreeTimeBlocks(
  dayItems: ItineraryItem[],
  minGapMinutes: number = 120
): FreeTimeBlock[] {
  const blocks: FreeTimeBlock[] = []
  const dayStartMins = DAY_START_HOUR * 60
  const dayEndMins = DAY_END_HOUR * 60

  // Only consider items with start times, sorted by start time
  const timed = dayItems
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => item.startTime)
    .sort((a, b) => timeToMinutes(a.item.startTime!) - timeToMinutes(b.item.startTime!))

  if (timed.length === 0) {
    // Entire day is free
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

  // Gap from day start to first item
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

  // Gaps between consecutive items
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

  // Gap from last item to day end
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

function formatFreeTimeDuration(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m} min`
  if (m === 0) return `${h} hour${h !== 1 ? "s" : ""}`
  return `${h}.${Math.round((m / 60) * 10)} hours`
}

function FreeTimeBlockCard({
  block,
  onAddActivity,
}: {
  block: FreeTimeBlock
  onAddActivity: (startTime: string) => void
}) {
  return (
    <div className="flex items-start gap-3">
      {/* Spacer for drag handle column */}
      <div className="w-5" />
      {/* Timeline dot */}
      <div className="flex flex-col items-center mt-1">
        <div className="w-7 h-7 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center shrink-0 bg-gray-50">
          <Clock className="w-3.5 h-3.5 text-gray-400" />
        </div>
      </div>
      <div className="flex-1 min-w-0 pb-2">
        <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-gray-50 border border-dashed border-gray-200 rounded-xl">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span className="font-medium">Free Time</span>
            <span className="text-gray-300">·</span>
            <span>{formatFreeTimeDuration(block.durationMins)}</span>
            <span className="text-[11px] text-gray-400">
              {formatTime(block.startTime)} – {formatTime(block.endTime)}
            </span>
          </div>
          <button
            onClick={() => onAddActivity(block.startTime)}
            className="flex items-center gap-1 px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors font-medium"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
        </div>
      </div>
    </div>
  )
}

import { groupByDay } from "@/lib/itinerary-utils"
import type { GroupedDay } from "@/lib/itinerary-utils"

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

function formatDuration(mins: number) {
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
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

function SortableItineraryItem({
  item,
  isLast,
  onDelete,
  tripId,
  onUpdateNotes,
}: {
  item: ItineraryItem
  isLast: boolean
  onDelete: (id: string) => void
  tripId: string
  onUpdateNotes: (itemId: string, notes: string) => void
}) {
  const [editingNote, setEditingNote] = useState(false)
  const [noteText, setNoteText] = useState(item.userNotes || "")
  const [saving, setSaving] = useState(false)
  const noteRef = useRef<HTMLTextAreaElement>(null)

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id })

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

  return (
    <div ref={setNodeRef} style={style}>
      <div className="flex items-start gap-3 group">
        {/* Drag handle */}
        <button
          className="mt-2 p-1.5 -m-1 text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="w-4 h-4" />
        </button>
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
                {item.startTime && (
                  <span>{formatTime(item.startTime)}</span>
                )}
                <span>{formatDuration(item.durationMins)}</span>
                {item.costEstimate > 0 && (
                  <span>${item.costEstimate.toFixed(0)}</span>
                )}
                {item.isConfirmed && (
                  <span className="text-green-600 font-medium">Confirmed</span>
                )}
              </div>
              {item.notes && (
                <p className="text-xs text-gray-400 mt-0.5">{item.notes}</p>
              )}
              {/* User notes display */}
              {item.userNotes && !editingNote && (
                <div className="mt-1 flex items-start gap-1.5">
                  <PenLine className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700 italic whitespace-pre-wrap">{item.userNotes}</p>
                </div>
              )}
              {/* Note editor */}
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
      {/* Travel time indicator */}
      {item.travelTimeToNextMins > 0 && !isLast && (
        <div className="flex items-center gap-2 ml-14 my-0.5">
          <Bus className="w-3 h-3 text-gray-300" />
          <span className="text-[11px] text-gray-400">
            {formatDuration(item.travelTimeToNextMins)} travel
          </span>
        </div>
      )}
    </div>
  )
}

interface Props {
  tripId: string
  initialItems: ItineraryItem[]
  tripStartDate: Date
  tripEndDate: Date
  weather: TripWeatherData | null
  isPaid?: boolean
}

export function ItineraryView({ tripId, initialItems, tripStartDate, tripEndDate, weather, isPaid }: Props) {
  const router = useRouter()
  const [items, setItems] = useState<ItineraryItem[]>(initialItems)
  // Sync items when server data changes (e.g., after optimize + router.refresh)
  useEffect(() => { setItems(initialItems) }, [initialItems])
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
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor)
  )

  // Build a date -> forecast lookup for per-day weather display
  const weatherByDate = new Map(
    weather?.forecasts.map((f) => [f.date, f]) ?? []
  )

  const days = groupByDay(items)

  // Always show all trip days, merging in items where they exist
  const allDays: GroupedDay<ItineraryItem>[] = (() => {
    const dayMap = new Map(days.map((d) => [d.dateStr, d]))
    const result: GroupedDay<ItineraryItem>[] = []
    const start = new Date(tripStartDate)
    const end = new Date(tripEndDate)
    const cur = new Date(start)
    while (cur <= end) {
      const dateStr = cur.toISOString().split("T")[0]
      result.push(dayMap.get(dateStr) || { date: new Date(cur), dateStr, items: [] })
      cur.setDate(cur.getDate() + 1)
    }
    // Also include any days with items that fall outside the trip date range
    for (const day of days) {
      if (!result.some((r) => r.dateStr === day.dateStr)) {
        result.push(day)
      }
    }
    result.sort((a, b) => a.dateStr.localeCompare(b.dateStr))
    return result
  })()

  async function handleOptimize() {
    setOptimizing(true)
    try {
      const result = await runOptimizer(tripId)
      toast.success(`Optimizer scheduled ${result.scheduledItems.length} activities!`)
      router.refresh()
    } catch (e) {
      toast.error("Optimization failed. Make sure you have activities on your wishlist.")
    } finally {
      setOptimizing(false)
    }
  }

  async function handleAIOptimize() {
    setOptimizing(true)
    try {
      const result = await runAIOptimizer(tripId)
      toast.success(`AI scheduled ${result.scheduledItems.length} activities with meals & travel time!`)
      router.refresh()
    } catch (e) {
      const msg = e instanceof Error && e.message === "UPGRADE_REQUIRED"
        ? "AI optimizer requires a paid plan. Upgrade to unlock."
        : "AI optimization failed. Falling back may have been used."
      toast.error(msg)
    } finally {
      setOptimizing(false)
    }
  }

  async function handleDelete(itemId: string) {
    try {
      await deleteItineraryItem(tripId, itemId)
      setItems((prev) => prev.filter((i) => i.id !== itemId))
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

  function handleDragEnd(event: DragEndEvent, dayDateStr: string) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    // Find the day whose items we're reordering
    const dayItems = items.filter(
      (i) => new Date(i.date).toISOString().split("T")[0] === dayDateStr
    )
    const oldIndex = dayItems.findIndex((i) => i.id === active.id)
    const newIndex = dayItems.findIndex((i) => i.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(dayItems, oldIndex, newIndex)

    // Optimistically update local state
    setItems((prev) => {
      const otherItems = prev.filter(
        (i) => new Date(i.date).toISOString().split("T")[0] !== dayDateStr
      )
      const updated = reordered.map((item, idx) => ({ ...item, position: idx }))
      return [...otherItems, ...updated]
    })

    // Persist to server
    const updates = reordered.map((item, idx) => ({
      id: item.id,
      position: idx,
      date: dayDateStr,
    }))
    reorderItineraryItems(tripId, updates).catch(() => {
      toast.error("Failed to save new order")
      // Revert on failure
      setItems(items)
    })
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

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Itinerary</h1>
          <p className="text-gray-500 text-sm mt-0.5">{items.length} items planned</p>
        </div>
        <div className="flex items-center gap-2">
          <CalendarExportButton tripId={tripId} />
          {/* Free time toggle */}
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
          {isPaid && (
            <button
              onClick={handleAIOptimize}
              disabled={optimizing}
              className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-medium rounded-xl hover:from-violet-700 hover:to-indigo-700 disabled:opacity-50 transition-all shadow-sm"
            >
              <Sparkles className="w-4 h-4" />
              {optimizing ? "Optimizing..." : "AI Optimize"}
            </button>
          )}
          <button
            onClick={handleOptimize}
            disabled={optimizing}
            className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            <Sparkles className="w-4 h-4" />
            {optimizing ? "Optimizing..." : "Optimize"}
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

      {/* Day list */}
      <div className="space-y-6">
        {allDays.map((day, dayIdx) => {
          const isCollapsed = collapsedDays.has(day.dateStr)
          const dayWeather = weatherByDate.get(day.dateStr)
          return (
            <div key={day.dateStr} className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
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
                  {day.items.length === 0 && (
                    <div className="text-center py-6 text-gray-400 text-sm">
                      No items yet — add one below or run the optimizer
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
                      <div className="space-y-2 mb-3">
                        {(() => {
                          const freeBlocks = showFreeTime
                            ? computeFreeTimeBlocks(day.items, minGapHours * 60)
                            : []

                          // Render free time block before first item (afterItemIndex === -1)
                          const beforeFirst = freeBlocks.filter((b) => b.afterItemIndex === -1)

                          const handleFreeTimeAdd = (startTime: string) => {
                            setAddingToDay(day.dateStr)
                            setNewItemForm((f) => ({ ...f, startTime, title: "", type: "ACTIVITY", durationMins: 60 }))
                          }

                          return (
                            <>
                              {beforeFirst.map((block, bi) => (
                                <FreeTimeBlockCard
                                  key={`free-before-${bi}`}
                                  block={block}
                                  onAddActivity={handleFreeTimeAdd}
                                />
                              ))}
                              {day.items.map((item, i) => (
                                <div key={item.id}>
                                  <SortableItineraryItem
                                    item={item}
                                    isLast={i === day.items.length - 1 && freeBlocks.filter((b) => b.afterItemIndex === i).length === 0}
                                    onDelete={handleDelete}
                                    tripId={tripId}
                                    onUpdateNotes={handleUpdateNotes}
                                  />
                                  {freeBlocks
                                    .filter((b) => b.afterItemIndex === i)
                                    .map((block, bi) => (
                                      <FreeTimeBlockCard
                                        key={`free-${i}-${bi}`}
                                        block={block}
                                        onAddActivity={handleFreeTimeAdd}
                                      />
                                    ))}
                                </div>
                              ))}
                            </>
                          )
                        })()}
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
          )
        })}
      </div>
    </div>
  )
}
