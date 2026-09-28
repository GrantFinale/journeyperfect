"use server"

/**
 * Server actions for the Opportunity Discovery Engine
 * (docs/plans/opportunity-discovery-engine.md §8). Every action is scoped to
 * the signed-in user; the pipeline itself lives in
 * src/lib/opportunities/pipeline.ts.
 *
 * Gates: the `opportunityDiscovery` plan feature, the plan's
 * maxOpportunitySearchesPerDay, and the app-wide
 * `opportunities.perUserDailySearches` ceiling. Private rates (stage 3) run
 * only after `authorizePrivateRates`, which records the explicit click.
 */
import { Prisma } from "@prisma/client"
import profilesSeed from "@/data/destination-profiles.json"
import routesSeed from "@/data/nonstop-routes.json"
import { AIRPORT_COORDS } from "@/lib/airports"
import { auth } from "@/lib/auth"
import { getConfigKeyNumber } from "@/lib/config-keys"
import { prisma } from "@/lib/db"
import { getUpgradeMessage, hasFeature } from "@/lib/features"
import { haversineDistance } from "@/lib/haversine"
import { buildTripFromOpportunity } from "@/lib/opportunities/build-trip"
import { normaliseWeekdayPattern } from "@/lib/opportunities/date-candidates"
import { daysBetween, isYmd } from "@/lib/opportunities/dates"
import { generateDestinationProfile } from "@/lib/opportunities/destination-profile-ai"
import { candidateCounts, runSearch, runStage, StageRefusedError } from "@/lib/opportunities/pipeline"
import { toOpportunityView, toSearchView } from "@/lib/opportunities/serialize"
import type { SearchConstraints } from "@/lib/opportunities/types"
import type { OpportunitySearchView, TravelOpportunityView } from "@/lib/opportunities/views"
import { getDynamicPlanLimits, type Plan } from "@/lib/plans"
import { revalidatePath } from "next/cache"

/** Airports within this distance of the user's home count as "home airports". */
const HOME_AIRPORT_RADIUS_KM = 120
const MAX_WINDOW_DAYS = 180
const MAX_NIGHTS = 14

async function requireUser() {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, plan: true, isAdmin: true, homeLat: true, homeLng: true },
  })
  if (!user) throw new Error("Unauthorized")
  return user
}

async function requireAdmin() {
  const user = await requireUser()
  if (!user.isAdmin) throw new Error("Forbidden")
  return user
}

// ─── Home airports ───────────────────────────────────────────────────────────

export async function getHomeAirports(): Promise<{ iata: string; name: string; distanceKm: number }[]> {
  const user = await requireUser()
  if (user.homeLat == null || user.homeLng == null) return []
  const out: { iata: string; name: string; distanceKm: number }[] = []
  for (const [iata, a] of Object.entries(AIRPORT_COORDS)) {
    const distanceKm = haversineDistance(user.homeLat, user.homeLng, a.lat, a.lng)
    if (distanceKm <= HOME_AIRPORT_RADIUS_KM) out.push({ iata, name: a.name, distanceKm: Math.round(distanceKm) })
  }
  return out.sort((a, b) => a.distanceKm - b.distanceKm || a.iata.localeCompare(b.iata))
}

// ─── Create ──────────────────────────────────────────────────────────────────

