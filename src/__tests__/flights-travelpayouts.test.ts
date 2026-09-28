import { describe, it, expect, vi } from "vitest"
import {
  TravelpayoutsProvider,
  buildGroupedPricesParams,
  buildPricesForDatesParams,
  mapGroupedPrices,
  mapTravelpayoutsPrices,
  type TravelpayoutsPricesResponse,
} from "@/lib/flights/providers/travelpayouts"
import { ProviderNotConfiguredError } from "@/lib/flights/errors"
import type { FlightQuery } from "@/lib/flights/types"

const q: FlightQuery = {
  origin: "DTW",
  destination: "MCO",
  departDate: "2026-12-01",
  returnDate: "2026-12-08",
  cabin: "economy",
  adults: 2,
  children: 0,
  currency: "USD",
}
const RETRIEVED = "2026-09-27T12:00:00.000Z"

const response: TravelpayoutsPricesResponse = {
  success: true,
  currency: "usd",
  data: [
    {
      origin: "DTW",
      destination: "MCO",
      origin_airport: "DTW",
      destination_airport: "MCO",
      price: 142,
      airline: "NK",
      flight_number: "430",
      departure_at: "2026-12-01T18:20:00-05:00",
      return_at: "2026-12-08T09:10:00-05:00",
      transfers: 0,
      return_transfers: 0,
      duration: 340,
      duration_to: 170,
      duration_back: 170,
      link: "/search/DTW0112MCO08122?t=NK17650000001765600000000170DTWMCO_abc_142&search_date=27092026&expected_price_uuid=x",
    },
    {
      origin: "DTW",
      destination: "MCO",
      price: 201,
      airline: "DL",
      flight_number: "1502",
      departure_at: "2026-12-01T07:15:00-05:00",
      return_at: "2026-12-08T11:00:00-05:00",
      transfers: 1,
      return_transfers: 0,
      duration: 420,
      duration_to: 250,
      duration_back: 170,
    },
    { origin: "DTW", destination: "MCO", price: Number.NaN, airline: "AA" },
  ],
}

describe("buildPricesForDatesParams", () => {
  it("maps the query onto prices_for_dates parameters", () => {
    const p = buildPricesForDatesParams(q, "TOKEN")
    expect(p.get("origin")).toBe("DTW")
    expect(p.get("destination")).toBe("MCO")
    expect(p.get("departure_at")).toBe("2026-12-01")
    expect(p.get("return_at")).toBe("2026-12-08")
    expect(p.get("one_way")).toBe("false")
    expect(p.get("direct")).toBe("false")
    expect(p.get("currency")).toBe("usd")
    expect(p.get("sorting")).toBe("price")
    expect(p.get("token")).toBe("TOKEN")
  })

  it("sets one_way and direct for a nonstop one-way", () => {
    const p = buildPricesForDatesParams({ ...q, returnDate: undefined, maxStops: 0 }, "T")
    expect(p.get("one_way")).toBe("true")
    expect(p.get("direct")).toBe("true")
    expect(p.has("return_at")).toBe(false)
  })

  it("builds grouped_prices params by month", () => {
    const p = buildGroupedPricesParams("dtw", "mco", "2026-12-15", "USD", "T")
    expect(p.get("departure_at")).toBe("2026-12")
    expect(p.get("group_by")).toBe("departure_at")
    expect(p.get("origin")).toBe("DTW")
  })
})

