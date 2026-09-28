/**
 * Runtime config keys introduced by the flights plan
 * (docs/plans/flights-search-tracking-and-booking.md) and the Opportunity
 * Discovery Engine plan (docs/plans/opportunity-discovery-engine.md).
 *
 * Every key is stored in AppConfig and editable at /admin/settings without a
 * deploy. Values are strings; parse at the call site. Read them through
 * `getConfigKey(key)` so the documented default is applied consistently.
 *
 * Server-only (imports `./config`, which imports Prisma). Client components
 * receive `CONFIG_KEYS` as props from a server component; see
 * src/app/(admin)/admin/settings/page.tsx.
 */
import { getConfig } from "./config"

export type ConfigKeyGroup = "flights" | "api" | "opportunities" | "privateRates" | "ai"

export interface ConfigKeyDef {
  /** Default used when the key is absent from AppConfig. */
  readonly default: string
  readonly group: ConfigKeyGroup
  /** One-line description for the admin settings page. */
  readonly desc: string
  /** Mark keys whose values are credentials so the UI can mask them. */
  readonly secret?: true
}

export const CONFIG_KEYS = {
  // ─── Flights: provider selection, cache and tracking ───────────────────
  "flights.provider": {
    default: "serpapi",
    group: "flights",
    desc: 'Active flight search provider: "serpapi" | "duffel" | "travelpayouts". Swapping is a config change, never a deploy.',
  },
  "flights.cacheTtlHours": {
    default: "6",
    group: "flights",
    desc: "Hours a cached FlightSearch result (keyed on queryHash) is reused before the provider is called again.",
  },
  "flights.checkIntervalHours": {
    default: "24",
    group: "flights",
    desc: "Minimum hours between re-pricing runs for a tracked FlightSearch (cron route).",
  },
  "flights.bookingEnabled": {
    default: "false",
    group: "flights",
    desc: 'Enable in-app booking through Duffel (Phase 4). "false" = deep-link handoff only.',
  },
  "flights.perUserDailySearches": {
    default: "30",
    group: "flights",
    desc: "Max provider-backed flight searches per user per day (cache hits do not count).",
  },

  // ─── External API credentials ──────────────────────────────────────────
  "api.serpapi.key": {
    default: "",
    group: "api",
    desc: "SerpApi API key (Google Flights engine). Discovery + price insights.",
    secret: true,
  },
  "api.duffel.token": {
    default: "",
    group: "api",
    desc: "Duffel access token. Booking provider (Phase 4).",
    secret: true,
  },
  "api.travelpayouts.token": {
    default: "",
    group: "api",
    desc: "Travelpayouts Data API token. Fare calendars and affiliate links.",
    secret: true,
  },
  "api.travelpayouts.marker": {
    default: "",
    group: "api",
    desc: "Travelpayouts affiliate marker appended to deep links.",
  },
  "api.ticketmaster.key": {
    default: "",
    group: "api",
    desc: "Ticketmaster Discovery API key. Anchor-event lookup for opportunity dates.",
    secret: true,
  },

  // ─── Opportunity Discovery Engine: pipeline caps ───────────────────────
  "opportunities.maxDestinations": {
    default: "12",
    group: "opportunities",
    desc: "Max destinations surviving stage 1 per search.",
  },
  "opportunities.maxDateCandidates": {
    default: "6",
    group: "opportunities",
    desc: "Max date windows generated per search (stage 0).",
  },
  "opportunities.maxAirfareLookups": {
    default: "24",
    group: "opportunities",
    desc: "Max destination x date airfare lookups per search (stage 2). Each is a flights-layer call, cached 6h.",
  },
  "opportunities.maxPrivateRateLookups": {
    default: "8",
    group: "opportunities",
    desc: "Max property x date private-rate lookups per search (stage 3).",
  },
  "opportunities.perUserDailySearches": {
    default: "5",
    group: "opportunities",
    desc: "App-wide ceiling on OpportunitySearch runs per user per day; the plan limit maxOpportunitySearchesPerDay applies on top.",
  },
  "opportunities.drivingAlternativeMaxKm": {
    default: "500",
    group: "opportunities",
    desc: "Great-circle distance under which a driving alternative is computed alongside the flight.",
  },

  // ─── Private Rates (Hilton Go) ─────────────────────────────────────────
  "privateRates.enabled": {
    default: "false",
    group: "privateRates",
    desc: "App-wide kill switch. Off = every private-rate action is disabled, including runs in progress at their next checkpoint.",
  },
  "privateRates.runner": {
    default: "local",
    group: "privateRates",
    desc: 'BrowserRunner implementation: "local" (Coolify browser-runner service) | "remote" (hosted browser provider).',
  },
  "privateRates.runnerUrl": {
    default: "https://runner.journeyperfect.com",
    group: "privateRates",
    desc: "Base URL of the browser-runner service. Use the public URL: the internal Coolify hostname does not resolve from the app, and every route except /healthz requires the BROWSER_RUNNER_SECRET bearer token from the environment.",
  },
  "privateRates.maxChecksPerDay": {
    default: "5",
    group: "privateRates",
    desc: "Max rate checks per entitled user per day.",
  },
  "privateRates.maxPropertiesPerCheck": {
    default: "8",
    group: "privateRates",
    desc: "Max properties queried in a single rate check.",
  },
  "privateRates.maxRunSeconds": {
    default: "180",
    group: "privateRates",
    desc: "Wall-clock bound for a single runner task before it is aborted with TIMEOUT.",
  },
  "privateRates.hilton.rateCode": {
    default: "",
    group: "privateRates",
    desc: "Rate/corporate code the runner appends to Hilton searches to surface the Team Member (Go Hilton) rate. Empty = public rates only.",
    secret: true,
  },

  // ─── AI models ─────────────────────────────────────────────────────────
  "ai.tripPlannerModel": {
    default: "anthropic/claude-sonnet-4.5",
    group: "ai",
    desc: "OpenRouter model id for the AI trip-proposal tool loop (multi-step reasoning).",
  },
  "ai.destinationProfileModel": {
    default: "anthropic/claude-sonnet-4.5",
    group: "ai",
    desc: "OpenRouter model id used to generate DestinationProfile rows.",
  },
  "ai.tripPlannerMaxIterations": {
    default: "12",
    group: "ai",
    desc: "Hard cap on tool-calling iterations per trip proposal.",
  },
  "ai.tripProposalsPerUserPerDay": {
    default: "5",
    group: "ai",
    desc: "Max AI trip-proposal runs per user per day (counted from AIUsage rows, attempts included).",
  },
  "ai.tripProposalTokenBudget": {
    default: "120000",
    group: "ai",
    desc: "Total prompt+completion token budget for a single trip-proposal run.",
  },
} as const satisfies Record<string, ConfigKeyDef>

export type ConfigKey = keyof typeof CONFIG_KEYS

/** Ordered list of keys, for rendering. */
export const CONFIG_KEY_LIST = Object.keys(CONFIG_KEYS) as ConfigKey[]

export function getConfigKeyDefault(key: ConfigKey): string {
  return CONFIG_KEYS[key].default
}

/**
 * Read a documented config key with its documented default. Server-only:
 * this goes through Prisma via `getConfig`.
 */
export async function getConfigKey(key: ConfigKey): Promise<string> {
  return getConfig(key, CONFIG_KEYS[key].default)
}

/** Convenience for numeric keys; falls back to the default when unparsable. */
export async function getConfigKeyNumber(key: ConfigKey): Promise<number> {
  const raw = await getConfigKey(key)
  const n = Number(raw)
  return Number.isFinite(n) ? n : Number(CONFIG_KEYS[key].default)
}

/** Convenience for boolean keys: only the literal string "true" is true. */
export async function getConfigKeyBoolean(key: ConfigKey): Promise<boolean> {
  return (await getConfigKey(key)) === "true"
}
