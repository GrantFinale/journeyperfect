export interface ParsedFlight {
  airline?: string
  flightNumber?: string
  departureAirport?: string
  departureCity?: string
  departureTime?: Date
  departureTimezone?: string
  arrivalAirport?: string
  arrivalCity?: string
  arrivalTime?: Date
  arrivalTimezone?: string
  confirmationNumber?: string
  cabin?: string
  confidence: number // 0-1
}

export interface ParseResult {
  flights: ParsedFlight[]
  rawText: string
  needsConfirmation: boolean
  parseNotes: string[]
}

// Airport timezone map (100+ major airports)
const AIRPORT_TIMEZONES: Record<string, string> = {
  JFK: "America/New_York", LGA: "America/New_York", EWR: "America/New_York",
  BOS: "America/New_York", MIA: "America/New_York", FLL: "America/New_York",
  ATL: "America/New_York", CLT: "America/New_York", PHL: "America/New_York",
  DCA: "America/New_York", IAD: "America/New_York", BWI: "America/New_York",
  ORD: "America/Chicago", MDW: "America/Chicago", DFW: "America/Chicago",
  IAH: "America/Chicago", MSY: "America/Chicago", STL: "America/Chicago",
  MCI: "America/Chicago", MSP: "America/Chicago", MKE: "America/Chicago",
  DEN: "America/Denver", SLC: "America/Denver", ABQ: "America/Denver",
  LAX: "America/Los_Angeles", SFO: "America/Los_Angeles", SEA: "America/Los_Angeles",
  LAS: "America/Los_Angeles", PHX: "America/Phoenix", PDX: "America/Los_Angeles",
  SAN: "America/Los_Angeles", SJC: "America/Los_Angeles", SMF: "America/Los_Angeles",
  HNL: "Pacific/Honolulu", ANC: "America/Anchorage",
  YYZ: "America/Toronto", YVR: "America/Vancouver", YUL: "America/Montreal",
  LHR: "Europe/London", LGW: "Europe/London", STN: "Europe/London",
  CDG: "Europe/Paris", ORY: "Europe/Paris", AMS: "Europe/Amsterdam",
  FRA: "Europe/Berlin", MUC: "Europe/Berlin", BER: "Europe/Berlin",
  MAD: "Europe/Madrid", BCN: "Europe/Madrid", FCO: "Europe/Rome",
  MXP: "Europe/Rome", ZRH: "Europe/Zurich", VIE: "Europe/Vienna",
  BRU: "Europe/Brussels", CPH: "Europe/Copenhagen", ARN: "Europe/Stockholm",
  OSL: "Europe/Oslo", HEL: "Europe/Helsinki", DUB: "Europe/Dublin",
  LIS: "Europe/Lisbon", ATH: "Europe/Athens", IST: "Europe/Istanbul",
  DXB: "Asia/Dubai", DOH: "Asia/Qatar", AUH: "Asia/Dubai",
  SIN: "Asia/Singapore", KUL: "Asia/Kuala_Lumpur", BKK: "Asia/Bangkok",
  HKG: "Asia/Hong_Kong", NRT: "Asia/Tokyo", HND: "Asia/Tokyo",
  ICN: "Asia/Seoul", PVG: "Asia/Shanghai", PEK: "Asia/Shanghai",
  SYD: "Australia/Sydney", MEL: "Australia/Melbourne", BNE: "Australia/Brisbane",
  GRU: "America/Sao_Paulo", EZE: "America/Argentina/Buenos_Aires",
  MEX: "America/Mexico_City", BOG: "America/Bogota", LIM: "America/Lima",
  JNB: "Africa/Johannesburg", CAI: "Africa/Cairo", NBO: "Africa/Nairobi",
  DEL: "Asia/Kolkata", BOM: "Asia/Kolkata", BLR: "Asia/Kolkata",
  ORF: "America/New_York", RDU: "America/New_York", CHS: "America/New_York",
  JAX: "America/New_York", TPA: "America/New_York", MCO: "America/New_York",
  PBI: "America/New_York", BUF: "America/New_York", PIT: "America/New_York",
  CLE: "America/New_York", CMH: "America/New_York", DTW: "America/Detroit",
}

const AIRLINE_CODES: Record<string, string> = {
  AA: "American Airlines", DL: "Delta Air Lines", UA: "United Airlines",
  WN: "Southwest Airlines", B6: "JetBlue Airways", AS: "Alaska Airlines",
  F9: "Frontier Airlines", NK: "Spirit Airlines", G4: "Allegiant Air",
  HA: "Hawaiian Airlines", SY: "Sun Country Airlines",
  BA: "British Airways", VS: "Virgin Atlantic", LH: "Lufthansa",
  AF: "Air France", KL: "KLM", IB: "Iberia", AZ: "ITA Airways",
  SK: "Scandinavian Airlines", LX: "Swiss International",
  OS: "Austrian Airlines", SN: "Brussels Airlines",
  EK: "Emirates", QR: "Qatar Airways", EY: "Etihad Airways",
  SQ: "Singapore Airlines", CX: "Cathay Pacific", TG: "Thai Airways",
  MH: "Malaysia Airlines", GA: "Garuda Indonesia",
  JL: "Japan Airlines", NH: "All Nippon Airways",
  KE: "Korean Air", OZ: "Asiana Airlines",
  CA: "Air China", MU: "China Eastern", CZ: "China Southern",
  QF: "Qantas", NZ: "Air New Zealand", AC: "Air Canada",
  AM: "Aeromexico", LA: "LATAM Airlines", AV: "Avianca",
}

