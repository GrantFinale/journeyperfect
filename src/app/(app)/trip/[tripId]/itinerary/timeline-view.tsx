"use client"

import { useState, useRef, useCallback, useMemo, useEffect } from "react"
import { cn } from "@/lib/utils"
import { formatTime } from "@/lib/utils"
import type { GroupedDay } from "@/lib/itinerary-utils"
import { calculateTravel } from "./travel-connector"
import { useDroppable } from "@dnd-kit/core"
import type { WishlistActivity } from "./wishlist-panel"
import { CalendarDays, ArrowRight, X, MapPin, Plus } from "lucide-react"

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
}

const HOUR_START = 7
const HOUR_END = 23
const TOTAL_HOURS = HOUR_END - HOUR_START
const HOUR_HEIGHT_DESKTOP = 56
const HOUR_HEIGHT_MOBILE = 64
const MIN_DURATION_MINS = 15
const SNAP_MINS = 15

function useResponsiveMode() {
  const [mode, setMode] = useState<"mobile" | "tablet" | "desktop">("desktop")
  useEffect(() => {
    const check = () => {
      const w = window.innerWidth
      if (w < 768) setMode("mobile")
      else if (w < 1024) setMode("tablet")
      else setMode("desktop")
    }
    check()
    window.addEventListener("resize", check)
    return () => window.removeEventListener("resize", check)
  }, [])
  return mode
}

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
      return "bg-sky-100 border-sky-300 text-sky-800"
    case "ACTIVITY":
      return "bg-indigo-100 border-indigo-300 text-indigo-800"
    case "MEAL":
      return "bg-amber-100 border-amber-300 text-amber-800"
    case "TRANSIT":
      return "bg-gray-100 border-gray-300 text-gray-700"
    case "BUFFER":
      return "bg-yellow-100 border-yellow-300 text-yellow-800"
    default:
      return "bg-gray-100 border-gray-300 text-gray-700"
  }
}

function typeIcon(type: string): string {
  switch (type) {
    case "FLIGHT": return "\u2708\uFE0F"
    case "HOTEL_CHECK_IN":
    case "HOTEL_CHECK_OUT": return "\uD83C\uDFE8"
    case "MEAL": return "\uD83C\uDF7D\uFE0F"
    case "TRANSIT": return "\uD83D\uDE8C"
    default: return ""
  }
}

