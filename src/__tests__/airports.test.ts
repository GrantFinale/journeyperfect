import { describe, it, expect } from "vitest"
import { AIRPORT_COORDS, AIRPORT_COUNT, getAirportCoords, getAirportName } from "@/lib/airports"

describe("getAirportCoords", () => {
  it("resolves a known code", () => {
    const grr = getAirportCoords("GRR")
    expect(grr).toBeDefined()
    expect(grr!.city).toBe("Grand Rapids")
  })

  it("is case-insensitive", () => {
    expect(getAirportCoords("grr")).toBe(getAirportCoords("GRR"))
    expect(getAirportCoords("Ord")).toBe(getAirportCoords("ORD"))
  })

  it("trims surrounding whitespace", () => {
    expect(getAirportCoords("  mke  ")).toBe(getAirportCoords("MKE"))
    expect(getAirportCoords("\tLHR\n")).toBe(getAirportCoords("LHR"))
  })

  it("returns undefined for unknown, empty and malformed codes", () => {
    expect(getAirportCoords("ZZZ")).toBeUndefined()
    expect(getAirportCoords("")).toBeUndefined()
    expect(getAirportCoords(null)).toBeUndefined()
    expect(getAirportCoords(undefined)).toBeUndefined()
    expect(getAirportCoords("GR")).toBeUndefined()
    expect(getAirportCoords("GRRR")).toBeUndefined()
  })

  it("does not resolve prototype keys", () => {
    // Object.create(null) is not used, so guard against a code that would
    // otherwise walk the prototype chain.
    expect(getAirportCoords("toString" as string)).toBeUndefined()
  })
})

describe("getAirportName", () => {
  it("returns the published name for a known code", () => {
    expect(getAirportName("ORD")).toBe("Chicago O'Hare Intl")
  })

  it("falls back to the normalised code when unknown", () => {
    expect(getAirportName(" zzz ")).toBe("ZZZ")
    expect(getAirportName(null)).toBeNull()
  })
})

describe("AIRPORT_COORDS data integrity", () => {
  it("covers a meaningful number of airports", () => {
    expect(AIRPORT_COUNT).toBeGreaterThan(250)
  })

  it("uses three-letter uppercase IATA keys throughout", () => {
    for (const code of Object.keys(AIRPORT_COORDS)) {
      expect(code).toMatch(/^[A-Z]{3}$/)
    }
  })

  it("keeps every coordinate inside valid earth bounds", () => {
    for (const [code, a] of Object.entries(AIRPORT_COORDS)) {
      expect(Number.isFinite(a.lat), code).toBe(true)
      expect(Number.isFinite(a.lng), code).toBe(true)
      expect(Math.abs(a.lat), code).toBeLessThanOrEqual(90)
      expect(Math.abs(a.lng), code).toBeLessThanOrEqual(180)
      // 0,0 is in the Gulf of Guinea — a sure sign of a missing value.
      expect(a.lat === 0 && a.lng === 0, code).toBe(false)
    }
  })

  it("gives every airport a name, city and IANA timezone", () => {
    for (const [code, a] of Object.entries(AIRPORT_COORDS)) {
      expect(a.name.length, code).toBeGreaterThan(0)
      expect(a.city.length, code).toBeGreaterThan(0)
      // Region/City, plus the three-part forms like America/Indiana/Indianapolis.
      expect(a.tz, code).toMatch(/^[A-Za-z_]+\/[A-Za-z0-9_+-]+(\/[A-Za-z0-9_+-]+)?$/)
    }
  })

  it("resolves every timezone against the host ICU database", () => {
    for (const [code, a] of Object.entries(AIRPORT_COORDS)) {
      expect(() => new Intl.DateTimeFormat("en-US", { timeZone: a.tz }), code).not.toThrow()
    }
  })

  // Spot-checks for airports whose position is well known. A transposed or
  // sign-flipped pair would land in the wrong hemisphere and silently produce
  // an absurd "leave by" time, so these boxes are deliberately tight.
  const SPOT_CHECKS: Array<[string, number, number]> = [
    ["GRR", 42.88, -85.52],
    ["ORD", 41.98, -87.9],
    ["MKE", 42.95, -87.9],
    ["DTW", 42.21, -83.35],
    ["JFK", 40.64, -73.78],
    ["LAX", 33.94, -118.41],
    ["DEN", 39.86, -104.67],
    ["ATL", 33.64, -84.43],
    ["LHR", 51.47, -0.45],
    ["CDG", 49.01, 2.55],
    ["HND", 35.55, 139.78],
    ["SYD", -33.94, 151.18],
    ["GRU", -23.44, -46.47],
    ["JNB", -26.14, 28.25],
    ["DXB", 25.25, 55.37],
  ]

  it.each(SPOT_CHECKS)("places %s within 0.05 deg of its known position", (code, lat, lng) => {
    const a = getAirportCoords(code)!
    expect(a).toBeDefined()
    expect(Math.abs(a.lat - lat)).toBeLessThan(0.05)
    expect(Math.abs(a.lng - lng)).toBeLessThan(0.05)
  })

  it("keeps US airports in the northern and western hemispheres", () => {
    for (const code of ["GRR", "ORD", "MKE", "SEA", "MIA", "BOS", "ANC", "HNL"]) {
      const a = getAirportCoords(code)!
      expect(a.lat, code).toBeGreaterThan(0)
      expect(a.lng, code).toBeLessThan(0)
    }
  })

  it("keeps southern-hemisphere airports below the equator", () => {
    for (const code of ["SYD", "MEL", "AKL", "GRU", "EZE", "SCL", "JNB", "CPT", "DPS"]) {
      expect(getAirportCoords(code)!.lat, code).toBeLessThan(0)
    }
  })

  it("covers every code referenced by the terminal-map table", () => {
    // Keys of AIRPORT_MAPS in src/components/airport-info.tsx. If that table
    // grows, this list should grow with it — a miss means a flight renders a
    // terminal map link but no drive-time estimate.
    const AIRPORT_MAP_CODES = [
      "JFK", "LAX", "ORD", "ATL", "DFW", "SFO", "DEN", "IAH", "HOU", "AUS", "SAT", "GRR",
      "MIA", "BOS", "SEA", "MSP", "DTW", "PHL", "LGA", "EWR", "CLT", "PHX", "SAN", "IAD",
      "DCA", "MCO", "BWI", "SLC", "PDX", "BNA", "RDU", "FLL", "TPA", "HNL", "STL", "MCI",
      "LHR", "CDG", "FRA", "AMS", "NRT", "HND", "SYD", "FCO", "MAD", "BCN", "MUC", "DUB",
      "IST", "HKG", "SIN", "ICN", "DXB", "DOH", "YYZ", "YVR", "MEX", "CUN", "LIS", "CPH",
      "ZRH",
    ]
    const missing = AIRPORT_MAP_CODES.filter((c) => !getAirportCoords(c))
    expect(missing).toEqual([])
  })
})
