"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  searchPlaces,
  dismissPlace,
  undoDismiss,
  addToWishlistMaybe,
  addToWishlistMustDo,
  removeFromShortlist,
  updateActivityPriority,
} from "@/lib/actions/activities"
import { runOptimizer, runAIOptimizer } from "@/lib/actions/itinerary"
import { getAIPicks, type AIPick } from "@/lib/actions/ai-picks"
import { cn } from "@/lib/utils"
import {
  Search,
  Loader2,
  ChevronDown,
  Bookmark,
  Sparkles,
  Star,
} from "lucide-react"

import { BrowseCard, type Place } from "./browse-card"
import { FilterChips, ACTIVITY_FILTERS } from "./filter-chips"
import { WishlistSidebar, type Activity } from "./wishlist-sidebar"

/* ─── Types ────────────────────────────────────────────────────────────────── */

type ItineraryItem = {
  id: string
  date: string
  startTime?: string
  endTime?: string
  title: string
  type: string
  activityId?: string
  durationMins: number
}

type Destination = { name: string; lat?: number | null; lng?: number | null }

interface Props {
  tripId: string
  trip: { destination: string; startDate: string; endDate: string }
  savedActivities: Activity[]
  itineraryItems: ItineraryItem[]
  destinations: Destination[]
  arrivalCities: string[]
  travelerTags?: string[]
  dismissedPlaceIds: string[]
  userPlan: string
}

/* ─── Helpers ──────────────────────────────────────────────────────────────── */

type LocationOption = { label: string; value: string; lat?: number | null; lng?: number | null }

function buildLocationOptions(
  destinations: Destination[],
  arrivalCities: string[],
  fallback: string
): LocationOption[] {
  const seen = new Set<string>()
  const opts: LocationOption[] = []
  for (const d of destinations) {
    const key = d.name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    opts.push({ label: d.name, value: d.name, lat: d.lat, lng: d.lng })
  }
  for (const c of arrivalCities) {
    const key = c.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    opts.push({ label: c, value: c })
  }
  if (opts.length === 0 && fallback) opts.push({ label: fallback, value: fallback })
  opts.push({ label: "Other location...", value: "__other__" })
  return opts
}

function getLocationBias(selected: string, opts: LocationOption[]): string | undefined {
  const o = opts.find((x) => x.value === selected)
  if (o?.lat != null && o?.lng != null) return `${o.lat},${o.lng}`
  return undefined
}

/* ─── Main Component ───────────────────────────────────────────────────────── */

