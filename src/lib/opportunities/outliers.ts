/**
 * Outlier detection (stage 4). Plan §5: rules over baselines, not a model, so
 * every flag has a sentence behind it. Pure; thresholds are parameters with
 * the plan's defaults.
 *
 * | Outlier                                   | Baseline                                  | Threshold            |
 * |-------------------------------------------|-------------------------------------------|----------------------|
 * | Hotel dramatically under public           | same property, same dates, public rate    | ≥60% or ≥$150/night  |
 * | Airfare dramatically under other weekends | median across this search's dates         | ≥35% under           |
 * | Premium destination unexpectedly cheap    | LUXURY tier + core cost in bottom third   | rank-based           |
 * | Poor-logistics destination convenient     | route newly observed, or ≥ daily          | presence             |
 * | Special event + favourable hotel          | anchor event on dates ∧ hotel reason      | conjunction          |
 *
 * Flexible-date arbitrage (plan §5, last paragraph) is here too: candidates
 * for the same destination on different dates are compared and the cheaper
 * one gets "Thursday departure saves $640 in airfare versus Friday".
 *
 * Headlines for the first two rules use the same formatters as the factors
 * (reason-text.ts), so `mergeReasons` collapses duplicates.
 */
import { money, pct, reason, WEEKDAY_LONG } from "./factors/shared"
import { weekday } from "./dates"
import { airfareHeadline, airfareUnderDetail, hotelSavingsDetail, hotelSavingsHeadline, isInformationalHotelReason } from "./reason-text"
import type { CandidateFactors, DestinationTier, OpportunityReason } from "./types"

export interface OutlierThresholds {
  hotelSavingsRatio: number
  hotelSavingsPerNight: number
  airfareUnderRatio: number
  /** A route observed (OBSERVED_OFFER) within this many days counts as "newly observed" */
  newlyObservedDays: number
  /** Weekly frequency at or above this is "daily service" */
  dailyFrequency: number
  /** Flexible-date arbitrage: minimum absolute and relative saving */
  dateArbitrageMinSavings: number
  dateArbitrageMinRatio: number
}

export const DEFAULT_OUTLIER_THRESHOLDS: OutlierThresholds = {
  hotelSavingsRatio: 0.6,
  hotelSavingsPerNight: 150,
  airfareUnderRatio: 0.35,
  newlyObservedDays: 30,
  dailyFrequency: 7,
  dateArbitrageMinSavings: 100,
  dateArbitrageMinRatio: 0.15,
}

export interface OutlierCandidate {
  id: string
  destinationIata: string
  destinationName: string
  /** YYYY-MM-DD */
  checkIn: string
  nights: number
  travelerCount: number
  destinationTier: DestinationTier | null
  factors: CandidateFactors
  /** Assembled core trip cost, when known */
  coreTripCost: number | null
  route?: {
    source?: string | null
    weeklyFrequency?: number | null
    lastVerifiedAt?: Date | string | null
  } | null
  /** Editorial flag: this destination usually needs a connection from the user's origin */
  usuallyConnecting?: boolean
}

export interface OutlierContext {
  /** Core trip costs of every shortlisted candidate (for the rank-based rule) */
  shortlistCoreCosts: number[]
  /** For the "newly observed" rule */
  now?: Date
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v)
  return null
}

