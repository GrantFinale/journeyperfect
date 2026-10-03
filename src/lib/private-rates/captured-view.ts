/**
 * PURE. Groups a user's captured Hilton and Marriott quotes under a search's
 * candidate destinations and dates for the "Hotel rates from your tabs" panel.
 *
 * A quote belongs to a group when its dates equal the candidate's and it lies
 * within CAPTURED_MATCH_KM of the candidate's coordinates (the destination
 * airport), the same rule stage 3 uses. Rows are keyed by provider (brand) +
 * property code: a private quote pairs only with a PUBLIC quote of the same
 * brand, property and dates (dates are the group's).
 *
 * Nothing is invented: publicNightly and savingsPerNight are present only
 * when a PUBLIC quote was actually captured, and not even then when the
 * brand's public search evidently showed the private rate too
 * (publicMatchesPrivate, see brands.ts).
 */
import { haversineDistance } from "@/lib/haversine"
import {
  RATE_LABEL_KIND,
  brandOfProvider,
  isPrivateRateKind,
  publicMatchesPrivate,
  type GoRatesBrand,
  type RateLabelKind,
} from "./brands"
import { ymdToMdy } from "./go-rates-plan"
import { knownNamesByCode, resolveHotelName } from "./names"

/** Same radius as the pipeline's HOTEL_MATCH_KM. */
export const CAPTURED_MATCH_KM = 40

export interface CapturedCandidateLike {
  destinationIata: string
  destinationName: string
  destinationLat: number
  destinationLng: number
  /** YYYY-MM-DD */
  checkIn: string
  /** YYYY-MM-DD */
  checkOut: string
  nights: number
}

export interface CapturedQuoteLike {
  id: string
  /** HotelRateQuote.provider ("hilton" | "marriott"); absent = hilton */
  provider?: string | null
  propertyCode: string
  propertyName: string
  brand: string | null
  lat: number | null
  lng: number | null
  /** YYYY-MM-DD */
  checkIn: string
  /** YYYY-MM-DD */
  checkOut: string
  rateKind: string
  nightlyRate: number
  currency: string
  roomType: string | null
  available: boolean
  retrievedAt: Date
}

export interface CapturedHotelRate {
  /** The chain the quote came from (HotelRateQuote.provider) */
  brand: GoRatesBrand
  /** "GO" (Go Hilton) | "FF" (Marriott Friends & Family): the private rate's kind */
  rateLabelKind: RateLabelKind
  propertyCode: string
  propertyName: string
  /** Sub-brand shown on the page, e.g. "Hampton by Hilton", "JW Marriott" */
  propertyBrand?: string
  /** Private (Go / F&F) nightly rate */
  privateNightly?: number
  publicNightly?: number
  /** publicNightly − privateNightly, only when both were captured in the same currency and the public search is trusted */
  savingsPerNight?: number
  currency: string
  /** Room / rate label of the private quote (else the public one), e.g. "inferred (Go Hilton portal, single price)" */
  label?: string
  /** ISO 8601, newest quote used for this row */
  retrievedAt: string
  /** Brand booking page for real property codes; absent for synthetic "name:" codes */
  bookingUrl?: string
  /** From the candidate's coordinates (the destination airport) */
  distanceKm: number
}

export interface CapturedRateGroup {
  destinationName: string
  destinationIata: string
  checkIn: string
  checkOut: string
  nights: number
  hotels: CapturedHotelRate[]
  /**
   * Per brand with at least one private+public pair: true when that brand's
   * public search showed (almost) the same prices as the private one, so its
   * public prices were withheld and no savings are claimed.
   */
  publicMatchesPrivate: Partial<Record<GoRatesBrand, boolean>>
}

/** Per-brand tab outcomes since the search's latest extension plan. */
export interface CaptureTabStats {
  /** Tabs whose page was the site's bot-protection / error page */
  blocked: number
  /** Tabs read fine but with nothing stored (no priced hotels) */
  empty: number
  /** Tabs that stored at least one quote */
  captured: number
}

export interface CapturedHotelRates {
  groups: CapturedRateGroup[]
  /** Distinct quotes shown across all groups */
  totalQuotes: number
  /** Distinct properties across all groups */
  totalHotels: number
  /** ISO 8601, newest quote shown */
  capturedAt?: string
  /** Brands with at least one row shown */
  brands?: GoRatesBrand[]
  /** Tab outcomes of the latest extension run, per brand */
  tabs?: Partial<Record<GoRatesBrand, CaptureTabStats>>
}