export function ExploreView({
  tripId,
  trip,
  savedActivities: initialActivities,
  itineraryItems: initialItinerary,
  destinations,
  arrivalCities,
  travelerTags = [],
  dismissedPlaceIds: initialDismissed,
  userPlan,
}: Props) {
  const router = useRouter()
  const locationOptions = buildLocationOptions(destinations, arrivalCities, trip.destination)

  // Core state
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [activeFilter, setActiveFilter] = useState<string | null>(null)
  const [selectedLocation, setSelectedLocation] = useState(locationOptions[0]?.value ?? trip.destination)
  const [customLocation, setCustomLocation] = useState("")
  const [searchResults, setSearchResults] = useState<Place[]>([])
  const [loading, setLoading] = useState(false)

  // Activities and dismissed
  const [activities, setActivities] = useState<Activity[]>(initialActivities)
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set(initialDismissed))
  const [dismissingIds, setDismissingIds] = useState<Set<string>>(new Set())

  // AI state
  const [aiPicks, setAiPicks] = useState<Place[]>([])
  const [aiPicksLoading, setAiPicksLoading] = useState(false)
  const [isAIFilling, setIsAIFilling] = useState(false)

  // Auto-suggest
  const [suggestions, setSuggestions] = useState<Place[]>([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const suggestionsLoaded = useRef(false)

  // Mobile
  const [isMobile, setIsMobile] = useState(false)

  const effectiveLocation = selectedLocation === "__other__" ? customLocation : selectedLocation
  const locationBias = getLocationBias(selectedLocation, locationOptions)

  // Build interest map: googlePlaceId -> priority (only WISHLIST items)
  const interestMap = new Map<string, "MUST_DO" | "LOW">()
  for (const a of activities) {
    if (a.googlePlaceId && a.status === "WISHLIST") {
      if (a.priority === "MUST_DO") interestMap.set(a.googlePlaceId, "MUST_DO")
      else interestMap.set(a.googlePlaceId, "LOW") // LOW, MEDIUM, HIGH all become "Maybe"
    }
  }

  // Wishlist groups
  const wishlist = activities.filter((a) => a.status === "WISHLIST")
  const mustDoItems = wishlist.filter((a) => a.priority === "MUST_DO")
  const maybeItems = wishlist.filter((a) => a.priority !== "MUST_DO")
  const wishlistCount = wishlist.length

  // Filter out dismissed places from results
  const filteredResults = searchResults.filter((p) => !dismissedIds.has(p.googlePlaceId))
  const filteredSuggestions = suggestions.filter((p) => !dismissedIds.has(p.googlePlaceId))
  const filteredAiPicks = aiPicks.filter((p) => !dismissedIds.has(p.googlePlaceId))

  // Detect mobile
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener("resize", check)
    return () => window.removeEventListener("resize", check)
  }, [])

  // Auto-suggest on mount
  useEffect(() => {
    if (suggestionsLoaded.current) return
    suggestionsLoaded.current = true

    const city = locationOptions[0]?.value || trip.destination
    if (!city) return

    const hasKids = travelerTags.some((t) => t === "child" || t === "toddler")
    const prefix = hasKids ? "family friendly things to do" : "top things to do"
    const query = `${prefix} in ${city}`

    setSuggestionsLoading(true)
    const bias =
      locationOptions[0]?.lat != null && locationOptions[0]?.lng != null
        ? `${locationOptions[0].lat},${locationOptions[0].lng}`
        : undefined

    searchPlaces(query, bias)
      .then((r) => {
        if (r.results.length > 0) setSuggestions(r.results)
      })
      .catch(() => {})
      .finally(() => setSuggestionsLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Handlers ─────────────────────────────────────────────────────────────

  async function handleSearch(filterQuery?: string, keyword?: string) {
    const city = effectiveLocation || trip.destination
    const parts = [filterQuery, keyword, city].filter(Boolean)
    if (parts.length === 0) return

    setLoading(true)
    try {
      const result = await searchPlaces(parts.join(" "), locationBias || undefined)
      setSearchResults(result.results)
      if (result.error && result.results.length === 0) {
        toast.error(result.error || "No results found")
      }
    } catch {
      toast.error("Search failed")
    } finally {
      setLoading(false)
    }
  }

  function handleFilterSelect(filter: { query: string }) {
    if (filter.query === "__ai_picks__") {
      if (activeFilter === "__ai_picks__") {
        setActiveFilter(null)
        setAiPicks([])
        return
      }
      setActiveFilter("__ai_picks__")
      loadAIPicks()
      return
    }
    const next = activeFilter === filter.query ? null : filter.query
    setActiveFilter(next)
    handleSearch(next || undefined, searchQuery || undefined)
  }

  async function loadAIPicks() {
    setAiPicksLoading(true)
    try {
      const picks = await getAIPicks(tripId, effectiveLocation || trip.destination)
      // Convert AI picks to Place-like objects for card display
      const asPlaces: Place[] = picks.map((pick, i) => ({
        googlePlaceId: `ai-pick-${i}-${pick.name.replace(/\s+/g, "-").toLowerCase()}`,
        name: pick.name,
        address: pick.description,
        types: [pick.category],
        primaryType: pick.category,
        rating: undefined,
      }))
      setAiPicks(asPlaces)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ""
      if (msg === "UPGRADE_REQUIRED") {
        toast.error("AI Picks requires a paid plan. Upgrade to unlock!")
      } else {
        toast.error("Failed to load AI picks")
      }
    } finally {
      setAiPicksLoading(false)
    }
  }

  function handleSearchSubmit() {
    if (activeFilter === "__ai_picks__") {
      setActiveFilter(null)
    }
    handleSearch(undefined, searchQuery || undefined)
  }

  function getPlaceData(place: Place) {
    return {
      googlePlaceId: place.googlePlaceId,
      name: place.name,
      address: place.address,
      lat: place.lat,
      lng: place.lng,
      rating: place.rating,
      imageUrl: place.imageUrl || undefined,
      category: place.types?.[0],
      durationMins: 90,
    }
  }

  async function handleNope(place: Place) {
    // Start dismissal animation
    setDismissingIds((prev) => new Set([...prev, place.googlePlaceId]))

    // After animation, actually dismiss
    setTimeout(async () => {
      setDismissedIds((prev) => new Set([...prev, place.googlePlaceId]))
      setDismissingIds((prev) => {
        const n = new Set(prev)
        n.delete(place.googlePlaceId)
        return n
      })

      // Also remove from wishlist if it was there
      const existing = activities.find((a) => a.googlePlaceId === place.googlePlaceId)
      if (existing) {
        setActivities((prev) => prev.filter((a) => a.googlePlaceId !== place.googlePlaceId))
        removeFromShortlist(tripId, existing.id).catch(() => {})
      }

      // Save dismiss to DB
      dismissPlace(tripId, place.googlePlaceId).catch(() => {})

      // Show undo toast
      toast("Dismissed", {
        description: place.name,
        action: {
          label: "Undo",
          onClick: () => {
            setDismissedIds((prev) => {
              const n = new Set(prev)
              n.delete(place.googlePlaceId)
              return n
            })
            undoDismiss(tripId, place.googlePlaceId).catch(() => {})
          },
        },
        duration: 3000,
      })
    }, 300)
  }

  async function handleMaybe(place: Place) {
    const data = getPlaceData(place)
    try {
      const result = await addToWishlistMaybe(tripId, data)
      // Update local state
      const existing = activities.find((a) => a.googlePlaceId === place.googlePlaceId)
      if (existing) {
        setActivities((prev) =>
          prev.map((a) =>
            a.googlePlaceId === place.googlePlaceId
              ? { ...a, priority: "LOW", status: "WISHLIST" }
              : a
          )
        )
      } else {
        setActivities((prev) => [
          {
            id: result.id,
            name: data.name,
            description: null,
            address: data.address || null,
            lat: data.lat || null,
            lng: data.lng || null,
            googlePlaceId: data.googlePlaceId,
            category: data.category || null,
            durationMins: data.durationMins || 90,
            costPerAdult: 0,
            priority: "LOW",
            status: "WISHLIST",
            rating: data.rating || null,
            imageUrl: data.imageUrl || null,
            notes: null,
            indoorOutdoor: "BOTH",
          },
          ...prev,
        ])
      }
      toast.success(`${place.name} added as Maybe`)
    } catch {
      toast.error("Failed to save")
    }
  }

  async function handleMustDo(place: Place) {
    const data = getPlaceData(place)
    try {
      const result = await addToWishlistMustDo(tripId, data)
      const existing = activities.find((a) => a.googlePlaceId === place.googlePlaceId)
      if (existing) {
        setActivities((prev) =>
          prev.map((a) =>
            a.googlePlaceId === place.googlePlaceId
              ? { ...a, priority: "MUST_DO", status: "WISHLIST" }
              : a
          )
        )
      } else {
        setActivities((prev) => [
          {
            id: result.id,
            name: data.name,
            description: null,
            address: data.address || null,
            lat: data.lat || null,
            lng: data.lng || null,
            googlePlaceId: data.googlePlaceId,
            category: data.category || null,
            durationMins: data.durationMins || 90,
            costPerAdult: 0,
            priority: "MUST_DO",
            status: "WISHLIST",
            rating: data.rating || null,
            imageUrl: data.imageUrl || null,
            notes: null,
            indoorOutdoor: "BOTH",
          },
          ...prev,
        ])
      }
      toast.success(`${place.name} added as Must Do!`)
    } catch {
      toast.error("Failed to save")
    }
  }

  async function handleRemoveFromWishlist(activityId: string) {
    try {
      await removeFromShortlist(tripId, activityId)
      setActivities((prev) => prev.filter((a) => a.id !== activityId))
      toast.success("Removed from wishlist")
    } catch {
      toast.error("Failed to remove")
    }
  }

  async function handleUpgradeToMustDo(activityId: string) {
    try {
      await updateActivityPriority(tripId, activityId, "MUST_DO")
      setActivities((prev) =>
        prev.map((a) => (a.id === activityId ? { ...a, priority: "MUST_DO" } : a))
      )
    } catch {
      toast.error("Failed to update")
    }
  }

  async function handleDowngradeToMaybe(activityId: string) {
    try {
      await updateActivityPriority(tripId, activityId, "LOW")
      setActivities((prev) =>
        prev.map((a) => (a.id === activityId ? { ...a, priority: "LOW" } : a))
      )
    } catch {
      toast.error("Failed to update")
    }
  }

  async function handleAIFill() {
    setIsAIFilling(true)
    try {
      const isPaid = userPlan !== "FREE"
      if (isPaid) {
        await runAIOptimizer(tripId)
      } else {
        await runOptimizer(tripId)
      }
      const scheduledCount = wishlist.length
      toast.success(
        `AI scheduled ${scheduledCount} activities! Redirecting to itinerary...`
      )
      setTimeout(() => {
        router.push(`/trip/${tripId}/itinerary`)
      }, 1000)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ""
      if (msg === "UPGRADE_REQUIRED") {
        toast.error("AI optimizer requires a paid plan. Using basic optimizer...")
        try {
          await runOptimizer(tripId)
          toast.success("Itinerary built! Redirecting...")
          setTimeout(() => router.push(`/trip/${tripId}/itinerary`), 1000)
        } catch {
          toast.error("Failed to build itinerary")
        }
      } else {
        toast.error("Failed to build itinerary")
      }
    } finally {
      setIsAIFilling(false)
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const showAIPicks = activeFilter === "__ai_picks__"
  const displayResults = showAIPicks ? filteredAiPicks : filteredResults
  const showSuggestions =
    !loading && !showAIPicks && filteredResults.length === 0 && (suggestionsLoading || filteredSuggestions.length > 0)

  return (
    <div className="flex h-[calc(100vh-57px)] md:h-screen overflow-hidden">
      {/* Browse Area */}
      <div className={cn("flex-1 overflow-y-auto transition-all", sidebarOpen && !isMobile && "w-[calc(100%-320px)]")}>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-5 gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-gray-900">Explore</h1>
              <p className="text-gray-500 text-sm mt-0.5">
                Swipe through places — Nope, Maybe, or Must Do
              </p>
            </div>
          </div>

          {/* Location selector */}
          <div className="mb-3">
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

          {/* Search bar */}
          <div className="flex gap-2 mb-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder='Search "museums", "parks", "tours"...'
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearchSubmit()}
                className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <button
              onClick={handleSearchSubmit}
              disabled={loading}
              className="px-4 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-800 disabled:opacity-50 transition-colors"
            >
              Search
            </button>
          </div>

          {/* Filter chips */}
          <FilterChips
            filters={ACTIVITY_FILTERS}
            activeFilter={activeFilter}
            onSelect={handleFilterSelect}
          />

          {/* AI Picks loading */}
          {showAIPicks && aiPicksLoading && (
            <div className="flex items-center justify-center py-16">
              <div className="text-center">
                <Loader2 className="w-8 h-8 text-purple-500 animate-spin mx-auto mb-2" />
                <p className="text-sm text-gray-500">AI is finding activities for you...</p>
              </div>
            </div>
          )}

          {/* AI Picks results */}
          {showAIPicks && !aiPicksLoading && filteredAiPicks.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-purple-600" />
                <h2 className="text-sm font-semibold text-purple-900">AI Picks for {effectiveLocation || trip.destination}</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredAiPicks.map((place) => (
                  <BrowseCard
                    key={place.googlePlaceId}
                    place={place}
                    wishlistState={interestMap.get(place.googlePlaceId) || null}
                    onNope={handleNope}
                    onMaybe={handleMaybe}
                    onMustDo={handleMustDo}
                    isDismissing={dismissingIds.has(place.googlePlaceId)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* AI Picks empty */}
          {showAIPicks && !aiPicksLoading && filteredAiPicks.length === 0 && (
            <div className="text-center py-16">
              <Sparkles className="w-12 h-12 text-gray-200 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No AI picks available. Try upgrading your plan.</p>
            </div>
          )}

          {/* Auto-suggested */}
          {!showAIPicks && showSuggestions && (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-indigo-600" />
                <h2 className="text-sm font-semibold text-indigo-900">Suggested for your trip</h2>
              </div>
              {suggestionsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredSuggestions.map((place) => (
                    <BrowseCard
                      key={place.googlePlaceId}
                      place={place}
                      wishlistState={interestMap.get(place.googlePlaceId) || null}
                      onNope={handleNope}
                      onMaybe={handleMaybe}
                      onMustDo={handleMustDo}
                      isDismissing={dismissingIds.has(place.googlePlaceId)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Loading */}
          {!showAIPicks && loading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
            </div>
          )}

          {/* Search results */}
          {!showAIPicks && !loading && filteredResults.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-900">
                  {filteredResults.length} results
                </h2>
                <button
                  onClick={() => setSearchResults([])}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  Clear
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredResults.map((place) => (
                  <BrowseCard
                    key={place.googlePlaceId}
                    place={place}
                    wishlistState={interestMap.get(place.googlePlaceId) || null}
                    onNope={handleNope}
                    onMaybe={handleMaybe}
                    onMustDo={handleMustDo}
                    isDismissing={dismissingIds.has(place.googlePlaceId)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {!showAIPicks &&
            !loading &&
            filteredResults.length === 0 &&
            filteredSuggestions.length === 0 &&
            !suggestionsLoading && (
              <div className="text-center py-20">
                <Search className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                <p className="text-gray-500 text-sm">
                  Search for activities or pick a filter to get started
                </p>
              </div>
            )}
        </div>
      </div>

      {/* Wishlist Sidebar (desktop) */}
      {!isMobile && sidebarOpen && (
        <WishlistSidebar
          mustDoItems={mustDoItems}
          maybeItems={maybeItems}
          onRemove={handleRemoveFromWishlist}
          onUpgradeToMustDo={handleUpgradeToMustDo}
          onDowngradeToMaybe={handleDowngradeToMaybe}
          onClose={() => setSidebarOpen(false)}
          onAIFill={handleAIFill}
          isAIFilling={isAIFilling}
        />
      )}

      {/* Mobile wishlist bottom sheet */}
      {isMobile && sidebarOpen && (
        <WishlistSidebar
          mustDoItems={mustDoItems}
          maybeItems={maybeItems}
          onRemove={handleRemoveFromWishlist}
          onUpgradeToMustDo={handleUpgradeToMustDo}
          onDowngradeToMaybe={handleDowngradeToMaybe}
          onClose={() => setSidebarOpen(false)}
          onAIFill={handleAIFill}
          isAIFilling={isAIFilling}
          isMobile
        />
      )}

      {/* Floating wishlist pill (sidebar closed) */}
      {!sidebarOpen && wishlistCount > 0 && !isMobile && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="fixed bottom-6 right-6 z-30 flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-full shadow-lg hover:bg-indigo-700 transition-colors"
        >
          <Bookmark className="w-4 h-4 fill-white" />
          {wishlistCount} saved
        </button>
      )}

      {/* Mobile floating buttons */}
      {isMobile && (
        <div className="fixed bottom-20 right-4 z-30 flex flex-col gap-2">
          {wishlistCount > 0 && !sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="flex items-center gap-2 px-3.5 py-2 bg-indigo-600 text-white text-xs font-medium rounded-full shadow-lg"
            >
              <Bookmark className="w-3.5 h-3.5 fill-white" />
              {wishlistCount} saved
            </button>
          )}
          {wishlistCount > 0 && !sidebarOpen && (
            <button
              onClick={handleAIFill}
              disabled={isAIFilling}
              className="flex items-center gap-2 px-3.5 py-2 bg-green-600 text-white text-xs font-medium rounded-full shadow-lg disabled:opacity-50"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {isAIFilling ? "Building..." : "AI Fill"}
            </button>
          )}
        </div>
      )}

      {/* CSS animations */}
      <style jsx global>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  )
}
