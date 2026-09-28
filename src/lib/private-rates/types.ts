/**
 * Private Rates (Hilton Go) contracts. See
 * docs/plans/opportunity-discovery-engine.md §6.
 *
 * Pure types only. The Next.js app never imports Playwright; it talks to a
 * BrowserRunner over an internal API, so a remote-container runner is a
 * config change behind the same interface.
 */

/** `PrivateRateSession.status` */
export type SessionStatus = "NONE" | "AWAITING_LOGIN" | "ACTIVE" | "NEEDS_USER" | "EXPIRED" | "REVOKED"

/**
 * Output of `detectChallenge(pageSignals)`. Anything other than NONE aborts
 * the run and hands control back to the user. We never solve or bypass one.
 */
export type ChallengeKind = "NONE" | "CAPTCHA" | "MFA" | "SECURITY_VERIFY" | "SIGNED_OUT" | "UNKNOWN_INTERSTITIAL"

/** `HotelRateQuote.rateKind` */
export type RateKind = "PRIVATE_HILTON_GO" | "PUBLIC"

/** `PrivateRateSession.provider`, `PrivateRateEntitlement.provider` */
export type PrivateRateProviderId = "hilton"

/** `PrivateRateAuditLog.action` */
export type PrivateRateAuditAction = "CONNECT" | "CHECK_RATES" | "CHALLENGE" | "DISCONNECT" | "REVOKE" | "KILL_SWITCH"

/** Per-property lookup: the runner already knows which hotels to price. */
export type HiltonRatesTask = {
  kind: "HILTON_RATES"
  properties: { propertyCode: string; checkIn: string; checkOut: string }[]
  /** Team Member rate code; omitted = public comparable */
  rateCode?: string
}

/**
 * City-level lookup: the runner searches Hilton for a destination and returns
 * up to `maxProperties` observations. Used by the opportunities pipeline, which
 * has a destination and dates but no shortlist of property codes yet.
 */
export type HiltonCityRatesTask = {
  kind: "HILTON_CITY_RATES"
  /** Free-text destination as the user would type it, e.g. "Chicago, IL". */
  location: string
  lat?: number
  lng?: number
  /** YYYY-MM-DD */
  checkIn: string
  /** YYYY-MM-DD */
  checkOut: string
  /** Team Member rate code; omitted = public comparable */
  rateCode?: string
  maxProperties?: number
}

export type RunnerTask = HiltonRatesTask | HiltonCityRatesTask

export type RunnerFailureStatus = "CHALLENGE" | "SIGNED_OUT" | "TIMEOUT" | "PARSE_FAILED" | "RUNNER_UNAVAILABLE"

/**
 * Typed outcome of a runner task. On failure, `data` may still carry whatever
 * was retrieved before the abort so the UI can say exactly what is missing.
 */
export type RunnerResult<T> =
  | { ok: true; data: T; partial?: boolean }
  | { ok: false; status: RunnerFailureStatus; challengeKind?: ChallengeKind; data?: T }

export type AwaitSignedInOutcome = "SIGNED_IN" | "TIMEOUT" | "CHALLENGE"

export interface BrowserRunner {
  /** Launch an isolated per-user profile on the sign-in page and return a live view. */
  openInteractive(userId: string): Promise<{ sessionId: string; liveViewUrl: string }>
  /** Resolve once the signed-in state is detected, the timeout elapses, or a challenge appears. */
  awaitSignedIn(sessionId: string, timeoutMs: number): Promise<AwaitSignedInOutcome>
  /**
   * A fresh live-view URL for a session still awaiting login, when the runner
   * has issued one (e.g. after the viewer's socket dropped); null otherwise.
   */
  getLiveViewUrl?(sessionId: string): Promise<string | null>
  /** unseal -> task -> seal, bounded by privateRates.maxRunSeconds. */
  run<T>(userId: string, task: RunnerTask): Promise<RunnerResult<T>>
  /** Destroy the sealed profile and any live session for this user. */
  destroy(userId: string): Promise<void>
}

/** One parsed rate observation; maps onto HotelRateQuote. */
export interface RateObservation {
  propertyCode: string
  propertyName: string
  brand?: string
  /** YYYY-MM-DD */
  checkIn: string
  /** YYYY-MM-DD */
  checkOut: string
  rateKind: RateKind
  nightlyRate: number
  totalRate: number
  currency: string
  roomType?: string
  available: boolean
  /** Property coordinates when the results page exposed them. */
  lat?: number
  lng?: number
  /** Canonical Hilton property page, for the card's outbound link. */
  propertyUrl?: string
}

/**
 * Provider abstraction over a private-rate program. Not Hilton-specific: a
 * corporate rate code or another chain's friends-and-family rate would be a
 * second implementation. We build one.
 */
export interface RateProvider {
  readonly id: PrivateRateProviderId
  /** The rate code that unlocks the private rate, e.g. Hilton Team Member. */
  readonly privateRateCode: string
  checkRates(
    runner: BrowserRunner,
    userId: string,
    properties: HiltonRatesTask["properties"]
  ): Promise<RunnerResult<RateObservation[]>>
  /**
   * Optional city-level lookup (private + public comparable in one call).
   * Providers that only price known property codes may omit it.
   */
  checkCityRates?(
    runner: BrowserRunner,
    userId: string,
    params: CityRatesParams
  ): Promise<RunnerResult<CityRatesData>>
}

/** Input to `RateProvider.checkCityRates`. */
export interface CityRatesParams {
  location: string
  lat?: number
  lng?: number
  /** YYYY-MM-DD */
  checkIn: string
  /** YYYY-MM-DD */
  checkOut: string
  maxProperties?: number
}

/** Output of `RateProvider.checkCityRates`: both lists, each tagged by rateKind. */
export interface CityRatesData {
  privateRates: RateObservation[]
  publicRates: RateObservation[]
}
