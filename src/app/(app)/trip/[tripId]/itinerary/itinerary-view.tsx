"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  runOptimizer,
  runAIOptimizer,
  createItineraryItem,
  updateItineraryItem,
  deleteItineraryItem,
} from "@/lib/actions/itinerary"
import {
  updateActivityPriority,
  updateActivityStatus,
  removeActivityFromWishlist,
} from "@/lib/actions/activities"
import type { ItineraryItemResult } from "@/lib/actions/itinerary"
import { formatTime } from "@/lib/utils"
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core"
import {
  Sparkles,
} from "lucide-react"
import { CalendarExportButton } from "@/components/calendar-export"
import { WeatherBar } from "@/components/weather-bar"
import type { TripWeatherData } from "@/lib/weather"
import { groupByDay } from "@/lib/itinerary-utils"
import type { GroupedDay } from "@/lib/itinerary-utils"

import { WishlistPanel } from "./wishlist-panel"
import type { WishlistActivity } from "./wishlist-panel"
import { TimelineView } from "./timeline-view"
import { DragOnboarding, markOnboardingSeen } from "./drag-onboarding"
import { AddCustomEvent } from "@/components/add-custom-event"

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
    imageUrl?: string | null
    indoorOutdoor?: string | null
  } | null
  hotel?: {
    lat: number | null
    lng: number | null
    address: string | null
    name: string
  } | null
  activityId?: string | null
  reservation?: {
    id: string
    confirmationNumber: string | null
    provider: string | null
    bookingUrl: string | null
    partySize: number | null
    specialRequests: string | null
    price: number | null
    currency: string
    status: string
    notes: string | null
  } | null
}

type HotelInfo = {
  id: string
  name: string
  lat: number | null
  lng: number | null
  checkIn: Date
  checkOut: Date
}