export async function createOpportunitySearch(input: {
  originAirports: string[]
  windowStart: string
  windowEnd: string
  nightsMin: number
  nightsMax: number
  weekdayPattern?: string | null
  travelerProfileIds: string[]
  constraints: SearchConstraints
}): Promise<{ searchId: string } | { error: string }> {
  const user = await requireUser()
  const plan = (user.plan as Plan) ?? "FREE"
  if (!hasFeature(plan, "opportunityDiscovery")) return { error: getUpgradeMessage("opportunityDiscovery") }

  // Daily caps: plan limit, then the app-wide ceiling.
  const [limits, appCeiling] = await Promise.all([getDynamicPlanLimits(plan), getConfigKeyNumber("opportunities.perUserDailySearches")])
  const dailyCap = Math.min(limits.maxOpportunitySearchesPerDay, appCeiling)
  const startOfDay = new Date()
  startOfDay.setUTCHours(0, 0, 0, 0)
  const today = await prisma.opportunitySearch.count({ where: { userId: user.id, createdAt: { gte: startOfDay } } })
  if (today >= dailyCap) {
    return { error: `You've used your ${dailyCap} opportunity search${dailyCap === 1 ? "" : "es"} for today.` }
  }

  // Validate.
  const originAirports = [...new Set(input.originAirports.map((a) => a.trim().toUpperCase()))].filter((a) => /^[A-Z]{3}$/.test(a))
  if (originAirports.length === 0) return { error: "Choose at least one home airport." }
  if (!isYmd(input.windowStart) || !isYmd(input.windowEnd)) return { error: "Dates must be YYYY-MM-DD." }
  const span = daysBetween(input.windowStart, input.windowEnd)
  if (span < 1) return { error: "The window must end after it starts." }
  if (span > MAX_WINDOW_DAYS) return { error: `The window can be at most ${MAX_WINDOW_DAYS} days.` }
  const nightsMin = Math.floor(Number(input.nightsMin))
  const nightsMax = Math.floor(Number(input.nightsMax))
  if (!Number.isFinite(nightsMin) || !Number.isFinite(nightsMax) || nightsMin < 1 || nightsMax < nightsMin || nightsMax > MAX_NIGHTS) {
    return { error: `Nights must be between 1 and ${MAX_NIGHTS}, with the minimum not above the maximum.` }
  }
  if (nightsMin > span) return { error: "The window is shorter than the minimum stay." }
  // Stored in the canonical "THU-SUN" form whichever encoding the UI sent.
  const weekdayPattern = normaliseWeekdayPattern(input.weekdayPattern)

  const travelers = await prisma.travelerProfile.findMany({
    where: { id: { in: input.travelerProfileIds }, userId: user.id },
    select: { id: true },
  })
  if (travelers.length === 0) return { error: "Pick at least one traveler." }
  if (travelers.length > limits.maxTravelersPerTrip) return { error: `Your plan allows up to ${limits.maxTravelersPerTrip} travelers.` }

  // Origin coordinates: home, else the first origin airport.
  let originLat = user.homeLat
  let originLng = user.homeLng
  if (originLat == null || originLng == null) {
    const a = AIRPORT_COORDS[originAirports[0]]
    if (!a) return { error: "Set your home address in Settings so we can estimate door-to-door time." }
    originLat = a.lat
    originLng = a.lng
  }

  const c = input.constraints ?? {}
  const constraints: SearchConstraints = {}
  if (c.maxCoreCost != null && Number.isFinite(Number(c.maxCoreCost))) constraints.maxCoreCost = Number(c.maxCoreCost)
  if (c.nonstopOnly) constraints.nonstopOnly = true
  if (c.maxFlightMins != null && Number.isFinite(Number(c.maxFlightMins))) constraints.maxFlightMins = Number(c.maxFlightMins)
  if (c.drivingOk) constraints.drivingOk = true
  if (c.warm) constraints.warm = true
  if (Array.isArray(c.regions) && c.regions.length) constraints.regions = c.regions.map((r) => String(r).trim().toLowerCase()).filter(Boolean)

  const search = await prisma.opportunitySearch.create({
    data: {
      userId: user.id,
      originAirports,
      originLat,
      originLng,
      windowStart: new Date(`${input.windowStart}T00:00:00.000Z`),
      windowEnd: new Date(`${input.windowEnd}T00:00:00.000Z`),
      nightsMin,
      nightsMax,
      weekdayPattern,
      travelerProfileIds: travelers.map((t) => t.id),
      constraints: constraints as unknown as Prisma.InputJsonValue,
      status: "DRAFT",
    },
    select: { id: true },
  })
  revalidatePath("/opportunities")
  return { searchId: search.id }
}

// ─── Run ─────────────────────────────────────────────────────────────────────

async function ownedSearch(searchId: string, userId: string) {
  const search = await prisma.opportunitySearch.findFirst({ where: { id: searchId, userId } })
  if (!search) throw new Error("Search not found")
  return search
}

