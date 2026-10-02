import { describe, it, expect } from "vitest"
import { assembleCoreTripCost, estimateGroundTransport, estimateMajorActivity, hotelStayTotal, weakestSource } from "@/lib/opportunities/cost-estimates"
import { DEFAULT_OUTLIER_THRESHOLDS, detectDateArbitrage, detectOutliers } from "@/lib/opportunities/outliers"
import { mergeReasons, orderReasons } from "@/lib/opportunities/reason-text"
import { computePenalties, rankCandidates, scoreCandidate } from "@/lib/opportunities/scoring"
import type { CandidateFactors, FactorKind, FactorResult, FactorSource } from "@/lib/opportunities/types"

function f(kind: FactorKind, score: number | null, over: Partial<FactorResult> = {}): FactorResult {
  return { kind, available: score != null, score, source: over.source ?? "ESTIMATED", facts: over.facts ?? {}, reasons: over.reasons ?? [] }
}

describe("scoreCandidate / rankCandidates", () => {
  it("implements max + 0.3 × mean(others) − penalties with argmax as headline", () => {
    const factors: CandidateFactors = {
      hotelValue: f("hotelValue", 0.95, { source: "RETRIEVED" }),
      weather: f("weather", 0.5),
      familyFit: f("familyFit", 0.5),
      airfare: f("airfare", null), // unavailable: ignored
    }
    const r = scoreCandidate({ id: "a", factors })
    expect(r.headlineFactor).toBe("hotelValue")
    expect(r.score).toBeCloseTo(0.95 + 0.3 * 0.5, 4)
    expect(r.scoredFactors).toEqual(["hotelValue", "weather", "familyFit"])
    expect(r.penalties).toEqual([])
  })

  it("lets one dominant factor beat a uniformly decent candidate", () => {
    const hotelOnly: CandidateFactors = { hotelValue: f("hotelValue", 0.95), weather: f("weather", 0.4), familyFit: f("familyFit", 0.4), doorToDoor: f("doorToDoor", 0.4) }
    const allOkay: CandidateFactors = { hotelValue: f("hotelValue", 0.65), weather: f("weather", 0.65), familyFit: f("familyFit", 0.65), doorToDoor: f("doorToDoor", 0.65) }
    const ranked = rankCandidates([{ id: "okay", factors: allOkay }, { id: "hotel", factors: hotelOnly }])
    expect(ranked[0].id).toBe("hotel")
    expect(ranked[0].headlineFactor).toBe("hotelValue")
  })

  it("applies the three hard-negative penalties and nothing else", () => {
    const factors: CandidateFactors = {
      nonstop: f("nonstop", 0.3, { facts: { nonstopFound: false } }),
      anchor: f("anchor", 0.75, { facts: { weatherDependent: true } }),
      weather: f("weather", 0.15, { reasons: [{ factor: "weather", headline: "Likely wet", magnitude: 0.7, polarity: "NEGATIVE" }] }),
      doorToDoor: f("doorToDoor", 0.2, { facts: { doorToDoorMins: 600 } }),
      groundFriction: f("groundFriction", 0.4, { reasons: [{ factor: "groundFriction", headline: "Car needed", magnitude: 0.3, polarity: "NEGATIVE" }] }),
    }
    const p = computePenalties({ id: "x", factors, constraints: { nonstopOnly: true }, maxDoorToDoorMins: 480 })
    expect(p.kinds).toEqual(["nonstopViolated", "weatherOnWeatherDependentAnchor", "doorToDoorOverCeiling"])
    expect(p.total).toBeCloseTo(1.1, 4)
    // Without the constraint and ceiling, only the weather penalty remains.
    expect(computePenalties({ id: "x", factors }).kinds).toEqual(["weatherOnWeatherDependentAnchor"])
    const r = scoreCandidate({ id: "x", factors, constraints: { nonstopOnly: true }, maxDoorToDoorMins: 480 })
    expect(r.score).toBeCloseTo(0.75 + 0.3 * ((0.3 + 0.15 + 0.2 + 0.4) / 4) - 1.1, 4)
  })

  it("handles a candidate with no scored factors and breaks ties by id", () => {
    const r = rankCandidates([{ id: "b", factors: {} }, { id: "a", factors: {} }])
    expect(r.map((x) => x.id)).toEqual(["a", "b"])
    expect(r[0].headlineFactor).toBeNull()
    expect(r[0].score).toBe(0)
  })
})