export function detectOutliers(
  c: OutlierCandidate,
  ctx: OutlierContext,
  t: OutlierThresholds = DEFAULT_OUTLIER_THRESHOLDS
): OpportunityReason[] {
  const out: OpportunityReason[] = []
  const f = c.factors

  // 1. Hotel dramatically under public
  const hotel = f.hotelValue
  if (hotel?.available) {
    const savingsTotal = num(hotel.facts.savingsTotal)
    const savingsRatio = num(hotel.facts.savingsRatio)
    const priv = num(hotel.facts.privateNightlyRate)
    const pub = num(hotel.facts.comparablePublicRate)
    if (savingsTotal != null && savingsRatio != null && priv != null && pub != null) {
      const perNight = pub - priv
      if (savingsRatio >= t.hotelSavingsRatio || perNight >= t.hotelSavingsPerNight) {
        out.push(
          reason(
            "hotelValue",
            "POSITIVE",
            hotelSavingsHeadline(savingsTotal),
            0.5 + savingsRatio + (num(hotel.facts.unlockedTier) ?? 0) * 0.5,
            hotelSavingsDetail(String(hotel.facts.hotelName ?? "Hotel"), priv, pub, typeof hotel.facts.provider === "string" ? hotel.facts.provider : null)
          )
        )
      }
    }
  }

  // 2. Airfare dramatically under the other weekends
  const airfare = f.airfare
  if (airfare?.available) {
    const total = num(airfare.facts.partyTotal)
    const underOther = num(airfare.facts.underOtherDates)
    const underHistory = num(airfare.facts.underRouteHistory)
    const a = underOther != null && underOther >= t.airfareUnderRatio
    const b = underHistory != null && underHistory >= t.airfareUnderRatio
    if (total != null && (a || b)) {
      const which = a && b ? "both" : a ? "other dates" : "route history"
      const ratio = which === "both" ? Math.min(underOther!, underHistory!) : a ? underOther! : underHistory!
      out.push(
        reason(
          "airfare",
          "POSITIVE",
          airfareHeadline(total, c.travelerCount, String(airfare.facts.currency ?? "USD")),
          (which === "both" ? 0.6 : 0.4) + ratio,
          airfareUnderDetail(ratio, which)
        )
      )
    }
  }

  // 3. Premium destination unexpectedly cheap (rank-based)
  if (c.destinationTier === "LUXURY" && c.coreTripCost != null && ctx.shortlistCoreCosts.length >= 3) {
    const sorted = [...ctx.shortlistCoreCosts].filter(Number.isFinite).sort((x, y) => x - y)
    const cutoff = sorted[Math.max(0, Math.ceil(sorted.length / 3) - 1)]
    if (c.coreTripCost <= cutoff) {
      out.push(
        reason(
          "hotelValue",
          "POSITIVE",
          `${c.destinationName} at a bargain price`,
          0.7,
          `Luxury destination; ${money(c.coreTripCost)} core cost is in the cheapest third of this search`
        )
      )
    }
  }

  // 4. Poor-logistics destination suddenly convenient
  const nonstop = f.nonstop
  if (nonstop?.available && c.route) {
    const now = ctx.now ?? new Date()
    const verified = c.route.lastVerifiedAt ? new Date(c.route.lastVerifiedAt) : null
    const ageDays = verified && !Number.isNaN(verified.getTime()) ? (now.getTime() - verified.getTime()) / 86_400_000 : null
    const newlyObserved = c.route.source === "OBSERVED_OFFER" && ageDays != null && ageDays <= t.newlyObservedDays
    const daily = (c.route.weeklyFrequency ?? 0) >= t.dailyFrequency
    if (nonstop.facts.nonstopFound === true && (newlyObserved || (c.usuallyConnecting && daily))) {
      out.push(
        reason(
          "nonstop",
          "POSITIVE",
          newlyObserved ? "New nonstop on this route" : "Daily nonstop where you usually connect",
          0.6,
          newlyObserved ? "First seen in the last month" : `${c.route.weeklyFrequency} flights a week`
        )
      )
    }
  }

  // 5. Special event + favourable hotel (conjunction)
  const anchor = f.anchor
  // A bare "Go rate from $X" line is information, not a deal: it does not count.
  const hotelReason =
    hotel?.available &&
    (hotel.reasons.some((r) => r.polarity === "POSITIVE" && !isInformationalHotelReason(r.headline)) || out.some((r) => r.factor === "hotelValue"))
  if (anchor?.available && (num(anchor.facts.eventCount) ?? 0) > 0 && hotelReason) {
    out.push(
      reason(
        "anchor",
        "POSITIVE",
        `${anchor.facts.anchorTitle} plus a hotel deal`,
        0.8,
        "An event on your dates and a private rate at the same time is rare"
      )
    )
  }

  return out
}

// ─── Flexible-date arbitrage ─────────────────────────────────────────────────

export interface DateArbitrageCandidate {
  id: string
  destinationIata: string
  /** YYYY-MM-DD */
  checkIn: string
  /** Best party airfare total for these dates, or null when unknown */
  airfareTotal: number | null
}

/**
 * For each destination with ≥2 priced date candidates, attach to the cheapest
 * a reason comparing it with the most expensive: "Thursday departure saves
 * $640 in airfare versus Friday". Returns a map candidateId -> reason.
 */
export function detectDateArbitrage(
  candidates: readonly DateArbitrageCandidate[],
  t: Pick<OutlierThresholds, "dateArbitrageMinSavings" | "dateArbitrageMinRatio"> = DEFAULT_OUTLIER_THRESHOLDS
): Map<string, OpportunityReason> {
  const byDest = new Map<string, DateArbitrageCandidate[]>()
  for (const c of candidates) {
    if (c.airfareTotal == null || !Number.isFinite(c.airfareTotal)) continue
    const list = byDest.get(c.destinationIata) ?? []
    list.push(c)
    byDest.set(c.destinationIata, list)
  }

  const out = new Map<string, OpportunityReason>()
  for (const list of byDest.values()) {
    if (list.length < 2) continue
    const sorted = [...list].sort((a, b) => a.airfareTotal! - b.airfareTotal!)
    const cheapest = sorted[0]
    const dearest = sorted[sorted.length - 1]
    const savings = dearest.airfareTotal! - cheapest.airfareTotal!
    const ratio = dearest.airfareTotal! > 0 ? savings / dearest.airfareTotal! : 0
    if (savings < t.dateArbitrageMinSavings || ratio < t.dateArbitrageMinRatio) continue

    const cheapDay = WEEKDAY_LONG[weekday(cheapest.checkIn)]
    const dearDay = WEEKDAY_LONG[weekday(dearest.checkIn)]
    const sameDay = cheapDay === dearDay
    out.set(
      cheapest.id,
      reason(
        "airfare",
        "POSITIVE",
        sameDay
          ? `${cheapest.checkIn} saves ${money(savings)} in airfare vs ${dearest.checkIn}`
          : `${cheapDay} departure saves ${money(savings)} in airfare vs ${dearDay}`,
        0.3 + ratio,
        `${money(cheapest.airfareTotal!)} vs ${money(dearest.airfareTotal!)} (${pct(ratio)} less)`
      )
    )
  }
  return out
}
