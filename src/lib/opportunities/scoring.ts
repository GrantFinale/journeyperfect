/**
 * Ranking (stage 4). Plan §5. Pure.
 *
 *   score = max(factorScores) + 0.3 × mean(otherAvailableFactorScores) − penalties
 *   headlineFactor = argmax(factorScores)
 *
 * Deliberately not an average, so one factor may dominate: "worth considering
 * primarily because of the hotel" when everything else is ordinary. Penalties
 * are for hard negatives only: no nonstop when the user required one, a
 * NEGATIVE weather reason on a weather-dependent anchor, and door-to-door over
 * the user's ceiling. Scores are never shown; reasons are.
 */
import { mean, round } from "./factors/shared"
import type { CandidateFactors, FactorKind, SearchConstraints } from "./types"

export const OTHERS_WEIGHT = 0.3

export interface ScoringPenalties {
  nonstopViolated: number
  weatherOnWeatherDependentAnchor: number
  doorToDoorOverCeiling: number
}

export const DEFAULT_PENALTIES: ScoringPenalties = {
  nonstopViolated: 0.5,
  weatherOnWeatherDependentAnchor: 0.3,
  doorToDoorOverCeiling: 0.3,
}

export interface ScoringInput {
  id: string
  factors: CandidateFactors
  constraints?: SearchConstraints | null
  /** From UserPreferences / constraints; null = no ceiling */
  maxDoorToDoorMins?: number | null
}

export type PenaltyKind = keyof ScoringPenalties

export interface RankedCandidate {
  id: string
  score: number
  headlineFactor: FactorKind | null
  /** Factor kinds that had a score */
  scoredFactors: FactorKind[]
  penalties: PenaltyKind[]
  penaltyTotal: number
}

/** Factor kinds with an available numeric score, in a stable order. */
export function availableScores(factors: CandidateFactors): { kind: FactorKind; score: number }[] {
  const out: { kind: FactorKind; score: number }[] = []
  for (const [kind, f] of Object.entries(factors) as [FactorKind, CandidateFactors[FactorKind]][]) {
    if (f && f.available && typeof f.score === "number" && Number.isFinite(f.score)) out.push({ kind, score: f.score })
  }
  return out
}

export function computePenalties(input: ScoringInput, weights: ScoringPenalties = DEFAULT_PENALTIES): { kinds: PenaltyKind[]; total: number } {
  const kinds: PenaltyKind[] = []
  const f = input.factors
  const c = input.constraints ?? {}

  if (c.nonstopOnly && f.nonstop?.available && f.nonstop.facts.nonstopFound === false) kinds.push("nonstopViolated")

  const weatherDependent = f.anchor?.available && f.anchor.facts.weatherDependent === true
  const weatherNegative = f.weather?.available && f.weather.reasons.some((r) => r.polarity === "NEGATIVE")
  if (weatherDependent && weatherNegative) kinds.push("weatherOnWeatherDependentAnchor")

  const d2d = f.doorToDoor?.available ? Number(f.doorToDoor.facts.doorToDoorMins) : NaN
  if (input.maxDoorToDoorMins != null && Number.isFinite(d2d) && d2d > input.maxDoorToDoorMins) kinds.push("doorToDoorOverCeiling")

  return { kinds, total: kinds.reduce((sum, k) => sum + weights[k], 0) }
}

export function scoreCandidate(input: ScoringInput, weights: ScoringPenalties = DEFAULT_PENALTIES): RankedCandidate {
  const scored = availableScores(input.factors)
  const { kinds, total } = computePenalties(input, weights)
  if (scored.length === 0) {
    return { id: input.id, score: total === 0 ? 0 : round(-total, 4), headlineFactor: null, scoredFactors: [], penalties: kinds, penaltyTotal: total }
  }
  // Stable argmax: first max wins, in factor insertion order.
  let top = scored[0]
  for (const s of scored) if (s.score > top.score) top = s
  const others = scored.filter((s) => s !== top).map((s) => s.score)
  const othersMean = mean(others) ?? 0
  const score = top.score + OTHERS_WEIGHT * othersMean - total
  return {
    id: input.id,
    score: round(score, 4),
    headlineFactor: top.kind,
    scoredFactors: scored.map((s) => s.kind),
    penalties: kinds,
    penaltyTotal: total,
  }
}

/** Score every candidate and return them best-first; ties broken by id for determinism. */
export function rankCandidates(inputs: readonly ScoringInput[], weights: ScoringPenalties = DEFAULT_PENALTIES): RankedCandidate[] {
  return inputs.map((i) => scoreCandidate(i, weights)).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
}
