import { describe, it, expect } from "vitest"
import {
  groupCapturedRates,
  hiltonBookingUrl,
  marriottBookingUrl,
  summariseCaptureAudits,
  type CapturedQuoteLike,
} from "@/lib/private-rates/captured-view"
import { isPrivateRateKind, publicMatchesPrivate } from "@/lib/private-rates/brands"

// ORD airport, as the real candidates store it; the hotels are downtown (~22 km).
const ORD = { destinationIata: "ORD", destinationName: "Chicago", destinationLat: 41.974, destinationLng: -87.907, nights: 3 }
const LAS = { destinationIata: "LAS", destinationName: "Las Vegas", destinationLat: 36.084, destinationLng: -115.154, nights: 3 }
const at = new Date("2026-10-02T22:48:45.000Z")

function q(over: Partial<CapturedQuoteLike> & { id: string; propertyCode: string; nightlyRate: number }): CapturedQuoteLike {
  return {
    propertyName: "Hilton Chicago",
    brand: null,
    lat: 41.8725,
    lng: -87.6245,
    checkIn: "2026-10-29",
    checkOut: "2026-11-01",
    rateKind: "PRIVATE_HILTON_GO",
    currency: "USD",
    roomType: "inferred (Go Hilton portal, single price)",
    available: true,
    retrievedAt: at,
    ...over,
  }
}

describe("hiltonBookingUrl", () => {
  it("builds the rooms URL for real ctyhocn codes only", () => {
    expect(hiltonBookingUrl("CHITDHX", "2026-10-29", "2026-11-01", 2)).toBe(
      "https://www.hilton.com/en/book/reservation/rooms/?ctyhocn=CHITDHX&arrivalDate=2026-10-29&departureDate=2026-11-01&room1NumAdults=2",
    )
    expect(hiltonBookingUrl("name:hilton-chicago@41.873,-87.625", "2026-10-29", "2026-11-01", 2)).toBeUndefined()
  })
})

describe("groupCapturedRates", () => {
  const candidates = [
    { ...ORD, checkIn: "2026-10-29", checkOut: "2026-11-01" },
    { ...ORD, checkIn: "2026-10-29", checkOut: "2026-11-01" }, // duplicate candidate row
    { ...ORD, checkIn: "2026-10-09", checkOut: "2026-10-12" },
    { ...ORD, checkIn: "2026-11-12", checkOut: "2026-11-15" }, // nothing captured
    { ...LAS, checkIn: "2026-10-29", checkOut: "2026-11-01" }, // same dates, other city
  ]
  const quotes: CapturedQuoteLike[] = [
    q({ id: "a", propertyCode: "CHICHHH", propertyName: "$317", nightlyRate: 317 }),
    q({ id: "b", propertyCode: "CHITDHX", propertyName: "Hampton Inn Chicago Downtown", brand: "Hampton by Hilton", nightlyRate: 207, lat: 41.8903, lng: -87.6293 }),
    q({ id: "c", propertyCode: "CHICHHH", propertyName: "Hilton Chicago", nightlyRate: 349, rateKind: "PUBLIC", roomType: "signed-out", checkIn: "2026-10-09", checkOut: "2026-10-12" }),
    q({ id: "d", propertyCode: "CHICHHH", propertyName: "Hilton Chicago", nightlyRate: 289, checkIn: "2026-10-09", checkOut: "2026-10-12" }),
    q({ id: "e", propertyCode: "name:far-away@40.000,-80.000", propertyName: "Far Away Inn", nightlyRate: 90, lat: 40, lng: -80 }),
    q({ id: "f", propertyCode: "CHIDWES", propertyName: "$239", nightlyRate: 239, available: false }),
  ]

  const out = groupCapturedRates(candidates, quotes, { adults: 2 })

  it("groups by destination + dates, within 40 km of the airport, sorted by date", () => {
    expect(out.groups.map((g) => `${g.destinationIata}|${g.checkIn}`)).toEqual(["ORD|2026-10-09", "ORD|2026-10-29"])
    expect(out.totalQuotes).toBe(4)
    expect(out.totalHotels).toBe(2)
    expect(out.capturedAt).toBe(at.toISOString())
  })

  it("sorts hotels by private rate, repairs money-like names, never invents a public rate", () => {
    const oct29 = out.groups.find((g) => g.checkIn === "2026-10-29")!
    expect(oct29.nights).toBe(3)
    expect(oct29.hotels.map((h) => [h.propertyCode, h.propertyName, h.privateNightly])).toEqual([
      ["CHITDHX", "Hampton Inn Chicago Downtown", 207],
      ["CHICHHH", "Hilton Chicago", 317],
    ])
    const hampton = oct29.hotels[0]
    expect(hampton.publicNightly).toBeUndefined()
    expect(hampton.savingsPerNight).toBeUndefined()
    expect(hampton.brand).toBe("hilton")
    expect(hampton.rateLabelKind).toBe("GO")
    expect(hampton.propertyBrand).toBe("Hampton by Hilton")
    expect(hampton.label).toMatch(/inferred/)
    expect(hampton.distanceKm).toBeGreaterThan(15)
    expect(hampton.distanceKm).toBeLessThan(40)
    expect(hampton.bookingUrl).toContain("ctyhocn=CHITDHX&arrivalDate=2026-10-29&departureDate=2026-11-01&room1NumAdults=2")
  })

  it("pairs a captured public rate for the same property and reports savings per night", () => {
    const oct9 = out.groups.find((g) => g.checkIn === "2026-10-09")!
    expect(oct9.hotels).toHaveLength(1)
    expect(oct9.hotels[0]).toMatchObject({ propertyCode: "CHICHHH", privateNightly: 289, publicNightly: 349, savingsPerNight: 60 })
    expect(oct9.publicMatchesPrivate).toEqual({ hilton: false })
  })

  it("is empty with nothing captured", () => {
    expect(groupCapturedRates(candidates, [], { adults: 1 })).toEqual({ groups: [], totalQuotes: 0, totalHotels: 0 })
  })
})

