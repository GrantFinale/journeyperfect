import { describe, it, expect } from "vitest"
import type { DayForecast } from "@/lib/weather"
import type { FlightOfferResult } from "@/lib/flights/types"
import type { NormalisedFamilyFit, ProfileAnchor } from "@/lib/opportunities/destinations"
import { anchorExperienceFromFacts, evaluateAnchor } from "@/lib/opportunities/factors/anchor"
import { estimateDoorToDoor, evaluateDoorToDoor, transportationFromFacts } from "@/lib/opportunities/factors/door-to-door"
import { ageBand, evaluateFamilyFit } from "@/lib/opportunities/factors/family-fit"
import { evaluateGroundFriction } from "@/lib/opportunities/factors/ground-friction"
import { evaluateHotelValue, pairQuotes, tierFromBrand, type RateQuoteLike } from "@/lib/opportunities/factors/hotel-value"
import { evaluateNonstopAirfare, pickBestOffer } from "@/lib/opportunities/factors/nonstop-airfare"
import { evaluateTripLengthFit } from "@/lib/opportunities/factors/trip-length-fit"
import { evaluateWeather, outdoorSuitability, weatherContextFromFacts } from "@/lib/opportunities/factors/weather"
import { formatAges, splitAdultsChildren, summariseTravelers } from "@/lib/opportunities/travelers"
import type { TravelerSummary } from "@/lib/opportunities/types"

// ─── Fixtures ────────────────────────────────────────────────────────────────

const HOME = { lat: 42.33, lng: -83.05 } // downtown Detroit
const DTW = { iata: "DTW", lat: 42.2124, lng: -83.3534 }
const MCO = { lat: 28.4312, lng: -81.3081 }
const ORD = { lat: 41.9742, lng: -87.9073 }

const family: TravelerSummary = {
  ages: [41, 39, 12, 9, 7, 5],
  count: 6,
  tags: ["adult", "child"],
  activityRatings: { "theme-parks-rides": 5, "water-activities": 5, "museums-history": 4, "nightlife-casinos": 1 },
}

const orlandoFit: NormalisedFamilyFit = {
  tags: ["theme-parks", "water", "interactive", "zoo-aquarium"],
  byAgeBand: { "0-5": 3, "6-12": 3, "13-17": 3, adult: 2 },
  indoorRatio: 0.3,
}
const vegasFit: NormalisedFamilyFit = {
  tags: ["nightlife-heavy", "interactive", "sports", "hiking"],
  byAgeBand: { "0-5": 1, "6-12": 1, "13-17": 2, adult: 3 },
  indoorRatio: 0.8,
}

const anchors: ProfileAnchor[] = [
  { title: "Walt Disney World", kind: "OTHER", rawKind: "THEME_PARK", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], weatherDependent: false },
  { title: "EPCOT Flower & Garden Festival", kind: "FESTIVAL", rawKind: "FESTIVAL", months: [3, 4, 5], weatherDependent: false },
  { title: "Red Rock Canyon", kind: "NATURAL", rawKind: "NATURE", months: [10, 11, 12], weatherDependent: true },
]

function offer(total: number, stops: number, opts: { carriers?: string[]; id?: string; mins?: number } = {}): FlightOfferResult & { id?: string } {
  const segs = [{ carrier: opts.carriers?.[0] ?? "DL", from: "DTW", to: "MCO", departAt: "2026-11-12T07:00:00", arriveAt: "2026-11-12T09:45:00", durationMins: opts.mins ?? 165 }]
  return {
    id: opts.id,
    provider: "serpapi",
    totalPrice: total,
    currency: "USD",
    carrierCodes: opts.carriers ?? ["DL"],
    stops,
    durationMins: (opts.mins ?? 165) * 2,
    outbound: { segments: segs, durationMins: opts.mins ?? 165, stops },
    inbound: { segments: [{ ...segs[0], from: "MCO", to: "DTW", departAt: "2026-11-15T18:00:00", arriveAt: "2026-11-15T20:45:00" }], durationMins: opts.mins ?? 165, stops },
    bookingUrl: "https://example.test",
  }
}

