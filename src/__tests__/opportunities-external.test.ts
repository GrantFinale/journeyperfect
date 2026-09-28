import { describe, it, expect } from "vitest"
import { buildTicketmasterUrl, classifyEvent, mapTicketmasterResponse } from "@/lib/events"
import { parseProfileResponse } from "@/lib/opportunities/destination-profile-ai"
import { buildArchiveUrl, summariseArchive } from "@/lib/weather-climate"

describe("events (Ticketmaster mapping)", () => {
  it("maps the Discovery payload to summaries, classifies and dedupes", () => {
    const out = mapTicketmasterResponse({
      _embedded: {
        events: [
          { name: "Orlando Magic vs. Boston Celtics", url: "https://tm.test/1", dates: { start: { localDate: "2026-11-13" } }, classifications: [{ segment: { name: "Sports" } }], _embedded: { venues: [{ name: "Kia Center" }] } },
          { name: "Orlando Magic vs. Boston Celtics", dates: { start: { localDate: "2026-11-13" } } }, // duplicate
          { name: "EDC Orlando", dates: { start: { dateTime: "2026-11-14T22:00:00Z" } }, classifications: [{ segment: { name: "Music" }, genre: { name: "Dance/Electronic" } }] },
          { name: "Winter Garden Craft Fair", dates: { start: { localDate: "2026-11-14" } }, classifications: [{ segment: { name: "Miscellaneous" } }] },
          { name: "Broken", dates: {} },
          { name: "Cirque", dates: { start: { localDate: "2026-11-15" } }, classifications: [{ segment: { name: "Arts & Theatre" } }] },
        ],
      },
    })
    expect(out).toEqual([
      { title: "Orlando Magic vs. Boston Celtics", kind: "SPORTS", date: "2026-11-13", url: "https://tm.test/1", venue: "Kia Center" },
      { title: "EDC Orlando", kind: "CONCERT", date: "2026-11-14" },
      { title: "Winter Garden Craft Fair", kind: "FESTIVAL", date: "2026-11-14" },
      { title: "Cirque", kind: "EVENT", date: "2026-11-15" },
    ])
    expect(classifyEvent("Music", "Rock", "Summer Fest 2026")).toBe("FESTIVAL")
    expect(mapTicketmasterResponse(null)).toEqual([])
    expect(mapTicketmasterResponse({})).toEqual([])
  })

  it("builds the documented URL", () => {
    const url = new URL(buildTicketmasterUrl({ apiKey: "k", lat: 28.4312, lng: -81.3081, startDate: "2026-11-12", endDate: "2026-11-15" }))
    expect(url.origin + url.pathname).toBe("https://app.ticketmaster.com/discovery/v2/events.json")
    expect(url.searchParams.get("apikey")).toBe("k")
    expect(url.searchParams.get("latlong")).toBe("28.4312,-81.3081")
    expect(url.searchParams.get("radius")).toBe("40")
    expect(url.searchParams.get("unit")).toBe("km")
    expect(url.searchParams.get("startDateTime")).toBe("2026-11-12T00:00:00Z")
    expect(url.searchParams.get("endDateTime")).toBe("2026-11-15T23:59:59Z")
    expect(url.searchParams.get("size")).toBe("20")
    expect(url.searchParams.get("sort")).toBe("relevance,desc")
  })
})

describe("weather-climate (Open-Meteo archive)", () => {
  it("averages two years of daily rows into a HISTORICAL summary", () => {
    const y1 = { daily: { time: ["2024-11-12", "2024-11-13", "2024-11-14"], temperature_2m_max: [80, 78, 76], temperature_2m_min: [60, 58, 62], precipitation_sum: [0, 5.2, 0.4] } }
    const y2 = { daily: { time: ["2025-11-12", "2025-11-13", "2025-11-14"], temperature_2m_max: [82, 74, null], temperature_2m_min: [61, 55, null], precipitation_sum: [0, 0, 12] } }
    const s = summariseArchive([y1, y2], [2024, 2025])!
    expect(s.source).toBe("HISTORICAL")
    expect(s.sampledDays).toBe(5)
    expect(s.highF).toBe(Math.round((80 + 78 + 76 + 82 + 74) / 5))
    expect(s.lowF).toBe(Math.round((60 + 58 + 62 + 61 + 55) / 5))
    expect(s.precipDays).toBe(1) // only the 5.2 mm day; the 12 mm day had no temperature and is skipped
    expect(s.precipPct).toBe(20)
    expect(s.yearsSampled).toEqual([2024, 2025])
    expect(summariseArchive([null, {}], [2024, 2025])).toBeNull()
  })
  it("builds the archive URL in Fahrenheit", () => {
    const url = new URL(buildArchiveUrl(28.4312, -81.3081, "2024-11-12", "2024-11-15"))
    expect(url.origin + url.pathname).toBe("https://archive-api.open-meteo.com/v1/archive")
    expect(url.searchParams.get("temperature_unit")).toBe("fahrenheit")
    expect(url.searchParams.get("start_date")).toBe("2024-11-12")
    expect(url.searchParams.get("daily")).toBe("temperature_2m_max,temperature_2m_min,precipitation_sum")
  })
})

describe("destination-profile-ai parsing", () => {
  const good = {
    name: "Orlando",
    tier: "MID",
    idealNightsMin: 4,
    idealNightsMax: 7,
    walkable: false,
    carNeeded: false,
    airportToCenterKm: 25,
    parkingTypical: "EXPENSIVE",
    activitiesDispersed: true,
    familyFit: { tags: ["theme-parks"], byAgeBand: { "0-5": 3, "6-12": 3, "13-17": 3, adult: 2 }, indoorRatio: 0.3 },
    anchors: [
      { title: "Walt Disney World", kind: "THEME_PARK", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], weatherDependent: false },
      { title: "EPCOT Festival", kind: "FESTIVAL", months: [3, 4, 5], weatherDependent: false },
    ],
    climate: { monthly: Array.from({ length: 12 }, (_, i) => ({ m: i + 1, highF: 70 + i, lowF: 50 + i, precipDays: 7 })) },
  }
  it("accepts a fenced JSON answer and pins iata/coordinates to the airport table", () => {
    const p = parseProfileResponse("```json\n" + JSON.stringify({ ...good, iata: "WRONG", lat: 0, lng: 0 }) + "\n```", "MCO", 28.4312, -81.3081)
    expect(p.iata).toBe("MCO")
    expect(p.lat).toBe(28.4312)
    expect(p.climate).toHaveLength(12)
    expect(p.anchors[0].rawKind).toBe("THEME_PARK")
  })
  it("rejects incomplete answers", () => {
    expect(() => parseProfileResponse("not json", "MCO", 1, 1)).toThrow(/valid JSON/)
    expect(() => parseProfileResponse(JSON.stringify({ ...good, anchors: [good.anchors[0]] }), "MCO", 1, 1)).toThrow(/two anchors/)
    expect(() => parseProfileResponse(JSON.stringify({ ...good, climate: null }), "MCO", 1, 1)).toThrow(/climate/)
    expect(() => parseProfileResponse(JSON.stringify({ ...good, familyFit: { tags: [], byAgeBand: { adult: 3 } } }), "MCO", 1, 1)).toThrow(/age bands/)
  })
})
