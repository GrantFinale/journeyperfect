"use client"

import { useEffect, useRef, useState, useCallback } from "react"

export interface MapMarker {
  lat: number
  lng: number
  label: string
  type: "activity" | "hotel" | "flight" | "restaurant" | "transit"
  day?: number
}

export interface HotelForDay {
  lat: number
  lng: number
  name: string
  checkInDay: number
  checkOutDay: number
}

export interface RouteSegment {
  from: string
  to: string
  duration: string
  distance: string
  travelMode: string
}

export interface DayRoute {
  day: number
  segments: RouteSegment[]
  totalDuration: string
}

interface TripMapProps {
  markers: MapMarker[]
  center?: { lat: number; lng: number }
  apiKey: string
  height?: string
  selectedDay?: number | null
  hotels?: HotelForDay[]
  onRoutesComputed?: (routes: DayRoute[]) => void
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

function formatDuration(seconds: number): string {
  if (seconds < 60) return "< 1 min"
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins} min`
  const hrs = Math.floor(mins / 60)
  const remainMins = mins % 60
  return remainMins > 0 ? `${hrs} hr ${remainMins} min` : `${hrs} hr`
}

function sumDurationSeconds(segments: RouteSegment[]): number {
  let total = 0
  for (const seg of segments) {
    // Parse "X min" or "X hr Y min" back to seconds
    const hrMatch = seg.duration.match(/(\d+)\s*hr/)
    const minMatch = seg.duration.match(/(\d+)\s*min/)
    if (hrMatch) total += parseInt(hrMatch[1]) * 3600
    if (minMatch) total += parseInt(minMatch[1]) * 60
  }
  return total
}

export function TripMap({
  markers,
  center,
  apiKey,
  height = "400px",
  selectedDay,
  hotels = [],
  onRoutesComputed,
}: TripMapProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<google.maps.Map | null>(null)
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([])
  const polylinesRef = useRef<google.maps.Polyline[]>([])
  const directionsRenderersRef = useRef<google.maps.DirectionsRenderer[]>([])
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [routeLoading, setRouteLoading] = useState(false)
  const routesCacheRef = useRef<Map<string, { routes: DayRoute[]; directions: Map<string, google.maps.DirectionsResult> }>>(new Map())

  // Load Google Maps script via shared loader
  useEffect(() => {
    if (!apiKey) {
      setError("Google Maps API key not configured")
      return
    }

    ;(window as any).gm_authFailure = () => {
      setError(
        "Google Maps authentication failed. Ensure the Maps JavaScript API is enabled and billing is active on your Google Cloud project."
      )
    }

    import("@/lib/google-maps-loader").then(({ loadGoogleMaps }) => {
      loadGoogleMaps(apiKey)
        .then(() => setLoaded(true))
        .catch((err) => setError(err.message || "Failed to load Google Maps"))
    })
  }, [apiKey])

  // Find the hotel for a given day index
  const getHotelForDay = useCallback(
    (day: number): HotelForDay | null => {
      return hotels.find((h) => day >= h.checkInDay && day < h.checkOutDay) || null
    },
    [hotels]
  )

  // Build ordered waypoints for a day: airport/hotel -> activities -> hotel/airport
  const buildDayWaypoints = useCallback(
    (day: number, visibleMarkers: MapMarker[]): { lat: number; lng: number; label: string }[] => {
      const hotel = getHotelForDay(day)
      const dayActivities = visibleMarkers.filter(
        (m) => m.day === day && m.type !== "hotel" && m.type !== "flight"
      )
      // Get airport markers for this day (arrival or departure)
      const dayFlights = visibleMarkers.filter(
        (m) => m.day === day && m.type === "flight"
      )

      // If no activities and no flights to route, skip
      if (dayActivities.length === 0 && dayFlights.length === 0) return []

      const waypoints: { lat: number; lng: number; label: string }[] = []

      // First day with flights: start from arrival airport
      // Last day with flights: end at departure airport
      const arrivalAirport = dayFlights.find(f => f.label.includes("arriving") || dayFlights.indexOf(f) === dayFlights.length - 1)
      const departureAirport = dayFlights.find(f => f.label.includes("departing") || dayFlights.indexOf(f) === 0)

      // Determine if this is an arrival day (has flights AND hotel check-in or activities after)
      const isArrivalDay = dayFlights.length > 0 && (dayActivities.length > 0 || hotel)
      // Determine if this is a departure day (has flights AND hotel/activities before)
      const isDepartureDay = dayFlights.length > 0 && (dayActivities.length > 0 || hotel)

      // For arrival days: airport -> hotel -> activities -> hotel
      // For departure days: hotel -> activities -> hotel -> airport
      // For days with both: airport -> hotel -> activities -> hotel -> airport

      if (isArrivalDay && dayFlights.length > 0) {
        // Start from the last flight's arrival airport (final destination)
        const lastFlight = dayFlights[dayFlights.length - 1]
        waypoints.push({ lat: lastFlight.lat, lng: lastFlight.lng, label: lastFlight.label })
      }

      // Hotel as next stop (or starting point if no arrival)
      if (hotel) {
        waypoints.push({ lat: hotel.lat, lng: hotel.lng, label: hotel.name })
      }

      // Add activities in order
      for (const act of dayActivities) {
        waypoints.push({ lat: act.lat, lng: act.lng, label: act.label })
      }

      // Return to hotel after activities
      if (hotel && dayActivities.length > 0) {
        waypoints.push({ lat: hotel.lat, lng: hotel.lng, label: hotel.name })
      }

      // For departure days: end at the first flight's departure airport
      if (isDepartureDay && dayFlights.length > 0 && dayActivities.length === 0) {
        // No activities — just hotel to airport
        const firstFlight = dayFlights[0]
        waypoints.push({ lat: firstFlight.lat, lng: firstFlight.lng, label: firstFlight.label })
      }

      // Deduplicate consecutive identical waypoints
      return waypoints.filter((w, i) => i === 0 || w.lat !== waypoints[i-1].lat || w.lng !== waypoints[i-1].lng)
    },
    [getHotelForDay]
  )

  // Request directions between two points
  const getDirections = useCallback(
    (
      origin: { lat: number; lng: number },
      destination: { lat: number; lng: number },
      waypoints?: google.maps.DirectionsWaypoint[]
    ): Promise<google.maps.DirectionsResult | null> => {
      return new Promise((resolve) => {
        try {
          const directionsService = new google.maps.DirectionsService()
          directionsService.route(
            {
              origin,
              destination,
              waypoints,
              travelMode: google.maps.TravelMode.DRIVING,
              optimizeWaypoints: false,
            },
            (result, status) => {
              if (status === google.maps.DirectionsStatus.OK && result) {
                resolve(result)
              } else {
                resolve(null)
              }
            }
          )
        } catch {
          resolve(null)
        }
      })
    },
    []
  )

  // Compute routes for visible days and render them
  const computeAndRenderRoutes = useCallback(
    async (map: google.maps.Map, visibleMarkers: MapMarker[], daysToRoute: number[]) => {
      setRouteLoading(true)

      try {
      // Clean up previous direction renderers
      directionsRenderersRef.current.forEach((r) => { try { r.setMap(null) } catch { /* ignore */ } })
      directionsRenderersRef.current = []

      let allDayRoutes: DayRoute[] = []
      const cacheKey = `${selectedDay ?? "all"}`

      // Check cache
      const cached = routesCacheRef.current.get(cacheKey)
      if (cached) {
        // Re-render cached directions
        try {
          cached.directions.forEach((result, key) => {
            const day = parseInt(key)
            const renderer = new google.maps.DirectionsRenderer({
              map,
              directions: result,
              suppressMarkers: true,
              polylineOptions: {
                strokeColor: getDayColor(day),
                strokeOpacity: 0.8,
                strokeWeight: 4,
              },
            })
            directionsRenderersRef.current.push(renderer)
          })
        } catch {
          // DirectionsRenderer may fail if map state changed
        }
        onRoutesComputed?.(cached.routes)
        setRouteLoading(false)
        return
      }

      const directionsCache = new Map<string, google.maps.DirectionsResult>()
      let directionsApiAvailable = true

      for (const day of daysToRoute) {
        const waypoints = buildDayWaypoints(day, visibleMarkers)
        if (waypoints.length < 2) continue

        const segments: RouteSegment[] = []

        if (directionsApiAvailable) {
          try {
            // Try Directions API: send as a single request with waypoints
            const origin = waypoints[0]
            const destination = waypoints[waypoints.length - 1]
            const intermediateWaypoints =
              waypoints.length > 2
                ? waypoints.slice(1, -1).map((wp) => ({
                    location: new google.maps.LatLng(wp.lat, wp.lng),
                    stopover: true,
                  }))
                : undefined

            const result = await getDirections(
              { lat: origin.lat, lng: origin.lng },
              { lat: destination.lat, lng: destination.lng },
              intermediateWaypoints
            )

            if (result && result.routes?.[0]?.legs) {
              // Render the route on the map
              const renderer = new google.maps.DirectionsRenderer({
                map,
                directions: result,
                suppressMarkers: true,
                polylineOptions: {
                  strokeColor: getDayColor(day),
                  strokeOpacity: 0.8,
                  strokeWeight: 4,
                },
              })
              directionsRenderersRef.current.push(renderer)
              directionsCache.set(String(day), result)

              // Extract segments from legs
              const legs = result.routes[0].legs
              for (let i = 0; i < legs.length; i++) {
                const leg = legs[i]
                segments.push({
                  from: waypoints[i]?.label || "Unknown",
                  to: waypoints[i + 1]?.label || "Unknown",
                  duration: formatDuration(leg.duration?.value || 0),
                  distance: leg.distance?.text || "",
                  travelMode: "drive",
                })
              }
            } else {
              // Directions API failed - fall back to straight lines for ALL days
              directionsApiAvailable = false
              // Clean up any renderers we already added
              directionsRenderersRef.current.forEach((r) => r.setMap(null))
              directionsRenderersRef.current = []
              // Clear partial results before restarting with fallback
              allDayRoutes = []
              break
            }
          } catch {
            // Directions API threw — fall back to straight lines
            directionsApiAvailable = false
            directionsRenderersRef.current.forEach((r) => r.setMap(null))
            directionsRenderersRef.current = []
            allDayRoutes = []
            break
          }
        }

        if (segments.length > 0) {
          const totalSeconds = sumDurationSeconds(segments)
          allDayRoutes.push({
            day,
            segments,
            totalDuration: formatDuration(totalSeconds),
          })
        }
      }

      // If Directions API wasn't available, draw straight-line polylines as fallback
      if (!directionsApiAvailable) {
        // Clean existing polylines too
        polylinesRef.current.forEach((p) => p.setMap(null))
        polylinesRef.current = []

        for (const day of daysToRoute) {
          const waypoints = buildDayWaypoints(day, visibleMarkers)
          if (waypoints.length < 2) continue

          try {
            const path = waypoints.map((wp) => ({ lat: wp.lat, lng: wp.lng }))
            const polyline = new google.maps.Polyline({
              path,
              geodesic: true,
              strokeColor: getDayColor(day),
              strokeOpacity: 0.7,
              strokeWeight: 3,
              icons: [
                {
                  icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 3 },
                  offset: "50%",
                },
              ],
              map,
            })
            polylinesRef.current.push(polyline)
          } catch {
            // Polyline creation failed, skip this day's route line
          }

          // Estimate straight-line distances for fallback route panel
          const segments: RouteSegment[] = []
          for (let i = 0; i < waypoints.length - 1; i++) {
            const from = waypoints[i]
            const to = waypoints[i + 1]
            const dist = haversineDistance(from.lat, from.lng, to.lat, to.lng)
            // Rough estimate: 30 km/h average speed for driving
            const durationSec = (dist / 1000 / 30) * 3600
            segments.push({
              from: from.label,
              to: to.label,
              duration: formatDuration(durationSec),
              distance: dist > 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`,
              travelMode: "estimate",
            })
          }
          if (segments.length > 0) {
            const totalSeconds = sumDurationSeconds(segments)
            allDayRoutes.push({
              day,
              segments,
              totalDuration: formatDuration(totalSeconds),
            })
          }
        }
      }

      // Cache and report
      routesCacheRef.current.set(cacheKey, { routes: allDayRoutes, directions: directionsCache })
      onRoutesComputed?.(allDayRoutes)
      } catch (err) {
        console.error("[TripMap] Route computation error:", err)
        onRoutesComputed?.([])
      } finally {
        setRouteLoading(false)
      }
    },
    [buildDayWaypoints, getDirections, onRoutesComputed, selectedDay]
  )

  const renderMap = useCallback(() => {
    if (!loaded || !mapRef.current) return

    try {
      // Filter markers by selected day
      const visibleMarkers =
        selectedDay != null
          ? markers.filter((m) => m.day === selectedDay || m.type === "hotel")
          : markers

      // Clean up previous markers, polylines, and direction renderers
      markersRef.current.forEach((m) => { try { m.map = null } catch { /* ignore */ } })
      markersRef.current = []
      polylinesRef.current.forEach((p) => { try { p.setMap(null) } catch { /* ignore */ } })
      polylinesRef.current = []
      directionsRenderersRef.current.forEach((r) => { try { r.setMap(null) } catch { /* ignore */ } })
      directionsRenderersRef.current = []

      if (visibleMarkers.length === 0) {
        onRoutesComputed?.([])
        return
      }

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

      visibleMarkers.forEach((marker) => {
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
      })

      // Fit bounds
      if (visibleMarkers.length > 1) {
        map.fitBounds(bounds, { top: 40, bottom: 40, left: 40, right: 40 })
      } else if (visibleMarkers.length === 1) {
        map.setCenter({ lat: visibleMarkers[0].lat, lng: visibleMarkers[0].lng })
        map.setZoom(14)
      }

      // Compute routes — only for days that have activities (not just hotels/flights)
      const daysToRoute =
        selectedDay != null
          ? [selectedDay]
          : [...new Set(markers.filter((m) => m.day != null).map((m) => m.day!))].sort(
              (a, b) => a - b
            )

      // Filter to only days that actually have routable activities
      const routableDays = daysToRoute.filter((day) => {
        const dayActivities = (selectedDay != null ? visibleMarkers : markers).filter(
          (m) => m.day === day && m.type !== "hotel" && m.type !== "flight"
        )
        return dayActivities.length > 0
      })

      if (routableDays.length > 0) {
        computeAndRenderRoutes(map, selectedDay != null ? visibleMarkers : markers, routableDays)
      } else {
        onRoutesComputed?.([])
      }
    } catch (err) {
      console.error("[TripMap] renderMap error:", err)
      setError("Failed to render map. Please try refreshing the page.")
    }
  }, [loaded, markers, center, selectedDay, computeAndRenderRoutes, onRoutesComputed])

  useEffect(() => {
    renderMap()
  }, [renderMap])

  // Determine unique days for legend
  const uniqueDays = [
    ...new Set(markers.filter((m) => m.day != null).map((m) => m.day!)),
  ].sort((a, b) => a - b)

  if (error) {
    return (
      <div
        className="flex flex-col items-center justify-center bg-gray-50 border border-gray-200 rounded-2xl text-sm text-gray-500 px-6 text-center gap-2"
        style={{ height }}
      >
        <svg
          className="w-8 h-8 text-gray-300"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
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
      {routeLoading && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-sm text-xs text-gray-600 px-3 py-1.5 rounded-full shadow-sm border border-gray-200 flex items-center gap-2">
          <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Computing routes...
        </div>
      )}
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

// Haversine distance fallback when geometry library isn't loaded
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000 // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
