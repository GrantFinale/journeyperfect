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

// RentalCars.com affiliate
export async function getRentalCarLink(
  pickupLocation: string,
  pickupDate?: string,
  dropoffDate?: string
): Promise<AffiliateLink> {
  const affiliateId = await getConfig("affiliate.rentalcars.id", "")
  const baseUrl = "https://www.rentalcars.com/search-results"
  const params = new URLSearchParams({
    location: pickupLocation,
    ...(pickupDate && {
      puDay: pickupDate.split("-")[2],
      puMonth: pickupDate.split("-")[1],
      puYear: pickupDate.split("-")[0],
    }),
    ...(dropoffDate && {
      doDay: dropoffDate.split("-")[2],
      doMonth: dropoffDate.split("-")[1],
      doYear: dropoffDate.split("-")[0],
    }),
    ...(affiliateId && { affiliateCode: affiliateId }),
  })
  return {
    provider: "RentalCars.com",
    url: `${baseUrl}?${params}`,
    label: "Rent a car",
    icon: "\u{1F697}",
    commission: "up to 8%",
  }
}

// Viator for activities
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
