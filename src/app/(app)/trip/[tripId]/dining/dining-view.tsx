"use client"

import { useState, useEffect, useRef } from "react"
import { toast } from "sonner"
import { searchPlaces, createActivity } from "@/lib/actions/activities"
import { getPlaceDetails } from "@/lib/actions/places-detail"
import { getAIDiningRecommendations, type DiningRecommendation } from "@/lib/actions/dining-ai"
import { cn } from "@/lib/utils"
import {
  Utensils,
  Search,
  Star,
  MapPin,
  Plus,
  Loader2,
  ChevronDown,
  Clock,
  Check,
  Sparkles,
  Leaf,
  Baby,
  X,
} from "lucide-react"

/* ─── Quick-filter categories ──────────────────────────────────────────────── */
const QUICK_FILTERS = [
  { label: "Quick / Fast food", query: "fast food quick service" },
  { label: "Sit-down", query: "casual dining sit-down restaurant" },
  { label: "Fine Dining", query: "fine dining upscale restaurant" },
  { label: "Cafe / Coffee", query: "cafe coffee shop" },
  { label: "Bar / Pub", query: "bar pub cocktail lounge" },
  { label: "Dessert / Bakery", query: "dessert bakery ice cream" },
]

const PRICE_LABEL: Record<string, string> = {
  PRICE_LEVEL_FREE: "Free",
  PRICE_LEVEL_INEXPENSIVE: "$",
  PRICE_LEVEL_MODERATE: "$$",
  PRICE_LEVEL_EXPENSIVE: "$$$",
  PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
}

const BEST_FOR_LABEL: Record<string, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  any: "Any meal",
}

/* ─── Types ────────────────────────────────────────────────────────────────── */
type Place = {
  googlePlaceId: string
  name: string
  address: string
  lat?: number
  lng?: number
  rating?: number
  ratingCount?: number
  imageUrl?: string | null
  types: string[]
  primaryType?: string
  priceLevel?: string
  goodForChildren?: boolean
  dineIn?: boolean
  delivery?: boolean
  takeout?: boolean
  servesVegetarianFood?: boolean
  servesBeer?: boolean
  servesWine?: boolean
  openNow?: boolean
  weekdayHours?: string[]
}

type Destination = { name: string; lat?: number | null; lng?: number | null }

interface Props {
  tripId: string
  destination: string
  destinations: Destination[]
  arrivalCities: string[]
  isPaid?: boolean
  travelerTags?: string[]
  dietaryRestrictions?: string[]
}

