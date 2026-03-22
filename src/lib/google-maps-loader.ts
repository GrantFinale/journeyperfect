/**
 * Shared Google Maps loader — ensures the script is loaded exactly once
 * with all required libraries.
 */

let loadPromise: Promise<void> | null = null
let loaded = false
let loadFailed = false

const LIBRARIES = "places,marker"

export function isGoogleMapsLoaded(): boolean {
  return loaded && !!window.google?.maps?.Map
}

export function loadGoogleMaps(apiKey: string): Promise<void> {
  if (loaded && window.google?.maps?.Map) return Promise.resolve()
  if (loadFailed) return Promise.reject(new Error("Google Maps failed to load"))
  if (loadPromise) return loadPromise

  if (!apiKey || apiKey === "build-placeholder") {
    loadFailed = true
    return Promise.reject(new Error("No API key"))
  }

  // If script already exists (from another component), wait for it
  const existing = document.querySelector('script[src*="maps.googleapis.com"]')
  if (existing) {
    loadPromise = new Promise((resolve, reject) => {
      if (window.google?.maps?.Map) {
        loaded = true
        resolve()
        return
      }
      let elapsed = 0
      const check = setInterval(() => {
        elapsed += 100
        if (window.google?.maps?.Map) {
          clearInterval(check)
          loaded = true
          resolve()
        } else if (elapsed > 15000) {
          clearInterval(check)
          loadFailed = true
          reject(new Error("Timeout waiting for Google Maps"))
        }
      }, 100)
    })
    return loadPromise
  }

  loadPromise = new Promise((resolve, reject) => {
    ;(window as any).__googleMapsCallback = () => {
      loaded = true
      resolve()
    }
    const script = document.createElement("script")
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=${LIBRARIES}&callback=__googleMapsCallback`
    script.async = true
    script.defer = true
    script.onerror = () => {
      loadFailed = true
      loadPromise = null
      reject(new Error("Failed to load Google Maps script"))
    }
    document.head.appendChild(script)
  })

  return loadPromise
}
