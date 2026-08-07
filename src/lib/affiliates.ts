import { getConfig } from "./config"

export interface AffiliateLink {
  provider: string
  url: string
  label: string
  icon: string
  commission: string
}

// Booking.com affiliate (via Awin network)
// Awin merchant ID for Booking.com: 6776
// Config key "affiliate.booking.id" stores the Awin publisher/affiliate ID
export async function getHotelBookingLink(
  destination: string,
  checkIn?: string,
  checkOut?: string
): Promise<AffiliateLink> {
  const awinAffiliateId = await getConfig("affiliate.booking.id", "")
  // Build the destination URL on Booking.com
  const bookingParams = new URLSearchParams({
    ss: destination,
    ...(checkIn && { checkin: checkIn }),
    ...(checkOut && { checkout: checkOut }),
  })
  const destinationUrl = `https://www.booking.com/searchresults.html?${bookingParams}`

  // If we have an Awin affiliate ID, use Awin tracking link
  const url = awinAffiliateId
    ? `https://www.awin1.com/cread.php?awinmid=6776&awinaffid=${awinAffiliateId}&ued=${encodeURIComponent(destinationUrl)}`
    : destinationUrl

  return {
    provider: "Booking.com",
    url,
    label: "Find hotels on Booking.com",
    icon: "\u{1F3E8}",
    commission: "4%",
  }
}

// Car rentals via Booking.com/Awin (same affiliate account as hotels)
export async function getRentalCarLink(
  pickupLocation: string,
  pickupDate?: string,
  dropoffDate?: string
): Promise<AffiliateLink> {
  const awinAffiliateId = await getConfig("affiliate.booking.id", "")
  const carParams = new URLSearchParams({
    ss: pickupLocation,
    ...(pickupDate && { pickup_date: pickupDate }),
    ...(dropoffDate && { dropoff_date: dropoffDate }),
  })
  const destinationUrl = `https://www.booking.com/cars/index.html?${carParams}`

  const url = awinAffiliateId
    ? `https://www.awin1.com/cread.php?awinmid=6776&awinaffid=${awinAffiliateId}&ued=${encodeURIComponent(destinationUrl)}`
    : destinationUrl

  return {
    provider: "Booking.com",
    url,
    label: "Rent a car on Booking.com",
    icon: "\u{1F697}",
    commission: "3.8-6%",
  }
}

// Viator for activities (deep link to search results)
export async function getActivityBookingLink(
  activityName: string,
  destination: string
): Promise<AffiliateLink> {
  const viatorPid = await getConfig("affiliate.viator.pid", "")
  const params = new URLSearchParams({
    text: `${activityName} ${destination}`,
    ...(viatorPid && { pid: viatorPid, mcid: "42383", medium: "link" }),
  })
  return {
    provider: "Viator",
    url: `https://www.viator.com/searchResults/all?${params}`,
    label: "Book on Viator",
    icon: "\u{1F39F}\uFE0F",
    commission: "8%",
  }
}

// Viator destination-level deep link
export async function getViatorDestinationLink(
  destination: string
): Promise<AffiliateLink> {
  const viatorPid = await getConfig("affiliate.viator.pid", "")
  // Viator uses URL-friendly destination slugs
  const slug = destination
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
  const params = new URLSearchParams({
    ...(viatorPid && { pid: viatorPid, mcid: "42383", medium: "link" }),
  })
  const qs = params.toString()
  return {
    provider: "Viator",
    url: `https://www.viator.com/${slug}-tours/${qs ? `?${qs}` : ""}`,
    label: `Tours in ${destination}`,
    icon: "\u{1F39F}\uFE0F",
    commission: "8%",
  }
}

// GetYourGuide for activities
export async function getGetYourGuideLink(
  activityName: string,
  destination: string
): Promise<AffiliateLink> {
  const partnerId = await getConfig("affiliate.getyourguide.id", "")
  const params = new URLSearchParams({
    q: `${activityName} ${destination}`,
    ...(partnerId && { partner_id: partnerId, utm_medium: "online_publisher" }),
  })
  return {
    provider: "GetYourGuide",
    url: `https://www.getyourguide.com/s/?${params}`,
    label: "Book on GetYourGuide",
    icon: "\u{1F5FA}\uFE0F",
    commission: "8%",
  }
}