export function parseFlightText(text: string): ParseResult {
  const notes: string[] = []
  const flights: ParsedFlight[] = []

  if (!text || text.trim().length < 10) {
    return { flights: [], rawText: text, needsConfirmation: false, parseNotes: ["No text provided"] }
  }

  // Split by common segment separators
  const segments = splitIntoSegments(text)

  for (const segment of segments) {
    const flight = parseSegment(segment, notes)
    if (flight) flights.push(flight)
  }

  // Try whole-text parse if no segments found
  if (flights.length === 0) {
    const flight = parseSegment(text, notes)
    if (flight) flights.push(flight)
  }

  const needsConfirmation = flights.some(f => f.confidence < 0.7) || flights.length === 0

  return { flights, rawText: text, needsConfirmation, parseNotes: notes }
}

function splitIntoSegments(text: string): string[] {
  // Split on common itinerary segment dividers
  const dividers = [
    /(?=\n(?:Flight|Segment|Leg)\s*\d)/gi,
    /(?=\n[A-Z]{2}\d{2,4}\s)/g,
    /─{3,}|={3,}|-{3,}/g,
  ]
  for (const divider of dividers) {
    const parts = text.split(divider).filter(p => p.trim().length > 20)
    if (parts.length > 1) return parts
  }
  return [text]
}

function parseSegment(text: string, notes: string[]): ParsedFlight | null {
  const flight: Partial<ParsedFlight> & { confidence: number } = { confidence: 0 }
  let score = 0

  // Extract flight number (e.g. AA 123, DL1234, United 456)
  const flightNumMatch = text.match(
    /\b([A-Z]{2})\s*(\d{1,4})\b/
  ) || text.match(/\bFlight\s+(\w+)\s*(\d+)/i)
  if (flightNumMatch) {
    flight.flightNumber = flightNumMatch[1] + flightNumMatch[2]
    const code = flightNumMatch[1].toUpperCase()
    if (AIRLINE_CODES[code]) {
      flight.airline = AIRLINE_CODES[code]
      score += 0.2
    }
    score += 0.2
  }

  // Extract airport codes (3 uppercase letters)
  const airports = text.match(/\b([A-Z]{3})\b/g) || []
  const knownAirports = airports.filter(a => AIRPORT_TIMEZONES[a])
  if (knownAirports.length >= 2) {
    flight.departureAirport = knownAirports[0]
    flight.arrivalAirport = knownAirports[1]
    flight.departureTimezone = AIRPORT_TIMEZONES[knownAirports[0]] || "UTC"
    flight.arrivalTimezone = AIRPORT_TIMEZONES[knownAirports[1]] || "UTC"
    score += 0.3
  } else if (knownAirports.length === 1) {
    flight.departureAirport = knownAirports[0]
    flight.departureTimezone = AIRPORT_TIMEZONES[knownAirports[0]] || "UTC"
    score += 0.1
    notes.push(`Only one airport code detected (${knownAirports[0]})`)
  }

  // Extract dates and times
  const times = parseDateTimes(text)
  if (times.length >= 2) {
    flight.departureTime = times[0]
    flight.arrivalTime = times[1]
    score += 0.3
  } else if (times.length === 1) {
    flight.departureTime = times[0]
    score += 0.1
    notes.push("Only one date/time detected")
  }

  // Extract confirmation number
  const confMatch = text.match(
    /(?:confirmation|booking|record locator|pnr)[:\s#]*([A-Z0-9]{5,8})/i
  )
  if (confMatch) {
    flight.confirmationNumber = confMatch[1].toUpperCase()
    score += 0.1
  }

  // Extract cabin class
  const cabinMatch = text.match(/\b(first class|business|premium economy|economy|coach)\b/i)
  if (cabinMatch) {
    flight.cabin = cabinMatch[1]
  }

  flight.confidence = Math.min(score, 1)

  if (score < 0.2) {
    notes.push("Segment had too little recognizable flight data")
    return null
  }

  return flight as ParsedFlight
}

function parseDateTimes(text: string): Date[] {
  const dates: Date[] = []

  // Patterns: "Mar 15, 2025 10:35 AM", "15 March 2025 10:35", "2025-03-15 10:35", "03/15/2025 10:35"
  const patterns = [
    /(\w{3,9})\s+(\d{1,2}),?\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/gi,
    /(\d{1,2})\s+(\w{3,9})\s+(\d{4})\s+(\d{1,2}):(\d{2})/gi,
    /(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/g,
    /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/gi,
    // Time only (assume same date context)
    /\b(\d{1,2}):(\d{2})\s*(AM|PM)\b/gi,
  ]

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(text)) !== null) {
      try {
        const dateStr = match[0]
        const d = new Date(dateStr)
        if (!isNaN(d.getTime())) {
          dates.push(d)
        }
      } catch {
        // skip unparseable
      }
    }
  }

  return dates.slice(0, 2)
}
