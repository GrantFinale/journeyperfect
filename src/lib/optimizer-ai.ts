import { getConfig } from "./config"

export interface AIOptimizedDay {
  date: string
  items: {
    title: string
    startTime: string // HH:MM
    endTime: string
    type: "ACTIVITY" | "MEAL" | "TRANSIT" | "BUFFER"
    activityId?: string
    notes?: string
    travelTimeFromPrev?: number
  }[]
  reasoning: string
}

export async function optimizeItineraryWithAI(context: {
  destination: string
  startDate: string
  endDate: string
  activities: {
    id: string
    name: string
    durationMins: number
    lat?: number | null
    lng?: number | null
    priority: string
    indoorOutdoor: string
    isFixed: boolean
    fixedDateTime?: string | null
    category?: string | null
  }[]
  flights: {
    departureTime: string
    arrivalTime: string
    departureAirport?: string | null
    arrivalAirport?: string | null
  }[]
  hotels: {
    name: string
    lat?: number | null
    lng?: number | null
    checkIn: string
    checkOut: string
  }[]
  travelers: { name: string; tags: string[] }[]
  weatherForecast?: {
    date: string
    weatherLabel: string
    tempMax: number
    precipitationProbability: number
  }[]
}): Promise<AIOptimizedDay[] | null> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.error("[optimizer-ai] OPENROUTER_API_KEY is not set")
    return null
  }

  const model = await getConfig("ai.optimizerModel", "anthropic/claude-haiku-4.5")

  const hasKids = context.travelers.some((t) => t.tags.includes("child"))
  const travelerSummary =
    context.travelers.length > 0
      ? context.travelers
          .map((t) => `${t.name} (${t.tags.join(", ") || "adult"})`)
          .join(", ")
      : "2 adults"

  const activitiesList = context.activities
    .map(
      (a) =>
        `- [${a.id}] "${a.name}" (${a.durationMins}min, priority: ${a.priority}, ${a.indoorOutdoor}${a.isFixed && a.fixedDateTime ? `, FIXED at ${a.fixedDateTime}` : ""}${a.category ? `, category: ${a.category}` : ""}${a.lat != null && a.lng != null ? `, location: ${a.lat},${a.lng}` : ""})`
    )
    .join("\n")

  const flightsList =
    context.flights.length > 0
      ? context.flights
          .map(
            (f) =>
              `- ${f.departureAirport || "?"} -> ${f.arrivalAirport || "?"}: departs ${f.departureTime}, arrives ${f.arrivalTime}`
          )
          .join("\n")
      : "None"

  const hotelsList =
    context.hotels.length > 0
      ? context.hotels
          .map(
            (h) =>
              `- ${h.name}: check-in ${h.checkIn}, check-out ${h.checkOut}${h.lat != null ? ` (${h.lat},${h.lng})` : ""}`
          )
          .join("\n")
      : "None"

  const weatherSection =
    context.weatherForecast && context.weatherForecast.length > 0
      ? `\nWeather forecast:\n${context.weatherForecast
          .map(
            (w) =>
              `- ${w.date}: ${w.weatherLabel}, high ${w.tempMax}F, ${w.precipitationProbability}% precipitation`
          )
          .join("\n")}`
      : ""

  const prompt = `You are an expert travel itinerary optimizer for a trip to ${context.destination}.
Create an optimized day-by-day schedule from ${context.startDate} to ${context.endDate}.

Travelers: ${travelerSummary}

Activities to schedule:
${activitiesList}

Flights:
${flightsList}

Hotels:
${hotelsList}
${weatherSection}

OPTIMIZATION RULES:
1. Schedule ALL activities, prioritizing MUST_DO and HIGH priority items first
2. Group geographically close activities on the same day to minimize travel
3. Schedule outdoor activities on days with good weather (low precipitation); move indoor activities to rainy days
4. Respect fixed activities — they MUST be on their fixed date/time
5. Include meal breaks: breakfast ~8:00-9:00, lunch ~12:00-13:30, dinner ~18:30-20:00
6. Add realistic travel time between activities (15-45 min depending on distance)
7. Add 15-30 min buffer between activities for transitions
8. Don't schedule activities during flight times (include 2h before departure for airport)
9. Don't schedule before hotel check-in on arrival day or after check-out time on departure day
${hasKids ? "10. IMPORTANT: Keep days shorter (end by 17:00-18:00), include rest breaks, avoid back-to-back intense activities" : "10. Days can run from ~8:00 to ~21:00 max"}

For each day, provide a reasoning explaining your choices.

Return ONLY a JSON array of days in this exact format:
[
  {
    "date": "YYYY-MM-DD",
    "items": [
      {
        "title": "Activity name or Breakfast/Lunch/Dinner",
        "startTime": "HH:MM",
        "endTime": "HH:MM",
        "type": "ACTIVITY" | "MEAL" | "TRANSIT" | "BUFFER",
        "activityId": "id-from-list-above (only for ACTIVITY type, must match an id from the activities list)",
        "notes": "optional tip or note",
        "travelTimeFromPrev": 15
      }
    ],
    "reasoning": "Why activities were ordered this way for this day"
  }
]

CRITICAL: For items of type "ACTIVITY", the activityId MUST match one of the IDs from the activities list above (the value in square brackets). Each activity should appear at most once across all days. Return ONLY valid JSON, no other text.`

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60000)

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          temperature: 0.2,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: controller.signal,
      }
    )

    clearTimeout(timeout)

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "unknown")
      console.error(
        `[optimizer-ai] OpenRouter API error: ${response.status} ${response.statusText}`,
        errorBody
      )
      return null
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content
    if (!content) {
      console.error(
        "[optimizer-ai] No content in OpenRouter response",
        JSON.stringify(data).slice(0, 500)
      )
      return null
    }

    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = content.trim()
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim()
    }

    // Try to find the array in the response
    const arrayMatch = jsonStr.match(/\[[\s\S]*\]/)
    if (!arrayMatch) {
      console.error(
        "[optimizer-ai] No JSON array found in response",
        jsonStr.slice(0, 300)
      )
      return null
    }

    const parsed = JSON.parse(arrayMatch[0]) as AIOptimizedDay[]

    if (!Array.isArray(parsed) || parsed.length === 0) {
      console.error("[optimizer-ai] Parsed result is not a valid array")
      return null
    }

    // Validate structure
    const validActivityIds = new Set(context.activities.map((a) => a.id))
    for (const day of parsed) {
      if (!day.date || !Array.isArray(day.items)) {
        console.error("[optimizer-ai] Invalid day structure", day)
        return null
      }
      // Strip invalid activityIds
      for (const item of day.items) {
        if (item.activityId && !validActivityIds.has(item.activityId)) {
          item.activityId = undefined
        }
      }
    }

    return parsed
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      console.error("[optimizer-ai] OpenRouter request timed out after 60s")
    } else {
      console.error("[optimizer-ai] Failed to optimize with AI:", err)
    }
    return null
  }
}