function quote(over: Partial<RateQuoteLike> & { rateKind: string; nightlyRate: number }): RateQuoteLike {
  const nights = 3
  return {
    id: over.id ?? `${over.propertyCode ?? "P"}-${over.rateKind}`,
    propertyCode: over.propertyCode ?? "MCOCI",
    propertyName: over.propertyName ?? "Conrad Orlando",
    brand: over.brand ?? "Conrad",
    tier: over.tier ?? null,
    rateKind: over.rateKind,
    nightlyRate: over.nightlyRate,
    totalRate: over.totalRate ?? over.nightlyRate * nights,
    currency: "USD",
    available: over.available ?? true,
    retrievedAt: "2026-09-27T12:00:00.000Z",
  }
}

// ─── Travelers ───────────────────────────────────────────────────────────────

describe("summariseTravelers", () => {
  const asOf = new Date("2026-09-27T00:00:00Z")
  it("derives ages from birthDate and falls back to tags", () => {
    const s = summariseTravelers(
      [
        { birthDate: new Date("1985-03-01"), tags: ["adult"], preferences: { activities: { "beach-pool": 5 } } },
        { birthDate: null, tags: ["child"], preferences: { activities: { "beach-pool": 3 } } },
        { birthDate: "2019-12-25", tags: [] },
      ],
      asOf
    )
    expect(s.ages).toEqual([41, 9, 6])
    expect(s.agesEstimated).toBe(true)
    expect(s.childCount).toBe(2)
    expect(s.activityRatings["beach-pool"]).toBe(4)
    expect(s.tags).toEqual(["adult", "child"])
  })
  it("splits airline adults and children", () => {
    expect(splitAdultsChildren([41, 39, 12, 9, 1])).toEqual({ adults: 3, children: 2 })
    expect(splitAdultsChildren([])).toEqual({ adults: 1, children: 0 })
  })
  it("formats ages for detail lines", () => {
    expect(formatAges([41, 39, 12, 9, 7])).toBe("2 adults · kids ages 7, 9, 12")
    expect(formatAges([30])).toBe("1 adult")
  })
})

// ─── Trip length ─────────────────────────────────────────────────────────────

describe("evaluateTripLengthFit", () => {
  it("is perfect inside the ideal range and labelled ESTIMATED", () => {
    const r = evaluateTripLengthFit({ nights: 3, idealNightsMin: 2, idealNightsMax: 4, destinationName: "Las Vegas" })
    expect(r.available).toBe(true)
    expect(r.score).toBe(1)
    expect(r.source).toBe("ESTIMATED")
    expect(r.reasons[0].headline).toBe("Fits a 3-night trip")
  })
  it("decays outside the range and flags a clearly short stay", () => {
    const r = evaluateTripLengthFit({ nights: 2, idealNightsMin: 4, idealNightsMax: 7, destinationName: "Orlando" })
    expect(r.score).toBe(0.5)
    expect(r.reasons[0].polarity).toBe("NEGATIVE")
    expect(r.reasons[0].headline).toBe("Short for Orlando")
    expect(evaluateTripLengthFit({ nights: 3, idealNightsMin: 4, idealNightsMax: 7, destinationName: "Orlando" }).reasons).toHaveLength(0)
  })
})

// ─── Family fit ──────────────────────────────────────────────────────────────

