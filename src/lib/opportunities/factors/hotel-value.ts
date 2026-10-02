/**
 * Hotel value (stage 3, private). Plan §4.1. Pure.
 *
 * Pairs PRIVATE and PUBLIC HotelRateQuote observations by propertyCode for the
 * same dates. Signals: savingsTotal, savingsRatio, unlockedTier (whether the
 * private rate moves the party from a mid-tier to a luxury property). The
 * score weights unlockedTier above raw savings: a $75 Conrad beats a $65
 * Hampton. Everything here is RETRIEVED; private quotes are the user's own.
 */
import { fallbackNameForCode, isMoneyLikeName } from "@/lib/private-rates/names"
import { goRateHeadline, hotelSavingsDetail, hotelSavingsHeadline } from "../reason-text"
import type { DestinationTier, FactorResult, OpportunityReason } from "../types"
import { clamp01, money, pct, reason, result, round, unavailable } from "./shared"

export interface RateQuoteLike {
  id: string
  propertyCode: string
  propertyName: string
  brand?: string | null
  tier?: string | null
  /** PRIVATE_* or PUBLIC */
  rateKind: string
  nightlyRate: number
  totalRate: number
  currency?: string
  available: boolean
  retrievedAt?: Date | string
}

/** Brand -> tier. Hilton portfolio plus a few common comparables. */
export const BRAND_TIER: Record<string, DestinationTier> = {
  "waldorf astoria": "LUXURY",
  conrad: "LUXURY",
  lxr: "LUXURY",
  "signia": "UPSCALE",
  "curio": "UPSCALE",
  "canopy": "UPSCALE",
  "hilton hotels": "UPSCALE",
  hilton: "UPSCALE",
  "doubletree": "MID",
  "embassy suites": "MID",
  "tapestry": "MID",
  "tempo": "MID",
  "motto": "MID",
  "hilton garden inn": "MID",
  "hampton": "BUDGET",
  "tru": "BUDGET",
  "home2": "BUDGET",
  "homewood": "MID",
  "spark": "BUDGET",
}

const TIER_RANK: Record<DestinationTier, number> = { BUDGET: 0, MID: 1, UPSCALE: 2, LUXURY: 3 }

/** Nightly rate below which a property reads as a mid-tier price. */
export const MID_TIER_NIGHTLY_CEILING = 200

export function tierFromBrand(brand: string | null | undefined, explicit?: string | null): DestinationTier | null {
  const e = explicit?.toUpperCase()
  if (e && e in TIER_RANK) return e as DestinationTier
  if (!brand) return null
  const b = brand.toLowerCase()
  // Longest key first so "hilton garden inn" wins over "hilton".
  const keys = Object.keys(BRAND_TIER).sort((x, y) => y.length - x.length)
  for (const k of keys) if (b.includes(k)) return BRAND_TIER[k]
  return null
}

export interface HotelPair {
  propertyCode: string
  propertyName: string
  brand: string | null
  tier: DestinationTier | null
  privateQuote: RateQuoteLike
  publicQuote: RateQuoteLike | null
  savingsTotal: number | null
  savingsRatio: number | null
  /** 0 = no tier unlocked, 0.6 = upscale at a mid price, 1 = luxury at a mid price */
  unlockedTier: number
  /** Internal ranking of pairs */
  value: number
}

