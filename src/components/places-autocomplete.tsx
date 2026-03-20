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
}

function loadGoogleMaps(): Promise<void> {
  if (window.google?.maps?.places) return Promise.resolve()

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PLACES_KEY
  if (!apiKey || apiKey === "build-placeholder") {
    return Promise.reject(new Error("Google Places API key not available"))
  }

  return new Promise((resolve, reject) => {
    if (document.querySelector('script[src*="maps.googleapis.com"]')) {
      // Script already loading, wait for it with a timeout
      let elapsed = 0
      const check = setInterval(() => {
        elapsed += 100
        if (window.google?.maps?.places) {
          clearInterval(check)
          resolve()
        } else if (elapsed > 10000) {
          clearInterval(check)
          reject(new Error("Google Maps script load timeout"))
        }
      }, 100)
      return
    }

    window.__googleMapsCallback = () => resolve()
    const script = document.createElement("script")
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&callback=__googleMapsCallback`
    script.async = true
    script.onerror = () => reject(new Error("Failed to load Google Maps script"))
    document.head.appendChild(script)
  })
}

export default function PlacesAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder,
  className,
  disabled,
}: PlacesAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const autocompleteRef = useRef<any>(null)
  const onSelectRef = useRef(onSelect)
  const onChangeRef = useRef(onChange)
  const [apiFailed, setApiFailed] = useState(false)

  // Keep refs up to date so the listener closure always uses the latest callbacks
  onSelectRef.current = onSelect
  onChangeRef.current = onChange

  useEffect(() => {
    if (disabled || apiFailed) return

    loadGoogleMaps()
      .then(() => {
        if (!inputRef.current || autocompleteRef.current) return

        const autocomplete = new window.google.maps.places.Autocomplete(inputRef.current, {
          types: ["(cities)"],
        })

        autocomplete.addListener("place_changed", () => {
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
        })

        autocompleteRef.current = autocomplete
      })
      .catch(() => {
        // Google Maps failed to load — fall back to plain text input
        setApiFailed(true)
      })

    return () => {
      if (autocompleteRef.current) {
        window.google?.maps?.event?.clearInstanceListeners(autocompleteRef.current)
      }
    }
  }, [disabled, apiFailed])

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

  // If API failed to load, render a plain text input (no ref needed for autocomplete)
  if (apiFailed) {
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
