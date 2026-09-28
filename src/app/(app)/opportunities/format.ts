import { format, formatDistanceToNowStrict, isValid } from "date-fns"

/** Parse a YYYY-MM-DD string as a local calendar day (no timezone shift). */
export function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number)
  if (!y || !m || !d) return new Date(day)
  return new Date(y, m - 1, d)
}

/** "Thu 12 – Sun 15 Nov" or "Fri 29 Nov – Mon 2 Dec" across a month boundary. */
export function formatStayRange(checkIn: string, checkOut: string): string {
  const a = parseDay(checkIn)
  const b = parseDay(checkOut)
  if (!isValid(a) || !isValid(b)) return `${checkIn} – ${checkOut}`
  const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()
  return sameMonth
    ? `${format(a, "EEE d")} – ${format(b, "EEE d MMM")}`
    : `${format(a, "EEE d MMM")} – ${format(b, "EEE d MMM")}`
}

/** "Oct 4 – Nov 15, 2026" for search windows. */
export function formatWindow(start: string, end: string): string {
  const a = parseDay(start)
  const b = parseDay(end)
  if (!isValid(a) || !isValid(b)) return `${start} – ${end}`
  const sameYear = a.getFullYear() === b.getFullYear()
  return sameYear
    ? `${format(a, "MMM d")} – ${format(b, "MMM d, yyyy")}`
    : `${format(a, "MMM d, yyyy")} – ${format(b, "MMM d, yyyy")}`
}

/** 370 → "6h 10m"; 45 → "45m". */
export function formatMins(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/** "2h ago" style, compact; empty when unparsable. */
export function formatAgo(iso: string | undefined | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (!isValid(d)) return ""
  return formatDistanceToNowStrict(d, { addSuffix: true })
    .replace(" minutes", "m")
    .replace(" minute", "m")
    .replace(" hours", "h")
    .replace(" hour", "h")
    .replace(" days", "d")
    .replace(" day", "d")
    .replace(" seconds", "s")
    .replace(" second", "s")
}

/** "$2,140" — whole dollars, party total. */
export function formatMoney(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount)
}

export const WEEKDAY_PATTERNS: { value: string; label: string }[] = [
  { value: "", label: "Any days" },
  { value: "THU_SUN", label: "Thu – Sun" },
  { value: "FRI_MON", label: "Fri – Mon" },
  { value: "SAT_TUE", label: "Sat – Tue" },
]

export function weekdayPatternLabel(value: string | null | undefined): string {
  return WEEKDAY_PATTERNS.find((p) => p.value === (value ?? ""))?.label ?? "Any days"
}
