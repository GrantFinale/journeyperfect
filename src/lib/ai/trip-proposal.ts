/**
 * AI trip proposal agent: "Ten days in Portugal in May, two adults,
 * mid-range" -> 2-3 fully costed variants. See
 * docs/plans/flights-search-tracking-and-booking.md §5.
 *
 * This module is deliberately free of Prisma / config / auth imports so it
 * can be unit-tested with a scripted fake model and fake tools. Everything
 * that touches the database or external APIs comes in through
 * `TripProposalDeps`; src/lib/actions/trip-proposals.ts wires the real ones.
 *
 * Hard guards (plan §5): iteration cap and token budget are enforced by
 * runToolLoop; the per-user daily cap is enforced by the server action using
 * `DAILY_CAP_CONFIG_KEY` / `DEFAULT_DAILY_CAP` exported here.
 */
import { z } from "zod"
import type { FlightQuery, CabinClass } from "@/lib/flights/types"
import { runToolLoop, type ModelCaller, type ToolDef, type ToolLoopResult } from "./tool-loop"
import type { ChatUsage } from "./openrouter"

// ─── Config constants ───────────────────────────────────────────────────────

/** AppConfig key for the per-user daily cap (read via getConfig in the action). */
export const DAILY_CAP_CONFIG_KEY = "ai.tripProposalsPerUserPerDay"
export const DEFAULT_DAILY_CAP = 5
/** AppConfig key for the per-proposal token budget. */
export const TOKEN_BUDGET_CONFIG_KEY = "ai.tripProposalTokenBudget"
export const DEFAULT_TOKEN_BUDGET = 120_000
export const DEFAULT_MAX_ITERATIONS = 12
/** AIUsage.feature value for this agent. */
export const TRIP_PROPOSAL_FEATURE = "trip_proposal"

