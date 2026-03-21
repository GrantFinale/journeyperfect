// Weather integration using Open-Meteo API (free, no API key needed)

export type WeatherAlertSeverity = "info" | "warning" | "danger"

export type DayForecast = {
  date: string // YYYY-MM-DD
  dayName: string // "Mon", "Tue", etc.
  emoji: string // weather emoji
  condition: string // "Sunny", "Cloudy", "Rain", etc.
  highTemp: number // Fahrenheit
  lowTemp: number // Fahrenheit
  precipitationPct: number // 0-100
  humidity: number // 0-100
  windMph: number
}

export type WeatherAlert = {
  id: string
  severity: WeatherAlertSeverity
  message: string
  suggestion?: string
  affectedDates?: string[] // ISO date strings
}

export type TripWeatherData = {
  forecasts: DayForecast[]
  alerts: WeatherAlert[]
  tripStart: string
  tripEnd: string
}

// Internal types for the core API logic

interface WeatherMeta {
  label: string
  icon: string
  isRainy: boolean
  isStormy: boolean
}

function getWeatherMeta(code: number): WeatherMeta {
  if (code === 0) return { label: "Clear sky", icon: "\u2600\uFE0F", isRainy: false, isStormy: false }
  if (code >= 1 && code <= 3) return { label: "Partly cloudy", icon: "\u26C5", isRainy: false, isStormy: false }
  if (code === 45 || code === 48) return { label: "Fog", icon: "\uD83C\uDF2B\uFE0F", isRainy: false, isStormy: false }
  if (code >= 51 && code <= 55) return { label: "Drizzle", icon: "\uD83C\uDF26\uFE0F", isRainy: false, isStormy: false }
  if (code === 56 || code === 57) return { label: "Freezing drizzle", icon: "\uD83C\uDF27\uFE0F", isRainy: false, isStormy: false }
  if (code >= 61 && code <= 65) return { label: "Rain", icon: "\uD83C\uDF27\uFE0F", isRainy: true, isStormy: false }
  if (code === 66 || code === 67) return { label: "Freezing rain", icon: "\uD83C\uDF27\uFE0F", isRainy: true, isStormy: false }
  if (code >= 71 && code <= 77) return { label: "Snow", icon: "\u2744\uFE0F", isRainy: false, isStormy: false }
  if (code >= 80 && code <= 82) return { label: "Rain showers", icon: "\uD83C\uDF27\uFE0F", isRainy: true, isStormy: false }
  if (code === 85 || code === 86) return { label: "Snow showers", icon: "\u2744\uFE0F", isRainy: false, isStormy: false }
  if (code === 95) return { label: "Thunderstorm", icon: "\u26C8\uFE0F", isRainy: true, isStormy: true }
  if (code === 96 || code === 99) return { label: "Thunderstorm with hail", icon: "\u26C8\uFE0F", isRainy: true, isStormy: true }
  return { label: "Unknown", icon: "\u2601\uFE0F", isRainy: false, isStormy: false }
}

// ─── In-memory Cache ──────────────────────────────────────────────────────────

const CACHE_TTL = 30 * 60_000 // 30 minutes
const MAX_CACHE_SIZE = 500

const forecastCache = new Map<
  string,
  { value: DayForecast[]; expiry: number }
>()

function cacheSet<K, V>(cache: Map<K, V>, key: K, value: V) {
  if (cache.size >= MAX_CACHE_SIZE) {
    const first = cache.keys().next().value
    if (first !== undefined) cache.delete(first)
  }
  cache.set(key, value)
}

function cacheKey(lat: number, lng: number): string {
  // Round to 2 decimals to coalesce nearby lookups
  return `${lat.toFixed(2)},${lng.toFixed(2)}`
}

// ─── Open-Meteo API ───────────────────────────────────────────────────────────

interface OpenMeteoDaily {
  time: string[]
  temperature_2m_max: number[]
  temperature_2m_min: number[]
  precipitation_sum: number[]
  precipitation_probability_max: number[]
  weather_code: number[]
  wind_speed_10m_max: number[]
  relative_humidity_2m_max: number[]
}

