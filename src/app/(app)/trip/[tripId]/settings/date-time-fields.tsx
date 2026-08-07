"use client"

import { cn } from "@/lib/utils"

// Hotels default to a 3:00 PM check-in / 11:00 AM check-out. These mirror the
// server-side defaults in src/lib/actions/hotels.ts (getCheckInTimeForDate
// returns "15:00"; the check-out itinerary item hardcodes "11:00").
export const DEFAULT_CHECK_IN_TIME = "15:00"
export const DEFAULT_CHECK_OUT_TIME = "11:00"

export const CHECK_IN_QUICK_TIMES = [
  { label: "3:00 PM", value: "15:00" },
  { label: "4:00 PM", value: "16:00" },
  { label: "Late", value: "23:00" },
]

export const CHECK_OUT_QUICK_TIMES = [
  { label: "11:00 AM", value: "11:00" },
  { label: "12:00 PM", value: "12:00" },
]

// 15-minute increments — 96 options. Fine enough for every realistic hotel
// time while staying scannable, unlike the 1,440 stops of a bare
// <input type="datetime-local">.
export const TIME_OPTIONS: { value: string; label: string }[] = (() => {
  const opts: { value: string; label: string }[] = []
  for (let mins = 0; mins < 24 * 60; mins += 15) {
    const h = Math.floor(mins / 60)
    const m = mins % 60
    const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
    opts.push({ value, label: formatTime12h(value) })
  }
  return opts
})()

/** "15:00" -> "3:00 PM" */
export function formatTime12h(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":")
  const h = parseInt(hStr, 10)
  if (isNaN(h)) return hhmm
  const suffix = h >= 12 ? "PM" : "AM"
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${mStr ?? "00"} ${suffix}`
}

/** "2026-08-19T15:00" -> { date: "2026-08-19", time: "15:00" } */
export function splitLocalDateTime(value: string): { date: string; time: string } {
  if (!value) return { date: "", time: "" }
  const [date, rest] = value.split("T")
  return { date: date || "", time: rest ? rest.slice(0, 5) : "" }
}

/** ("2026-08-19", "15:00") -> "2026-08-19T15:00" */
export function joinLocalDateTime(date: string, time: string): string {
  if (!date) return ""
  return `${date}T${time || "00:00"}`
}

/** Snap an arbitrary "HH:MM" onto the nearest 15-minute option so a parsed or
 *  pre-existing value always matches one of the <option>s. */
export function snapToQuarterHour(hhmm: string): string {
  if (!hhmm) return ""
  const [hStr, mStr] = hhmm.split(":")
  const h = parseInt(hStr, 10)
  const m = parseInt(mStr, 10)
  if (isNaN(h) || isNaN(m)) return hhmm
  const total = Math.round((h * 60 + m) / 15) * 15
  const capped = Math.min(total, 23 * 60 + 45)
  return `${String(Math.floor(capped / 60)).padStart(2, "0")}:${String(capped % 60).padStart(2, "0")}`
}

interface DateTimeFieldProps {
  label: string
  /** "YYYY-MM-DDTHH:MM" (local, matches what datetime-local produced before) */
  value: string
  onChange: (value: string) => void
  /** Applied automatically the moment a date is picked and no time is set yet. */
  defaultTime: string
  quickTimes?: { label: string; value: string }[]
  required?: boolean
  min?: string
}

/**
 * A date input plus a compact 15-minute time dropdown, replacing
 * <input type="datetime-local"> so the common case (3 PM check-in /
 * 11 AM check-out) needs zero interaction beyond picking the date.
 */
export function DateTimeField({
  label,
  value,
  onChange,
  defaultTime,
  quickTimes,
  required,
  min,
}: DateTimeFieldProps) {
  const { date, time } = splitLocalDateTime(value)
  const effectiveTime = time || defaultTime
  const snapped = snapToQuarterHour(effectiveTime)
  // If a parsed value lands off the 15-minute grid, keep it selectable.
  const hasExactOption = TIME_OPTIONS.some((o) => o.value === effectiveTime)

  function setDate(nextDate: string) {
    if (!nextDate) {
      onChange("")
      return
    }
    // Choosing a date applies the sensible default time immediately.
    onChange(joinLocalDateTime(nextDate, time || defaultTime))
  }

  function setTime(nextTime: string) {
    if (!date) return
    onChange(joinLocalDateTime(date, nextTime))
  }

  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">
        {label} {required && "*"}
      </label>
      <div className="grid grid-cols-2 gap-2">
        <input
          type="date"
          value={date}
          min={min}
          onChange={(e) => setDate(e.target.value)}
          className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <select
          value={hasExactOption ? effectiveTime : snapped}
          onChange={(e) => setTime(e.target.value)}
          disabled={!date}
          className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white disabled:bg-gray-50 disabled:text-gray-400"
        >
          {!hasExactOption && effectiveTime && (
            <option value={effectiveTime}>{formatTime12h(effectiveTime)}</option>
          )}
          {TIME_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {quickTimes && quickTimes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          {quickTimes.map((q) => (
            <button
              key={q.value}
              type="button"
              onClick={() => setTime(q.value)}
              disabled={!date}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded-full transition-colors disabled:opacity-40",
                effectiveTime === q.value
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              )}
            >
              {q.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