export function pairQuotes(quotes: readonly RateQuoteLike[]): HotelPair[] {
  const byCode = new Map<string, { priv: RateQuoteLike[]; pub: RateQuoteLike[] }>()
  for (const q of quotes) {
    if (!q.available || !(q.nightlyRate > 0)) continue
    const entry = byCode.get(q.propertyCode) ?? { priv: [], pub: [] }
    if (q.rateKind.startsWith("PRIVATE")) entry.priv.push(q)
    else if (q.rateKind === "PUBLIC") entry.pub.push(q)
    byCode.set(q.propertyCode, entry)
  }

  const pairs: HotelPair[] = []
  for (const [propertyCode, { priv, pub }] of byCode) {
    if (priv.length === 0) continue
    const privateQuote = priv.reduce((a, b) => (b.totalRate < a.totalRate ? b : a))
    const publicQuote = pub.length ? pub.reduce((a, b) => (b.totalRate < a.totalRate ? b : a)) : null
    const tier = tierFromBrand(privateQuote.brand ?? publicQuote?.brand, privateQuote.tier ?? publicQuote?.tier)
    const savingsTotal = publicQuote ? round(publicQuote.totalRate - privateQuote.totalRate, 2) : null
    const savingsRatio = publicQuote && publicQuote.totalRate > 0 ? round(savingsTotal! / publicQuote.totalRate, 3) : null
    const priceReadsMid = privateQuote.nightlyRate <= MID_TIER_NIGHTLY_CEILING
    const unlockedTier = !priceReadsMid || !tier ? 0 : tier === "LUXURY" ? 1 : tier === "UPSCALE" ? 0.6 : 0
    const savingsPart = savingsRatio == null ? 0 : clamp01(savingsRatio / 0.6)
    const perNightBonus = savingsTotal != null && publicQuote && publicQuote.nightlyRate - privateQuote.nightlyRate >= 150 ? 0.1 : 0
    const value = clamp01(0.55 * unlockedTier + 0.35 * savingsPart + perNightBonus)
    pairs.push({
      propertyCode,
      propertyName: privateQuote.propertyName,
      brand: privateQuote.brand ?? publicQuote?.brand ?? null,
      tier,
      privateQuote,
      publicQuote,
      savingsTotal,
      savingsRatio,
      unlockedTier,
      value,
    })
  }
  return pairs.sort((a, b) => b.value - a.value || a.privateQuote.totalRate - b.privateQuote.totalRate)
}

export interface HotelValueInput {
  quotes: RateQuoteLike[]
  nights: number
  /** Dominant hotel stock at the destination; a LUXURY unlock in a BUDGET town is a bigger deal */
  destinationTier?: DestinationTier | null
  /** ISO 8601 */
  retrievedAt?: string
}

export function evaluateHotelValue(input: HotelValueInput): FactorResult & { pair: HotelPair | null } {
  const pairs = pairQuotes(input.quotes)
  const usable = input.quotes.filter((q) => q.available && q.nightlyRate > 0)
  const privateQuoteCount = usable.filter((q) => q.rateKind.startsWith("PRIVATE")).length
  const publicQuoteCount = usable.filter((q) => q.rateKind === "PUBLIC").length
  if (pairs.length === 0) {
    return { ...unavailable("hotelValue", { quoteCount: input.quotes.length, privateQuoteCount, publicQuoteCount }), pair: null }
  }
  const nights = Math.max(1, input.nights)
  // Cheapest private nightly across every property: the "Go rate from" figure.
  const cheapest = pairs.reduce((a, b) => (b.privateQuote.nightlyRate < a.privateQuote.nightlyRate ? b : a))
  const counts = {
    bestPrivateNightly: cheapest.privateQuote.nightlyRate,
    bestPrivateName: displayHotelName(cheapest.propertyName, cheapest.propertyCode),
    bestPrivateCode: cheapest.propertyCode,
    privateQuoteCount,
    publicQuoteCount,
  }

  // No public comparable for any property: informational only, never a savings claim.
  if (!pairs.some((p) => p.publicQuote)) return evaluatePrivateOnly(input, pairs, cheapest, nights, counts)

  const best = pairs[0]
  const priv = best.privateQuote
  const pub = best.publicQuote
  const bestName = displayHotelName(best.propertyName, best.propertyCode)

  let score = best.value
  if (best.tier && input.destinationTier && TIER_RANK[best.tier] > TIER_RANK[input.destinationTier] && best.unlockedTier > 0) {
    score = clamp01(score + 0.1)
  }
  if (!pub) score = clamp01(score * 0.7) // no comparable: real, but we cannot show the gap

  const reasons: OpportunityReason[] = []
  if (pub && best.savingsTotal != null && best.savingsRatio != null) {
    const perNight = pub.nightlyRate - priv.nightlyRate
    if (best.savingsRatio >= 0.6 || perNight >= 150) {
      reasons.push(
        reason(
          "hotelValue",
          "POSITIVE",
          hotelSavingsHeadline(best.savingsTotal),
          0.5 + best.savingsRatio + best.unlockedTier * 0.5,
          hotelSavingsDetail(bestName, priv.nightlyRate, pub.nightlyRate)
        )
      )
    } else if (best.savingsRatio >= 0.25) {
      reasons.push(
        reason("hotelValue", "POSITIVE", `${pct(best.savingsRatio)} off at ${bestName}`, 0.3 + best.savingsRatio, hotelSavingsDetail(bestName, priv.nightlyRate, pub.nightlyRate))
      )
    }
  }
  if (best.unlockedTier >= 1) {
    reasons.push(reason("hotelValue", "POSITIVE", "Luxury stay at a mid-tier price", 0.9, `${bestName}, ${money(priv.nightlyRate)}/night private`))
  } else if (best.unlockedTier > 0 && !reasons.length) {
    reasons.push(reason("hotelValue", "POSITIVE", "Upscale stay at a mid-tier price", 0.5, `${bestName}, ${money(priv.nightlyRate)}/night private`))
  }

  const res = result(
    "hotelValue",
    score,
    "RETRIEVED",
    {
      ...pairFacts(best, nights, pairs.length),
      ...counts,
    },
    reasons,
    input.retrievedAt ?? (priv.retrievedAt ? new Date(priv.retrievedAt).toISOString() : undefined)
  )
  return { ...res, pair: best }
}

