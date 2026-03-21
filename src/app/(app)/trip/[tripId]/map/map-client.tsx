"use client"

import { useState, useCallback } from "react"
import { TripMap, type MapMarker, type HotelForDay, type DayRoute } from "@/components/trip-map"
import { MapPin, Filter, Navigation, Clock, ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"

interface TripMapClientProps {
  markers: MapMarker[]
  center?: { lat: number; lng: number }
  apiKey: string
  totalDays: number
  tripTitle: string
  hotels?: HotelForDay[]
}

const DAY_COLORS = [
  "#4F46E5", "#7C3AED", "#2563EB", "#0891B2", "#059669", "#D97706",
  "#DC2626", "#DB2777", "#9333EA", "#EA580C", "#16A34A", "#0284C7",
]

function getDayColor(day: number): string {
  return DAY_COLORS[day % DAY_COLORS.length]
}

export function TripMapClient({
  markers,
  center,
  apiKey,
  totalDays,
  tripTitle,
  hotels = [],
}: TripMapClientProps) {
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  const [routes, setRoutes] = useState<DayRoute[]>([])
  const [expandedDays, setExpandedDays] = useState<Set<number>>(new Set())

  const handleRoutesComputed = useCallback((newRoutes: DayRoute[]) => {
    setRoutes(newRoutes)
    // Auto-expand if only one day selected
    if (newRoutes.length === 1) {
      setExpandedDays(new Set([newRoutes[0].day]))
    }
  }, [])

  const toggleDay = (day: number) => {
    setExpandedDays((prev) => {
      const next = new Set(prev)
      if (next.has(day)) {
        next.delete(day)
      } else {
        next.add(day)
      }
      return next
    })
  }

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
        <>
          <TripMap
            markers={markers}
            center={center}
            apiKey={apiKey}
            height="calc(100vh - 280px)"
            selectedDay={selectedDay}
            hotels={hotels}
            onRoutesComputed={handleRoutesComputed}
          />

          {/* Route Summary Panel */}
          {routes.length > 0 && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                <Navigation className="w-4 h-4" />
                Route Summary
              </div>
              {routes.map((route) => (
                <div
                  key={route.day}
                  className="bg-white border border-gray-200 rounded-xl overflow-hidden"
                >
                  <button
                    onClick={() => toggleDay(route.day)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: getDayColor(route.day) }}
                      />
                      <span className="text-sm font-medium text-gray-900">
                        Day {route.day + 1}
                      </span>
                      <span className="text-xs text-gray-500">
                        {route.segments.length} {route.segments.length === 1 ? "leg" : "legs"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1 text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                        <Clock className="w-3 h-3" />
                        {route.totalDuration}
                        {route.segments[0]?.travelMode === "estimate" && (
                          <span className="text-gray-400">(est.)</span>
                        )}
                      </div>
                      {expandedDays.has(route.day) ? (
                        <ChevronUp className="w-4 h-4 text-gray-400" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-gray-400" />
                      )}
                    </div>
                  </button>

                  {expandedDays.has(route.day) && (
                    <div className="px-4 pb-3 border-t border-gray-100">
                      <div className="pt-3 space-y-0">
                        {route.segments.map((seg, i) => (
                          <div key={i} className="flex items-start gap-3 pb-3 last:pb-0">
                            {/* Vertical timeline connector */}
                            <div className="flex flex-col items-center pt-1">
                              <div
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: getDayColor(route.day) }}
                              />
                              {i < route.segments.length - 1 && (
                                <div
                                  className="w-0.5 flex-1 mt-1 min-h-[20px]"
                                  style={{ backgroundColor: getDayColor(route.day), opacity: 0.3 }}
                                />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-baseline justify-between gap-2">
                                <div className="text-sm text-gray-700 truncate">
                                  <span className="font-medium">{seg.from}</span>
                                  <span className="text-gray-400 mx-1.5">&rarr;</span>
                                  <span className="font-medium">{seg.to}</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500">
                                <span>{seg.duration}</span>
                                {seg.distance && (
                                  <>
                                    <span className="text-gray-300">&middot;</span>
                                    <span>{seg.distance}</span>
                                  </>
                                )}
                                <span className="text-gray-300">&middot;</span>
                                <span className="capitalize">
                                  {seg.travelMode === "estimate" ? "Estimated" : "Driving"}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
