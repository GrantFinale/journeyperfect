"use client"

import { useState, useRef, useCallback, useMemo } from "react"
import { cn } from "@/lib/utils"
import { formatTime } from "@/lib/utils"
import type { GroupedDay } from "@/lib/itinerary-utils"
import { calculateTravel } from "./travel-connector"
import { useDroppable } from "@dnd-kit/core"
import type { WishlistActivity } from "./wishlist-panel"
import { CalendarDays, ArrowRight } from "lucide-react"

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
  activityId?: string | null
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
}

const HOUR_START = 7
const HOUR_END = 23
const TOTAL_HOURS = HOUR_END - HOUR_START
const HOUR_HEIGHT = 56 // pixels per hour
const MIN_DURATION_MINS = 15
const SNAP_MINS = 15

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number)
  return h * 60 + (m || 0)
}

function minutesToTime(mins: number): string {
  const clamped = Math.max(HOUR_START * 60, Math.min(HOUR_END * 60, mins))
  const h = Math.floor(clamped / 60)
  const m = clamped % 60
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`
}

function snapToGrid(mins: number): number {
  return Math.round(mins / SNAP_MINS) * SNAP_MINS
}

function typeColor(type: string) {
  switch (type) {
    case "FLIGHT":
      return "bg-blue-100 border-blue-300 text-blue-800"
    case "HOTEL_CHECK_IN":
    case "HOTEL_CHECK_OUT":
      return "bg-green-100 border-green-300 text-green-800"
    case "ACTIVITY":
      return "bg-indigo-100 border-indigo-300 text-indigo-800"
    case "MEAL":
      return "bg-orange-100 border-orange-300 text-orange-800"
    case "TRANSIT":
      return "bg-gray-100 border-gray-300 text-gray-700"
    case "BUFFER":
      return "bg-yellow-100 border-yellow-300 text-yellow-800"
    default:
      return "bg-gray-100 border-gray-300 text-gray-700"
  }
}

function formatDuration(mins: number) {
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

// ─── Overlap Detection (Google Calendar algorithm) ────────────────────────

type OverlapLayout = {
  item: ItineraryItem
  column: number
  totalColumns: number
}

function computeOverlapLayout(items: ItineraryItem[]): OverlapLayout[] {
  // Filter to only items with start times and sort by start
  const timed = items
    .filter((item) => item.startTime)
    .sort((a, b) => timeToMinutes(a.startTime!) - timeToMinutes(b.startTime!))

  if (timed.length === 0) return []

  // Build overlap groups using a sweep-line approach
  const result: OverlapLayout[] = []

  // For each item, track its column assignment
  const itemColumns = new Map<string, number>()

  // Process items in groups that overlap with each other
  let groupStart = 0
  while (groupStart < timed.length) {
    // Find all items in the current overlap cluster
    const group: ItineraryItem[] = [timed[groupStart]]
    let maxEnd = getItemEnd(timed[groupStart])
    let groupEnd = groupStart + 1

    while (groupEnd < timed.length) {
      const itemStart = timeToMinutes(timed[groupEnd].startTime!)
      if (itemStart < maxEnd) {
        // Overlaps with the group
        group.push(timed[groupEnd])
        maxEnd = Math.max(maxEnd, getItemEnd(timed[groupEnd]))
        groupEnd++
      } else {
        break
      }
    }

    // Assign columns within this group using greedy coloring
    const columns: { end: number }[] = []

    for (const item of group) {
      const start = timeToMinutes(item.startTime!)

      // Find the first column where this item fits (doesn't overlap)
      let col = -1
      for (let c = 0; c < columns.length; c++) {
        if (columns[c].end <= start) {
          col = c
          break
        }
      }

      if (col === -1) {
        // Need a new column
        col = columns.length
        columns.push({ end: getItemEnd(item) })
      } else {
        columns[col].end = getItemEnd(item)
      }

      itemColumns.set(item.id, col)
    }

    // Now set totalColumns for all items in this group
    const totalCols = columns.length
    for (const item of group) {
      result.push({
        item,
        column: itemColumns.get(item.id)!,
        totalColumns: totalCols,
      })
    }

    groupStart = groupEnd
  }

  return result
}

function getItemEnd(item: ItineraryItem): number {
  if (item.endTime) return timeToMinutes(item.endTime)
  return timeToMinutes(item.startTime!) + item.durationMins
}

// ─── Droppable Hour Slot ─────────────────────────────────────────────────

function DroppableHourSlot({
  dayStr,
  hour,
}: {
  dayStr: string
  hour: number
}) {
  const timeStr = `${hour.toString().padStart(2, "0")}:00`
  const { isOver, setNodeRef } = useDroppable({
    id: `timeline-day-${dayStr}-${timeStr}`,
    data: { type: "timeline-slot", dayStr, time: timeStr },
  })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "absolute left-0 right-0 transition-colors",
        isOver && "bg-indigo-50/60"
      )}
      style={{ top: (hour - HOUR_START) * HOUR_HEIGHT, height: HOUR_HEIGHT }}
    />
  )
}

// ─── Move to Day Modal ──────────────────────────────────────────────────

function MoveToDayMenu({
  item,
  days,
  currentDayStr,
  onMove,
  onClose,
  position,
}: {
  item: ItineraryItem
  days: { dateStr: string; label: string; dayIdx: number }[]
  currentDayStr: string
  onMove: (itemId: string, newDayStr: string, newStartTime: string) => void
  onClose: () => void
  position: { x: number; y: number }
}) {
  const otherDays = days.filter((d) => d.dateStr !== currentDayStr)

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      {/* Menu */}
      <div
        className="fixed z-50 bg-white border border-gray-200 rounded-xl shadow-xl py-1 min-w-[180px] max-h-[300px] overflow-y-auto"
        style={{
          left: Math.min(position.x, window.innerWidth - 200),
          top: Math.min(position.y, window.innerHeight - 200),
        }}
      >
        <div className="px-3 py-2 border-b border-gray-100">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Move to day
          </p>
        </div>
        {otherDays.length === 0 ? (
          <div className="px-3 py-2 text-xs text-gray-400">No other days</div>
        ) : (
          otherDays.map((d) => (
            <button
              key={d.dateStr}
              onClick={() => {
                onMove(item.id, d.dateStr, item.startTime || "09:00")
                onClose()
              }}
              className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors flex items-center gap-2"
            >
              <CalendarDays className="w-3.5 h-3.5 text-gray-400" />
              <span>Day {d.dayIdx + 1}</span>
              <span className="text-xs text-gray-400 ml-auto">{d.label}</span>
            </button>
          ))
        )}
      </div>
    </>
  )
}

// ─── Timeline Item ──────────────────────────────────────────────────────

function TimelineItem({
  item,
  column,
  totalColumns,
  onResize,
  onDragMove,
  onContextMenu,
}: {
  item: ItineraryItem
  column: number
  totalColumns: number
  onResize: (itemId: string, newDurationMins: number) => void
  onDragMove: (itemId: string, newStartTime: string, newDurationMins: number) => void
  onContextMenu: (e: React.MouseEvent, item: ItineraryItem) => void
}) {
  const [resizing, setResizing] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [previewDuration, setPreviewDuration] = useState<number | null>(null)
  const [previewStartMins, setPreviewStartMins] = useState<number | null>(null)
  const resizeRef = useRef<{ startY: number; startDuration: number } | null>(null)
  const dragRef = useRef<{ startY: number; startMins: number } | null>(null)

  if (!item.startTime) return null
  const startMins = previewStartMins ?? timeToMinutes(item.startTime)
  const offsetMins = startMins - HOUR_START * 60
  if (offsetMins < 0) return null

  const currentDuration = previewDuration ?? item.durationMins
  const top = (offsetMins / 60) * HOUR_HEIGHT
  const height = Math.max((currentDuration / 60) * HOUR_HEIGHT, 20)

  const isFixed = item.type === "FLIGHT" || item.type === "HOTEL_CHECK_IN" || item.type === "HOTEL_CHECK_OUT"

  // Calculate width and left offset for overlap layout
  const widthPercent = 100 / totalColumns
  const leftPercent = column * widthPercent
  // Add small gap between overlapping items
  const gap = totalColumns > 1 ? 2 : 0
  const leftPx = gap / 2
  const rightPx = gap / 2

  // Resize handlers
  function handleResizePointerDown(e: React.PointerEvent) {
    if (isFixed) return
    e.stopPropagation()
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    setResizing(true)
    resizeRef.current = { startY: e.clientY, startDuration: item.durationMins }
  }

  function handleResizePointerMove(e: React.PointerEvent) {
    if (!resizing || !resizeRef.current) return
    e.preventDefault()
    const deltaY = e.clientY - resizeRef.current.startY
    const deltaMins = (deltaY / HOUR_HEIGHT) * 60
    const newDuration = snapToGrid(Math.max(MIN_DURATION_MINS, resizeRef.current.startDuration + deltaMins))
    setPreviewDuration(newDuration)
  }

  function handleResizePointerUp(e: React.PointerEvent) {
    if (!resizing) return
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    setResizing(false)
    if (previewDuration != null && previewDuration !== item.durationMins) {
      onResize(item.id, previewDuration)
    }
    setPreviewDuration(null)
    resizeRef.current = null
  }

  // Drag-move handlers
  function handleDragPointerDown(e: React.PointerEvent) {
    if (isFixed) return
    if (e.button !== 0) return
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = { startY: e.clientY, startMins: timeToMinutes(item.startTime!) }
  }

  function handleDragPointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return
    const deltaY = e.clientY - dragRef.current.startY
    if (!dragging && Math.abs(deltaY) < 5) return
    if (!dragging) setDragging(true)
    e.preventDefault()
    const deltaMins = (deltaY / HOUR_HEIGHT) * 60
    const newStart = snapToGrid(Math.max(HOUR_START * 60, Math.min(HOUR_END * 60 - item.durationMins, dragRef.current.startMins + deltaMins)))
    setPreviewStartMins(newStart)
  }

  function handleDragPointerUp(e: React.PointerEvent) {
    if (!dragRef.current) return
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    if (dragging && previewStartMins != null) {
      const origStart = timeToMinutes(item.startTime!)
      if (previewStartMins !== origStart) {
        onDragMove(item.id, minutesToTime(previewStartMins), item.durationMins)
      }
    }
    setDragging(false)
    setPreviewStartMins(null)
    dragRef.current = null
  }

  function handleContextMenuEvent(e: React.MouseEvent) {
    e.preventDefault()
    onContextMenu(e, item)
  }

  const showDurationLabel = resizing && previewDuration != null
  const originalDuration = item.durationMins

  return (
    <div
      className={cn(
        "absolute rounded-lg border px-2 py-1 overflow-hidden select-none transition-shadow",
        typeColor(item.type),
        !isFixed && "cursor-grab active:cursor-grabbing",
        (resizing || dragging) && "z-20 shadow-lg ring-2 ring-indigo-400/50"
      )}
      style={{
        top,
        height: Math.min(height, (TOTAL_HOURS * HOUR_HEIGHT) - top),
        left: `calc(${leftPercent}% + ${leftPx + 4}px)`,
        width: `calc(${widthPercent}% - ${leftPx + rightPx + 8}px)`,
      }}
      title={`${item.title} (${formatTime(item.startTime!)}${item.endTime ? ` - ${formatTime(item.endTime)}` : ""}, ${formatDuration(currentDuration)})`}
      onPointerDown={!isFixed ? handleDragPointerDown : undefined}
      onPointerMove={!isFixed ? handleDragPointerMove : undefined}
      onPointerUp={!isFixed ? handleDragPointerUp : undefined}
      onContextMenu={!isFixed ? handleContextMenuEvent : undefined}
    >
      <p className="text-[10px] font-medium truncate leading-tight">
        {item.title}
      </p>
      {height > 30 && (
        <p className="text-[9px] opacity-70 mt-0.5">
          {formatTime(minutesToTime(startMins))} · {formatDuration(currentDuration)}
        </p>
      )}
      {height > 50 && totalColumns > 1 && (
        <p className="text-[8px] opacity-50 mt-0.5">
          Col {column + 1}/{totalColumns}
        </p>
      )}

      {/* Duration change indicator */}
      {showDurationLabel && (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap z-30 shadow-md">
          {formatDuration(originalDuration)} → {formatDuration(previewDuration)}
        </div>
      )}

      {/* Drag move indicator */}
      {dragging && previewStartMins != null && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-full bg-gray-900 text-white text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap z-30 shadow-md mb-1">
          {formatTime(minutesToTime(previewStartMins))}
        </div>
      )}

      {/* Resize handle at bottom edge */}
      {!isFixed && (
        <div
          className="absolute bottom-0 left-0 right-0 h-2 cursor-row-resize group/resize flex items-center justify-center"
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
        >
          <div className="w-8 h-1 rounded-full bg-current opacity-30 group-hover/resize:opacity-60 transition-opacity" />
        </div>
      )}
    </div>
  )
}

// ─── Current Time Indicator ─────────────────────────────────────────────

function CurrentTimeIndicator() {
  const now = new Date()
  const mins = now.getHours() * 60 + now.getMinutes()
  if (mins < HOUR_START * 60 || mins > HOUR_END * 60) return null
  const top = ((mins - HOUR_START * 60) / 60) * HOUR_HEIGHT

  return (
    <div className="absolute left-0 right-0 z-30 pointer-events-none" style={{ top }}>
      <div className="flex items-center">
        <div className="w-2 h-2 rounded-full bg-red-500 -ml-1" />
        <div className="flex-1 h-px bg-red-500" />
      </div>
    </div>
  )
}

// ─── Wishlist Drop Preview ──────────────────────────────────────────────

function WishlistDropPreview({
  dayStr,
  isOver,
}: {
  dayStr: string
  isOver: boolean
}) {
  if (!isOver) return null

  return (
    <div className="absolute inset-0 z-10 pointer-events-none">
      <div className="absolute inset-0 bg-indigo-50/40 border-2 border-dashed border-indigo-300 rounded-lg flex items-center justify-center">
        <div className="bg-white/90 px-3 py-1.5 rounded-lg shadow-sm border border-indigo-200">
          <p className="text-xs font-medium text-indigo-600 flex items-center gap-1.5">
            <ArrowRight className="w-3.5 h-3.5" />
            Drop to add to this day
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── Timeline Day ───────────────────────────────────────────────────────

function TimelineDay({
  day,
  dayIdx,
  onResize,
  onDragMove,
  onContextMenu,
  allDays,
}: {
  day: GroupedDay<ItineraryItem>
  dayIdx: number
  onResize: (itemId: string, newDurationMins: number) => void
  onDragMove: (itemId: string, newStartTime: string, newDurationMins: number) => void
  onContextMenu: (e: React.MouseEvent, item: ItineraryItem) => void
  allDays: { dateStr: string; label: string; dayIdx: number }[]
}) {
  const dayDate = new Date(day.date)
  const dayLabel = dayDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })

  // Compute overlap layout for this day's items
  const layoutItems = useMemo(() => computeOverlapLayout(day.items), [day.items])

  // Build droppable hour slots
  const hourSlots = useMemo(
    () =>
      Array.from({ length: TOTAL_HOURS }, (_, i) => HOUR_START + i),
    []
  )

  // Droppable zone for the entire day column (for wishlist drops)
  const { isOver: isDayOver, setNodeRef: setDayDropRef } = useDroppable({
    id: `day-${day.dateStr}`,
    data: { type: "timeline-day", dayStr: day.dateStr },
  })

  return (
    <div className="flex-1 min-w-[200px] max-w-[320px]" ref={setDayDropRef}>
      {/* Day header */}
      <div className="sticky top-0 bg-white z-10 border-b border-gray-200 px-2 py-2 text-center">
        <p className="text-xs font-semibold text-gray-900">Day {dayIdx + 1}</p>
        <p className="text-[10px] text-gray-500">{dayLabel}</p>
      </div>

      {/* Timeline grid */}
      <div className="relative" style={{ height: TOTAL_HOURS * HOUR_HEIGHT }}>
        {/* Hour lines */}
        {Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => (
          <div
            key={i}
            className="absolute left-0 right-0 border-t border-gray-100"
            style={{ top: i * HOUR_HEIGHT }}
          />
        ))}

        {/* Droppable hour slots for wishlist drops */}
        {hourSlots.map((hour) => (
          <DroppableHourSlot
            key={hour}
            dayStr={day.dateStr}
            hour={hour}
          />
        ))}

        {/* Wishlist drop preview overlay */}
        <WishlistDropPreview dayStr={day.dateStr} isOver={isDayOver} />

        {/* Current time indicator */}
        <CurrentTimeIndicator />

        {/* Items with overlap layout */}
        {layoutItems.map((layout) => {
          const { item, column, totalColumns } = layout

          return (
            <TimelineItem
              key={item.id}
              item={item}
              column={column}
              totalColumns={totalColumns}
              onResize={onResize}
              onDragMove={onDragMove}
              onContextMenu={onContextMenu}
            />
          )
        })}

        {/* Travel connectors between non-overlapping sequential items */}
        {day.items
          .filter((item) => item.startTime)
          .sort((a, b) => timeToMinutes(a.startTime!) - timeToMinutes(b.startTime!))
          .map((item, i, sorted) => {
            if (i >= sorted.length - 1) return null
            const nextItem = sorted[i + 1]
            if (!nextItem.startTime) return null

            // Only show travel connectors for non-overlapping items
            const itemEnd = item.endTime
              ? timeToMinutes(item.endTime)
              : timeToMinutes(item.startTime!) + item.durationMins
            const nextStart = timeToMinutes(nextItem.startTime!)

            if (nextStart <= itemEnd) return null // Overlapping, skip travel

            const fromLat = item.activity?.lat || item.hotel?.lat
            const fromLng = item.activity?.lng || item.hotel?.lng
            const toLat = nextItem.activity?.lat || nextItem.hotel?.lat
            const toLng = nextItem.activity?.lng || nextItem.hotel?.lng
            const travel = calculateTravel(fromLat, fromLng, toLat, toLng)

            if (!travel) return null

            const travelTop = ((itemEnd - HOUR_START * 60) / 60) * HOUR_HEIGHT
            const gapHeight = ((nextStart - itemEnd) / 60) * HOUR_HEIGHT
            const travelHeight = Math.min((travel.travelMins / 60) * HOUR_HEIGHT, gapHeight, 40)
            const modeIcon = travel.mode === "walk" ? "\uD83D\uDEB6" : "\uD83D\uDE97"

            const mapsUrl = fromLat && fromLng && toLat && toLng
              ? `https://www.google.com/maps/dir/?api=1&origin=${fromLat},${fromLng}&destination=${toLat},${toLng}&travelmode=${travel.mode === "walk" ? "walking" : "driving"}`
              : null

            return travelHeight > 2 ? (
              mapsUrl ? (
                <a
                  key={`travel-${item.id}`}
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="absolute left-0 right-0 flex flex-col items-center group/travel cursor-pointer z-10"
                  style={{ top: travelTop, height: Math.max(travelHeight, 16) }}
                  title={`${travel.travelMins} min ${travel.mode === "walk" ? "walk" : "drive"} - Click for directions`}
                >
                  <div className="w-0.5 flex-1 bg-gray-300 group-hover/travel:bg-indigo-400 transition-colors" />
                  <div className="text-[8px] text-gray-400 group-hover/travel:text-indigo-600 whitespace-nowrap flex items-center gap-0.5 bg-white px-1 rounded">
                    <span>{modeIcon}</span>
                    <span>{travel.travelMins}m</span>
                  </div>
                  <div className="w-0.5 flex-1 bg-gray-300 group-hover/travel:bg-indigo-400 transition-colors" />
                </a>
              ) : (
                <div
                  key={`travel-${item.id}`}
                  className="absolute left-0 right-0 flex flex-col items-center z-10"
                  style={{ top: travelTop, height: Math.max(travelHeight, 16) }}
                  title={`${travel.travelMins} min ${travel.mode === "walk" ? "walk" : "drive"}`}
                >
                  <div className="w-0.5 flex-1 bg-gray-300" />
                  <div className="text-[8px] text-gray-400 whitespace-nowrap flex items-center gap-0.5 bg-white px-1 rounded">
                    <span>{modeIcon}</span>
                    <span>{travel.travelMins}m</span>
                  </div>
                  <div className="w-0.5 flex-1 bg-gray-300" />
                </div>
              )
            ) : null
          })}
      </div>
    </div>
  )
}