export const EMPTY_CAPTURED_RATES: CapturedHotelRates = { groups: [], totalQuotes: 0, totalHotels: 0 }

const CTYHOCN_RE = /^[A-Z0-9]{4,10}$/
const MARSHA_RE = /^[A-Z0-9]{5}$/

export function hiltonBookingUrl(propertyCode: string, checkIn: string, checkOut: string, adults: number): string | undefined {
  const code = propertyCode.trim().toUpperCase()
  if (propertyCode.startsWith("name:") || !CTYHOCN_RE.test(code)) return undefined
  const q = new URLSearchParams({ ctyhocn: code, arrivalDate: checkIn, departureDate: checkOut, room1NumAdults: String(adults) })
  return `https://www.hilton.com/en/book/reservation/rooms/?${q.toString()}`
}

/**
 * Marriott availability page for a MARSHA code. With `rateCode` (private rows)
 * the corporate code is applied; without it (public rows) it is not.
 */
export function marriottBookingUrl(
  propertyCode: string,
  checkIn: string,
  checkOut: string,
  adults: number,
  rateCode?: string | null,
): string | undefined {
  const code = propertyCode.trim().toUpperCase()
  if (propertyCode.startsWith("name:") || !MARSHA_RE.test(code)) return undefined
  const from = ymdToMdy(checkIn)
  const to = ymdToMdy(checkOut)
  if (!from || !to) return undefined
  const q = new URLSearchParams({ propertyCode: code, fromDate: from, toDate: to, numberOfRooms: "1", numberOfAdults: String(adults) })
  const corp = rateCode?.trim()
  if (corp) {
    q.set("clusterCode", "corp")
    q.set("corporateCode", corp)
  }
  return `https://www.marriott.com/reservation/availabilitySearch.mi?${q.toString()}`
}

const round1 = (n: number) => Math.round(n * 10) / 10
const round2 = (n: number) => Math.round(n * 100) / 100

interface RowAcc {
  brand: GoRatesBrand
  propertyCode: string
  priv: CapturedQuoteLike | null
  pub: CapturedQuoteLike | null
  km: number
  newest: number
  ids: string[]
}

