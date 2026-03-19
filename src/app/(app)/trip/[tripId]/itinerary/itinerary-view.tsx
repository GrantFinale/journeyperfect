"use client"

import { useState } from "react"
import { toast } from "sonner"
import { runOptimizer, deleteItineraryItem, createItineraryItem } from "@/lib/actions/itinerary"
import { formatDate, formatTime } from "@/lib/utils"
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
} from "lucide-react"
import { cn } from "@/lib/utils"

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

type GroupedDay = {
  date: Date
  dateStr: string
  items: ItineraryItem[]
}

function groupByDay(items: ItineraryItem[]): GroupedDay[] {
  const map = new Map<string, ItineraryItem[]>()
  for (const item of items) {
    const key = new Date(item.date).toISOString().split("T")[0]
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(item)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateStr, items]) => ({
      date: new Date(dateStr + "T12:00:00"),
      dateStr,
      items: items.sort((a, b) => {
        if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime)
        return a.position - b.position
      }),
    }))
}

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

interface Props {
  tripId: string
  initialItems: ItineraryItem[]
  tripStartDate: Date
  tripEndDate: Date
}

export function ItineraryView({ tripId, initialItems, tripStartDate, tripEndDate }: Props) {
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

  const days = groupByDay(items)

  // If no itinerary items yet, build empty day placeholders
  const allDays: GroupedDay[] = days.length > 0 ? days : (() => {
    const result: GroupedDay[] = []
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
      // Refresh — in a real app you'd revalidate but since server state changed, reload
      window.location.reload()
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
      const item = await createItineraryItem(tripId, {
        date: dateStr,
        title: newItemForm.title,
        type: newItemForm.type as "CUSTOM",
        startTime: newItemForm.startTime || undefined,
        durationMins: newItemForm.durationMins,
        position: 99,
      })
      setItems((prev) => [...prev, item as unknown as ItineraryItem])
      setAddingToDay(null)
      setNewItemForm({ title: "", type: "CUSTOM", startTime: "", durationMins: 60 })
      toast.success("Item added")
    } catch {
      toast.error("Failed to add item")
    }
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

      {/* Day list */}
      <div className="space-y-6">
        {allDays.map((day, dayIdx) => {
          const isCollapsed = collapsedDays.has(day.dateStr)
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
                    <div className="font-semibold text-gray-900 text-sm">
                      Day {dayIdx + 1} · {formatDate(day.date, "MMMM d, yyyy")}
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
                  <div className="space-y-2 mb-3">
                    {day.items.map((item, i) => (
                      <div key={item.id}>
                        <div className="flex items-start gap-3 group">
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
                            {i < day.items.length - 1 && (
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
                                onClick={() => handleDelete(item.id)}
                                className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-all"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                        {/* Travel time indicator */}
                        {item.travelTimeToNextMins > 0 && i < day.items.length - 1 && (
                          <div className="flex items-center gap-2 ml-10 my-0.5">
                            <Bus className="w-3 h-3 text-gray-300" />
                            <span className="text-[11px] text-gray-400">
                              {item.travelTimeToNextMins} min travel
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

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