// ─── Main TimelineView ──────────────────────────────────────────────────

interface TimelineViewProps {
  days: GroupedDay<ItineraryItem>[]
  onResizeItem?: (itemId: string, newDurationMins: number) => void
  onMoveItem?: (itemId: string, newStartTime: string, newDurationMins: number) => void
  onDropFromWishlist?: (dayStr: string, startTime: string, activityId: string) => void
  onMoveToWishlist?: (itemId: string) => void
  onMoveToDay?: (itemId: string, newDayStr: string, newStartTime: string) => void
  wishlistItems?: WishlistActivity[]
}

export function TimelineView({
  days,
  onResizeItem,
  onMoveItem,
  onDropFromWishlist,
  onMoveToWishlist,
  onMoveToDay,
  wishlistItems,
}: TimelineViewProps) {
  const [contextMenu, setContextMenu] = useState<{
    item: ItineraryItem
    position: { x: number; y: number }
    dayStr: string
  } | null>(null)

  const handleResize = useCallback((itemId: string, newDurationMins: number) => {
    onResizeItem?.(itemId, newDurationMins)
  }, [onResizeItem])

  const handleDragMove = useCallback((itemId: string, newStartTime: string, newDurationMins: number) => {
    onMoveItem?.(itemId, newStartTime, newDurationMins)
  }, [onMoveItem])

  const handleContextMenu = useCallback((e: React.MouseEvent, item: ItineraryItem, dayStr: string) => {
    setContextMenu({
      item,
      position: { x: e.clientX, y: e.clientY },
      dayStr,
    })
  }, [])

  const handleMoveToDay = useCallback((itemId: string, newDayStr: string, newStartTime: string) => {
    onMoveToDay?.(itemId, newDayStr, newStartTime)
  }, [onMoveToDay])

  // Build day info for the context menu
  const dayInfos = useMemo(
    () =>
      days.map((d, i) => {
        const dayDate = new Date(d.date)
        return {
          dateStr: d.dateStr,
          label: dayDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
          dayIdx: i,
        }
      }),
    [days]
  )

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-0">
        {/* Hour labels */}
        <div className="w-12 shrink-0">
          <div className="h-[42px] border-b border-gray-200" /> {/* header spacer */}
          <div className="relative" style={{ height: TOTAL_HOURS * HOUR_HEIGHT }}>
            {Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => {
              const hour = HOUR_START + i
              return (
                <div
                  key={i}
                  className="absolute left-0 right-0 text-[10px] text-gray-400 text-right pr-2 -translate-y-1/2"
                  style={{ top: i * HOUR_HEIGHT }}
                >
                  {hour <= 23
                    ? `${hour > 12 ? hour - 12 : hour}${hour >= 12 ? "pm" : "am"}`
                    : ""}
                </div>
              )
            })}
          </div>
        </div>

        {/* Day columns */}
        {days.map((day, i) => (
          <div key={day.dateStr} className="border-l border-gray-200">
            <TimelineDay
              day={day}
              dayIdx={i}
              onResize={handleResize}
              onDragMove={handleDragMove}
              onContextMenu={(e, item) => handleContextMenu(e, item, day.dateStr)}
              allDays={dayInfos}
            />
          </div>
        ))}
      </div>

      {/* Context menu for moving items between days */}
      {contextMenu && onMoveToDay && (
        <MoveToDayMenu
          item={contextMenu.item}
          days={dayInfos}
          currentDayStr={contextMenu.dayStr}
          onMove={handleMoveToDay}
          onClose={() => setContextMenu(null)}
          position={contextMenu.position}
        />
      )}
    </div>
  )
}