// ─── Output schema ──────────────────────────────────────────────────────────

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
const sourceSchema = z.enum(["RETRIEVED", "ESTIMATED"])
/** Model output is rendered as links; only web URLs are allowed (no javascript:, data:, ...). */
const httpUrl = z
  .string()
  .max(2048)
  .url()
  .refine((u) => /^https?:\/\//i.test(u), "Expected an http(s) URL")
const shortText = z.string().min(1).max(200)
const optionalId = z.string().max(200).optional()

export const proposalFlightSchema = z.object({
  /** Human summary, e.g. "TAP nonstop DTW→LIS, 8h 05m, return May 20". */
  offerSummary: shortText,
  totalPrice: z.number().min(0),
  currency: z.string().min(3).max(3),
  bookingUrl: httpUrl,
  /** Present only when the fare came from a persisted FlightSearch/FlightOffer. */
  searchId: optionalId,
  offerId: optionalId,
  source: sourceSchema.default("ESTIMATED"),
})

export const proposalActivitySchema = z.object({
  title: shortText,
  /** Free-form kind: "museum", "food_tour", "beach", "landmark", ... */
  kind: z.string().min(1).max(100),
  /** Estimated cost per adult in the proposal currency. */
  estCost: z.number().min(0).optional(),
  description: z.string().max(200).optional(),
  placeId: optionalId,
  lat: z.number().optional(),
  lng: z.number().optional(),
})

export const tripProposalVariantSchema = z.object({
  label: z.string().min(1).max(40),
  destination: z.object({
    name: shortText,
    lat: z.number().optional(),
    lng: z.number().optional(),
    placeId: optionalId,
    /** Nearest IATA airport used for the flight search. */
    iata: z.string().max(3).optional(),
  }),
  origin: z
    .object({
      name: shortText,
      iata: z.string().max(3).optional(),
    })
    .optional(),
  startDate: isoDate,
  endDate: isoDate,
  travelers: z.number().int().min(1).max(20),
  flight: proposalFlightSchema.optional(),
  lodging: z.object({
    estimateTotal: z.number().min(0),
    perNight: z.number().min(0),
    currency: z.string().min(3).max(3).default("USD"),
    source: sourceSchema.default("ESTIMATED"),
    tier: z.string().max(40).optional(),
    bookingUrl: httpUrl.optional(),
  }),
  activities: z.array(proposalActivitySchema).max(12),
  total: z.object({
    amount: z.number().min(0),
    currency: z.string().min(3).max(3),
    source: sourceSchema,
  }),
  rationale: z.array(z.string().min(1).max(500)).min(1).max(8),
})

export const tripProposalSchema = z.object({
  variants: z.array(tripProposalVariantSchema).min(1).max(4),
  summary: z.string().max(500).optional(),
})

export type TripProposal = z.infer<typeof tripProposalSchema>
export type TripProposalVariant = z.infer<typeof tripProposalVariantSchema>
export type TripProposalFlight = z.infer<typeof proposalFlightSchema>
export type TripProposalActivity = z.infer<typeof proposalActivitySchema>
export type PriceSource = z.infer<typeof sourceSchema>

// ─── Input ──────────────────────────────────────────────────────────────────

export const proposeTripInputSchema = z.object({
  idea: z.string().trim().min(3).max(600),
  /** Free text or IATA; defaults to the user's home city. */
  origin: z.string().trim().max(120).optional(),
  windowStart: isoDate.optional(),
  windowEnd: isoDate.optional(),
  nights: z.number().int().min(1).max(60).optional(),
  travelers: z.number().int().min(1).max(20).optional(),
  /** Total budget in `currency`. */
  budget: z.number().min(0).optional(),
  currency: z.string().length(3).optional(),
})
export type ProposeTripInput = z.infer<typeof proposeTripInputSchema>

// ─── Dependencies (real implementations live in the server action) ─────────

export interface ResolvedPlace {
  name: string
  address?: string
  lat: number
  lng: number
  placeId: string
}

export interface AgentFlightOffer {
  offerId?: string
  totalPrice: number
  currency: string
  carrierCodes: string[]
  stops: number
  durationMins: number
  bookingUrl: string
  summary: string
}

export interface AgentFlightSearchResult {
  searchId?: string
  offers: AgentFlightOffer[]
  fromCache?: boolean
  /** Provider price band when available. */
  insight?: { lowestPrice: number; level: string }
}

export interface FareCalendarArgs {
  origin: string
  destination: string
  /** YYYY-MM */
  month?: string
  currency: string
}

export interface ActivitySuggestion {
  title: string
  kind: string
  rating?: number
  placeId?: string
  lat?: number
  lng?: number
  address?: string
}

export interface TripProposalDeps {
  resolveDestination: (query: string) => Promise<ResolvedPlace | null>
  searchFlights: (q: FlightQuery) => Promise<AgentFlightSearchResult>
  /** Result is passed to the model as-is (JSON), so any shape works. */
  getFareCalendar: (args: FareCalendarArgs) => Promise<unknown>
  suggestActivities: (args: {
    destination: string
    lat?: number
    lng?: number
    interests?: string
  }) => Promise<ActivitySuggestion[]>
  /** Affiliate hotel search deep link. */
  hotelLink: (destination: string, checkIn: string, checkOut: string) => Promise<string>
}

// ─── Lodging tier table (per-room per-night, USD, labelled ESTIMATED) ──────

export type LodgingTier = "budget" | "mid-range" | "upscale" | "luxury"

export const LODGING_TIER_PER_NIGHT_USD: Record<LodgingTier, number> = {
  budget: 75,
  "mid-range": 160,
  upscale: 290,
  luxury: 520,
}

/** Rough daily food + local transport per adult by tier, USD, ESTIMATED. */
export const DAILY_SPEND_PER_ADULT_USD: Record<LodgingTier, number> = {
  budget: 45,
  "mid-range": 90,
  upscale: 160,
  luxury: 280,
}

export function normaliseTier(raw: unknown): LodgingTier {
  const s = String(raw ?? "")
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
  if (s.includes("lux")) return "luxury"
  if (s.includes("upscale") || s.includes("boutique") || s.includes("premium")) return "upscale"
  if (s.includes("budget") || s.includes("hostel") || s.includes("cheap")) return "budget"
  return "mid-range"
}

export function nightsBetween(startDate: string, endDate: string): number {
  const a = Date.parse(`${startDate}T00:00:00Z`)
  const b = Date.parse(`${endDate}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.max(0, Math.round((b - a) / 86_400_000))
}

// ─── Tools ──────────────────────────────────────────────────────────────────

const CABINS: CabinClass[] = ["economy", "premium_economy", "business", "first"]

function num(v: unknown, fallback: number): number {
  const n = typeof v === "string" ? Number(v) : (v as number)
  return Number.isFinite(n) ? (n as number) : fallback
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined
}

export function buildTripProposalTools(deps: TripProposalDeps, defaults: { currency: string }): ToolDef[] {
  return [
    {
      name: "resolveDestination",
      description:
        "Resolve a free-text place (city, region, landmark) to a canonical name and coordinates. Call once per candidate destination before searching flights or activities.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "e.g. 'Lisbon, Portugal' or 'Algarve'" } },
        required: ["query"],
      },
      handler: async (args) => {
        const q = str(args.query)
        if (!q) return { error: "query is required" }
        const place = await deps.resolveDestination(q)
        return place ?? { error: `No place found for "${q}"` }
      },
    },
    {
      name: "searchFlights",
      description:
        "Search round-trip (or one-way) fares. Use IATA airport codes. Returns up to 3 offers sorted by price, with offerId/searchId you MUST copy into the proposal when you pick one. Fares here are RETRIEVED prices.",
      parameters: {
        type: "object",
        properties: {
          origin: { type: "string", description: "IATA code, e.g. DTW" },
          destination: { type: "string", description: "IATA code, e.g. LIS" },
          departDate: { type: "string", description: "YYYY-MM-DD" },
          returnDate: { type: "string", description: "YYYY-MM-DD; omit for one-way" },
          adults: { type: "integer", minimum: 1 },
          children: { type: "integer", minimum: 0 },
          cabin: { type: "string", enum: CABINS },
          maxStops: { type: "integer", minimum: 0 },
          currency: { type: "string" },
        },
        required: ["origin", "destination", "departDate", "adults"],
      },
      handler: async (args) => {
        const origin = str(args.origin)?.toUpperCase()
        const destination = str(args.destination)?.toUpperCase()
        const departDate = str(args.departDate)
        if (!origin || !destination || !departDate) return { error: "origin, destination and departDate are required" }
        const cabinRaw = str(args.cabin) as CabinClass | undefined
        const q: FlightQuery = {
          origin,
          destination,
          departDate,
          returnDate: str(args.returnDate),
          cabin: cabinRaw && CABINS.includes(cabinRaw) ? cabinRaw : "economy",
          adults: Math.max(1, Math.floor(num(args.adults, 1))),
          children: Math.max(0, Math.floor(num(args.children, 0))),
          maxStops: args.maxStops === undefined ? undefined : Math.max(0, Math.floor(num(args.maxStops, 0))),
          currency: (str(args.currency) ?? defaults.currency).toUpperCase(),
        }
        const res = await deps.searchFlights(q)
        const offers = [...res.offers].sort((a, b) => a.totalPrice - b.totalPrice).slice(0, 3)
        return { searchId: res.searchId, query: q, insight: res.insight, fromCache: res.fromCache, offers }
      },
    },
    {
      name: "getFareCalendar",
      description:
        "Cheapest fares by date for a route over a month. Use it to pick the cheapest week inside the traveller's window before calling searchFlights.",
      parameters: {
        type: "object",
        properties: {
          origin: { type: "string", description: "IATA code" },
          destination: { type: "string", description: "IATA code" },
          month: { type: "string", description: "YYYY-MM" },
          currency: { type: "string" },
        },
        required: ["origin", "destination"],
      },
      handler: async (args) => {
        const origin = str(args.origin)?.toUpperCase()
        const destination = str(args.destination)?.toUpperCase()
        if (!origin || !destination) return { error: "origin and destination are required" }
        return deps.getFareCalendar({
          origin,
          destination,
          month: str(args.month),
          currency: (str(args.currency) ?? defaults.currency).toUpperCase(),
        })
      },
    },
    {
      name: "suggestActivities",
      description:
        "Shortlist real attractions and experiences at a destination (from Google Places). Returns titles, kinds, ratings and place ids. Costs are not included; estimate them yourself.",
      parameters: {
        type: "object",
        properties: {
          destination: { type: "string" },
          lat: { type: "number" },
          lng: { type: "number" },
          interests: { type: "string", description: "e.g. 'food, history, beaches'" },
        },
        required: ["destination"],
      },
      handler: async (args) => {
        const destination = str(args.destination)
        if (!destination) return { error: "destination is required" }
        const lat = args.lat === undefined ? undefined : num(args.lat, NaN)
        const lng = args.lng === undefined ? undefined : num(args.lng, NaN)
        const list = await deps.suggestActivities({
          destination,
          lat: Number.isFinite(lat) ? lat : undefined,
          lng: Number.isFinite(lng) ? lng : undefined,
          interests: str(args.interests),
        })
        return { activities: list.slice(0, 10) }
      },
    },
    {
      name: "findStays",
      description:
        "Lodging estimate for a stay: per-night and total from a tier table, plus a hotel search link. Every number here is ESTIMATED, never a live rate.",
      parameters: {
        type: "object",
        properties: {
          destination: { type: "string" },
          checkIn: { type: "string", description: "YYYY-MM-DD" },
          checkOut: { type: "string", description: "YYYY-MM-DD" },
          tier: { type: "string", enum: ["budget", "mid-range", "upscale", "luxury"] },
          rooms: { type: "integer", minimum: 1 },
        },
        required: ["destination", "checkIn", "checkOut"],
      },
      handler: async (args) => {
        const destination = str(args.destination)
        const checkIn = str(args.checkIn)
        const checkOut = str(args.checkOut)
        if (!destination || !checkIn || !checkOut) return { error: "destination, checkIn and checkOut are required" }
        const tier = normaliseTier(args.tier)
        const rooms = Math.max(1, Math.floor(num(args.rooms, 1)))
        const nights = nightsBetween(checkIn, checkOut)
        const perNight = LODGING_TIER_PER_NIGHT_USD[tier] * rooms
        const bookingUrl = await deps.hotelLink(destination, checkIn, checkOut)
        return {
          destination,
          checkIn,
          checkOut,
          nights,
          rooms,
          tier,
          perNight,
          estimateTotal: perNight * nights,
          currency: "USD",
          source: "ESTIMATED",
          bookingUrl,
        }
      },
    },
    {
      name: "estimateBudget",
      description:
        "Add up a variant: flight (RETRIEVED if it came from searchFlights) + lodging + activities + daily food/transport by tier. Returns the total and whether it is RETRIEVED or ESTIMATED.",
      parameters: {
        type: "object",
        properties: {
          flightTotal: { type: "number", description: "Total for all travellers" },
          flightIsRetrieved: { type: "boolean" },
          lodgingTotal: { type: "number" },
          activityCostsPerAdult: { type: "array", items: { type: "number" } },
          nights: { type: "integer", minimum: 0 },
          travelers: { type: "integer", minimum: 1 },
          tier: { type: "string", enum: ["budget", "mid-range", "upscale", "luxury"] },
          currency: { type: "string" },
        },
        required: ["nights", "travelers"],
      },
      handler: async (args) => {
        const tier = normaliseTier(args.tier)
        const nights = Math.max(0, Math.floor(num(args.nights, 0)))
        const travelers = Math.max(1, Math.floor(num(args.travelers, 1)))
        const flight = Math.max(0, num(args.flightTotal, 0))
        const lodging = Math.max(0, num(args.lodgingTotal, 0))
        const acts = Array.isArray(args.activityCostsPerAdult)
          ? (args.activityCostsPerAdult as unknown[]).map((v) => Math.max(0, num(v, 0)))
          : []
        const activities = acts.reduce((s, v) => s + v, 0) * travelers
        const dailySpend = DAILY_SPEND_PER_ADULT_USD[tier] * travelers * Math.max(1, nights)
        const total = flight + lodging + activities + dailySpend
        return {
          breakdown: { flight, lodging, activities, foodAndLocalTransport: dailySpend },
          total: Math.round(total),
          currency: (str(args.currency) ?? defaults.currency).toUpperCase(),
          source: args.flightIsRetrieved === true && flight > 0 ? "RETRIEVED" : "ESTIMATED",
          note: "Lodging, activities and daily spend are always estimates; RETRIEVED means the flight fare is a live quote.",
        }
      },
    },
  ]
}

// ─── Prompts ────────────────────────────────────────────────────────────────

export function buildSystemPrompt(ctx: { today: string; currency: string }): string {
  return `You are JourneyPerfect's trip planner. Turn a traveller's rough idea into 2 or 3 complete, costed trip variants they can accept in one click.

Today is ${ctx.today}. Default currency is ${ctx.currency}.

Process:
1. Interpret the idea: destination(s), rough dates or month, trip length, traveller count, comfort tier (budget / mid-range / upscale / luxury), interests.
2. resolveDestination for each candidate place.
3. Choose dates inside the traveller's window. If the window is wide, call getFareCalendar to find the cheapest week; if it errors, pick sensible dates yourself.
4. searchFlights from the origin airport to the nearest major airport, once per variant (different dates, airports or stop counts are what make variants differ). Always pass adults = traveller count.
5. suggestActivities once per destination; pick 4-8 that fit the group and estimate a per-adult cost for each.
6. findStays for each variant's dates and tier.
7. estimateBudget for each variant.
8. Reply with the final JSON.

Variants should sit on a real axis: typically "Cheapest", "Fastest" (fewest stops / shortest flights) and "Best value", but a different axis is fine if the idea calls for it (e.g. two candidate cities). Never invent airports, airlines or prices: if searchFlights returns no offers, give a rough flight estimate, omit searchId/offerId and set flight.source = "ESTIMATED".

Budget the traveller's tool budget: at most one searchFlights call per variant plus at most two getFareCalendar calls in total.

FINAL ANSWER FORMAT — respond with ONLY this JSON object, no prose, no markdown fences:
{
  "summary": "one sentence",
  "variants": [
    {
      "label": "Cheapest" | "Fastest" | "Best value" | other short label,
      "destination": { "name": string, "lat"?: number, "lng"?: number, "placeId"?: string, "iata"?: string },
      "origin": { "name": string, "iata"?: string },
      "startDate": "YYYY-MM-DD",
      "endDate": "YYYY-MM-DD",
      "travelers": integer,
      "flight"?: { "offerSummary": string, "totalPrice": number, "currency": "USD", "bookingUrl": string, "searchId"?: string, "offerId"?: string, "source": "RETRIEVED" | "ESTIMATED" },
      "lodging": { "estimateTotal": number, "perNight": number, "currency": "USD", "source": "ESTIMATED", "tier"?: string, "bookingUrl"?: string },
      "activities": [ { "title": string, "kind": string, "estCost"?: number, "description"?: string, "placeId"?: string, "lat"?: number, "lng"?: number } ],
      "total": { "amount": number, "currency": "USD", "source": "RETRIEVED" | "ESTIMATED" },
      "rationale": [ "2-5 short bullets on why this variant, what is estimated, and any trade-off" ]
    }
  ]
}

Rules: flight.totalPrice is for all travellers. total.source is "RETRIEVED" only when the flight fare came from searchFlights (copy its searchId and the chosen offerId). Copy bookingUrl values exactly as tools returned them. Keep rationale honest about what is estimated.`
}

export function buildUserPrompt(input: ProposeTripInput, ctx: { homeCity?: string | null }): string {
  const lines = [`Idea: ${input.idea}`]
  const origin = input.origin ?? ctx.homeCity ?? undefined
  lines.push(origin ? `Origin: ${origin}` : "Origin: not given — ask no questions; pick a major US hub and say so in the rationale.")
  if (input.windowStart || input.windowEnd) {
    lines.push(`Travel window: ${input.windowStart ?? "any"} to ${input.windowEnd ?? "any"}`)
  }
  if (input.nights) lines.push(`Trip length: ${input.nights} nights`)
  if (input.travelers) lines.push(`Travellers: ${input.travelers}`)
  if (input.budget) lines.push(`Total budget: ${input.budget} ${input.currency ?? "USD"}`)
  lines.push("Produce the variants now.")
  return lines.join("\n")
}

// ─── Output parsing ─────────────────────────────────────────────────────────

/** Pull the first top-level JSON object out of model text (tolerates fences/prose). */
export function extractJsonObject(text: string): string | null {
  let s = text.trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  const start = s.indexOf("{")
  const end = s.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) return null
  return s.slice(start, end + 1)
}

export type ParseProposalResult = { ok: true; proposal: TripProposal } | { ok: false; error: string }

/** Parse + validate model output, then apply integrity fixes. */
export function parseTripProposal(text: string): ParseProposalResult {
  const json = extractJsonObject(text)
  if (!json) return { ok: false, error: "Model output contained no JSON object" }
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (e) {
    return { ok: false, error: `Model output was not valid JSON: ${(e as Error).message}` }
  }
  const parsed = tripProposalSchema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ")
    return { ok: false, error: `Proposal failed validation: ${issues}` }
  }
  return { ok: true, proposal: normaliseProposal(parsed.data) }
}

/**
 * Enforce invariants the model may get wrong: dates ordered, and the
 * RETRIEVED label only where a persisted offer backs it.
 */
export function normaliseProposal(p: TripProposal): TripProposal {
  return {
    ...p,
    variants: p.variants.map((v) => {
      let { startDate, endDate } = v
      if (nightsBetween(startDate, endDate) === 0 && startDate > endDate) [startDate, endDate] = [endDate, startDate]
      const flight = v.flight
        ? {
            ...v.flight,
            source: (v.flight.searchId && v.flight.offerId ? "RETRIEVED" : "ESTIMATED") as PriceSource,
          }
        : undefined
      const lodging = { ...v.lodging, source: "ESTIMATED" as PriceSource }
      const total = {
        ...v.total,
        source: (flight?.source === "RETRIEVED" ? v.total.source : "ESTIMATED") as PriceSource,
      }
      return { ...v, startDate, endDate, flight, lodging, total }
    }),
  }
}

// ─── Runner ─────────────────────────────────────────────────────────────────

export interface RunTripProposalOptions {
  input: ProposeTripInput
  deps: TripProposalDeps
  callModel: ModelCaller
  maxIterations?: number
  maxTokens?: number
  today?: string
  homeCity?: string | null
  currency?: string
  onUsage?: (usage: ChatUsage, iteration: number) => void
}

export type RunTripProposalResult =
  | { ok: true; proposal: TripProposal; tokens: ChatUsage; iterations: number; loop: ToolLoopResult }
  | { ok: false; error: string; tokens: ChatUsage; iterations: number; loop: ToolLoopResult }

export async function runTripProposal(opts: RunTripProposalOptions): Promise<RunTripProposalResult> {
  const currency = (opts.currency ?? opts.input.currency ?? "USD").toUpperCase()
  const today = opts.today ?? new Date().toISOString().slice(0, 10)
  const tools = buildTripProposalTools(opts.deps, { currency })

  const loop = await runToolLoop({
    system: buildSystemPrompt({ today, currency }),
    user: buildUserPrompt(opts.input, { homeCity: opts.homeCity }),
    tools,
    maxIterations: opts.maxIterations ?? DEFAULT_MAX_ITERATIONS,
    maxTokens: opts.maxTokens ?? DEFAULT_TOKEN_BUDGET,
    callModel: opts.callModel,
    onUsage: opts.onUsage,
    maxCompletionTokens: 4096,
    finalizeOnCap: true,
    finalizeMessage:
      "You have used your tool budget. Stop calling tools and reply now with ONLY the final JSON object in the required format, using what you already know and marking anything unverified as ESTIMATED.",
  })

  const base = { tokens: loop.tokens, iterations: loop.iterations, loop }
  if (loop.stopReason === "error") {
    return { ok: false, error: loop.error ?? "Model call failed", ...base }
  }
  if (!loop.finalText) {
    return { ok: false, error: `The planner stopped (${loop.stopReason}) before producing a proposal`, ...base }
  }
  const parsed = parseTripProposal(loop.finalText)
  if (!parsed.ok) return { ok: false, error: parsed.error, ...base }
  return { ok: true, proposal: parsed.proposal, ...base }
}
