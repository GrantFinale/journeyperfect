"use client"

import { useState, useRef, useCallback } from "react"
import { cn } from "@/lib/utils"
import { formatTime } from "@/lib/utils"
import type { GroupedDay } from "@/lib/itinerary-utils"

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

function TimelineItem({
  item,
  onResize,
  onDragMove,
}: {
  item: ItineraryItem
  onResize: (itemId: string, newDurationMins: number) => void
  onDragMove: (itemId: string, newStartTime: string, newDurationMins: number) => void
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
    // Only start drag on left click
    if (e.button !== 0) return
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = { startY: e.clientY, startMins: timeToMinutes(item.startTime!) }
  }

  function handleDragPointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return
    const deltaY = e.clientY - dragRef.current.startY
    // Require at least 5px movement to initiate drag (avoid accidental moves)
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

  const showDurationLabel = resizing && previewDuration != null
  const originalDuration = item.durationMins

  return (
    <div
      className={cn(
        "absolute left-1 right-1 rounded-lg border px-2 py-1 overflow-hidden select-none",
        typeColor(item.type),
        !isFixed && "cursor-grab active:cursor-grabbing",
        (resizing || dragging) && "z-20 shadow-lg ring-2 ring-indigo-400/50"
      )}
      style={{ top, height: Math.min(height, (TOTAL_HOURS * HOUR_HEIGHT) - top) }}
      title={`${item.title} (${formatTime(item.startTime!)}${item.endTime ? ` - ${formatTime(item.endTime)}` : ""}, ${formatDuration(currentDuration)})`}
      onPointerDown={!isFixed ? handleDragPointerDown : undefined}
      onPointerMove={!isFixed ? handleDragPointerMove : undefined}
      onPointerUp={!isFixed ? handleDragPointerUp : undefined}
    >
      <p className="text-[10px] font-medium truncate leading-tight">
        {item.title}
      </p>
      {height > 30 && (
        <p className="text-[9px] opacity-70 mt-0.5">
          {formatTime(minutesToTime(startMins))} · {formatDuration(currentDuration)}
        </p>
      )}

      {/* Duration change indicator */}
      {showDurationLabel && (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap z-30 shadow-md">
          {formatDuration(originalDuration)} → {formatDuration(previewDuration)}
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

function TimelineDay({
  day,
  dayIdx,
  onResize,
  onDragMove,
}: {
  day: GroupedDay<ItineraryItem>
  dayIdx: number
  onResize: (itemId: string, newDurationMins: number) => void
  onDragMove: (itemId: string, newStartTime: string, newDurationMins: number) => void
}) {
  const dayDate = new Date(day.date)
  const dayLabel = dayDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })

  return (
    <div className="flex-1 min-w-[200px] max-w-[320px]">
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

        {/* Items */}
        {day.items.map((item, i) => {
          if (!item.startTime) return null

          // Travel connector to next item
          const nextItem = i < day.items.length - 1 ? day.items[i + 1] : null
          const showTravel = item.travelTimeToNextMins > 0 && nextItem?.startTime

          const startMins = timeToMinutes(item.startTime)
          const itemEnd = item.endTime
            ? timeToMinutes(item.endTime)
            : startMins + item.durationMins

          return (
            <div key={item.id}>
              <TimelineItem
                item={item}
                onResize={onResize}
                onDragMove={onDragMove}
              />

              {/* Travel connector */}
              {showTravel && (() => {
                const travelTop = ((itemEnd - HOUR_START * 60) / 60) * HOUR_HEIGHT
                const travelHeight = (item.travelTimeToNextMins / 60) * HOUR_HEIGHT

                return travelHeight > 2 ? (
                  <div
                    className="absolute left-1/2 -translate-x-1/2 w-0.5 bg-gray-300"
                    style={{
                      top: travelTop,
                      height: Math.min(travelHeight, 40),
                    }}
                    title={`${formatDuration(item.travelTimeToNextMins)} travel`}
                  />
                ) : null
              })()}
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface TimelineViewProps {
  days: GroupedDay<ItineraryItem>[]
  onResizeItem?: (itemId: string, newDurationMins: number) => void
  onMoveItem?: (itemId: string, newStartTime: string, newDurationMins: number) => void
}

export function TimelineView({ days, onResizeItem, onMoveItem }: TimelineViewProps) {
  const handleResize = useCallback((itemId: string, newDurationMins: number) => {
    onResizeItem?.(itemId, newDurationMins)
  }, [onResizeItem])

  const handleDragMove = useCallback((itemId: string, newStartTime: string, newDurationMins: number) => {
    onMoveItem?.(itemId, newStartTime, newDurationMins)
  }, [onMoveItem])

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
            />
          </div>
        ))}
      </div>
    </div>
  )
}