/** A price or bare code is never shown as a hotel name. */
function displayHotelName(name: string, propertyCode: string): string {
  return isMoneyLikeName(name) ? fallbackNameForCode(propertyCode) : name
}

function pairFacts(p: HotelPair, nights: number, pairCount: number) {
  const priv = p.privateQuote
  const pub = p.publicQuote
  return {
    hotelName: displayHotelName(p.propertyName, p.propertyCode),
    propertyCode: p.propertyCode,
    brand: p.brand ?? "",
    tier: p.tier ?? "",
    privateNightlyRate: priv.nightlyRate,
    privateTotal: priv.totalRate,
    comparablePublicRate: pub?.nightlyRate ?? "",
    publicTotal: pub?.totalRate ?? "",
    savingsTotal: p.savingsTotal ?? "",
    savingsRatio: p.savingsRatio ?? "",
    unlockedTier: p.unlockedTier,
    hotelRateQuoteId: priv.id,
    publicRateQuoteId: pub?.id ?? "",
    currency: priv.currency ?? "USD",
    nights,
    pairCount,
    hasPublicComparable: pub != null,
  }
}

/** Score for a private-only result: modest, a little higher when the rate unlocks a better tier. */
export const PRIVATE_ONLY_BASE_SCORE = 0.35

/**
 * Only private (Go) quotes near the candidate: the factor is available and
 * reports the cheapest Go rate as information ("Go rate from $207/night at
 * …"). No public comparable is invented, so there is no savings headline.
 */
function evaluatePrivateOnly(
  input: HotelValueInput,
  pairs: HotelPair[],
  cheapest: HotelPair,
  nights: number,
  counts: Record<string, number | string>
): FactorResult & { pair: HotelPair | null } {
  const priv = cheapest.privateQuote
  const name = displayHotelName(cheapest.propertyName, cheapest.propertyCode)
  const unlocked = pairs.reduce((a, b) => (b.unlockedTier > a.unlockedTier ? b : a))
  let score = PRIVATE_ONLY_BASE_SCORE + 0.25 * unlocked.unlockedTier
  if (unlocked.tier && input.destinationTier && TIER_RANK[unlocked.tier] > TIER_RANK[input.destinationTier] && unlocked.unlockedTier > 0) {
    score += 0.05
  }
  const others = pairs.length - 1
  const reasons: OpportunityReason[] = [
    reason(
      "hotelValue",
      "POSITIVE",
      goRateHeadline(priv.nightlyRate, name, priv.currency ?? "USD"),
      0.3,
      others > 0 ? `Your Go Hilton rate; ${others} more Hilton ${others === 1 ? "hotel" : "hotels"} priced nearby` : "Your Go Hilton rate"
    ),
  ]
  if (unlocked.unlockedTier >= 1) {
    const uName = displayHotelName(unlocked.propertyName, unlocked.propertyCode)
    reasons.push(reason("hotelValue", "POSITIVE", "Luxury stay at a mid-tier price", 0.6, `${uName}, ${money(unlocked.privateQuote.nightlyRate)}/night private`))
  }
  const res = result(
    "hotelValue",
    score,
    "RETRIEVED",
    { ...pairFacts(cheapest, nights, pairs.length), ...counts },
    reasons,
    input.retrievedAt ?? (priv.retrievedAt ? new Date(priv.retrievedAt).toISOString() : undefined)
  )
  return { ...res, pair: cheapest }
}
