/**
 * Booking handoff deep links. PURE: no Prisma, no config, no network, so client
 * components and Vitest can import it directly. See
 * docs/plans/flights-search-tracking-and-booking.md §4.2.
 *
 * Every link here is a *search* on the destination site, never a checkout.
 * Prices in JourneyPerfect are indicative; the user confirms on the seller.
 */
import type { FlightQuery } from "./types"

function code(value: string): string {
  return value.trim().toUpperCase()
}

/** "YYYY-MM-DD" -> "DDMM" (Aviasales path format). */
function ddmm(isoDate: string): string {
  const [, m, d] = isoDate.trim().split("-")
  return `${d ?? ""}${m ?? ""}`
}

/**
 * Google Flights, simple `?q=` form. Stable and what maintained code uses; the
 * `?tfs=` protobuf form carries cabin/stops/passengers but is undocumented.
 *
 * https://www.google.com/travel/flights?q=Flights%20to%20JFK%20from%20LAX%20on%202026-12-01&curr=USD&hl=en
 */
export function googleFlightsUrl(q: FlightQuery): string {
  let text = `Flights to ${code(q.destination)} from ${code(q.origin)} on ${q.departDate.trim()}`
  if (q.returnDate) text += ` through ${q.returnDate.trim()}`
  const curr = code(q.currency) || "USD"
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(text)}&curr=${encodeURIComponent(curr)}&hl=en`
}

/**
 * Aviasales (Travelpayouts) search URL. Path format is
 * `{ORIGIN}{DDMM}{DEST}[{DDMM return}]{adults}[{children}]`, e.g. `LAX0112JFK08122`
 * for 2 adults. The affiliate `marker` is appended when present so the click
 * is attributed; without one the link still works.
 */
export function aviasalesUrl(q: FlightQuery, marker?: string | null): string {
  const pax = `${Math.max(1, Math.floor(q.adults || 1))}${q.children > 0 ? Math.floor(q.children) : ""}`
  const path = `${code(q.origin)}${ddmm(q.departDate)}${code(q.destination)}${q.returnDate ? ddmm(q.returnDate) : ""}${pax}`
  const params = new URLSearchParams()
  if (marker && marker.trim()) params.set("marker", marker.trim())
  const qs = params.toString()
  return `https://www.aviasales.com/search/${path}${qs ? `?${qs}` : ""}`
}

interface AirlineLinkSpec {
  name: string
  build: (q: FlightQuery, o: string, d: string, roundTrip: boolean) => string
}

/** "YYYY-MM-DD" -> "MM/DD/YYYY" for carriers that want US-style dates. */
function usDate(isoDate: string): string {
  const [y, m, d] = isoDate.trim().split("-")
  return `${m}/${d}/${y}`
}

/**
 * Best-effort direct-to-airline search links for the major US carriers. These
 * URL schemes are observed, not documented, and airlines change them without
 * notice; the worst case is the airline's booking page with the search
 * prefilled incorrectly, never a broken page.
 */
