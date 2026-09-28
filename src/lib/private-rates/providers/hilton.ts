/**
 * Hilton RateProvider. See docs/plans/opportunity-discovery-engine.md §6.
 *
 * Drives a BrowserRunner; knows nothing about whether that runner is the local
 * Playwright service or a remote container (§6.1 rule 6). It never touches the
 * DOM, the network or Playwright: it builds RunnerTasks and interprets results.
 *
 * Rules encoded here:
 *   - Runs only when called; there is no polling, scheduling or pre-fetching.
 *   - A challenge or a signed-out page ends the call. There is no retry, no
 *     second attempt with different parameters, nothing that could look like
 *     abuse. The caller sets the session to NEEDS_USER and asks the user.
 *   - Credentials are never touched or logged. This class only ever sees rate
 *     observations; the sign-in happens in the user's live view.
 *   - Sessions are per user: every task carries the calling user's id and the
 *     runner unseals only that user's profile.
 *
 * The Team Member rate code depends on the user's program, so it is a config
 * key (`privateRates.hilton.rateCode`, default "") rather than a constant. It
 * is resolved by the caller (src/lib/private-rates/index.ts) and injected so
 * this module stays free of the database and testable with a fake runner.
 */
import type {
  BrowserRunner,
  CityRatesData,
  CityRatesParams,
  HiltonCityRatesTask,
  HiltonRatesTask,
  PrivateRateProviderId,
  RateObservation,
  RateProvider,
  RunnerResult,
} from "../types"

/** AppConfig key holding the Team Member rate code. Read with getConfig(key, ""). */
export const HILTON_RATE_CODE_CONFIG_KEY = "privateRates.hilton.rateCode"

export interface HiltonRateProviderOptions {
  /** Team Member rate code; "" means "not configured" and only public rates are fetched. */
  rateCode: string
}

export class HiltonRateProvider implements RateProvider {
  readonly id: PrivateRateProviderId = "hilton"
  readonly privateRateCode: string

  constructor(options: HiltonRateProviderOptions) {
    this.privateRateCode = (options.rateCode ?? "").trim()
  }

  /** True when a Team Member rate code is configured, so private lookups are meaningful. */
  get hasPrivateRateCode(): boolean {
    return this.privateRateCode.length > 0
  }

  /**
   * Price a known list of properties: once with the private code, once without
   * for the public comparable. Stops at the first challenge; never retries.
   */
  async checkRates(
    runner: BrowserRunner,
    userId: string,
    properties: HiltonRatesTask["properties"],
  ): Promise<RunnerResult<RateObservation[]>> {
    if (properties.length === 0) return { ok: true, data: [] }

    const collected: RateObservation[] = []

    if (this.hasPrivateRateCode) {
      const priv = await runner.run<RateObservation[]>(userId, {
        kind: "HILTON_RATES",
        properties,
        rateCode: this.privateRateCode,
      })
      if (!priv.ok) return { ...priv, data: tag(priv.data, "PRIVATE_HILTON_GO") }
      collected.push(...tag(priv.data, "PRIVATE_HILTON_GO"))
    }

    const pub = await runner.run<RateObservation[]>(userId, { kind: "HILTON_RATES", properties })
    if (!pub.ok) return { ...pub, data: [...collected, ...tag(pub.data, "PUBLIC")] }
    collected.push(...tag(pub.data, "PUBLIC"))
    return { ok: true, data: collected }
  }

  /**
   * City-level lookup for the opportunities pipeline: two runner tasks for one
   * destination and date window.
   *
   *   1. HILTON_CITY_RATES with the Team Member rate code → PRIVATE_HILTON_GO
   *   2. HILTON_CITY_RATES without a code               → PUBLIC comparable
   *
   * If task 1 fails with CHALLENGE or SIGNED_OUT (or any other failure) the
   * call returns that failure at once and task 2 is not attempted. If task 2
   * fails, the private observations already retrieved are returned as partial
   * data so the caller can keep them.
   */
  async checkCityRates(
    runner: BrowserRunner,
    userId: string,
    params: CityRatesParams,
  ): Promise<RunnerResult<CityRatesData>> {
    const base: Omit<HiltonCityRatesTask, "rateCode"> = {
      kind: "HILTON_CITY_RATES",
      location: params.location,
      lat: params.lat,
      lng: params.lng,
      checkIn: params.checkIn,
      checkOut: params.checkOut,
      maxProperties: params.maxProperties,
    }

    let privateRates: RateObservation[] = []

    if (this.hasPrivateRateCode) {
      const priv = await runner.run<RateObservation[]>(userId, { ...base, rateCode: this.privateRateCode })
      if (!priv.ok) {
        // Stop here. No retry after a challenge; the remaining task is skipped.
        return {
          ok: false,
          status: priv.status,
          challengeKind: priv.challengeKind,
          data: { privateRates: tag(priv.data, "PRIVATE_HILTON_GO"), publicRates: [] },
        }
      }
      privateRates = tag(priv.data, "PRIVATE_HILTON_GO")
    }

    const pub = await runner.run<RateObservation[]>(userId, base)
    if (!pub.ok) {
      return {
        ok: false,
        status: pub.status,
        challengeKind: pub.challengeKind,
        data: { privateRates, publicRates: tag(pub.data, "PUBLIC") },
      }
    }

    return { ok: true, data: { privateRates, publicRates: tag(pub.data, "PUBLIC") } }
  }
}

/** Force the rateKind the task was issued for, whatever the runner labelled. */
function tag(observations: RateObservation[] | undefined, rateKind: RateObservation["rateKind"]): RateObservation[] {
  if (!Array.isArray(observations)) return []
  return observations.map((o) => ({ ...o, rateKind }))
}
