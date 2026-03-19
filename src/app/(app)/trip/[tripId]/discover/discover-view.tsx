"use client"

import { useState } from "react"
import { toast } from "sonner"
import { searchPlaces, createActivity } from "@/lib/actions/activities"
import { cn } from "@/lib/utils"
import { Compass, Search, Star, MapPin, Clock, Plus, Loader2 } from "lucide-react"

const CATEGORIES = [
  { label: "All", value: "" },
  { label: "Family-friendly", value: "family friendly" },
  { label: "Outdoors", value: "outdoor nature park" },
  { label: "Museums", value: "museum" },
  { label: "Food & Markets", value: "market food hall" },
  { label: "Historical", value: "historical landmark monument" },
  { label: "Entertainment", value: "entertainment show performance" },
  { label: "Free", value: "free admission" },
  { label: "Shopping", value: "shopping district mall" },
  { label: "Beaches", value: "beach waterfront" },
  { label: "Adventure", value: "adventure sports outdoor activity" },
  { label: "Art", value: "art gallery" },
]

type Place = {
  googlePlaceId: string
  name: string
  address: string
  lat?: number
  lng?: number
  rating?: number
  imageUrl?: string | null
  types: string[]
}

interface Props {
  tripId: string
  destination: string
}

export function DiscoverView({ tripId, destination }: Props) {
  const [activeCategory, setActiveCategory] = useState("")
  const [customQuery, setCustomQuery] = useState("")
  const [results, setResults] = useState<Place[]>([])
  const [loading, setLoading] = useState(false)
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())

  async function handleSearch(query: string) {
    const searchQuery = (query + " " + destination).trim()
    setLoading(true)
    try {
      const result = await searchPlaces(searchQuery)
      setResults(result.results)
      if (result.error && result.results.length === 0) {
        toast.error(result.error || "No results found")
      }
    } catch {
      toast.error("Search failed")
    } finally {
      setLoading(false)
    }
  }

  function handleCategorySelect(cat: (typeof CATEGORIES)[0]) {
    setActiveCategory(cat.value)
    if (cat.value !== "") {
      handleSearch(cat.value)
    } else {
      setResults([])
    }
  }

  async function handleSave(place: Place) {
    if (savedIds.has(place.googlePlaceId)) return
    try {
      await createActivity(tripId, {
        name: place.name,
        address: place.address,
        lat: place.lat,
        lng: place.lng,
        googlePlaceId: place.googlePlaceId,
        rating: place.rating,
        imageUrl: place.imageUrl || undefined,
        priority: "MEDIUM",
        durationMins: 120,
        costPerAdult: 0,
        costPerChild: 0,
        category: place.types[0] || undefined,
        indoorOutdoor: "BOTH",
        reservationNeeded: false,
        isFixed: false,
      })
      setSavedIds((prev) => new Set([...prev, place.googlePlaceId]))
      toast.success(`${place.name} added to wishlist!`)
    } catch {
      toast.error("Failed to save activity")
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Discover</h1>
        <p className="text-gray-500 text-sm mt-0.5">Find things to do in {destination}</p>
      </div>

      {/* Search bar */}
      <div className="flex gap-2 mb-5">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder={`Search in ${destination}...`}
            value={customQuery}
            onChange={(e) => setCustomQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch(customQuery)}
            className="w-full pl-9 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <button
          onClick={() => handleSearch(customQuery)}
          disabled={loading || !customQuery.trim()}
          className="px-4 py-3 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-800 disabled:opacity-50 transition-colors"
        >
          Search
        </button>
      </div>

      {/* Category pills */}
      <div className="flex gap-2 flex-wrap mb-6">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.value}
            onClick={() => handleCategorySelect(cat)}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-full border transition-colors",
              activeCategory === cat.value
                ? "bg-indigo-600 text-white border-indigo-600"
                : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300 hover:text-indigo-600"
            )}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!loading && results.length === 0 && (
        <div className="text-center py-20">
          <Compass className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Select a category or search to discover places</p>
          <p className="text-gray-400 text-xs mt-1">Results are powered by Google Places</p>
        </div>
      )}

      {/* Results grid */}
      {!loading && results.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-4">
          {results.map((place) => (
            <div
              key={place.googlePlaceId}
              className="bg-white border border-gray-100 rounded-2xl overflow-hidden hover:border-gray-200 hover:shadow-sm transition-all group"
            >
              {place.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={place.imageUrl}
                  alt=""
                  className="w-full h-36 object-cover"
                />
              ) : (
                <div className="w-full h-36 bg-gradient-to-br from-indigo-50 to-purple-50 flex items-center justify-center">
                  <Compass className="w-8 h-8 text-indigo-200" />
                </div>
              )}
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 text-sm leading-tight">{place.name}</h3>
                    <div className="flex items-center gap-2 mt-1 text-xs text-gray-500 flex-wrap">
                      <span className="flex items-center gap-1 truncate">
                        <MapPin className="w-3 h-3 shrink-0" />
                        <span className="truncate">{place.address}</span>
                      </span>
                      {place.rating && (
                        <span className="flex items-center gap-0.5 text-yellow-600 shrink-0">
                          <Star className="w-3 h-3 fill-current" />
                          {place.rating}
                        </span>
                      )}
                    </div>
                    {place.types.length > 0 && (
                      <div className="flex gap-1 mt-1.5 flex-wrap">
                        {place.types.slice(0, 2).map((type) => (
                          <span
                            key={type}
                            className="px-1.5 py-0.5 text-[10px] bg-gray-50 text-gray-500 rounded capitalize"
                          >
                            {type.replace(/_/g, " ")}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleSave(place)}
                  disabled={savedIds.has(place.googlePlaceId)}
                  className={cn(
                    "mt-3 w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium rounded-xl transition-colors",
                    savedIds.has(place.googlePlaceId)
                      ? "bg-green-50 text-green-700 cursor-default"
                      : "bg-indigo-600 text-white hover:bg-indigo-700"
                  )}
                >
                  {savedIds.has(place.googlePlaceId) ? (
                    <>
                      <Star className="w-3.5 h-3.5 fill-current" />
                      Saved to wishlist
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      Save to wishlist
                    </>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
