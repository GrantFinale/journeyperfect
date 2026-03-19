"use client"

import { useState } from "react"
import { toast } from "sonner"
import { searchPlaces, createActivity } from "@/lib/actions/activities"
import { cn } from "@/lib/utils"
import { Utensils, Search, Star, MapPin, Plus, Loader2, Coffee } from "lucide-react"

const MEAL_TYPES = [
  { label: "All", value: "restaurant" },
  { label: "Breakfast", value: "breakfast brunch cafe" },
  { label: "Lunch", value: "lunch restaurant bistro" },
  { label: "Dinner", value: "dinner restaurant" },
  { label: "Coffee", value: "coffee shop cafe" },
  { label: "Dessert", value: "dessert bakery ice cream" },
  { label: "Bars", value: "bar pub cocktail" },
]

const STYLE_FILTERS = [
  { label: "All styles", value: "" },
  { label: "Quick", value: "fast casual quick" },
  { label: "Sit-down", value: "casual dining" },
  { label: "Upscale", value: "fine dining upscale" },
  { label: "Kid-friendly", value: "family friendly kid" },
  { label: "Outdoor seating", value: "outdoor patio" },
  { label: "Local favorites", value: "local popular" },
]

const PRICE_RANGES: Record<string, string> = {
  "1": "$",
  "2": "$$",
  "3": "$$$",
  "4": "$$$$",
}

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

export function DiningView({ tripId, destination }: Props) {
  const [activeMeal, setActiveMeal] = useState("restaurant")
  const [activeStyle, setActiveStyle] = useState("")
  const [customQuery, setCustomQuery] = useState("")
  const [results, setResults] = useState<Place[]>([])
  const [loading, setLoading] = useState(false)
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())

  async function handleSearch(mealType: string, style: string, query?: string) {
    const parts = [query || mealType, style, destination].filter(Boolean)
    setLoading(true)
    try {
      const result = await searchPlaces(parts.join(" "))
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

  function handleMealSelect(meal: (typeof MEAL_TYPES)[0]) {
    setActiveMeal(meal.value)
    handleSearch(meal.value, activeStyle)
  }

  function handleStyleSelect(style: (typeof STYLE_FILTERS)[0]) {
    setActiveStyle(style.value)
    handleSearch(activeMeal, style.value)
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
        durationMins: 90,
        costPerAdult: 0,
        costPerChild: 0,
        category: "restaurant",
        indoorOutdoor: "BOTH",
        reservationNeeded: false,
        isFixed: false,
      })
      setSavedIds((prev) => new Set([...prev, place.googlePlaceId]))
      toast.success(`${place.name} added to wishlist!`)
    } catch {
      toast.error("Failed to save restaurant")
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dining</h1>
        <p className="text-gray-500 text-sm mt-0.5">Find restaurants & cafes in {destination}</p>
      </div>

      {/* Custom search */}
      <div className="flex gap-2 mb-5">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder={`Search restaurants in ${destination}...`}
            value={customQuery}
            onChange={(e) => setCustomQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch(activeMeal, activeStyle, customQuery)}
            className="w-full pl-9 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <button
          onClick={() => handleSearch(activeMeal, activeStyle, customQuery)}
          disabled={loading}
          className="px-4 py-3 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-800 disabled:opacity-50 transition-colors"
        >
          Search
        </button>
      </div>

      {/* Meal type pills */}
      <div className="flex gap-2 flex-wrap mb-3">
        {MEAL_TYPES.map((meal) => (
          <button
            key={meal.value}
            onClick={() => handleMealSelect(meal)}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-full border transition-colors",
              activeMeal === meal.value
                ? "bg-orange-500 text-white border-orange-500"
                : "bg-white text-gray-600 border-gray-200 hover:border-orange-300 hover:text-orange-600"
            )}
          >
            {meal.label}
          </button>
        ))}
      </div>

      {/* Style filter */}
      <div className="flex gap-2 flex-wrap mb-6">
        {STYLE_FILTERS.map((style) => (
          <button
            key={style.value}
            onClick={() => handleStyleSelect(style)}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-full border transition-colors",
              activeStyle === style.value
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-500 border-gray-200 hover:border-gray-400 hover:text-gray-700"
            )}
          >
            {style.label}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!loading && results.length === 0 && (
        <div className="text-center py-20">
          <Utensils className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Select a meal type to discover restaurants</p>
          <p className="text-gray-400 text-xs mt-1">Results are powered by Google Places</p>
        </div>
      )}

      {/* Results grid */}
      {!loading && results.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-4">
          {results.map((place) => (
            <div
              key={place.googlePlaceId}
              className="bg-white border border-gray-100 rounded-2xl overflow-hidden hover:border-gray-200 hover:shadow-sm transition-all"
            >
              {place.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={place.imageUrl}
                  alt=""
                  className="w-full h-36 object-cover"
                />
              ) : (
                <div className="w-full h-36 bg-gradient-to-br from-orange-50 to-amber-50 flex items-center justify-center">
                  <Utensils className="w-8 h-8 text-orange-200" />
                </div>
              )}
              <div className="p-4">
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
                    {place.types
                      .filter((t) => !["point_of_interest", "establishment"].includes(t))
                      .slice(0, 2)
                      .map((type) => (
                        <span
                          key={type}
                          className="px-1.5 py-0.5 text-[10px] bg-orange-50 text-orange-600 rounded capitalize"
                        >
                          {type.replace(/_/g, " ")}
                        </span>
                      ))}
                  </div>
                )}
                <button
                  onClick={() => handleSave(place)}
                  disabled={savedIds.has(place.googlePlaceId)}
                  className={cn(
                    "mt-3 w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium rounded-xl transition-colors",
                    savedIds.has(place.googlePlaceId)
                      ? "bg-green-50 text-green-700 cursor-default"
                      : "bg-orange-500 text-white hover:bg-orange-600"
                  )}
                >
                  {savedIds.has(place.googlePlaceId) ? (
                    <>
                      <Star className="w-3.5 h-3.5 fill-current" />
                      Saved
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
