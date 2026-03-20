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

let googleMapsLoadPromise: Promise<void> | null = null
let googleMapsLoaded = false
let googleMapsLoadFailed = false

function loadGoogleMaps(apiKey: string): Promise<void> {
  if (googleMapsLoaded && window.google?.maps?.places) return Promise.resolve()
  if (googleMapsLoadFailed) return Promise.reject(new Error("Previously failed"))
  if (googleMapsLoadPromise) return googleMapsLoadPromise

  if (!apiKey || apiKey === "build-placeholder") {
    googleMapsLoadFailed = true
    return Promise.reject(new Error("No API key"))
  }

  googleMapsLoadPromise = new Promise((resolve, reject) => {
    // Check if script already exists (maybe loaded by another component)
    if (document.querySelector('script[src*="maps.googleapis.com"]')) {
      let elapsed = 0
      const check = setInterval(() => {
        elapsed += 100
        if (window.google?.maps?.places) {
          clearInterval(check)
          googleMapsLoaded = true
          resolve()
        } else if (elapsed > 10000) {
          clearInterval(check)
          googleMapsLoadFailed = true
          reject(new Error("Timeout"))
        }
      }, 100)
      return
    }

    window.__googleMapsCallback = () => {
      googleMapsLoaded = true
      resolve()
    }
    const script = document.createElement("script")
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&callback=__googleMapsCallback`
    script.async = true
    script.onerror = () => {
      googleMapsLoadFailed = true
      googleMapsLoadPromise = null
      reject(new Error("Script load failed"))
    }
    document.head.appendChild(script)
  })

  return googleMapsLoadPromise
}

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
    if (googleMapsLoadFailed) {
      setFailed(true)
      return
    }

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