interface OpenMeteoResponse {
  daily: OpenMeteoDaily
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

export async function getWeatherForecast(
  lat: number,
  lng: number,
): Promise<DayForecast[]> {
  const key = cacheKey(lat, lng)
  const cached = forecastCache.get(key)
  if (cached && Date.now() < cached.expiry) {
    return cached.value
  }

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lng}` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weather_code,wind_speed_10m_max,relative_humidity_2m_max` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph` +
      `&timezone=auto&forecast_days=16`

    const res = await fetch(url, { next: { revalidate: 1800 } })
    if (!res.ok) {
      console.error(`[weather] Open-Meteo returned ${res.status}`)
      return []
    }

    const data: OpenMeteoResponse = await res.json()
    const { daily } = data

    const forecasts: DayForecast[] = daily.time.map((dateStr, i) => {
      const meta = getWeatherMeta(daily.weather_code[i])
      const date = new Date(dateStr + "T12:00:00")
      return {
        date: dateStr,
        dayName: DAY_NAMES[date.getDay()],
        emoji: meta.icon,
        condition: meta.label,
        highTemp: Math.round(daily.temperature_2m_max[i]),
        lowTemp: Math.round(daily.temperature_2m_min[i]),
        precipitationPct: Math.round(daily.precipitation_probability_max[i] ?? 0),
        humidity: Math.round(daily.relative_humidity_2m_max?.[i] ?? 0),
        windMph: Math.round(daily.wind_speed_10m_max[i] ?? 0),
      }
    })

    cacheSet(forecastCache, key, { value: forecasts, expiry: Date.now() + CACHE_TTL })
    return forecasts
  } catch (err) {
    console.error("[weather] Failed to fetch forecast:", err)
    return []
  }
}

// ─── Weather Alerts ───────────────────────────────────────────────────────────

interface ActivityWithDate {
  name: string
  date: string // YYYY-MM-DD
  indoorOutdoor: string // "INDOOR" | "OUTDOOR" | "BOTH"
  isFixed: boolean
}

export function getWeatherAlerts(
  forecast: DayForecast[],
  activities: ActivityWithDate[],
): WeatherAlert[] {
  const forecastByDate = new Map<string, DayForecast>()
  for (const day of forecast) {
    forecastByDate.set(day.date, day)
  }

  // Pre-compute clear days for rescheduling suggestions
  const clearDates = forecast
    .filter((d) => d.precipitationPct <= 30 && !d.condition.toLowerCase().includes("storm"))
    .map((d) => d.date)

  const alerts: WeatherAlert[] = []
  let alertIdx = 0

  // Activity-specific alerts
  for (const activity of activities) {
    // Only check outdoor or both activities
    if (activity.indoorOutdoor === "INDOOR") continue

    const day = forecastByDate.get(activity.date)
    if (!day) continue

    const isStormy = day.condition.toLowerCase().includes("storm") || day.condition.toLowerCase().includes("thunder")
    const isBadWeather = day.precipitationPct > 60 || isStormy

    if (!isBadWeather) continue

    const severity: WeatherAlertSeverity = isStormy ? "danger" : "warning"

    if (activity.isFixed) {
      alerts.push({
        id: `activity-${alertIdx++}`,
        severity,
        message: isStormy
          ? `Thunderstorm expected for ${activity.name} \u2014 consider safety precautions`
          : `Rain expected for ${activity.name} \u2014 bring rain gear`,
        affectedDates: [activity.date],
      })
    } else {
      // Find nearest clear day for suggestion
      const nearestClear = findNearestClearDay(activity.date, clearDates)
      const suggestion = nearestClear
        ? `Rain expected \u2014 consider moving ${activity.name} to ${nearestClear}`
        : undefined

      alerts.push({
        id: `activity-${alertIdx++}`,
        severity,
        message: isStormy
          ? `Thunderstorm expected for ${activity.name}`
          : `Rain expected for ${activity.name}`,
        suggestion,
        affectedDates: [activity.date],
      })
    }
  }

  // General weather alerts (not tied to specific activities)
  for (const day of forecast) {
    if (day.highTemp >= 100) {
      alerts.push({
        id: `heat-${alertIdx++}`,
        severity: "danger",
        message: `Extreme heat on ${day.dayName} ${day.date.slice(5)} (${day.highTemp}\u00B0F)`,
        suggestion: "Stay hydrated, plan outdoor activities for morning/evening",
        affectedDates: [day.date],
      })
    }
    if (day.lowTemp <= 20) {
      alerts.push({
        id: `cold-${alertIdx++}`,
        severity: "warning",
        message: `Very cold on ${day.dayName} ${day.date.slice(5)} (low ${day.lowTemp}\u00B0F)`,
        suggestion: "Dress in warm layers",
        affectedDates: [day.date],
      })
    }
    if (day.windMph >= 35) {
      alerts.push({
        id: `wind-${alertIdx++}`,
        severity: "warning",
        message: `High winds on ${day.dayName} ${day.date.slice(5)} (${day.windMph} mph)`,
        suggestion: "Avoid exposed areas and water activities",
        affectedDates: [day.date],
      })
    }
  }

  return alerts
}

function findNearestClearDay(
  targetDate: string,
  clearDates: string[],
): string | null {
  if (clearDates.length === 0) return null

  const target = new Date(targetDate).getTime()
  let nearest: string | null = null
  let minDist = Infinity

  for (const d of clearDates) {
    if (d === targetDate) continue // skip the same day
    const dist = Math.abs(new Date(d).getTime() - target)
    if (dist < minDist) {
      minDist = dist
      nearest = d
    }
  }

  return nearest
}
