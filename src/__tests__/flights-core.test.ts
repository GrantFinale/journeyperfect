import { describe, it, expect } from "vitest"
import { formatLocalIso, isoDurationToMinutes, toLocalIso, zonedTimeToUtc } from "@/lib/flights/time"
import { departureBucket, summariseNonstopObservations } from "@/lib/flights/nonstop"
import { fromIsoDate, offerResultToRow, offerRowToResult, searchRowToQuery, toIsoDate } from "@/lib/flights/rows"
import { offerRowToView, searchRowToSummary } from "@/lib/flights/views"
import type { FlightOfferResult } from "@/lib/flights/types"

describe("time helpers", () => {
  it("converts a local wall-clock time in an IANA zone to UTC, across DST", () => {
    expect(zonedTimeToUtc("2026-12-01T07:15", "America/Detroit").toISOString()).toBe("2026-12-01T12:15:00.000Z")
    expect(zonedTimeToUtc("2026-07-01T07:15", "America/Detroit").toISOString()).toBe("2026-07-01T11:15:00.000Z")
    expect(zonedTimeToUtc("2026-12-01T07:15", "UTC").toISOString()).toBe("2026-12-01T07:15:00.000Z")
    expect(zonedTimeToUtc("2026-12-01T07:15:00-05:00", "Asia/Tokyo").toISOString()).toBe("2026-12-01T12:15:00.000Z")
    expect(isNaN(zonedTimeToUtc("garbage", "UTC").getTime())).toBe(true)
  })

  it("formats an instant as local time in a zone and normalises provider strings", () => {
    expect(formatLocalIso(new Date("2026-12-01T12:15:00.000Z"), "America/Detroit")).toBe("2026-12-01T07:15")
    expect(toLocalIso("2026-12-01 08:05")).toBe("2026-12-01T08:05")
    expect(toLocalIso("2026-12-01T10:00:00+03:00")).toBe("2026-12-01T10:00")
  })

  it("parses ISO durations", () => {
    expect(isoDurationToMinutes("PT5H30M")).toBe(330)
    expect(isoDurationToMinutes("P1DT2H")).toBe(1560)
    expect(isoDurationToMinutes("PT45M")).toBe(45)
    expect(isoDurationToMinutes(null)).toBe(0)
    expect(isoDurationToMinutes("nope")).toBe(0)
  })
})

const nonstop: FlightOfferResult = {
  provider: "serpapi",
  totalPrice: 200,
  currency: "USD",
  carrierCodes: ["DL"],
  stops: 0,
  durationMins: 170,
  outbound: { segments: [{ carrier: "DL", from: "DTW", to: "MCO", departAt: "2026-12-01T06:30", arriveAt: "2026-12-01T09:20", durationMins: 170 }], durationMins: 170, stops: 0 },
  inbound: { segments: [{ carrier: "DL", from: "MCO", to: "DTW", departAt: "2026-12-08T18:00", arriveAt: "2026-12-08T20:50", durationMins: 172 }], durationMins: 172, stops: 0 },
  bookingUrl: "https://example.test",
}

