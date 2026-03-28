"use client"

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

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number)
  return h * 60 + (m || 0)
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

function TimelineDay({ day, dayIdx }: { day: GroupedDay<ItineraryItem>; dayIdx: number }) {
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
          const startMins = timeToMinutes(item.startTime)
          const offsetMins = startMins - HOUR_START * 60
          if (offsetMins < 0) return null

          const top = (offsetMins / 60) * HOUR_HEIGHT
          const height = Math.max((item.durationMins / 60) * HOUR_HEIGHT, 20)

          // Travel connector to next item
          const nextItem = i < day.items.length - 1 ? day.items[i + 1] : null
          const showTravel = item.travelTimeToNextMins > 0 && nextItem?.startTime

          return (
            <div key={item.id}>
              <div
                className={cn(
                  "absolute left-1 right-1 rounded-lg border px-2 py-1 overflow-hidden",
                  typeColor(item.type)
                )}
                style={{ top, height: Math.min(height, (TOTAL_HOURS * HOUR_HEIGHT) - top) }}
                title={`${item.title} (${formatTime(item.startTime)}${item.endTime ? ` - ${formatTime(item.endTime)}` : ""}, ${formatDuration(item.durationMins)})`}
              >
                <p className="text-[10px] font-medium truncate leading-tight">
                  {item.title}
                </p>
                {height > 30 && (
                  <p className="text-[9px] opacity-70 mt-0.5">
                    {formatTime(item.startTime)} · {formatDuration(item.durationMins)}
                  </p>
                )}
              </div>

              {/* Travel connector */}
              {showTravel && (() => {
                const itemEnd = item.endTime
                  ? timeToMinutes(item.endTime)
                  : startMins + item.durationMins
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
}

export function TimelineView({ days }: TimelineViewProps) {
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
            <TimelineDay day={day} dayIdx={i} />
          </div>
        ))}
      </div>
    </div>
  )
}
