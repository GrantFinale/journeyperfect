/**
 * PURE. Validation and normalisation for POST /api/private-rates/capture, the
 * endpoint the Go Rates Chrome extension posts page observations to.
 *
 * Kept free of Prisma and Next so it can be unit-tested directly; the route
 * handler only adds auth, gates, the item lookup and the writes.
 */
import { z } from "zod"

export const MAX_CAPTURE_BODY_BYTES = 512 * 1024
export const MAX_CAPTURES_PER_TOKEN = 200
export const MAX_OBSERVATIONS_PER_CAPTURE = 60
export const MAX_FIELD_LENGTH = 200
/** URLs are informational (never stored or fetched) but can legitimately exceed 200 chars. */
export const MAX_URL_LENGTH = 2000
export const CAPTURE_QUOTE_TTL_MS = 24 * 60 * 60_000

const str = z.string().trim().max(MAX_FIELD_LENGTH)
const rate = z.number().finite().gt(0).lt(100_000)

export const captureObservationSchema = z.object({
  propertyCode: str.optional(),
  propertyName: str.min(1),
  brand: str.optional(),
  nightlyRate: rate,
  totalRate: rate.optional(),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/, "currency must be a 3-letter code"),
  rateKind: z.enum(["PRIVATE_HILTON_GO", "PUBLIC"]),
  rateLabel: str.optional(),
  available: z.boolean(),
  lat: z.number().finite().min(-90).max(90).optional(),
  lng: z.number().finite().min(-180).max(180).optional(),
  propertyUrl: z.string().max(MAX_URL_LENGTH).optional(),
})

export const captureBodySchema = z.object({
  token: z.string().min(1).max(1024),
  itemKey: z.string().min(1).max(MAX_FIELD_LENGTH),
  pageUrl: z.string().max(MAX_URL_LENGTH),
  capturedAt: z.string().max(64).refine((s) => !Number.isNaN(Date.parse(s)), "capturedAt must be an ISO date"),
  pageKind: z.enum(["SEARCH", "ROOMS", "OTHER"]),
  blocked: z.boolean().optional(),
  observations: z.array(captureObservationSchema).max(MAX_OBSERVATIONS_PER_CAPTURE),
})

export type CaptureBody = z.infer<typeof captureBodySchema>
export type CaptureObservation = z.infer<typeof captureObservationSchema>

export function parseCaptureBody(raw: unknown): { ok: true; body: CaptureBody } | { ok: false; error: string } {
  // The extension reports sold-out cards as { available: false, nightlyRate: 0 }. They carry no
  // price to compare, so drop them before validation instead of rejecting the whole capture.
  if (raw && typeof raw === "object" && Array.isArray((raw as { observations?: unknown }).observations)) {
    const obs = (raw as { observations: unknown[] }).observations.filter(
      (o) => !(o && typeof o === "object" && (o as { available?: unknown }).available === false),
    )
    raw = { ...(raw as object), observations: obs }
  }
  const r = captureBodySchema.safeParse(raw)
  if (r.success) return { ok: true, body: r.data }
  const first = r.error.issues[0]
  const where = first?.path?.length ? first.path.join(".") : "body"
  return { ok: false, error: `Invalid ${where}: ${first?.message ?? "bad request"}` }
}

/** "Hilton Chicago" + (41.87, -87.62) → "name:hilton-chicago@41.872,-87.624". Stable across captures. */
export function namePropertyCode(propertyName: string, lat?: number, lng?: number): string {
  const slug =
    propertyName
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "property"
  const where = typeof lat === "number" && typeof lng === "number" ? `@${lat.toFixed(3)},${lng.toFixed(3)}` : ""
  return `name:${slug}${where}`
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  const ms = Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)
  return Math.max(1, Math.round(ms / 86_400_000))
}

export interface CaptureItem {
  /** YYYY-MM-DD */
  checkIn: string
  /** YYYY-MM-DD */
  checkOut: string
  lat: number | null
  lng: number | null
}

/** One HotelRateQuote row (minus userId/provider/timestamps the route adds). */
export interface NormalisedQuote {
  propertyCode: string
  propertyName: string
  brand: string | null
  lat: number | null
  lng: number | null
  checkIn: string
  checkOut: string
  rateKind: "PRIVATE_HILTON_GO" | "PUBLIC"
  nightlyRate: number
  totalRate: number
  currency: string
  roomType: string | null
  available: boolean
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Map observations onto quote rows for the item's dates and dedupe exact
 * repeats (same property, rate kind, room label and nightly rate). The
 * property code is the page's when given, else a stable name+coords slug;
 * coordinates are the observation's when given, else the item's destination.
 */
export function normaliseObservations(observations: readonly CaptureObservation[], item: CaptureItem): NormalisedQuote[] {
  const nights = nightsBetween(item.checkIn, item.checkOut)
  const seen = new Set<string>()
  const out: NormalisedQuote[] = []
  for (const o of observations) {
    const hasCoords = typeof o.lat === "number" && typeof o.lng === "number"
    const lat = hasCoords ? o.lat! : item.lat
    const lng = hasCoords ? o.lng! : item.lng
    const propertyCode = o.propertyCode?.trim() || namePropertyCode(o.propertyName, hasCoords ? o.lat : undefined, hasCoords ? o.lng : undefined)
    const totalRate = typeof o.totalRate === "number" ? o.totalRate : round2(o.nightlyRate * nights)
    const roomType = o.rateLabel?.trim() || null
    const key = [propertyCode, o.rateKind, roomType ?? "", o.nightlyRate].join("|")
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      propertyCode,
      propertyName: o.propertyName,
      brand: o.brand?.trim() || null,
      lat,
      lng,
      checkIn: item.checkIn,
      checkOut: item.checkOut,
      rateKind: o.rateKind,
      nightlyRate: o.nightlyRate,
      totalRate,
      currency: o.currency.toUpperCase(),
      roomType,
      available: o.available,
    })
  }
  return out
}

/**
 * In-memory per-token capture counter (the 429 control). Keyed by the token's
 * nonce; entries are dropped once their token has expired. Per-process: with
 * one app container that is the whole budget; with several it is per replica,
 * which is still a hard bound on how much one token can write.
 */
export class CaptureCounter {
  private readonly counts = new Map<string, { n: number; expMs: number }>()
  constructor(private readonly limit = MAX_CAPTURES_PER_TOKEN) {}

  /** Counts this capture; false when the token has already used its budget. */
  take(nonce: string, expSeconds: number, now = Date.now()): boolean {
    this.sweep(now)
    const entry = this.counts.get(nonce) ?? { n: 0, expMs: expSeconds * 1000 }
    if (entry.n >= this.limit) return false
    entry.n += 1
    this.counts.set(nonce, entry)
    return true
  }

  private sweep(now: number) {
    if (this.counts.size < 256) return
    for (const [k, v] of this.counts) if (v.expMs <= now) this.counts.delete(k)
  }
}
