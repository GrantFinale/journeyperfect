/**
 * Family activity fit (stage 1, free). Plan §4.5: match the profile's
 * familyFit tags against derived traveler ages and the party's activity
 * ratings. A relevance count, not a raw attraction count: three strong
 * matches beat twenty generic ones. Pure.
 */
import type { NormalisedFamilyFit } from "../destinations"
import type { TravelerSummary } from "../types"
import type { FactorResult, OpportunityReason } from "../types"
import { formatAges } from "../travelers"
import { clamp01, mean, reason, result, round } from "./shared"

/**
 * Profile familyFit tags -> the preference keys the travelers UI stores
 * (`cuisineKey(label)` of the ACTIVITY_TYPES labels in
 * src/app/(app)/settings/travelers/traveler-preferences.tsx).
 */
export const PROFILE_TAG_TO_PREFERENCE_KEYS: Record<string, string[]> = {
  "theme-parks": ["theme-parks-rides"],
  water: ["water-activities", "beach-pool"],
  beach: ["beach-pool"],
  hiking: ["hiking-nature"],
  museums: ["museums-history"],
  interactive: ["museums-history", "arts-creative"],
  "zoo-aquarium": ["hiking-nature"],
  snow: ["winter-sports"],
  sports: ["sports-events"],
  "nightlife-heavy": ["nightlife-casinos", "shows-entertainment"],
  shopping: ["shopping"],
  food: ["breweries-wineries"],
  music: ["live-music-concerts"],
  spa: ["spa-relaxation"],
  golf: ["golf"],
}

/** Human labels for reason details. */
const TAG_LABEL: Record<string, string> = {
  "theme-parks": "theme parks",
  water: "water",
  beach: "beach",
  hiking: "hiking",
  museums: "museums",
  interactive: "interactive",
  "zoo-aquarium": "zoo & aquarium",
  snow: "snow",
  sports: "sports",
  "nightlife-heavy": "nightlife",
  shopping: "shopping",
}

export type AgeBand = "0-5" | "6-12" | "13-17" | "adult"

export function ageBand(age: number): AgeBand {
  if (age <= 5) return "0-5"
  if (age <= 12) return "6-12"
  if (age <= 17) return "13-17"
  return "adult"
}

export const STRONG_RATING = 4
export const DISLIKE_RATING = 2

export interface FamilyFitInput {
  travelers: TravelerSummary
  familyFit: NormalisedFamilyFit
  destinationName: string
}

/**
 * Per-band fit on a 0..1 scale. Numeric bands (seed) are 0..3 ratings; tag
 * bands (plan sketch) score by how many of the band's tags the party rates
 * highly, or 0.5 when nobody rated anything.
 */
function bandFit(fit: NormalisedFamilyFit, band: AgeBand, ratings: Record<string, number>): number | null {
  const v = fit.byAgeBand[band]
  if (v == null) return null
  if (typeof v === "number") return clamp01(v / 3)
  if (v.length === 0) return 0
  const rated = v.map((tag) => prefRating(tag, ratings)).filter((r): r is number => r != null)
  if (rated.length === 0) return 0.5
  return clamp01(mean(rated.map((r) => (r - 1) / 4)) ?? 0.5)
}

/** Highest rating the party gave any preference key mapped from a profile tag. */
function prefRating(tag: string, ratings: Record<string, number>): number | null {
  const keys = PROFILE_TAG_TO_PREFERENCE_KEYS[tag] ?? [tag]
  let best: number | null = null
  for (const k of keys) {
    const r = ratings[k]
    if (r != null && (best == null || r > best)) best = r
  }
  return best
}

export function evaluateFamilyFit(input: FamilyFitInput): FactorResult {
  const { travelers, familyFit, destinationName } = input
  const ages = travelers.ages
  const ratings = travelers.activityRatings
  const kids = ages.filter((a) => a < 18)
  const hasKids = kids.length > 0

  // 1. Age-band fit: the weakest band in the party matters most (nobody enjoys
  //    a trip where the six-year-old has nothing to do), blended with the mean.
  const bands = [...new Set(ages.map(ageBand))]
  const bandScores = bands.map((b) => bandFit(familyFit, b, ratings)).filter((s): s is number => s != null)
  const bandMin = bandScores.length ? Math.min(...bandScores) : null
  const bandMean = mean(bandScores)
  const ageScore = bandMin != null && bandMean != null ? 0.6 * bandMin + 0.4 * bandMean : null

  // 2. Interest relevance: strong matches (rated >= 4) and dislikes (<= 2).
  const strong: string[] = []
  const disliked: string[] = []
  for (const tag of familyFit.tags) {
    const r = prefRating(tag, ratings)
    if (r == null) continue
    if (r >= STRONG_RATING) strong.push(tag)
    else if (r <= DISLIKE_RATING) disliked.push(tag)
  }
  const anyRatings = Object.keys(ratings).length > 0
  const relevance = anyRatings ? clamp01(Math.min(strong.length, 3) / 3 - 0.15 * disliked.length) : null

  // 3. Nightlife-heavy destinations with children in the party.
  const nightlife = familyFit.tags.includes("nightlife-heavy")
  let adjustment = 0
  if (nightlife && hasKids) adjustment -= 0.2
  if (nightlife && !hasKids) adjustment += 0.1

  let score: number
  if (ageScore != null && relevance != null) score = 0.5 * ageScore + 0.5 * relevance
  else if (ageScore != null) score = ageScore
  else if (relevance != null) score = relevance
  else score = 0.5
  score = clamp01(score + adjustment)

  const reasons: OpportunityReason[] = []
  const strongLabels = strong.map((t) => TAG_LABEL[t] ?? t)
  if (strong.length >= 2) {
    reasons.push(
      reason(
        "familyFit",
        "POSITIVE",
        `${strong.length} strong ${hasKids ? "family" : "interest"} match${strong.length === 1 ? "" : "es"}`,
        0.4 + 0.15 * Math.min(strong.length, 4),
        `${formatAges(ages)} · ${strongLabels.join(" · ")}`
      )
    )
  } else if (strong.length === 1 && bandMin != null && bandMin >= 0.66) {
    reasons.push(reason("familyFit", "POSITIVE", `Strong ${strongLabels[0]} match`, 0.45, formatAges(ages)))
  } else if (strong.length === 0 && hasKids && bandMin != null && bandMin >= 0.9) {
    reasons.push(reason("familyFit", "POSITIVE", "Built for kids these ages", 0.4, formatAges(ages)))
  }

  if (hasKids && bandMin != null && bandMin <= 0.34) {
    reasons.push(
      reason("familyFit", "NEGATIVE", `Little for kids in ${destinationName}`, 0.5, formatAges(ages))
    )
  } else if (nightlife && hasKids) {
    reasons.push(reason("familyFit", "NEGATIVE", "Nightlife-heavy with kids along", 0.35))
  }
  if (disliked.length >= 2) {
    reasons.push(
      reason(
        "familyFit",
        "NEGATIVE",
        "Leans on things the party rated low",
        0.3,
        disliked.map((t) => TAG_LABEL[t] ?? t).join(" · ")
      )
    )
  }

  return result(
    "familyFit",
    score,
    "ESTIMATED",
    {
      strongMatches: strong.length,
      matchedTags: strong.join(","),
      dislikedTags: disliked.join(","),
      ages: ages.join(","),
      childCount: kids.length,
      ageBandFit: bandMin == null ? "" : round(bandMin, 2),
      indoorRatio: familyFit.indoorRatio,
      ratedPreferences: anyRatings,
    },
    reasons
  )
}