describe("evaluateFamilyFit", () => {
  it("bands ages", () => {
    expect(ageBand(3)).toBe("0-5")
    expect(ageBand(9)).toBe("6-12")
    expect(ageBand(15)).toBe("13-17")
    expect(ageBand(40)).toBe("adult")
  })
  it("counts relevance, not raw attractions, and names the ages", () => {
    const r = evaluateFamilyFit({ travelers: family, familyFit: orlandoFit, destinationName: "Orlando" })
    expect(r.available).toBe(true)
    expect(r.facts.strongMatches).toBe(3) // theme-parks, water, interactive(museums)
    expect(r.score!).toBeGreaterThan(0.8)
    const pos = r.reasons.find((x) => x.polarity === "POSITIVE")!
    expect(pos.headline).toBe("3 strong family matches")
    expect(pos.detail).toContain("kids ages 5, 7, 9, 12")
    expect(pos.detail).toContain("theme parks")
  })
  it("penalises a nightlife-heavy destination with kids and flags it", () => {
    const r = evaluateFamilyFit({ travelers: family, familyFit: vegasFit, destinationName: "Las Vegas" })
    expect(r.score!).toBeLessThan(0.4)
    expect(r.reasons.some((x) => x.polarity === "NEGATIVE" && x.headline.includes("Little for kids"))).toBe(true)
  })
  it("rewards the same destination for an adults-only party", () => {
    const adults: TravelerSummary = { ages: [34, 33], count: 2, tags: ["adult"], activityRatings: { "nightlife-casinos": 5, "shows-entertainment": 4 } }
    const r = evaluateFamilyFit({ travelers: adults, familyFit: vegasFit, destinationName: "Las Vegas" })
    expect(r.score!).toBeGreaterThan(0.7)
    expect(r.reasons.every((x) => x.polarity === "POSITIVE")).toBe(true)
  })
  it("works with tag-list age bands and no ratings", () => {
    const fit: NormalisedFamilyFit = { tags: ["beach"], byAgeBand: { "6-12": ["beach", "water"], adult: ["beach"] }, indoorRatio: 0.2 }
    const r = evaluateFamilyFit({ travelers: { ages: [40, 8], count: 2, tags: [], activityRatings: {} }, familyFit: fit, destinationName: "X" })
    expect(r.available).toBe(true)
    expect(r.score).toBe(0.5)
    expect(r.facts.ratedPreferences).toBe(false)
  })
})

// ─── Anchor ──────────────────────────────────────────────────────────────────

describe("evaluateAnchor", () => {
  it("prefers a seasonal anchor over a year-round one and is ESTIMATED", () => {
    const r = evaluateAnchor({ anchors, checkIn: "2026-04-09", checkOut: "2026-04-12", destinationName: "Orlando" })
    expect(r.source).toBe("ESTIMATED")
    expect(r.facts.anchorTitle).toBe("EPCOT Flower & Garden Festival")
    expect(r.score).toBe(0.75)
    expect(r.reasons[0].headline).toContain("is in season")
  })
  it("prefers a dated event on the exact dates and becomes RETRIEVED", () => {
    const r = evaluateAnchor({
      anchors,
      checkIn: "2026-11-12",
      checkOut: "2026-11-15",
      destinationName: "Orlando",
      events: [
        { title: "Way Too Early", kind: "CONCERT", date: "2026-11-10" },
        { title: "Orlando Magic vs Celtics", kind: "SPORTS", date: "2026-11-13", url: "https://tm.test/x", venue: "Kia Center" },
      ],
      eventsRetrievedAt: "2026-09-27T12:00:00Z",
    })
    expect(r.source).toBe("RETRIEVED")
    expect(r.facts.anchorTitle).toBe("Orlando Magic vs Celtics")
    expect(r.facts.eventCount).toBe(1)
    expect(r.facts.weatherDependent).toBe(false)
    const exp = anchorExperienceFromFacts(r)!
    expect(exp).toEqual({ title: "Orlando Magic vs Celtics", kind: "SPORTS", source: "RETRIEVED", date: "2026-11-13", url: "https://tm.test/x" })
  })
  it("carries weatherDependent from the chosen seasonal anchor", () => {
    const r = evaluateAnchor({ anchors: [anchors[2]], checkIn: "2026-11-12", checkOut: "2026-11-15", destinationName: "Las Vegas" })
    expect(r.facts.weatherDependent).toBe(true)
  })
  it("is unavailable with nothing to go on, low with nothing in season", () => {
    expect(evaluateAnchor({ anchors: [], checkIn: "2026-11-12", checkOut: "2026-11-15", destinationName: "X" }).available).toBe(false)
    const r = evaluateAnchor({ anchors: [anchors[1]], checkIn: "2026-11-12", checkOut: "2026-11-15", destinationName: "X" })
    expect(r.available).toBe(true)
    expect(r.score).toBe(0.1)
  })
})

// ─── Weather ─────────────────────────────────────────────────────────────────

function day(date: string, hi: number, lo: number, precip: number): DayForecast {
  return { date, dayName: "Thu", emoji: "", condition: "Clear", highTemp: hi, lowTemp: lo, precipitationPct: precip, humidity: 50, windMph: 5 }
}

