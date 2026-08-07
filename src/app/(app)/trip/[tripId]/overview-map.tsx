"use client"

import { TripMap, type MapMarker, type TransportLeg } from "@/components/trip-map"

interface TripOverviewMapProps {
  markers: MapMarker[]
  apiKey: string
  center?: { lat: number; lng: number }
  transportLegs?: TransportLeg[]
}

export function TripOverviewMap({ markers, apiKey, center, transportLegs }: TripOverviewMapProps) {
  return <TripMap markers={markers} apiKey={apiKey} center={center} transportLegs={transportLegs} height="250px" />
}
