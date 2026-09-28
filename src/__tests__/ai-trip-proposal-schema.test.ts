import { describe, it, expect } from "vitest"
import {
  parseTripProposal,
  extractJsonObject,
  normaliseProposal,
  tripProposalSchema,
  tripProposalVariantSchema,
  proposeTripInputSchema,
  buildTripProposalTools,
  nightsBetween,
  normaliseTier,
  LODGING_TIER_PER_NIGHT_USD,
  DAILY_SPEND_PER_ADULT_USD,
  type TripProposalDeps,
  type TripProposal,
} from "@/lib/ai/trip-proposal"

const validVariant = {
  label: "Cheapest",
  destination: { name: "Lisbon, Portugal", lat: 38.72, lng: -9.14, placeId: "pl_1", iata: "LIS" },
  origin: { name: "Detroit", iata: "DTW" },
  startDate: "2027-05-04",
  endDate: "2027-05-14",
  travelers: 2,
  flight: {
    offerSummary: "TAP DTW→LIS, 1 stop, 11h 20m",
    totalPrice: 1180,
    currency: "USD",
    bookingUrl: "https://example.com/book",
    searchId: "fs_1",
    offerId: "fo_1",
    source: "RETRIEVED",
  },
  lodging: { estimateTotal: 1600, perNight: 160, currency: "USD", source: "ESTIMATED", tier: "mid-range" },
  activities: [
    { title: "Jerónimos Monastery", kind: "landmark", estCost: 12 },
    { title: "Time Out Market", kind: "food", estCost: 30 },
  ],
  total: { amount: 4600, currency: "USD", source: "RETRIEVED" },
  rationale: ["Cheapest fare in the window", "Lodging is an estimate"],
}

describe("tripProposalSchema", () => {
  it("accepts a well-formed proposal", () => {
    const r = tripProposalSchema.safeParse({ variants: [validVariant], summary: "ok" })
    expect(r.success).toBe(true)
  })

  it("applies defaults for optional source/currency fields", () => {
    const v = tripProposalVariantSchema.parse({
      ...validVariant,
      flight: { offerSummary: "x", totalPrice: 1, currency: "USD", bookingUrl: "https://example.com/u" },
      lodging: { estimateTotal: 1, perNight: 1 },
    })
    expect(v.flight?.source).toBe("ESTIMATED")
    expect(v.lodging.currency).toBe("USD")
    expect(v.lodging.source).toBe("ESTIMATED")
  })

  it("only accepts http(s) booking URLs and caps free-text lengths", () => {
    const withFlight = (bookingUrl: string) => ({
      ...validVariant,
      flight: { offerSummary: "x", totalPrice: 1, currency: "USD", bookingUrl },
    })
    expect(tripProposalVariantSchema.safeParse(withFlight("https://example.com/book")).success).toBe(true)
    expect(tripProposalVariantSchema.safeParse(withFlight("javascript:alert(1)")).success).toBe(false)
    expect(tripProposalVariantSchema.safeParse(withFlight("not a url")).success).toBe(false)
    expect(tripProposalVariantSchema.safeParse(withFlight("ftp://example.com/x")).success).toBe(false)
    expect(
      tripProposalVariantSchema.safeParse({ ...validVariant, lodging: { ...validVariant.lodging, bookingUrl: "data:text/html,hi" } }).success
    ).toBe(false)
    expect(tripProposalVariantSchema.safeParse({ ...validVariant, rationale: ["r".repeat(501)] }).success).toBe(false)
    expect(
      tripProposalVariantSchema.safeParse({ ...validVariant, activities: [{ title: "t".repeat(201), kind: "museum" }] }).success
    ).toBe(false)
  })

  it("rejects bad dates, empty rationale, too many variants and unknown sources", () => {
    expect(tripProposalVariantSchema.safeParse({ ...validVariant, startDate: "May 4" }).success).toBe(false)
    expect(tripProposalVariantSchema.safeParse({ ...validVariant, rationale: [] }).success).toBe(false)
    expect(tripProposalVariantSchema.safeParse({ ...validVariant, total: { ...validVariant.total, source: "GUESS" } }).success).toBe(false)
    expect(tripProposalVariantSchema.safeParse({ ...validVariant, travelers: 0 }).success).toBe(false)
    expect(tripProposalSchema.safeParse({ variants: [] }).success).toBe(false)
    expect(tripProposalSchema.safeParse({ variants: Array(5).fill(validVariant) }).success).toBe(false)
  })
})

