/**
 * PURE. The hotel brands the Go Rates extension captures, their rate kinds,
 * and the rules for pairing a private rate with a public comparable.
 *
 *   hilton    Go Hilton (team member) rate   → PRIVATE_HILTON_GO
 *   marriott  Friends & Family rate (MMF)    → PRIVATE_MARRIOTT_FF
 *
 * The brand is also the HotelRateQuote.provider / PrivateRateEntitlement.provider
 * value, so no schema change is needed to add one.
 */
import type { RateKind } from "./types"

export const GO_RATES_BRANDS = ["hilton", "marriott"] as const
export type GoRatesBrand = (typeof GO_RATES_BRANDS)[number]

/** PRIVATE = the brand's private-rate search; PUBLIC = the same search without it. */
export type GoRatesIntent = "PRIVATE" | "PUBLIC"

export function isGoRatesBrand(v: unknown): v is GoRatesBrand {
  return v === "hilton" || v === "marriott"
}

export const BRAND_LABEL: Record<GoRatesBrand, string> = { hilton: "Hilton", marriott: "Marriott" }

/** Short name of each brand's private rate, as the UI shows it ("Go rate", "F&F rate"). */
export const PRIVATE_RATE_SHORT: Record<GoRatesBrand, "Go" | "F&F"> = { hilton: "Go", marriott: "F&F" }

/** "GO" | "FF": the private-rate kind as a stable token for the UI. */
export type RateLabelKind = "GO" | "FF"
export const RATE_LABEL_KIND: Record<GoRatesBrand, RateLabelKind> = { hilton: "GO", marriott: "FF" }

/** Each brand's own site; plan URLs must stay on it. */
export const BRAND_HOST: Record<GoRatesBrand, string> = { hilton: "www.hilton.com", marriott: "www.marriott.com" }

export const PRIVATE_RATE_KIND: Record<GoRatesBrand, Exclude<RateKind, "PUBLIC">> = {
  hilton: "PRIVATE_HILTON_GO",
  marriott: "PRIVATE_MARRIOTT_FF",
}

export function isPrivateRateKind(kind: string | null | undefined): boolean {
  return typeof kind === "string" && kind.startsWith("PRIVATE_")
}

/** The brand a stored provider string belongs to; legacy/unknown rows are Hilton. */
export function brandOfProvider(provider: string | null | undefined): GoRatesBrand {
  return provider === "marriott" ? "marriott" : "hilton"
}

/** A public price within this many dollars of the private one counts as "the same price". */
export const PUBLIC_MATCH_TOLERANCE = 1
/** Share of a group's paired hotels that must match before its public quotes are distrusted. */
export const PUBLIC_MATCH_SHARE = 0.8

/**
 * True when a group's "public" search evidently showed the private rate too
 * (the site kept the signed-in member's rate or the corporate code on the
 * public search): at least PUBLIC_MATCH_SHARE of the paired hotels have a
 * public price within PUBLIC_MATCH_TOLERANCE of the private one. Such public
 * quotes must not be used for savings. False with no pairs.
 */
export function publicMatchesPrivate(pairs: readonly { privateNightly: number; publicNightly: number }[]): boolean {
  if (pairs.length === 0) return false
  const same = pairs.filter((p) => Math.abs(p.publicNightly - p.privateNightly) <= PUBLIC_MATCH_TOLERANCE).length
  return same / pairs.length >= PUBLIC_MATCH_SHARE
}
