/**
 * Historical weather fallback for dates beyond Open-Meteo's 16-day forecast
 * (docs/plans/opportunity-discovery-engine.md §4.3).
 *
 * Uses the Open-Meteo archive endpoint for the same calendar dates one and
 * two years earlier and averages them. The result is labelled HISTORICAL and
 * the UI must say "typically". No API key. In-memory cache, 24h.
 *
 * `summariseArchive` is pure and unit-tested; `getHistoricalWeather` is the
 * I/O wrapper. Used only when a DestinationProfile has no climate normals.
 */

export const OPEN_METEO_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"

export interface HistoricalWeather {
  highF: number
  lowF: number
  /** 0..100: share of days with measurable precipitation across the sampled years */
  precipPct: number
  /** Days with ≥ 1 mm across all sampled years, for display */
  precipDays: number
  sampledDays: number
  source: "HISTORICAL"
  yearsSampled: number[]
}

const CACHE_TTL_MS = 24 * 60 * 60_000
const MAX_CACHE = 500
const cache = new Map<string, { value: HistoricalWeather | null; expiry: number }>()

function cacheSet(key: string, value: HistoricalWeather | null) {
  if (cache.size >= MAX_CACHE) {
    const first = cache.keys().next().value
    if (first !== undefined) cache.delete(first)
  }
  cache.set(key, { value, expiry: Date.now() + CACHE_TTL_MS })
}

export function clearClimateCache() {
  cache.clear()
}

export interface ArchiveDaily {
  time: string[]
  temperature_2m_max: (number | null)[]
  temperature_2m_min: (number | null)[]
  precipitation_sum: (number | null)[]
}

export interface ArchiveResponse {
  daily?: ArchiveDaily
}

/** A day counts as wet at or above this many millimetres. */
export const WET_DAY_MM = 1

/** Average several years of daily archive rows into one HISTORICAL summary. Pure. */
export function summariseArchive(responses: readonly (ArchiveResponse | null | undefined)[], years: number[]): HistoricalWeather | null {
  const highs: number[] = []
  const lows: number[] = []
  let wet = 0
  let sampled = 0
  for (const r of responses) {
    const d = r?.daily
    if (!d || !Array.isArray(d.time)) continue
    for (let i = 0; i < d.time.length; i++) {
      const hi = d.temperature_2m_max?.[i]
      const lo = d.temperature_2m_min?.[i]
      const p = d.precipitation_sum?.[i]
      if (typeof hi !== "number" || typeof lo !== "number") continue
      highs.push(hi)
      lows.push(lo)
      sampled++
      if (typeof p === "number" && p >= WET_DAY_MM) wet++
    }
  }
  if (sampled === 0) return null
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  return {
    highF: Math.round(avg(highs)),
    lowF: Math.round(avg(lows)),
    precipPct: Math.round((wet / sampled) * 100),
    precipDays: wet,
    sampledDays: sampled,
    source: "HISTORICAL",
    yearsSampled: years,
  }
}

function shiftYear(ymd: string, delta: number): string {
  const y = Number(ymd.slice(0, 4)) + delta
  const rest = ymd.slice(4)
  // Feb 29 in a non-leap year: fall back to Feb 28.
  if (rest === "-02-29" && !((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0)) return `${y}-02-28`
  return `${y}${rest}`
}

export function buildArchiveUrl(lat: number, lng: number, start: string, end: string): string {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lng.toFixed(4),
    start_date: start,
    end_date: end,
    daily: "temperature_2m_max,temperature_2m_min,precipitation_sum",
    temperature_unit: "fahrenheit",
    timezone: "auto",
  })
  return `${OPEN_METEO_ARCHIVE_URL}?${params.toString()}`
}

/**
 * Historical weather for [start, end] (YYYY-MM-DD) using the same dates one
 * and two years earlier. Returns null when the archive is unavailable.
 */
export async function getHistoricalWeather(lat: number, lng: number, start: string, end: string, now: Date = new Date()): Promise<HistoricalWeather | null> {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}|${start}|${end}`
  const hit = cache.get(key)
  if (hit && Date.now() < hit.expiry) return hit.value

  // The archive lags a few days; if a year-ago window would still be in the
  // future or too recent, step back a further year.
  const cutoff = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10)
  const years: number[] = []
  for (let back = 1; years.length < 2 && back <= 4; back++) {
    if (shiftYear(end, -back) <= cutoff) years.push(back)
  }

  try {
    const responses = await Promise.all(
      years.map(async (back) => {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 8000)
        try {
          const res = await fetch(buildArchiveUrl(lat, lng, shiftYear(start, -back), shiftYear(end, -back)), { signal: controller.signal })
          if (!res.ok) {
            console.error(`[weather-climate] archive returned ${res.status}`)
            return null
          }
          return (await res.json()) as ArchiveResponse
        } finally {
          clearTimeout(timeout)
        }
      })
    )
    const summary = summariseArchive(responses, years.map((b) => Number(start.slice(0, 4)) - b))
    cacheSet(key, summary)
    return summary
  } catch (err) {
    console.error("[weather-climate] archive lookup failed:", err)
    return null
  }
}
