import { getConfig } from "./config"
import { logAIUsage } from "./ai-usage"

export interface ParsedRentalCar {
  company?: string
  confirmationNumber?: string
  vehicleType?: string
  pickupLocation?: string
  pickupAddress?: string
  pickupTime?: string // ISO datetime
  pickupTimezone?: string
  dropoffLocation?: string
  dropoffAddress?: string
  dropoffTime?: string // ISO datetime
  dropoffTimezone?: string
  price?: number
  priceCurrency?: string
  bookingLink?: string
  notes?: string
}

export interface RentalCarParseResult {
  rentalCars: ParsedRentalCar[]
  confirmationNumber?: string
  parsedBy: "ai"
}

export async function parseRentalCarTextWithAI(text: string, userId?: string): Promise<RentalCarParseResult | null> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.error("[rental-car-parser-ai] OPENROUTER_API_KEY not set")
    return null
  }

  const model = await getConfig("ai.rentalCarParserModel", "anthropic/claude-haiku-4.5")

  const prompt = `You are parsing a car rental booking confirmation email. These emails contain marketing content, loyalty program info, and upsell offers — IGNORE all of that. Focus ONLY on the rental booking details.

CRITICAL: Extract EVERY rental car in the booking. If someone booked multiple vehicles, extract each one.

Common car rental companies: Enterprise, Hertz, Avis, Budget, National, Alamo, Dollar, Thrifty, Sixt, Turo, Zipcar, Fox, Payless, Europcar, Localiza.

Return a JSON object:
{
  "rentalCars": [
    {
      "company": "Enterprise",
      "confirmationNumber": "ABC12345",
      "vehicleType": "Midsize SUV",
      "pickupLocation": "Denver International Airport (DEN)",
      "pickupAddress": "8500 Pena Blvd, Denver, CO 80249",
      "pickupTime": "2025-06-15T10:00:00",
      "pickupTimezone": "America/Denver",
      "dropoffLocation": "Denver International Airport (DEN)",
      "dropoffAddress": "8500 Pena Blvd, Denver, CO 80249",
      "dropoffTime": "2025-06-20T10:00:00",
      "dropoffTimezone": "America/Denver",
      "price": 45.99,
      "priceCurrency": "USD",
      "notes": "Prepaid rate, counter pickup"
    }
  ],
  "confirmationNumber": "ABC12345"
}

Rules:
- Dates/times in ISO 8601 format (YYYY-MM-DDTHH:MM:SS)
- Use IANA timezone names when possible (e.g. "America/New_York"), fall back to "UTC"
- Price is the total rental price if shown, or per-day if that's what's given (note which in notes)
- For Turo, include the host name in notes if available
- Include full pickup/dropoff location names and addresses when available
- Omit fields that cannot be determined
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
      console.error(`[rental-car-parser-ai] API error: ${response.status}`, err)
      return null
    }

    const data = await response.json()

    // Log AI usage
    if (userId && data.usage) {
      logAIUsage({
        userId,
        feature: "rental_car_parser",
        model,
        promptTokens: data.usage.prompt_tokens ?? 0,
        completionTokens: data.usage.completion_tokens ?? 0,
      })
    }

    const content = data.choices?.[0]?.message?.content
    if (!content) {
      console.error("[rental-car-parser-ai] No content in response")
      return null
    }

    let jsonStr = content.trim()
    const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (match) jsonStr = match[1].trim()

    const parsed = JSON.parse(jsonStr)
    if (!parsed.rentalCars || !Array.isArray(parsed.rentalCars)) return null

    return {
      rentalCars: parsed.rentalCars,
      confirmationNumber: parsed.confirmationNumber,
      parsedBy: "ai",
    }
  } catch (err) {
    console.error("[rental-car-parser-ai] Failed:", err)
    return null
  }
}
