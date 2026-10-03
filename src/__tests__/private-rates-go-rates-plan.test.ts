import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/config", () => ({ getConfig: vi.fn() }))
import {
  DEFAULT_HILTON_PUBLIC_SEARCH_URL_TEMPLATE,
  DEFAULT_HILTON_SEARCH_URL_TEMPLATE,
  DEFAULT_MARRIOTT_PUBLIC_SEARCH_URL_TEMPLATE,
  DEFAULT_MARRIOTT_SEARCH_URL_TEMPLATE,
  GO_RATES_MAX_ITEMS,
  adultsForTravelerCount,
  buildGoRatesItems,
  goRatesItemKey,
  parseGoRatesItemKey,
  renderSearchUrl,
  ymdToMdy,
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

describe("renderSearchUrl: MDY dates, rate code, brand host", () => {
  const v = { location: "Chicago, IL", checkIn: "2026-11-06", checkOut: "2026-11-08", adults: 2, rateCode: "MMF" }

  it("formats MM/DD/YYYY and fills {rateCode}, URL-encoded", () => {
    expect(ymdToMdy("2026-11-06")).toBe("11/06/2026")
    expect(ymdToMdy("11/06/2026")).toBe("")
    const url = renderSearchUrl(DEFAULT_MARRIOTT_SEARCH_URL_TEMPLATE, v, "www.marriott.com")!
    expect(url).toContain("fromDate=11%2F06%2F2026&toDate=11%2F08%2F2026")
    const u = new URL(url)
    expect(u.searchParams.get("destinationAddress.destination")).toBe("Chicago, IL")
    expect(u.searchParams.get("fromDate")).toBe("11/06/2026")
    expect(u.searchParams.get("toDate")).toBe("11/08/2026")
    expect(u.searchParams.get("numAdultsPerRoom")).toBe("2")
    expect(u.searchParams.get("clusterCode")).toBe("corp")
    expect(u.searchParams.get("corporateCode")).toBe("MMF")
    const pub = new URL(renderSearchUrl(DEFAULT_MARRIOTT_PUBLIC_SEARCH_URL_TEMPLATE, v, "www.marriott.com")!)
    expect(pub.searchParams.has("corporateCode")).toBe(false)
    expect(pub.searchParams.has("clusterCode")).toBe(false)
    expect(renderSearchUrl("https://www.marriott.com/x?c={rateCode}&d={checkInMDY}", { ...v, rateCode: "A&B" })).toBe(
      "https://www.marriott.com/x?c=A%26B&d=11%2F06%2F2026",
    )
  })

  it("refuses a URL off the brand's own host", () => {
    expect(renderSearchUrl(DEFAULT_HILTON_SEARCH_URL_TEMPLATE, v, "www.marriott.com")).toBeNull()
    expect(renderSearchUrl("https://evil.example/?q={location}", v, "www.hilton.com")).toBeNull()
    expect(renderSearchUrl("https://user:pw@www.hilton.com/?q={location}", v, "www.hilton.com")).toBeNull()
    expect(renderSearchUrl(DEFAULT_HILTON_PUBLIC_SEARCH_URL_TEMPLATE, v, "www.hilton.com")).toContain("redeemPts=false")
  })

  it("matches the documented config defaults", () => {
    expect(CONFIG_KEYS["privateRates.hilton.publicSearchUrlTemplate"].default).toBe(DEFAULT_HILTON_PUBLIC_SEARCH_URL_TEMPLATE)
    expect(CONFIG_KEYS["privateRates.marriott.searchUrlTemplate"].default).toBe(DEFAULT_MARRIOTT_SEARCH_URL_TEMPLATE)
    expect(CONFIG_KEYS["privateRates.marriott.publicSearchUrlTemplate"].default).toBe(DEFAULT_MARRIOTT_PUBLIC_SEARCH_URL_TEMPLATE)
    expect(CONFIG_KEYS["privateRates.marriott.rateCode"]).toMatchObject({ default: "", secret: true, group: "privateRates" })
    expect(CONFIG_KEYS["privateRates.maxCaptureTabs"].default).toBe(String(GO_RATES_MAX_ITEMS))
  })
})

describe("item keys", () => {
  it("round-trips the 5-part key", () => {
    const key = goRatesItemKey("ORD", "2026-11-06", "2026-11-08", "marriott", "PUBLIC")
    expect(key).toBe("ORD|2026-11-06|2026-11-08|marriott|PUBLIC")
    expect(parseGoRatesItemKey(key)).toEqual({ iata: "ORD", checkIn: "2026-11-06", checkOut: "2026-11-08", brand: "marriott", intent: "PUBLIC" })
    expect(goRatesItemKey("ORD", "2026-11-06", "2026-11-08")).toBe("ORD|2026-11-06|2026-11-08|hilton|PRIVATE")
  })
  it("parses the legacy 3-part key as hilton PRIVATE", () => {
    expect(parseGoRatesItemKey("ORD|2026-11-06|2026-11-08")).toEqual({
      iata: "ORD",
      checkIn: "2026-11-06",
      checkOut: "2026-11-08",
      brand: "hilton",
      intent: "PRIVATE",
    })
  })
  it("rejects junk", () => {
    for (const bad of [
      undefined,
      1,
      "",
      "ORD",
      "ord|2026-11-06|2026-11-08",
      "ORD|2026-11-08|2026-11-06",
      "ORD|2026-11-06|x",
      "ORD|a|b|c",
      "ORD|2026-11-06|2026-11-08|ihg|PRIVATE",
      "ORD|2026-11-06|2026-11-08|hilton|private",
      "ORD|2026-11-06|2026-11-08|hilton",
      "ORD|2026-11-06|2026-11-08|hilton|PUBLIC|x",
    ]) {
      expect(parseGoRatesItemKey(bad)).toBeNull()
    }
  })
})

describe("buildGoRatesItems", () => {
  const both = { hilton: {}, marriott: { rateCode: "MMF" } }

  it("emits hilton PRIVATE, hilton PUBLIC, marriott PRIVATE, marriott PUBLIC per group, best group first", () => {
    const items = buildGoRatesItems(
      [
        cand({ id: "a", score: 0.2 }),
        cand({ id: "b", score: 0.9 }), // same group as a
        cand({ id: "c", destinationIata: "MIA", destinationName: "Miami, FL", score: 0.95 }),
        cand({ id: "e", destinationIata: "SFO", destinationName: "San Francisco", score: 0.99, pruned: true }),
      ],
      { maxItems: 24, travelerCount: 3, brands: both },
    )
    expect(items.map((i) => i.key)).toEqual([
      "MIA|2026-11-06|2026-11-08|hilton|PRIVATE",
      "MIA|2026-11-06|2026-11-08|hilton|PUBLIC",
      "MIA|2026-11-06|2026-11-08|marriott|PRIVATE",
      "MIA|2026-11-06|2026-11-08|marriott|PUBLIC",
      "ORD|2026-11-06|2026-11-08|hilton|PRIVATE",
      "ORD|2026-11-06|2026-11-08|hilton|PUBLIC",
      "ORD|2026-11-06|2026-11-08|marriott|PRIVATE",
      "ORD|2026-11-06|2026-11-08|marriott|PUBLIC",
    ])
    expect(items[0]).toMatchObject({ brand: "hilton", intent: "PRIVATE", location: "Miami, FL", checkIn: "2026-11-06", checkOut: "2026-11-08", lat: 41.88, lng: -87.63 })
    expect(new URL(items[0].url).searchParams.get("room1NumAdults")).toBe("3")
    expect(new URL(items[1].url).searchParams.get("redeemPts")).toBe("false")
    expect(new URL(items[2].url).host).toBe("www.marriott.com")
    expect(new URL(items[2].url).searchParams.get("corporateCode")).toBe("MMF")
    expect(new URL(items[3].url).searchParams.has("corporateCode")).toBe(false)
  })

  it("filters by entitlement: only the brands passed, and Marriott only with a rate code", () => {
    const c = [cand({ id: "a" })]
    const hiltonOnly = buildGoRatesItems(c, { maxItems: 24, travelerCount: 1, brands: { hilton: {} } })
    expect(hiltonOnly.map((i) => `${i.brand}|${i.intent}`)).toEqual(["hilton|PRIVATE", "hilton|PUBLIC"])
    const marriottOnly = buildGoRatesItems(c, { maxItems: 24, travelerCount: 1, brands: { marriott: { rateCode: " MMF " } } })
    expect(marriottOnly.map((i) => `${i.brand}|${i.intent}`)).toEqual(["marriott|PRIVATE", "marriott|PUBLIC"])
    expect(new URL(marriottOnly[0].url).searchParams.get("corporateCode")).toBe("MMF")
    expect(buildGoRatesItems(c, { maxItems: 24, travelerCount: 1, brands: { marriott: { rateCode: "" } } })).toEqual([])
    expect(buildGoRatesItems(c, { maxItems: 24, travelerCount: 1, brands: { hilton: {}, marriott: { rateCode: "  " } } })).toHaveLength(2)
    expect(buildGoRatesItems(c, { maxItems: 24, travelerCount: 1, brands: {} })).toEqual([])
  })

  it("caps total items, dropping lowest-ranked groups whole (never splitting a private/public pair)", () => {
    const many = Array.from({ length: 10 }, (_, i) => cand({ id: `g${i}`, destinationIata: `X${String(i).padStart(2, "0")}`, score: 1 - i / 10 }))
    const six = buildGoRatesItems(many, { maxItems: 6, travelerCount: 1, brands: both })
    expect(six).toHaveLength(4) // one full group of four; a second would need 8
    expect(new Set(six.map((i) => i.key.split("|")[0]))).toEqual(new Set(["X00"]))
    const capped = buildGoRatesItems(many, { maxItems: 100, travelerCount: 1, brands: both })
    expect(capped).toHaveLength(GO_RATES_MAX_ITEMS) // 6 groups × 4, hard max 24
    expect(capped.map((i) => i.key.split("|")[0])).toEqual(["X00", "X01", "X02", "X03", "X04", "X05"].flatMap((g) => [g, g, g, g]))
    const hiltonFive = buildGoRatesItems(many, { maxItems: 5, travelerCount: 1, brands: { hilton: {} } })
    expect(hiltonFive.map((i) => i.key.split("|").slice(0, 1).concat(i.intent).join("|"))).toEqual([
      "X00|PRIVATE",
      "X00|PUBLIC",
      "X01|PRIVATE",
      "X01|PUBLIC",
    ])
    // Every PRIVATE item has its PUBLIC twin.
    for (const list of [six, capped, hiltonFive]) {
      const keys = new Set(list.map((i) => i.key))
      for (const i of list) expect(keys.has(i.key.replace(/\|(PRIVATE|PUBLIC)$/, i.intent === "PRIVATE" ? "|PUBLIC" : "|PRIVATE"))).toBe(true)
    }
  })

  it("prefers stage >= 2 and falls back to stage >= 1", () => {
    const only1 = buildGoRatesItems([cand({ id: "a", stage: 1 })], { maxItems: 8, travelerCount: 1 })
    expect(only1).toHaveLength(2)
    const mixed = buildGoRatesItems(
      [cand({ id: "a", stage: 1, destinationIata: "MIA" }), cand({ id: "b", stage: 2 })],
      { maxItems: 8, travelerCount: 1 },
    )
    expect(mixed.map((i) => i.key)).toEqual(["ORD|2026-11-06|2026-11-08|hilton|PRIVATE", "ORD|2026-11-06|2026-11-08|hilton|PUBLIC"])
  })

  it("uses custom templates on the brand's host and falls back to the default otherwise", () => {
    const custom = buildGoRatesItems([cand({ id: "a" })], {
      maxItems: 8,
      travelerCount: 2,
      brands: {
        hilton: { privateTemplate: "https://www.hilton.com/x?q={location}&a={adults}", publicTemplate: "https://www.hilton.com/p?q={location}" },
        marriott: { rateCode: "MMF", privateTemplate: "https://www.marriott.com/s?d={checkInMDY}&c={rateCode}", publicTemplate: "https://www.hilton.com/oops" },
      },
    })
    expect(custom.map((i) => i.url)).toEqual([
      "https://www.hilton.com/x?q=Chicago%2C%20IL&a=2",
      "https://www.hilton.com/p?q=Chicago%2C%20IL",
      "https://www.marriott.com/s?d=11%2F06%2F2026&c=MMF",
      expect.stringMatching(/^https:\/\/www\.marriott\.com\/search\/findHotels\.mi\?/), // wrong host → default
    ])
    const broken = buildGoRatesItems([cand({ id: "a" })], { maxItems: 8, travelerCount: 2, urlTemplate: "http://evil/{location}" })
    expect(broken[0].url.startsWith("https://www.hilton.com/en/search/?query=Chicago")).toBe(true)
  })

  it("returns nothing for no candidates or a zero cap", () => {
    expect(buildGoRatesItems([], { maxItems: 8, travelerCount: 1 })).toEqual([])
    expect(buildGoRatesItems([cand({ id: "a" })], { maxItems: 0, travelerCount: 1 })).toEqual([])
    expect(buildGoRatesItems([cand({ id: "a" })], { maxItems: 1, travelerCount: 1 })).toEqual([])
  })
})
