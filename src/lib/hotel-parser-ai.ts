import { getConfig } from "./config"

export interface ParsedHotel {
  name?: string
  address?: string
  checkIn?: string  // ISO date
  checkOut?: string // ISO date
  confirmationNumber?: string
  roomType?: string
  roomCount?: number
  price?: number
  priceCurrency?: string
  bookingLink?: string
  notes?: string
}

export interface HotelParseResult {
  hotels: ParsedHotel[]
  confirmationNumber?: string
  parsedBy: "ai"
}

export async function parseHotelTextWithAI(text: string): Promise<HotelParseResult | null> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.error("[hotel-parser-ai] OPENROUTER_API_KEY not set")
    return null
  }

  const model = await getConfig("ai.hotelParserModel", "anthropic/claude-haiku-4.5")

  const prompt = `You are parsing a hotel booking confirmation email. These emails contain marketing content, loyalty program info, and promotions — IGNORE all of that. Focus ONLY on the booking details.

CRITICAL: Extract EVERY room in the booking. If someone booked 2 connecting rooms, that's 2 entries (or 1 entry with roomCount: 2). If staying at multiple hotels, extract each one.

Return a JSON object:
{
  "hotels": [
    {
      "name": "Hilton San Antonio Riverwalk",
      "address": "123 Main St, San Antonio, TX 78205",
      "checkIn": "2025-03-31",
      "checkOut": "2025-04-05",
      "confirmationNumber": "ABC12345",
      "roomType": "2 Queen Beds",
      "roomCount": 2,
      "price": 189.99,
      "priceCurrency": "USD",
      "notes": "Connecting rooms requested"
    }
  ],
  "confirmationNumber": "ABC12345"
}

Rules:
- Dates in YYYY-MM-DD format
- Price is per night per room if possible, or total if that's what's shown (note which in the notes)
- roomCount is number of rooms booked (not number of beds)
- Include the full hotel name as shown in the confirmation
- Include full address if available
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
      console.error(`[hotel-parser-ai] API error: ${response.status}`, err)
      return null
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content
    if (!content) {
      console.error("[hotel-parser-ai] No content in response")
      return null
    }

    let jsonStr = content.trim()
    const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (match) jsonStr = match[1].trim()

    const parsed = JSON.parse(jsonStr)
    if (!parsed.hotels || !Array.isArray(parsed.hotels)) return null

    return {
      hotels: parsed.hotels,
      confirmationNumber: parsed.confirmationNumber,
      parsedBy: "ai",
    }
  } catch (err) {
    console.error("[hotel-parser-ai] Failed:", err)
    return null
  }
}