describe("parseTripProposal", () => {
  it("parses raw JSON", () => {
    const r = parseTripProposal(JSON.stringify({ variants: [validVariant] }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.proposal.variants[0].label).toBe("Cheapest")
  })

  it("parses JSON inside markdown fences and surrounding prose", () => {
    const txt = "Here you go:\n```json\n" + JSON.stringify({ variants: [validVariant] }) + "\n```\nEnjoy!"
    const r = parseTripProposal(txt)
    expect(r.ok).toBe(true)
  })

  it("reports missing JSON and validation failures with paths", () => {
    expect(parseTripProposal("no json here")).toEqual({ ok: false, error: expect.stringMatching(/no JSON/) })
    const bad = parseTripProposal(JSON.stringify({ variants: [{ ...validVariant, startDate: 42 }] }))
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toMatch(/variants\.0\.startDate/)
    expect(parseTripProposal("{ variants: [ }").ok).toBe(false)
  })

  it("extractJsonObject picks the outermost object", () => {
    expect(extractJsonObject('blah {"a":{"b":1}} trailing')).toBe('{"a":{"b":1}}')
    expect(extractJsonObject("nothing")).toBeNull()
  })
})

describe("normaliseProposal", () => {
  it("downgrades RETRIEVED labels that lack a persisted offer", () => {
    const p: TripProposal = tripProposalSchema.parse({
      variants: [
        {
          ...validVariant,
          flight: { ...validVariant.flight, searchId: undefined, offerId: undefined, source: "RETRIEVED" },
          lodging: { ...validVariant.lodging, source: "RETRIEVED" },
          total: { ...validVariant.total, source: "RETRIEVED" },
        },
      ],
    })
    const n = normaliseProposal(p)
    expect(n.variants[0].flight?.source).toBe("ESTIMATED")
    expect(n.variants[0].lodging.source).toBe("ESTIMATED")
    expect(n.variants[0].total.source).toBe("ESTIMATED")
  })

  it("keeps RETRIEVED when a searchId + offerId back the fare", () => {
    const n = normaliseProposal(tripProposalSchema.parse({ variants: [validVariant] }))
    expect(n.variants[0].flight?.source).toBe("RETRIEVED")
    expect(n.variants[0].total.source).toBe("RETRIEVED")
  })

  it("swaps reversed dates", () => {
    const n = normaliseProposal(
      tripProposalSchema.parse({ variants: [{ ...validVariant, startDate: "2027-05-14", endDate: "2027-05-04" }] })
    )
    expect(n.variants[0].startDate).toBe("2027-05-04")
    expect(n.variants[0].endDate).toBe("2027-05-14")
  })
})

describe("proposeTripInputSchema", () => {
  it("requires an idea of at least 3 chars and bounds the numbers", () => {
    expect(proposeTripInputSchema.safeParse({ idea: "hi" }).success).toBe(false)
    expect(proposeTripInputSchema.safeParse({ idea: "Ten days in Portugal" }).success).toBe(true)
    expect(proposeTripInputSchema.safeParse({ idea: "x".repeat(10), travelers: 99 }).success).toBe(false)
    expect(proposeTripInputSchema.safeParse({ idea: "x".repeat(10), windowStart: "next may" }).success).toBe(false)
  })
})

describe("pure helpers", () => {
  it("nightsBetween and normaliseTier", () => {
    expect(nightsBetween("2027-05-04", "2027-05-14")).toBe(10)
    expect(nightsBetween("2027-05-04", "2027-05-04")).toBe(0)
    expect(nightsBetween("bad", "2027-05-04")).toBe(0)
    expect(normaliseTier("Luxury")).toBe("luxury")
    expect(normaliseTier("mid range")).toBe("mid-range")
    expect(normaliseTier("boutique")).toBe("upscale")
    expect(normaliseTier("hostel")).toBe("budget")
    expect(normaliseTier(undefined)).toBe("mid-range")
  })
})

describe("tool handlers (findStays / estimateBudget)", () => {
  const deps: TripProposalDeps = {
    resolveDestination: async () => null,
    searchFlights: async () => ({ offers: [] }),
    getFareCalendar: async () => ({}),
    suggestActivities: async () => [],
    hotelLink: async (d, i, o) => `https://hotels.example/${encodeURIComponent(d)}?in=${i}&out=${o}`,
  }
  const tools = buildTripProposalTools(deps, { currency: "USD" })
  const tool = (name: string) => tools.find((t) => t.name === name)!

  it("exposes the six documented tools", () => {
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["estimateBudget", "findStays", "getFareCalendar", "resolveDestination", "searchFlights", "suggestActivities"]
    )
  })

  it("findStays prices from the tier table and labels the result ESTIMATED", async () => {
    const r = (await tool("findStays").handler({
      destination: "Lisbon",
      checkIn: "2027-05-04",
      checkOut: "2027-05-14",
      tier: "mid-range",
      rooms: 1,
    })) as Record<string, unknown>
    expect(r.nights).toBe(10)
    expect(r.perNight).toBe(LODGING_TIER_PER_NIGHT_USD["mid-range"])
    expect(r.estimateTotal).toBe(LODGING_TIER_PER_NIGHT_USD["mid-range"] * 10)
    expect(r.source).toBe("ESTIMATED")
    expect(r.bookingUrl).toContain("hotels.example/Lisbon")
  })

  it("estimateBudget sums components and marks RETRIEVED only with a live fare", async () => {
    const base = { lodgingTotal: 1600, activityCostsPerAdult: [12, 30], nights: 10, travelers: 2, tier: "mid-range" }
    const live = (await tool("estimateBudget").handler({ ...base, flightTotal: 1180, flightIsRetrieved: true })) as {
      total: number
      source: string
      breakdown: Record<string, number>
    }
    const daily = DAILY_SPEND_PER_ADULT_USD["mid-range"] * 2 * 10
    expect(live.breakdown).toEqual({ flight: 1180, lodging: 1600, activities: 84, foodAndLocalTransport: daily })
    expect(live.total).toBe(1180 + 1600 + 84 + daily)
    expect(live.source).toBe("RETRIEVED")

    const est = (await tool("estimateBudget").handler({ ...base, flightTotal: 1180 })) as { source: string }
    expect(est.source).toBe("ESTIMATED")
  })

  it("validates required args", async () => {
    expect(await tool("searchFlights").handler({ origin: "DTW" })).toMatchObject({ error: expect.any(String) })
    expect(await tool("resolveDestination").handler({})).toMatchObject({ error: expect.any(String) })
    expect(await tool("resolveDestination").handler({ query: "Nowhere" })).toMatchObject({ error: /No place found/ })
  })
})
