import { describe, it, expect } from "vitest"
import { parseHiltonResults, nightsBetween, type HiltonSnapshot } from "@/lib/private-rates/parse-hilton"

const ctx = {
  propertyCode: "CHIPDHH",
  checkIn: "2026-10-10",
  checkOut: "2026-10-12", // 2 nights
  rateKind: "PRIVATE_HILTON_GO" as const,
}

const FIXTURE_TWO_NIGHTS: HiltonSnapshot = {
  propertyName: "Palmer House a Hilton Hotel",
  brand: "Hilton Hotels & Resorts",
  rooms: [
    { roomType: "1 King Bed Deluxe", nightlyRate: 189, totalRate: 378, currency: "USD", available: true },
    { roomType: "2 Queen Beds", nightlyRate: 209, totalRate: 418, currency: "USD", available: true },
    { roomType: "Executive Suite", nightlyRate: 149, totalRate: 298, currency: "USD", available: false },
    { roomType: "Accessible King", nightlyRate: 175.5, totalRate: 351, currency: "usd", available: true },
  ],
}

const FIXTURE_SOLD_OUT: HiltonSnapshot = {
  propertyName: "Hilton Chicago",
  rooms: [
    { roomType: "1 King Bed", nightlyRate: null, totalRate: null, currency: "USD", available: false },
    { roomType: "2 Double Beds", nightlyRate: 220, totalRate: 440, currency: "USD", available: false },
  ],
}

describe("nightsBetween", () => {
  it("counts nights from ISO dates", () => {
    expect(nightsBetween("2026-10-10", "2026-10-12")).toBe(2)
    expect(nightsBetween("2026-12-30", "2027-01-02")).toBe(3)
  })
  it("falls back to 1 on bad or inverted input", () => {
    expect(nightsBetween("garbage", "2026-10-12")).toBe(1)
    expect(nightsBetween("2026-10-12", "2026-10-10")).toBe(1)
    expect(nightsBetween("2026-10-10", "2026-10-10")).toBe(1)
  })
})

describe("parseHiltonResults", () => {
  it("returns exactly one observation: the cheapest available room", () => {
    const out = parseHiltonResults(FIXTURE_TWO_NIGHTS, ctx)
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({
      propertyCode: "CHIPDHH",
      propertyName: "Palmer House a Hilton Hotel",
      brand: "Hilton Hotels & Resorts",
      checkIn: "2026-10-10",
      checkOut: "2026-10-12",
      rateKind: "PRIVATE_HILTON_GO",
      nightlyRate: 175.5,
      totalRate: 351,
      currency: "USD",
      roomType: "Accessible King",
      available: true,
    })
  })

  it("ignores unavailable rooms even when they are cheaper", () => {
    const [obs] = parseHiltonResults(FIXTURE_TWO_NIGHTS, ctx)
    expect(obs.roomType).not.toBe("Executive Suite")
  })

  it("returns an available:false observation when nothing is bookable", () => {
    const out = parseHiltonResults(FIXTURE_SOLD_OUT, ctx)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      propertyCode: "CHIPDHH",
      propertyName: "Hilton Chicago",
      available: false,
      nightlyRate: 0,
      totalRate: 0,
      currency: "USD",
      rateKind: "PRIVATE_HILTON_GO",
    })
    expect(out[0].roomType).toBeUndefined()
    expect(out[0].brand).toBeUndefined()
  })

  it("handles an empty room list and missing property name", () => {
    const out = parseHiltonResults({ rooms: [] }, { ...ctx, rateKind: "PUBLIC" })
    expect(out).toEqual([
      {
        propertyCode: "CHIPDHH",
        propertyName: "CHIPDHH",
        checkIn: "2026-10-10",
        checkOut: "2026-10-12",
        rateKind: "PUBLIC",
        nightlyRate: 0,
        totalRate: 0,
        currency: "USD",
        available: false,
      },
    ])
  })

  it("derives the total from the nightly rate when the page showed no total", () => {
    const [obs] = parseHiltonResults(
      { rooms: [{ roomType: "King", nightlyRate: 100, totalRate: null, currency: "EUR", available: true }] },
      ctx,
    )
    expect(obs).toMatchObject({ nightlyRate: 100, totalRate: 200, currency: "EUR", available: true })
  })

  it("derives the nightly rate from the total when the page showed no nightly figure", () => {
    const [obs] = parseHiltonResults(
      { rooms: [{ roomType: "King", nightlyRate: null, totalRate: 301, currency: "GBP", available: true }] },
      ctx,
    )
    expect(obs).toMatchObject({ nightlyRate: 150.5, totalRate: 301, currency: "GBP" })
  })

  it("treats available rooms with no price at all as not bookable", () => {
    const [obs] = parseHiltonResults(
      { rooms: [{ roomType: "King", nightlyRate: null, totalRate: null, currency: "USD", available: true }] },
      ctx,
    )
    expect(obs.available).toBe(false)
  })

  it("ignores zero, negative and NaN prices", () => {
    const [obs] = parseHiltonResults(
      {
        rooms: [
          { roomType: "Zero", nightlyRate: 0, totalRate: 0, currency: "USD", available: true },
          { roomType: "Neg", nightlyRate: -5, totalRate: -10, currency: "USD", available: true },
          { roomType: "NaN", nightlyRate: Number.NaN, totalRate: null, currency: "USD", available: true },
          { roomType: "Real", nightlyRate: 99.999, totalRate: null, currency: "USD", available: true },
        ],
      },
      ctx,
    )
    expect(obs).toMatchObject({ roomType: "Real", nightlyRate: 100, totalRate: 200, available: true })
  })

  it("breaks nightly ties on the lower total", () => {
    const [obs] = parseHiltonResults(
      {
        rooms: [
          { roomType: "A", nightlyRate: 100, totalRate: 230, currency: "USD", available: true },
          { roomType: "B", nightlyRate: 100, totalRate: 200, currency: "USD", available: true },
        ],
      },
      ctx,
    )
    expect(obs.roomType).toBe("B")
  })
})
