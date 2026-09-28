/**
 * Price judgement helpers. PURE: no Prisma, no config, no I/O, following the
 * trip-tasks.ts convention so client components and Vitest can import them.
 * See docs/plans/flights-search-tracking-and-booking.md §4.2.
 */
import type { PriceInsight, PriceLevel } from "./types"

export interface PriceVerdict {
  level: PriceLevel
  /**
   * Current price minus the midpoint of Google's typical range (negative =
   * cheaper than typical). Absent when no typical range is known.
   */
  deltaFromTypical?: number
  /**
   * Current price minus the lowest price known for this route (from the
   * insight or our own history). Absent when nothing to compare against.
   */
  deltaFromLowest?: number
}

export type AlertReason = "TARGET_HIT" | "NEW_LOW" | "DROP_10PCT"

export interface AlertDecision {
  alert: boolean
  reason: AlertReason | null
}

export interface WatchPriceState {
  /** Notify when the fare is at or below this amount. */
  targetPrice?: number | null
  /** Price observed on the previous check. */
  lastPrice?: number | null
  /** Best price ever observed for this watch. */
  lowestPrice?: number | null
}

/** Relative drop from `lastPrice` that counts as a notable fall. */
export const DROP_ALERT_RATIO = 0.1

function finite(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** True when `current` beats every price seen so far. */
export function isNewLow(current: number, lowestPrice: number | null | undefined): boolean {
  if (!finite(current)) return false
  if (!finite(lowestPrice)) return false
  return current < lowestPrice
}

/**
 * Classify a price. Google's typical range wins when present, because it is
 * computed over far more history than we hold. Otherwise fall back to the
 * provider's own level, then to our history (needs at least three samples),
 * then UNKNOWN.
 */
export function priceVerdict(
  current: number,
  insight: PriceInsight | null | undefined,
  history: number[] = []
): PriceVerdict {
  const verdict: PriceVerdict = { level: "UNKNOWN" }
  if (!finite(current)) return verdict

  const samples = history.filter(finite)

  const lowestCandidates: number[] = []
  if (insight && finite(insight.lowestPrice)) lowestCandidates.push(insight.lowestPrice)
  if (samples.length) lowestCandidates.push(Math.min(...samples))
  if (lowestCandidates.length) {
    verdict.deltaFromLowest = round2(current - Math.min(...lowestCandidates))
  }

  if (insight && finite(insight.typicalLow) && finite(insight.typicalHigh) && insight.typicalHigh >= insight.typicalLow) {
    const mid = (insight.typicalLow + insight.typicalHigh) / 2
    verdict.deltaFromTypical = round2(current - mid)
    if (current < insight.typicalLow) verdict.level = "LOW"
    else if (current > insight.typicalHigh) verdict.level = "HIGH"
    else verdict.level = "TYPICAL"
    return verdict
  }

  if (insight && insight.level && insight.level !== "UNKNOWN") {
    verdict.level = insight.level
    return verdict
  }

  if (samples.length >= 3) {
    const sorted = [...samples].sort((a, b) => a - b)
    const q1 = sorted[Math.floor((sorted.length - 1) * 0.25)]
    const q3 = sorted[Math.ceil((sorted.length - 1) * 0.75)]
    const median = sorted[Math.floor(sorted.length / 2)]
    verdict.deltaFromTypical = round2(current - median)
    if (current < q1) verdict.level = "LOW"
    else if (current > q3) verdict.level = "HIGH"
    else verdict.level = "TYPICAL"
  }

  return verdict
}

/**
 * Decide whether a fresh price should notify the watcher. Reasons in priority
 * order: TARGET_HIT (at or below the user's target), NEW_LOW (below the best
 * ever seen), DROP_10PCT (at least 10% under the previous check).
 *
 * A first-ever check (no lastPrice, no lowestPrice) only alerts on TARGET_HIT;
 * there is nothing to compare against yet.
 */
export function shouldAlert(watch: WatchPriceState, current: number): AlertDecision {
  if (!finite(current)) return { alert: false, reason: null }

  if (finite(watch.targetPrice) && current <= watch.targetPrice) {
    return { alert: true, reason: "TARGET_HIT" }
  }
  if (isNewLow(current, watch.lowestPrice)) {
    return { alert: true, reason: "NEW_LOW" }
  }
  if (finite(watch.lastPrice) && watch.lastPrice > 0 && current <= watch.lastPrice * (1 - DROP_ALERT_RATIO)) {
    return { alert: true, reason: "DROP_10PCT" }
  }
  return { alert: false, reason: null }
}