describe("evaluateWeather", () => {
  const climate = [
    { month: 11, highF: 78, lowF: 59, precipPct: 20 },
    { month: 1, highF: 40, lowF: 25, precipPct: 45 },
  ]
  it("uses the forecast when it covers the stay and is RETRIEVED", () => {
    const forecast = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"].map((d) => day(d, 84, 66, 10))
    const r = evaluateWeather({ checkIn: "2026-10-01", checkOut: "2026-10-04", forecast, climate, retrievedAt: "2026-09-27T12:00:00Z" })
    expect(r.source).toBe("RETRIEVED")
    expect(r.facts.kind).toBe("FORECAST")
    expect(r.facts.swimmable).toBe(true)
    expect(r.facts.summary).toBe("forecast 84° / 66°, 10% rain")
    expect(r.retrievedAt).toBe("2026-09-27T12:00:00Z")
    expect(r.reasons[0].headline).toBe("Warm enough to swim")
  })
  it("falls back to climate when the forecast does not cover the stay, labelled HISTORICAL with 'typically'", () => {
    const partial = ["2026-11-12"].map((d) => day(d, 80, 60, 0))
    const r = evaluateWeather({ checkIn: "2026-11-12", checkOut: "2026-11-15", forecast: partial, climate })
    expect(r.source).toBe("HISTORICAL")
    expect(r.facts.kind).toBe("HISTORICAL")
    expect(r.facts.summary).toBe("typically 78° / 59°, 20% rain")
    expect(r.retrievedAt).toBeUndefined()
    expect(weatherContextFromFacts(r)).toEqual({ kind: "HISTORICAL", highF: 78, lowF: 59, precipPct: 20, swimmable: true, summary: "typically 78° / 59°, 20% rain" })
  })
  it("flags cold weather, harder when the anchor is weather-dependent, and 'not warm' when asked", () => {
    const r = evaluateWeather({ checkIn: "2026-01-15", checkOut: "2026-01-18", climate, wantWarm: true, weatherDependentAnchor: true })
    expect(outdoorSuitability(40, 45)).toBe("POOR")
    expect(r.facts.outdoorSuitability).toBe("POOR")
    const neg = r.reasons.filter((x) => x.polarity === "NEGATIVE")
    expect(neg.map((x) => x.headline)).toEqual(["Cold for the outdoors", "Not warm"])
    expect(neg[0].magnitude).toBe(0.7)
    expect(r.score).toBe(0)
  })
  it("uses an archive summary when the profile has no climate, else is unavailable", () => {
    const r = evaluateWeather({ checkIn: "2026-06-01", checkOut: "2026-06-04", historical: { highF: 88, lowF: 70, precipPct: 35 } })
    expect(r.source).toBe("HISTORICAL")
    expect(r.facts.outdoorSuitability).toBe("FAIR")
    expect(evaluateWeather({ checkIn: "2026-06-01", checkOut: "2026-06-04" }).available).toBe(false)
  })
})

// ─── Door to door ────────────────────────────────────────────────────────────

