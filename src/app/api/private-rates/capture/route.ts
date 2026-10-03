/**
 * POST /api/private-rates/capture — receives rates the JourneyPerfect Go Rates
 * Chrome extension read off a Hilton or Marriott page in the user's own Chrome.
 *
 * Excluded from the cookie middleware: the only credential is the short-lived
 * HMAC capture token from createGoRatesCapturePlan (45 min, bound to one user
 * and one search). Order of checks:
 *   413 body > 512 KB → 400 not JSON → 401 bad/expired token → 429 > 200
 *   captures on this token → 403 kill switch off / not entitled to the item's
 *   brand (re-checked on every capture) → 400 schema / unknown itemKey → write.
 *
 * itemKey ("IATA|checkIn|checkOut|brand|intent", or the legacy
 * "IATA|checkIn|checkOut" = hilton PRIVATE) is verified by looking up an
 * un-pruned OpportunityCandidate with that destination and those dates on the
 * token's search, owned by the token's user. The candidate also supplies the
 * dates and fallback coordinates, so the page can never pick its own dates.
 *
 * The item decides the rate kind (applyItemIntent): a PUBLIC item stores only
 * PUBLIC quotes; a PRIVATE item stores the brand's private kind, plus PUBLIC
 * only for "signed-out" prices. HotelRateQuote.provider = the item's brand.
 *
 * Writes HotelRateQuote rows (sessionId null, expiresAt +24h). A repeat capture
 * for the same provider, property, dates and rate kind replaces the earlier
 * extension rows rather than piling up duplicates. blocked=true writes nothing.
 * Every capture appends a CAPTURE audit row with counts only, never page content.
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { PrivateRatesGateError, assertEnabledAndEntitled, audit } from "@/lib/private-rates"
import { verifyCaptureToken } from "@/lib/private-rates/capture-token"
import {
  CAPTURE_QUOTE_TTL_MS,
  CaptureCounter,
  MAX_CAPTURE_BODY_BYTES,
  applyItemIntent,
  codesNeedingNames,
  normaliseObservations,
  parseCaptureBody,
  repairQuoteNames,
} from "@/lib/private-rates/capture"
import { knownNamesByCode } from "@/lib/private-rates/names"
import { parseGoRatesItemKey } from "@/lib/private-rates/go-rates-plan"

export const dynamic = "force-dynamic"

const counter = new CaptureCounter()

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status, headers: { "Cache-Control": "no-store" } })
}

function dateOnly(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`)
}

export async function POST(req: NextRequest) {
  const declared = Number(req.headers.get("content-length") ?? "0")
  if (Number.isFinite(declared) && declared > MAX_CAPTURE_BODY_BYTES) return fail(413, "Body too large")

  let text: string
  try {
    text = await req.text()
  } catch {
    return fail(400, "Could not read body")
  }
  if (Buffer.byteLength(text, "utf8") > MAX_CAPTURE_BODY_BYTES) return fail(413, "Body too large")

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return fail(400, "Body must be JSON")
  }

  const token = raw && typeof raw === "object" ? (raw as { token?: unknown }).token : undefined
  const verified = verifyCaptureToken(token)
  if (!verified.ok) {
    if (verified.reason === "NO_SECRET") console.error("[private-rates] capture token secret is not configured")
    return fail(401, verified.reason === "EXPIRED" ? "Capture token expired" : "Invalid capture token")
  }
  const { userId, searchId, nonce, exp } = verified.payload

  if (!counter.take(nonce, exp)) return fail(429, "Too many captures for this plan")

  // The item's brand picks the entitlement to check; an unparsable key is a 400 below,
  // after the kill-switch / Hilton gate so a disabled feature still answers 403.
  const key = parseGoRatesItemKey(raw && typeof raw === "object" ? (raw as { itemKey?: unknown }).itemKey : undefined)
  const provider = key?.brand ?? "hilton"
  try {
    await assertEnabledAndEntitled(userId, provider)
  } catch (err) {
    if (err instanceof PrivateRatesGateError) {
      return fail(403, err.reason === "DISABLED" ? "Private rates are turned off" : `Not entitled to ${provider} private rates`)
    }
    throw err
  }

  const parsed = parseCaptureBody(raw)
  if (!parsed.ok) return fail(400, parsed.error)
  const body = parsed.body
  if (!key) return fail(400, "Unknown itemKey")
  const candidate = await prisma.opportunityCandidate.findFirst({
    where: {
      searchId,
      search: { userId },
      destinationIata: key.iata,
      checkIn: dateOnly(key.checkIn),
      checkOut: dateOnly(key.checkOut),
      pruned: false,
    },
    select: { destinationLat: true, destinationLng: true },
  })
  if (!candidate) return fail(400, "Unknown itemKey")

  const blocked = body.blocked === true
  const intent = applyItemIntent(body.observations, key)
  let written = 0
  if (!blocked) {
    let quotes = normaliseObservations(intent.observations, {
      checkIn: key.checkIn,
      checkOut: key.checkOut,
      lat: candidate.destinationLat,
      lng: candidate.destinationLng,
    })
    // A price or bare code in propertyName: reuse a name already stored for that property, else the code.
    const unnamed = codesNeedingNames(quotes)
    if (unnamed.length > 0) {
      const stored = await prisma.hotelRateQuote.findMany({
        where: { userId, provider, propertyCode: { in: unnamed } },
        select: { propertyCode: true, propertyName: true },
        orderBy: { retrievedAt: "desc" },
        take: 500,
      })
      quotes = repairQuoteNames(quotes, knownNamesByCode(stored))
    }
    if (quotes.length > 0) {
      const retrievedAt = new Date()
      const expiresAt = new Date(retrievedAt.getTime() + CAPTURE_QUOTE_TTL_MS)
      const checkIn = dateOnly(key.checkIn)
      const checkOut = dateOnly(key.checkOut)
      const replaced = [...new Map(quotes.map((q) => [`${q.propertyCode}|${q.rateKind}`, q])).values()]
      const [, created] = await prisma.$transaction([
        prisma.hotelRateQuote.deleteMany({
          where: {
            userId,
            provider,
            sessionId: null,
            checkIn,
            checkOut,
            OR: replaced.map((q) => ({ propertyCode: q.propertyCode, rateKind: q.rateKind })),
          },
        }),
        prisma.hotelRateQuote.createMany({
          data: quotes.map((q) => ({
            userId,
            provider,
            propertyCode: q.propertyCode,
            propertyName: q.propertyName,
            brand: q.brand,
            lat: q.lat,
            lng: q.lng,
            checkIn,
            checkOut,
            rateKind: q.rateKind,
            nightlyRate: q.nightlyRate,
            totalRate: q.totalRate,
            currency: q.currency,
            roomType: q.roomType,
            available: q.available,
            sessionId: null,
            retrievedAt,
            expiresAt,
          })),
        }),
      ])
      written = created.count
    }
  }

  await audit(
    userId,
    "CAPTURE",
    {
      searchId,
      itemKey: body.itemKey,
      brand: key.brand,
      intent: key.intent,
      written,
      blocked,
      pageKind: body.pageKind,
      observations: body.observations.length,
      coerced: intent.coerced,
      dropped: intent.dropped,
    },
    { provider, searchId },
  )

  return NextResponse.json({ ok: true, written, itemKey: body.itemKey }, { headers: { "Cache-Control": "no-store" } })
}

function methodNotAllowed() {
  return NextResponse.json({ ok: false, error: "Method not allowed" }, { status: 405, headers: { Allow: "POST" } })
}

export const GET = methodNotAllowed
export const PUT = methodNotAllowed
export const PATCH = methodNotAllowed
export const DELETE = methodNotAllowed
export const OPTIONS = methodNotAllowed