const AIRLINE_LINKS: Record<string, AirlineLinkSpec> = {
  AA: {
    name: "American Airlines",
    build: (q, o, d, rt) =>
      `https://www.aa.com/booking/find-flights?tripType=${rt ? "roundTrip" : "oneWay"}&from=${o}&to=${d}&departDate=${q.departDate}${rt ? `&returnDate=${q.returnDate}` : ""}&adult=${q.adults}${q.children ? `&child=${q.children}` : ""}`,
  },
  DL: {
    name: "Delta Air Lines",
    build: (q, o, d, rt) =>
      `https://www.delta.com/flight-search/search?action=findFlights&tripType=${rt ? "ROUND_TRIP" : "ONE_WAY"}&originCity=${o}&destinationCity=${d}&departureDate=${usDate(q.departDate)}${rt ? `&returnDate=${usDate(q.returnDate!)}` : ""}&paxCount=${q.adults + q.children}`,
  },
  UA: {
    name: "United Airlines",
    build: (q, o, d, rt) =>
      `https://www.united.com/en/us/fsr/choose-flights?f=${o}&t=${d}&d=${q.departDate}${rt ? `&r=${q.returnDate}` : ""}&tt=${rt ? 1 : 2}&px=${q.adults + q.children}&sc=7`,
  },
  WN: {
    name: "Southwest Airlines",
    build: (q, o, d, rt) =>
      `https://www.southwest.com/air/booking/select.html?originationAirportCode=${o}&destinationAirportCode=${d}&departureDate=${q.departDate}${rt ? `&returnDate=${q.returnDate}` : ""}&tripType=${rt ? "roundtrip" : "oneway"}&adultPassengersCount=${q.adults}`,
  },
  B6: {
    name: "JetBlue",
    build: (q, o, d, rt) =>
      `https://www.jetblue.com/booking/flights?from=${o}&to=${d}&depart=${q.departDate}${rt ? `&return=${q.returnDate}` : ""}&isMultiCity=false&noOfRoute=1&adults=${q.adults}&children=${q.children}&infants=0&sharedMarket=false&roundTripFaresFlag=false&usePoints=false`,
  },
  AS: {
    name: "Alaska Airlines",
    build: (q, o, d, rt) =>
      `https://www.alaskaair.com/search/results?O=${o}&D=${d}&OD=${q.departDate}${rt ? `&RD=${q.returnDate}` : ""}&A=${q.adults}&C=${q.children}&RT=${rt}`,
  },
  NK: {
    name: "Spirit Airlines",
    build: (q, o, d, rt) =>
      `https://www.spirit.com/book/flights?tripType=${rt ? "roundTrip" : "oneWay"}&from=${o}&to=${d}&departDate=${q.departDate}${rt ? `&returnDate=${q.returnDate}` : ""}&ADT=${q.adults}&CHD=${q.children}`,
  },
  F9: {
    name: "Frontier Airlines",
    build: (q, o, d, rt) =>
      `https://booking.flyfrontier.com/Flight/InternalSelect?o1=${o}&d1=${d}&dd1=${q.departDate}${rt ? `&dd2=${q.returnDate}` : ""}&ADT=${q.adults}${q.children ? `&CHD=${q.children}` : ""}&mon=true`,
  },
  G4: {
    name: "Allegiant Air",
    build: (q, o, d, rt) =>
      `https://www.allegiantair.com/booking/search?origin=${o}&destination=${d}&departureDate=${q.departDate}${rt ? `&returnDate=${q.returnDate}` : ""}&adults=${q.adults}&children=${q.children}`,
  },
  HA: {
    name: "Hawaiian Airlines",
    build: (q, o, d, rt) =>
      `https://www.hawaiianairlines.com/book/flights?from=${o}&to=${d}&departure=${q.departDate}${rt ? `&return=${q.returnDate}` : ""}&adults=${q.adults}&children=${q.children}`,
  },
  SY: {
    name: "Sun Country Airlines",
    build: (q, o, d, rt) =>
      `https://www.suncountry.com/booking/search?origin=${o}&destination=${d}&departureDate=${q.departDate}${rt ? `&returnDate=${q.returnDate}` : ""}&adults=${q.adults}&children=${q.children}`,
  },
  MX: {
    name: "Breeze Airways",
    build: (q, o, d, rt) =>
      `https://www.flybreeze.com/booking/search?from=${o}&to=${d}&depart=${q.departDate}${rt ? `&return=${q.returnDate}` : ""}&adults=${q.adults}&children=${q.children}`,
  },
  XP: {
    name: "Avelo Airlines",
    build: (q, o, d, rt) =>
      `https://www.aveloair.com/booking/search?origin=${o}&destination=${d}&departDate=${q.departDate}${rt ? `&returnDate=${q.returnDate}` : ""}&adults=${q.adults}&children=${q.children}`,
  },
}

/** IATA carrier codes with a best-effort direct search link. */
export const AIRLINE_LINK_CARRIERS: readonly string[] = Object.keys(AIRLINE_LINKS)

/** Marketing name for a carrier code we know, else null. */
export function airlineName(carrier: string): string | null {
  return AIRLINE_LINKS[code(carrier)]?.name ?? null
}

/**
 * Direct search on the airline's own site for one of a dozen US carriers.
 * Returns null for any carrier not in the table so callers can fall back to
 * Google Flights or Aviasales instead of guessing.
 */
export function airlineSearchUrl(carrier: string, q: FlightQuery): string | null {
  const spec = AIRLINE_LINKS[code(carrier)]
  if (!spec) return null
  const roundTrip = Boolean(q.returnDate)
  return spec.build(q, code(q.origin), code(q.destination), roundTrip)
}
