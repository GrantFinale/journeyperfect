"use client"

import { useState } from "react"
import { TripMap, type MapMarker } from "@/components/trip-map"
import { MapPin, Filter } from "lucide-react"
import { cn } from "@/lib/utils"

interface TripMapClientProps {
  markers: MapMarker[]
  center?: { lat: number; lng: number }
  apiKey: string
  totalDays: number
  tripTitle: string
}

export function TripMapClient({ markers, center, apiKey, totalDays, tripTitle }: TripMapClientProps) {
  const [selectedDay, setSelectedDay] = useState<number | null>(null)

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Trip Map</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {markers.length} locations across {tripTitle}
          </p>
        </div>
      </div>

      {/* Day filter */}
      <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-2">
        <Filter className="w-4 h-4 text-gray-400 shrink-0" />
        <button
          onClick={() => setSelectedDay(null)}
          className={cn(
            "px-3 py-1.5 rounded-full text-xs font-medium transition-colors shrink-0",
            selectedDay === null
              ? "bg-indigo-600 text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          )}
        >
          All Days
        </button>
        {Array.from({ length: totalDays }, (_, i) => (
          <button
            key={i}
            onClick={() => setSelectedDay(selectedDay === i ? null : i)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium transition-colors shrink-0",
              selectedDay === i
                ? "bg-indigo-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            )}
          >
            Day {i + 1}
          </button>
        ))}
      </div>

      {markers.length === 0 ? (
        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-12 text-center">
          <MapPin className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">
            No locations with coordinates yet. Add activities with addresses to see them on the map.
          </p>
        </div>
      ) : (
        <TripMap
          markers={markers}
          center={center}
          apiKey={apiKey}
          height="calc(100vh - 280px)"
          selectedDay={selectedDay}
        />
      )}
    </div>
  )
}
