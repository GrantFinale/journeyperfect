"use client"

import { TripMap, type MapMarker } from "@/components/trip-map"

interface TripOverviewMapProps {
  markers: MapMarker[]
  apiKey: string
  center?: { lat: number; lng: number }
}

export function TripOverviewMap({ markers, apiKey, center }: TripOverviewMapProps) {
  return <TripMap markers={markers} apiKey={apiKey} center={center} height="250px" />
}
