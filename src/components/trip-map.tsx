"use client"

import { useEffect, useRef, useState, useCallback } from "react"

export interface MapMarker {
  lat: number
  lng: number
  label: string
  type: "activity" | "hotel" | "flight" | "restaurant" | "transit"
  day?: number
}

interface TripMapProps {
  markers: MapMarker[]
  center?: { lat: number; lng: number }
  apiKey: string
  height?: string
  selectedDay?: number | null
}

const DAY_COLORS = [
  "#4F46E5", // indigo
  "#7C3AED", // violet
  "#2563EB", // blue
  "#0891B2", // cyan
  "#059669", // emerald
  "#D97706", // amber
  "#DC2626", // red
  "#DB2777", // pink
  "#9333EA", // purple
  "#EA580C", // orange
  "#16A34A", // green
  "#0284C7", // sky
]

function getDayColor(day: number): string {
  return DAY_COLORS[day % DAY_COLORS.length]
}

export function TripMap({ markers, center, apiKey, height = "400px", selectedDay }: TripMapProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<google.maps.Map | null>(null)
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([])
  const polylinesRef = useRef<google.maps.Polyline[]>([])
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load Google Maps script
  useEffect(() => {
    if (!apiKey) {
      setError("Google Maps API key not configured")
      return
    }

    // Register global auth failure callback — Google Maps calls this when the API key
    // is invalid, billing is not enabled, or Maps JavaScript API is not turned on.
    ;(window as any).gm_authFailure = () => {
      setError(
        "Google Maps authentication failed. Ensure the Maps JavaScript API is enabled and billing is active on your Google Cloud project."
      )
    }

    if (window.google?.maps?.Map) {
      setLoaded(true)
      return
    }

    const existing = document.querySelector('script[src*="maps.googleapis.com"]')
    if (existing) {
      existing.addEventListener("load", () => setLoaded(true))
      return
    }

    const script = document.createElement("script")
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=marker&loading=async`
    script.async = true
    script.defer = true
    script.onload = () => setLoaded(true)
    script.onerror = () => setError("Failed to load Google Maps. The Maps JavaScript API may not be enabled or billing may not be set up on the Google Cloud project.")
    document.head.appendChild(script)
  }, [apiKey])

  const renderMap = useCallback(() => {
    if (!loaded || !mapRef.current) return

    // Filter markers by selected day
    const visibleMarkers = selectedDay != null
      ? markers.filter((m) => m.day === selectedDay || m.type === "hotel")
      : markers

    // Clean up previous markers and polylines
    markersRef.current.forEach((m) => (m.map = null))
    markersRef.current = []
    polylinesRef.current.forEach((p) => p.setMap(null))
    polylinesRef.current = []

    if (visibleMarkers.length === 0) return

    // Create or reuse map
    if (!mapInstanceRef.current) {
      mapInstanceRef.current = new google.maps.Map(mapRef.current, {
        center: center || { lat: visibleMarkers[0].lat, lng: visibleMarkers[0].lng },
        zoom: 13,
        mapId: "trip-map",
        disableDefaultUI: false,
        zoomControl: true,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
      })
    }

    const map = mapInstanceRef.current
    const infoWindow = infoWindowRef.current || new google.maps.InfoWindow()
    infoWindowRef.current = infoWindow

    const bounds = new google.maps.LatLngBounds()

    // Group markers by day for polylines
    const dayGroups = new Map<number, { lat: number; lng: number }[]>()

    visibleMarkers.forEach((marker, idx) => {
      const position = { lat: marker.lat, lng: marker.lng }
      bounds.extend(position)

      // Create marker element
      const markerEl = document.createElement("div")
      markerEl.style.display = "flex"
      markerEl.style.alignItems = "center"
      markerEl.style.justifyContent = "center"
      markerEl.style.fontWeight = "700"
      markerEl.style.fontSize = "11px"
      markerEl.style.borderRadius = marker.type === "hotel" ? "6px" : "50%"
      markerEl.style.border = "2px solid white"
      markerEl.style.boxShadow = "0 2px 6px rgba(0,0,0,0.3)"
      markerEl.style.cursor = "pointer"

      if (marker.type === "hotel") {
        markerEl.style.width = "28px"
        markerEl.style.height = "28px"
        markerEl.style.backgroundColor = "#7C3AED"
        markerEl.style.color = "white"
        markerEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 21V7a2 2 0 012-2h14a2 2 0 012 2v14"/><path d="M3 11h18"/><rect x="7" y="11" width="4" height="6"/><rect x="13" y="11" width="4" height="6"/></svg>`
      } else if (marker.type === "flight") {
        markerEl.style.width = "28px"
        markerEl.style.height = "28px"
        markerEl.style.backgroundColor = "#2563EB"
        markerEl.style.color = "white"
        markerEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>`
      } else {
        const color = marker.day != null ? getDayColor(marker.day) : "#4F46E5"
        markerEl.style.width = "26px"
        markerEl.style.height = "26px"
        markerEl.style.backgroundColor = color
        markerEl.style.color = "white"
        // Number the activities per day
        const dayActivities = visibleMarkers.filter(
          (m) => m.day === marker.day && m.type !== "hotel" && m.type !== "flight"
        )
        const actIdx = dayActivities.indexOf(marker)
        markerEl.textContent = String(actIdx + 1)
      }

      try {
        const advancedMarker = new google.maps.marker.AdvancedMarkerElement({
          map,
          position,
          content: markerEl,
          title: marker.label,
        })

        advancedMarker.addListener("click", () => {
          const dayLabel = marker.day != null ? `Day ${marker.day + 1}` : ""
          const typeLabel = marker.type.charAt(0).toUpperCase() + marker.type.slice(1)
          infoWindow.setContent(
            `<div style="padding:4px 8px;max-width:200px">` +
              `<div style="font-weight:600;font-size:13px">${marker.label}</div>` +
              `<div style="font-size:11px;color:#666;margin-top:2px">${typeLabel}${dayLabel ? ` &middot; ${dayLabel}` : ""}</div>` +
              `</div>`
          )
          infoWindow.open({ anchor: advancedMarker, map })
        })

        markersRef.current.push(advancedMarker)
      } catch {
        // Fallback: AdvancedMarkerElement not available, skip
      }

      // Group by day for route lines
      if (marker.day != null && marker.type !== "hotel") {
        if (!dayGroups.has(marker.day)) dayGroups.set(marker.day, [])
        dayGroups.get(marker.day)!.push(position)
      }
    })

    // Draw polylines per day
    dayGroups.forEach((points, day) => {
      if (points.length < 2) return
      const polyline = new google.maps.Polyline({
        path: points,
        geodesic: true,
        strokeColor: getDayColor(day),
        strokeOpacity: 0.7,
        strokeWeight: 3,
        map,
      })
      polylinesRef.current.push(polyline)
    })

    // Fit bounds
    if (visibleMarkers.length > 1) {
      map.fitBounds(bounds, { top: 40, bottom: 40, left: 40, right: 40 })
    } else if (visibleMarkers.length === 1) {
      map.setCenter({ lat: visibleMarkers[0].lat, lng: visibleMarkers[0].lng })
      map.setZoom(14)
    }
  }, [loaded, markers, center, selectedDay])

  useEffect(() => {
    renderMap()
  }, [renderMap])

  // Determine unique days for legend
  const uniqueDays = [...new Set(markers.filter((m) => m.day != null).map((m) => m.day!))]
    .sort((a, b) => a - b)

  if (error) {
    return (
      <div
        className="flex flex-col items-center justify-center bg-gray-50 border border-gray-200 rounded-2xl text-sm text-gray-500 px-6 text-center gap-2"
        style={{ height }}
      >
        <svg className="w-8 h-8 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
        <span className="font-medium text-gray-600">Map unavailable</span>
        <span className="text-xs text-gray-400 max-w-sm">{error}</span>
      </div>
    )
  }

  return (
    <div className="relative">
      <div ref={mapRef} className="rounded-2xl overflow-hidden" style={{ height, width: "100%" }} />
      {/* Day color legend */}
      {uniqueDays.length > 1 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {uniqueDays.map((day) => (
            <div key={day} className="flex items-center gap-1.5 text-xs text-gray-600">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: getDayColor(day) }}
              />
              Day {day + 1}
            </div>
          ))}
          <div className="flex items-center gap-1.5 text-xs text-gray-600">
            <div className="w-3 h-3 rounded bg-purple-600" />
            Hotel
          </div>
        </div>
      )}
    </div>
  )
}
