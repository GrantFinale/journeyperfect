/**
 * "Build This Trip" (plan §9). TravelOpportunity → Trip + Hotel + Flight +
 * Activity rows. Nothing is re-entered; the user lands in the normal Plan view.
 *
 *   - Trip: origin from the user's home, destination, dates, travelers from
 *     the search's travelerProfileIds, builtFromOpportunityId and
 *     opportunityRationale (the reasons) so the rationale survives.
 *   - Hotel: name and rate, confirmation left blank so it appears in To Do
 *     as needing a reservation.
 *   - Flight: via acceptFlightOffer when the opportunity has a flightOfferId.
 *   - Activities: WISHLIST rows for the anchors in season on those dates.
 */
import { Prisma } from "@prisma/client"
import { acceptFlightOffer } from "@/lib/actions/flight-search"
import { prisma } from "@/lib/db"
import { getDynamicPlanLimits, type Plan } from "@/lib/plans"
import { formatStayLabel, formatYmd } from "./dates"
import { anchorsForStay, isSeasonal } from "./factors/anchor"
import { loadDestinationProfiles } from "./pipeline"
import type { OpportunityReason } from "./types"

export interface BuildTripResult {
  tripId: string
  hotelId: string | null
  flightIds: string[]
  activityIds: string[]
  /** True when the opportunity had already been built and the existing trip was returned */
  alreadyBuilt: boolean
  warnings: string[]
}

const ANCHOR_CATEGORY: Record<string, string> = {
  THEME_PARK: "attraction",
  ATTRACTION: "attraction",
  NATURE: "nature",
  NATURAL: "nature",
  FESTIVAL: "event",
  EVENT: "event",
  SPORTS: "sports",
  SEASONAL: "attraction",
  OTHER: "attraction",
}

