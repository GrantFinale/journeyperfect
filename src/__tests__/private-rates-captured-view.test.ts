import { describe, it, expect } from "vitest"
import { groupCapturedRates, hiltonBookingUrl, type CapturedQuoteLike } from "@/lib/private-rates/captured-view"

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

  it("sorts hotels by Go rate, repairs money-like names, never invents a public rate", () => {
    const oct29 = out.groups.find((g) => g.checkIn === "2026-10-29")!
    expect(oct29.nights).toBe(3)
    expect(oct29.hotels.map((h) => [h.propertyCode, h.propertyName, h.goNightly])).toEqual([
      ["CHITDHX", "Hampton Inn Chicago Downtown", 207],
      ["CHICHHH", "Hilton Chicago", 317],
    ])
    const hampton = oct29.hotels[0]
    expect(hampton.publicNightly).toBeUndefined()
    expect(hampton.savingsPerNight).toBeUndefined()
    expect(hampton.brand).toBe("Hampton by Hilton")
    expect(hampton.label).toMatch(/inferred/)
    expect(hampton.distanceKm).toBeGreaterThan(15)
    expect(hampton.distanceKm).toBeLessThan(40)
    expect(hampton.bookingUrl).toContain("ctyhocn=CHITDHX&arrivalDate=2026-10-29&departureDate=2026-11-01&room1NumAdults=2")
  })

  it("pairs a captured public rate for the same property and reports savings per night", () => {
    const oct9 = out.groups.find((g) => g.checkIn === "2026-10-09")!
    expect(oct9.hotels).toHaveLength(1)
    expect(oct9.hotels[0]).toMatchObject({ propertyCode: "CHICHHH", goNightly: 289, publicNightly: 349, savingsPerNight: 60 })
  })

  it("is empty with nothing captured", () => {
    expect(groupCapturedRates(candidates, [], { adults: 1 })).toEqual({ groups: [], totalQuotes: 0, totalHotels: 0 })
  })
})
