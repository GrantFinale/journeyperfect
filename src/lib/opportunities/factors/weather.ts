/**
 * Weather (stage 1, free). Plan §4.3. Pure.
 *
 * Within the 16-day forecast horizon the caller passes DayForecast[] and the
 * result is RETRIEVED. Beyond it the caller passes ClimateMonth rows (from the
 * DestinationProfile) or an archive-derived summary (weather-climate.ts) and
 * the result is HISTORICAL; the UI must then say "typically", never "will be".
 */
import type { DayForecast } from "@/lib/weather"
import { eachDay, monthsInRange } from "../dates"
import type { ClimateMonth, FactorResult, OpportunityReason, OpportunityWeatherContext } from "../types"
import { mean, reason, result, unavailable } from "./shared"

export const SWIMMABLE_HIGH_F = 78

export type OutdoorSuitability = "GOOD" | "FAIR" | "POOR"

export interface HistoricalSummary {
  highF: number
  lowF: number
  /** 0..100 */
  precipPct: number
}

export interface WeatherInput {
  checkIn: string
  checkOut: string
  /** Open-Meteo 16-day forecast; used only when it covers every stay day */
  forecast?: DayForecast[] | null
  /** Profile climate normals */
  climate?: ClimateMonth[] | null
  /** Archive-derived fallback when the profile has no climate */
  historical?: HistoricalSummary | null
  /** The user asked for somewhere warm */
  wantWarm?: boolean
  /** The destination's anchor experience depends on weather */
  weatherDependentAnchor?: boolean
  /** ISO 8601, when the forecast was fetched */
  retrievedAt?: string
}

export function outdoorSuitability(highF: number, precipPct: number): OutdoorSuitability {
  if (precipPct > 60 || highF < 45 || highF > 100) return "POOR"
  if (precipPct <= 30 && highF >= 65 && highF <= 92) return "GOOD"
  return "FAIR"
}

function summariseForecast(forecast: DayForecast[], checkIn: string, checkOut: string): HistoricalSummary | null {
  const days = eachDay(checkIn, checkOut)
  const byDate = new Map(forecast.map((d) => [d.date, d]))
  const rows = days.map((d) => byDate.get(d))
  if (rows.length === 0 || rows.some((r) => r == null)) return null
  const hit = rows as DayForecast[]
  return {
    highF: Math.round(mean(hit.map((d) => d.highTemp)) ?? 0),
    lowF: Math.round(mean(hit.map((d) => d.lowTemp)) ?? 0),
    precipPct: Math.round(Math.max(...hit.map((d) => d.precipitationPct))),
  }
}

function summariseClimate(climate: ClimateMonth[], checkIn: string, checkOut: string): HistoricalSummary | null {
  const months = monthsInRange(checkIn, checkOut)
  const rows = months.map((m) => climate.find((c) => c.month === m)).filter((c): c is ClimateMonth => c != null)
  if (rows.length === 0) return null
  return {
    highF: Math.round(mean(rows.map((c) => c.highF)) ?? 0),
    lowF: Math.round(mean(rows.map((c) => c.lowF)) ?? 0),
    precipPct: Math.round(mean(rows.map((c) => c.precipPct)) ?? 0),
  }
}

export function evaluateWeather(input: WeatherInput): FactorResult {
  let summary: HistoricalSummary | null = null
  let kind: OpportunityWeatherContext["kind"] | null = null

  if (input.forecast && input.forecast.length) {
    summary = summariseForecast(input.forecast, input.checkIn, input.checkOut)
    if (summary) kind = "FORECAST"
  }
  if (!summary && input.climate && input.climate.length) {
    summary = summariseClimate(input.climate, input.checkIn, input.checkOut)
    if (summary) kind = "HISTORICAL"
  }
  if (!summary && input.historical) {
    summary = input.historical
    kind = "HISTORICAL"
  }
  if (!summary || !kind) return unavailable("weather")

  const { highF, lowF, precipPct } = summary
  const swimmable = highF >= SWIMMABLE_HIGH_F
  const band = outdoorSuitability(highF, precipPct)
  const historical = kind === "HISTORICAL"
  const verb = historical ? "typically" : "forecast"
  const summaryText = `${verb} ${highF}° / ${lowF}°, ${precipPct}% rain`

  let score = band === "GOOD" ? 0.85 : band === "FAIR" ? 0.5 : 0.15
  if (swimmable && band !== "POOR") score += 0.1
  if (input.wantWarm && highF < 70) score -= 0.3

  const reasons: OpportunityReason[] = []
  if (band === "GOOD") {
    reasons.push(reason("weather", "POSITIVE", swimmable ? "Warm enough to swim" : "Good weather", swimmable ? 0.5 : 0.4, summaryText))
  } else if (band === "POOR") {
    const why = precipPct > 60 ? "Likely wet" : highF < 45 ? "Cold for the outdoors" : "Extreme heat"
    reasons.push(reason("weather", "NEGATIVE", why, input.weatherDependentAnchor ? 0.7 : 0.5, summaryText))
  } else if (input.weatherDependentAnchor && precipPct > 45) {
    reasons.push(reason("weather", "NEGATIVE", "Rain could spoil the main draw", 0.4, summaryText))
  }
  if (input.wantWarm && highF < 70) {
    reasons.push(reason("weather", "NEGATIVE", "Not warm", 0.5, summaryText))
  }

  return result(
    "weather",
    score,
    historical ? "HISTORICAL" : "RETRIEVED",
    {
      kind,
      highF,
      lowF,
      precipPct,
      swimmable,
      outdoorSuitability: band,
      summary: summaryText,
      weatherDependentAnchor: input.weatherDependentAnchor === true,
    },
    reasons,
    historical ? undefined : input.retrievedAt
  )
}

/** Rebuild the `weatherContext` Json from a stored FactorResult. */
export function weatherContextFromFacts(f: FactorResult | undefined): OpportunityWeatherContext {
  if (!f || !f.available) {
    return { kind: "HISTORICAL", highF: 0, lowF: 0, precipPct: 0, swimmable: false, summary: "Weather unavailable" }
  }
  return {
    kind: f.facts.kind === "FORECAST" ? "FORECAST" : "HISTORICAL",
    highF: Number(f.facts.highF) || 0,
    lowF: Number(f.facts.lowF) || 0,
    precipPct: Number(f.facts.precipPct) || 0,
    swimmable: f.facts.swimmable === true,
    summary: String(f.facts.summary ?? ""),
  }
}