export async function buildTripFromOpportunity(userId: string, opportunityId: string): Promise<BuildTripResult> {
  const opp = await prisma.travelOpportunity.findFirst({ where: { id: opportunityId, userId } })
  if (!opp) throw new Error("Opportunity not found")
  if (opp.builtTripId) {
    const existing = await prisma.trip.findFirst({ where: { id: opp.builtTripId, userId }, select: { id: true } })
    if (existing) return { tripId: existing.id, hotelId: null, flightIds: [], activityIds: [], alreadyBuilt: true, warnings: [] }
  }

  const [search, candidate, user] = await Promise.all([
    prisma.opportunitySearch.findUnique({ where: { id: opp.searchId } }),
    prisma.opportunityCandidate.findUnique({ where: { id: opp.candidateId } }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true, homeAddress: true, homeCity: true, homeLat: true, homeLng: true },
    }),
  ])
  if (!search || !user) throw new Error("Search or user not found")

  const limits = await getDynamicPlanLimits((user.plan as Plan) ?? "FREE")
  const tripCount = await prisma.trip.count({ where: { userId } })
  if (tripCount >= limits.maxTrips) {
    throw new Error(`PLAN_LIMIT: You've reached your ${limits.maxTrips} trip limit. Upgrade to add more.`)
  }

  const travelerIds = (
    await prisma.travelerProfile.findMany({ where: { id: { in: search.travelerProfileIds }, userId }, select: { id: true, isDefault: true } })
  ).sort((a, b) => Number(b.isDefault) - Number(a.isDefault))

  const checkIn = formatYmd(opp.checkIn)
  const checkOut = formatYmd(opp.checkOut)
  const reasons = (Array.isArray(opp.opportunityReasons) ? opp.opportunityReasons : []) as unknown as OpportunityReason[]
  const warnings: string[] = []

  const trip = await prisma.trip.create({
    data: {
      userId,
      title: `${opp.destinationName} · ${formatStayLabel(checkIn, checkOut)}`,
      destination: opp.destinationName,
      destinationLat: candidate?.destinationLat ?? null,
      destinationLng: candidate?.destinationLng ?? null,
      startDate: opp.checkIn,
      endDate: opp.checkOut,
      originLabel: user.homeAddress || user.homeCity ? "Home" : null,
      originAddress: user.homeAddress ?? user.homeCity ?? null,
      originLat: user.homeLat ?? search.originLat,
      originLng: user.homeLng ?? search.originLng,
      builtFromOpportunityId: opp.id,
      opportunityRationale: reasons as unknown as Prisma.InputJsonValue,
      destinations: {
        create: [{ name: opp.destinationName, lat: candidate?.destinationLat ?? null, lng: candidate?.destinationLng ?? null, position: 0 }],
      },
      travelers: {
        create: travelerIds.map((t, i) => ({ travelerProfileId: t.id, isPrimary: i === 0 })),
      },
    },
  })

  // Hotel: retrieved rate, no confirmation → shows in To Do as needing a reservation.
  let hotelId: string | null = null
  if (opp.hotelName) {
    const quote = opp.hotelRateQuoteId ? await prisma.hotelRateQuote.findUnique({ where: { id: opp.hotelRateQuoteId } }) : null
    const noteParts = [
      opp.privateNightlyRate != null ? `Private rate ${opp.privateNightlyRate.toFixed(0)}/night` : null,
      opp.comparablePublicRate != null ? `public ${opp.comparablePublicRate.toFixed(0)}/night` : null,
      quote ? `retrieved ${quote.retrievedAt.toISOString().slice(0, 16).replace("T", " ")}` : null,
      "Book with your Hilton Go access, then add the confirmation here.",
    ].filter(Boolean)
    const hotel = await prisma.hotel.create({
      data: {
        tripId: trip.id,
        name: opp.hotelName,
        lat: quote?.lat ?? null,
        lng: quote?.lng ?? null,
        checkIn: opp.checkIn,
        checkOut: opp.checkOut,
        price: opp.privateNightlyRate ?? null,
        priceCurrency: quote?.currency ?? "USD",
        roomType: quote?.roomType ?? null,
        notes: noteParts.join(" · "),
      },
    })
    hotelId = hotel.id
  }

  // Flight: through the flights plan's accept path.
  let flightIds: string[] = []
  if (opp.flightOfferId) {
    try {
      const offer = await prisma.flightOffer.findUnique({ where: { id: opp.flightOfferId }, select: { searchId: true } })
      if (offer) {
        // Owner-scoped attach of the (speculative, tripId null) search; the
        // target trip is passed explicitly so nothing depends on this write.
        await prisma.flightSearch
          .updateMany({ where: { id: offer.searchId, userId, tripId: null }, data: { tripId: trip.id } })
          .catch(() => {})
        const accepted = await acceptFlightOffer(offer.searchId, opp.flightOfferId, trip.id)
        flightIds = accepted.flightIds
      } else {
        warnings.push("The chosen flight offer has expired; search again from the trip.")
      }
    } catch (err) {
      console.error("[opportunities] acceptFlightOffer failed:", err)
      warnings.push("Flights could not be added automatically; add them from the trip.")
    }
  }

  // Activities: WISHLIST rows for the anchors in season.
  const activityIds: string[] = []
  try {
    const profile = (await loadDestinationProfiles()).find((p) => p.iata === opp.destinationIata)
    const anchors = profile ? anchorsForStay(profile.anchors, checkIn, checkOut) : []
    const anchorExp = opp.anchorExperience as { title?: string } | null
    const ordered = [...anchors].sort((a, b) => {
      const ap = a.title === anchorExp?.title ? 0 : isSeasonal(a) ? 1 : 2
      const bp = b.title === anchorExp?.title ? 0 : isSeasonal(b) ? 1 : 2
      return ap - bp
    })
    for (const a of ordered.slice(0, 5)) {
      const act = await prisma.activity.create({
        data: {
          tripId: trip.id,
          name: a.title,
          category: ANCHOR_CATEGORY[a.rawKind] ?? ANCHOR_CATEGORY[a.kind] ?? "attraction",
          status: "WISHLIST",
          priority: a.title === anchorExp?.title ? "HIGH" : "MEDIUM",
          indoorOutdoor: a.weatherDependent ? "OUTDOOR" : "BOTH",
          durationMins: a.rawKind === "THEME_PARK" ? 480 : 180,
          notes: "Suggested by Opportunity Discovery",
        },
        select: { id: true },
      })
      activityIds.push(act.id)
    }
  } catch (err) {
    console.error("[opportunities] activity creation failed:", err)
    warnings.push("Suggested activities could not be added.")
  }

  await prisma.travelOpportunity.update({ where: { id: opp.id }, data: { builtTripId: trip.id } })
  return { tripId: trip.id, hotelId, flightIds, activityIds, alreadyBuilt: false, warnings }
}
