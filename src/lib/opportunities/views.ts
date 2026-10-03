/**
 * Serialisable view types returned by src/lib/actions/opportunities.ts to
 * client components. Dates are ISO strings (YYYY-MM-DD for @db.Date columns,
 * full ISO 8601 for timestamps). Json columns are typed via ./types.
 *
 * Pure: no Prisma imports, so client components can import these types.
 */
import type {
  FactorKind,
  OpportunityAnchorExperience,
  OpportunityReason,
  OpportunitySearchStatus,
  OpportunityTransportation,
  OpportunityWeatherContext,
  SearchConstraints,
} from "./types"

export interface OpportunitySearchView {
  id: string
  userId: string
  originAirports: string[]
  originLat: number
  originLng: number
  /** YYYY-MM-DD */
  windowStart: string
  /** YYYY-MM-DD */
  windowEnd: string
  nightsMin: number
  nightsMax: number
  weekdayPattern: string | null
  travelerProfileIds: string[]
  constraints: SearchConstraints
  status: OpportunitySearchStatus | string
  /** ISO 8601 */
  privateRatesAuthorizedAt: string | null
  /** ISO 8601 */
  createdAt: string
  /** ISO 8601 */
  completedAt: string | null
  candidateCount: number
  opportunityCount: number
}

export interface TravelOpportunityView {
  id: string
  searchId: string
  candidateId: string
  userId: string
  destinationName: string
  destinationIata: string
  /** YYYY-MM-DD */
  checkIn: string
  /** YYYY-MM-DD */
  checkOut: string
  nights: number
  travelerCount: number
  nonstopAvailable: boolean
  flightOfferId: string | null
  transportation: OpportunityTransportation
  airfareTotal: number | null
  /** RETRIEVED | ESTIMATED | UNKNOWN */
  airfareSource: string
  hotelRateQuoteId: string | null
  publicRateQuoteId: string | null
  hotelName: string | null
  /** Chain of the private rate ("hilton" Go / "marriott" F&F), from stage 3's facts; null when unknown */
  hotelProvider: "hilton" | "marriott" | null
  privateNightlyRate: number | null
  comparablePublicRate: number | null
  hotelSavingsTotal: number | null
  groundTransportEstimate: number | null
  majorActivityEstimate: number | null
  coreTripCost: number | null
  /** RETRIEVED | ESTIMATED | HISTORICAL | UNKNOWN */
  coreTripCostSource: string
  weatherContext: OpportunityWeatherContext
  anchorExperience: OpportunityAnchorExperience | null
  familyFitReasons: string[]
  /** All reasons, POSITIVE first by magnitude, then NEGATIVE (as stored) */
  opportunityReasons: OpportunityReason[]
  headlineFactor: FactorKind | string
  /** ISO 8601 */
  retrievedAt: string
  builtTripId: string | null
  /** ISO 8601 */
  createdAt: string
  /** "Why this surfaced": the POSITIVE reasons, by magnitude */
  reasons: OpportunityReason[]
  /** "Worth knowing": the NEGATIVE reasons, by magnitude */
  worthKnowing: OpportunityReason[]
}

/** Stage-by-stage counts for the progress indicator. */
export interface CandidateCounts {
  total: number
  pruned: number
  /** stage -> number of candidates whose last completed stage is that value */
  byStage: Record<number, number>
}
