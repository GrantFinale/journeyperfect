import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/config", () => ({ getConfig: vi.fn() }))
import {
  DEFAULT_HILTON_SEARCH_URL_TEMPLATE,
  adultsForTravelerCount,
  buildGoRatesItems,
  goRatesItemKey,
  parseGoRatesItemKey,
  renderSearchUrl,
} from "@/lib/private-rates/go-rates-plan"
import { CONFIG_KEYS } from "@/lib/config-keys"
import type { PlanCandidate } from "@/lib/private-rates/plan-check"

function cand(over: Partial<PlanCandidate> & { id: string }): PlanCandidate {
  return {
    destinationIata: "ORD",
    destinationName: "Chicago, IL",
    destinationLat: 41.88,
    destinationLng: -87.63,
    checkIn: "2026-11-06",
    checkOut: "2026-11-08",
    stage: 2,
    pruned: false,
    score: 0.5,
    ...over,
  }
}

describe("adultsForTravelerCount", () => {
  it("clamps to 1..4", () => {
    expect(adultsForTravelerCount(0)).toBe(1)
    expect(adultsForTravelerCount(1)).toBe(1)
    expect(adultsForTravelerCount(3)).toBe(3)
    expect(adultsForTravelerCount(7)).toBe(4)
    expect(adultsForTravelerCount(Number.NaN)).toBe(1)
  })
})

describe("renderSearchUrl", () => {
  it("fills and URL-encodes every placeholder", () => {
    const url = renderSearchUrl(DEFAULT_HILTON_SEARCH_URL_TEMPLATE, {
      location: "St. Louis, MO & more",
      checkIn: "2026-11-06",
      checkOut: "2026-11-08",
      adults: 2,
    })!
    const u = new URL(url)
    expect(u.origin).toBe("https://www.hilton.com")
    expect(u.searchParams.get("query")).toBe("St. Louis, MO & more")
    expect(u.searchParams.get("arrivalDate")).toBe("2026-11-06")
    expect(u.searchParams.get("departureDate")).toBe("2026-11-08")
    expect(u.searchParams.get("room1NumAdults")).toBe("2")
    expect(u.searchParams.get("flexibleDates")).toBe("false")
  })

  it("supports {lat}/{lng} and leaves them empty when missing", () => {
    const t = "https://example.com/s?q={location}&lat={lat}&lng={lng}"
    expect(renderSearchUrl(t, { location: "X", checkIn: "a", checkOut: "b", adults: 1, lat: 41.5, lng: -87.25 })).toBe(
      "https://example.com/s?q=X&lat=41.5&lng=-87.25",
    )
    expect(renderSearchUrl(t, { location: "X", checkIn: "a", checkOut: "b", adults: 1 })).toBe("https://example.com/s?q=X&lat=&lng=")
  })

  it("refuses non-https or unparsable results", () => {
    expect(renderSearchUrl("http://hilton.com/?q={location}", { location: "X", checkIn: "a", checkOut: "b", adults: 1 })).toBeNull()
    expect(renderSearchUrl("javascript:alert({location})", { location: "X", checkIn: "a", checkOut: "b", adults: 1 })).toBeNull()
    expect(renderSearchUrl("{location}", { location: "X", checkIn: "a", checkOut: "b", adults: 1 })).toBeNull()
  })

  it("matches the documented config default", () => {
    expect(CONFIG_KEYS["privateRates.hilton.searchUrlTemplate"].default).toBe(DEFAULT_HILTON_SEARCH_URL_TEMPLATE)
    expect(CONFIG_KEYS["privateRates.hilton.searchUrlTemplate"].group).toBe("privateRates")
  })
})

describe("item keys", () => {
  it("round-trips", () => {
    const key = goRatesItemKey("ORD", "2026-11-06", "2026-11-08")
    expect(key).toBe("ORD|2026-11-06|2026-11-08")
    expect(parseGoRatesItemKey(key)).toEqual({ iata: "ORD", checkIn: "2026-11-06", checkOut: "2026-11-08" })
  })
  it("rejects junk", () => {
    for (const bad of [undefined, 1, "", "ORD", "ord|2026-11-06|2026-11-08", "ORD|2026-11-08|2026-11-06", "ORD|2026-11-06|x", "ORD|a|b|c"]) {
      expect(parseGoRatesItemKey(bad)).toBeNull()
    }
  })
})

describe("buildGoRatesItems", () => {
  it("groups by destination + dates, best score first, capped at maxItems", () => {
    const items = buildGoRatesItems(
      [
        cand({ id: "a", score: 0.2 }),
        cand({ id: "b", score: 0.9 }), // same group as a
        cand({ id: "c", destinationIata: "MIA", destinationName: "Miami, FL", score: 0.95 }),
        cand({ id: "d", destinationIata: "DEN", destinationName: "Denver, CO", score: 0.1 }),
        cand({ id: "e", destinationIata: "SFO", destinationName: "San Francisco", score: 0.99, pruned: true }),
      ],
      { maxItems: 2, travelerCount: 3 },
    )
    expect(items.map((i) => i.key)).toEqual(["MIA|2026-11-06|2026-11-08", "ORD|2026-11-06|2026-11-08"])
    expect(items[0]).toMatchObject({ location: "Miami, FL", checkIn: "2026-11-06", checkOut: "2026-11-08", lat: 41.88, lng: -87.63 })
    expect(new URL(items[0].url).searchParams.get("room1NumAdults")).toBe("3")
  })

  it("prefers stage >= 2 and falls back to stage >= 1", () => {
    const only1 = buildGoRatesItems([cand({ id: "a", stage: 1 })], { maxItems: 8, travelerCount: 1 })
    expect(only1).toHaveLength(1)
    const mixed = buildGoRatesItems(
      [cand({ id: "a", stage: 1, destinationIata: "MIA" }), cand({ id: "b", stage: 2 })],
      { maxItems: 8, travelerCount: 1 },
    )
    expect(mixed.map((i) => i.key)).toEqual(["ORD|2026-11-06|2026-11-08"])
  })

  it("uses a custom template and falls back to the default when it is invalid", () => {
    const custom = buildGoRatesItems([cand({ id: "a" })], { maxItems: 8, travelerCount: 2, urlTemplate: "https://www.hilton.com/x?q={location}&a={adults}" })
    expect(custom[0].url).toBe("https://www.hilton.com/x?q=Chicago%2C%20IL&a=2")
    const broken = buildGoRatesItems([cand({ id: "a" })], { maxItems: 8, travelerCount: 2, urlTemplate: "http://evil/{location}" })
    expect(broken[0].url.startsWith("https://www.hilton.com/en/search/?query=Chicago")).toBe(true)
  })

  it("returns nothing for no candidates or a zero cap", () => {
    expect(buildGoRatesItems([], { maxItems: 8, travelerCount: 1 })).toEqual([])
    expect(buildGoRatesItems([cand({ id: "a" })], { maxItems: 0, travelerCount: 1 })).toEqual([])
  })
})
