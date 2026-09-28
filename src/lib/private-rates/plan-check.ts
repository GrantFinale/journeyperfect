/**
 * PURE. The decision logic behind `checkPrivateRatesForSearch`, kept free of
 * Prisma and the runner so it can be unit-tested with a fake BrowserRunner.
 * See docs/plans/opportunity-discovery-engine.md §6.
 *
 * Three pieces:
 *   planRateChecks(candidates, caps)  which (destination, dates) groups to price
 *                                     and how many properties each may use
 *   applyRunnerOutcome(progress, r)   fold one runner result into the progress
 *                                     record and decide whether to halt
 *   runPlannedChecks(...)             the loop: one runner task per group, stop
 *                                     at the first challenge, never retry
 *
 * Rules encoded here:
 *   - Searches run only on an explicit user click; nothing here schedules or
 *     polls Hilton. A "check" is one click.
 *   - No retries after CHALLENGE or SIGNED_OUT. The loop halts at once and
 *     hands control back to the user; quotes already written are kept.
 *   - The daily cap and the per-check property cap are hard bounds, not hints.
 *   - The kill switch is re-read between groups so flipping it off stops a run
 *     in progress at its next checkpoint (§6.2).
 */
import type { ChallengeKind, RateObservation, RunnerFailureStatus, RunnerResult } from "./types"

/** The subset of OpportunityCandidate the planner needs. Dates are YYYY-MM-DD. */
export interface PlanCandidate {
  id: string
  destinationIata: string
  destinationName: string
  destinationLat: number
  destinationLng: number
  checkIn: string
  checkOut: string
  stage: number
  pruned: boolean
  score?: number | null
}

export interface PlanCaps {
  /** privateRates.maxPropertiesPerCheck: total properties across all groups. */
  maxPropertiesPerCheck: number
  /** privateRates.maxChecksPerDay minus CHECK_RATES audit rows today. */
  checksRemainingToday: number
}

/** One runner task: a destination and a date window, with its property budget. */
export interface RateCheckGroup {
  key: string
  location: string
  iata: string
  lat: number
  lng: number
  checkIn: string
  checkOut: string
  candidateIds: string[]
  maxProperties: number
}

export type PlanSkipReason = "LIMIT" | "NO_CANDIDATES"

export interface RateCheckPlan {
  groups: RateCheckGroup[]
  /** Set when no groups could be planned. */
  skipped?: PlanSkipReason
  /** The stage threshold actually used (2 preferred, 1 as fallback). */
  stageUsed: 2 | 1 | null
}

export const PREFERRED_STAGE = 2
export const FALLBACK_STAGE = 1

/**
 * Select un-pruned candidates with stage >= 2 (falling back to >= 1 when none
 * have reached stage 2), group them by (destination, checkIn, checkOut), and
 * spread the per-check property budget across the groups. Groups are ordered
 * by best candidate score so the strongest opportunities get priced first;
 * groups that cannot get at least one property are dropped.
 */
export function planRateChecks(candidates: readonly PlanCandidate[], caps: PlanCaps): RateCheckPlan {
  if (caps.checksRemainingToday <= 0) return { groups: [], skipped: "LIMIT", stageUsed: null }
  const budget = Math.max(0, Math.floor(caps.maxPropertiesPerCheck))
  if (budget === 0) return { groups: [], skipped: "LIMIT", stageUsed: null }

  const live = candidates.filter((c) => !c.pruned)
  let stageUsed: 2 | 1 | null = PREFERRED_STAGE
  let eligible = live.filter((c) => c.stage >= PREFERRED_STAGE)
  if (eligible.length === 0) {
    stageUsed = FALLBACK_STAGE
    eligible = live.filter((c) => c.stage >= FALLBACK_STAGE)
  }
  if (eligible.length === 0) return { groups: [], skipped: "NO_CANDIDATES", stageUsed: null }

  // Group by (destination, checkIn, checkOut); remember the best score per group.
  const groups = new Map<string, RateCheckGroup & { bestScore: number }>()
  for (const c of eligible) {
    const key = `${c.destinationIata}|${c.checkIn}|${c.checkOut}`
    const score = typeof c.score === "number" && Number.isFinite(c.score) ? c.score : -Infinity
    const existing = groups.get(key)
    if (existing) {
      existing.candidateIds.push(c.id)
      if (score > existing.bestScore) existing.bestScore = score
      continue
    }
    groups.set(key, {
      key,
      location: c.destinationName,
      iata: c.destinationIata,
      lat: c.destinationLat,
      lng: c.destinationLng,
      checkIn: c.checkIn,
      checkOut: c.checkOut,
      candidateIds: [c.id],
      maxProperties: 0,
      bestScore: score,
    })
  }

  // Best score first; ties keep insertion (pipeline) order. Map preserves insertion order.
  const ordered = [...groups.values()].sort((a, b) => b.bestScore - a.bestScore).slice(0, budget)

  // Spread the budget: floor(budget / n) each, remainder to the earlier groups.
  const n = ordered.length
  const base = Math.floor(budget / n)
  let remainder = budget - base * n
  const planned: RateCheckGroup[] = ordered.map((g) => {
    const extra = remainder > 0 ? 1 : 0
    remainder -= extra
    return {
      key: g.key,
      location: g.location,
      iata: g.iata,
      lat: g.lat,
      lng: g.lng,
      checkIn: g.checkIn,
      checkOut: g.checkOut,
      candidateIds: g.candidateIds,
      maxProperties: base + extra,
    }
  })

  return { groups: planned, stageUsed }
}

/** Why a run stopped before finishing every group. */
export type StopReason =
  | { kind: "FAILURE"; status: RunnerFailureStatus; challengeKind?: ChallengeKind }
  | { kind: "DISABLED" }

