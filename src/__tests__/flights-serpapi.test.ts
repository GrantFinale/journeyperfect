import { describe, it, expect, vi } from "vitest"
import fixture from "./fixtures/serpapi-google-flights.json"
import {
  SerpApiProvider,
  buildSerpApiParams,
  mapSerpApiPriceInsights,
  mapSerpApiResponse,
  type SerpApiGoogleFlightsResponse,
} from "@/lib/flights/providers/serpapi"
import { ProviderNotConfiguredError, ProviderRequestError } from "@/lib/flights/errors"
import type { FlightQuery } from "@/lib/flights/types"

const q: FlightQuery = {
  origin: "DTW",
  destination: "MCO",
  departDate: "2026-12-01",
  returnDate: "2026-12-08",
  cabin: "economy",
  adults: 2,
  children: 1,
  maxStops: 1,
  currency: "USD",
}
const RETRIEVED = "2026-09-27T12:00:00.000Z"

describe("buildSerpApiParams", () => {
  it("maps the query onto google_flights parameters", () => {
    const p = buildSerpApiParams(q, "KEY")
    expect(p.get("engine")).toBe("google_flights")
    expect(p.get("departure_id")).toBe("DTW")
    expect(p.get("arrival_id")).toBe("MCO")
    expect(p.get("outbound_date")).toBe("2026-12-01")
    expect(p.get("return_date")).toBe("2026-12-08")
    expect(p.get("type")).toBe("1")
    expect(p.get("adults")).toBe("2")
    expect(p.get("children")).toBe("1")
    expect(p.get("travel_class")).toBe("1")
    expect(p.get("stops")).toBe("2") // maxStops 1 -> "one stop or fewer"
    expect(p.get("currency")).toBe("USD")
    expect(p.get("hl")).toBe("en")
    expect(p.get("api_key")).toBe("KEY")
  })

  it("uses type=2 and no return_date for one-way, and stops=1 for nonstop-only", () => {
    const p = buildSerpApiParams({ ...q, returnDate: undefined, maxStops: 0, cabin: "business", children: 0 }, "K")
    expect(p.get("type")).toBe("2")
    expect(p.has("return_date")).toBe(false)
    expect(p.has("children")).toBe(false)
    expect(p.get("stops")).toBe("1")
    expect(p.get("travel_class")).toBe("3")
    expect(buildSerpApiParams({ ...q, maxStops: undefined }, "K").get("stops")).toBe("0")
  })
})

describe("mapSerpApiResponse", () => {
  const result = mapSerpApiResponse(fixture as unknown as SerpApiGoogleFlightsResponse, q, RETRIEVED)

  it("merges best_flights and other_flights, drops unusable itineraries and sorts by price", () => {
    // 2 best + 3 other, minus one with no departure time, minus one with no price
    expect(result.offers).toHaveLength(3)
    expect(result.offers.map((o) => o.totalPrice)).toEqual([189, 264, 318])
    expect(result.fromCache).toBe(false)
    expect(result.retrievedAt).toBe(RETRIEVED)
  })

  it("maps a nonstop itinerary to one segment with normalised times and a carrier code", () => {
    const delta = result.offers.find((o) => o.totalPrice === 318)!
    expect(delta.provider).toBe("serpapi")
    expect(delta.providerRef).toBe("tok_best_1")
    expect(delta.carrierCodes).toEqual(["DL"])
    expect(delta.stops).toBe(0)
    expect(delta.durationMins).toBe(170)
    expect(delta.currency).toBe("USD")
    expect(delta.outbound.segments).toHaveLength(1)
    expect(delta.outbound.segments[0]).toMatchObject({
      carrier: "DL",
      carrierName: "Delta",
      flightNumber: "DL 1502",
      from: "DTW",
      to: "MCO",
      departAt: "2026-12-01T07:15",
      arriveAt: "2026-12-01T10:05",
      durationMins: 170,
    })
    expect(delta.inbound).toBeUndefined()
    expect(delta.expiresAt).toBe("2026-09-28T12:00:00.000Z")
  })

  it("counts stops from the legs and keeps the total duration including layovers", () => {
    const aa = result.offers.find((o) => o.totalPrice === 264)!
    expect(aa.stops).toBe(1)
    expect(aa.outbound.segments.map((s) => s.to)).toEqual(["CLT", "MCO"])
    expect(aa.durationMins).toBe(290)
    expect(aa.carrierCodes).toEqual(["AA"])
  })

  it("deep-links every offer to the Google Flights search for the query", () => {
    for (const o of result.offers) {
      expect(o.bookingUrl).toBe(
        "https://www.google.com/travel/flights?q=Flights%20to%20MCO%20from%20DTW%20on%202026-12-01%20through%202026-12-08&curr=USD&hl=en"
      )
    }
  })

  it("maps price_insights to a PriceInsight", () => {
    expect(result.insight).toEqual({ lowestPrice: 189, typicalLow: 230, typicalHigh: 420, level: "LOW" })
    expect(mapSerpApiPriceInsights(undefined)).toBeUndefined()
    expect(mapSerpApiPriceInsights({ lowest_price: 100, price_level: "weird" })).toEqual({
      lowestPrice: 100,
      typicalLow: undefined,
      typicalHigh: undefined,
      level: "UNKNOWN",
    })
  })

  it("returns an empty result for an empty payload", () => {
    const empty = mapSerpApiResponse({}, q, RETRIEVED)
    expect(empty.offers).toEqual([])
    expect(empty.insight).toBeUndefined()
  })
})

describe("SerpApiProvider", () => {
  it("throws ProviderNotConfiguredError without an API key and never calls fetch", async () => {
    const fetchImpl = vi.fn()
    const provider = new SerpApiProvider({ apiKey: async () => "  ", fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(provider.search(q)).rejects.toBeInstanceOf(ProviderNotConfiguredError)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(provider.supportsBooking).toBe(false)
    expect(provider.id).toBe("serpapi")
  })

  it("calls serpapi.com with the mapped params and maps the JSON", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url.startsWith("https://serpapi.com/search.json?")).toBe(true)
      expect(url).toContain("api_key=KEY")
      return new Response(JSON.stringify(fixture), { status: 200, headers: { "content-type": "application/json" } })
    })
    const provider = new SerpApiProvider({
      apiKey: async () => "KEY",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => new Date(RETRIEVED),
    })
    const result = await provider.search(q)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(result.offers).toHaveLength(3)
    expect(result.retrievedAt).toBe(RETRIEVED)
  })

  it("surfaces HTTP and API errors as ProviderRequestError", async () => {
    const bad = new SerpApiProvider({
      apiKey: async () => "KEY",
      fetchImpl: (async () => new Response("rate limited", { status: 429 })) as unknown as typeof fetch,
    })
    await expect(bad.search(q)).rejects.toBeInstanceOf(ProviderRequestError)

    const apiErr = new SerpApiProvider({
      apiKey: async () => "KEY",
      fetchImpl: (async () => new Response(JSON.stringify({ error: "Invalid API key" }), { status: 200 })) as unknown as typeof fetch,
    })
    await expect(apiErr.search(q)).rejects.toThrow(/Invalid API key/)
  })
})
