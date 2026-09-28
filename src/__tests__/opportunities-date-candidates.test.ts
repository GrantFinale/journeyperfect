import { describe, it, expect } from "vitest"
import { generateDateCandidates, normaliseWeekdayPattern } from "@/lib/opportunities/date-candidates"
import { formatStayLabel, monthsInRange, weekday, weekIndex } from "@/lib/opportunities/dates"

describe("dates helpers", () => {
  it("labels a stay inside one month", () => {
    expect(formatStayLabel("2026-11-12", "2026-11-15")).toBe("Thu 12 – Sun 15 Nov")
  })
  it("labels a stay crossing a month boundary", () => {
    expect(formatStayLabel("2026-10-30", "2026-11-02")).toBe("Fri 30 Oct – Mon 2 Nov")
  })
  it("lists the months a window touches", () => {
    expect(monthsInRange("2026-10-25", "2026-12-02")).toEqual([10, 11, 12])
  })
  it("groups Monday..Sunday into one week", () => {
    expect(weekIndex("2026-11-09")).toBe(weekIndex("2026-11-15")) // Mon..Sun
    expect(weekIndex("2026-11-16")).toBe(weekIndex("2026-11-09") + 1)
  })
})

describe("generateDateCandidates", () => {
  const base = { windowStart: "2026-10-01", windowEnd: "2026-11-15", nightsMin: 3, nightsMax: 4, cap: 6 }

  it("never exceeds the cap and dedupes identical stays", () => {
    const out = generateDateCandidates({ ...base, weekdayPattern: null })
    expect(out.length).toBeLessThanOrEqual(6)
    const keys = new Set(out.map((d) => `${d.checkIn}|${d.checkOut}`))
    expect(keys.size).toBe(out.length)
  })

  it("prefers long-weekend shapes and spreads across weeks when no pattern is given", () => {
    const out = generateDateCandidates({ ...base, weekdayPattern: null })
    expect(out).toHaveLength(6)
    // Every pick is a Thursday check-in (best free-form rank) ...
    for (const d of out) expect(weekday(d.checkIn)).toBe(4)
    // ... and each is a different calendar week.
    expect(new Set(out.map((d) => weekIndex(d.checkIn))).size).toBe(6)
    expect(out[0].label).toMatch(/^Thu \d+ – (Sun|Mon) \d+ Oct$/)
  })

  it("honours an explicit weekday pattern", () => {
    const out = generateDateCandidates({ ...base, weekdayPattern: "FRI-MON" })
    expect(out.length).toBeGreaterThan(0)
    for (const d of out) expect(weekday(d.checkIn)).toBe(5)
    // The pattern's own length (3 nights) is preferred over the 4-night variant.
    expect(out.filter((d) => d.nights === 3).length).toBeGreaterThanOrEqual(out.filter((d) => d.nights === 4).length)
  })

  it("accepts the UI's underscore encoding and lower case", () => {
    expect(normaliseWeekdayPattern("THU_SUN")).toBe("THU-SUN")
    expect(normaliseWeekdayPattern("sat_tue")).toBe("SAT-TUE")
    expect(normaliseWeekdayPattern("FRI-MON")).toBe("FRI-MON")
    expect(normaliseWeekdayPattern("ANY")).toBeNull()
    expect(normaliseWeekdayPattern(null)).toBeNull()
    const dashed = generateDateCandidates({ ...base, weekdayPattern: "SAT-TUE" })
    const underscored = generateDateCandidates({ ...base, weekdayPattern: "SAT_TUE" })
    expect(underscored).toEqual(dashed)
    for (const d of underscored) expect(weekday(d.checkIn)).toBe(6)
  })

  it("respects the nights range and the window end", () => {
    const out = generateDateCandidates({ windowStart: "2026-11-10", windowEnd: "2026-11-16", nightsMin: 2, nightsMax: 5, weekdayPattern: null, cap: 20 })
    for (const d of out) {
      expect(d.nights).toBeGreaterThanOrEqual(2)
      expect(d.nights).toBeLessThanOrEqual(5)
      expect(d.checkOut <= "2026-11-16").toBe(true)
    }
  })

  it("returns nothing for an impossible window, a zero cap or bad input", () => {
    expect(generateDateCandidates({ windowStart: "2026-11-10", windowEnd: "2026-11-11", nightsMin: 3, nightsMax: 4, weekdayPattern: null, cap: 6 })).toEqual([])
    expect(generateDateCandidates({ ...base, weekdayPattern: null, cap: 0 })).toEqual([])
    expect(generateDateCandidates({ ...base, windowStart: "garbage", weekdayPattern: null })).toEqual([])
  })

  it("is deterministic", () => {
    const a = generateDateCandidates({ ...base, weekdayPattern: null })
    const b = generateDateCandidates({ ...base, weekdayPattern: null })
    expect(a).toEqual(b)
  })
})