describe("evaluateDoorToDoor", () => {
  const base = {
    homeLat: HOME.lat,
    homeLng: HOME.lng,
    airport: DTW,
    airportArrivalBufferMins: 90,
    airportToCenterKm: 25,
    drivingAlternativeMaxKm: 500,
  }
  it("adds every leg of the flying estimate and is ESTIMATED", () => {
    const est = estimateDoorToDoor({ ...base, flightMins: 165, destinationLat: MCO.lat, destinationLng: MCO.lng })!
    expect(est.mode).toBe("FLY")
    expect(est.driveMins).toBeNull() // ~1,600 km, no driving alternative
    expect(est.airportToCenterMins).toBe(38) // 25 km at 40 km/h
    expect(est.flyMins).toBe(est.homeToAirportMins! + 90 + 165 + 35 + 38)
    const r = evaluateDoorToDoor({ ...base, flightMins: 165, destinationLat: MCO.lat, destinationLng: MCO.lng })
    expect(r.source).toBe("ESTIMATED")
    expect(r.facts.doorToDoorMins).toBe(est.flyMins)
  })
  it("computes a driving alternative under the threshold and prefers it when faster", () => {
    // Detroit → Chicago: 55-minute flight vs ~5 hour drive; flying still wins but the drive is recorded.
    const r = evaluateDoorToDoor({ ...base, flightMins: 75, airportToCenterKm: 30, destinationLat: ORD.lat, destinationLng: ORD.lng })
    expect(r.facts.driveMins).not.toBe("")
    expect(Number(r.facts.driveMins)).toBeGreaterThan(200)
    // A very short hop where the drive is shorter than all the airport overhead.
    const near = evaluateDoorToDoor({ ...base, flightMins: 45, airportToCenterKm: 10, destinationLat: 42.9634, destinationLng: -85.6681 }) // Grand Rapids
    expect(near.facts.mode).toBe("DRIVE")
  })
  it("flags a long travel day and the user's ceiling", () => {
    const r = evaluateDoorToDoor({ ...base, flightMins: 420, airportToCenterKm: 40, destinationLat: 21.3, destinationLng: -157.8, maxDoorToDoorMins: 480 })
    expect(r.reasons.map((x) => x.headline)).toEqual(["Long travel day", "Over your travel-time limit"])
    expect(r.facts.overCeiling).toBe(true)
  })
  it("is unavailable without home coordinates or any way to get there", () => {
    expect(evaluateDoorToDoor({ ...base, homeLat: null, flightMins: 100, destinationLat: MCO.lat, destinationLng: MCO.lng }).available).toBe(false)
    expect(evaluateDoorToDoor({ ...base, airport: null, flightMins: null, destinationLat: MCO.lat, destinationLng: MCO.lng }).available).toBe(false)
  })
  it("assembles the transportation Json from facts", () => {
    const d2d = evaluateDoorToDoor({ ...base, flightMins: 165, destinationLat: MCO.lat, destinationLng: MCO.lng })
    const t = transportationFromFacts(d2d, undefined)
    expect(t.mode).toBe("FLY")
    expect(t.durationMins).toBe(165)
    expect(t.source).toBe("ESTIMATED")
  })
})

// ─── Ground friction ─────────────────────────────────────────────────────────

describe("evaluateGroundFriction", () => {
  it("rewards walkable, penalises car-needed with the six-person minivan note", () => {
    const walk = evaluateGroundFriction({ walkable: true, carNeeded: false, parkingTypical: "EXPENSIVE", activitiesDispersed: false, partySize: 6 })
    expect(walk.score).toBe(0.9)
    expect(walk.reasons[0]).toMatchObject({ polarity: "POSITIVE", headline: "Walkable, no car needed" })
    const car = evaluateGroundFriction({ walkable: false, carNeeded: true, parkingTypical: "EXPENSIVE", activitiesDispersed: true, partySize: 6 })
    expect(car.score).toBe(0.1)
    expect(car.reasons[0].headline).toBe("Car needed; 6 seats means a minivan")
    expect(car.facts.largePartyPenalty).toBe(true)
    const carSmall = evaluateGroundFriction({ walkable: false, carNeeded: true, parkingTypical: "FREE", activitiesDispersed: true, partySize: 4 })
    expect(carSmall.reasons[0].headline).toBe("Car needed")
    expect(carSmall.source).toBe("ESTIMATED")
  })
})

// ─── Nonstop + airfare ───────────────────────────────────────────────────────

