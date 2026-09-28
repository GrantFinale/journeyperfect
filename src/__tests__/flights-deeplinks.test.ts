import { describe, it, expect } from "vitest"
import { AIRLINE_LINK_CARRIERS, airlineName, airlineSearchUrl, aviasalesUrl, googleFlightsUrl } from "@/lib/flights/deeplinks"
import type { FlightQuery } from "@/lib/flights/types"

const roundTrip: FlightQuery = {
  origin: "lax",
  destination: " JFK ",
  departDate: "2026-12-01",
  returnDate: "2026-12-08",
  cabin: "economy",
  adults: 2,
  children: 1,
  currency: "usd",
}

const oneWay: FlightQuery = { ...roundTrip, returnDate: undefined, adults: 1, children: 0 }

describe("googleFlightsUrl", () => {
  it("builds the documented simple ?q= form for a one-way", () => {
    expect(googleFlightsUrl(oneWay)).toBe(
      "https://www.google.com/travel/flights?q=Flights%20to%20JFK%20from%20LAX%20on%202026-12-01&curr=USD&hl=en"
    )
  })

  it("adds the return date with 'through' and upper-cases codes and currency", () => {
    expect(googleFlightsUrl(roundTrip)).toBe(
      "https://www.google.com/travel/flights?q=Flights%20to%20JFK%20from%20LAX%20on%202026-12-01%20through%202026-12-08&curr=USD&hl=en"
    )
  })
})

describe("aviasalesUrl", () => {
  it("encodes route, DDMM dates and passengers in the path", () => {
    expect(aviasalesUrl(roundTrip)).toBe("https://www.aviasales.com/search/LAX0112JFK081221")
  })

  it("omits the children digit when zero and the return date when one-way", () => {
    expect(aviasalesUrl(oneWay)).toBe("https://www.aviasales.com/search/LAX0112JFK1")
  })

  it("appends the affiliate marker when given, and never otherwise", () => {
    expect(aviasalesUrl(oneWay, "123456")).toBe("https://www.aviasales.com/search/LAX0112JFK1?marker=123456")
    expect(aviasalesUrl(oneWay, "")).not.toContain("marker")
    expect(aviasalesUrl(oneWay, null)).not.toContain("marker")
  })
})

describe("airlineSearchUrl", () => {
  it("covers at least a dozen US carriers", () => {
    expect(AIRLINE_LINK_CARRIERS.length).toBeGreaterThanOrEqual(12)
    for (const c of ["AA", "DL", "UA", "WN", "B6", "AS", "NK", "F9"]) expect(AIRLINE_LINK_CARRIERS).toContain(c)
  })

  it("returns null for carriers it does not know", () => {
    expect(airlineSearchUrl("LH", roundTrip)).toBeNull()
    expect(airlineSearchUrl("", roundTrip)).toBeNull()
    expect(airlineName("LH")).toBeNull()
  })

  it("puts the route and dates into every known carrier's link", () => {
    for (const carrier of AIRLINE_LINK_CARRIERS) {
      const url = airlineSearchUrl(carrier, roundTrip)
      expect(url, carrier).toMatch(/^https:\/\//)
      expect(url, carrier).toContain("LAX")
      expect(url, carrier).toContain("JFK")
      // Either ISO or US-style date must be present
      expect(url, carrier).toMatch(/2026-12-01|12\/01\/2026/)
      expect(airlineName(carrier)).toBeTruthy()
    }
  })

  it("is case-insensitive on the carrier code and drops the return date for one-way", () => {
    const rt = airlineSearchUrl("wn", roundTrip)!
    const ow = airlineSearchUrl("WN", oneWay)!
    expect(rt).toContain("returnDate=2026-12-08")
    expect(ow).not.toContain("returnDate")
    expect(ow).toContain("tripType=oneway")
  })
})
