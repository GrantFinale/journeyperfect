"use client"

import { ChevronDown } from "lucide-react"

type LocationOption = { label: string; value: string; lat?: number | null; lng?: number | null }

interface DiscoverHeaderProps {
  locationOptions: LocationOption[]
  selectedLocation: string
  onLocationChange: (value: string) => void
  customLocation: string
  onCustomLocationChange: (value: string) => void
}

export function DiscoverHeader({
  locationOptions,
  selectedLocation,
  onLocationChange,
  customLocation,
  onCustomLocationChange,
}: DiscoverHeaderProps) {
  // Get display name for current location
  const currentLabel = locationOptions.find((o) => o.value === selectedLocation)?.label || selectedLocation

  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900">Discover in</h1>
        <div className="relative inline-block">
          <select
            value={selectedLocation}
            onChange={(e) => onLocationChange(e.target.value)}
            className="appearance-none pl-3 pr-8 py-1.5 border border-gray-200 rounded-xl text-lg font-bold bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900 cursor-pointer hover:border-gray-300 transition-colors"
          >
            {locationOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        </div>
      </div>
      {selectedLocation === "__other__" && (
        <input
          type="text"
          placeholder="Enter a city or area..."
          value={customLocation}
          onChange={(e) => onCustomLocationChange(e.target.value)}
          className="mt-2 w-full sm:w-72 pl-3 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      )}
      <p className="text-gray-500 text-sm mt-1">
        Find restaurants, tours, shops, and local favorites.
      </p>
    </div>
  )
}