async function counts(searchId: string): Promise<{ candidateCount: number; opportunityCount: number }> {
  const [candidateCount, opportunityCount] = await Promise.all([
    prisma.opportunityCandidate.count({ where: { searchId } }),
    prisma.travelOpportunity.count({ where: { searchId } }),
  ])
  return { candidateCount, opportunityCount }
}

export async function runOpportunitySearch(searchId: string): Promise<{ status: string; candidateCount: number; opportunityCount: number }> {
  const user = await requireUser()
  await ownedSearch(searchId, user.id)
  const run = await runSearch(searchId)
  const c = await counts(searchId)
  revalidatePath("/opportunities")
  revalidatePath(`/opportunities/${searchId}`)
  if (run.error) console.error("[opportunities] runOpportunitySearch failed:", run.error)
  return { status: run.error ? "FAILED: The search could not be completed. Please try again." : run.status, ...c }
}

/**
 * Records the user's explicit click, then runs stage 3 (private rates) and
 * re-scores in stage 4. Stage 3 never runs any other way.
 */
export async function authorizePrivateRates(searchId: string): Promise<{ status: string; opportunityCount: number }> {
  const user = await requireUser()
  const search = await ownedSearch(searchId, user.id)
  if (!search.privateRatesAuthorizedAt) {
    await prisma.opportunitySearch.update({ where: { id: searchId }, data: { privateRatesAuthorizedAt: new Date() } })
  }
  let status: string
  try {
    const s3 = await runStage(searchId, 3)
    const s4 = await runStage(searchId, 4)
    status = s3.note ? `${s4.status} (${s3.note})` : s4.status
  } catch (err) {
    console.error("[opportunities] authorizePrivateRates failed:", err)
    // StageRefusedError messages are written for the user (gate/limit reasons);
    // anything else stays server-side.
    status = err instanceof StageRefusedError ? `FAILED: ${err.message}` : "FAILED: Private rates could not be checked. Please try again."
  }
  const c = await counts(searchId)
  revalidatePath(`/opportunities/${searchId}`)
  return { status, opportunityCount: c.opportunityCount }
}

// ─── Read ────────────────────────────────────────────────────────────────────

export async function getOpportunitySearch(searchId: string): Promise<{
  search: OpportunitySearchView
  opportunities: TravelOpportunityView[]
  candidateCounts: { total: number; pruned: number; byStage: Record<number, number> }
} | null> {
  const user = await requireUser()
  const search = await prisma.opportunitySearch.findFirst({ where: { id: searchId, userId: user.id } })
  if (!search) return null
  const [rows, cc] = await Promise.all([
    prisma.travelOpportunity.findMany({ where: { searchId, userId: user.id } }),
    candidateCounts(searchId),
  ])
  // Best first: the candidate's score is the ranking; ties by destination name.
  const scores = new Map(
    (await prisma.opportunityCandidate.findMany({ where: { searchId }, select: { id: true, score: true } })).map((c) => [c.id, c.score ?? -Infinity])
  )
  rows.sort((a, b) => (scores.get(b.candidateId) ?? -Infinity) - (scores.get(a.candidateId) ?? -Infinity) || a.destinationName.localeCompare(b.destinationName))
  return {
    search: toSearchView(search, { candidateCount: cc.total, opportunityCount: rows.length }),
    opportunities: rows.map(toOpportunityView),
    candidateCounts: cc,
  }
}

export async function listOpportunitySearches(): Promise<OpportunitySearchView[]> {
  const user = await requireUser()
  const rows = await prisma.opportunitySearch.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { _count: { select: { candidates: true, opportunities: true } } },
  })
  return rows.map((r) => toSearchView(r, { candidateCount: r._count.candidates, opportunityCount: r._count.opportunities }))
}

// ─── Build This Trip ─────────────────────────────────────────────────────────

export async function buildTrip(opportunityId: string): Promise<{ tripId: string } | { error: string }> {
  const user = await requireUser()
  try {
    const built = await buildTripFromOpportunity(user.id, opportunityId)
    revalidatePath("/dashboard")
    revalidatePath(`/trip/${built.tripId}`)
    return { tripId: built.tripId }
  } catch (err) {
    console.error("[opportunities] buildTrip failed:", err)
    return { error: "We couldn't build this trip. Please try again." }
  }
}

