/**
 * PURE. Builds the plan the JourneyPerfect Go Rates Chrome extension executes.
 *
 * For each (destination, checkIn, checkOut) group the plan emits up to four
 * tabs, in this order:
 *   hilton PRIVATE   (Go Hilton search, signed in)      when entitled to "hilton"
 *   hilton PUBLIC    (the same search, public rates)    when entitled to "hilton"
 *   marriott PRIVATE (Friends & Family, rate code)      when entitled to "marriott" AND a rate code is set
 *   marriott PUBLIC  (the same search without the code) idem
 * The public tab exists because Go Hilton shows one price per hotel: the
 * public comparable has to come from a separate search, paired afterwards by
 * property code.
 *
 * Candidate selection is exactly the runner path's (planRateChecks): un-pruned
 * candidates with stage >= 2 (fallback >= 1), grouped by destination + dates,
 * best score first. The plan is capped at `maxItems` tabs
 * (privateRates.maxCaptureTabs, hard max 24); the lowest-ranked groups are
 * dropped WHOLE, so a private tab never loses its public pair.
 *
 * Item key = "<IATA>|<checkIn>|<checkOut>|<brand>|<intent>". The capture
 * endpoint parses it (and the legacy 3-part "<IATA>|<checkIn>|<checkOut>",
 * which means hilton PRIVATE) and verifies a matching un-pruned
 * OpportunityCandidate exists for the token's search, so a capture can only
 * land on a destination and date window that belong to that search.
 *
 * Adults: the search's traveler count clamped to 1..4 (one standard room),
 * counting children as adults, so a quoted rate is never one the party could
 * not actually book.
 */
import { BRAND_HOST, isGoRatesBrand, type GoRatesBrand, type GoRatesIntent } from "./brands"
import { planRateChecks, type PlanCandidate } from "./plan-check"

export type { GoRatesBrand, GoRatesIntent } from "./brands"

export const DEFAULT_HILTON_SEARCH_URL_TEMPLATE =
  "https://www.hilton.com/en/search/?query={location}&arrivalDate={checkIn}&departureDate={checkOut}&flexibleDates=false&room1NumAdults={adults}"
export const DEFAULT_HILTON_PUBLIC_SEARCH_URL_TEMPLATE =
  "https://www.hilton.com/en/search/?query={location}&arrivalDate={checkIn}&departureDate={checkOut}&flexibleDates=false&room1NumAdults={adults}&redeemPts=false"
export const DEFAULT_MARRIOTT_SEARCH_URL_TEMPLATE =
  "https://www.marriott.com/search/findHotels.mi?destinationAddress.destination={location}&fromDate={checkInMDY}&toDate={checkOutMDY}&roomCount=1&numAdultsPerRoom={adults}&clusterCode=corp&corporateCode={rateCode}"
export const DEFAULT_MARRIOTT_PUBLIC_SEARCH_URL_TEMPLATE =
  "https://www.marriott.com/search/findHotels.mi?destinationAddress.destination={location}&fromDate={checkInMDY}&toDate={checkOutMDY}&roomCount=1&numAdultsPerRoom={adults}"

const DEFAULT_TEMPLATES: Record<GoRatesBrand, Record<GoRatesIntent, string>> = {
  hilton: { PRIVATE: DEFAULT_HILTON_SEARCH_URL_TEMPLATE, PUBLIC: DEFAULT_HILTON_PUBLIC_SEARCH_URL_TEMPLATE },
  marriott: { PRIVATE: DEFAULT_MARRIOTT_SEARCH_URL_TEMPLATE, PUBLIC: DEFAULT_MARRIOTT_PUBLIC_SEARCH_URL_TEMPLATE },
}

export const GO_RATES_MAX_CONCURRENT_TABS = 3
export const GO_RATES_MIN_ADULTS = 1
export const GO_RATES_MAX_ADULTS = 4
/** Hard cap on tabs per plan; matches the extension's own cap. */
export const GO_RATES_MAX_ITEMS = 24

