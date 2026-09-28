/**
 * Generate a DestinationProfile with the AI layer (plan §4.5: "generated once
 * by the AI layer and cached indefinitely with a manual refresh").
 *
 * Used only by the admin action `generateDestinationProfileAdmin`. Never
 * called from the user pipeline: stage 1 must run with zero paid calls.
 *
 * Same OpenRouter fetch pattern as src/lib/flight-parser-ai.ts. The response
 * is validated through `normaliseProfile` and a few extra checks before it is
 * upserted; a malformed answer is an error, never a half-profile.
 */
import { Prisma } from "@prisma/client"
import { logAIUsage } from "@/lib/ai-usage"
import { getAirportCoords } from "@/lib/airports"
import { getConfigKey } from "@/lib/config-keys"
import { prisma } from "@/lib/db"
import { normaliseProfile, type NormalisedProfile } from "./destinations"

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
const TIMEOUT_MS = 60_000

export function buildDestinationProfilePrompt(iata: string, name: string, city: string, lat: number, lng: number): string {
  return `You are compiling a factual leisure-travel knowledge record for the destination served by airport ${iata} (${name}, ${city}; ${lat}, ${lng}). Return ONLY a JSON object with exactly this shape and no commentary:

{
  "iata": "${iata}",
  "name": "<destination name travelers use, e.g. Orlando>",
  "lat": ${lat},
  "lng": ${lng},
  "tier": "BUDGET" | "MID" | "UPSCALE" | "LUXURY",
  "idealNightsMin": <integer>,
  "idealNightsMax": <integer>,
  "walkable": <boolean>,
  "carNeeded": <boolean>,
  "airportToCenterKm": <number>,
  "parkingTypical": "FREE" | "CHEAP" | "EXPENSIVE",
  "activitiesDispersed": <boolean>,
  "familyFit": {
    "tags": [<subset of: "theme-parks","water","interactive","zoo-aquarium","nightlife-heavy","sports","hiking","beach","museums","snow","shopping","food","music","spa","golf">],
    "byAgeBand": { "0-5": <0-3>, "6-12": <0-3>, "13-17": <0-3>, "adult": <0-3> },
    "indoorRatio": <0..1>
  },
  "anchors": [
    { "title": "<specific named experience>", "kind": "THEME_PARK" | "EVENT" | "NATURE" | "ATTRACTION" | "SPORTS" | "FESTIVAL", "months": [<1..12>], "weatherDependent": <boolean> }
  ],
  "climate": { "monthly": [ { "m": 1, "highF": <int>, "lowF": <int>, "precipDays": <int> }, ... one entry per month 1..12 ] }
}

Rules:
- tier is the dominant hotel stock, not the most expensive property.
- idealNightsMin/Max: how long most families actually spend.
- anchors: 3 to 6 entries; only real, recurring things; months = when they are on or in season.
- climate: approximate 1991-2020 normals in Fahrenheit and days with measurable precipitation.
- byAgeBand: 0 = nothing for that age, 3 = outstanding.
- No markdown, no trailing commas.`
}

export interface GenerateProfileResult {
  profile: NormalisedProfile
  model: string
  created: boolean
}

export async function generateDestinationProfile(iata: string, opts: { userId?: string } = {}): Promise<GenerateProfileResult> {
  const code = iata.trim().toUpperCase()
  const airport = getAirportCoords(code)
  if (!airport) throw new Error(`Unknown airport code ${code}; add it to src/lib/airports.ts first`)

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set")
  const model = await getConfigKey("ai.destinationProfileModel")

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let data: { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } }
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        temperature: 0,
        messages: [{ role: "user", content: buildDestinationProfilePrompt(code, airport.name, airport.city, airport.lat, airport.lng) }],
      }),
      signal: controller.signal,
    })
    if (!response.ok) {
      const body = await response.text().catch(() => "unknown")
      throw new Error(`OpenRouter ${response.status} ${response.statusText}: ${body.slice(0, 300)}`)
    }
    data = await response.json()
  } finally {
    clearTimeout(timeout)
  }

  if (opts.userId && data.usage) {
    logAIUsage({
      userId: opts.userId,
      feature: "destination_profile",
      model,
      promptTokens: data.usage.prompt_tokens ?? 0,
      completionTokens: data.usage.completion_tokens ?? 0,
    })
  }

  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error("OpenRouter returned no content")
  const profile = parseProfileResponse(content, code, airport.lat, airport.lng)

  const existing = await prisma.destinationProfile.findUnique({ where: { iata: code }, select: { id: true } })
  const row = {
    name: profile.name,
    lat: profile.lat,
    lng: profile.lng,
    tier: profile.tier,
    idealNightsMin: profile.idealNightsMin,
    idealNightsMax: profile.idealNightsMax,
    walkable: profile.walkable,
    carNeeded: profile.carNeeded,
    airportToCenterKm: profile.airportToCenterKm,
    parkingTypical: profile.parkingTypical,
    activitiesDispersed: profile.activitiesDispersed,
    familyFit: profile.familyFit as unknown as Prisma.InputJsonValue,
    anchors: profile.anchors.map(({ title, rawKind, months, weatherDependent }) => ({ title, kind: rawKind, months, weatherDependent })) as unknown as Prisma.InputJsonValue,
    climate: profile.climate ? (profile.climate as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
    generatedBy: model,
    refreshedAt: new Date(),
  }
  await prisma.destinationProfile.upsert({ where: { iata: code }, create: { iata: code, ...row }, update: row })
  return { profile: { ...profile, generatedBy: model }, model, created: !existing }
}

/** Pure: parse and validate the model's JSON. Exported for tests. */
export function parseProfileResponse(content: string, iata: string, lat: number, lng: number): NormalisedProfile {
  let jsonStr = content.trim()
  const fenced = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) jsonStr = fenced[1].trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonStr)
  } catch {
    throw new Error("Model response was not valid JSON")
  }
  const raw = { ...(parsed as Record<string, unknown>), iata, lat, lng }
  const profile = normaliseProfile(raw)
  if (!profile) throw new Error("Model response lacked required profile fields")
  if (profile.anchors.length < 2) throw new Error("Model response had fewer than two anchors")
  if (!profile.climate || profile.climate.length !== 12) throw new Error("Model response lacked a full 12-month climate table")
  if (Object.keys(profile.familyFit.byAgeBand).length < 4) throw new Error("Model response lacked all four age bands")
  return profile
}