describe("evaluateNonstopAirfare", () => {
  const route = { originIata: "DTW", destIata: "MCO", carriers: ["DL", "NK"], typicalDurationMins: 165, weeklyFrequency: 28, departureBuckets: ["MORNING", "EVENING"], source: "OBSERVED_OFFER" }

  it("picks the cheapest nonstop over a cheaper connection", () => {
    expect(pickBestOffer([offer(900, 1), offer(1260, 0), offer(1400, 0)])!.totalPrice).toBe(1260)
    expect(pickBestOffer([offer(900, 1)])!.stops).toBe(1)
    expect(pickBestOffer([])).toBeNull()
  })

  it("records party total and per-traveler, RETRIEVED, with carriers and times", () => {
    const { nonstop, airfare, best } = evaluateNonstopAirfare({
      offers: [offer(1260, 0, { carriers: ["NK"], id: "off-1" }), offer(1500, 0, { carriers: ["DL"] })],
      route,
      travelerCount: 6,
      retrievedAt: "2026-09-27T12:00:00Z",
      originIata: "DTW",
      destinationIata: "MCO",
    })
    expect(best!.id).toBe("off-1")
    expect(airfare.source).toBe("RETRIEVED")
    expect(airfare.facts.partyTotal).toBe(1260)
    expect(airfare.facts.perTraveler).toBe(210)
    expect(airfare.facts.offerId).toBe("off-1")
    expect(airfare.facts.departs).toBe("2026-11-12T07:00:00")
    expect(airfare.reasons).toHaveLength(0) // no baseline, no claim
    expect(nonstop.source).toBe("RETRIEVED")
    expect(nonstop.facts.nonstopFound).toBe(true)
    expect(nonstop.score).toBe(1) // 0.7 + frequency 0.2 + morning bucket 0.1
    expect(nonstop.reasons[0].headline).toBe("Nonstop both ways")
    expect(nonstop.reasons[0].detail).toBe("DTW→MCO 2h 45m, Spirit + Delta options")
  })

  it("emits an airfare reason at 35% under one baseline and a stronger one under both", () => {
    const one = evaluateNonstopAirfare({ offers: [offer(1260, 0)], route, travelerCount: 6, otherDateTotals: [2000, 1950, 2100] })
    expect(one.airfare.reasons).toHaveLength(1)
    expect(one.airfare.reasons[0].headline).toBe("$1,260 airfare for six")
    expect(one.airfare.reasons[0].detail).toBe("37% under the other dates in this search")
    expect(one.airfare.score).toBe(0.85)
    const both = evaluateNonstopAirfare({ offers: [offer(1260, 0)], route, travelerCount: 6, otherDateTotals: [2000, 1950, 2100], routeHistory: [2200, 2300] })
    expect(both.airfare.reasons[0].detail).toContain("and this route's history")
    expect(both.airfare.reasons[0].magnitude).toBeGreaterThan(one.airfare.reasons[0].magnitude)
    expect(both.airfare.score).toBe(0.95)
    const none = evaluateNonstopAirfare({ offers: [offer(1900, 0)], route, travelerCount: 6, otherDateTotals: [2000, 1950, 2100] })
    expect(none.airfare.reasons).toHaveLength(0)
  })

  it("flags no nonstop, harder when the user required one", () => {
    const r = evaluateNonstopAirfare({ offers: [offer(700, 1)], route, travelerCount: 2, nonstopOnly: true })
    expect(r.nonstop.facts.nonstopFound).toBe(false)
    expect(r.nonstop.reasons[0]).toMatchObject({ polarity: "NEGATIVE", magnitude: 0.8 })
    expect(r.airfare.available).toBe(true)
  })

  it("gives an ESTIMATED nonstop view from route knowledge alone and is unavailable with nothing", () => {
    const r = evaluateNonstopAirfare({ offers: [], route: { ...route, weeklyFrequency: 1 }, travelerCount: 2 })
    expect(r.nonstop.source).toBe("ESTIMATED")
    expect(r.nonstop.available).toBe(true)
    expect(r.airfare.available).toBe(false)
    const none = evaluateNonstopAirfare({ offers: [], route: null, travelerCount: 2 })
    expect(none.nonstop.available).toBe(false)
    expect(none.airfare.available).toBe(false)
  })
})

// ─── Hotel value ─────────────────────────────────────────────────────────────

