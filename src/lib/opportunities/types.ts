/**
 * Types for the Opportunity Discovery Engine. See
 * docs/plans/opportunity-discovery-engine.md §4, §7.
 *
 * Pure: no Prisma, no side effects. Client components and Vitest can import
 * this directly. The Json columns on OpportunitySearch, OpportunityCandidate,
 * TravelOpportunity and DestinationProfile are typed here.
 */

export type FactorKind =
  | "hotelValue"
  | "nonstop"
  | "airfare"
  | "doorToDoor"
  | "weather"
  | "familyFit"
  | "tripLengthFit"
  | "anchor"
  | "groundFriction"

export const FACTOR_KINDS: readonly FactorKind[] = [
  "hotelValue",
  "nonstop",
  "airfare",
  "doorToDoor",
  "weather",
  "familyFit",
  "tripLengthFit",
  "anchor",
  "groundFriction",
]

/**
 * How a number was obtained. The UI renders this as a label on every value;
 * a HISTORICAL weather average never appears without the word "typical".
 */
export type FactorSource = "RETRIEVED" | "ESTIMATED" | "HISTORICAL" | "UNKNOWN"

export type ReasonPolarity = "POSITIVE" | "NEGATIVE"

export interface OpportunityReason {
  factor: FactorKind
  /** "$2,400 hotel savings" */
  headline: string
  /** "Conrad Orlando, private $79 vs public $925/night" */
  detail?: string
  /** How far from baseline; drives outlier detection and ordering */
  magnitude: number
  polarity: ReasonPolarity
}

export type FactorFacts = Record<string, number | string | boolean>

/** Plan §4. Every factor evaluator returns exactly this shape. */
export interface FactorResult {
  kind: FactorKind
  /** false = we could not evaluate; never fabricate */
  available: boolean
  /** 0..1 for internal ranking only, never shown */
  score: number | null
  source: FactorSource
  /** ISO 8601 */
  retrievedAt?: string
  /** What the UI shows */
  facts: FactorFacts
  /** Human-readable, only when notable */
  reasons: OpportunityReason[]
}

/** `OpportunityCandidate.factors` Json column. */
export type CandidateFactors = Partial<Record<FactorKind, FactorResult>>

/** `OpportunitySearch.constraints` Json column. */
export interface SearchConstraints {
  /** Party total, in the user's currency */
  maxCoreCost?: number
  nonstopOnly?: boolean
  maxFlightMins?: number
  drivingOk?: boolean
  warm?: boolean
  /** Free-form region tags, e.g. ["caribbean", "florida"] */
  regions?: string[]
}

/** One bounded date window produced by the stage-0 generator. */
export interface DateCandidate {
  /** YYYY-MM-DD */
  checkIn: string
  /** YYYY-MM-DD */
  checkOut: string
  nights: number
  /** "Thu 12 – Sun 15 Nov" */
  label: string
}

/** Derived from the selected TravelerProfiles for factor evaluation. */
export interface TravelerSummary {
  /** One entry per traveler; derived from birthDate, or estimated from tags */
  ages: number[]
  count: number
  /** Union of TravelerProfile.tags */
  tags: string[]
  /** Activity -> rating, merged from TravelerProfile.preferences.activities */
  activityRatings: Record<string, number>
}

// ─── DestinationProfile Json shapes ──────────────────────────────────────────

export type DestinationTier = "BUDGET" | "MID" | "UPSCALE" | "LUXURY"
export type ParkingTypical = "FREE" | "CHEAP" | "EXPENSIVE"

/** `DestinationProfile.familyFit` */
export interface DestinationFamilyFit {
  /** e.g. ["theme-parks", "beach", "water", "interactive-museums"] */
  tags: string[]
  /** Age band -> fit tags for that band, e.g. { "5-8": [...], "9-12": [...] } */
  byAgeBand: Record<string, string[]>
  /** 0..1 share of headline activities that are indoors */
  indoorRatio: number
}

export type AnchorKind = "SEASONAL" | "EVENT" | "NATURAL" | "FESTIVAL" | "SPORTS" | "OTHER"

/** One entry of `DestinationProfile.anchors` */
export interface DestinationAnchor {
  title: string
  kind: AnchorKind
  /** 1..12 */
  months: number[]
  weatherDependent: boolean
}

/** One month of `DestinationProfile.climate` */
export interface ClimateMonth {
  /** 1..12 */
  month: number
  highF: number
  lowF: number
  /** 0..100 */
  precipPct: number
}

export interface DestinationProfileData {
  familyFit: DestinationFamilyFit
  anchors: DestinationAnchor[]
  climate?: ClimateMonth[]
}

// ─── TravelOpportunity Json shapes ───────────────────────────────────────────

export type TransportMode = "FLY" | "DRIVE"

/** `TravelOpportunity.transportation` */
export interface OpportunityTransportation {
  mode: TransportMode
  durationMins: number
  doorToDoorMins: number
  carriers: string[]
  /** ISO 8601 */
  departs?: string
  /** ISO 8601 */
  returns?: string
  source: FactorSource
}

/** `TravelOpportunity.weatherContext` */
export interface OpportunityWeatherContext {
  kind: "FORECAST" | "HISTORICAL"
  highF: number
  lowF: number
  precipPct: number
  swimmable: boolean
  summary: string
}

/** `TravelOpportunity.anchorExperience` */
export interface OpportunityAnchorExperience {
  title: string
  kind: AnchorKind
  /** YYYY-MM-DD */
  date?: string
  url?: string
  source: FactorSource
}

/** `OpportunitySearch.status` */
export type OpportunitySearchStatus =
  | "DRAFT"
  | "STAGE_0"
  | "STAGE_1"
  | "STAGE_2"
  | "STAGE_3"
  | "STAGE_4"
  | "DONE"
  | "FAILED"
