/**
 * PURE. Validation and normalisation for POST /api/private-rates/capture, the
 * endpoint the Go Rates Chrome extension posts page observations to.
 *
 * Kept free of Prisma and Next so it can be unit-tested directly; the route
 * handler only adds auth, gates, the item lookup and the writes. The one
 * exception, repairCapturedHotelNames, takes its store as a parameter and only
 * imports Prisma lazily when none is given.
 */
import { z } from "zod"
import { PRIVATE_RATE_KIND, isPrivateRateKind, type GoRatesBrand, type GoRatesIntent } from "./brands"
import type { RateKind } from "./types"
import { fallbackNameForCode, isMoneyLikeName, knownNamesByCode, needsBetterName, resolveHotelName } from "./names"

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
  rateKind: z.enum(["PRIVATE_HILTON_GO", "PRIVATE_MARRIOTT_FF", "PUBLIC"]),
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

/** rateLabel the extension uses for prices read while signed out of the brand's site. */
export const SIGNED_OUT_LABEL = "signed-out"

/**
 * Make observations consistent with the plan item they were captured for. The
 * item, not the page, decides what a price is:
 *   PUBLIC item   every observation becomes PUBLIC (a public search cannot
 *                 produce a private rate).
 *   PRIVATE item  private observations get the brand's private kind; a PUBLIC
 *                 observation is kept only when labelled "signed-out" (the
 *                 user was not signed in, so the price is honestly public),
 *                 otherwise dropped: the public comparable comes from the
 *                 item's PUBLIC twin, never from guesses on the private page.
 */
export function applyItemIntent(
  observations: readonly CaptureObservation[],
  item: { brand: GoRatesBrand; intent: GoRatesIntent },
): { observations: CaptureObservation[]; coerced: number; dropped: number } {
  const out: CaptureObservation[] = []
  let coerced = 0
  let dropped = 0
  const privateKind = PRIVATE_RATE_KIND[item.brand]
  for (const o of observations) {
    if (item.intent === "PUBLIC") {
      if (o.rateKind !== "PUBLIC") coerced++
      out.push(o.rateKind === "PUBLIC" ? o : { ...o, rateKind: "PUBLIC" })
      continue
    }
    if (isPrivateRateKind(o.rateKind)) {
      if (o.rateKind !== privateKind) coerced++
      out.push(o.rateKind === privateKind ? o : { ...o, rateKind: privateKind })
      continue
    }
    if (o.rateLabel?.trim().toLowerCase() === SIGNED_OUT_LABEL) out.push(o)
    else dropped++
  }
  return { observations: out, coerced, dropped }
}

/** "Hilton Chicago" + (41.87, -87.62) →"name:hilton-chicago@41.872,-87.624". Stable across captures. */
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
  rateKind: RateKind
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
 * Replace unusable names (a price such as "$317", digits, or just the property
 * code) with a usable name: one from this same batch for the code, else one in
 * `stored` (names already captured for the user), else the code itself.
 * Returns new objects; never invents a name.
 */
export function repairQuoteNames<T extends { propertyCode: string; propertyName: string }>(
  quotes: readonly T[],
  stored: ReadonlyMap<string, string> = new Map(),
): T[] {
  const known = new Map(stored)
  for (const [code, name] of knownNamesByCode(quotes)) known.set(code, name)
  return quotes.map((q) => {
    const propertyName = resolveHotelName(q.propertyName, q.propertyCode, known)
    return propertyName === q.propertyName ? q : { ...q, propertyName }
  })
}

/** Property codes in a batch whose names need a stored-name lookup. */
export function codesNeedingNames(quotes: readonly { propertyCode: string; propertyName: string }[]): string[] {
  return [...new Set(quotes.filter((q) => needsBetterName(q.propertyName, q.propertyCode)).map((q) => q.propertyCode))]
}

/** The slice of Prisma `repairCapturedHotelNames` uses (injectable for tests). */
export interface HotelNameStore {
  hotelRateQuote: {
    findMany(args: {
      where: { userId: string; provider: string }
      select: { id: true; propertyCode: true; propertyName: true }
      orderBy: { retrievedAt: "desc" }
      take: number
    }): Promise<{ id: string; propertyCode: string; propertyName: string }[]>
    updateMany(args: { where: { userId: string; id: { in: string[] } }; data: { propertyName: string } }): Promise<{ count: number }>
  }
}

export const REPAIR_NAMES_MAX_ROWS = 5000

/**
 * One-off, idempotent repair of one user's captured quotes (one provider) whose
 * propertyName is money-like (the 0.1.0 extension bug) or only the code.
 * Same rules as capture time: a usable name stored for that property code in
 * any of the user's rows, else the code. Scoped to `userId`, touches only the
 * propertyName of rows that need it, bounded to the newest
 * REPAIR_NAMES_MAX_ROWS rows. Returns the number of rows changed.
 */
export async function repairCapturedHotelNames(userId: string, store?: HotelNameStore, provider = "hilton"): Promise<number> {
  const db: HotelNameStore = store ?? ((await import("@/lib/db")).prisma as unknown as HotelNameStore)
  const rows = await db.hotelRateQuote.findMany({
    where: { userId, provider },
    select: { id: true, propertyCode: true, propertyName: true },
    orderBy: { retrievedAt: "desc" },
    take: REPAIR_NAMES_MAX_ROWS,
  })
  const known = knownNamesByCode(rows)
  const byTarget = new Map<string, string[]>()
  for (const r of rows) {
    if (!needsBetterName(r.propertyName, r.propertyCode)) continue
    const target = known.get(r.propertyCode) ?? (isMoneyLikeName(r.propertyName) ? fallbackNameForCode(r.propertyCode) : r.propertyName)
    if (target === r.propertyName) continue
    const ids = byTarget.get(target) ?? []
    ids.push(r.id)
    byTarget.set(target, ids)
  }
  let changed = 0
  for (const [propertyName, ids] of byTarget) {
    const res = await db.hotelRateQuote.updateMany({ where: { userId, id: { in: ids } }, data: { propertyName } })
    changed += res.count
  }
  return changed
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
