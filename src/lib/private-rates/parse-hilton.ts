/**
 * PURE. Turn a HiltonSnapshot (a plain object the runner extracted from the
 * results page via page.evaluate — never raw HTML) into RateObservation rows.
 *
 * Output contract: exactly one observation per call.
 *   - the cheapest available, priced room, or
 *   - an `available: false` observation (rates 0) when no room qualifies.
 *
 * Nothing here touches the network or the DOM.
 */
import type { RateKind, RateObservation } from "./types"

export interface HiltonSnapshotRoom {
  roomType: string
  /** Per-night price as displayed; null when the page showed no nightly figure. */
  nightlyRate: number | null
  /** Stay total as displayed; null when the page showed no total. */
  totalRate: number | null
  /** ISO 4217 code, e.g. "USD". */
  currency: string
  available: boolean
}

export interface HiltonSnapshot {
  propertyName?: string
  brand?: string
  rooms: HiltonSnapshotRoom[]
}

export interface ParseContext {
  propertyCode: string
  checkIn: string
  checkOut: string
  rateKind: RateKind
}

const DAY_MS = 86_400_000

/** Nights between two YYYY-MM-DD dates; falls back to 1 on bad input. */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const a = Date.parse(`${checkIn}T00:00:00Z`)
  const b = Date.parse(`${checkOut}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 1
  const nights = Math.round((b - a) / DAY_MS)
  return nights >= 1 ? nights : 1
}

function isPrice(n: number | null): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

interface PricedRoom {
  room: HiltonSnapshotRoom
  nightly: number
  total: number
}

/** Fill in whichever of nightly/total is missing using the night count. */
function priceRoom(room: HiltonSnapshotRoom, nights: number): PricedRoom | null {
  if (!room.available) return null
  const nightlyRate = isPrice(room.nightlyRate) ? room.nightlyRate : null
  const totalRate = isPrice(room.totalRate) ? room.totalRate : null
  if (nightlyRate === null && totalRate === null) return null
  const nightly = nightlyRate ?? (totalRate as number) / nights
  const total = totalRate ?? (nightlyRate as number) * nights
  return { room, nightly: round2(nightly), total: round2(total) }
}

export function parseHiltonResults(snapshot: HiltonSnapshot, ctx: ParseContext): RateObservation[] {
  const nights = nightsBetween(ctx.checkIn, ctx.checkOut)
  const rooms = Array.isArray(snapshot.rooms) ? snapshot.rooms : []

  let cheapest: PricedRoom | null = null
  for (const room of rooms) {
    const priced = priceRoom(room, nights)
    if (!priced) continue
    if (
      cheapest === null ||
      priced.nightly < cheapest.nightly ||
      (priced.nightly === cheapest.nightly && priced.total < cheapest.total)
    ) {
      cheapest = priced
    }
  }

  const base = {
    propertyCode: ctx.propertyCode,
    propertyName: snapshot.propertyName?.trim() || ctx.propertyCode,
    checkIn: ctx.checkIn,
    checkOut: ctx.checkOut,
    rateKind: ctx.rateKind,
  }
  const brand = snapshot.brand?.trim()

  if (!cheapest) {
    const currency = rooms.find((r) => r.currency)?.currency?.toUpperCase() || "USD"
    return [
      {
        ...base,
        ...(brand ? { brand } : {}),
        nightlyRate: 0,
        totalRate: 0,
        currency,
        available: false,
      },
    ]
  }

  return [
    {
      ...base,
      ...(brand ? { brand } : {}),
      nightlyRate: cheapest.nightly,
      totalRate: cheapest.total,
      currency: (cheapest.room.currency || "USD").toUpperCase(),
      roomType: cheapest.room.roomType?.trim() || undefined,
      available: true,
    },
  ]
}