describe("detectOutliers", () => {
  const ctx = { shortlistCoreCosts: [1800, 2100, 2400, 3000, 3600, 4200], now: new Date("2026-09-27T00:00:00Z") }
  const base = { id: "c1", destinationIata: "MCO", destinationName: "Orlando", checkIn: "2026-11-12", nights: 3, travelerCount: 6, destinationTier: "MID" as const, coreTripCost: 2140 }

  it("fires the hotel rule at ≥60% or ≥$150/night with the same headline the factor uses", () => {
    const hotel = f("hotelValue", 0.9, {
      source: "RETRIEVED",
      facts: { hotelName: "Conrad Orlando", savingsTotal: 2538, savingsRatio: 0.915, privateNightlyRate: 79, comparablePublicRate: 925, unlockedTier: 1 },
      reasons: [{ factor: "hotelValue", headline: "$2,538 hotel savings", detail: "Conrad Orlando, private $79 vs public $925/night", magnitude: 1.9, polarity: "POSITIVE" }],
    })
    const out = detectOutliers({ ...base, factors: { hotelValue: hotel } }, ctx)
    expect(out.map((r) => r.headline)).toEqual(["$2,538 hotel savings"])
    // Merging with the factor's own reasons does not duplicate it.
    expect(mergeReasons(out, hotel.reasons)).toHaveLength(1)
    const small = f("hotelValue", 0.4, { facts: { hotelName: "Hampton", savingsTotal: 90, savingsRatio: 0.2, privateNightlyRate: 120, comparablePublicRate: 150 } })
    expect(detectOutliers({ ...base, factors: { hotelValue: small } }, ctx)).toEqual([])
    // Per-night threshold alone.
    const perNight = f("hotelValue", 0.5, { facts: { hotelName: "H", savingsTotal: 480, savingsRatio: 0.4, privateNightlyRate: 240, comparablePublicRate: 400 } })
    expect(detectOutliers({ ...base, factors: { hotelValue: perNight } }, ctx)).toHaveLength(1)
  })

  it("fires the airfare rule at 35% under a baseline and honours a custom threshold", () => {
    const airfare = f("airfare", 0.85, { facts: { partyTotal: 1260, currency: "USD", underOtherDates: 0.37, underRouteHistory: 0.1 } })
    const out = detectOutliers({ ...base, factors: { airfare } }, ctx)
    expect(out[0].headline).toBe("$1,260 airfare for six")
    expect(out[0].detail).toBe("37% under the other dates in this search")
    expect(detectOutliers({ ...base, factors: { airfare } }, ctx, { ...DEFAULT_OUTLIER_THRESHOLDS, airfareUnderRatio: 0.5 })).toEqual([])
  })

  it("fires the premium-destination rule by rank, only for LUXURY", () => {
    const out = detectOutliers({ ...base, destinationTier: "LUXURY", coreTripCost: 2000, factors: {} }, ctx)
    expect(out[0].headline).toBe("Orlando at a bargain price")
    expect(detectOutliers({ ...base, destinationTier: "LUXURY", coreTripCost: 3500, factors: {} }, ctx)).toEqual([])
    expect(detectOutliers({ ...base, destinationTier: "MID", coreTripCost: 1800, factors: {} }, ctx)).toEqual([])
  })

  it("fires the logistics rule for a newly observed nonstop or daily service where you usually connect", () => {
    const nonstop = f("nonstop", 0.8, { facts: { nonstopFound: true } })
    const fresh = detectOutliers({ ...base, factors: { nonstop }, route: { source: "OBSERVED_OFFER", lastVerifiedAt: "2026-09-20T00:00:00Z", weeklyFrequency: 7 } }, ctx)
    expect(fresh[0].headline).toBe("New nonstop on this route")
    const stale = detectOutliers({ ...base, factors: { nonstop }, route: { source: "OBSERVED_OFFER", lastVerifiedAt: "2026-01-01T00:00:00Z", weeklyFrequency: 3 } }, ctx)
    expect(stale).toEqual([])
    const daily = detectOutliers({ ...base, factors: { nonstop }, route: { source: "OPENFLIGHTS_SEED", weeklyFrequency: 14 }, usuallyConnecting: true }, ctx)
    expect(daily[0].headline).toBe("Daily nonstop where you usually connect")
  })

  it("fires the conjunction rule only with an event on the dates AND a hotel reason", () => {
    const anchor = f("anchor", 0.9, { source: "RETRIEVED", facts: { anchorTitle: "Magic vs Celtics", eventCount: 1 } })
    const hotel = f("hotelValue", 0.9, {
      facts: { hotelName: "Conrad Orlando", savingsTotal: 2538, savingsRatio: 0.9, privateNightlyRate: 79, comparablePublicRate: 925, unlockedTier: 1 },
      reasons: [{ factor: "hotelValue", headline: "$2,538 hotel savings", magnitude: 1.9, polarity: "POSITIVE" }],
    })
    const out = detectOutliers({ ...base, factors: { anchor, hotelValue: hotel } }, ctx)
    expect(out.map((r) => r.headline)).toContain("Magic vs Celtics plus a hotel deal")
    // A bare Go-rate line (no public comparable) is information, not a deal.
    const goOnly = f("hotelValue", 0.35, {
      source: "RETRIEVED",
      facts: { hotelName: "Hilton Chicago", privateNightlyRate: 207, comparablePublicRate: "", savingsTotal: "", savingsRatio: "" },
      reasons: [{ factor: "hotelValue", headline: "Go rate from $207/night at Hilton Chicago", magnitude: 0.3, polarity: "POSITIVE" }],
    })
    expect(detectOutliers({ ...base, factors: { anchor, hotelValue: goOnly } }, ctx).some((r) => r.headline.includes("plus a hotel deal"))).toBe(false)
    const seasonalOnly = f("anchor", 0.75, { facts: { anchorTitle: "Festival", eventCount: 0 } })
    expect(detectOutliers({ ...base, factors: { anchor: seasonalOnly, hotelValue: hotel } }, ctx).some((r) => r.headline.includes("plus a hotel deal"))).toBe(false)
  })
})

