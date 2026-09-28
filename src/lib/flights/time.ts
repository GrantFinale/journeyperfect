/**
 * Small time-zone helpers. PURE (Intl only, no date-fns-tz dependency).
 *
 * Provider segment times are stored as *local wall-clock* ISO strings without
 * an offset ("2026-12-01T08:05"), matching what Google Flights and Duffel
 * return. Converting to an instant needs the airport's IANA zone, which
 * src/lib/airports.ts supplies.
 */

const OFFSET_RE = /(Z|[+-]\d{2}:?\d{2})$/i

/** Milliseconds `tz` is ahead of UTC at `at`. Returns 0 for an unknown zone. */
export function tzOffsetMs(at: Date, tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(at)
    const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10)
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"))
    return asUtc - Math.floor(at.getTime() / 1000) * 1000
  } catch {
    return 0
  }
}

/**
 * Interpret a local wall-clock ISO string in `tz` and return the UTC instant.
 * Strings that already carry an offset (or "Z") are parsed as-is. Invalid
 * input yields an Invalid Date, which callers should check with isNaN.
 */
export function zonedTimeToUtc(localIso: string, tz: string | null | undefined): Date {
  const s = localIso.trim()
  if (OFFSET_RE.test(s)) return new Date(s)
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s)
  if (!m) return new Date(NaN)
  const [, y, mo, d, h = "0", mi = "0", sec = "0"] = m
  const guess = Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec)
  if (!tz || tz === "UTC") return new Date(guess)
  // Two passes handle DST transitions: offset at the guessed instant, then at
  // the corrected one.
  const first = guess - tzOffsetMs(new Date(guess), tz)
  const second = guess - tzOffsetMs(new Date(first), tz)
  return new Date(second)
}

/** Format an instant as a local wall-clock "YYYY-MM-DDTHH:mm" in `tz`. */
export function formatLocalIso(at: Date, tz: string | null | undefined): string {
  const shifted = new Date(at.getTime() + (tz && tz !== "UTC" ? tzOffsetMs(at, tz) : 0))
  return shifted.toISOString().slice(0, 16)
}

/**
 * Strip an ISO string with offset down to its local wall-clock part
 * ("2026-12-01T10:00:00+03:00" -> "2026-12-01T10:00"). Strings without an
 * offset are normalised to the same 16-character shape.
 */
export function toLocalIso(iso: string): string {
  const s = iso.trim().replace(" ", "T")
  return s.slice(0, 16)
}

/** Parse an ISO 8601 duration such as "PT5H30M" or "P1DT2H" into minutes. */
export function isoDurationToMinutes(duration: string | null | undefined): number {
  if (!duration) return 0
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(duration.trim())
  if (!m) return 0
  const [, d = "0", h = "0", mi = "0", s = "0"] = m
  return +d * 1440 + +h * 60 + +mi + Math.round(+s / 60)
}

/** Minutes between two local ISO strings interpreted in their own zones. */
export function minutesBetween(fromLocalIso: string, fromTz: string | undefined, toLocalIso: string, toTz: string | undefined): number {
  const a = zonedTimeToUtc(fromLocalIso, fromTz)
  const b = zonedTimeToUtc(toLocalIso, toTz)
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000))
}
