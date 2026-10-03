/**
 * Hotel value (stage 3, private). Plan §4.1. Pure.
 *
 * Pairs a private quote (Go Hilton or Marriott F&F, any PRIVATE_* kind) with
 * the PUBLIC quote of the same provider, property code and dates (the caller
 * passes one candidate's dates). When a provider's public search evidently
 * showed the private rate too (≥80% of its pairs within $1, see brands.ts),
 * its public quotes are dropped: no savings are claimed from them.
 *
 * Signals: savingsTotal, savingsRatio, unlockedTier (whether the private rate
 * moves the party from a mid-tier to a luxury property). Best deal = a luxury
 * unlock with savings first, else the largest savings; with no savings at all,
 * the cheapest private rate is reported as information only. Everything here is
 * RETRIEVED; private quotes are the user's own.
 */
import { brandOfProvider, isPrivateRateKind, publicMatchesPrivate, type GoRatesBrand } from "@/lib/private-rates/brands"
import { fallbackNameForCode, isMoneyLikeName } from "@/lib/private-rates/names"
import { hotelSavingsDetail, hotelSavingsHeadline, privateRateHeadline, privateRateNote } from "../reason-text"
import type { DestinationTier, FactorResult, OpportunityReason } from "../types"
import { clamp01, money, pct, reason, result, round, unavailable } from "./shared"

export interface RateQuoteLike {
  id: string
  /** HotelRateQuote.provider: "hilton" | "marriott"; absent = hilton */
  provider?: string | null
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

/** Brand -> tier. Hilton and Marriott portfolios. Matched longest key first. */
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
  // Marriott
  "ritz-carlton": "LUXURY",
  "ritz carlton": "LUXURY",
  "st. regis": "LUXURY",
  "st regis": "LUXURY",
  "jw marriott": "LUXURY",
  "edition": "LUXURY",
  "luxury collection": "LUXURY",
  "w hotels": "LUXURY",
  "bulgari": "LUXURY",
  marriott: "UPSCALE",
  sheraton: "UPSCALE",
  westin: "UPSCALE",
  "le meridien": "UPSCALE",
  "le méridien": "UPSCALE",
  "autograph collection": "UPSCALE",
  renaissance: "UPSCALE",
  gaylord: "UPSCALE",
  "tribute portfolio": "UPSCALE",
  "delta hotels": "MID",
  courtyard: "MID",
  "residence inn": "MID",
  "springhill suites": "MID",
  "ac hotel": "MID",
  aloft: "MID",
  "four points": "MID",
  "element by westin": "MID",
  fairfield: "BUDGET",
  "towneplace": "BUDGET",
  moxy: "BUDGET",
}

const TIER_RANK: Record<DestinationTier, number> = { BUDGET: 0, MID: 1, UPSCALE: 2, LUXURY: 3 }

/** Nightly rate below which a property reads as a mid-tier price. */
export const MID_TIER_NIGHTLY_CEILING = 200

export function tierFromBrand(brand: string | null | undefined, explicit?: string | null): DestinationTier | null {
  const e = explicit?.toUpperCase()
  if (e && e in TIER_RANK) return e as DestinationTier
  if (!brand) return null
  const b = brand.toLowerCase()
  // Longest key first so "hilton garden inn" wins over "hilton", "jw marriott" over "marriott".
  const keys = Object.keys(BRAND_TIER).sort((x, y) => y.length - x.length)
  for (const k of keys) if (b.includes(k)) return BRAND_TIER[k]
  return null
}

