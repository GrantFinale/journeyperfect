/**
 * PURE. Builds the plan the JourneyPerfect Go Rates Chrome extension executes:
 * one Hilton search tab per (destination, checkIn, checkOut) group.
 *
 * Candidate selection is exactly the runner path's (planRateChecks): un-pruned
 * candidates with stage >= 2 (fallback >= 1), grouped by destination + dates,
 * best score first. `privateRates.maxPropertiesPerCheck` is treated as the
 * maximum number of plan items (tabs).
 *
 * Item key = "<IATA>|<checkIn>|<checkOut>" (the RateCheckGroup key). The capture
 * endpoint parses it and verifies a matching un-pruned OpportunityCandidate
 * exists for the token's search, so a capture can only land on a destination
 * and date window that belong to that search. Nothing about the key list is
 * encoded in the token.
 *
 * Adults: Hilton's search takes one room's adult count. We pass the search's
 * traveler count clamped to 1..4 (a standard room's occupancy limit), counting
 * children as adults. That never under-states occupancy, so a quoted rate is
 * at worst slightly high, never a rate the party could not actually book.
 */
import { planRateChecks, type PlanCandidate } from "./plan-check"

export const DEFAULT_HILTON_SEARCH_URL_TEMPLATE =
  "https://www.hilton.com/en/search/?query={location}&arrivalDate={checkIn}&departureDate={checkOut}&flexibleDates=false&room1NumAdults={adults}"

export const GO_RATES_MAX_CONCURRENT_TABS = 3
export const GO_RATES_MIN_ADULTS = 1
export const GO_RATES_MAX_ADULTS = 4

export interface GoRatesPlanItem {
  key: string
  location: string
  /** YYYY-MM-DD */
  checkIn: string
  /** YYYY-MM-DD */
  checkOut: string
  lat?: number
  lng?: number
  url: string
}

export interface GoRatesPlan {
  version: 1
  searchId: string
  token: string
  /** Absolute URL of POST /api/private-rates/capture. */
  captureUrl: string
  maxConcurrentTabs: number
  items: GoRatesPlanItem[]
}

const YMD = /^\d{4}-\d{2}-\d{2}$/

export function goRatesItemKey(iata: string, checkIn: string, checkOut: string): string {
  return `${iata}|${checkIn}|${checkOut}`
}

export function parseGoRatesItemKey(key: unknown): { iata: string; checkIn: string; checkOut: string } | null {
  if (typeof key !== "string" || key.length > 40) return null
  const parts = key.split("|")
  if (parts.length !== 3) return null
  const [iata, checkIn, checkOut] = parts
  if (!/^[A-Z0-9]{3,4}$/.test(iata) || !YMD.test(checkIn) || !YMD.test(checkOut)) return null
  if (Number.isNaN(Date.parse(`${checkIn}T00:00:00Z`)) || Number.isNaN(Date.parse(`${checkOut}T00:00:00Z`))) return null
  if (checkOut <= checkIn) return null
  return { iata, checkIn, checkOut }
}

export function adultsForTravelerCount(travelerCount: number): number {
  const n = Number.isFinite(travelerCount) ? Math.floor(travelerCount) : GO_RATES_MIN_ADULTS
  return Math.min(GO_RATES_MAX_ADULTS, Math.max(GO_RATES_MIN_ADULTS, n))
}

/**
 * Fill {location},{checkIn},{checkOut},{adults},{lat},{lng}; every value is
 * URL-encoded, missing lat/lng become "". Returns null unless the result is an
 * absolute https URL (a mistyped admin template must not open odd tabs).
 */
export function renderSearchUrl(
  template: string,
  values: { location: string; checkIn: string; checkOut: string; adults: number; lat?: number; lng?: number },
): string | null {
  const map: Record<string, string> = {
    location: values.location,
    checkIn: values.checkIn,
    checkOut: values.checkOut,
    adults: String(values.adults),
    lat: typeof values.lat === "number" && Number.isFinite(values.lat) ? String(values.lat) : "",
    lng: typeof values.lng === "number" && Number.isFinite(values.lng) ? String(values.lng) : "",
  }
  const out = template.replace(/\{(location|checkIn|checkOut|adults|lat|lng)\}/g, (_m, k: string) => encodeURIComponent(map[k]))
  try {
    const u = new URL(out)
    return u.protocol === "https:" ? u.toString() : null
  } catch {
    return null
  }
}

export interface BuildGoRatesItemsOptions {
  /** privateRates.maxPropertiesPerCheck, used as the max number of items. */
  maxItems: number
  /** privateRates.hilton.searchUrlTemplate; falls back to the default when empty or invalid. */
  urlTemplate?: string | null
  travelerCount: number
}

export function buildGoRatesItems(candidates: readonly PlanCandidate[], options: BuildGoRatesItemsOptions): GoRatesPlanItem[] {
  const maxItems = Math.max(0, Math.floor(options.maxItems))
  if (maxItems === 0) return []
  // checksRemainingToday is enforced by the caller (the daily cap); any positive value here.
  const plan = planRateChecks(candidates, { maxPropertiesPerCheck: maxItems, checksRemainingToday: 1 })
  const adults = adultsForTravelerCount(options.travelerCount)
  const template = options.urlTemplate?.trim() || DEFAULT_HILTON_SEARCH_URL_TEMPLATE

  const items: GoRatesPlanItem[] = []
  for (const g of plan.groups.slice(0, maxItems)) {
    const values = { location: g.location, checkIn: g.checkIn, checkOut: g.checkOut, adults, lat: g.lat, lng: g.lng }
    const url = renderSearchUrl(template, values) ?? renderSearchUrl(DEFAULT_HILTON_SEARCH_URL_TEMPLATE, values)
    if (!url) continue
    const item: GoRatesPlanItem = { key: goRatesItemKey(g.iata, g.checkIn, g.checkOut), location: g.location, checkIn: g.checkIn, checkOut: g.checkOut, url }
    if (Number.isFinite(g.lat)) item.lat = g.lat
    if (Number.isFinite(g.lng)) item.lng = g.lng
    items.push(item)
  }
  return items
}