describe("evaluateHotelValue", () => {
  it("maps brands to tiers, longest key first", () => {
    expect(tierFromBrand("Hilton Garden Inn")).toBe("MID")
    expect(tierFromBrand("Hilton Orlando")).toBe("UPSCALE")
    expect(tierFromBrand("Waldorf Astoria Orlando")).toBe("LUXURY")
    expect(tierFromBrand("Nowhere Inn", "LUXURY")).toBe("LUXURY")
    expect(tierFromBrand(null)).toBeNull()
  })

  it("pairs private and public quotes by propertyCode", () => {
    const pairs = pairQuotes([
      quote({ propertyCode: "A", rateKind: "PRIVATE_HILTON_GO", nightlyRate: 79 }),
      quote({ propertyCode: "A", rateKind: "PUBLIC", nightlyRate: 925 }),
      quote({ propertyCode: "B", rateKind: "PUBLIC", nightlyRate: 200, brand: "Hampton" }),
      quote({ propertyCode: "C", rateKind: "PRIVATE_HILTON_GO", nightlyRate: 120, brand: "Hampton", available: false }),
    ])
    expect(pairs).toHaveLength(1) // B has no private rate, C is unavailable
    expect(pairs[0].savingsTotal).toBe((925 - 79) * 3)
    expect(pairs[0].savingsRatio).toBeCloseTo(0.915, 3)
    expect(pairs[0].unlockedTier).toBe(1)
  })

  it("weights an unlocked luxury tier above raw savings: the $75 Conrad beats the $65 Hampton", () => {
    const conrad = evaluateHotelValue({
      quotes: [quote({ propertyCode: "CON", rateKind: "PRIVATE_HILTON_GO", nightlyRate: 75 }), quote({ propertyCode: "CON", rateKind: "PUBLIC", nightlyRate: 1000 })],
      nights: 3,
    })
    const hampton = evaluateHotelValue({
      quotes: [
        quote({ propertyCode: "HAM", propertyName: "Hampton Inn", brand: "Hampton", rateKind: "PRIVATE_HILTON_GO", nightlyRate: 65 }),
        quote({ propertyCode: "HAM", propertyName: "Hampton Inn", brand: "Hampton", rateKind: "PUBLIC", nightlyRate: 175 }),
      ],
      nights: 3,
    })
    expect(conrad.score!).toBeGreaterThan(hampton.score!)
    expect(conrad.source).toBe("RETRIEVED")
    expect(conrad.facts.hotelName).toBe("Conrad Orlando")
    expect(conrad.facts.savingsTotal).toBe(2775)
    expect(conrad.reasons.map((r) => r.headline)).toEqual(["$2,775 hotel savings", "Luxury stay at a mid-tier price"])
    expect(conrad.reasons[0].detail).toBe("Conrad Orlando, private $75 vs public $1,000/night")
    expect(conrad.facts.hotelRateQuoteId).toBe("CON-PRIVATE_HILTON_GO")
    expect(conrad.facts.publicRateQuoteId).toBe("CON-PUBLIC")
    // Hampton saves 63% so it still earns the savings headline, just a lower score.
    expect(hampton.reasons[0].headline).toBe("$330 hotel savings")
  })

  it("chooses the best pair among several and handles a private-only quote honestly", () => {
    const r = evaluateHotelValue({
      quotes: [
        quote({ propertyCode: "HAM", propertyName: "Hampton Inn", brand: "Hampton", rateKind: "PRIVATE_HILTON_GO", nightlyRate: 65 }),
        quote({ propertyCode: "HAM", propertyName: "Hampton Inn", brand: "Hampton", rateKind: "PUBLIC", nightlyRate: 175 }),
        quote({ propertyCode: "CON", rateKind: "PRIVATE_HILTON_GO", nightlyRate: 79 }),
        quote({ propertyCode: "CON", rateKind: "PUBLIC", nightlyRate: 925 }),
      ],
      nights: 3,
    })
    expect(r.facts.propertyCode).toBe("CON")
    expect(r.facts.pairCount).toBe(2)
    const solo = evaluateHotelValue({ quotes: [quote({ propertyCode: "CON", rateKind: "PRIVATE_HILTON_GO", nightlyRate: 79 })], nights: 3 })
    expect(solo.available).toBe(true)
    expect(solo.facts.hasPublicComparable).toBe(false)
    expect(solo.facts.savingsTotal).toBe("")
    expect(solo.reasons.some((x) => x.headline.includes("hotel savings"))).toBe(false)
  })

  it("is unavailable with no usable quotes", () => {
    expect(evaluateHotelValue({ quotes: [], nights: 3 }).available).toBe(false)
    expect(evaluateHotelValue({ quotes: [quote({ propertyCode: "X", rateKind: "PUBLIC", nightlyRate: 200 })], nights: 3 }).available).toBe(false)
  })
})
