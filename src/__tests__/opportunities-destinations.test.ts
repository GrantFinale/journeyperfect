import { describe, it, expect } from "vitest"
import profilesSeed from "@/data/destination-profiles.json"
import {
  applyDiversity,
  isWarmIn,
  normaliseClimate,
  normaliseProfile,
  pickBestRoute,
  selectDestinations,
  type NonstopRouteRow,
  type NormalisedProfile,
} from "@/lib/opportunities/destinations"

const DTW = { lat: 42.2124, lng: -83.3534 }

const profiles = (profilesSeed as unknown[]).map(normaliseProfile).filter((p): p is NormalisedProfile => p != null)
const byIata = new Map(profiles.map((p) => [p.iata, p]))

function route(dest: string, mins: number, origin = "DTW"): NonstopRouteRow {
  return { originIata: origin, destIata: dest, carriers: ["DL"], typicalDurationMins: mins, weeklyFrequency: null, departureBuckets: [], source: "OPENFLIGHTS_SEED" }
}

const routes: NonstopRouteRow[] = [
  route("MCO", 165), route("TPA", 160), route("FLL", 175), route("MIA", 180), route("RSW", 170), route("PBI", 175), route("JAX", 130),
  route("LAS", 260), route("PHX", 250), route("DEN", 190), route("ORD", 75), route("BOS", 110), route("CUN", 220), route("SJU", 260),
  route("MCO", 150, "FNT"), // a second origin with a shorter MCO flight
]

describe("normaliseProfile", () => {
  it("normalises every seed profile", () => {
    expect(profiles.length).toBe((profilesSeed as unknown[]).length)
    const mco = byIata.get("MCO")!
    expect(mco.name).toBe("Orlando")
    expect(mco.tier).toBe("MID")
    expect(mco.familyFit.byAgeBand["6-12"]).toBe(3)
    expect(mco.climate).toHaveLength(12)
  })

  it("maps seed anchor kinds onto the plan enum while keeping the raw kind", () => {
    const mco = byIata.get("MCO")!
    const disney = mco.anchors.find((a) => a.title.startsWith("Walt Disney"))!
    expect(disney.kind).toBe("OTHER")
    expect(disney.rawKind).toBe("THEME_PARK")
    const las = byIata.get("LAS")!
    expect(las.anchors.find((a) => a.rawKind === "NATURE")!.kind).toBe("NATURAL")
  })

  it("converts precipDays to a percentage and accepts the plan's ClimateMonth shape too", () => {
    const seed = normaliseClimate({ monthly: [{ m: 1, highF: 70, lowF: 50, precipDays: 31 }] })!
    expect(seed[0]).toEqual({ month: 1, highF: 70, lowF: 50, precipPct: 100 })
    const plan = normaliseClimate([{ month: 6, highF: 90, lowF: 70, precipPct: 40 }])!
    expect(plan[0].precipPct).toBe(40)
    expect(normaliseClimate(null)).toBeNull()
  })

  it("rejects records without the essentials", () => {
    expect(normaliseProfile({ iata: "XXX" })).toBeNull()
    expect(normaliseProfile({ iata: "TOOLONG", name: "x", lat: 1, lng: 1 })).toBeNull()
  })
})

describe("pickBestRoute", () => {
  it("chooses the shortest route across the origin airports", () => {
    expect(pickBestRoute(routes, ["DTW", "FNT"], "MCO")!.originIata).toBe("FNT")
    expect(pickBestRoute(routes, ["DTW"], "MCO")!.originIata).toBe("DTW")
    expect(pickBestRoute(routes, ["DTW"], "HNL")).toBeNull()
  })
})

describe("selectDestinations", () => {
  const caps = { maxDestinations: 12, drivingAlternativeMaxKm: 500 }
  const base = { originAirports: ["DTW"], originLat: DTW.lat, originLng: DTW.lng, routes, profiles, months: [11], caps }

  it("only proposes destinations with a nonstop route (or a drive) and caps the set", () => {
    const out = selectDestinations({ ...base, constraints: {} })
    expect(out.length).toBeLessThanOrEqual(12)
    for (const d of out) expect(d.route != null || d.drivable).toBe(true)
    expect(out.map((d) => d.profile.iata)).not.toContain("HNL")
  })

  it("applies the diversity rule so Florida does not fill the list", () => {
    const out = selectDestinations({ ...base, constraints: {}, caps: { ...caps, maxDestinations: 6 } })
    const florida = out.filter((d) => d.regions.includes("florida"))
    expect(florida.length).toBeLessThanOrEqual(3)
    expect(out.length).toBe(6)
  })

  it("is deterministic", () => {
    const a = selectDestinations({ ...base, constraints: {} }).map((d) => d.profile.iata)
    const b = selectDestinations({ ...base, constraints: {} }).map((d) => d.profile.iata)
    expect(a).toEqual(b)
  })

  it("filters by warm climate in the window's months", () => {
    expect(isWarmIn(byIata.get("MCO")!, [11])).toBe(true)
    expect(isWarmIn(byIata.get("BOS")!, [11])).toBe(false)
    const out = selectDestinations({ ...base, constraints: { warm: true }, months: [1] })
    expect(out.map((d) => d.profile.iata)).not.toContain("BOS")
    expect(out.map((d) => d.profile.iata)).not.toContain("DEN")
    expect(out.map((d) => d.profile.iata)).toContain("MIA")
  })

  it("filters by region tags and max flight minutes", () => {
    const carib = selectDestinations({ ...base, constraints: { regions: ["caribbean"] } })
    expect(carib.map((d) => d.profile.iata)).toEqual(["SJU"])
    const short = selectDestinations({ ...base, constraints: { maxFlightMins: 120 } })
    expect(short.map((d) => d.profile.iata).sort()).toEqual(["BOS", "ORD"])
  })

  it("adds drivable profiles without a nonstop when drivingOk", () => {
    // Chicago is ~380 km from Detroit; remove its route and make it drivable.
    const noOrd = routes.filter((r) => r.destIata !== "ORD")
    const without = selectDestinations({ ...base, routes: noOrd, constraints: {} })
    expect(without.map((d) => d.profile.iata)).not.toContain("ORD")
    const withDrive = selectDestinations({ ...base, routes: noOrd, constraints: { drivingOk: true } })
    const ord = withDrive.find((d) => d.profile.iata === "ORD")!
    expect(ord).toBeDefined()
    expect(ord.drivable).toBe(true)
    expect(ord.route).toBeNull()
  })

  it("never proposes the origin airport itself", () => {
    const out = selectDestinations({ ...base, originAirports: ["ORD"], constraints: {} })
    expect(out.map((d) => d.profile.iata)).not.toContain("ORD")
  })
})

describe("applyDiversity", () => {
  it("defers the fourth item from one region and fills afterwards", () => {
    const items = ["MCO", "TPA", "FLL", "MIA", "LAS", "DEN"].map((iata) => ({ profile: { iata } }))
    expect(applyDiversity(items, 5, 3).map((i) => i.profile.iata)).toEqual(["MCO", "TPA", "FLL", "LAS", "DEN"])
    expect(applyDiversity(items, 6, 3).map((i) => i.profile.iata)).toEqual(["MCO", "TPA", "FLL", "LAS", "DEN", "MIA"])
    expect(applyDiversity(items, 0, 3)).toEqual([])
  })
})