describe("nonstop observations", () => {
  it("buckets departure hours", () => {
    expect(departureBucket("2026-12-01T06:59")).toBe("EARLY")
    expect(departureBucket("2026-12-01T07:00")).toBe("MORNING")
    expect(departureBucket("2026-12-01T11:59")).toBe("MORNING")
    expect(departureBucket("2026-12-01T12:00")).toBe("MIDDAY")
    expect(departureBucket("2026-12-01T16:59")).toBe("MIDDAY")
    expect(departureBucket("2026-12-01T17:00")).toBe("EVENING")
    expect(departureBucket("garbage")).toBeNull()
  })

  it("groups nonstop legs per direction with carriers, median duration and buckets", () => {
    const second: FlightOfferResult = {
      ...nonstop,
      carrierCodes: ["NK"],
      outbound: { segments: [{ carrier: "NK", from: "DTW", to: "MCO", departAt: "2026-12-01T13:00", arriveAt: "2026-12-01T15:55", durationMins: 175 }], durationMins: 175, stops: 0 },
      inbound: undefined,
    }
    const oneStop: FlightOfferResult = {
      ...nonstop,
      stops: 1,
      outbound: { segments: [{ carrier: "AA", from: "DTW", to: "CLT", departAt: "2026-12-01T13:00", arriveAt: "2026-12-01T15:00", durationMins: 120 }, { carrier: "AA", from: "CLT", to: "MCO", departAt: "2026-12-01T16:00", arriveAt: "2026-12-01T17:40", durationMins: 100 }], durationMins: 280, stops: 1 },
      inbound: undefined,
    }
    const obs = summariseNonstopObservations([nonstop, second, oneStop])
    expect(obs).toHaveLength(2)
    const out = obs.find((o) => o.originIata === "DTW")!
    expect(out).toEqual({ originIata: "DTW", destIata: "MCO", carriers: ["DL", "NK"], typicalDurationMins: 173, departureBuckets: ["EARLY", "MIDDAY"] })
    const back = obs.find((o) => o.originIata === "MCO")!
    expect(back).toEqual({ originIata: "MCO", destIata: "DTW", carriers: ["DL"], typicalDurationMins: 172, departureBuckets: ["EVENING"] })
  })
})

describe("row converters and views", () => {
  const searchRow = {
    id: "s1",
    userId: "u1",
    tripId: "t1",
    origin: "DTW",
    destination: "MCO",
    departDate: fromIsoDate("2026-12-01"),
    returnDate: fromIsoDate("2026-12-08"),
    cabin: "business",
    adults: 2,
    children: 1,
    maxStops: 0,
    isTracking: true,
    targetPrice: 250,
    currency: "USD",
    lastCheckedAt: new Date("2026-09-27T09:00:00.000Z"),
    lastPrice: 300,
    lowestPrice: 280,
    queryHash: "abc",
    createdAt: new Date("2026-09-20T00:00:00.000Z"),
    updatedAt: new Date("2026-09-27T09:00:00.000Z"),
  }

  it("round-trips @db.Date columns and rebuilds the query", () => {
    expect(toIsoDate(fromIsoDate("2026-12-01"))).toBe("2026-12-01")
    expect(searchRowToQuery(searchRow)).toEqual({
      origin: "DTW",
      destination: "MCO",
      departDate: "2026-12-01",
      returnDate: "2026-12-08",
      cabin: "business",
      adults: 2,
      children: 1,
      maxStops: 0,
      currency: "USD",
    })
    expect(searchRowToQuery({ ...searchRow, cabin: "weird", returnDate: null, maxStops: null })).toMatchObject({ cabin: "economy", returnDate: undefined, maxStops: undefined })
  })

  it("serialises a search summary with ISO strings", () => {
    const s = searchRowToSummary(searchRow, 3)
    expect(s).toMatchObject({ id: "s1", departDate: "2026-12-01", returnDate: "2026-12-08", cabin: "business", isTracking: true, offerCount: 3, lastCheckedAt: "2026-09-27T09:00:00.000Z", lowestPrice: 280 })
    expect(typeof s.createdAt).toBe("string")
  })

  it("round-trips an offer through row shape and view shape", () => {
    const row = { id: "o1", searchId: "s1", capturedAt: new Date("2026-09-27T09:00:00.000Z"), ...offerResultToRow(nonstop) }
    expect(row.expiresAt).toBeNull()
    expect(row.inbound).not.toBeNull()
    expect(offerRowToResult(row)).toEqual({ ...nonstop, providerRef: undefined, expiresAt: undefined })
    const view = offerRowToView(row)
    expect(view).toMatchObject({ id: "o1", searchId: "s1", provider: "serpapi", providerRef: null, totalPrice: 200, stops: 0, capturedAt: "2026-09-27T09:00:00.000Z", expiresAt: null })
    expect(view.inbound?.segments[0].from).toBe("MCO")
    expect(offerRowToView({ ...row, inbound: null }).inbound).toBeNull()
  })
})