export interface GoRatesPlanItem {
  key: string
  brand: GoRatesBrand
  intent: GoRatesIntent
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

export function goRatesItemKey(
  iata: string,
  checkIn: string,
  checkOut: string,
  brand: GoRatesBrand = "hilton",
  intent: GoRatesIntent = "PRIVATE",
): string {
  return `${iata}|${checkIn}|${checkOut}|${brand}|${intent}`
}

export interface ParsedGoRatesItemKey {
  iata: string
  checkIn: string
  checkOut: string
  brand: GoRatesBrand
  intent: GoRatesIntent
}

/** Parses the 5-part key, and the legacy 3-part key as hilton PRIVATE. */
export function parseGoRatesItemKey(key: unknown): ParsedGoRatesItemKey | null {
  if (typeof key !== "string" || key.length > 64) return null
  const parts = key.split("|")
  if (parts.length !== 3 && parts.length !== 5) return null
  const [iata, checkIn, checkOut] = parts
  const brand = parts.length === 5 ? parts[3] : "hilton"
  const intent = parts.length === 5 ? parts[4] : "PRIVATE"
  if (!/^[A-Z0-9]{3,4}$/.test(iata) || !YMD.test(checkIn) || !YMD.test(checkOut)) return null
  if (Number.isNaN(Date.parse(`${checkIn}T00:00:00Z`)) || Number.isNaN(Date.parse(`${checkOut}T00:00:00Z`))) return null
  if (checkOut <= checkIn) return null
  if (!isGoRatesBrand(brand) || (intent !== "PRIVATE" && intent !== "PUBLIC")) return null
  return { iata, checkIn, checkOut, brand, intent }
}

export function adultsForTravelerCount(travelerCount: number): number {
  const n = Number.isFinite(travelerCount) ? Math.floor(travelerCount) : GO_RATES_MIN_ADULTS
  return Math.min(GO_RATES_MAX_ADULTS, Math.max(GO_RATES_MIN_ADULTS, n))
}

/** "2026-11-06" → "11/06/2026"; "" for anything else. */
export function ymdToMdy(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  return m ? `${m[2]}/${m[3]}/${m[1]}` : ""
}

export interface SearchUrlValues {
  location: string
  /** YYYY-MM-DD */
  checkIn: string
  /** YYYY-MM-DD */
  checkOut: string
  adults: number
  lat?: number
  lng?: number
  rateCode?: string
}

/**
 * Fill {location} {checkIn} {checkOut} {checkInMDY} {checkOutMDY} {adults}
 * {lat} {lng} {rateCode}; every value is URL-encoded, missing ones become "".
 * Returns null unless the result is an absolute https URL, on `host` when
 * given (a mistyped admin template must not open odd tabs).
 */
export function renderSearchUrl(template: string, values: SearchUrlValues, host?: string): string | null {
  const map: Record<string, string> = {
    location: values.location,
    checkIn: values.checkIn,
    checkOut: values.checkOut,
    checkInMDY: ymdToMdy(values.checkIn),
    checkOutMDY: ymdToMdy(values.checkOut),
    adults: String(values.adults),
    lat: typeof values.lat === "number" && Number.isFinite(values.lat) ? String(values.lat) : "",
    lng: typeof values.lng === "number" && Number.isFinite(values.lng) ? String(values.lng) : "",
    rateCode: values.rateCode ?? "",
  }
  const out = template.replace(/\{(location|checkInMDY|checkOutMDY|checkIn|checkOut|adults|lat|lng|rateCode)\}/g, (_m, k: string) =>
    encodeURIComponent(map[k]),
  )
  try {
    const u = new URL(out)
    if (u.protocol !== "https:" || u.username || u.password) return null
    if (host && u.host !== host) return null
    return u.toString()
  } catch {
    return null
  }
}

export interface BrandTemplates {
  /** PRIVATE search template; empty/invalid → the brand default. */
  privateTemplate?: string | null
  /** PUBLIC search template; empty/invalid → the brand default. */
  publicTemplate?: string | null
}

export interface BuildGoRatesItemsOptions {
  /** privateRates.maxCaptureTabs: the max number of items (tabs), clamped to 0..24. */
  maxItems: number
  travelerCount: number
  /** Brands to plan, already filtered by entitlement. Default: hilton only. */
  brands?: {
    hilton?: BrandTemplates
    /** Marriott needs a non-empty rate code; without one it is skipped. */
    marriott?: BrandTemplates & { rateCode?: string | null }
  }
  /** @deprecated Hilton PRIVATE template; use brands.hilton.privateTemplate. */
  urlTemplate?: string | null
}

function renderForBrand(brand: GoRatesBrand, intent: GoRatesIntent, template: string | null | undefined, values: SearchUrlValues): string | null {
  const host = BRAND_HOST[brand]
  const custom = template?.trim()
  return (custom ? renderSearchUrl(custom, values, host) : null) ?? renderSearchUrl(DEFAULT_TEMPLATES[brand][intent], values, host)
}

export function buildGoRatesItems(candidates: readonly PlanCandidate[], options: BuildGoRatesItemsOptions): GoRatesPlanItem[] {
  const maxItems = Math.min(GO_RATES_MAX_ITEMS, Math.max(0, Math.floor(options.maxItems)))
  if (maxItems === 0) return []

  const brands = options.brands ?? { hilton: { privateTemplate: options.urlTemplate } }
  const active: { brand: GoRatesBrand; templates: BrandTemplates; rateCode: string }[] = []
  if (brands.hilton) active.push({ brand: "hilton", templates: brands.hilton, rateCode: "" })
  const mmf = brands.marriott?.rateCode?.trim()
  if (brands.marriott && mmf) active.push({ brand: "marriott", templates: brands.marriott, rateCode: mmf })
  if (active.length === 0) return []

  // checksRemainingToday is enforced by the caller (the daily cap); any positive value here.
  // maxPropertiesPerCheck = maxItems keeps at most maxItems groups, plenty for any per-group size.
  const plan = planRateChecks(candidates, { maxPropertiesPerCheck: maxItems, checksRemainingToday: 1 })
  const adults = adultsForTravelerCount(options.travelerCount)

  const items: GoRatesPlanItem[] = []
  for (const g of plan.groups) {
    const groupItems: GoRatesPlanItem[] = []
    for (const { brand, templates, rateCode } of active) {
      const values: SearchUrlValues = { location: g.location, checkIn: g.checkIn, checkOut: g.checkOut, adults, lat: g.lat, lng: g.lng, rateCode }
      const privUrl = renderForBrand(brand, "PRIVATE", templates.privateTemplate, values)
      const pubUrl = renderForBrand(brand, "PUBLIC", templates.publicTemplate, values)
      // A brand's private and public tabs travel together or not at all.
      if (!privUrl || !pubUrl) continue
      for (const [intent, url] of [["PRIVATE", privUrl], ["PUBLIC", pubUrl]] as const) {
        const item: GoRatesPlanItem = {
          key: goRatesItemKey(g.iata, g.checkIn, g.checkOut, brand, intent),
          brand,
          intent,
          location: g.location,
          checkIn: g.checkIn,
          checkOut: g.checkOut,
          url,
        }
        if (Number.isFinite(g.lat)) item.lat = g.lat
        if (Number.isFinite(g.lng)) item.lng = g.lng
        groupItems.push(item)
      }
    }
    // Groups come best first: once one does not fit, every later one is lower-ranked.
    if (items.length + groupItems.length > maxItems) break
    items.push(...groupItems)
  }
  return items
}
