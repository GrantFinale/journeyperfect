/**
 * Tiny UTC-only date helpers for the Opportunity Discovery Engine.
 *
 * Every date in this module is a YYYY-MM-DD string interpreted at UTC noon,
 * so weekday and month arithmetic never drifts across a DST boundary or the
 * server's local time zone. Pure: no Date.now(), no side effects.
 */

const DAY_MS = 86_400_000

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const
export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/

export function isYmd(value: unknown): value is string {
  return typeof value === "string" && YMD.test(value)
}

/** Parse YYYY-MM-DD to a Date at 12:00 UTC. Throws on malformed input. */
export function parseYmd(ymd: string): Date {
  const m = YMD.exec(ymd)
  if (!m) throw new Error(`Expected YYYY-MM-DD, got "${ymd}"`)
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0))
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date "${ymd}"`)
  return d
}

/** Format any Date as YYYY-MM-DD using its UTC fields. */
export function formatYmd(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  const day = String(d.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function addDays(ymd: string, days: number): string {
  return formatYmd(new Date(parseYmd(ymd).getTime() + days * DAY_MS))
}

/** Whole days from a to b (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / DAY_MS)
}

/** 0 = Sunday .. 6 = Saturday */
export function weekday(ymd: string): number {
  return parseYmd(ymd).getUTCDay()
}

export function weekdayShort(ymd: string): string {
  return WEEKDAY_SHORT[weekday(ymd)]
}

/** 1..12 */
export function monthOf(ymd: string): number {
  return parseYmd(ymd).getUTCMonth() + 1
}

export function monthShort(ymd: string): string {
  return MONTH_SHORT[monthOf(ymd) - 1]
}

/** Distinct calendar months (1..12) touched by [start, end] inclusive, in order. */
export function monthsInRange(start: string, end: string): number[] {
  const out: number[] = []
  let cur = start
  let guard = 0
  while (daysBetween(cur, end) >= 0 && guard++ < 800) {
    const m = monthOf(cur)
    if (!out.includes(m)) out.push(m)
    cur = addDays(cur, 1)
  }
  return out
}

/** Every YYYY-MM-DD in [start, end] inclusive. */
export function eachDay(start: string, end: string): string[] {
  const n = daysBetween(start, end)
  if (n < 0) return []
  const out: string[] = []
  for (let i = 0; i <= n; i++) out.push(addDays(start, i))
  return out
}

/**
 * Human label for a stay: "Thu 12 – Sun 15 Nov", or "Thu 30 Oct – Sun 2 Nov"
 * when the two ends fall in different months.
 */
export function formatStayLabel(checkIn: string, checkOut: string): string {
  const a = parseYmd(checkIn)
  const b = parseYmd(checkOut)
  const aDay = `${WEEKDAY_SHORT[a.getUTCDay()]} ${a.getUTCDate()}`
  const bDay = `${WEEKDAY_SHORT[b.getUTCDay()]} ${b.getUTCDate()}`
  if (a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear()) {
    return `${aDay} – ${bDay} ${MONTH_SHORT[b.getUTCMonth()]}`
  }
  return `${aDay} ${MONTH_SHORT[a.getUTCMonth()]} – ${bDay} ${MONTH_SHORT[b.getUTCMonth()]}`
}

/** Monday-based week index since the Unix epoch; groups dates into calendar weeks. */
export function weekIndex(ymd: string): number {
  const d = parseYmd(ymd)
  // Shift so Monday is day 0 of the week.
  const daysSinceEpoch = Math.floor(d.getTime() / DAY_MS)
  return Math.floor((daysSinceEpoch + 3) / 7) // 1970-01-01 was a Thursday
}

/** Approximate days in a month, for turning "precip days" into a percentage. */
export function daysInMonth(month: number): number {
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 30
}
