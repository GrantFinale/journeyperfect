"use client"

import { ExternalLink } from "lucide-react"

// Haversine distance in kilometers
function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371 // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

const WALKING_SPEED_KMH = 5
const DRIVING_SPEED_KMH = 30
const MAX_WALK_MINS = 20

export type TravelInfo = {
  distanceKm: number
  walkMins: number
  driveMins: number
  mode: "walk" | "drive"
  travelMins: number
}

export function calculateTravel(
  fromLat: number | null | undefined,
  fromLng: number | null | undefined,
  toLat: number | null | undefined,
  toLng: number | null | undefined,
  maxWalkMins: number = MAX_WALK_MINS
): TravelInfo | null {
  if (fromLat == null || fromLng == null || toLat == null || toLng == null)
    return null

  const dist = haversineDistance(fromLat, fromLng, toLat, toLng)
  const walkMins = Math.round((dist / WALKING_SPEED_KMH) * 60)
  const driveMins = Math.max(Math.round((dist / DRIVING_SPEED_KMH) * 60), 1)
  const mode = walkMins <= maxWalkMins ? ("walk" as const) : ("drive" as const)
  const travelMins = mode === "walk" ? walkMins : driveMins

  return { distanceKm: dist, walkMins, driveMins, mode, travelMins }
}

function formatTravelDuration(mins: number): string {
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function buildMapsUrl(
  fromLat: number | null | undefined,
  fromLng: number | null | undefined,
  toLat: number | null | undefined,
  toLng: number | null | undefined,
  fromName: string,
  toName: string,
  mode: "walk" | "drive"
): string | null {
  const travelMode = mode === "walk" ? "walking" : "driving"
  if (fromLat && fromLng && toLat && toLng) {
    return `https://www.google.com/maps/dir/?api=1&origin=${fromLat},${fromLng}&destination=${toLat},${toLng}&travelmode=${travelMode}`
  }
  if (fromName && toName) {
    return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(fromName)}&destination=${encodeURIComponent(toName)}&travelmode=${travelMode}`
  }
  return null
}

interface TravelConnectorProps {
  fromLat?: number | null
  fromLng?: number | null
  toLat?: number | null
  toLng?: number | null
  fromName: string
  toName: string
  label?: string
  maxWalkMins?: number
}

export function TravelConnector({
  fromLat,
  fromLng,
  toLat,
  toLng,
  fromName,
  toName,
  label,
  maxWalkMins = MAX_WALK_MINS,
}: TravelConnectorProps) {
  const travel = calculateTravel(fromLat, fromLng, toLat, toLng, maxWalkMins)
  if (!travel) return null
  // Skip very short distances
  if (travel.distanceKm < 0.05) return null

  const mapsUrl = buildMapsUrl(fromLat, fromLng, toLat, toLng, fromName, toName, travel.mode)
  const modeIcon = travel.mode === "walk" ? "🚶" : "🚗"
  const text = label || `${formatTravelDuration(travel.travelMins)} ${travel.mode === "walk" ? "walk" : "drive"}`

  const inner = (
    <div className="flex items-center gap-2 py-1.5">
      {/* Vertical connector line */}
      <div className="w-5" />
      <div className="flex flex-col items-center">
        <div className="w-0.5 h-3 bg-gray-200" />
        <div className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center text-xs">
          {modeIcon}
        </div>
        <div className="w-0.5 h-3 bg-gray-200" />
      </div>
      <span className="text-[11px] text-gray-400 group-hover/travel:text-indigo-600">
        {text}
      </span>
      {mapsUrl && (
        <ExternalLink className="w-2.5 h-2.5 text-gray-300 group-hover/travel:text-indigo-400" />
      )}
    </div>
  )

  if (mapsUrl) {
    return (
      <a
        href={mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="group/travel hover:bg-indigo-50 rounded-lg transition-colors block"
      >
        {inner}
      </a>
    )
  }

  return inner
}