function formatDuration(mins: number) {
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

// ─── Visual Duration for Flights ─────────────────────────────────────────
function getVisualDuration(item: ItineraryItem): number {
  if (item.type === "FLIGHT" && item.startTime && item.endTime) {
    const startMins = timeToMinutes(item.startTime)
    const endMins = timeToMinutes(item.endTime)
    return endMins > startMins ? endMins - startMins : item.durationMins
  }
  return item.durationMins
}

// ─── Overlap Detection (Google Calendar algorithm) ────────────────────────

type OverlapLayout = {
  item: ItineraryItem
  column: number
  totalColumns: number
}

function computeOverlapLayout(items: ItineraryItem[], previewDurations?: Map<string, number>, previewStartTimes?: Map<string, number>): OverlapLayout[] {
  const timed = items
    .filter((item) => item.startTime)
    .sort((a, b) => {
      const aStart = previewStartTimes?.get(a.id) ?? timeToMinutes(a.startTime!)
      const bStart = previewStartTimes?.get(b.id) ?? timeToMinutes(b.startTime!)
      return aStart - bStart
    })

  if (timed.length === 0) return []

  const result: OverlapLayout[] = []
  const itemColumns = new Map<string, number>()

  let groupStart = 0
  while (groupStart < timed.length) {
    const group: ItineraryItem[] = [timed[groupStart]]
    let maxEnd = getItemEnd(timed[groupStart], previewDurations, previewStartTimes)
    let groupEnd = groupStart + 1

    while (groupEnd < timed.length) {
      const itemStart = previewStartTimes?.get(timed[groupEnd].id) ?? timeToMinutes(timed[groupEnd].startTime!)
      if (itemStart < maxEnd) {
        group.push(timed[groupEnd])
        maxEnd = Math.max(maxEnd, getItemEnd(timed[groupEnd], previewDurations, previewStartTimes))
        groupEnd++
      } else {
        break
      }
    }

    const columns: { end: number }[] = []
    for (const item of group) {
      const start = previewStartTimes?.get(item.id) ?? timeToMinutes(item.startTime!)
      let col = -1
      for (let c = 0; c < columns.length; c++) {
        if (columns[c].end <= start) {
          col = c
          break
        }
      }
      if (col === -1) {
        col = columns.length
        columns.push({ end: getItemEnd(item, previewDurations, previewStartTimes) })
      } else {
        columns[col].end = getItemEnd(item, previewDurations, previewStartTimes)
      }
      itemColumns.set(item.id, col)
    }

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

function getItemEnd(item: ItineraryItem, previewDurations?: Map<string, number>, previewStartTimes?: Map<string, number>): number {
  const duration = previewDurations?.get(item.id) ?? getVisualDuration(item)
  const startMins = previewStartTimes?.get(item.id) ?? timeToMinutes(item.startTime!)
  return startMins + duration
}

// ─── Droppable Hour Slot ─────────────────────────────────────────────────

function DroppableHourSlot({
  dayStr,
  hour,
  hourHeight,
}: {
  dayStr: string
  hour: number
  hourHeight: number
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
      style={{ top: (hour - HOUR_START) * hourHeight, height: hourHeight }}
    />
  )
}

// ─── Move to Day Modal ──────────────────────────────────────────────────

function MoveToDayMenu({
  item,
  days,
  currentDayStr,
  onMove,
  onMoveToWishlist,
  onClose,
  position,
}: {
  item: ItineraryItem
  days: { dateStr: string; label: string; dayIdx: number }[]
  currentDayStr: string
  onMove: (itemId: string, newDayStr: string, newStartTime: string) => void
  onMoveToWishlist?: (itemId: string) => void
  onClose: () => void
  position: { x: number; y: number }
}) {
  const otherDays = days.filter((d) => d.dateStr !== currentDayStr)
  const canUnschedule = item.type === "ACTIVITY" || item.type === "MEAL" || item.type === "BUFFER"

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 bg-white border border-gray-200 rounded-xl shadow-xl py-1 min-w-[180px] max-h-[300px] overflow-y-auto"
        style={{
          left: Math.min(position.x, window.innerWidth - 200),
          top: Math.min(position.y, window.innerHeight - 200),
        }}
      >
        {canUnschedule && onMoveToWishlist && (
          <>
            <button
              onClick={() => {
                onMoveToWishlist(item.id)
                onClose()
              }}
              className="w-full text-left px-3 py-2 text-sm text-orange-600 hover:bg-orange-50 transition-colors flex items-center gap-2"
            >
              <X className="w-3.5 h-3.5" />
              <span>Remove from plan</span>
            </button>
            <div className="border-b border-gray-100" />
          </>
        )}

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

// ─── Add Event Popover ───────────────────────────────────────────────────

function AddEventPopover({
  dayStr,
  startTime,
  position,
  wishlistItems,
  onAddFromWishlist,
  onAddCustom,
  onClose,
}: {
  dayStr: string
  startTime: string
  position: { x: number; y: number }
  wishlistItems: WishlistActivity[]
  onAddFromWishlist?: (activityId: string, dayStr: string, startTime: string) => void
  onAddCustom?: (dayStr: string, startTime: string, title: string, durationMins: number) => void
  onClose: () => void
}) {
  const [mode, setMode] = useState<"menu" | "wishlist" | "custom">("menu")
  const [title, setTitle] = useState("")
  const [duration, setDuration] = useState(60)

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 bg-white border border-gray-200 rounded-xl shadow-xl py-2 min-w-[220px] max-w-[280px]"
        style={{
          left: Math.min(position.x, window.innerWidth - 300),
          top: Math.min(position.y, window.innerHeight - 250),
        }}
      >
        <div className="px-3 pb-2 border-b border-gray-100">
          <p className="text-xs font-semibold text-gray-500">Add at {formatTime(startTime)}</p>
        </div>

        {mode === "menu" && (
          <div className="py-1">
            {wishlistItems.length > 0 && onAddFromWishlist && (
              <button
                onClick={() => setMode("wishlist")}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors flex items-center gap-2"
              >
                <Plus className="w-3.5 h-3.5 text-indigo-500" />
                <span>From wishlist</span>
                <span className="text-[10px] text-gray-400 ml-auto">({wishlistItems.length})</span>
              </button>
            )}
            {onAddCustom && (
              <button
                onClick={() => setMode("custom")}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2"
              >
                <Plus className="w-3.5 h-3.5 text-gray-500" />
                <span>Custom event</span>
              </button>
            )}
          </div>
        )}

        {mode === "wishlist" && (
          <div className="py-1 max-h-[200px] overflow-y-auto">
            <button
              onClick={() => setMode("menu")}
              className="w-full text-left px-3 py-1.5 text-[10px] text-gray-400 hover:text-gray-600 uppercase tracking-wide"
            >
              &larr; Back
            </button>
            {wishlistItems.map((a) => (
              <button
                key={a.id}
                onClick={() => {
                  onAddFromWishlist?.(a.id, dayStr, startTime)
                  onClose()
                }}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors flex items-center gap-2"
              >
                <span className="flex-1 truncate">{a.name}</span>
                <span className="text-[10px] text-gray-400 shrink-0">{formatDuration(a.durationMins)}</span>
              </button>
            ))}
          </div>
        )}

        {mode === "custom" && (
          <div className="p-3 space-y-2">
            <button
              onClick={() => setMode("menu")}
              className="text-[10px] text-gray-400 hover:text-gray-600 uppercase tracking-wide"
            >
              &larr; Back
            </button>
            <input
              type="text"
              placeholder="Event title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              autoFocus
            />
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">Duration:</label>
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white"
              >
                <option value={30}>30m</option>
                <option value={60}>1h</option>
                <option value={90}>1h 30m</option>
                <option value={120}>2h</option>
                <option value={180}>3h</option>
              </select>
            </div>
            <button
              onClick={() => {
                if (title.trim()) {
                  onAddCustom?.(dayStr, startTime, title, duration)
                  onClose()
                }
              }}
              disabled={!title.trim()}
              className="w-full py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors"
            >
              Add
            </button>
          </div>
        )}
      </div>
    </>
  )
}

// ─── Timeline Item (Enhanced) ────────────────────────────────────────────

function TimelineItem({
  item,
  column,
  totalColumns,
  hourHeight,
  onResize,
  onDragMove,
  onContextMenu,
  onMoveToWishlist,
  onPreviewChange,
  onPreviewStartChange,
}: {
  item: ItineraryItem
  column: number
  totalColumns: number
  hourHeight: number
  onResize: (itemId: string, newDurationMins: number) => void
  onDragMove: (itemId: string, newStartTime: string, newDurationMins: number) => void
  onContextMenu: (e: React.MouseEvent, item: ItineraryItem) => void
  onMoveToWishlist?: (itemId: string) => void
  onPreviewChange?: (itemId: string, previewDuration: number | null) => void
  onPreviewStartChange?: (itemId: string, previewStartMins: number | null) => void
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

  const currentDuration = previewDuration ?? getVisualDuration(item)
  const top = (offsetMins / 60) * hourHeight
  const height = Math.max((currentDuration / 60) * hourHeight, 20)

  const isFixed = item.type === "FLIGHT" || item.type === "HOTEL_CHECK_IN" || item.type === "HOTEL_CHECK_OUT"

  const widthPercent = 100 / totalColumns
  const leftPercent = column * widthPercent
  const gap = totalColumns > 1 ? 2 : 0
  const leftPx = gap / 2
  const rightPx = gap / 2

  // Card size tiers
  const isLarge = height > 60
  const isMedium = height > 40 && height <= 60

  // Compute end time for display
  const endMins = startMins + currentDuration
  const endTimeStr = minutesToTime(endMins)

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
    const deltaMins = (deltaY / hourHeight) * 60
    const newDuration = snapToGrid(Math.max(MIN_DURATION_MINS, resizeRef.current.startDuration + deltaMins))
    setPreviewDuration(newDuration)
    onPreviewChange?.(item.id, newDuration)
  }

  function handleResizePointerUp(e: React.PointerEvent) {
    if (!resizing) return
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    setResizing(false)
    if (previewDuration != null && previewDuration !== item.durationMins) {
      onResize(item.id, previewDuration)
    }
    setPreviewDuration(null)
    onPreviewChange?.(item.id, null)
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
    const deltaMins = (deltaY / hourHeight) * 60
    const newStart = snapToGrid(Math.max(HOUR_START * 60, Math.min(HOUR_END * 60 - item.durationMins, dragRef.current.startMins + deltaMins)))
    setPreviewStartMins(newStart)
    onPreviewStartChange?.(item.id, newStart)
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
    onPreviewStartChange?.(item.id, null)
    dragRef.current = null
  }

  function handleContextMenuEvent(e: React.MouseEvent) {
    e.preventDefault()
    onContextMenu(e, item)
  }

  const showDurationLabel = resizing && previewDuration != null
  const originalDuration = item.durationMins

  // --- Render card content based on type and size ---
  function renderCardContent() {
    // FLIGHT items
    if (item.type === "FLIGHT") {
      const f = item.flight
      return (
        <div className="flex flex-col h-full overflow-hidden">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs shrink-0">{"\u2708\uFE0F"}</span>
            <p className="text-[11px] font-semibold truncate leading-tight">
              {f?.departureAirport && f?.arrivalAirport
                ? `${f.departureAirport} \u2192 ${f.arrivalAirport}`
                : item.title}
            </p>
          </div>
          {isLarge && f && (
            <>
              {(f.airline || f.flightNumber) && (
                <p className="text-[9px] opacity-70 mt-0.5 truncate">
                  {[f.airline, f.flightNumber].filter(Boolean).join(" ")}
                </p>
              )}
              <p className="text-[9px] opacity-70 mt-0.5">
                {formatTime(minutesToTime(startMins))} - {formatTime(endTimeStr)} {"\u00B7"} {formatDuration(currentDuration)}
              </p>
              <div className="flex items-center gap-2 mt-1">
                {f.departureAirport && (
                  <a
                    href={`https://www.google.com/maps/search/${f.departureAirport}+airport`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[8px] text-blue-600 hover:text-blue-800 underline flex items-center gap-0.5"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <MapPin className="w-2 h-2" />{f.departureAirport}
                  </a>
                )}
                {f.arrivalAirport && (
                  <a
                    href={`https://www.google.com/maps/search/${f.arrivalAirport}+airport`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[8px] text-blue-600 hover:text-blue-800 underline flex items-center gap-0.5"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <MapPin className="w-2 h-2" />{f.arrivalAirport}
                  </a>
                )}
              </div>
            </>
          )}
          {isMedium && (
            <p className="text-[9px] opacity-70 mt-0.5">
              {formatTime(minutesToTime(startMins))} - {formatTime(endTimeStr)}
            </p>
          )}
        </div>
      )
    }

    // HOTEL items
    if (item.type === "HOTEL_CHECK_IN" || item.type === "HOTEL_CHECK_OUT") {
      return (
        <div className="flex flex-col h-full overflow-hidden">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs shrink-0">{"\uD83C\uDFE8"}</span>
            <p className="text-[11px] font-semibold truncate leading-tight">{item.title}</p>
          </div>
          {isLarge && (
            <>
              <p className="text-[9px] opacity-70 mt-0.5">
                {item.type === "HOTEL_CHECK_IN" ? "Check-in" : "Check-out"} {"\u00B7"} {formatTime(minutesToTime(startMins))}
              </p>
              {item.hotel?.name && (
                <p className="text-[9px] opacity-60 truncate mt-0.5">{item.hotel.name}</p>
              )}
            </>
          )}
          {isMedium && (
            <p className="text-[9px] opacity-70 mt-0.5">
              {formatTime(minutesToTime(startMins))} {"\u00B7"} {formatDuration(currentDuration)}
            </p>
          )}
        </div>
      )
    }

    // LARGE card (> 60px, ~1hr+): full details
    if (isLarge) {
      const imgUrl = item.activity?.imageUrl
      const address = item.activity?.address || item.hotel?.address
      const io = item.activity?.indoorOutdoor
      return (
        <div className="flex gap-2 h-full overflow-hidden">
          {imgUrl && (
            <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 mt-0.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imgUrl} alt="" className="w-full h-full object-cover" />
            </div>
          )}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex items-start justify-between gap-1">
              <p className="text-[11px] font-semibold truncate leading-tight flex-1">
                {typeIcon(item.type) ? `${typeIcon(item.type)} ` : ""}{item.title}
              </p>
            </div>
            <p className="text-[9px] opacity-70 mt-0.5">
              {formatTime(minutesToTime(startMins))} - {formatTime(endTimeStr)} {"\u00B7"} {formatDuration(currentDuration)}
            </p>
            {address && (
              <p className="text-[8px] opacity-50 truncate mt-0.5 flex items-center gap-0.5">
                <MapPin className="w-2 h-2 shrink-0" />{address}
              </p>
            )}
            {io && io !== "BOTH" && (
              <span className={cn(
                "inline-flex items-center gap-0.5 text-[8px] font-medium px-1 py-0.5 rounded-full mt-0.5 w-fit",
                io === "INDOOR" ? "bg-blue-50/80 text-blue-600" : "bg-green-50/80 text-green-600"
              )}>
                {io === "INDOOR" ? "\uD83C\uDFE0" : "\uD83C\uDF33"} {io === "INDOOR" ? "Indoor" : "Outdoor"}
              </span>
            )}
          </div>
        </div>
      )
    }

    // MEDIUM card (40-60px): title + time on one line, duration badge
    if (isMedium) {
      return (
        <div className="flex flex-col h-full overflow-hidden">
          <p className="text-[10px] font-semibold truncate leading-tight">
            {typeIcon(item.type) ? `${typeIcon(item.type)} ` : ""}{item.title}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[9px] opacity-70">
              {formatTime(minutesToTime(startMins))} - {formatTime(endTimeStr)}
            </span>
            <span className="text-[8px] bg-black/5 rounded px-1 py-0.5 font-medium">
              {formatDuration(currentDuration)}
            </span>
          </div>
        </div>
      )
    }

    // SMALL card (< 40px): just title
    return (
      <p className="text-[10px] font-medium truncate leading-tight pr-4">
        {typeIcon(item.type) ? `${typeIcon(item.type)} ` : ""}{item.title}
      </p>
    )
  }

  return (
    <div
      className={cn(
        "absolute rounded-lg border overflow-hidden select-none transition-shadow group/timeline-item",
        typeColor(item.type),
        !isFixed && "cursor-grab active:cursor-grabbing",
        (resizing || dragging) && "z-20 shadow-lg ring-2 ring-indigo-400/50"
      )}
      style={{
        top,
        height: Math.min(height, (TOTAL_HOURS * hourHeight) - top),
        left: `calc(${leftPercent}% + ${leftPx + 4}px)`,
        width: `calc(${widthPercent}% - ${leftPx + rightPx + 8}px)`,
      }}
      title={`${item.title} (${formatTime(item.startTime!)}${item.endTime ? ` - ${formatTime(item.endTime)}` : ""}, ${formatDuration(currentDuration)})`}
      onPointerDown={!isFixed ? handleDragPointerDown : undefined}
      onPointerMove={!isFixed ? handleDragPointerMove : undefined}
      onPointerUp={!isFixed ? handleDragPointerUp : undefined}
      onContextMenu={!isFixed ? handleContextMenuEvent : undefined}
    >
      <div className="px-2 py-1 h-full">
        {renderCardContent()}
      </div>

      {/* Hover unschedule button for non-fixed items */}
      {!isFixed && onMoveToWishlist && (
        <button
          className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-white/90 hover:bg-red-100 text-gray-400 hover:text-red-600 opacity-0 group-hover/timeline-item:opacity-100 transition-all flex items-center justify-center z-10 shadow-sm"
          title="Remove from plan"
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            onMoveToWishlist(item.id)
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <X className="w-3 h-3" />
        </button>
      )}

      {/* Duration change indicator */}
      {showDurationLabel && (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap z-30 shadow-md">
          {formatDuration(originalDuration)} &rarr; {formatDuration(previewDuration)}
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

function CurrentTimeIndicator({ hourHeight }: { hourHeight: number }) {
  const now = new Date()
  const mins = now.getHours() * 60 + now.getMinutes()
  if (mins < HOUR_START * 60 || mins > HOUR_END * 60) return null
  const top = ((mins - HOUR_START * 60) / 60) * hourHeight

  return (
    <div className="absolute left-0 right-0 z-30 pointer-events-none" style={{ top }}>
      <div className="flex items-center">
        <div className="w-2.5 h-2.5 rounded-full bg-red-500 -ml-1 shadow-sm" />
        <div className="flex-1 h-0.5 bg-red-500/80" />
      </div>
    </div>
  )
}

// ─── Wishlist Drop Preview ──────────────────────────────────────────────

function WishlistDropPreview({
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
  hourHeight,
  onResize,
  onDragMove,
  onContextMenu,
  onMoveToWishlist,
  hotel,
  wishlistItems,
  onAddFromWishlist,
  onAddCustom,
  isMobileFullWidth,
}: {
  day: GroupedDay<ItineraryItem>
  dayIdx: number
  hourHeight: number
  onResize: (itemId: string, newDurationMins: number) => void
  onDragMove: (itemId: string, newStartTime: string, newDurationMins: number) => void
  onContextMenu: (e: React.MouseEvent, item: ItineraryItem) => void
  onMoveToWishlist?: (itemId: string) => void
  hotel?: HotelInfo | null
  wishlistItems?: WishlistActivity[]
  onAddFromWishlist?: (activityId: string, dayStr: string, startTime: string) => void
  onAddCustom?: (dayStr: string, startTime: string, title: string, durationMins: number) => void
  isMobileFullWidth?: boolean
}) {
  const dayDate = new Date(day.date)
  const dayLabel = dayDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })

  const [previewDurations, setPreviewDurations] = useState<Map<string, number>>(new Map())
  const [previewStartTimes, setPreviewStartTimes] = useState<Map<string, number>>(new Map())
  const [addPopover, setAddPopover] = useState<{ startTime: string; position: { x: number; y: number } } | null>(null)

  const handlePreviewChange = useCallback((itemId: string, previewDuration: number | null) => {
    setPreviewDurations(prev => {
      const next = new Map(prev)
      if (previewDuration == null) next.delete(itemId)
      else next.set(itemId, previewDuration)
      return next
    })
  }, [])

  const handlePreviewStartChange = useCallback((itemId: string, previewStartMins: number | null) => {
    setPreviewStartTimes(prev => {
      const next = new Map(prev)
      if (previewStartMins == null) next.delete(itemId)
      else next.set(itemId, previewStartMins)
      return next
    })
  }, [])

  const layoutItems = useMemo(
    () => computeOverlapLayout(
      day.items,
      previewDurations.size > 0 ? previewDurations : undefined,
      previewStartTimes.size > 0 ? previewStartTimes : undefined
    ),
    [day.items, previewDurations, previewStartTimes]
  )

  const hourSlots = useMemo(
    () => Array.from({ length: TOTAL_HOURS }, (_, i) => HOUR_START + i),
    []
  )

  const { isOver: isDayOver, setNodeRef: setDayDropRef } = useDroppable({
    id: `day-${day.dateStr}`,
    data: { type: "timeline-day", dayStr: day.dateStr },
  })

  // Click on empty space to add event
  function handleTimelineClick(e: React.MouseEvent<HTMLDivElement>) {
    // Only handle clicks on the timeline background, not on items
    if ((e.target as HTMLElement).closest(".group\\/timeline-item")) return
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    const mins = Math.round(((y / hourHeight) * 60 + HOUR_START * 60) / SNAP_MINS) * SNAP_MINS
    const timeStr = minutesToTime(mins)
    setAddPopover({
      startTime: timeStr,
      position: { x: e.clientX, y: e.clientY },
    })
  }

  return (
    <div className={cn("flex-1", isMobileFullWidth ? "w-full" : "min-w-[200px] max-w-[320px]")} ref={setDayDropRef}>
      {/* Day header */}
      <div className="sticky top-0 bg-white z-10 border-b border-gray-200 px-2 py-2 text-center">
        <p className="text-xs font-semibold text-gray-900">Day {dayIdx + 1}</p>
        <p className="text-[10px] text-gray-500">{dayLabel}</p>
      </div>

      {/* Timeline grid */}
      <div
        className="relative cursor-crosshair"
        style={{ height: TOTAL_HOURS * hourHeight }}
        onClick={handleTimelineClick}
      >
        {/* Hour lines */}
        {Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => (
          <div
            key={i}
            className="absolute left-0 right-0 border-t border-gray-100"
            style={{ top: i * hourHeight }}
          />
        ))}

        {/* Droppable hour slots for wishlist drops */}
        {hourSlots.map((hour) => (
          <DroppableHourSlot
            key={hour}
            dayStr={day.dateStr}
            hour={hour}
            hourHeight={hourHeight}
          />
        ))}

        {/* Wishlist drop preview overlay */}
        <WishlistDropPreview dayStr={day.dateStr} isOver={isDayOver} />

        {/* Current time indicator */}
        <CurrentTimeIndicator hourHeight={hourHeight} />

        {/* Items with overlap layout */}
        {layoutItems.map((layout) => {
          const { item, column, totalColumns } = layout

          return (
            <TimelineItem
              key={item.id}
              item={item}
              column={column}
              totalColumns={totalColumns}
              hourHeight={hourHeight}
              onResize={onResize}
              onDragMove={onDragMove}
              onContextMenu={onContextMenu}
              onMoveToWishlist={onMoveToWishlist}
              onPreviewChange={handlePreviewChange}
              onPreviewStartChange={handlePreviewStartChange}
            />
          )
        })}

        {/* Travel connectors between non-overlapping sequential items */}
        {(() => {
          const layoutMap = new Map<string, OverlapLayout>()
          for (const l of layoutItems) layoutMap.set(l.item.id, l)

          const sorted = day.items
            .filter((item) => item.startTime)
            .sort((a, b) => timeToMinutes(a.startTime!) - timeToMinutes(b.startTime!))

          return sorted.map((item, i) => {
            if (i >= sorted.length - 1) return null
            const nextItem = sorted[i + 1]
            if (!nextItem.startTime) return null

            const hotelTypes = ["HOTEL_CHECK_IN", "HOTEL_CHECK_OUT"]
            if (hotel && (hotelTypes.includes(item.type) || hotelTypes.includes(nextItem.type))) return null
            if (item.type === "FLIGHT") return null

            const activePreviews = previewDurations.size > 0 ? previewDurations : undefined
            const activeStartPreviews = previewStartTimes.size > 0 ? previewStartTimes : undefined
            const itemEnd = getItemEnd(item, activePreviews, activeStartPreviews)
            const nextStart = activeStartPreviews?.get(nextItem.id) ?? timeToMinutes(nextItem.startTime!)

            if (nextStart < itemEnd) return null

            const itemLayout = layoutMap.get(item.id)
            const nextLayout = layoutMap.get(nextItem.id)
            if (itemLayout && nextLayout && itemLayout.totalColumns > 1 && nextLayout.totalColumns > 1) {
              if (nextStart < itemEnd) return null
            }

            const fromLat = item.activity?.lat || item.hotel?.lat
            const fromLng = item.activity?.lng || item.hotel?.lng
            const toLat = nextItem.activity?.lat || nextItem.hotel?.lat
            const toLng = nextItem.activity?.lng || nextItem.hotel?.lng
            const travel = calculateTravel(fromLat, fromLng, toLat, toLng)

            if (!travel) return null

            const travelTop = ((itemEnd - HOUR_START * 60) / 60) * hourHeight
            const gapHeight = ((nextStart - itemEnd) / 60) * hourHeight
            const travelHeight = Math.min((travel.travelMins / 60) * hourHeight, gapHeight, 40)
            const modeIcon = travel.mode === "walk" ? "\uD83D\uDEB6" : "\uD83D\uDE97"

            const mapsUrl = fromLat && fromLng && toLat && toLng
              ? `https://www.google.com/maps/dir/?api=1&origin=${fromLat},${fromLng}&destination=${toLat},${toLng}&travelmode=${travel.mode === "walk" ? "walking" : "driving"}`
              : null

            if (travelHeight <= 2) return null

            const connectorContent = (
              <>
                <div className="w-px flex-1 border-l border-dashed border-gray-300 group-hover/travel:border-indigo-400 transition-colors mx-auto" />
                <div className="text-[8px] text-gray-400 group-hover/travel:text-indigo-600 whitespace-nowrap flex items-center gap-0.5 bg-white px-1.5 py-0.5 rounded-full shadow-sm border border-gray-100 group-hover/travel:border-indigo-200">
                  <span>{modeIcon}</span>
                  <span>{travel.travelMins}m</span>
                </div>
                <div className="w-px flex-1 border-l border-dashed border-gray-300 group-hover/travel:border-indigo-400 transition-colors mx-auto" />
              </>
            )

            return mapsUrl ? (
              <a
                key={`travel-${item.id}`}
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="absolute left-0 right-0 flex flex-col items-center group/travel cursor-pointer z-10"
                style={{ top: travelTop, height: Math.max(travelHeight, 16) }}
                title={`${travel.travelMins} min ${travel.mode === "walk" ? "walk" : "drive"} - Click for directions`}
                onClick={(e) => e.stopPropagation()}
              >
                {connectorContent}
              </a>
            ) : (
              <div
                key={`travel-${item.id}`}
                className="absolute left-0 right-0 flex flex-col items-center z-10"
                style={{ top: travelTop, height: Math.max(travelHeight, 16) }}
                title={`${travel.travelMins} min ${travel.mode === "walk" ? "walk" : "drive"}`}
              >
                {connectorContent}
              </div>
            )
          })
        })()}

        {/* Hotel-to-first-event and last-event-to-hotel travel connectors */}
        {hotel && (() => {
          const sorted = day.items
            .filter((item) => item.startTime && item.type !== "FLIGHT" && item.type !== "HOTEL_CHECK_IN" && item.type !== "HOTEL_CHECK_OUT")
            .sort((a, b) => timeToMinutes(a.startTime!) - timeToMinutes(b.startTime!))
          if (sorted.length === 0) return null

          const firstItem = sorted[0]
          const lastItem = sorted[sorted.length - 1]
          const elements: React.ReactNode[] = []

          // Travel from hotel to first event
          if (firstItem.startTime) {
            const firstStart = timeToMinutes(firstItem.startTime!)
            const toLat = firstItem.activity?.lat || firstItem.hotel?.lat
            const toLng = firstItem.activity?.lng || firstItem.hotel?.lng
            const travel = calculateTravel(hotel.lat, hotel.lng, toLat, toLng)
            if (travel) {
              const travelEndTop = ((firstStart - HOUR_START * 60) / 60) * hourHeight
              const travelHeight = Math.min((travel.travelMins / 60) * hourHeight, 40)
              const travelTop = Math.max(0, travelEndTop - travelHeight)
              const modeIcon = travel.mode === "walk" ? "\uD83D\uDEB6" : "\uD83D\uDE97"
              const mapsUrl = hotel.lat && hotel.lng && toLat && toLng
                ? `https://www.google.com/maps/dir/?api=1&origin=${hotel.lat},${hotel.lng}&destination=${toLat},${toLng}&travelmode=${travel.mode === "walk" ? "walking" : "driving"}`
                : null

              if (travelHeight > 2) {
                const connectorContent = (
                  <>
                    <div className="w-px flex-1 border-l border-dashed border-green-300 group-hover/travel:border-green-500 transition-colors mx-auto" />
                    <div className="text-[8px] text-green-600 group-hover/travel:text-green-700 whitespace-nowrap flex items-center gap-0.5 bg-white px-1.5 py-0.5 rounded-full shadow-sm border border-green-100">
                      <span>{modeIcon}</span>
                      <span>{travel.travelMins}m</span>
                    </div>
                    <div className="w-px flex-1 border-l border-dashed border-green-300 group-hover/travel:border-green-500 transition-colors mx-auto" />
                  </>
                )
                elements.push(
                  mapsUrl ? (
                    <a
                      key="travel-hotel-to-first"
                      href={mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="absolute left-0 right-0 flex flex-col items-center group/travel cursor-pointer z-10"
                      style={{ top: travelTop, height: Math.max(travelHeight, 16) }}
                      title={`${travel.travelMins} min ${travel.mode === "walk" ? "walk" : "drive"} from hotel`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {connectorContent}
                    </a>
                  ) : (
                    <div
                      key="travel-hotel-to-first"
                      className="absolute left-0 right-0 flex flex-col items-center z-10"
                      style={{ top: travelTop, height: Math.max(travelHeight, 16) }}
                    >
                      {connectorContent}
                    </div>
                  )
                )
              }
            }
          }

          // Travel from last event back to hotel
          if (lastItem.startTime) {
            const lastEnd = lastItem.endTime
              ? timeToMinutes(lastItem.endTime)
              : timeToMinutes(lastItem.startTime!) + lastItem.durationMins
            const fromLat = lastItem.activity?.lat || lastItem.hotel?.lat
            const fromLng = lastItem.activity?.lng || lastItem.hotel?.lng
            const travel = calculateTravel(fromLat, fromLng, hotel.lat, hotel.lng)
            if (travel) {
              const travelTop = ((lastEnd - HOUR_START * 60) / 60) * hourHeight
              const travelHeight = Math.min((travel.travelMins / 60) * hourHeight, 40)
              const modeIcon = travel.mode === "walk" ? "\uD83D\uDEB6" : "\uD83D\uDE97"
              const mapsUrl = fromLat && fromLng && hotel.lat && hotel.lng
                ? `https://www.google.com/maps/dir/?api=1&origin=${fromLat},${fromLng}&destination=${hotel.lat},${hotel.lng}&travelmode=${travel.mode === "walk" ? "walking" : "driving"}`
                : null

              if (travelHeight > 2) {
                const connectorContent = (
                  <>
                    <div className="w-px flex-1 border-l border-dashed border-green-300 group-hover/travel:border-green-500 transition-colors mx-auto" />
                    <div className="text-[8px] text-green-600 group-hover/travel:text-green-700 whitespace-nowrap flex items-center gap-0.5 bg-white px-1.5 py-0.5 rounded-full shadow-sm border border-green-100">
                      <span>{modeIcon}</span>
                      <span>{travel.travelMins}m</span>
                    </div>
                    <div className="w-px flex-1 border-l border-dashed border-green-300 group-hover/travel:border-green-500 transition-colors mx-auto" />
                  </>
                )
                elements.push(
                  mapsUrl ? (
                    <a
                      key="travel-last-to-hotel"
                      href={mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="absolute left-0 right-0 flex flex-col items-center group/travel cursor-pointer z-10"
                      style={{ top: travelTop, height: Math.max(travelHeight, 16) }}
                      title={`${travel.travelMins} min ${travel.mode === "walk" ? "walk" : "drive"} to hotel`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {connectorContent}
                    </a>
                  ) : (
                    <div
                      key="travel-last-to-hotel"
                      className="absolute left-0 right-0 flex flex-col items-center z-10"
                      style={{ top: travelTop, height: Math.max(travelHeight, 16) }}
                    >
                      {connectorContent}
                    </div>
                  )
                )
              }
            }
          }

          return elements
        })()}
      </div>

      {/* Add event popover */}
      {addPopover && (
        <AddEventPopover
          dayStr={day.dateStr}
          startTime={addPopover.startTime}
          position={addPopover.position}
          wishlistItems={wishlistItems || []}
          onAddFromWishlist={onAddFromWishlist}
          onAddCustom={onAddCustom}
          onClose={() => setAddPopover(null)}
        />
      )}
    </div>
  )
}

// ─── Mobile Day Selector ─────────────────────────────────────────────────

function MobileDaySelector({
  days,
  selectedIdx,
  onSelect,
}: {
  days: GroupedDay<ItineraryItem>[]
  selectedIdx: number
  onSelect: (idx: number) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      const btn = scrollRef.current.children[selectedIdx] as HTMLElement
      if (btn) {
        btn.scrollIntoView({ inline: "center", behavior: "smooth", block: "nearest" })
      }
    }
  }, [selectedIdx])

  return (
    <div
      ref={scrollRef}
      className="flex gap-2 overflow-x-auto pb-2 px-1 scrollbar-none -mx-1"
      style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
    >
      {days.map((day, i) => {
        const dayDate = new Date(day.date)
        const weekday = dayDate.toLocaleDateString("en-US", { weekday: "short" })
        const dayNum = dayDate.getDate()
        return (
          <button
            key={day.dateStr}
            onClick={() => onSelect(i)}
            className={cn(
              "flex flex-col items-center px-3 py-2 rounded-xl text-xs font-medium transition-all shrink-0 min-w-[52px]",
              i === selectedIdx
                ? "bg-indigo-600 text-white shadow-md"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            )}
          >
            <span className="text-[10px] opacity-80">{weekday}</span>
            <span className="text-sm font-bold">{dayNum}</span>
            <span className={cn(
              "text-[9px] mt-0.5",
              i === selectedIdx ? "opacity-80" : "opacity-50"
            )}>
              {day.items.length} item{day.items.length !== 1 ? "s" : ""}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ─── Main TimelineView ──────────────────────────────────────────────────

type HotelInfo = {
  id: string
  name: string
  lat: number | null
  lng: number | null
  checkIn: Date
  checkOut: Date
}

interface TimelineViewProps {
  days: GroupedDay<ItineraryItem>[]
  onResizeItem?: (itemId: string, newDurationMins: number) => void
  onMoveItem?: (itemId: string, newStartTime: string, newDurationMins: number) => void
  onDropFromWishlist?: (dayStr: string, startTime: string, activityId: string) => void
  onMoveToWishlist?: (itemId: string) => void
  onMoveToDay?: (itemId: string, newDayStr: string, newStartTime: string) => void
  onAddFromWishlist?: (activityId: string, dayStr: string, startTime: string) => void
  onAddCustom?: (dayStr: string, startTime: string, title: string, durationMins: number) => void
  wishlistItems?: WishlistActivity[]
  hotels?: HotelInfo[]
}

export function TimelineView({
  days,
  onResizeItem,
  onMoveItem,
  onMoveToWishlist,
  onMoveToDay,
  onAddFromWishlist,
  onAddCustom,
  wishlistItems,
  hotels,
}: TimelineViewProps) {
  const [contextMenu, setContextMenu] = useState<{
    item: ItineraryItem
    position: { x: number; y: number }
    dayStr: string
  } | null>(null)
  const [mobileSelectedDay, setMobileSelectedDay] = useState(0)

  const mode = useResponsiveMode()
  const hourHeight = mode === "mobile" ? HOUR_HEIGHT_MOBILE : HOUR_HEIGHT_DESKTOP

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

  const getHotelForDate = useCallback((dateStr: string): HotelInfo | null => {
    if (!hotels) return null
    for (const h of hotels) {
      const checkIn = new Date(h.checkIn).toISOString().split("T")[0]
      const checkOut = new Date(h.checkOut).toISOString().split("T")[0]
      if (dateStr >= checkIn && dateStr <= checkOut) return h
    }
    return null
  }, [hotels])

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

  // Determine which days to show based on responsive mode
  const visibleDays = useMemo(() => {
    if (mode === "mobile") {
      return days.length > 0 ? [days[mobileSelectedDay]] : []
    }
    if (mode === "tablet") {
      // Show 2-3 days centered around mobile selected day
      const start = Math.max(0, Math.min(mobileSelectedDay, days.length - 3))
      return days.slice(start, start + 3)
    }
    // Desktop: show all days (or up to 5 with scroll)
    return days
  }, [mode, days, mobileSelectedDay])

  // Swipe support for mobile
  const touchRef = useRef<{ startX: number; startY: number } | null>(null)

  function handleTouchStart(e: React.TouchEvent) {
    if (mode !== "mobile") return
    touchRef.current = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
    }
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (mode !== "mobile" || !touchRef.current) return
    const deltaX = e.changedTouches[0].clientX - touchRef.current.startX
    const deltaY = e.changedTouches[0].clientY - touchRef.current.startY
    touchRef.current = null
    // Only trigger swipe if horizontal movement is dominant
    if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
      if (deltaX < 0 && mobileSelectedDay < days.length - 1) {
        setMobileSelectedDay(mobileSelectedDay + 1)
      } else if (deltaX > 0 && mobileSelectedDay > 0) {
        setMobileSelectedDay(mobileSelectedDay - 1)
      }
    }
  }

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Mobile day selector */}
      {mode === "mobile" && (
        <div className="mb-3">
          <MobileDaySelector
            days={days}
            selectedIdx={mobileSelectedDay}
            onSelect={setMobileSelectedDay}
          />
        </div>
      )}

      <div className="overflow-x-auto">
        <div className="flex gap-0">
          {/* Hour labels */}
          <div className={cn("shrink-0", mode === "mobile" ? "w-10" : "w-12")}>
            <div className="h-[42px] border-b border-gray-200" />
            <div className="relative" style={{ height: TOTAL_HOURS * hourHeight }}>
              {Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => {
                const hour = HOUR_START + i
                return (
                  <div
                    key={i}
                    className={cn(
                      "absolute left-0 right-0 text-gray-400 text-right pr-2 -translate-y-1/2",
                      mode === "mobile" ? "text-[9px]" : "text-[10px]"
                    )}
                    style={{ top: i * hourHeight }}
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
          {visibleDays.map((day) => {
            const dayIdx = days.findIndex(d => d.dateStr === day.dateStr)
            return (
              <div key={day.dateStr} className={cn("border-l border-gray-200", mode === "mobile" && "flex-1")}>
                <TimelineDay
                  day={day}
                  dayIdx={dayIdx}
                  hourHeight={hourHeight}
                  onResize={handleResize}
                  onDragMove={handleDragMove}
                  onContextMenu={(e, item) => handleContextMenu(e, item, day.dateStr)}
                  onMoveToWishlist={onMoveToWishlist}

                  hotel={getHotelForDate(day.dateStr)}
                  wishlistItems={wishlistItems}
                  onAddFromWishlist={onAddFromWishlist}
                  onAddCustom={onAddCustom}
                  isMobileFullWidth={mode === "mobile"}
                />
              </div>
            )
          })}
        </div>
      </div>

      {/* Context menu for moving items between days */}
      {contextMenu && onMoveToDay && (
        <MoveToDayMenu
          item={contextMenu.item}
          days={dayInfos}
          currentDayStr={contextMenu.dayStr}
          onMove={handleMoveToDay}
          onMoveToWishlist={onMoveToWishlist}
          onClose={() => setContextMenu(null)}
          position={contextMenu.position}
        />
      )}
    </div>
  )
}