export interface CheckProgress {
  groupsPlanned: number
  groupsAttempted: number
  groupsSucceeded: number
  quotesWritten: number
  /** Groups that failed non-fatally (TIMEOUT / PARSE_FAILED) and were skipped. */
  groupsSkipped: number
  stopped: StopReason | null
}

export function initialProgress(groupsPlanned: number): CheckProgress {
  return { groupsPlanned, groupsAttempted: 0, groupsSucceeded: 0, quotesWritten: 0, groupsSkipped: 0, stopped: null }
}

/** Failures that end the whole run. A challenge is never retried; an unreachable runner is not hammered. */
const HALTING: ReadonlySet<RunnerFailureStatus> = new Set<RunnerFailureStatus>([
  "CHALLENGE",
  "SIGNED_OUT",
  "RUNNER_UNAVAILABLE",
])

export interface OutcomeApplication {
  progress: CheckProgress
  /** Observations to persist for this group (may be partial on failure). */
  observations: RateObservation[]
  /** True when the loop must stop before the next group. */
  halt: boolean
}

/**
 * Fold one group's runner result into the progress record.
 *   ok                      → write data, continue
 *   CHALLENGE / SIGNED_OUT  → write any partial data, halt (no retry)
 *   RUNNER_UNAVAILABLE      → halt (the service is down; do not keep calling it)
 *   TIMEOUT / PARSE_FAILED  → write any partial data, skip this group, continue
 * Does not count `quotesWritten`; the caller reports that via `recordWritten`
 * once the rows actually exist.
 */
export function applyRunnerOutcome(
  progress: CheckProgress,
  result: RunnerResult<RateObservation[]>,
): OutcomeApplication {
  const attempted = progress.groupsAttempted + 1
  if (result.ok) {
    return {
      progress: { ...progress, groupsAttempted: attempted, groupsSucceeded: progress.groupsSucceeded + 1 },
      observations: result.data,
      halt: false,
    }
  }
  const observations = result.data ?? []
  if (HALTING.has(result.status)) {
    return {
      progress: {
        ...progress,
        groupsAttempted: attempted,
        stopped: { kind: "FAILURE", status: result.status, challengeKind: result.challengeKind },
      },
      observations,
      halt: true,
    }
  }
  return {
    progress: { ...progress, groupsAttempted: attempted, groupsSkipped: progress.groupsSkipped + 1 },
    observations,
    halt: false,
  }
}

export function recordWritten(progress: CheckProgress, count: number): CheckProgress {
  return { ...progress, quotesWritten: progress.quotesWritten + count }
}

export type CheckStatus =
  | "OK"
  | "PARTIAL"
  | "CHALLENGE"
  | "SIGNED_OUT"
  | "DISABLED"
  | "NOT_ENTITLED"
  | "NO_SESSION"
  | "RUNNER_UNAVAILABLE"
  | "LIMIT"

/**
 * Map the final progress record onto the status the UI explains.
 * Anything that stopped early but still wrote quotes is PARTIAL, so the user
 * knows some rates are real and some are missing.
 */
export function finalStatus(progress: CheckProgress): CheckStatus {
  if (progress.stopped) {
    if (progress.quotesWritten > 0) return "PARTIAL"
    if (progress.stopped.kind === "DISABLED") return "DISABLED"
    switch (progress.stopped.status) {
      case "CHALLENGE":
        return "CHALLENGE"
      case "SIGNED_OUT":
        return "SIGNED_OUT"
      default:
        return "RUNNER_UNAVAILABLE"
    }
  }
  if (progress.groupsSkipped > 0) return progress.quotesWritten > 0 ? "PARTIAL" : "RUNNER_UNAVAILABLE"
  return "OK"
}

export interface RunPlannedChecksIO {
  /** Run one group's task on the runner (both rate kinds flattened into one list). */
  execute: (group: RateCheckGroup) => Promise<RunnerResult<RateObservation[]>>
  /** Persist observations for a group; returns the number of rows written. */
  write: (group: RateCheckGroup, observations: RateObservation[]) => Promise<number>
  /** Kill-switch checkpoint, read before every group. Defaults to always true. */
  shouldContinue?: () => Promise<boolean>
}

export interface RunPlannedChecksResult {
  status: CheckStatus
  progress: CheckProgress
}

/**
 * Execute the plan group by group. One runner task per group, in plan order.
 * Stops at the first halting failure or when the kill switch flips off.
 * Never re-runs a group.
 */
export async function runPlannedChecks(groups: readonly RateCheckGroup[], io: RunPlannedChecksIO): Promise<RunPlannedChecksResult> {
  let progress = initialProgress(groups.length)
  for (const group of groups) {
    if (io.shouldContinue && !(await io.shouldContinue())) {
      progress = { ...progress, stopped: { kind: "DISABLED" } }
      break
    }
    const result = await io.execute(group)
    const applied = applyRunnerOutcome(progress, result)
    progress = applied.progress
    if (applied.observations.length > 0) {
      const written = await io.write(group, applied.observations)
      progress = recordWritten(progress, written)
    }
    if (applied.halt) break
  }
  return { status: finalStatus(progress), progress }
}

/** Flatten a CityRatesData-shaped result into a single observation list. */
export function flattenCityRates<T extends { privateRates: RateObservation[]; publicRates: RateObservation[] }>(
  result: RunnerResult<T>,
): RunnerResult<RateObservation[]> {
  if (result.ok) {
    return { ok: true, data: [...result.data.privateRates, ...result.data.publicRates], partial: result.partial }
  }
  return {
    ok: false,
    status: result.status,
    challengeKind: result.challengeKind,
    data: result.data ? [...result.data.privateRates, ...result.data.publicRates] : undefined,
  }
}
