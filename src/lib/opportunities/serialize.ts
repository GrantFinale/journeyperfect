/**
 * Prisma row -> serialisable view. Server-only (imports Prisma types).
 */
import type { OpportunitySearch, TravelOpportunity } from "@prisma/client"
import { formatYmd } from "./dates"
import type {
  OpportunityAnchorExperience,
  OpportunityReason,
  OpportunityTransportation,
  OpportunityWeatherContext,
  SearchConstraints,
} from "./types"
import type { OpportunitySearchView, TravelOpportunityView } from "./views"

export function toSearchView(row: OpportunitySearch, counts: { candidateCount: number; opportunityCount: number }): OpportunitySearchView {
  return {
    id: row.id,
    userId: row.userId,
    originAirports: row.originAirports,
    originLat: row.originLat,
    originLng: row.originLng,
    windowStart: formatYmd(row.windowStart),
    windowEnd: formatYmd(row.windowEnd),
    nightsMin: row.nightsMin,
    nightsMax: row.nightsMax,
    weekdayPattern: row.weekdayPattern,
    travelerProfileIds: row.travelerProfileIds,
    constraints: (row.constraints as SearchConstraints | null) ?? {},
    status: row.status,
    privateRatesAuthorizedAt: row.privateRatesAuthorizedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    candidateCount: counts.candidateCount,
    opportunityCount: counts.opportunityCount,
  }
}

function asReasons(v: unknown): OpportunityReason[] {
  return Array.isArray(v) ? (v as OpportunityReason[]) : []
}

/**
 * `extras.hotelProvider` comes from the candidate's stage-3 facts
 * (TravelOpportunity has no provider column); absent = unknown.
 */
export function toOpportunityView(row: TravelOpportunity, extras: { hotelProvider?: string | null } = {}): TravelOpportunityView {
  const all = asReasons(row.opportunityReasons)
  return {
    id: row.id,
    searchId: row.searchId,
    candidateId: row.candidateId,
    userId: row.userId,
    destinationName: row.destinationName,
    destinationIata: row.destinationIata,
    checkIn: formatYmd(row.checkIn),
    checkOut: formatYmd(row.checkOut),
    nights: row.nights,
    travelerCount: row.travelerCount,
    nonstopAvailable: row.nonstopAvailable,
    flightOfferId: row.flightOfferId,
    transportation: row.transportation as unknown as OpportunityTransportation,
    airfareTotal: row.airfareTotal,
    airfareSource: row.airfareSource,
    hotelRateQuoteId: row.hotelRateQuoteId,
    publicRateQuoteId: row.publicRateQuoteId,
    hotelName: row.hotelName,
    hotelProvider: extras.hotelProvider === "marriott" ? "marriott" : extras.hotelProvider === "hilton" ? "hilton" : null,
    privateNightlyRate: row.privateNightlyRate,
    comparablePublicRate: row.comparablePublicRate,
    hotelSavingsTotal: row.hotelSavingsTotal,
    groundTransportEstimate: row.groundTransportEstimate,
    majorActivityEstimate: row.majorActivityEstimate,
    coreTripCost: row.coreTripCost,
    coreTripCostSource: row.coreTripCostSource,
    weatherContext: row.weatherContext as unknown as OpportunityWeatherContext,
    anchorExperience: (row.anchorExperience as unknown as OpportunityAnchorExperience | null) ?? null,
    familyFitReasons: row.familyFitReasons,
    opportunityReasons: all,
    headlineFactor: row.headlineFactor,
    retrievedAt: row.retrievedAt.toISOString(),
    builtTripId: row.builtTripId,
    createdAt: row.createdAt.toISOString(),
    reasons: all.filter((r) => r.polarity === "POSITIVE"),
    worthKnowing: all.filter((r) => r.polarity === "NEGATIVE"),
  }
}
