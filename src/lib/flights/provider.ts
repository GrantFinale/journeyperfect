/**
 * Provider abstraction. Nothing outside `src/lib/flights/` may know which
 * provider is active; `getFlightProvider()` (index.ts) reads
 * `flights.provider` from config. See
 * docs/plans/flights-search-tracking-and-booking.md §4.2.
 */
import type { FlightQuery, ProviderSearchResult } from "./types"

export type FlightProviderId = "serpapi" | "duffel" | "travelpayouts"

export interface FlightProvider {
  readonly id: string
  /** True only for providers that can create a real order (Duffel). */
  readonly supportsBooking: boolean
  search(q: FlightQuery): Promise<ProviderSearchResult>
}

export const FLIGHT_PROVIDER_IDS: readonly FlightProviderId[] = ["serpapi", "duffel", "travelpayouts"]

export function isFlightProviderId(value: string): value is FlightProviderId {
  return (FLIGHT_PROVIDER_IDS as readonly string[]).includes(value)
}
