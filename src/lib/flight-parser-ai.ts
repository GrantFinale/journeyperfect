import type { ParseResult, ParsedFlight } from "./flight-parser"
import { getConfig } from "./config"

export async function parseFlightTextWithAI(text: string): Promise<ParseResult | null> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.error("[flight-parser-ai] OPENROUTER_API_KEY is not set, skipping AI parser")
    return null
  }

  const model = await getConfig("ai.flight_parser.model", "anthropic/claude-haiku-4.5")

  const prompt = `You are parsing an airline confirmation email or flight itinerary. These emails often contain marketing content, banners, and disclaimers — IGNORE all of that. Focus ONLY on the flight booking details.

CRITICAL: Extract EVERY flight segment as a separate entry. A round trip has at least 2 flights. A trip with connections may have 4, 6, or even 8+ segments. Each takeoff-to-landing is ONE segment. Do NOT combine or skip any.

For example, a round trip NYC→LAX with a connection in Dallas each way = 4 flights:
1. JFK→DFW (outbound leg 1)
2. DFW→LAX (outbound leg 2)
3. LAX→DFW (return leg 1)
4. DFW→JFK (return leg 2)

Return a JSON object:
{
  "flights": [
    {
      "airline": "American Airlines",
      "flightNumber": "AA1234",
      "departureAirport": "JFK",
      "departureCity": "New York",
      "departureTime": "2025-03-15T10:30:00",
      "departureTimezone": "America/New_York",
      "arrivalAirport": "DFW",
      "arrivalCity": "Dallas",
      "arrivalTime": "2025-03-15T13:45:00",
      "arrivalTimezone": "America/Chicago",
      "confirmationNumber": "ABC123",
      "cabin": "Economy",
      "passengers": ["John Doe"]
    },
    {
      "airline": "American Airlines",
      "flightNumber": "AA5678",
      "departureAirport": "DFW",
      "departureCity": "Dallas",
      "departureTime": "2025-03-15T15:00:00",
      "departureTimezone": "America/Chicago",
      "arrivalAirport": "LAX",
      "arrivalCity": "Los Angeles",
      "arrivalTime": "2025-03-15T16:30:00",
      "arrivalTimezone": "America/Los_Angeles",
      "confirmationNumber": "ABC123",
      "cabin": "Economy",
      "passengers": ["John Doe"]
    }
  ],
  "confirmationNumber": "ABC123"
}

Rules:
- IATA 3-letter airport codes (JFK, LAX, LHR)
- IANA timezone names (America/New_York, not EST)
- ISO 8601 datetime format
- Flight number includes 2-letter airline code (AA123, DL456)
- EVERY segment is a separate entry — outbound legs, connections, return legs, ALL of them
- If the email shows "Flight 1", "Flight 2" or "Depart" / "Return" sections, extract each one
- Omit fields that cannot be determined
- Confirmation/booking reference is usually a 5-8 character alphanumeric code
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
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "unknown")
      console.error(`[flight-parser-ai] OpenRouter API error: ${response.status} ${response.statusText}`, errorBody)
      return null
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content
    if (!content) {
      console.error("[flight-parser-ai] No content in OpenRouter response", JSON.stringify(data).slice(0, 500))
      return null
    }

    // Extract JSON from the response (handle markdown code blocks)
    let jsonStr = content.trim()
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim()
    }

    const parsed = JSON.parse(jsonStr)

    if (!parsed.flights || !Array.isArray(parsed.flights)) {
      console.error("[flight-parser-ai] Response missing flights array", jsonStr.slice(0, 300))
      return null
    }

    const flights: ParsedFlight[] = parsed.flights.map((f: Record<string, unknown>) => {
      const flight: ParsedFlight = {
        confidence: 0.5,
      }

      if (f.airline) flight.airline = String(f.airline)
      if (f.flightNumber) {
        flight.flightNumber = String(f.flightNumber)
        flight.confidence += 0.1
      }
      if (f.departureAirport) {
        flight.departureAirport = String(f.departureAirport)
        flight.confidence += 0.1
      }
      if (f.departureCity) flight.departureCity = String(f.departureCity)
      if (f.departureTime) {
        flight.departureTime = new Date(String(f.departureTime))
        flight.confidence += 0.1
      }
      if (f.departureTimezone) flight.departureTimezone = String(f.departureTimezone)
      if (f.arrivalAirport) {
        flight.arrivalAirport = String(f.arrivalAirport)
        flight.confidence += 0.1
      }
      if (f.arrivalCity) flight.arrivalCity = String(f.arrivalCity)
      if (f.arrivalTime) flight.arrivalTime = new Date(String(f.arrivalTime))
      if (f.arrivalTimezone) flight.arrivalTimezone = String(f.arrivalTimezone)
      if (f.confirmationNumber) flight.confirmationNumber = String(f.confirmationNumber)
      if (f.cabin) flight.cabin = String(f.cabin)

      // Cap confidence at 0.95
      flight.confidence = Math.min(flight.confidence, 0.95)

      return flight
    })

    const avgConfidence = flights.length > 0
      ? flights.reduce((sum, f) => sum + f.confidence, 0) / flights.length
      : 0

    return {
      flights,
      rawText: text,
      needsConfirmation: avgConfidence < 0.8,
      parseNotes: [`Parsed with AI (${model})`],
      parsedBy: "ai",
    }
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      console.error("[flight-parser-ai] OpenRouter request timed out after 30s")
    } else {
      console.error("[flight-parser-ai] Failed to parse with AI:", err)
    }
    return null
  }
}
