/**
 * Hand-synced copy of the wire types in src/lib/private-rates/types.ts (repo
 * root). The service has no build-time dependency on the Next.js app, so these
 * are duplicated; keep them in step when the app's types change.
 */

export type ChallengeKind =
  | "NONE"
  | "CAPTCHA"
  | "MFA"
  | "SECURITY_VERIFY"
  | "SIGNED_OUT"
  | "UNKNOWN_INTERSTITIAL"
  /** Bot protection (e.g. Akamai "Access Denied" / "Reference No. 18.x") refused the page outright. */
  | "BLOCKED"

export type RateKind = "PRIVATE_HILTON_GO" | "PUBLIC"

export interface RunnerTaskProperty {
  propertyCode: string
  /** YYYY-MM-DD */
  checkIn: string
  /** YYYY-MM-DD */
  checkOut: string
}

/** Look up specific properties by Hilton property code (ctyhocn). */
export interface HiltonRatesTask {
  kind: "HILTON_RATES"
  properties: RunnerTaskProperty[]
  /** Team Member / corporate rate code; omitted = public comparable. */
  rateCode?: string
}

/** Search a city/location and take the first N properties from the results list. */
export interface HiltonCityRatesTask {
  kind: "HILTON_CITY_RATES"
  location: string
  lat?: number
  lng?: number
  checkIn: string
  checkOut: string
  rateCode?: string
  maxProperties?: number
}

export type RunnerTask = HiltonRatesTask | HiltonCityRatesTask

export type RunnerFailureStatus = "CHALLENGE" | "SIGNED_OUT" | "TIMEOUT" | "PARSE_FAILED" | "RUNNER_UNAVAILABLE"

export type RunnerResult<T> =
  | { ok: true; data: T; partial?: boolean }
  | { ok: false; status: RunnerFailureStatus; challengeKind?: ChallengeKind; data?: T }

export interface RateObservation {
  propertyCode: string
  propertyName: string
  brand?: string
  checkIn: string
  checkOut: string
  rateKind: RateKind
  /** 0 when `available` is false. */
  nightlyRate: number
  /** 0 when `available` is false. */
  totalRate: number
  currency: string
  roomType?: string
  available: boolean
  lat?: number
  lng?: number
  propertyUrl?: string
}

/** Status of an interactive sign-in session as reported by GET /sessions/:id/status. */
export type InteractiveStatus = "AWAITING_LOGIN" | "SIGNED_IN" | "CHALLENGE" | "TIMEOUT"
