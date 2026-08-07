import { getConfig } from "./config"
import { logAIUsage } from "./ai-usage"
import { haversineDistance } from "./haversine"
import { MAX_DAY_RADIUS_KM } from "./optimizer"
import { MEAL_SLOTS, MEAL_WINDOWS, type MealSlot } from "./meal-slots"

export interface AIOptimizedItem {
  title: string
  startTime: string // HH:MM
  endTime: string
  type: "ACTIVITY" | "MEAL"
  activityId?: string
  notes?: string
  travelTimeFromPrev?: number
}

export interface AIOptimizedDay {
  date: string
  items: AIOptimizedItem[]
  reasoning: string
}

/** The lodging the travellers are based at on a given date. */
export interface AIDayBase {
  date: string // yyyy-MM-dd
  name: string
  city?: string | null
  lat?: number | null
  lng?: number | null
}

export interface AIActivityInput {
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
  address?: string | null
  city?: string | null
  rating?: number | null
  /** True for restaurants/bars/cafes — these must land in a meal window. */
  isDining?: boolean
  /** Resolved eligible meal slots; null/empty means "never auto-schedule". */
  mealSlots?: MealSlot[] | null
}

function timeToMins(t: string): number {
  const [h, m] = (t || "").split(":").map(Number)
  if (Number.isNaN(h)) return NaN
  return h * 60 + (Number.isNaN(m) ? 0 : m)
}

/** Which meal windows a start time falls inside (dinner and drinks overlap). */
function slotsAtTime(startMin: number): MealSlot[] {
  return MEAL_SLOTS.filter(
    (s) => startMin >= MEAL_WINDOWS[s].startMin && startMin <= MEAL_WINDOWS[s].endMin
  )
}

const MEAL_WINDOW_SUMMARY = MEAL_SLOTS.map((s) => {
  const w = MEAL_WINDOWS[s]
  const fmt = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
  return `${s} ${fmt(w.startMin)}–${fmt(w.endMin)}`
}).join(", ")