export interface HotelPair {
  /** The chain (HotelRateQuote.provider) */
  provider: GoRatesBrand
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

export interface PairedQuotes {
  pairs: HotelPair[]
  /** Providers whose public quotes were dropped because they matched the private ones */
  publicMatchesPrivate: GoRatesBrand[]
}

/** pairQuotesDetailed().pairs */
export function pairQuotes(quotes: readonly RateQuoteLike[]): HotelPair[] {
  return pairQuotesDetailed(quotes).pairs
}

export function pairQuotesDetailed(quotes: readonly RateQuoteLike[]): PairedQuotes {
  const byKey = new Map<string, { provider: GoRatesBrand; propertyCode: string; priv: RateQuoteLike[]; pub: RateQuoteLike[] }>()
  for (const q of quotes) {
    if (!q.available || !(q.nightlyRate > 0)) continue
    const provider = brandOfProvider(q.provider)
    const key = `${provider}|${q.propertyCode}`
    const entry = byKey.get(key) ?? { provider, propertyCode: q.propertyCode, priv: [], pub: [] }
    if (isPrivateRateKind(q.rateKind)) entry.priv.push(q)
    else if (q.rateKind === "PUBLIC") entry.pub.push(q)
    byKey.set(key, entry)
  }

  const raw: { provider: GoRatesBrand; propertyCode: string; privateQuote: RateQuoteLike; publicQuote: RateQuoteLike | null }[] = []
  for (const { provider, propertyCode, priv, pub } of byKey.values()) {
    if (priv.length === 0) continue
    const privateQuote = priv.reduce((a, b) => (b.totalRate < a.totalRate ? b : a))
    const sameCurrency = pub.filter((p) => (p.currency ?? "USD") === (privateQuote.currency ?? "USD"))
    const publicQuote = sameCurrency.length ? sameCurrency.reduce((a, b) => (b.totalRate < a.totalRate ? b : a)) : null
    raw.push({ provider, propertyCode, privateQuote, publicQuote })
  }

  // A provider whose public search showed the private rate too: its public quotes are not comparables.
  const unreliable: GoRatesBrand[] = []
  for (const provider of ["hilton", "marriott"] as const) {
    const paired = raw
      .filter((r) => r.provider === provider && r.publicQuote)
      .map((r) => ({ privateNightly: r.privateQuote.nightlyRate, publicNightly: r.publicQuote!.nightlyRate }))
    if (publicMatchesPrivate(paired)) unreliable.push(provider)
  }

  const pairs: HotelPair[] = raw.map(({ provider, propertyCode, privateQuote, publicQuote: pq }) => {
    const publicQuote = unreliable.includes(provider) ? null : pq
    const tier = tierFromBrand(privateQuote.brand ?? publicQuote?.brand, privateQuote.tier ?? publicQuote?.tier)
    const savingsTotal = publicQuote ? round(publicQuote.totalRate - privateQuote.totalRate, 2) : null
    const savingsRatio = publicQuote && publicQuote.totalRate > 0 ? round(savingsTotal! / publicQuote.totalRate, 3) : null
    const priceReadsMid = privateQuote.nightlyRate <= MID_TIER_NIGHTLY_CEILING
    const unlockedTier = !priceReadsMid || !tier ? 0 : tier === "LUXURY" ? 1 : tier === "UPSCALE" ? 0.6 : 0
    const savingsPart = savingsRatio == null ? 0 : clamp01(savingsRatio / 0.6)
    const perNightBonus = savingsTotal != null && publicQuote && publicQuote.nightlyRate - privateQuote.nightlyRate >= 150 ? 0.1 : 0
    const value = clamp01(0.55 * unlockedTier + 0.35 * savingsPart + perNightBonus)
    return {
      provider,
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
    }
  })
  pairs.sort((a, b) => b.value - a.value || a.privateQuote.totalRate - b.privateQuote.totalRate)
  return { pairs, publicMatchesPrivate: unreliable }
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
  const { pairs, publicMatchesPrivate: unreliable } = pairQuotesDetailed(input.quotes)
  const usable = input.quotes.filter((q) => q.available && q.nightlyRate > 0)
  const privateQuoteCount = usable.filter((q) => isPrivateRateKind(q.rateKind)).length
  const publicQuoteCount = usable.filter((q) => q.rateKind === "PUBLIC").length
  if (pairs.length === 0) {
    return { ...unavailable("hotelValue", { quoteCount: input.quotes.length, privateQuoteCount, publicQuoteCount }), pair: null }
  }
  const nights = Math.max(1, input.nights)
  // Cheapest private nightly across every property and brand: the "Go rate from" figure.
  const cheapest = pairs.reduce((a, b) => (b.privateQuote.nightlyRate < a.privateQuote.nightlyRate ? b : a))
  const counts = {
    bestPrivateNightly: cheapest.privateQuote.nightlyRate,
    bestPrivateName: displayHotelName(cheapest.propertyName, cheapest.propertyCode),
    bestPrivateCode: cheapest.propertyCode,
    bestPrivateProvider: cheapest.provider,
    privateQuoteCount,
    publicQuoteCount,
    /** Providers whose public search showed the private rate too (comma-separated, "" when none) */
    publicMatchesPrivate: unreliable.join(","),
  }

  // Best deal: a luxury unlock with real savings first, else the largest savings.
  const withSavings = pairs.filter((p) => p.publicQuote && p.savingsTotal != null && p.savingsTotal > 0)
  // No real saving anywhere: informational only, never a savings claim.
  if (withSavings.length === 0) return evaluatePrivateOnly(input, pairs, cheapest, nights, counts)
  const best = withSavings.reduce((a, b) => {
    const lux = (p: HotelPair) => (p.unlockedTier >= 1 ? 1 : 0)
    return lux(b) > lux(a) || (lux(b) === lux(a) && b.savingsTotal! > a.savingsTotal!) ? b : a
  })

  const priv = best.privateQuote
  const pub = best.publicQuote!
  const bestName = displayHotelName(best.propertyName, best.propertyCode)

  let score = best.value
  if (best.tier && input.destinationTier && TIER_RANK[best.tier] > TIER_RANK[input.destinationTier] && best.unlockedTier > 0) {
    score = clamp01(score + 0.1)
  }

  const reasons: OpportunityReason[] = []
  if (best.savingsTotal != null && best.savingsRatio != null) {
    const perNight = pub.nightlyRate - priv.nightlyRate
    const detail = hotelSavingsDetail(bestName, priv.nightlyRate, pub.nightlyRate, best.provider)
    if (best.savingsRatio >= 0.6 || perNight >= 150) {
      reasons.push(reason("hotelValue", "POSITIVE", hotelSavingsHeadline(best.savingsTotal), 0.5 + best.savingsRatio + best.unlockedTier * 0.5, detail))
    } else if (best.savingsRatio >= 0.25) {
      reasons.push(reason("hotelValue", "POSITIVE", `${pct(best.savingsRatio)} off at ${bestName}`, 0.3 + best.savingsRatio, detail))
    }
  }
  if (best.unlockedTier >= 1) {
    reasons.push(reason("hotelValue", "POSITIVE", "Luxury stay at a mid-tier price", 0.9, `${bestName}, ${money(priv.nightlyRate)}/night ${privateRateNote(best.provider)}`))
  } else if (best.unlockedTier > 0 && !reasons.length) {
    reasons.push(reason("hotelValue", "POSITIVE", "Upscale stay at a mid-tier price", 0.5, `${bestName}, ${money(priv.nightlyRate)}/night ${privateRateNote(best.provider)}`))
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
    /** The chain: "hilton" | "marriott" */
    provider: p.provider,
    rateKind: priv.rateKind,
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
 * No real saving: the factor is available and reports the cheapest private
 * rate as information ("Go rate from $207/night at …", "F&F rate from …"). No
 * public comparable is invented, so there is no savings headline.
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
  const oneChain = pairs.every((p) => p.provider === cheapest.provider)
  const chainWord = oneChain ? (cheapest.provider === "marriott" ? "Marriott " : "Hilton ") : ""
  const reasons: OpportunityReason[] = [
    reason(
      "hotelValue",
      "POSITIVE",
      privateRateHeadline(cheapest.provider, priv.nightlyRate, name, priv.currency ?? "USD"),
      0.3,
      others > 0
        ? `${privateRateNote(cheapest.provider, true)}; ${others} more ${chainWord}${others === 1 ? "hotel" : "hotels"} priced nearby`
        : privateRateNote(cheapest.provider, true)
    ),
  ]
  if (unlocked.unlockedTier >= 1) {
    const uName = displayHotelName(unlocked.propertyName, unlocked.propertyCode)
    reasons.push(
      reason("hotelValue", "POSITIVE", "Luxury stay at a mid-tier price", 0.6, `${uName}, ${money(unlocked.privateQuote.nightlyRate)}/night ${privateRateNote(unlocked.provider)}`)
    )
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