describe("mapTravelpayoutsPrices", () => {
  const result = mapTravelpayoutsPrices(response, q, "MARKER", RETRIEVED)

  it("drops entries without a numeric price and sorts by total", () => {
    expect(result.offers).toHaveLength(2)
    expect(result.offers[0].totalPrice).toBeLessThan(result.offers[1].totalPrice)
    expect(result.insight).toBeUndefined()
    expect(result.fromCache).toBe(false)
  })

  it("multiplies the per-passenger price by the passenger count and upper-cases currency", () => {
    const nk = result.offers[0]
    expect(nk.totalPrice).toBe(284) // 142 x 2 adults
    expect(nk.currency).toBe("USD")
    expect(nk.provider).toBe("travelpayouts")
  })

  it("synthesises one segment per direction with local times, carrier and stops", () => {
    const nk = result.offers[0]
    expect(nk.carrierCodes).toEqual(["NK"])
    expect(nk.stops).toBe(0)
    expect(nk.durationMins).toBe(340)
    expect(nk.outbound.segments).toHaveLength(1)
    expect(nk.outbound.segments[0]).toMatchObject({
      carrier: "NK",
      flightNumber: "NK 430",
      from: "DTW",
      to: "MCO",
      departAt: "2026-12-01T18:20",
      arriveAt: "2026-12-01T21:10", // +170 min, both airports on Eastern time
      durationMins: 170,
    })
    expect(nk.inbound?.segments[0]).toMatchObject({ from: "MCO", to: "DTW", departAt: "2026-12-08T09:10" })

    const dl = result.offers[1]
    expect(dl.stops).toBe(1)
    expect(dl.outbound.stops).toBe(1)
    expect(dl.inbound?.stops).toBe(0)
  })

  it("deep-links to Aviasales using the API path plus the marker, or the search URL without a path", () => {
    expect(result.offers[0].bookingUrl).toBe(
      "https://www.aviasales.com/search/DTW0112MCO08122?t=NK17650000001765600000000170DTWMCO_abc_142&search_date=27092026&expected_price_uuid=x&marker=MARKER"
    )
    expect(result.offers[1].bookingUrl).toBe("https://www.aviasales.com/search/DTW0112MCO08122?marker=MARKER")
    const noMarker = mapTravelpayoutsPrices(response, q, null, RETRIEVED)
    expect(noMarker.offers[1].bookingUrl).toBe("https://www.aviasales.com/search/DTW0112MCO08122")
  })

  it("marks offers as expiring a week out (Data API cache horizon)", () => {
    expect(result.offers[0].expiresAt).toBe("2026-10-04T12:00:00.000Z")
  })
})

describe("mapGroupedPrices", () => {
  it("produces one entry per date sorted ascending", () => {
    const entries = mapGroupedPrices(
      {
        success: true,
        currency: "usd",
        data: {
          "2026-12-15": { price: 120, airline: "nk", transfers: 0, link: "/search/DTW1512MCO1?t=x" },
          "2026-12-02": { price: 99, airline: "f9", transfers: 1 },
          "2026-12-09": { price: Number.NaN },
        },
      },
      "DTW",
      "MCO",
      "M"
    )
    expect(entries.map((e) => e.date)).toEqual(["2026-12-02", "2026-12-15"])
    expect(entries[0]).toEqual({
      date: "2026-12-02",
      price: 99,
      currency: "USD",
      airline: "F9",
      transfers: 1,
      url: "https://www.aviasales.com/search/DTW0212MCO1?marker=M",
    })
    expect(entries[1].url).toBe("https://www.aviasales.com/search/DTW1512MCO1?t=x&marker=M")
  })
})

describe("TravelpayoutsProvider", () => {
  it("throws ProviderNotConfiguredError without a token, but getFareCalendar degrades to []", async () => {
    const fetchImpl = vi.fn()
    const provider = new TravelpayoutsProvider({ token: async () => "", marker: async () => "", fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(provider.search(q)).rejects.toBeInstanceOf(ProviderNotConfiguredError)
    await expect(provider.getFareCalendar("DTW", "MCO", "2026-12")).resolves.toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(provider.supportsBooking).toBe(false)
  })

  it("fetches prices_for_dates and maps the response", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url.startsWith("https://api.travelpayouts.com/aviasales/v3/prices_for_dates?")).toBe(true)
      expect(url).toContain("token=TOKEN")
      return new Response(JSON.stringify(response), { status: 200 })
    })
    const provider = new TravelpayoutsProvider({
      token: async () => "TOKEN",
      marker: async () => "MARKER",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => new Date(RETRIEVED),
    })
    const result = await provider.search(q)
    expect(result.offers).toHaveLength(2)
    expect(result.offers[0].bookingUrl).toContain("marker=MARKER")
    expect(result.retrievedAt).toBe(RETRIEVED)
  })

  it("rejects success=false payloads", async () => {
    const provider = new TravelpayoutsProvider({
      token: async () => "TOKEN",
      marker: async () => "",
      fetchImpl: (async () => new Response(JSON.stringify({ success: false, error: "Unauthorized" }), { status: 200 })) as unknown as typeof fetch,
    })
    await expect(provider.search(q)).rejects.toThrow(/Unauthorized/)
  })
})