// Travel insurance
export async function getTravelInsuranceLink(
  destination?: string
): Promise<AffiliateLink> {
  const refId = await getConfig("affiliate.safetywing.id", "")
  const baseUrl = "https://safetywing.com/nomad-insurance"
  const params = new URLSearchParams({
    ...(refId && { referenceID: refId }),
    ...(destination && { destination }),
  })
  return {
    provider: "SafetyWing",
    url: `${baseUrl}?${params}`,
    label: "Get travel insurance",
    icon: "\u{1F6E1}\uFE0F",
    commission: "10%",
  }
}

// Amazon packing suggestions
export async function getAmazonPackingLink(
  destination: string
): Promise<AffiliateLink> {
  const tag = await getConfig("affiliate.amazon.tag", "")
  const params = new URLSearchParams({
    k: `travel essentials ${destination}`,
    ...(tag && { tag }),
  })
  return {
    provider: "Amazon",
    url: `https://www.amazon.com/s?${params}`,
    label: "Shop travel essentials",
    icon: "\u{1F392}",
    commission: "up to 4%",
  }
}

// Parking near a hotel/venue (SpotHero by default)
export interface ParkingLinkParams {
  location: string
  lat?: number | null
  lng?: number | null
  startDate?: string
  endDate?: string
  startTime?: string
  endTime?: string
  provider?: "spothero"
}

// SpotHero search deep link. Falls back to a plain (un-affiliated) search URL
// when no affiliate ID is configured, so the link is never broken or empty.
async function buildSpotHeroParkingLink(
  params: ParkingLinkParams
): Promise<AffiliateLink> {
  const affiliateId = await getConfig("affiliate.spothero.id", "")

  const hasCoords =
    typeof params.lat === "number" &&
    Number.isFinite(params.lat) &&
    typeof params.lng === "number" &&
    Number.isFinite(params.lng)

  // SpotHero accepts local ISO-ish timestamps: YYYY-MM-DDTHH:MM
  const starts = params.startDate
    ? `${params.startDate}T${params.startTime ?? "15:00"}`
    : ""
  const ends =
    params.startDate && params.endDate
      ? `${params.endDate}T${params.endTime ?? "11:00"}`
      : ""

  const searchParams = new URLSearchParams({
    ...(hasCoords && {
      latitude: String(params.lat),
      longitude: String(params.lng),
    }),
    q: params.location,
    ...(starts && { starts }),
    ...(ends && { ends }),
    ...(affiliateId && {
      affiliate: affiliateId,
      utm_source: "journeyperfect",
      utm_medium: "affiliate",
    }),
  })

  return {
    provider: "SpotHero",
    url: `https://spothero.com/search?${searchParams}`,
    label: "Find parking",
    icon: "\u{1F17F}️",
    commission: "10%",
  }
}

export async function buildParkingLink(
  params: ParkingLinkParams
): Promise<AffiliateLink> {
  // Provider is configurable so an admin can swap providers without a code change
  const provider =
    params.provider ?? (await getConfig("affiliate.parking.provider", "spothero"))

  switch (provider) {
    case "spothero":
    default:
      return buildSpotHeroParkingLink(params)
  }
}

// Get all relevant affiliate links for a trip context
export async function getTripAffiliateLinks(context: {
  destination: string
  startDate?: string
  endDate?: string
}): Promise<AffiliateLink[]> {
  const links = await Promise.all([
    getHotelBookingLink(context.destination, context.startDate, context.endDate),
    getRentalCarLink(context.destination, context.startDate, context.endDate),
    getTravelInsuranceLink(context.destination),
    getAmazonPackingLink(context.destination),
  ])
  return links
}

// Get activity-specific affiliate links
export async function getActivityAffiliateLinks(
  activityName: string,
  destination: string
): Promise<AffiliateLink[]> {
  const links = await Promise.all([
    getActivityBookingLink(activityName, destination),
    getGetYourGuideLink(activityName, destination),
  ])
  return links
}
