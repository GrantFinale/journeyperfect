"use client"

import { useEffect, useRef, useState } from "react"

declare global {
  interface Window {
    google?: any
    __googleMapsCallback?: () => void
  }
}

interface PlacesAutocompleteProps {
  value: string
  onChange: (value: string) => void
  onSelect: (place: { name: string; lat?: number; lng?: number }) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  apiKey?: string
}

import { loadGoogleMaps } from "@/lib/google-maps-loader"

export default function PlacesAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder,
  className,
  disabled,
  apiKey: propApiKey,
}: PlacesAutocompleteProps) {
  const resolvedApiKey = propApiKey || process.env.NEXT_PUBLIC_GOOGLE_PLACES_KEY || ""
  const inputRef = useRef<HTMLInputElement>(null)
  const autocompleteRef = useRef<any>(null)
  const onSelectRef = useRef(onSelect)
  const onChangeRef = useRef(onChange)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  onSelectRef.current = onSelect
  onChangeRef.current = onChange

  useEffect(() => {
    if (disabled || failed) return
    // Don't try to load without a key
    if (!resolvedApiKey || resolvedApiKey === "build-placeholder") return

    // If already failed globally, don't retry
    // Check if previous load attempt failed
    if (failed) return

    loadGoogleMaps(resolvedApiKey)
      .then(() => {
        if (!inputRef.current || autocompleteRef.current) return

        try {
          const autocomplete = new window.google.maps.places.Autocomplete(inputRef.current, {
            types: ["(cities)"],
          })

          autocomplete.addListener("place_changed", () => {
            try {
              const place = autocomplete.getPlace()
              if (place?.geometry) {
                const name = place.formatted_address || place.name || ""
                onSelectRef.current({
                  name,
                  lat: place.geometry.location?.lat(),
                  lng: place.geometry.location?.lng(),
                })
                onChangeRef.current(name)
              }
            } catch {
              // Ignore errors from place_changed callback
            }
          })

          autocompleteRef.current = autocomplete
          setReady(true)
        } catch {
          setFailed(true)
        }
      })
      .catch(() => {
        setFailed(true)
      })

    return () => {
      if (autocompleteRef.current) {
        try {
          window.google?.maps?.event?.clearInstanceListeners(autocompleteRef.current)
        } catch {
          // Ignore cleanup errors
        }
        autocompleteRef.current = null
      }
    }
  }, [disabled, resolvedApiKey, failed])

  // Plain text input (disabled, no key, or API failed)
  if (disabled) {
    return (
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || "Type a city name..."}
          className={className}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full whitespace-nowrap">
          Upgrade for smart search
        </span>
      </div>
    )
  }

  if (failed || (!resolvedApiKey && !ready)) {
    return (
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          onSelect({ name: e.target.value })
        }}
        placeholder={placeholder || "Type a city name..."}
        className={className}
      />
    )
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder || "Search for a city..."}
      className={className}
    />
  )
}
