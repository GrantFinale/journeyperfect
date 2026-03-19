import type { ParseResult, ParsedFlight } from "./flight-parser"

export async function parseFlightTextWithAI(text: string): Promise<ParseResult | null> {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return null

    const { default: Anthropic } = await import("@anthropic-ai/sdk")
    const client = new Anthropic({ apiKey })

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: `Extract all flight segments from the following airline confirmation email or itinerary text. Return a JSON object with this exact structure:

{
  "flights": [
    {
      "airline": "Airline name",
      "flightNumber": "XX1234",
      "departureAirport": "JFK",
      "departureCity": "New York",
      "departureTime": "2025-03-15T10:30:00",
      "departureTimezone": "America/New_York",
      "arrivalAirport": "LAX",
      "arrivalCity": "Los Angeles",
      "arrivalTime": "2025-03-15T13:45:00",
      "arrivalTimezone": "America/Los_Angeles",
      "confirmationNumber": "ABC123",
      "cabin": "Economy",
      "passengers": ["John Doe"]
    }
  ],
  "confirmationNumber": "ABC123"
}

Rules:
- Use IATA 3-letter airport codes
- Use IANA timezone names (e.g. America/New_York, not EST)
- Use ISO 8601 datetime format for times
- Flight number should include the 2-letter airline code prefix (e.g. AA123, DL456)
- Include all segments (outbound and return)
- If a field cannot be determined, omit it
- Return ONLY valid JSON, no other text

Text to parse:
${text}`,
        },
      ],
    })

    const content = response.content[0]
    if (content.type !== "text") return null

    // Extract JSON from the response (handle markdown code blocks)
    let jsonStr = content.text.trim()
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim()
    }

    const parsed = JSON.parse(jsonStr)

    if (!parsed.flights || !Array.isArray(parsed.flights)) return null

    const flights: ParsedFlight[] = parsed.flights.map((f: Record<string, unknown>) => {
      const flight: ParsedFlight & { confidence: number } = {
        confidence: 0.9,
      }

      if (f.airline) flight.airline = String(f.airline)
      if (f.flightNumber) flight.flightNumber = String(f.flightNumber)
      if (f.departureAirport) flight.departureAirport = String(f.departureAirport)
      if (f.departureCity) flight.departureCity = String(f.departureCity)
      if (f.departureTime) flight.departureTime = new Date(String(f.departureTime))
      if (f.departureTimezone) flight.departureTimezone = String(f.departureTimezone)
      if (f.arrivalAirport) flight.arrivalAirport = String(f.arrivalAirport)
      if (f.arrivalCity) flight.arrivalCity = String(f.arrivalCity)
      if (f.arrivalTime) flight.arrivalTime = new Date(String(f.arrivalTime))
      if (f.arrivalTimezone) flight.arrivalTimezone = String(f.arrivalTimezone)
      if (f.confirmationNumber) flight.confirmationNumber = String(f.confirmationNumber)
      if (f.cabin) flight.cabin = String(f.cabin)

      return flight
    })

    return {
      flights,
      rawText: text,
      needsConfirmation: false,
      parseNotes: ["Parsed with AI (Claude Haiku)"],
    }
  } catch {
    return null
  }
}
