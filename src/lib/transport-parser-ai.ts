import { getConfig } from "./config"
import { logAIUsage } from "./ai-usage"

export type TransportModeValue = "FERRY" | "TRAIN" | "BUS"

export interface ParsedTransportSegment {
  mode: TransportModeValue
  operator: string
  serviceNumber?: string | null
  departureLocation: string
  departureTerminal?: string | null
  departureAddress?: string | null
  departureLat?: number | null
  departureLng?: number | null
  departureTime: string | null
  departureTimezone?: string
  arrivalLocation?: string | null
  arrivalTerminal?: string | null
  arrivalAddress?: string | null
  arrivalLat?: number | null
  arrivalLng?: number | null
  arrivalTime?: string | null
  arrivalTimezone?: string
  confirmationNumber?: string | null
  bookingLink?: string | null
  seatInfo?: string | null
  vehicleOnBoard?: boolean
  passengerCount?: number | null
  price?: number | null
  priceCurrency?: string | null
  checkInMinsBefore?: number | null
  notes?: string | null
  confidence: number
}

export interface TransportParseResult {
  segments: ParsedTransportSegment[]
  confidence: number
  parsedBy: "ai"
}

const VALID_MODES: TransportModeValue[] = ["FERRY", "TRAIN", "BUS"]