// ─── Admin ───────────────────────────────────────────────────────────────────

export async function generateDestinationProfileAdmin(iata: string): Promise<{ ok: true; iata: string; name: string; model: string; created: boolean } | { ok: false; error: string }> {
  const admin = await requireAdmin()
  try {
    const { profile, model, created } = await generateDestinationProfile(iata, { userId: admin.id })
    revalidatePath("/admin/settings")
    return { ok: true, iata: profile.iata, name: profile.name, model, created }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

interface RouteSeed {
  originIata: string
  destIata: string
  carriers: string[]
  typicalDurationMins: number
}

/**
 * Upsert src/data/*.json into the reference tables. Same semantics as
 * scripts/seed-opportunity-data.ts (which is not shipped in the production
 * image): NonstopRoute rows owned by OBSERVED_OFFER or SCHEDULE_API are never
 * overwritten by the 2014 OpenFlights seed.
 */
export async function seedOpportunityDataAdmin(): Promise<{
  routes: { created: number; refreshed: number; skipped: number }
  profiles: { upserted: number }
}> {
  await requireAdmin()
  const now = new Date()

  const routes = routesSeed as RouteSeed[]
  const existing = await prisma.nonstopRoute.findMany({ select: { originIata: true, destIata: true, source: true } })
  const sourceByKey = new Map(existing.map((r) => [`${r.originIata}-${r.destIata}`, r.source]))
  const toCreate: RouteSeed[] = []
  const toRefresh: RouteSeed[] = []
  let skipped = 0
  for (const r of routes) {
    const source = sourceByKey.get(`${r.originIata}-${r.destIata}`)
    if (source === undefined) toCreate.push(r)
    else if (source === "OPENFLIGHTS_SEED") toRefresh.push(r)
    else skipped++
  }
  const BATCH = 500
  for (let i = 0; i < toCreate.length; i += BATCH) {
    await prisma.nonstopRoute.createMany({
      data: toCreate.slice(i, i + BATCH).map((r) => ({
        originIata: r.originIata,
        destIata: r.destIata,
        carriers: r.carriers,
        weeklyFrequency: null,
        typicalDurationMins: r.typicalDurationMins,
        departureBuckets: [],
        source: "OPENFLIGHTS_SEED",
        lastVerifiedAt: now,
      })),
      skipDuplicates: true,
    })
  }
  for (let i = 0; i < toRefresh.length; i += BATCH) {
    await prisma.$transaction(
      toRefresh.slice(i, i + BATCH).map((r) =>
        prisma.nonstopRoute.update({
          where: { originIata_destIata: { originIata: r.originIata, destIata: r.destIata } },
          data: { carriers: r.carriers, typicalDurationMins: r.typicalDurationMins, lastVerifiedAt: now },
        })
      )
    )
  }

  let upserted = 0
  for (const p of profilesSeed as Record<string, unknown>[]) {
    const iata = String(p.iata)
    const data = {
      name: String(p.name),
      lat: Number(p.lat),
      lng: Number(p.lng),
      tier: String(p.tier),
      idealNightsMin: Number(p.idealNightsMin),
      idealNightsMax: Number(p.idealNightsMax),
      walkable: p.walkable === true,
      carNeeded: p.carNeeded === true,
      airportToCenterKm: Number(p.airportToCenterKm),
      parkingTypical: String(p.parkingTypical),
      activitiesDispersed: p.activitiesDispersed === true,
      familyFit: p.familyFit as Prisma.InputJsonValue,
      anchors: p.anchors as Prisma.InputJsonValue,
      climate: p.climate == null ? Prisma.JsonNull : (p.climate as Prisma.InputJsonValue),
      generatedBy: String(p.generatedBy ?? "HAND_AUTHORED"),
      refreshedAt: now,
    }
    await prisma.destinationProfile.upsert({ where: { iata }, create: { iata, ...data }, update: data })
    upserted++
  }

  return { routes: { created: toCreate.length, refreshed: toRefresh.length, skipped }, profiles: { upserted } }
}