// ─── Hilton + Marriott pairing ───────────────────────────────────────────────

describe("isPrivateRateKind / publicMatchesPrivate", () => {
  it("knows every private kind", () => {
    expect(isPrivateRateKind("PRIVATE_HILTON_GO")).toBe(true)
    expect(isPrivateRateKind("PRIVATE_MARRIOTT_FF")).toBe(true)
    expect(isPrivateRateKind("PUBLIC")).toBe(false)
    expect(isPrivateRateKind(null)).toBe(false)
  })
  it("flags a group when >= 80% of pairs are within $1", () => {
    const p = (a: number, b: number) => ({ privateNightly: a, publicNightly: b })
    expect(publicMatchesPrivate([])).toBe(false)
    expect(publicMatchesPrivate([p(100, 100.5), p(200, 200), p(150, 151), p(90, 90), p(80, 120)])).toBe(true) // 4/5
    expect(publicMatchesPrivate([p(100, 100), p(200, 200), p(150, 190), p(90, 130)])).toBe(false) // 2/4
    expect(publicMatchesPrivate([p(100, 101.5)])).toBe(false)
  })
})

describe("groupCapturedRates with Marriott", () => {
  const cands = [{ ...ORD, checkIn: "2026-11-06", checkOut: "2026-11-08", nights: 2 }]
  const base = { checkIn: "2026-11-06", checkOut: "2026-11-08", lat: 41.88, lng: -87.63, roomType: null, brand: null }

  it("pairs by provider + property code; never across brands", () => {
    const quotes: CapturedQuoteLike[] = [
      q({ ...base, id: "m1", provider: "marriott", propertyCode: "CHIJW", propertyName: "JW Marriott Chicago", brand: "JW Marriott", rateKind: "PRIVATE_MARRIOTT_FF", nightlyRate: 189 }),
      q({ ...base, id: "m2", provider: "marriott", propertyCode: "CHIJW", propertyName: "JW Marriott Chicago", rateKind: "PUBLIC", nightlyRate: 329 }),
      q({ ...base, id: "h1", provider: "hilton", propertyCode: "CHICHHH", propertyName: "Hilton Chicago", rateKind: "PRIVATE_HILTON_GO", nightlyRate: 150 }),
      q({ ...base, id: "h2", provider: "hilton", propertyCode: "CHICHHH", propertyName: "Hilton Chicago", rateKind: "PUBLIC", nightlyRate: 260 }),
      // Same code string on the other chain must not pair with Hilton's private rate.
      q({ ...base, id: "x", provider: "marriott", propertyCode: "CHICHHH", propertyName: "Odd Marriott", rateKind: "PUBLIC", nightlyRate: 999 }),
    ]
    const out = groupCapturedRates(cands, quotes, { adults: 2, marriottRateCode: "MMF" })
    expect(out.brands).toEqual(["hilton", "marriott"])
    expect(out.totalHotels).toBe(3)
    const g = out.groups[0]
    expect(g.publicMatchesPrivate).toEqual({ hilton: false, marriott: false })
    const jw = g.hotels.find((h) => h.propertyCode === "CHIJW")!
    expect(jw).toMatchObject({ brand: "marriott", rateLabelKind: "FF", propertyBrand: "JW Marriott", privateNightly: 189, publicNightly: 329, savingsPerNight: 140 })
    expect(jw.bookingUrl).toBe(
      "https://www.marriott.com/reservation/availabilitySearch.mi?propertyCode=CHIJW&fromDate=11%2F06%2F2026&toDate=11%2F08%2F2026&numberOfRooms=1&numberOfAdults=2&clusterCode=corp&corporateCode=MMF",
    )
    const hil = g.hotels.find((h) => h.brand === "hilton")!
    expect(hil).toMatchObject({ propertyCode: "CHICHHH", privateNightly: 150, publicNightly: 260, savingsPerNight: 110, rateLabelKind: "GO" })
    const odd = g.hotels.find((h) => h.brand === "marriott" && h.propertyCode === "CHICHHH")!
    expect(odd.privateNightly).toBeUndefined()
    expect(odd.publicNightly).toBe(999)
    expect(odd.bookingUrl).toBeUndefined() // CHICHHH is not a 5-letter MARSHA code
  })

  it("publicMatchesPrivate: a brand whose public search echoed the private rate gets no public prices or savings", () => {
    const quotes: CapturedQuoteLike[] = [
      q({ ...base, id: "a1", provider: "hilton", propertyCode: "A", rateKind: "PRIVATE_HILTON_GO", nightlyRate: 150 }),
      q({ ...base, id: "a2", provider: "hilton", propertyCode: "A", rateKind: "PUBLIC", nightlyRate: 150 }),
      q({ ...base, id: "b1", provider: "hilton", propertyCode: "B", rateKind: "PRIVATE_HILTON_GO", nightlyRate: 210 }),
      q({ ...base, id: "b2", provider: "hilton", propertyCode: "B", rateKind: "PUBLIC", nightlyRate: 210.5 }),
      q({ ...base, id: "m1", provider: "marriott", propertyCode: "CHIJW", rateKind: "PRIVATE_MARRIOTT_FF", nightlyRate: 189 }),
      q({ ...base, id: "m2", provider: "marriott", propertyCode: "CHIJW", rateKind: "PUBLIC", nightlyRate: 329 }),
    ]
    const g = groupCapturedRates(cands, quotes, { adults: 1, marriottRateCode: "MMF" }).groups[0]
    expect(g.publicMatchesPrivate).toEqual({ hilton: true, marriott: false })
    for (const h of g.hotels.filter((x) => x.brand === "hilton")) {
      expect(h.publicNightly).toBeUndefined()
      expect(h.savingsPerNight).toBeUndefined()
    }
    expect(g.hotels.find((h) => h.brand === "marriott")!.savingsPerNight).toBe(140)
  })

  it("public-only Marriott rows link without the rate code", () => {
    expect(marriottBookingUrl("chijw", "2026-11-06", "2026-11-08", 2)).toBe(
      "https://www.marriott.com/reservation/availabilitySearch.mi?propertyCode=CHIJW&fromDate=11%2F06%2F2026&toDate=11%2F08%2F2026&numberOfRooms=1&numberOfAdults=2",
    )
    expect(marriottBookingUrl("name:jw@41.9,-87.6", "2026-11-06", "2026-11-08", 2)).toBeUndefined()
    const g = groupCapturedRates(
      cands,
      [q({ ...base, id: "p", provider: "marriott", propertyCode: "CHIJW", rateKind: "PUBLIC", nightlyRate: 300 })],
      { adults: 2, marriottRateCode: "MMF" },
    ).groups[0]
    expect(g.hotels[0].bookingUrl).not.toContain("corporateCode")
  })
})

describe("summariseCaptureAudits", () => {
  it("counts blocked / empty / captured tabs per brand, latest outcome per item", () => {
    expect(
      summariseCaptureAudits([
        { itemKey: "ORD|d|d", written: 0, blocked: true }, // legacy: hilton
        { itemKey: "ORD|a|b|hilton|PUBLIC", brand: "hilton", written: 0, blocked: false },
        { itemKey: "ORD|a|b|marriott|PRIVATE", brand: "marriott", written: 0, blocked: true },
        { itemKey: "ORD|a|b|marriott|PRIVATE", brand: "marriott", written: 4, blocked: false }, // recaptured
        { itemKey: "ORD|a|b|marriott|PUBLIC", brand: "marriott", written: 3, blocked: false },
        null,
      ]),
    ).toEqual({ hilton: { blocked: 1, empty: 1, captured: 0 }, marriott: { blocked: 0, empty: 0, captured: 2 } })
  })
})