export function groupCapturedRates(
  candidates: readonly CapturedCandidateLike[],
  quotes: readonly CapturedQuoteLike[],
  opts: { adults: number; matchKm?: number; marriottRateCode?: string | null },
): CapturedHotelRates {
  const matchKm = opts.matchKm ?? CAPTURED_MATCH_KM
  const usedQuotes = new Set<string>()
  const codes = new Set<string>()
  const brandsShown = new Set<GoRatesBrand>()
  let newest = 0

  // Names are resolved within a brand: property codes of two chains never mix.
  const knownByBrand = new Map<GoRatesBrand, Map<string, string>>()
  for (const b of ["hilton", "marriott"] as const) {
    knownByBrand.set(b, knownNamesByCode(quotes.filter((q) => brandOfProvider(q.provider) === b)))
  }

  const seen = new Set<string>()
  const groups: CapturedRateGroup[] = []
  for (const c of candidates) {
    const key = `${c.destinationIata}|${c.checkIn}|${c.checkOut}`
    if (seen.has(key)) continue
    seen.add(key)

    const rows = new Map<string, RowAcc>()
    for (const q of quotes) {
      if (q.checkIn !== c.checkIn || q.checkOut !== c.checkOut) continue
      if (!q.available || !(q.nightlyRate > 0) || q.lat == null || q.lng == null) continue
      const km = haversineDistance(c.destinationLat, c.destinationLng, q.lat, q.lng)
      if (km > matchKm) continue
      const brand = brandOfProvider(q.provider)
      const rowKey = `${brand}|${q.propertyCode}`
      const e = rows.get(rowKey) ?? { brand, propertyCode: q.propertyCode, priv: null, pub: null, km, newest: 0, ids: [] }
      if (isPrivateRateKind(q.rateKind)) {
        if (!e.priv || q.nightlyRate < e.priv.nightlyRate) e.priv = q
      } else if (q.rateKind === "PUBLIC") {
        if (!e.pub || q.nightlyRate < e.pub.nightlyRate) e.pub = q
      } else continue
      e.km = Math.min(e.km, km)
      e.newest = Math.max(e.newest, q.retrievedAt.getTime())
      e.ids.push(q.id)
      rows.set(rowKey, e)
    }

    // Per brand: is the public search trustworthy?
    const flags: Partial<Record<GoRatesBrand, boolean>> = {}
    for (const b of ["hilton", "marriott"] as const) {
      const pairs = [...rows.values()]
        .filter((r) => r.brand === b && r.priv && r.pub && r.priv.currency === r.pub.currency)
        .map((r) => ({ privateNightly: r.priv!.nightlyRate, publicNightly: r.pub!.nightlyRate }))
      if (pairs.length > 0) flags[b] = publicMatchesPrivate(pairs)
    }

    const hotels: CapturedHotelRate[] = []
    for (const e of rows.values()) {
      const unreliablePublic = flags[e.brand] === true
      const pub = unreliablePublic ? null : e.pub
      const main = e.priv ?? pub
      if (!main) continue
      const row: CapturedHotelRate = {
        brand: e.brand,
        rateLabelKind: RATE_LABEL_KIND[e.brand],
        propertyCode: e.propertyCode,
        propertyName: resolveHotelName(main.propertyName, e.propertyCode, knownByBrand.get(e.brand)!),
        currency: main.currency,
        retrievedAt: new Date(e.newest).toISOString(),
        distanceKm: round1(e.km),
      }
      const propertyBrand = e.priv?.brand ?? e.pub?.brand
      if (propertyBrand) row.propertyBrand = propertyBrand
      if (e.priv) row.privateNightly = e.priv.nightlyRate
      if (pub) row.publicNightly = pub.nightlyRate
      if (e.priv && pub && e.priv.currency === pub.currency) row.savingsPerNight = round2(pub.nightlyRate - e.priv.nightlyRate)
      const label = main.roomType?.trim()
      if (label) row.label = label
      const url =
        e.brand === "marriott"
          ? marriottBookingUrl(e.propertyCode, c.checkIn, c.checkOut, opts.adults, e.priv ? opts.marriottRateCode : null)
          : hiltonBookingUrl(e.propertyCode, c.checkIn, c.checkOut, opts.adults)
      if (url) row.bookingUrl = url
      hotels.push(row)
      for (const id of e.ids) usedQuotes.add(id)
      codes.add(`${e.brand}|${e.propertyCode}`)
      brandsShown.add(e.brand)
      newest = Math.max(newest, e.newest)
    }
    if (hotels.length === 0) continue
    hotels.sort(
      (a, b) =>
        (a.privateNightly ?? Infinity) - (b.privateNightly ?? Infinity) ||
        (a.publicNightly ?? Infinity) - (b.publicNightly ?? Infinity) ||
        a.propertyName.localeCompare(b.propertyName),
    )
    groups.push({
      destinationName: c.destinationName,
      destinationIata: c.destinationIata,
      checkIn: c.checkIn,
      checkOut: c.checkOut,
      nights: c.nights,
      hotels,
      publicMatchesPrivate: flags,
    })
  }
  groups.sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.destinationName.localeCompare(b.destinationName))
  const out: CapturedHotelRates = { groups, totalQuotes: usedQuotes.size, totalHotels: codes.size }
  if (newest > 0) out.capturedAt = new Date(newest).toISOString()
  if (brandsShown.size > 0) out.brands = (["hilton", "marriott"] as const).filter((b) => brandsShown.has(b))
  return out
}

/**
 * Per-brand tab outcomes from CAPTURE audit details ({ itemKey, brand?,
 * written, blocked }), oldest first. A tab captured twice (e.g. again by hand)
 * counts once, by its latest outcome. Legacy details without `brand` count as
 * Hilton.
 */
export function summariseCaptureAudits(details: readonly unknown[]): Partial<Record<GoRatesBrand, CaptureTabStats>> {
  const latest = new Map<string, { brand?: unknown; written?: unknown; blocked?: unknown }>()
  details.forEach((d, i) => {
    if (!d || typeof d !== "object") return
    const k = (d as { itemKey?: unknown }).itemKey
    latest.set(typeof k === "string" ? k : `#${i}`, d as { brand?: unknown; written?: unknown; blocked?: unknown })
  })
  const out: Partial<Record<GoRatesBrand, CaptureTabStats>> = {}
  for (const detail of latest.values()) {
    const brand = brandOfProvider(typeof detail.brand === "string" ? detail.brand : null)
    const s = (out[brand] ??= { blocked: 0, empty: 0, captured: 0 })
    if (detail.blocked === true) s.blocked++
    else if (typeof detail.written === "number" && detail.written > 0) s.captured++
    else s.empty++
  }
  return out
}