export async function optimizeItineraryWithAI(context: {
  userId?: string
  destination: string
  startDate: string
  endDate: string
  activities: AIActivityInput[]
  flights: {
    departureTime: string
    arrivalTime: string
    departureAirport?: string | null
    arrivalAirport?: string | null
  }[]
  hotels: {
    name: string
    city?: string | null
    lat?: number | null
    lng?: number | null
    checkIn: string
    checkOut: string
  }[]
  /** Per-day lodging base — the hard geo-fence the model must respect. */
  dayBases?: AIDayBase[]
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
    .map((a) => {
      const bits: string[] = [
        `${a.durationMins}min`,
        `priority: ${a.priority}`,
        a.indoorOutdoor,
      ]
      if (a.isFixed && a.fixedDateTime) bits.push(`FIXED at ${a.fixedDateTime}`)
      if (a.category) bits.push(`category: ${a.category}`)
      if (a.city) bits.push(`city: ${a.city}`)
      else if (a.address) bits.push(`address: ${a.address}`)
      if (a.lat != null && a.lng != null) bits.push(`location: ${a.lat},${a.lng}`)
      if (a.isDining) {
        bits.push(
          a.mealSlots && a.mealSlots.length
            ? `RESTAURANT — meal slots: ${a.mealSlots.join("/")}`
            : "RESTAURANT — NO MEAL TIMES KNOWN, DO NOT SCHEDULE"
        )
      }
      return `- [${a.id}] "${a.name}" (${bits.join(", ")})`
    })
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
              `- ${h.name}${h.city ? ` — ${h.city}` : ""}: check-in ${h.checkIn}, check-out ${h.checkOut}${h.lat != null ? ` (${h.lat},${h.lng})` : ""}`
          )
          .join("\n")
      : "None"

  const dayBasesList =
    context.dayBases && context.dayBases.length > 0
      ? context.dayBases
          .map(
            (b) =>
              `${b.date}: staying at ${b.name}${b.city ? ` — ${b.city}` : ""}${b.lat != null && b.lng != null ? ` (${b.lat.toFixed(2)},${b.lng.toFixed(2)})` : ""}`
          )
          .join("\n")
      : "No lodging on file — assume every day is based in " + context.destination

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

WHERE THEY SLEEP EACH NIGHT (the day's base):
${dayBasesList}
${weatherSection}

GEOGRAPHY RULES (most important — violating these ruins the trip):
G1. Every activity you schedule on a given day MUST be in or near that day's base city listed above.
G2. NEVER schedule an activity that is more than about an hour's drive (~${MAX_DAY_RADIUS_KM}km) from that day's base.
G3. If the only remaining activities are in a different city, leave the day short rather than scheduling them. A short day is correct; a 3-hour drive to a different city and back is not.
G4. Use each activity's city/address/coordinates to decide. Two activities in different cities do not belong on the same day.

MEAL RULES:
M1. Activities tagged RESTAURANT are meals. Schedule them ONLY inside their listed meal slots: ${MEAL_WINDOW_SUMMARY}.
M2. At most ONE restaurant per meal period per day — one breakfast, one lunch, one dinner, one drinks. NEVER schedule two restaurants back to back.
M3. A restaurant tagged "NO MEAL TIMES KNOWN" must NOT be scheduled at all — skip it entirely.
M4. Return "type": "MEAL" for restaurants and "type": "ACTIVITY" for everything else.
M5. Restaurants must also obey the geography rules — eat near where you are that day.

OPTIMIZATION RULES:
1. Schedule activities, prioritizing MUST_DO and HIGH priority items first — but never at the cost of the geography rules
2. Group geographically close activities on the same day to minimize travel
3. Schedule outdoor activities on days with good weather (low precipitation); move indoor activities to rainy days
4. Respect fixed activities — they MUST be on their fixed date/time
5. Build the day around the meals: place the meal items in their windows first, then fit activities around them
6. Account for realistic travel time between activities (15-45 min depending on distance) when setting start times, but do NOT create separate items for travel or transit — travel times are displayed automatically between items
7. Do NOT create buffer or transit items — ONLY schedule items from the activities list above
8. Don't schedule activities during flight times (include 2h before departure for airport)
9. Don't schedule before hotel check-in on arrival day or after check-out time on departure day
${hasKids ? "10. IMPORTANT: Keep days shorter (end by 17:00-18:00), include rest breaks, avoid back-to-back intense activities" : "10. Days can run from ~8:00 to ~21:00 max"}

For each day, provide a reasoning explaining your choices (include travel time estimates in the reasoning).

Return ONLY a JSON array of days in this exact format:
[
  {
    "date": "YYYY-MM-DD",
    "items": [
      {
        "title": "Activity name",
        "startTime": "HH:MM",
        "endTime": "HH:MM",
        "type": "ACTIVITY",
        "activityId": "id-from-list-above (must match an id from the activities list)",
        "notes": "optional tip or note",
        "travelTimeFromPrev": 15
      },
      {
        "title": "Restaurant name",
        "startTime": "18:30",
        "endTime": "20:00",
        "type": "MEAL",
        "activityId": "id-from-list-above",
        "travelTimeFromPrev": 10
      }
    ],
    "reasoning": "Why activities were ordered this way for this day, including travel time considerations"
  }
]

CRITICAL: The activityId MUST match one of the IDs from the activities list above (the value in square brackets). Each activity should appear at most once across all days. Use only "ACTIVITY" and "MEAL" types — no TRANSIT or BUFFER items. Return ONLY valid JSON, no other text.`

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

    // Log AI usage
    if (context.userId && data.usage) {
      logAIUsage({
        userId: context.userId,
        feature: "optimizer",
        model,
        promptTokens: data.usage.prompt_tokens ?? 0,
        completionTokens: data.usage.completion_tokens ?? 0,
      })
    }

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

    for (const day of parsed) {
      if (!day.date || !Array.isArray(day.items)) {
        console.error("[optimizer-ai] Invalid day structure", day)
        return null
      }
    }

    return enforceScheduleRules(parsed, context.activities, context.dayBases)
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      console.error("[optimizer-ai] OpenRouter request timed out after 60s")
    } else {
      console.error("[optimizer-ai] Failed to optimize with AI:", err)
    }
    return null
  }
}

/**
 * Post-validation. Models drift, so the geo-fence and the meal rules are enforced
 * here as well as in the prompt: items are dropped rather than trusted.
 */
export function enforceScheduleRules(
  days: AIOptimizedDay[],
  activities: AIActivityInput[],
  dayBases?: AIDayBase[]
): AIOptimizedDay[] {
  const byId = new Map(activities.map((a) => [a.id, a]))
  const baseByDate = new Map((dayBases ?? []).map((b) => [b.date, b]))

  for (const day of days) {
    const base = baseByDate.get(day.date)
    const usedSlots = new Set<MealSlot>()
    const kept: AIOptimizedItem[] = []

    const items = [...day.items].sort(
      (a, b) => (timeToMins(a.startTime) || 0) - (timeToMins(b.startTime) || 0)
    )

    for (const item of items) {
      // Strip invalid activityIds; an item with no known activity can't be created.
      const activity = item.activityId ? byId.get(item.activityId) : undefined
      if (!activity) {
        item.activityId = undefined
        continue
      }

      // Geo-fence: never keep an item far from the day's base.
      if (
        base?.lat != null &&
        base?.lng != null &&
        activity.lat != null &&
        activity.lng != null &&
        haversineDistance(base.lat, base.lng, activity.lat, activity.lng) > MAX_DAY_RADIUS_KM
      ) {
        continue
      }

      if (activity.isDining) {
        // Restaurants with unknown meal times are never scheduled.
        if (!activity.mealSlots || activity.mealSlots.length === 0) continue

        const startMin = timeToMins(item.startTime)
        if (Number.isNaN(startMin)) continue

        // Must sit in one of its own meal windows, and that window must be free.
        const slot = slotsAtTime(startMin).find(
          (s) => activity.mealSlots!.includes(s) && !usedSlots.has(s)
        )
        if (!slot) continue

        // Never two restaurants back to back.
        if (kept.length > 0 && kept[kept.length - 1].type === "MEAL") continue

        usedSlots.add(slot)
        item.type = "MEAL"
      } else {
        item.type = "ACTIVITY"
      }

      kept.push(item)
    }

    day.items = kept
  }

  return days
}
