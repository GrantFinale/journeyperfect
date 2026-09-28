"use server"

/**
 * AI trip proposals: idea -> costed variants -> real Trip.
 * docs/plans/flights-search-tracking-and-booking.md §5.
 *
 * Persistence note: proposals are NOT stored server-side (no schema change).
 * `proposeTrip` returns the full TripProposal to the client, and
 * `acceptProposalVariant` takes the complete variant payload back, re-validates
 * it with the same zod schema, and materialises it as a Trip. The
 * `proposalId` in the return value is a per-request nonce for client keys only.
 */
import { randomUUID } from "node:crypto"
import { revalidatePath } from "next/cache"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getConfig } from "@/lib/config"
import { getConfigKey, getConfigKeyNumber } from "@/lib/config-keys"
import { hasFeature, getUpgradeMessage } from "@/lib/features"
import { reserveAIUsage, settleAIUsage } from "@/lib/ai-usage"
import { getHotelBookingLink } from "@/lib/affiliates"
import { searchPlaces } from "@/lib/actions/activities"
import { createTrip } from "@/lib/actions/trips"
import { searchFlights, acceptFlightOffer } from "@/lib/actions/flight-search"
// Written concurrently by the flights agent (plan §4.2). Signature assumed:
// getFareCalendar({ origin, destination, month?, currency }) => Promise<unknown>.
import { getFareCalendar } from "@/lib/flights/providers/travelpayouts"
import { makeOpenRouterCaller } from "@/lib/ai/tool-loop"
import {
  DAILY_CAP_CONFIG_KEY,
  DEFAULT_DAILY_CAP,
  DEFAULT_TOKEN_BUDGET,
  TOKEN_BUDGET_CONFIG_KEY,
  TRIP_PROPOSAL_FEATURE,
  nightsBetween,
  proposeTripInputSchema,
  runTripProposal,
  tripProposalVariantSchema,
  type ActivitySuggestion,
  type AgentFlightSearchResult,
  type FareCalendarArgs,
  type ProposeTripInput,
  type ResolvedPlace,
  type TripProposal,
  type TripProposalDeps,
  type TripProposalVariant,
} from "@/lib/ai/trip-proposal"
import type { FlightQuery } from "@/lib/flights/types"
import type { FlightOfferView } from "@/lib/flights/views"

export type { TripProposal, TripProposalVariant, ProposeTripInput } from "@/lib/ai/trip-proposal"

export type ProposeTripResult = { proposalId: string; proposal: TripProposal } | { error: string }

// ─── Gate helpers ───────────────────────────────────────────────────────────

async function requireProposalUser() {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, plan: true, homeCity: true, homeAddress: true },
  })
  if (!user) throw new Error("Unauthorized")
  return user
}

