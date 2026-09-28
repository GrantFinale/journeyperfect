/**
 * Stage 0: bounded date-window generator. See
 * docs/plans/opportunity-discovery-engine.md §3 (STAGE 0) and §5
 * (flexible-date arbitrage relies on several windows per destination).
 *
 * Pure. Never produces more than `cap` windows, dedupes identical stays, and
 * when the user states no weekday preference it favours long-weekend shapes
 * (Thu or Fri check-in) while spreading picks across the calendar weeks in
 * the window so the arbitrage comparison has something to compare.
 */
import type { DateCandidate } from "./types"
import { addDays, daysBetween, formatStayLabel, isYmd, weekIndex, weekday } from "./dates"

export type WeekdayPattern = "THU-SUN" | "FRI-MON" | "SAT-TUE"

export const WEEKDAY_PATTERNS: readonly WeekdayPattern[] = ["THU-SUN", "FRI-MON", "SAT-TUE"]

/** Check-in weekday (0 = Sun) and the nights a pattern implies. */
const PATTERN_SHAPE: Record<WeekdayPattern, { checkInDow: number; nights: number }> = {
  "THU-SUN": { checkInDow: 4, nights: 3 },
  "FRI-MON": { checkInDow: 5, nights: 3 },
  "SAT-TUE": { checkInDow: 6, nights: 3 },
}

/**
 * Accepts both encodings in use: "THU-SUN" (this module, the plan) and
 * "THU_SUN" (the Opportunities UI). Case-insensitive. Returns null for
 * anything else, including "" and "ANY".
 */
export function normaliseWeekdayPattern(value: unknown): WeekdayPattern | null {
  if (typeof value !== "string") return null
  const v = value.trim().toUpperCase().replace(/_/g, "-")
  return (WEEKDAY_PATTERNS as readonly string[]).includes(v) ? (v as WeekdayPattern) : null
}

export function isWeekdayPattern(value: unknown): value is WeekdayPattern | string {
  return normaliseWeekdayPattern(value) != null
}

export interface DateCandidateInput {
  /** YYYY-MM-DD, first allowed check-in */
  windowStart: string
  /** YYYY-MM-DD, last allowed check-out */
  windowEnd: string
  nightsMin: number
  nightsMax: number
  weekdayPattern?: WeekdayPattern | string | null
  /** Hard ceiling on windows returned (config opportunities.maxDateCandidates) */
  cap: number
}

interface Scored {
  candidate: DateCandidate
  /** Lower is better */
  rank: number
  week: number
}

/**
 * Preference rank when no pattern is stated. Long weekends first: a Thursday
 * or Friday check-in with 3–4 nights is what "a free 3- or 4-day weekend"
 * means in practice. Saturday starts next, then anything else.
 */
function freeformRank(checkInDow: number, nights: number): number {
  const longWeekend = (checkInDow === 4 || checkInDow === 5) && nights >= 3 && nights <= 4
  if (longWeekend) return checkInDow === 4 ? 0 : 1 // Thu beats Fri: one more night for one less fare day
  if (checkInDow === 6 && nights <= 4) return 2
  if (checkInDow === 4 || checkInDow === 5) return 3
  return 4 + Math.min(nights, 9) / 10
}

export function generateDateCandidates(input: DateCandidateInput): DateCandidate[] {
  const { windowStart, windowEnd } = input
  if (!isYmd(windowStart) || !isYmd(windowEnd)) return []
  const cap = Math.max(0, Math.floor(input.cap))
  if (cap === 0) return []

  const nightsMin = Math.max(1, Math.floor(input.nightsMin))
  const nightsMax = Math.max(nightsMin, Math.floor(input.nightsMax))
  const span = daysBetween(windowStart, windowEnd)
  if (span < nightsMin) return []

  const pattern = normaliseWeekdayPattern(input.weekdayPattern)
  const shape = pattern ? PATTERN_SHAPE[pattern] : null

  const seen = new Set<string>()
  const scored: Scored[] = []

  for (let offset = 0; offset <= span; offset++) {
    const checkIn = addDays(windowStart, offset)
    const dow = weekday(checkIn)
    if (shape && dow !== shape.checkInDow) continue

    for (let nights = nightsMin; nights <= nightsMax; nights++) {
      const checkOut = addDays(checkIn, nights)
      if (daysBetween(checkOut, windowEnd) < 0) break
      const key = `${checkIn}|${checkOut}`
      if (seen.has(key)) continue
      seen.add(key)

      const rank = shape
        ? Math.abs(nights - shape.nights) // the pattern's own length first, then nearest
        : freeformRank(dow, nights)

      scored.push({
        candidate: { checkIn, checkOut, nights, label: formatStayLabel(checkIn, checkOut) },
        rank,
        week: weekIndex(checkIn),
      })
    }
  }

  if (scored.length === 0) return []

  // Best shape first inside each week; ties broken by date so output is stable.
  scored.sort((a, b) => a.rank - b.rank || a.candidate.checkIn.localeCompare(b.candidate.checkIn) || a.candidate.nights - b.candidate.nights)

  // Round-robin across calendar weeks so six picks are six different weekends,
  // not six variants of the first one.
  const byWeek = new Map<number, Scored[]>()
  for (const s of scored) {
    const list = byWeek.get(s.week) ?? []
    list.push(s)
    byWeek.set(s.week, list)
  }
  const weeks = [...byWeek.keys()].sort((a, b) => a - b)

  const picked: DateCandidate[] = []
  let round = 0
  while (picked.length < cap) {
    let addedThisRound = false
    for (const w of weeks) {
      const list = byWeek.get(w)!
      const s = list[round]
      if (!s) continue
      picked.push(s.candidate)
      addedThisRound = true
      if (picked.length >= cap) break
    }
    if (!addedThisRound) break
    round++
  }

  picked.sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.nights - b.nights)
  return picked
}
