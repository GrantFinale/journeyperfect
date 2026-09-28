/**
 * Helpers shared by the pure factor evaluators. No Prisma, no I/O.
 */
import type { FactorFacts, FactorKind, FactorResult, FactorSource, OpportunityReason, ReasonPolarity } from "../types"

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

export function round(n: number, places = 0): number {
  const f = 10 ** places
  return Math.round(n * f) / f
}

/** "$1,260" — whole dollars, US grouping, no cents. */
export function money(n: number, currency = "USD"): string {
  const abs = Math.abs(Math.round(n))
  const grouped = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  const symbol = currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : `${currency} `
  return `${n < 0 ? "-" : ""}${symbol}${grouped}`
}

export function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

export function formatMins(mins: number): string {
  const m = Math.max(0, Math.round(mins))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r > 0 ? `${h}h ${r}m` : `${h}h`
}

export function median(values: readonly number[]): number | null {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
  if (v.length === 0) return null
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

export function mean(values: readonly number[]): number | null {
  const v = values.filter((n) => Number.isFinite(n))
  if (v.length === 0) return null
  return v.reduce((a, b) => a + b, 0) / v.length
}

/** A factor we could not evaluate. Never fabricate: score null, source UNKNOWN. */
export function unavailable(kind: FactorKind, facts: FactorFacts = {}): FactorResult {
  return { kind, available: false, score: null, source: "UNKNOWN", facts, reasons: [] }
}

export function reason(
  factor: FactorKind,
  polarity: ReasonPolarity,
  headline: string,
  magnitude: number,
  detail?: string
): OpportunityReason {
  const r: OpportunityReason = { factor, headline, magnitude: round(Math.max(0, magnitude), 3), polarity }
  if (detail) r.detail = detail
  return r
}

export function result(
  kind: FactorKind,
  score: number,
  source: FactorSource,
  facts: FactorFacts,
  reasons: OpportunityReason[],
  retrievedAt?: string
): FactorResult {
  const r: FactorResult = { kind, available: true, score: round(clamp01(score), 3), source, facts, reasons }
  if (retrievedAt) r.retrievedAt = retrievedAt
  return r
}

/** Join a short list for a detail line: "Spirit + Delta options". */
export function joinNames(names: readonly string[], max = 3): string {
  const list = [...new Set(names.filter(Boolean))]
  if (list.length <= max) return list.join(" + ")
  return `${list.slice(0, max).join(" + ")} +${list.length - max}`
}

/** Sunday..Saturday full names, for "Thursday departure saves..." */
export const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const
