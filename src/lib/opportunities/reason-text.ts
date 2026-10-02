/**
 * Shared headline formatters. Factors and outliers.ts both emit reasons about
 * hotel savings and airfare; using one formatter for each keeps their
 * headlines byte-identical so `mergeReasons` can dedupe them.
 */
import { money, pct } from "./factors/shared"
import type { OpportunityReason } from "./types"

export function hotelSavingsHeadline(savingsTotal: number): string {
  return `${money(savingsTotal)} hotel savings`
}

export function hotelSavingsDetail(hotelName: string, privateNightly: number, publicNightly: number): string {
  return `${hotelName}, private ${money(privateNightly)} vs public ${money(publicNightly)}/night`
}

/** Informational only (no public comparable): never phrased as a saving. */
export const GO_RATE_HEADLINE_PREFIX = "Go rate from "

export function goRateHeadline(nightly: number, hotelName: string, currency = "USD"): string {
  return `${GO_RATE_HEADLINE_PREFIX}${money(nightly, currency)}/night at ${hotelName}`
}

/** A hotelValue reason that only reports a Go rate, as opposed to a deal. */
export function isInformationalHotelReason(headline: string): boolean {
  return headline.startsWith(GO_RATE_HEADLINE_PREFIX)
}

const PARTY_WORDS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]

export function partyWord(count: number): string {
  return PARTY_WORDS[count] ?? String(count)
}

export function airfareHeadline(partyTotal: number, travelerCount: number, currency = "USD"): string {
  return travelerCount > 1
    ? `${money(partyTotal, currency)} airfare for ${partyWord(travelerCount)}`
    : `${money(partyTotal, currency)} airfare`
}

export function airfareUnderDetail(ratioUnder: number, baseline: "other dates" | "route history" | "both"): string {
  const p = pct(ratioUnder)
  if (baseline === "both") return `${p} under the other dates in this search and this route's history`
  if (baseline === "route history") return `${p} under this route's recent fares`
  return `${p} under the other dates in this search`
}

export function reasonKey(r: OpportunityReason): string {
  return `${r.factor}|${r.polarity}|${r.headline}`
}

/** Concatenate reason lists, dropping later duplicates (same factor, polarity and headline). */
export function mergeReasons(...lists: readonly (readonly OpportunityReason[])[]): OpportunityReason[] {
  const seen = new Set<string>()
  const out: OpportunityReason[] = []
  for (const list of lists) {
    for (const r of list) {
      const k = reasonKey(r)
      if (seen.has(k)) continue
      seen.add(k)
      out.push(r)
    }
  }
  return out
}

/** POSITIVE reasons by magnitude desc, then NEGATIVE by magnitude desc. Plan §5. */
export function orderReasons(reasons: readonly OpportunityReason[]): OpportunityReason[] {
  const pos = reasons.filter((r) => r.polarity === "POSITIVE").sort((a, b) => b.magnitude - a.magnitude)
  const neg = reasons.filter((r) => r.polarity === "NEGATIVE").sort((a, b) => b.magnitude - a.magnitude)
  return [...pos, ...neg]
}
