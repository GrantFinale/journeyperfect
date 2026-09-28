/**
 * Typed errors for the flights layer. Pure: no Prisma, no config imports, so
 * providers, the watch runner and their tests can share them.
 */

/** A provider was selected in config but its credential key is empty. */
export class ProviderNotConfiguredError extends Error {
  readonly code = "PROVIDER_NOT_CONFIGURED" as const
  constructor(
    public readonly provider: string,
    public readonly configKey: string
  ) {
    super(`Flight provider "${provider}" is not configured. Set "${configKey}" in /admin/settings.`)
    this.name = "ProviderNotConfiguredError"
  }
}

/** The provider answered, but with an error or an unusable payload. */
export class ProviderRequestError extends Error {
  readonly code = "PROVIDER_REQUEST_FAILED" as const
  constructor(
    public readonly provider: string,
    message: string,
    public readonly status?: number
  ) {
    super(`Flight provider "${provider}" request failed${status ? ` (${status})` : ""}: ${message}`)
    this.name = "ProviderRequestError"
  }
}

/** In-app booking is switched off (`flights.bookingEnabled` != "true"). */
export class BookingDisabledError extends Error {
  readonly code = "BOOKING_DISABLED" as const
  constructor() {
    super('In-app booking is disabled. Set "flights.bookingEnabled" to "true" in /admin/settings to enable Duffel orders.')
    this.name = "BookingDisabledError"
  }
}

export function isProviderNotConfigured(err: unknown): err is ProviderNotConfiguredError {
  return err instanceof ProviderNotConfiguredError || (typeof err === "object" && err !== null && (err as { code?: string }).code === "PROVIDER_NOT_CONFIGURED")
}