export async function parseTransportTextWithAI(
  text: string,
  userId?: string
): Promise<TransportParseResult | null> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.error("[transport-parser-ai] OPENROUTER_API_KEY not set")
    return null
  }

  const model = await getConfig("ai.transportParserModel", "anthropic/claude-haiku-4.5")

  const prompt = `You are parsing a ground/water transport booking confirmation — a FERRY, TRAIN or BUS reservation. These emails contain marketing content, terms and conditions, and promotions — IGNORE all of that. Focus ONLY on the booking details.

CRITICAL: Extract EVERY leg as a separate entry. A round trip is at least 2 legs (outbound and return). A rail journey with a change of trains is one entry per train.

Return a JSON object:
{
  "segments": [
    {
      "mode": "FERRY",
      "operator": "Lake Express",
      "serviceNumber": null,
      "departureLocation": "Muskegon, MI",
      "departureTerminal": "Lake Express Muskegon Terminal",
      "departureAddress": "1918 Lakeshore Dr, Muskegon, MI 49441",
      "departureTime": "2026-08-19T20:45:00Z",
      "departureTimezone": "America/Detroit",
      "arrivalLocation": "Milwaukee, WI",
      "arrivalTerminal": "Lake Express Milwaukee Terminal",
      "arrivalTime": null,
      "arrivalTimezone": "America/Chicago",
      "confirmationNumber": "4424330",
      "seatInfo": "Premier Cabin",
      "vehicleOnBoard": true,
      "passengerCount": 2,
      "price": 189.00,
      "priceCurrency": "USD",
      "notes": null
    }
  ],
  "confirmationNumber": "4424330"
}

Rules:
- mode is one of exactly: FERRY, TRAIN, BUS. Infer it from the operator when the email doesn't say:
  - FERRY: Lake Express, Steamship Authority, BC Ferries, Washington State Ferries, Alaska Marine Highway, Brittany Ferries, DFDS, Stena Line, Interislander, anything mentioning a sailing/vessel/car deck
  - TRAIN: Amtrak, Via Rail, Eurostar, SNCF, TGV, Trenitalia, Renfe, Deutsche Bahn / DB, ÖBB, Brightline, Caltrain
  - BUS: Greyhound, FlixBus, Megabus, Peter Pan, National Express, Coach USA
- CRITICAL: All times MUST be in UTC (with a Z suffix). Convert the printed local time to UTC using the timezone of the DEPARTURE city (and the ARRIVAL city for arrivalTime). Example: 4:45 PM in Muskegon, Michigan (Eastern, UTC-4 in August) = 2026-08-19T20:45:00Z
- CRITICAL: departureTimezone and arrivalTimezone are IANA names resolved from the named cities, NOT from the operator's headquarters. Many crossings change zone. Examples: Muskegon MI -> America/Detroit; Milwaukee WI -> America/Chicago; Chicago IL -> America/Chicago; New York NY -> America/New_York; Seattle WA -> America/Los_Angeles; London UK -> Europe/London; Paris FR -> Europe/Paris. If the city is genuinely unknown, use "UTC".
- departureLocation / arrivalLocation: the city as a traveller would say it, with the state or country — "Muskegon, MI", "Milwaukee, WI", "Paris, France". A line like "Muskegon to Milwaukee" means departureLocation "Muskegon, MI" and arrivalLocation "Milwaukee, WI".
- departureTerminal / arrivalTerminal: the named dock, station or depot if given (e.g. "Lake Express Muskegon Terminal", "Chicago Union Station", "Gare du Nord")
- arrivalTime: ONLY if the email actually states it. If the email does not state an arrival time you MAY estimate one from the operator's typical crossing/journey duration (Lake Express Muskegon-Milwaukee is about 2h30m), but if you estimate it you MUST say so in notes (e.g. "Arrival time estimated from typical 2h30m crossing") — never present an estimate as if it were printed in the email. If you cannot even estimate, use null. Do NOT invent an arrival time with no basis.
- vehicleOnBoard: true if the booking includes a car/vehicle/motorcycle/RV, a vehicle deck or car deck reservation, or a "with vehicle" fare. Otherwise false.
- passengerCount: number of travellers on the booking
- seatInfo: cabin, class, coach + seat number, or deck (e.g. "Premier Cabin", "Business Class", "Car 7 Seat 12A")
- checkInMinsBefore: only if the email states a boarding/check-in deadline (e.g. "arrive 60 minutes before sailing" -> 60). Otherwise null.
- confirmationNumber: the reservation / booking / record locator number
- price: total charged for this leg; priceCurrency is a 3-letter code (USD, EUR, GBP)
- Omit or null any field you cannot determine — do NOT guess
- Return ONLY valid JSON, no other text

Text to parse:
${text}`

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) {
      const err = await response.text().catch(() => "unknown")
      console.error(`[transport-parser-ai] API error: ${response.status}`, err)
      return null
    }

    const data = await response.json()

    // Log AI usage
    if (userId && data.usage) {
      logAIUsage({
        userId,
        feature: "transport_parser",
        model,
        promptTokens: data.usage.prompt_tokens ?? 0,
        completionTokens: data.usage.completion_tokens ?? 0,
      })
    }

    const content = data.choices?.[0]?.message?.content
    if (!content) {
      console.error("[transport-parser-ai] No content in response")
      return null
    }

    let jsonStr = content.trim()
    const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (match) jsonStr = match[1].trim()

    const parsed = JSON.parse(jsonStr)
    if (!parsed.segments || !Array.isArray(parsed.segments)) {
      console.error("[transport-parser-ai] Response missing segments array", jsonStr.slice(0, 300))
      return null
    }

    const topLevelConfirmation = parsed.confirmationNumber ? String(parsed.confirmationNumber) : null

    const segments: ParsedTransportSegment[] = parsed.segments
      .map((s: Record<string, unknown>) => {
        const rawMode = String(s.mode ?? "").toUpperCase() as TransportModeValue
        const seg: ParsedTransportSegment = {
          mode: VALID_MODES.includes(rawMode) ? rawMode : "FERRY",
          operator: s.operator ? String(s.operator) : "",
          departureLocation: s.departureLocation ? String(s.departureLocation) : "",
          departureTime: null,
          confidence: 0.4,
        }

        if (VALID_MODES.includes(rawMode)) seg.confidence += 0.1
        if (seg.operator) seg.confidence += 0.1
        if (seg.departureLocation) seg.confidence += 0.1

        if (s.serviceNumber) seg.serviceNumber = String(s.serviceNumber)
        if (s.departureTerminal) seg.departureTerminal = String(s.departureTerminal)
        if (s.departureAddress) seg.departureAddress = String(s.departureAddress)
        if (s.departureLat != null && Number.isFinite(Number(s.departureLat))) seg.departureLat = Number(s.departureLat)
        if (s.departureLng != null && Number.isFinite(Number(s.departureLng))) seg.departureLng = Number(s.departureLng)

        if (s.departureTime) {
          const d = new Date(String(s.departureTime))
          if (!Number.isNaN(d.getTime())) {
            seg.departureTime = d.toISOString()
            seg.confidence += 0.15
          }
        }
        if (s.departureTimezone) {
          seg.departureTimezone = String(s.departureTimezone)
          if (seg.departureTimezone !== "UTC") seg.confidence += 0.05
        }

        if (s.arrivalLocation) seg.arrivalLocation = String(s.arrivalLocation)
        if (s.arrivalTerminal) seg.arrivalTerminal = String(s.arrivalTerminal)
        if (s.arrivalAddress) seg.arrivalAddress = String(s.arrivalAddress)
        if (s.arrivalLat != null && Number.isFinite(Number(s.arrivalLat))) seg.arrivalLat = Number(s.arrivalLat)
        if (s.arrivalLng != null && Number.isFinite(Number(s.arrivalLng))) seg.arrivalLng = Number(s.arrivalLng)
        if (s.arrivalTime) {
          const a = new Date(String(s.arrivalTime))
          if (!Number.isNaN(a.getTime())) seg.arrivalTime = a.toISOString()
        }
        if (s.arrivalTimezone) seg.arrivalTimezone = String(s.arrivalTimezone)

        const confirmation = s.confirmationNumber ? String(s.confirmationNumber) : topLevelConfirmation
        if (confirmation) {
          seg.confirmationNumber = confirmation
          seg.confidence += 0.1
        }

        if (s.bookingLink) seg.bookingLink = String(s.bookingLink)
        if (s.seatInfo) seg.seatInfo = String(s.seatInfo)
        seg.vehicleOnBoard = s.vehicleOnBoard === true
        if (s.passengerCount != null && Number.isFinite(Number(s.passengerCount))) {
          seg.passengerCount = Number(s.passengerCount)
        }
        if (s.price != null && Number.isFinite(Number(s.price))) seg.price = Number(s.price)
        if (s.priceCurrency) seg.priceCurrency = String(s.priceCurrency)
        if (s.checkInMinsBefore != null && Number.isFinite(Number(s.checkInMinsBefore))) {
          seg.checkInMinsBefore = Number(s.checkInMinsBefore)
        }
        if (s.notes) seg.notes = String(s.notes)

        // An arrival time the model admits it estimated is not a fact — flag it.
        if (seg.arrivalTime && seg.notes && /estimat/i.test(seg.notes)) {
          seg.confidence -= 0.15
        }

        seg.confidence = Math.max(0, Math.min(seg.confidence, 0.95))
        return seg
      })
      // A segment with no operator and no departure city isn't a booking
      .filter((s: ParsedTransportSegment) => Boolean(s.operator || s.departureLocation))

    const avgConfidence =
      segments.length > 0 ? segments.reduce((sum, s) => sum + s.confidence, 0) / segments.length : 0

    return { segments, confidence: avgConfidence, parsedBy: "ai" }
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      console.error("[transport-parser-ai] OpenRouter request timed out after 30s")
    } else {
      console.error("[transport-parser-ai] Failed:", err)
    }
    return null
  }
}