function startOfUtcDay(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

/** One AIUsage row is written per proposal run, so counting rows = counting runs. */
async function proposalsUsedToday(userId: string): Promise<number> {
  return prisma.aIUsage.count({
    where: { userId, feature: TRIP_PROPOSAL_FEATURE, createdAt: { gte: startOfUtcDay() } },
  })
}

// ─── Real tool dependencies ─────────────────────────────────────────────────

/** Minimal shape of a searchPlaces() result row that the agent tools consume. */
type PlaceRow = {
  googlePlaceId: string
  name: string
  address: string
  lat?: number
  lng?: number
  rating?: number
  types?: string[]
  primaryType?: string
}

function summariseOffer(o: FlightOfferView): string {
  const h = Math.floor(o.durationMins / 60)
  const m = o.durationMins % 60
  const stops = o.stops === 0 ? "nonstop" : `${o.stops} stop${o.stops === 1 ? "" : "s"}`
  const first = o.outbound?.segments?.[0]
  const last = o.outbound?.segments?.[o.outbound.segments.length - 1]
  const route = first && last ? ` ${first.from}→${last.to}` : ""
  const ret = o.inbound?.segments?.[0]?.departAt ? `, return ${o.inbound.segments[0].departAt.slice(0, 10)}` : ""
  return `${o.carrierCodes.join("/") || "Airline"}${route}, ${stops}, ${h}h ${m}m${ret} — ${o.currency} ${Math.round(o.totalPrice)}`
}

function buildDeps(): TripProposalDeps {
  return {
    resolveDestination: async (query): Promise<ResolvedPlace | null> => {
      const { results } = await searchPlaces(query, undefined, { limit: 1 })
      const r = (results as PlaceRow[])[0]
      if (!r || typeof r.lat !== "number" || typeof r.lng !== "number") return null
      return { name: r.name, address: r.address, lat: r.lat, lng: r.lng, placeId: r.googlePlaceId }
    },

    // Uses the persisted search path (FlightSearch + FlightOffer rows, tripId
    // null) rather than the raw cache so the offer ids survive into
    // acceptProposalVariant -> acceptFlightOffer.
    searchFlights: async (q: FlightQuery): Promise<AgentFlightSearchResult> => {
      const res = await searchFlights(null, q)
      return {
        searchId: res.searchId,
        fromCache: res.fromCache,
        insight: res.insight ? { lowestPrice: res.insight.lowestPrice, level: res.insight.level } : undefined,
        offers: res.offers.map((o) => ({
          offerId: o.id,
          totalPrice: o.totalPrice,
          currency: o.currency,
          carrierCodes: o.carrierCodes,
          stops: o.stops,
          durationMins: o.durationMins,
          bookingUrl: o.bookingUrl,
          summary: summariseOffer(o),
        })),
      }
    },

    getFareCalendar: async (args: FareCalendarArgs) => {
      const fn = getFareCalendar as unknown as (a: FareCalendarArgs) => Promise<unknown>
      return fn(args)
    },

    suggestActivities: async ({ destination, lat, lng, interests }): Promise<ActivitySuggestion[]> => {
      const bias = typeof lat === "number" && typeof lng === "number" ? `${lat},${lng}` : undefined
      const query = interests ? `${interests} things to do in ${destination}` : `top attractions in ${destination}`
      const { results } = await searchPlaces(query, bias, { limit: 10 })
      return (results as PlaceRow[]).map((r) => ({
        title: r.name,
        kind: r.primaryType ?? r.types?.[0] ?? "attraction",
        rating: r.rating,
        placeId: r.googlePlaceId,
        lat: r.lat,
        lng: r.lng,
        address: r.address,
      }))
    },

    hotelLink: async (destination, checkIn, checkOut) => (await getHotelBookingLink(destination, checkIn, checkOut)).url,
  }
}

// ─── proposeTrip ────────────────────────────────────────────────────────────

export async function proposeTrip(input: ProposeTripInput): Promise<ProposeTripResult> {
  let user: Awaited<ReturnType<typeof requireProposalUser>>
  try {
    user = await requireProposalUser()
  } catch {
    return { error: "Unauthorized" }
  }

  if (!hasFeature(user.plan, "aiTripProposals")) {
    return { error: `UPGRADE_REQUIRED:${getUpgradeMessage("aiTripProposals")}` }
  }

  const parsed = proposeTripInputSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return { error: "AI planning is not configured on this server." }

  // Per-user daily cap (plan §5 hard guard)
  const dailyCap = parseInt(await getConfig(DAILY_CAP_CONFIG_KEY, String(DEFAULT_DAILY_CAP)), 10) || DEFAULT_DAILY_CAP
  const used = await proposalsUsedToday(user.id)
  if (used >= dailyCap) {
    return { error: `You've used today's ${dailyCap} AI trip proposals. Try again tomorrow.` }
  }

  const [model, maxIterations, tokenBudgetRaw] = await Promise.all([
    getConfigKey("ai.tripPlannerModel"),
    getConfigKeyNumber("ai.tripPlannerMaxIterations"),
    getConfig(TOKEN_BUDGET_CONFIG_KEY, String(DEFAULT_TOKEN_BUDGET)),
  ])
  const maxTokens = parseInt(tokenBudgetRaw, 10) || DEFAULT_TOKEN_BUDGET

  // One row per run, success or not, so the daily cap counts attempts. It is
  // written BEFORE the model runs so two concurrent requests cannot both pass
  // the cap check above; token counts are filled in afterwards.
  const usageId = await reserveAIUsage({ userId: user.id, feature: TRIP_PROPOSAL_FEATURE, model })

  let result: Awaited<ReturnType<typeof runTripProposal>>
  try {
    result = await runTripProposal({
      input: parsed.data,
      deps: buildDeps(),
      callModel: makeOpenRouterCaller({ model, apiKey, temperature: 0.2, timeoutMs: 90_000 }),
      maxIterations,
      maxTokens,
      homeCity: user.homeCity ?? user.homeAddress,
    })
  } catch (err) {
    console.error("[proposeTrip] run threw:", err)
    return { error: "The planner couldn't produce a proposal this time. Try rephrasing your idea." }
  }

  await settleAIUsage(usageId, {
    model,
    promptTokens: result.tokens.promptTokens,
    completionTokens: result.tokens.completionTokens,
  })

  if (!result.ok) {
    console.error("[proposeTrip] failed:", result.error, {
      iterations: result.iterations,
      tokens: result.tokens.totalTokens,
      stop: result.loop.stopReason,
    })
    return { error: "The planner couldn't produce a proposal this time. Try rephrasing your idea." }
  }

  return { proposalId: randomUUID(), proposal: result.proposal }
}

// ─── acceptProposalVariant ──────────────────────────────────────────────────

/**
 * Materialise one variant as a real Trip. Takes the full variant payload
 * (proposals are not persisted server-side; see the module note).
 */
export async function acceptProposalVariant(variant: TripProposalVariant): Promise<{ tripId: string }> {
  const user = await requireProposalUser()
  if (!hasFeature(user.plan, "aiTripProposals")) {
    throw new Error(`UPGRADE_REQUIRED:${getUpgradeMessage("aiTripProposals")}`)
  }
  const v = tripProposalVariantSchema.parse(variant)
  const nights = nightsBetween(v.startDate, v.endDate)
  const currency = v.total.currency || "USD"

  // 1. Trip (createTrip enforces plan limits and prefills origin from home)
  const monthName = new Date(`${v.startDate}T12:00:00Z`).toLocaleString("en-US", { month: "long", timeZone: "UTC" })
  const trip = await createTrip({
    title: `${v.destination.name.split(",")[0].trim()} — ${monthName} ${v.startDate.slice(0, 4)}`,
    destinations: [{ name: v.destination.name, lat: v.destination.lat, lng: v.destination.lng }],
    destinationLat: v.destination.lat,
    destinationLng: v.destination.lng,
    startDate: v.startDate,
    endDate: v.endDate,
    notes: `Built from an AI trip proposal ("${v.label}"). Prices marked ESTIMATED are planning figures, not quotes.`,
  })
  const tripId = trip.id

  await prisma.trip.update({
    where: { id: tripId },
    data: {
      opportunityRationale: {
        source: TRIP_PROPOSAL_FEATURE,
        label: v.label,
        rationale: v.rationale,
        total: v.total,
      },
    },
  })

  // 2. Travelers: the user's profiles, default first, up to the variant count
  const profiles = await prisma.travelerProfile.findMany({
    where: { userId: user.id },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    take: v.travelers,
    select: { id: true },
  })
  if (profiles.length > 0) {
    await prisma.tripTraveler.createMany({
      data: profiles.map((p, i) => ({ tripId, travelerProfileId: p.id, isPrimary: i === 0 })),
      skipDuplicates: true,
    })
  }

  // 3. Flight: real rows via the flights action when we hold a persisted offer
  let flightLinked = false
  if (v.flight?.searchId && v.flight.offerId) {
    try {
      // The proposal search was speculative (tripId null); attach it (owner-
      // scoped) so it shows on the trip's Flights page, and tell
      // acceptFlightOffer which trip the Flight rows belong on.
      await prisma.flightSearch.updateMany({
        where: { id: v.flight.searchId, userId: user.id, tripId: null },
        data: { tripId },
      })
      const accepted = await acceptFlightOffer(v.flight.searchId, v.flight.offerId, tripId)
      flightLinked = accepted.flightIds.length > 0
    } catch (e) {
      console.error("[acceptProposalVariant] acceptFlightOffer failed, falling back to estimate:", e)
    }
  }

  // 4. Activities as WISHLIST
  if (v.activities.length > 0) {
    await prisma.activity.createMany({
      data: v.activities.map((a) => ({
        tripId,
        name: a.title,
        description: a.description,
        category: a.kind,
        costPerAdult: a.estCost ?? 0,
        lat: a.lat,
        lng: a.lng,
        googlePlaceId: a.placeId,
        status: "WISHLIST" as const,
        priority: "MEDIUM" as const,
      })),
    })
  }

  // 5. Budget items for the estimates
  const activityEstimate = v.activities.reduce((s, a) => s + (a.estCost ?? 0), 0) * v.travelers
  const flightAmount = v.flight?.totalPrice ?? 0
  const remainder = Math.max(0, v.total.amount - flightAmount - v.lodging.estimateTotal - activityEstimate)

  const budgetRows: Array<{
    category: "FLIGHTS" | "LODGING" | "ACTIVITIES" | "OTHER"
    title: string
    amount: number
    currency: string
    isEstimate: boolean
    notes?: string
  }> = []

  if (v.flight && !flightLinked && v.flight.totalPrice > 0) {
    budgetRows.push({
      category: "FLIGHTS",
      title: `Flights (${v.flight.source === "RETRIEVED" ? "quoted" : "estimate"}): ${v.flight.offerSummary}`.slice(0, 200),
      amount: v.flight.totalPrice,
      currency: v.flight.currency || currency,
      isEstimate: true,
      notes: v.flight.bookingUrl,
    })
  }
  if (v.lodging.estimateTotal > 0) {
    budgetRows.push({
      category: "LODGING",
      title: `Lodging estimate${v.lodging.tier ? ` (${v.lodging.tier})` : ""}: ${nights} night${nights === 1 ? "" : "s"} × ${Math.round(v.lodging.perNight)}`,
      amount: v.lodging.estimateTotal,
      currency: v.lodging.currency || currency,
      isEstimate: true,
      notes: v.lodging.bookingUrl,
    })
  }
  if (activityEstimate > 0) {
    budgetRows.push({
      category: "ACTIVITIES",
      title: `Activities estimate (${v.activities.length} picks × ${v.travelers} traveler${v.travelers === 1 ? "" : "s"})`,
      amount: activityEstimate,
      currency,
      isEstimate: true,
    })
  }
  if (remainder > 0) {
    budgetRows.push({
      category: "OTHER",
      title: "Food & local transport estimate",
      amount: remainder,
      currency,
      isEstimate: true,
    })
  }
  if (budgetRows.length > 0) {
    await prisma.budgetItem.createMany({ data: budgetRows.map((b) => ({ tripId, ...b })) })
  }

  revalidatePath("/dashboard")
  revalidatePath(`/trip/${tripId}`)
  revalidatePath(`/trip/${tripId}/itinerary`)
  return { tripId }
}
