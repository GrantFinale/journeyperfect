"use client"

import { ExternalLink } from "lucide-react"
import { haversineDistance } from "@/lib/haversine"
import {
  estimateTravelMins,
  formatDurationMins,
  travelModeIcon,
  formatTravelMode,
  WALKING_SPEED_KMH,
  DRIVING_SPEED_KMH,
  MAX_WALK_MINS,
  type TravelMode,
} from "@/lib/departure-planner"

// Speed math lives in @/lib/departure-planner so the timeline's "leave by"
// engine and this connector can never disagree.
export type { TravelMode }

export type TravelInfo = {
  distanceKm: number
  walkMins: number
  driveMins: number
  mode: TravelMode
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
  const mode: TravelMode = walkMins <= maxWalkMins ? "walk" : "drive"
  const travelMins = mode === "walk" ? walkMins : estimateTravelMins(dist, mode)

  return { distanceKm: dist, walkMins, driveMins, mode, travelMins }
}

function buildMapsUrl(
  fromLat: number | null | undefined,
  fromLng: number | null | undefined,
  toLat: number | null | undefined,
  toLng: number | null | undefined,
  fromName: string,
  toName: string,
  mode: TravelMode
): string | null {
  const travelMode =
    mode === "walk" ? "walking" : mode === "transit" ? "transit" : "driving"
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
  const modeIcon = travelModeIcon(travel.mode)
  const text = label || `${formatDurationMins(travel.travelMins)} ${formatTravelMode(travel.mode)}`

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
