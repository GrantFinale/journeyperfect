/**
 * Derive a TravelerSummary from TravelerProfile rows. Pure.
 *
 * Ages come from `birthDate`; when it is missing we fall back to the profile
 * tags ("child", "teen", "senior", "adult") with a representative age, and
 * record that the age was estimated so downstream text can hedge.
 */
import type { TravelerSummary } from "./types"

export interface TravelerProfileLike {
  birthDate?: Date | string | null
  tags?: string[] | null
  /** TravelerProfile.preferences Json: { activities?: Record<string, number>, ... } */
  preferences?: unknown
}

/** Representative ages when only a tag is known. */
const TAG_AGE: Record<string, number> = {
  infant: 1,
  toddler: 3,
  child: 9,
  kid: 9,
  teen: 15,
  teenager: 15,
  adult: 35,
  senior: 70,
}

/** Default rating in the preferences UI; unrated activities are stored as absent. */
export const DEFAULT_ACTIVITY_RATING = 3

export function ageOn(birthDate: Date | string, asOf: Date): number | null {
  const b = birthDate instanceof Date ? birthDate : new Date(birthDate)
  if (Number.isNaN(b.getTime())) return null
  let age = asOf.getUTCFullYear() - b.getUTCFullYear()
  const beforeBirthday =
    asOf.getUTCMonth() < b.getUTCMonth() ||
    (asOf.getUTCMonth() === b.getUTCMonth() && asOf.getUTCDate() < b.getUTCDate())
  if (beforeBirthday) age--
  return age < 0 || age > 120 ? null : age
}

export function estimateAgeFromTags(tags: readonly string[]): number {
  for (const raw of tags) {
    const t = raw.trim().toLowerCase()
    if (t in TAG_AGE) return TAG_AGE[t]
  }
  return TAG_AGE.adult
}

function readActivityRatings(preferences: unknown): Record<string, number> {
  if (!preferences || typeof preferences !== "object") return {}
  const acts = (preferences as { activities?: unknown }).activities
  if (!acts || typeof acts !== "object") return {}
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(acts as Record<string, unknown>)) {
    const n = typeof v === "number" ? v : Number(v)
    if (Number.isFinite(n)) out[k] = n
  }
  return out
}

export interface TravelerSummaryDetail extends TravelerSummary {
  /** true when at least one age came from a tag rather than a birth date */
  agesEstimated: boolean
  childCount: number
  adultCount: number
}

export function summariseTravelers(profiles: readonly TravelerProfileLike[], asOf: Date = new Date()): TravelerSummaryDetail {
  const ages: number[] = []
  const tags = new Set<string>()
  const ratingSums = new Map<string, { sum: number; n: number }>()
  let agesEstimated = false

  for (const p of profiles) {
    const pTags = (p.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean)
    pTags.forEach((t) => tags.add(t))

    let age: number | null = null
    if (p.birthDate) age = ageOn(p.birthDate, asOf)
    if (age == null) {
      age = estimateAgeFromTags(pTags)
      agesEstimated = true
    }
    ages.push(age)

    for (const [k, v] of Object.entries(readActivityRatings(p.preferences))) {
      const cur = ratingSums.get(k) ?? { sum: 0, n: 0 }
      cur.sum += v
      cur.n += 1
      ratingSums.set(k, cur)
    }
  }

  const activityRatings: Record<string, number> = {}
  for (const [k, { sum, n }] of ratingSums) activityRatings[k] = Math.round((sum / n) * 10) / 10

  const childCount = ages.filter((a) => a < 18).length
  return {
    ages,
    count: profiles.length,
    tags: [...tags].sort(),
    activityRatings,
    agesEstimated,
    childCount,
    adultCount: ages.length - childCount,
  }
}

/** Airline convention: 2–11 is a child fare; under 2 is a lap infant (not counted). */
export function splitAdultsChildren(ages: readonly number[]): { adults: number; children: number } {
  let adults = 0
  let children = 0
  for (const a of ages) {
    if (a >= 12) adults++
    else if (a >= 2) children++
    else children++ // count lap infants as children so the party total is not understated
  }
  return { adults: Math.max(adults, 1), children }
}

export function formatAges(ages: readonly number[]): string {
  const kids = ages.filter((a) => a < 18).sort((a, b) => a - b)
  if (kids.length === 0) return `${ages.length} adult${ages.length === 1 ? "" : "s"}`
  const adults = ages.length - kids.length
  const kidText = `ages ${kids.join(", ")}`
  return adults > 0 ? `${adults} adult${adults === 1 ? "" : "s"} · kids ${kidText}` : kidText
}