/* ─── Component ────────────────────────────────────────────────────────────── */
export function DiningView({ tripId, destination, destinations, arrivalCities, isPaid, travelerTags = [], dietaryRestrictions = [] }: Props) {
  // Build location options: destinations first, then unique arrival cities, then "Other"
  const locationOptions = buildLocationOptions(destinations, arrivalCities, destination)

  const [selectedLocation, setSelectedLocation] = useState(locationOptions[0]?.value ?? destination)
  const [customLocation, setCustomLocation] = useState("")
  const [activeFilter, setActiveFilter] = useState<string | null>(null)
  const [customQuery, setCustomQuery] = useState("")
  const [results, setResults] = useState<Place[]>([])
  const [loading, setLoading] = useState(false)
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set())
  const [expandedHours, setExpandedHours] = useState<string | null>(null)

  // AI recommendations state
  const [aiRecommendations, setAiRecommendations] = useState<DiningRecommendation[]>([])
  const [aiLoading, setAiLoading] = useState(false)
  const [aiLoaded, setAiLoaded] = useState(false)

  // Auto-suggest state
  const [suggestions, setSuggestions] = useState<Place[]>([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false)
  const suggestionsLoaded = useRef(false)

  const effectiveLocation = selectedLocation === "__other__" ? customLocation : selectedLocation
  const locationBias = getLocationBias(selectedLocation, locationOptions)

  // Auto-suggest on mount
  useEffect(() => {
    if (suggestionsLoaded.current) return
    suggestionsLoaded.current = true

    const city = locationOptions[0]?.value || destination
    if (!city) return

    // Build a search query based on dietary restrictions
    let queryPrefix = "best restaurants"
    if (dietaryRestrictions.length > 0) {
      // Use the first couple dietary restrictions in the query
      const dietaryTerms = dietaryRestrictions.slice(0, 2).join(" ")
      queryPrefix = `${dietaryTerms} restaurants`
    }
    const query = `${queryPrefix} in ${city}`

    setSuggestionsLoading(true)
    const bias = locationOptions[0]?.lat != null && locationOptions[0]?.lng != null
      ? `${locationOptions[0].lat},${locationOptions[0].lng}`
      : undefined

    searchPlaces(query, bias)
      .then((result) => {
        if (result.results.length > 0) {
          setSuggestions(result.results)
        }
      })
      .catch(() => {
        // Silently fail — suggestions are optional
      })
      .finally(() => {
        setSuggestionsLoading(false)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSearch(filterQuery?: string, keyword?: string) {
    const city = effectiveLocation || destination
    const parts = [filterQuery, keyword, city].filter(Boolean)
    if (parts.length === 0) return

    setLoading(true)
    try {
      const result = await searchPlaces(parts.join(" "), locationBias || undefined)
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

  function handleFilterSelect(filter: (typeof QUICK_FILTERS)[number]) {
    const next = activeFilter === filter.query ? null : filter.query
    setActiveFilter(next)
    handleSearch(next || undefined, customQuery || undefined)
  }

  function handleSearchSubmit() {
    handleSearch(activeFilter || undefined, customQuery || undefined)
  }

  async function handleAIRecommendations() {
    const city = effectiveLocation || destination
    if (!city) {
      toast.error("Select a location first")
      return
    }
    setAiLoading(true)
    try {
      const recs = await getAIDiningRecommendations(tripId, city)
      setAiRecommendations(recs)
      setAiLoaded(true)
      if (recs.length === 0) {
        toast.error("No AI recommendations available. Try again later.")
      }
    } catch (e) {
      if (e instanceof Error && e.message === "UPGRADE_REQUIRED") {
        toast.error("AI recommendations require a paid plan. Upgrade to unlock.")
      } else {
        toast.error("Failed to get AI recommendations")
      }
    } finally {
      setAiLoading(false)
    }
  }

  async function handleSave(place: Place, category: string) {
    const key = `${place.googlePlaceId}-${category}`
    if (savedIds.has(key) || savingIds.has(key)) return

    setSavingIds((prev) => new Set([...prev, key]))
    try {
      // Fetch additional details from Google Places
      const details = await getPlaceDetails(place.googlePlaceId)

      await createActivity(tripId, {
        name: place.name,
        address: place.address,
        lat: place.lat,
        lng: place.lng,
        googlePlaceId: place.googlePlaceId,
        rating: place.rating,
        imageUrl: place.imageUrl || undefined,
        priority: "MEDIUM",
        durationMins: category === "restaurant" ? 90 : 60,
        costPerAdult: 0,
        costPerChild: 0,
        category,
        indoorOutdoor: "BOTH",
        reservationNeeded: false,
        isFixed: false,
        // Include details from Places Detail API
        websiteUrl: details?.website || undefined,
        hoursJson: details?.hours ? JSON.stringify(details.hours) : undefined,
      })
      setSavedIds((prev) => new Set([...prev, key]))
      toast.success(`${place.name} added to ${category === "restaurant" ? "dining" : "activities"}!`)
    } catch {
      toast.error("Failed to save")
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dining</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Find restaurants &amp; cafes for your trip
          </p>
        </div>
        {isPaid && (
          <button
            onClick={handleAIRecommendations}
            disabled={aiLoading}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-medium rounded-xl hover:from-violet-700 hover:to-indigo-700 disabled:opacity-50 transition-all shadow-sm"
          >
            {aiLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            {aiLoading ? "Finding..." : "AI Recommendations"}
          </button>
        )}
      </div>

      {/* Auto-suggested restaurants */}
      {!suggestionsDismissed && (suggestionsLoading || suggestions.length > 0) && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-orange-500" />
              <h2 className="text-sm font-semibold text-orange-900">Suggested restaurants</h2>
              <span className="text-xs text-orange-500">
                in {locationOptions[0]?.value || destination}
              </span>
            </div>
            <button
              onClick={() => setSuggestionsDismissed(true)}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors flex items-center gap-1"
            >
              <X className="w-3 h-3" />
              Dismiss
            </button>
          </div>
          {suggestionsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 text-orange-400 animate-spin" />
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-4">
              {suggestions.map((place) => (
                <div
                  key={place.googlePlaceId}
                  className="bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-100 rounded-2xl overflow-hidden hover:border-orange-200 hover:shadow-sm transition-all"
                >
                  {/* Image */}
                  {place.imageUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={place.imageUrl} alt="" className="w-full h-36 object-cover" />
                  ) : (
                    <div className="w-full h-36 bg-gradient-to-br from-orange-100 to-amber-100 flex items-center justify-center">
                      <Utensils className="w-8 h-8 text-orange-200" />
                    </div>
                  )}

                  <div className="p-4 space-y-2.5">
                    {/* Name + rating */}
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-gray-900 text-sm leading-tight">
                        {place.name}
                      </h3>
                      {place.rating != null && (
                        <span className="flex items-center gap-0.5 text-yellow-600 text-xs shrink-0 font-medium">
                          <Star className="w-3.5 h-3.5 fill-current" />
                          {place.rating.toFixed(1)}
                        </span>
                      )}
                    </div>

                    {/* Address */}
                    <div className="flex items-start gap-1 text-xs text-gray-500">
                      <MapPin className="w-3 h-3 shrink-0 mt-0.5" />
                      <span className="line-clamp-1">{place.address}</span>
                    </div>

                    {/* Price + open status */}
                    <div className="flex items-center gap-2 text-xs">
                      {place.priceLevel && PRICE_LABEL[place.priceLevel] && (
                        <span className="font-semibold text-gray-700">
                          {PRICE_LABEL[place.priceLevel]}
                        </span>
                      )}
                      {place.openNow != null && (
                        <span
                          className={cn(
                            "font-medium",
                            place.openNow ? "text-green-600" : "text-red-500"
                          )}
                        >
                          {place.openNow ? "Open now" : "Closed"}
                        </span>
                      )}
                    </div>

                    {/* Attribute tags */}
                    <div className="flex gap-1.5 flex-wrap">
                      {place.servesVegetarianFood && <Tag text="Vegetarian" />}
                      {place.goodForChildren && <Tag text="Kids friendly" />}
                      {place.dineIn && <Tag text="Dine-in" />}
                      {place.delivery && <Tag text="Delivery" />}
                    </div>

                    {/* Save buttons */}
                    <div className="flex gap-2 pt-1">
                      <SaveButton
                        label="Add to dining"
                        saved={savedIds.has(`${place.googlePlaceId}-restaurant`)}
                        saving={savingIds.has(`${place.googlePlaceId}-restaurant`)}
                        onClick={() => handleSave(place, "restaurant")}
                        primary
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* AI Recommendations section */}
      {aiLoaded && aiRecommendations.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-violet-600" />
            <h2 className="text-sm font-semibold text-violet-900">
              Recommended for you
            </h2>
            <span className="text-xs text-violet-500">
              in {effectiveLocation || destination}
            </span>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {aiRecommendations.map((rec, i) => (
              <div
                key={`ai-rec-${i}`}
                className="bg-gradient-to-br from-violet-50 to-indigo-50 border border-violet-100 rounded-2xl p-4 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-gray-900 text-sm leading-tight">
                    {rec.name}
                  </h3>
                  <span className="text-xs font-semibold text-gray-700 shrink-0">
                    {rec.priceRange}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <span>{rec.cuisine}</span>
                  <span className="text-gray-300">|</span>
                  <span>{BEST_FOR_LABEL[rec.bestFor] || rec.bestFor}</span>
                  {rec.neighborhood && (
                    <>
                      <span className="text-gray-300">|</span>
                      <span className="flex items-center gap-0.5">
                        <MapPin className="w-3 h-3" />
                        {rec.neighborhood}
                      </span>
                    </>
                  )}
                </div>
                <p className="text-xs text-gray-600 italic">{rec.reason}</p>
                <div className="flex gap-1.5 flex-wrap">
                  {rec.kidsFriendly && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-green-100 text-green-700 rounded-full">
                      <Baby className="w-3 h-3" />
                      Kids friendly
                    </span>
                  )}
                  {rec.dietaryOptions.map((opt) => (
                    <span
                      key={opt}
                      className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-emerald-50 text-emerald-700 rounded-full"
                    >
                      <Leaf className="w-3 h-3" />
                      {opt}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Location selector */}
      <div className="mb-4">
        <label className="block text-xs font-medium text-gray-500 mb-1.5">Search in</label>
        <div className="relative inline-block w-full sm:w-72">
          <select
            value={selectedLocation}
            onChange={(e) => setSelectedLocation(e.target.value)}
            className="w-full appearance-none pl-3 pr-8 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {locationOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        </div>
        {selectedLocation === "__other__" && (
          <input
            type="text"
            placeholder="Enter a city or area..."
            value={customLocation}
            onChange={(e) => setCustomLocation(e.target.value)}
            className="mt-2 w-full sm:w-72 pl-3 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        )}
      </div>

      {/* Search field */}
      <div className="flex gap-2 mb-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder={`Search "sushi", "Italian", "BBQ"...`}
            value={customQuery}
            onChange={(e) => setCustomQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearchSubmit()}
            className="w-full pl-9 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <button
          onClick={handleSearchSubmit}
          disabled={loading}
          className="px-5 py-3 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-800 disabled:opacity-50 transition-colors"
        >
          Search
        </button>
      </div>

      {/* Quick filter pills */}
      <div className="flex gap-2 flex-wrap mb-6">
        {QUICK_FILTERS.map((filter) => (
          <button
            key={filter.query}
            onClick={() => handleFilterSelect(filter)}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-full border transition-colors",
              activeFilter === filter.query
                ? "bg-orange-500 text-white border-orange-500"
                : "bg-white text-gray-600 border-gray-200 hover:border-orange-300 hover:text-orange-600"
            )}
          >
            {filter.label}
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
      {!loading && results.length === 0 && !aiLoaded && suggestions.length === 0 && !suggestionsLoading && (
        <div className="text-center py-20">
          <Utensils className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">
            Pick a category or type a keyword to discover restaurants
          </p>
          <p className="text-gray-400 text-xs mt-1">
            Results powered by Google Places
          </p>
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
              {/* Image */}
              {place.imageUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={place.imageUrl} alt="" className="w-full h-40 object-cover" />
              ) : (
                <div className="w-full h-40 bg-gradient-to-br from-orange-50 to-amber-50 flex items-center justify-center">
                  <Utensils className="w-8 h-8 text-orange-200" />
                </div>
              )}

              <div className="p-4 space-y-2.5">
                {/* Name + rating row */}
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-gray-900 text-sm leading-tight">
                    {place.name}
                  </h3>
                  {place.rating != null && (
                    <span className="flex items-center gap-0.5 text-yellow-600 text-xs shrink-0 font-medium">
                      <Star className="w-3.5 h-3.5 fill-current" />
                      {place.rating.toFixed(1)}
                      {place.ratingCount != null && (
                        <span className="text-gray-400 font-normal ml-0.5">
                          ({place.ratingCount.toLocaleString()})
                        </span>
                      )}
                    </span>
                  )}
                </div>

                {/* Address */}
                <div className="flex items-start gap-1 text-xs text-gray-500">
                  <MapPin className="w-3 h-3 shrink-0 mt-0.5" />
                  <span className="line-clamp-2">{place.address}</span>
                </div>

                {/* Price + open status */}
                <div className="flex items-center gap-2 text-xs">
                  {place.priceLevel && PRICE_LABEL[place.priceLevel] && (
                    <span className="font-semibold text-gray-700">
                      {PRICE_LABEL[place.priceLevel]}
                    </span>
                  )}
                  {place.openNow != null && (
                    <span
                      className={cn(
                        "font-medium",
                        place.openNow ? "text-green-600" : "text-red-500"
                      )}
                    >
                      {place.openNow ? "Open now" : "Closed"}
                    </span>
                  )}
                </div>

                {/* Kids-friendly banner */}
                {place.goodForChildren && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-green-50 border border-green-100 rounded-lg text-xs font-medium text-green-700">
                    <span>Kids friendly</span>
                  </div>
                )}

                {/* Attribute tags */}
                <div className="flex gap-1.5 flex-wrap">
                  {place.servesWine && <Tag text="Wine" />}
                  {place.servesBeer && <Tag text="Beer" />}
                  {place.servesVegetarianFood && <Tag text="Vegetarian" />}
                  {place.dineIn && <Tag text="Dine-in" />}
                  {place.delivery && <Tag text="Delivery" />}
                  {place.takeout && <Tag text="Takeout" />}
                </div>

                {/* Type tags */}
                {place.types.length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    {place.types
                      .filter(
                        (t) =>
                          ![
                            "point_of_interest",
                            "establishment",
                            "food",
                            "store",
                          ].includes(t)
                      )
                      .slice(0, 3)
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

                {/* Hours (expandable) */}
                {place.weekdayHours && place.weekdayHours.length > 0 && (
                  <div>
                    <button
                      onClick={() =>
                        setExpandedHours(
                          expandedHours === place.googlePlaceId ? null : place.googlePlaceId
                        )
                      }
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
                    >
                      <Clock className="w-3 h-3" />
                      {expandedHours === place.googlePlaceId ? "Hide hours" : "Show hours"}
                    </button>
                    {expandedHours === place.googlePlaceId && (
                      <div className="mt-1.5 pl-4 space-y-0.5 text-[11px] text-gray-500">
                        {place.weekdayHours.map((line, i) => (
                          <div key={i}>{line}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex gap-2 pt-1">
                  <SaveButton
                    label="Add to dining"
                    saved={savedIds.has(`${place.googlePlaceId}-restaurant`)}
                    saving={savingIds.has(`${place.googlePlaceId}-restaurant`)}
                    onClick={() => handleSave(place, "restaurant")}
                    primary
                  />
                  <SaveButton
                    label="Add to activities"
                    saved={savedIds.has(`${place.googlePlaceId}-activity`)}
                    saving={savingIds.has(`${place.googlePlaceId}-activity`)}
                    onClick={() => handleSave(place, "activity")}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── Helper components ────────────────────────────────────────────────────── */

function Tag({ text }: { text: string }) {
  return (
    <span className="px-2 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-600 rounded-full">
      {text}
    </span>
  )
}

function SaveButton({
  label,
  saved,
  saving,
  onClick,
  primary,
}: {
  label: string
  saved: boolean
  saving?: boolean
  onClick: () => void
  primary?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={saved || saving}
      className={cn(
        "flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium rounded-xl transition-colors",
        saved
          ? "bg-green-50 text-green-700 cursor-default"
          : saving
            ? "bg-orange-100 text-orange-500 cursor-wait"
            : primary
              ? "bg-orange-500 text-white hover:bg-orange-600"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
      )}
    >
      {saved ? (
        <>
          <Check className="w-3.5 h-3.5" />
          Saved
        </>
      ) : saving ? (
        <>
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Adding...
        </>
      ) : (
        <>
          <Plus className="w-3.5 h-3.5" />
          {label}
        </>
      )}
    </button>
  )
}

/* ─── Helpers ──────────────────────────────────────────────────────────────── */

type LocationOption = { label: string; value: string; lat?: number | null; lng?: number | null }

function buildLocationOptions(
  destinations: Destination[],
  arrivalCities: string[],
  fallbackDestination: string
): LocationOption[] {
  const seen = new Set<string>()
  const options: LocationOption[] = []

  // Add destinations
  for (const d of destinations) {
    const key = d.name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    options.push({ label: d.name, value: d.name, lat: d.lat, lng: d.lng })
  }

  // Add arrival cities not already present
  for (const city of arrivalCities) {
    const key = city.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    options.push({ label: city, value: city })
  }

  // If no options yet, use the fallback destination string
  if (options.length === 0 && fallbackDestination) {
    options.push({ label: fallbackDestination, value: fallbackDestination })
  }

  options.push({ label: "Other location...", value: "__other__" })

  return options
}

function getLocationBias(
  selectedLocation: string,
  options: LocationOption[]
): string | undefined {
  const opt = options.find((o) => o.value === selectedLocation)
  if (opt?.lat != null && opt?.lng != null) {
    return `${opt.lat},${opt.lng}`
  }
  return undefined
}
