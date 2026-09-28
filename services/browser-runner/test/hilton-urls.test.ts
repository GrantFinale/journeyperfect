import { describe, expect, it } from "vitest"
import { brandFromCtyhocn, buildLocationSearchUrl, buildRoomsUrl, isTimeoutError } from "../src/hilton.js"

describe("buildRoomsUrl", () => {
  it("builds the rooms deep link with dates and adults", () => {
    const u = new URL(buildRoomsUrl({ propertyCode: "chipdhh", checkIn: "2026-10-10", checkOut: "2026-10-12" }))
    expect(u.origin + u.pathname).toBe("https://www.hilton.com/en/book/reservation/rooms/")
    expect(u.searchParams.get("ctyhocn")).toBe("CHIPDHH")
    expect(u.searchParams.get("arrivalDate")).toBe("2026-10-10")
    expect(u.searchParams.get("departureDate")).toBe("2026-10-12")
    expect(u.searchParams.get("room1NumAdults")).toBe("2")
    expect(u.searchParams.has("corporateCode")).toBe(false)
  })

  it("adds the rate code under the configured param", () => {
    const u = new URL(buildRoomsUrl({ propertyCode: "CHIPDHH", checkIn: "2026-10-10", checkOut: "2026-10-12", rateCode: "TMTP" }))
    expect(u.searchParams.get("corporateCode")).toBe("TMTP")
    const v = new URL(
      buildRoomsUrl({ propertyCode: "CHIPDHH", checkIn: "2026-10-10", checkOut: "2026-10-12", rateCode: "TMTP" }, "promoCode"),
    )
    expect(v.searchParams.get("promoCode")).toBe("TMTP")
    expect(v.searchParams.has("corporateCode")).toBe(false)
  })
})

describe("buildLocationSearchUrl", () => {
  it("encodes the query, dates and optional coordinates", () => {
    const u = new URL(
      buildLocationSearchUrl({ location: "Chicago, IL", checkIn: "2026-10-10", checkOut: "2026-10-12", lat: 41.88, lng: -87.63, rateCode: "TMTP" }),
    )
    expect(u.origin + u.pathname).toBe("https://www.hilton.com/en/search/")
    expect(u.searchParams.get("query")).toBe("Chicago, IL")
    expect(u.searchParams.get("lat")).toBe("41.88")
    expect(u.searchParams.get("lng")).toBe("-87.63")
    expect(u.searchParams.get("corporateCode")).toBe("TMTP")
  })

  it("omits coordinates unless both are finite numbers", () => {
    const u = new URL(buildLocationSearchUrl({ location: "Denver", checkIn: "2026-10-10", checkOut: "2026-10-12", lat: 39.7 }))
    expect(u.searchParams.has("lat")).toBe(false)
    expect(u.searchParams.has("lng")).toBe(false)
  })
})

describe("brandFromCtyhocn", () => {
  it("maps the two-letter suffix", () => {
    expect(brandFromCtyhocn("CHIPDHH")).toBe("Hilton Hotels & Resorts")
    expect(brandFromCtyhocn("chidtdt")).toBe("DoubleTree by Hilton")
    expect(brandFromCtyhocn("ORDGIGI")).toBe("Hilton Garden Inn")
    expect(brandFromCtyhocn("XXXXXZZ")).toBeUndefined()
  })
})

describe("isTimeoutError", () => {
  it("recognises Playwright timeouts", () => {
    const e = new Error("page.goto: Timeout 45000ms exceeded.")
    expect(isTimeoutError(e)).toBe(true)
    const t = new Error("x")
    t.name = "TimeoutError"
    expect(isTimeoutError(t)).toBe(true)
    expect(isTimeoutError(new Error("boom"))).toBe(false)
  })
})
