/**
 * Ticketmaster Discovery API client for anchor-event lookup
 * (docs/plans/opportunity-discovery-engine.md §4.5). Free tier.
 *
 * Returns [] whenever the key is missing or the request fails: an events
 * lookup is a nice-to-have, never a reason to fail a search. Results are
 * cached in memory for an hour per (lat, lng, dates) so a search that
 * evaluates six date windows for one destination makes six calls, not
 * sixty.
 *
 * `mapTicketmasterResponse` is pure and unit-tested; `fetchEvents` is the
 * thin I/O wrapper.
 */
import { getConfigKey } from "./config-keys"

export type EventKind = "SPORTS" | "CONCERT" | "FESTIVAL" | "EVENT"

export interface EventSummary {
  title: string
  kind: EventKind
  /** YYYY-MM-DD */
  date: string
  url?: string
  venue?: string
}

export const TICKETMASTER_DISCOVERY_URL = "https://app.ticketmaster.com/discovery/v2/events.json"
export const EVENT_RADIUS_KM = 40
export const EVENT_PAGE_SIZE = 20

const CACHE_TTL_MS = 60 * 60_000
const MAX_CACHE = 500
const cache = new Map<string, { value: EventSummary[]; expiry: number }>()

function cacheSet(key: string, value: EventSummary[]) {
  if (cache.size >= MAX_CACHE) {
    const first = cache.keys().next().value
    if (first !== undefined) cache.delete(first)
  }
  cache.set(key, { value, expiry: Date.now() + CACHE_TTL_MS })
}

/** Exposed for tests. */
export function clearEventsCache() {
  cache.clear()
}

// ─── Mapping (pure) ──────────────────────────────────────────────────────────

interface TmEvent {
  name?: string
  url?: string
  dates?: { start?: { localDate?: string; dateTime?: string } }
  classifications?: { segment?: { name?: string }; genre?: { name?: string }; subType?: { name?: string } }[]
  _embedded?: { venues?: { name?: string }[] }
}

export interface TmResponse {
  _embedded?: { events?: TmEvent[] }
}

export function classifyEvent(segment: string | undefined, genre: string | undefined, name: string): EventKind {
  const s = (segment ?? "").toLowerCase()
  const g = (genre ?? "").toLowerCase()
  const n = name.toLowerCase()
  const festivalish = n.includes("festival") || /\bfest\b/.test(n) || g.includes("festival")
  if (s === "sports") return "SPORTS"
  if (s === "music") return festivalish ? "FESTIVAL" : "CONCERT"
  if (festivalish || /\bfair\b/.test(n)) return "FESTIVAL"
  return "EVENT"
}

export function mapTicketmasterResponse(data: TmResponse | null | undefined): EventSummary[] {
  const events = data?._embedded?.events
  if (!Array.isArray(events)) return []
  const out: EventSummary[] = []
  const seen = new Set<string>()
  for (const e of events) {
    const title = typeof e?.name === "string" ? e.name.trim() : ""
    const date = e?.dates?.start?.localDate ?? (e?.dates?.start?.dateTime ? e.dates.start.dateTime.slice(0, 10) : "")
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    const key = `${title}|${date}`
    if (seen.has(key)) continue
    seen.add(key)
    const cls = e.classifications?.[0]
    const summary: EventSummary = { title, kind: classifyEvent(cls?.segment?.name, cls?.genre?.name, title), date }
    if (typeof e.url === "string" && e.url) summary.url = e.url
    const venue = e._embedded?.venues?.[0]?.name
    if (typeof venue === "string" && venue) summary.venue = venue
    out.push(summary)
  }
  return out
}

export function buildTicketmasterUrl(opts: { apiKey: string; lat: number; lng: number; startDate: string; endDate: string }): string {
  const params = new URLSearchParams({
    apikey: opts.apiKey,
    latlong: `${opts.lat.toFixed(4)},${opts.lng.toFixed(4)}`,
    radius: String(EVENT_RADIUS_KM),
    unit: "km",
    startDateTime: `${opts.startDate}T00:00:00Z`,
    endDateTime: `${opts.endDate}T23:59:59Z`,
    size: String(EVENT_PAGE_SIZE),
    sort: "relevance,desc",
  })
  return `${TICKETMASTER_DISCOVERY_URL}?${params.toString()}`
}

// ─── I/O ─────────────────────────────────────────────────────────────────────

/**
 * Events within 40 km of (lat, lng) between startDate and endDate inclusive.
 * Returns [] when `api.ticketmaster.key` is empty or anything goes wrong.
 */
export async function fetchEvents(lat: number, lng: number, startDate: string, endDate: string): Promise<EventSummary[]> {
  const apiKey = (await getConfigKey("api.ticketmaster.key")).trim()
  if (!apiKey) return []

  const key = `${lat.toFixed(2)},${lng.toFixed(2)}|${startDate}|${endDate}`
  const hit = cache.get(key)
  if (hit && Date.now() < hit.expiry) return hit.value

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    const res = await fetch(buildTicketmasterUrl({ apiKey, lat, lng, startDate, endDate }), { signal: controller.signal })
    clearTimeout(timeout)
    if (!res.ok) {
      console.error(`[events] Ticketmaster returned ${res.status}`)
      return []
    }
    const data = (await res.json()) as TmResponse
    const mapped = mapTicketmasterResponse(data)
    cacheSet(key, mapped)
    return mapped
  } catch (err) {
    console.error("[events] Ticketmaster lookup failed:", err)
    return []
  }
}