describe("detectDateArbitrage", () => {
  it("emits 'Thursday departure saves $X vs Friday' on the cheapest date for the same destination", () => {
    const out = detectDateArbitrage([
      { id: "thu", destinationIata: "MCO", checkIn: "2026-11-12", airfareTotal: 1260 },
      { id: "fri", destinationIata: "MCO", checkIn: "2026-11-13", airfareTotal: 1900 },
      { id: "sat", destinationIata: "MCO", checkIn: "2026-11-21", airfareTotal: 1500 },
      { id: "las", destinationIata: "LAS", checkIn: "2026-11-12", airfareTotal: 2000 },
      { id: "las2", destinationIata: "LAS", checkIn: "2026-11-19", airfareTotal: null },
    ])
    expect(out.size).toBe(1)
    const r = out.get("thu")!
    expect(r.headline).toBe("Thursday departure saves $640 in airfare vs Friday")
    expect(r.detail).toBe("$1,260 vs $1,900 (34% less)")
    expect(r.factor).toBe("airfare")
    expect(r.polarity).toBe("POSITIVE")
  })
  it("stays quiet under the minimum saving or ratio", () => {
    const out = detectDateArbitrage([
      { id: "a", destinationIata: "MCO", checkIn: "2026-11-12", airfareTotal: 1900 },
      { id: "b", destinationIata: "MCO", checkIn: "2026-11-13", airfareTotal: 1980 },
    ])
    expect(out.size).toBe(0)
  })
})

