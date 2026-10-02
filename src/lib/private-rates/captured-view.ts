/**
 * PURE. Groups a user's captured Hilton quotes under a search's candidate
 * destinations and dates for the "Hotel rates from your Hilton tabs" panel.
 *
 * A quote belongs to a group when its dates equal the candidate's and it lies
 * within CAPTURED_MATCH_KM of the candidate's coordinates (the destination
 * airport), the same rule stage 3 uses. Nothing is invented: publicNightly and
 * savingsPerNight are present only when a PUBLIC quote was actually captured.
 */
import { haversineDistance } from "@/lib/haversine"
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
  propertyCode: string
  propertyName: string
  brand?: string
  goNightly?: number
  publicNightly?: number
  /** publicNightly − goNightly, only when both were captured in the same currency */
  savingsPerNight?: number
  currency: string
  /** Room / rate label of the Go quote (else the public one), e.g. "inferred (Go Hilton portal, single price)" */
  label?: string
  /** ISO 8601, newest quote used for this row */
  retrievedAt: string
  /** Hilton booking page for real ctyhocn codes; absent for synthetic "name:" codes */
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
}

export interface CapturedHotelRates {
  groups: CapturedRateGroup[]
  /** Distinct quotes shown across all groups */
  totalQuotes: number
  /** Distinct properties across all groups */
  totalHotels: number
  /** ISO 8601, newest quote shown */
  capturedAt?: string
}

export const EMPTY_CAPTURED_RATES: CapturedHotelRates = { groups: [], totalQuotes: 0, totalHotels: 0 }

const CTYHOCN_RE = /^[A-Z0-9]{4,10}$/

export function hiltonBookingUrl(propertyCode: string, checkIn: string, checkOut: string, adults: number): string | undefined {
  const code = propertyCode.trim().toUpperCase()
  if (propertyCode.startsWith("name:") || !CTYHOCN_RE.test(code)) return undefined
  const q = new URLSearchParams({ ctyhocn: code, arrivalDate: checkIn, departureDate: checkOut, room1NumAdults: String(adults) })
  return `https://www.hilton.com/en/book/reservation/rooms/?${q.toString()}`
}

const round1 = (n: number) => Math.round(n * 10) / 10
const round2 = (n: number) => Math.round(n * 100) / 100

export function groupCapturedRates(
  candidates: readonly CapturedCandidateLike[],
  quotes: readonly CapturedQuoteLike[],
  opts: { adults: number; matchKm?: number }
): CapturedHotelRates {
  const matchKm = opts.matchKm ?? CAPTURED_MATCH_KM
  const known = knownNamesByCode(quotes)
  const usedQuotes = new Set<string>()
  const codes = new Set<string>()
  let newest = 0

  const seen = new Set<string>()
  const groups: CapturedRateGroup[] = []
  for (const c of candidates) {
    const key = `${c.destinationIata}|${c.checkIn}|${c.checkOut}`
    if (seen.has(key)) continue
    seen.add(key)

    const byCode = new Map<string, { go: CapturedQuoteLike | null; pub: CapturedQuoteLike | null; km: number; newest: number; ids: string[] }>()
    for (const q of quotes) {
      if (q.checkIn !== c.checkIn || q.checkOut !== c.checkOut) continue
      if (!q.available || !(q.nightlyRate > 0) || q.lat == null || q.lng == null) continue
      const km = haversineDistance(c.destinationLat, c.destinationLng, q.lat, q.lng)
      if (km > matchKm) continue
      const e = byCode.get(q.propertyCode) ?? { go: null, pub: null, km, newest: 0, ids: [] }
      if (q.rateKind.startsWith("PRIVATE")) {
        if (!e.go || q.nightlyRate < e.go.nightlyRate) e.go = q
      } else if (q.rateKind === "PUBLIC") {
        if (!e.pub || q.nightlyRate < e.pub.nightlyRate) e.pub = q
      } else continue
      e.km = Math.min(e.km, km)
      e.newest = Math.max(e.newest, q.retrievedAt.getTime())
      e.ids.push(q.id)
      byCode.set(q.propertyCode, e)
    }

    const hotels: CapturedHotelRate[] = []
    for (const [propertyCode, e] of byCode) {
      const main = e.go ?? e.pub
      if (!main) continue
      const row: CapturedHotelRate = {
        propertyCode,
        propertyName: resolveHotelName(main.propertyName, propertyCode, known),
        currency: main.currency,
        retrievedAt: new Date(e.newest).toISOString(),
        distanceKm: round1(e.km),
      }
      const brand = e.go?.brand ?? e.pub?.brand
      if (brand) row.brand = brand
      if (e.go) row.goNightly = e.go.nightlyRate
      if (e.pub) row.publicNightly = e.pub.nightlyRate
      if (e.go && e.pub && e.go.currency === e.pub.currency) row.savingsPerNight = round2(e.pub.nightlyRate - e.go.nightlyRate)
      const label = main.roomType?.trim()
      if (label) row.label = label
      const url = hiltonBookingUrl(propertyCode, c.checkIn, c.checkOut, opts.adults)
      if (url) row.bookingUrl = url
      hotels.push(row)
      for (const id of e.ids) usedQuotes.add(id)
      codes.add(propertyCode)
      newest = Math.max(newest, e.newest)
    }
    if (hotels.length === 0) continue
    hotels.sort(
      (a, b) =>
        (a.goNightly ?? Infinity) - (b.goNightly ?? Infinity) ||
        (a.publicNightly ?? Infinity) - (b.publicNightly ?? Infinity) ||
        a.propertyName.localeCompare(b.propertyName)
    )
    groups.push({
      destinationName: c.destinationName,
      destinationIata: c.destinationIata,
      checkIn: c.checkIn,
      checkOut: c.checkOut,
      nights: c.nights,
      hotels,
    })
  }
  groups.sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.destinationName.localeCompare(b.destinationName))
  const out: CapturedHotelRates = { groups, totalQuotes: usedQuotes.size, totalHotels: codes.size }
  if (newest > 0) out.capturedAt = new Date(newest).toISOString()
  return out
}
