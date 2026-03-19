"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { runOptimizer, deleteItineraryItem, createItineraryItem, reorderItineraryItems } from "@/lib/actions/itinerary"
import type { ItineraryItemResult } from "@/lib/actions/itinerary"
import { formatDate, formatTime } from "@/lib/utils"
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
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
} from "lucide-react"
import { cn } from "@/lib/utils"
import { WeatherBar } from "@/components/weather-bar"
import type { TripWeatherData } from "@/lib/weather"

type ItineraryItem = {
  id: string
  date: Date
  startTime: string | null
  endTime: string | null
  type: string
  title: string
  notes: string | null
  durationMins: number
  travelTimeToNextMins: number
  costEstimate: number
  position: number
  isConfirmed: boolean
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
}: {
  item: ItineraryItem
  isLast: boolean
  onDelete: (id: string) => void
}) {
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

  return (
    <div ref={setNodeRef} style={style}>
      <div className="flex items-start gap-3 group">
        {/* Drag handle */}
        <button
          className="mt-2 p-0.5 text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing touch-none"
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
            <div>
              <div className="font-medium text-gray-900 text-sm leading-tight">
                {item.title}
              </div>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500">
                {item.startTime && (
                  <span>{formatTime(item.startTime)}</span>
                )}
                <span>{item.durationMins} min</span>
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
            </div>
            <button
              onClick={() => onDelete(item.id)}
              className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-all"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
      {/* Travel time indicator */}
      {item.travelTimeToNextMins > 0 && !isLast && (
        <div className="flex items-center gap-2 ml-14 my-0.5">
          <Bus className="w-3 h-3 text-gray-300" />
          <span className="text-[11px] text-gray-400">
            {item.travelTimeToNextMins} min travel
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
}

export function ItineraryView({ tripId, initialItems, tripStartDate, tripEndDate, weather }: Props) {
  const router = useRouter()
  const [items, setItems] = useState<ItineraryItem[]>(initialItems)
  const [optimizing, setOptimizing] = useState(false)
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set())
  const [addingToDay, setAddingToDay] = useState<string | null>(null)
  const [newItemForm, setNewItemForm] = useState({
    title: "",
    type: "CUSTOM",
    startTime: "",
    durationMins: 60,
  })

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  )

  // Build a date -> forecast lookup for per-day weather display
  const weatherByDate = new Map(
    weather?.forecasts.map((f) => [f.date, f]) ?? []
  )

  const days = groupByDay(items)

  // If no itinerary items yet, build empty day placeholders
  const allDays: GroupedDay<ItineraryItem>[] = days.length > 0 ? days : (() => {
    const result: GroupedDay<ItineraryItem>[] = []
    const start = new Date(tripStartDate)
    const end = new Date(tripEndDate)
    const cur = new Date(start)
    while (cur <= end) {
      const dateStr = cur.toISOString().split("T")[0]
      result.push({ date: new Date(cur), dateStr, items: [] })
      cur.setDate(cur.getDate() + 1)
    }
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
        <button
          onClick={handleOptimize}
          disabled={optimizing}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          <Sparkles className="w-4 h-4" />
          {optimizing ? "Optimizing..." : "Optimize"}
        </button>
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
                        {day.items.map((item, i) => (
                          <SortableItineraryItem
                            key={item.id}
                            item={item}
                            isLast={i === day.items.length - 1}
                            onDelete={handleDelete}
                          />
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
          )
        })}
      </div>
    </div>
  )
}