// ─── Utility functions ──────────────────────────────────────────────────────

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number)
  return h * 60 + (m || 0)
}

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`
}

// ─── Main Component ─────────────────────────────────────────────────────────

type DestinationInfo = { name: string; lat?: number | null; lng?: number | null }

interface Props {
  tripId: string
  initialItems: ItineraryItem[]
  tripStartDate: Date
  tripEndDate: Date
  weather: TripWeatherData | null
  isPaid?: boolean
  wishlistActivities?: WishlistActivity[]
  hotels?: HotelInfo[]
  showFreeTime?: boolean
  freeTimeMinGapHours?: number
  destinations?: DestinationInfo[]
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
  destinations = [],
}: Props) {
  const router = useRouter()
  const [items, setItems] = useState<ItineraryItem[]>(initialItems)
  const [wishlist, setWishlist] = useState<WishlistActivity[]>(initialWishlist)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const reorderingRef = useRef(false)
  const [, setActiveDragId] = useState<string | null>(null)
  const [showAddCustom, setShowAddCustom] = useState(false)
  const [customModalDefaults, setCustomModalDefaults] = useState<{ date?: string; time?: string }>({})

  function handleOpenCustomModal(dayStr: string, startTime: string) {
    setCustomModalDefaults({ date: dayStr, time: startTime })
    setShowAddCustom(true)
  }

  // Format trip dates for AddCustomEvent
  const tripDateRange = {
    start: tripStartDate.toISOString().split("T")[0],
    end: tripEndDate.toISOString().split("T")[0],
  }

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

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 10 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 500,      // 500ms long press required to start drag
        tolerance: 8,    // allow 8px of movement during the press (prevents scroll triggering drag)
      },
    }),
    useSensor(KeyboardSensor)
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

  async function handleAutoPlan() {
    setOptimizing(true)
    reorderingRef.current = false
    try {
      if (isPaid) {
        const result = await runAIOptimizer(tripId)
        toast.success(`Auto-plan scheduled ${result.scheduledItems.length} activities!`)
      } else {
        const result = await runOptimizer(tripId)
        toast.success(`Auto-plan scheduled ${result.scheduledItems.length} activities!`)
      }
      const { getItinerary } = await import("@/lib/actions/itinerary")
      const freshItems = await getItinerary(tripId)
      setItems(freshItems as ItineraryItem[])
      const { getAllActivitiesForTrip } = await import("@/lib/actions/activities")
      const allActivities = await getAllActivitiesForTrip(tripId)
      setWishlist(allActivities.filter((a: { status: string }) => a.status === "WISHLIST") as WishlistActivity[])
      router.refresh()
    } catch (e) {
      const msg = e instanceof Error && e.message === "UPGRADE_REQUIRED"
        ? "AI auto-plan requires a paid plan. Using basic optimizer."
        : "Auto-plan failed. Make sure you have activities on your wishlist."
      toast.error(msg)
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

  // Handle dropping a wishlist item onto a day
  async function handleWishlistDrop(activityId: string, dateStr: string) {
    const activity = wishlist.find((a) => a.id === activityId)
    if (!activity) return

    markOnboardingSeen()
    setShowOnboarding(false)

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
        startTime = minutesToTime(lastEnd + 30)
      }
    }

    const startMins = timeToMinutes(startTime)
    const endMins = startMins + activity.durationMins
    const endTime = minutesToTime(endMins)

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

    setItems((prev) => prev.filter((i) => i.id !== itemId))

    try {
      await deleteItineraryItem(tripId, itemId)
      await updateActivityStatus(tripId, item.activityId, "WISHLIST")
      router.refresh()
      toast.success("Returned to wishlist")
    } catch {
      setItems((prev) => [...prev, item])
      toast.error("Failed to return to wishlist")
    }
  }

  // Handle moving an itinerary item to a different day
  async function handleMoveToDay(itemId: string, newDayStr: string) {
    const item = items.find((i) => i.id === itemId)
    if (!item) return

    const startTime = item.startTime || "09:00"
    const endMins = timeToMinutes(startTime) + item.durationMins
    const endTime = minutesToTime(endMins)

    const targetDayItems = items.filter((i) => {
      const d = new Date(i.date)
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
      return key === newDayStr
    })
    const newPosition = targetDayItems.length

    setItems((prev) =>
      prev.map((i) =>
        i.id === itemId
          ? {
              ...i,
              date: new Date(newDayStr + "T12:00:00Z"),
              startTime,
              endTime,
              position: newPosition,
            }
          : i
      )
    )

    try {
      await updateItineraryItem(tripId, itemId, {
        date: newDayStr,
        startTime,
        durationMins: item.durationMins,
      })
      const dayIdx = allDays.findIndex((d) => d.dateStr === newDayStr)
      toast.success(`Moved to Day ${dayIdx + 1}`)
    } catch {
      toast.error("Failed to move item")
      router.refresh()
    }
  }

  // Global drag handler for wishlist -> day drops
  function handleGlobalDragStart(event: DragStartEvent) {
    // Haptic feedback on drag activation
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(50) // 50ms short vibration
    }
    setActiveDragId(event.active.id as string)
  }

  function handleGlobalDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveDragId(null)

    if (!over) return

    const activeId = active.id as string
    const overId = over.id as string

    // Timeline item (cross-day drag handle) dropped on a day zone or timeline slot
    if (activeId.startsWith("timeline-item-")) {
      const itemId = activeId.replace("timeline-item-", "")
      const draggedItem = items.find((i) => i.id === itemId)
      if (draggedItem) {
        // Dropped on a day zone
        if (overId.startsWith("day-")) {
          const dateStr = overId.replace("day-", "")
          const d = new Date(draggedItem.date)
          const currentDay = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
          if (currentDay !== dateStr) {
            handleTimelineMoveToDay(itemId, dateStr, draggedItem.startTime || "09:00")
          }
          return
        }
        // Dropped on a timeline slot
        if (overId.startsWith("timeline-day-")) {
          const match = overId.match(/^timeline-day-(\d{4}-\d{2}-\d{2})-(\d{2}:\d{2})$/)
          if (match) {
            const [, dayStr, time] = match
            handleTimelineMoveToDay(itemId, dayStr, time)
            return
          }
        }
        // Dropped on wishlist
        if (overId === "wishlist-drop-zone") {
          handleReturnToWishlist(itemId)
          return
        }
      }
    }

    // Wishlist item dropped on a timeline slot
    if (overId.startsWith("timeline-day-")) {
      const isWishlistItem = wishlist.some((a) => a.id === activeId)
      if (isWishlistItem) {
        const match = overId.match(/^timeline-day-(\d{4}-\d{2}-\d{2})-(\d{2}:\d{2})$/)
        if (match) {
          const [, dayStr, time] = match
          handleTimelineWishlistDrop(dayStr, time, activeId)
          return
        }
      }
    }

    // Item dropped on a day zone
    if (overId.startsWith("day-")) {
      const dateStr = overId.replace("day-", "")
      const isWishlistItem = wishlist.some((a) => a.id === activeId)
      if (isWishlistItem) {
        handleWishlistDrop(activeId, dateStr)
        return
      }

      // Cross-day move (for non-timeline-item draggables, e.g. list view)
      const draggedItem = items.find((i) => i.id === activeId)
      if (draggedItem) {
        const d = new Date(draggedItem.date)
        const currentDay = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
        if (currentDay !== dateStr) {
          const isFixed = draggedItem.type === "FLIGHT" || draggedItem.type === "HOTEL_CHECK_IN" || draggedItem.type === "HOTEL_CHECK_OUT"
          if (!isFixed) {
            handleMoveToDay(activeId, dateStr)
            return
          }
        }
      }
    }

    // Item dropped on wishlist zone
    if (overId === "wishlist-drop-zone") {
      handleReturnToWishlist(activeId)
      return
    }
  }

  async function handleTimelineResize(itemId: string, newDurationMins: number) {
    const item = items.find((i) => i.id === itemId)
    if (!item || !item.startTime) return

    const startMins = timeToMinutes(item.startTime)
    const endMins = startMins + newDurationMins
    const newEndTime = minutesToTime(endMins)

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

  // Handle dropping a wishlist item onto a specific timeline slot
  async function handleTimelineWishlistDrop(dayStr: string, startTime: string, activityId: string) {
    const activity = wishlist.find((a) => a.id === activityId)
    if (!activity) return

    markOnboardingSeen()
    setShowOnboarding(false)

    const startMins = timeToMinutes(startTime)
    const endMins = startMins + activity.durationMins
    const endTime = minutesToTime(endMins)

    setWishlist((prev) => prev.filter((a) => a.id !== activityId))

    try {
      const dayItems = items.filter((i) => {
        const d = new Date(i.date)
        const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
        return key === dayStr
      })

      const item = await createItineraryItem(tripId, {
        date: dayStr,
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
      toast.success(`${activity.name} added at ${formatTime(startTime)}`)
    } catch {
      setWishlist((prev) => [...prev, activity])
      toast.error("Failed to add to itinerary")
    }
  }

  // Handle moving an item to a different day via context menu
  async function handleTimelineMoveToDay(itemId: string, newDayStr: string, newStartTime: string) {
    const item = items.find((i) => i.id === itemId)
    if (!item) return

    const startMins = timeToMinutes(newStartTime)
    const endMins = startMins + item.durationMins
    const newEndTime = minutesToTime(endMins)

    setItems((prev) =>
      prev.map((i) =>
        i.id === itemId
          ? {
              ...i,
              date: new Date(newDayStr + "T12:00:00Z"),
              startTime: newStartTime,
              endTime: newEndTime,
            }
          : i
      )
    )

    try {
      await updateItineraryItem(tripId, itemId, {
        date: newDayStr,
        startTime: newStartTime,
        durationMins: item.durationMins,
      })
      const dayIdx = allDays.findIndex((d) => d.dateStr === newDayStr)
      toast.success(`Moved to Day ${dayIdx + 1} at ${formatTime(newStartTime)}`)
    } catch {
      toast.error("Failed to move item")
      router.refresh()
    }
  }

  // Handle adding from wishlist via timeline click popover
  async function handleAddFromWishlistViaPopover(activityId: string, dayStr: string, startTime: string) {
    await handleTimelineWishlistDrop(dayStr, startTime, activityId)
  }

  // Handle adding a custom event via timeline click popover
  async function handleAddCustomViaPopover(dayStr: string, startTime: string, title: string, durationMins: number) {
    const startMins = timeToMinutes(startTime)
    const endMins = startMins + durationMins
    const endTime = minutesToTime(endMins)

    const dayItems = items.filter((i) => {
      const d = new Date(i.date)
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
      return key === dayStr
    })

    try {
      const item: ItineraryItemResult = await createItineraryItem(tripId, {
        date: dayStr,
        title,
        type: "CUSTOM" as const,
        startTime,
        durationMins,
        costEstimate: 0,
        position: dayItems.length,
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
      }])
      toast.success(`${title} added`)
    } catch {
      toast.error("Failed to add item")
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
      collisionDetection={closestCenter}
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
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 md:py-8">
            {/* Header */}
            <div className="flex items-center justify-between mb-6 md:mb-8">
              <div>
                <h1 className="text-xl md:text-2xl font-bold text-gray-900">Plan</h1>
                <p className="text-gray-500 text-sm mt-0.5">{items.length} items planned</p>
              </div>
              <div className="flex items-center gap-2">
                <CalendarExportButton tripId={tripId} />

                {/* Auto-plan button */}
                <button
                  onClick={handleAutoPlan}
                  disabled={optimizing}
                  className="flex items-center gap-2 px-3 md:px-4 py-2 md:py-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-medium rounded-xl hover:from-violet-700 hover:to-indigo-700 disabled:opacity-50 transition-all shadow-sm"
                >
                  <Sparkles className="w-4 h-4" />
                  <span className="hidden sm:inline">{optimizing ? "Planning..." : "Auto-plan"}</span>
                  <span className="sm:hidden">{optimizing ? "..." : "Plan"}</span>
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

            {/* Timeline view - now the only view */}
            <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden p-2 md:p-4">
              <TimelineView
                tripId={tripId}
                days={allDays}
                onResizeItem={handleTimelineResize}
                onMoveItem={handleTimelineMove}
                onDropFromWishlist={handleTimelineWishlistDrop}
                onMoveToWishlist={handleReturnToWishlist}
                onMoveToDay={handleTimelineMoveToDay}
                onAddFromWishlist={handleAddFromWishlistViaPopover}
                onAddCustom={handleAddCustomViaPopover}
                onOpenCustomModal={handleOpenCustomModal}
                wishlistItems={wishlist}
                hotels={hotels}
              />
            </div>
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
          onAddCustom={() => setShowAddCustom(true)}
        />
      </div>

      {/* Add Custom Event modal */}
      {showAddCustom && (
        <AddCustomEvent
          tripId={tripId}
          tripDates={tripDateRange}
          destinations={destinations}
          defaultDate={customModalDefaults.date}
          defaultTime={customModalDefaults.time}
          onCreated={() => router.refresh()}
          onClose={() => {
            setShowAddCustom(false)
            setCustomModalDefaults({})
          }}
        />
      )}
    </DndContext>
  )
}