describe("reason ordering and merging", () => {
  it("puts POSITIVE by magnitude first, then NEGATIVE, and dedupes on factor+polarity+headline", () => {
    const list = orderReasons(
      mergeReasons(
        [
          { factor: "weather", headline: "Good weather", magnitude: 0.4, polarity: "POSITIVE" },
          { factor: "groundFriction", headline: "Car needed", magnitude: 0.3, polarity: "NEGATIVE" },
          { factor: "hotelValue", headline: "$2,538 hotel savings", magnitude: 1.9, polarity: "POSITIVE" },
        ],
        [{ factor: "hotelValue", headline: "$2,538 hotel savings", magnitude: 1.5, polarity: "POSITIVE" }]
      )
    )
    expect(list.map((r) => r.headline)).toEqual(["$2,538 hotel savings", "Good weather", "Car needed"])
  })
})

describe("cost estimates", () => {
  const profile = { walkable: false, carNeeded: true, parkingTypical: "EXPENSIVE" as const, activitiesDispersed: true, airportToCenterKm: 25 }
  it("uses the tier table, labelled ESTIMATED, and switches to a minivan for six", () => {
    const four = estimateGroundTransport(profile, 3, 4)
    const six = estimateGroundTransport(profile, 3, 6)
    expect(four).toEqual({ total: 75 * 3 + 40 * 3, label: "rental car", source: "ESTIMATED" })
    expect(six.label).toBe("minivan rental")
    expect(six.total).toBeGreaterThan(four.total)
    expect(estimateGroundTransport(profile, 3, 4, "DRIVE").label).toBe("own car + parking")
    const walk = estimateGroundTransport({ ...profile, walkable: true, carNeeded: false, activitiesDispersed: false, airportToCenterKm: 5 }, 3, 2)
    expect(walk.label).toBe("transit + occasional ride")
  })
  it("prices the anchor by its raw kind and the paying party", () => {
    expect(estimateMajorActivity({ kind: "OTHER", rawKind: "THEME_PARK" }, [41, 39, 12, 9, 7, 2], 3).total).toBe(150 * 5)
    expect(estimateMajorActivity({ kind: "NATURAL", rawKind: "NATURE" }, [41, 39], 6).total).toBe(15 * 2 * 2)
    expect(estimateMajorActivity(null, [41], 3).total).toBe(0)
  })
  it("labels the core cost by its weakest addend", () => {
    expect(weakestSource(["RETRIEVED", "RETRIEVED"])).toBe("RETRIEVED")
    expect(weakestSource(["RETRIEVED", "ESTIMATED"])).toBe("ESTIMATED")
    expect(weakestSource(["HISTORICAL", "UNKNOWN"])).toBe("UNKNOWN")
    const full = assembleCoreTripCost({ airfareTotal: 1260, airfareSource: "RETRIEVED", hotelTotal: 237, hotelSource: "RETRIEVED", groundTransportEstimate: 340, majorActivityEstimate: 300 })
    expect(full).toEqual({ total: 2137, source: "ESTIMATED" })
    const noHotel = assembleCoreTripCost({ airfareTotal: 1260, airfareSource: "RETRIEVED", hotelTotal: null, hotelSource: "UNKNOWN" as FactorSource, groundTransportEstimate: 340, majorActivityEstimate: 300 })
    expect(noHotel.source).toBe("UNKNOWN")
    expect(noHotel.total).toBe(1900)
    expect(assembleCoreTripCost({ airfareTotal: null, airfareSource: "UNKNOWN", hotelTotal: null, hotelSource: "UNKNOWN", groundTransportEstimate: 340, majorActivityEstimate: 300 }).total).toBeNull()
    // Go-only hotel: nightly × nights, RETRIEVED; never from a public rate.
    expect(hotelStayTotal({ privateNightlyRate: 207, privateTotal: 700, comparablePublicRate: "" }, 3)).toBe(621)
    expect(hotelStayTotal({ privateNightlyRate: "", privateTotal: 640 }, 3)).toBe(640)
    expect(hotelStayTotal({ comparablePublicRate: 300 }, 3)).toBeNull()
    const goOnly = assembleCoreTripCost({ airfareTotal: 1260, airfareSource: "RETRIEVED", hotelTotal: hotelStayTotal({ privateNightlyRate: 207 }, 3), hotelSource: "RETRIEVED", groundTransportEstimate: 340, majorActivityEstimate: 300 })
    expect(goOnly.total).toBe(1260 + 621 + 340 + 300)
  })
})
