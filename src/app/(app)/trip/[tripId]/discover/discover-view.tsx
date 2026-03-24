"use client"

import { useState, useEffect, useRef } from "react"
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
  Bookmark,
  Sparkles,
  Star,
  Lock,
} from "lucide-react"

import { BrowseCard, type Place } from "./browse-card"
import { WishlistSidebar, type Activity } from "./wishlist-sidebar"
import { DiscoverHeader } from "./discover-header"
import { DiscoverTabs, CATEGORY_TABS, type CategoryTab } from "./discover-tabs"
import { DiscoverFilters, type FilterChip } from "./discover-filters"

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
export type HotelInfo = { name: string; lat: number | null; lng: number | null }

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
  hotels?: HotelInfo[]
}

/* ─── Helpers ──────────────────────────────────────────────────────────────── */

type LocationOption = { label: string; value: string; lat?: number | null; lng?: number | null }

function buildLocationOptions(
  destinations: Destination[],
  arrivalCities: string[],
  fallback: string
): LocationOption[] {
  // Collect all raw entries with their metadata
  const rawEntries: { name: string; lat?: number | null; lng?: number | null }[] = []
  for (const d of destinations) {
    rawEntries.push({ name: d.name, lat: d.lat, lng: d.lng })
  }
  for (const c of arrivalCities) {
    rawEntries.push({ name: c })
  }

  // Deduplicate: normalize by city part (before first comma), keep shorter/cleaner name
  // e.g. "San Antonio, TX, USA" and "San Antonio" -> keep "San Antonio"
  const cityMap = new Map<string, { name: string; lat?: number | null; lng?: number | null }>()
  for (const entry of rawEntries) {
    const cityPart = entry.name.split(",")[0].trim().toLowerCase()
    const existing = cityMap.get(cityPart)
    if (!existing) {
      cityMap.set(cityPart, entry)
    } else {
      // Keep the shorter name (cleaner), but preserve lat/lng if the other has it
      const keepName = entry.name.length < existing.name.length ? entry.name : existing.name
      const lat = existing.lat ?? entry.lat
      const lng = existing.lng ?? entry.lng
      cityMap.set(cityPart, { name: keepName, lat, lng })
    }
  }

  const opts: LocationOption[] = []
  for (const entry of cityMap.values()) {
    opts.push({ label: entry.name, value: entry.name, lat: entry.lat, lng: entry.lng })
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

/** Apply client-side filters to places */
function applyFilters(places: Place[], filters: Set<string>): Place[] {
  if (filters.size === 0) return places
  return places.filter((p) => {
    if (filters.has("kid_friendly") && !p.goodForChildren) return false
    if (filters.has("open_now") && !p.openNow) return false
    if (filters.has("top_rated") && (p.rating == null || p.rating < 4.5)) return false
    if (filters.has("free") && p.priceLevel !== "PRICE_LEVEL_FREE") return false
    if (filters.has("indoor")) {
      const indoorTypes = ["museum", "restaurant", "cafe", "bar", "movie_theater", "bowling_alley", "library", "spa", "shopping_mall", "aquarium", "art_gallery"]
      if (!p.types?.some((t) => indoorTypes.includes(t))) return false
    }
    if (filters.has("outdoor")) {
      const outdoorTypes = ["park", "garden", "beach", "trail", "zoo", "amusement_park", "campground", "golf_course", "playground", "stadium", "hiking_area", "natural_feature"]
      if (!p.types?.some((t) => outdoorTypes.includes(t))) return false
    }
    return true
  })
}

/* ─── Main Component ───────────────────────────────────────────────────────── */

export function DiscoverView({
  tripId,
  trip,
  savedActivities: initialActivities,
  itineraryItems: initialItinerary,
  destinations,
  arrivalCities,
  travelerTags = [],
  dismissedPlaceIds: initialDismissed,
  userPlan,
  hotels = [],
}: Props) {
  const router = useRouter()
  const locationOptions = buildLocationOptions(destinations, arrivalCities, trip.destination)

  // Core state
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [activeTab, setActiveTab] = useState("all")
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set())
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

  // Initial results loaded on mount
  const initialLoaded = useRef(false)

  // Mobile
  const [isMobile, setIsMobile] = useState(false)

  const effectiveLocation = selectedLocation === "__other__" ? customLocation : selectedLocation
  const locationBias = getLocationBias(selectedLocation, locationOptions)

  // Build interest map: googlePlaceId -> priority (only WISHLIST items)
  const interestMap = new Map<string, "MUST_DO" | "LOW">()
  for (const a of activities) {
    if (a.googlePlaceId && a.status === "WISHLIST") {
      if (a.priority === "MUST_DO") interestMap.set(a.googlePlaceId, "MUST_DO")
      else interestMap.set(a.googlePlaceId, "LOW")
    }
  }

  // Wishlist groups
  const wishlist = activities.filter((a) => a.status === "WISHLIST")
  const mustDoItems = wishlist.filter((a) => a.priority === "MUST_DO")
  const maybeItems = wishlist.filter((a) => a.priority !== "MUST_DO")
  const wishlistCount = wishlist.length

  // Filter out dismissed places from results, then apply user filters
  const filteredResults = applyFilters(
    searchResults.filter((p) => !dismissedIds.has(p.googlePlaceId)),
    activeFilters
  )
  const filteredAiPicks = aiPicks.filter((p) => !dismissedIds.has(p.googlePlaceId))

  // Detect mobile
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener("resize", check)
    return () => window.removeEventListener("resize", check)
  }, [])

  // Load top-rated places on mount
  useEffect(() => {
    if (initialLoaded.current) return
    initialLoaded.current = true

    const city = locationOptions[0]?.value || trip.destination
    if (!city) return

    const query = `things to do in ${city}`
    const bias =
      locationOptions[0]?.lat != null && locationOptions[0]?.lng != null
        ? `${locationOptions[0].lat},${locationOptions[0].lng}`
        : undefined

    setLoading(true)
    searchPlaces(query, bias)
      .then((r) => {
        if (r.results.length > 0) setSearchResults(r.results)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
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

  function handleTabChange(tab: CategoryTab) {
    const newTabId = activeTab === tab.id ? "all" : tab.id
    setActiveTab(newTabId)

    if (tab.isAI) {
      if (newTabId === "ai_picks") {
        loadAIPicks()
      } else {
        setAiPicks([])
      }
      return
    }

    // For non-AI tabs, trigger a search with the tab's query
    if (newTabId === "all") {
      // Show suggestions or clear search
      setSearchResults([])
    } else {
      const selectedTab = CATEGORY_TABS.find((t) => t.id === newTabId)
      if (selectedTab) {
        handleSearch(selectedTab.query, searchQuery || undefined)
      }
    }
  }

  function handleToggleFilter(filterId: string) {
    setActiveFilters((prev) => {
      const next = new Set(prev)
      if (next.has(filterId)) {
        next.delete(filterId)
      } else {
        next.add(filterId)
      }
      return next
    })
  }

  async function loadAIPicks() {
    if (userPlan === "FREE") {
      toast.error("For Your Group requires a paid plan. Upgrade to unlock!")
      setActiveTab("all")
      return
    }
    setAiPicksLoading(true)
    try {
      const picks = await getAIPicks(tripId, effectiveLocation || trip.destination)
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
    if (activeTab === "ai_picks") {
      setActiveTab("all")
      setAiPicks([])
    }
    const selectedTab = CATEGORY_TABS.find((t) => t.id === activeTab)
    const tabQuery = activeTab !== "all" && selectedTab ? selectedTab.query : undefined
    handleSearch(tabQuery, searchQuery || undefined)
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
    setDismissingIds((prev) => new Set([...prev, place.googlePlaceId]))

    setTimeout(async () => {
      setDismissedIds((prev) => new Set([...prev, place.googlePlaceId]))
      setDismissingIds((prev) => {
        const n = new Set(prev)
        n.delete(place.googlePlaceId)
        return n
      })

      const existing = activities.find((a) => a.googlePlaceId === place.googlePlaceId)
      if (existing) {
        setActivities((prev) => prev.filter((a) => a.googlePlaceId !== place.googlePlaceId))
        removeFromShortlist(tripId, existing.id).catch(() => {})
      }

      dismissPlace(tripId, place.googlePlaceId).catch(() => {})

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

  const showAIPicks = activeTab === "ai_picks"

  return (
    <div className="flex h-[calc(100vh-57px)] md:h-screen overflow-hidden">
      {/* Browse Area */}
      <div className={cn("flex-1 overflow-y-auto transition-all", sidebarOpen && !isMobile && "w-[calc(100%-320px)]")}>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
          {/* Header with location dropdown */}
          <DiscoverHeader
            locationOptions={locationOptions}
            selectedLocation={selectedLocation}
            onLocationChange={setSelectedLocation}
            customLocation={customLocation}
            onCustomLocationChange={setCustomLocation}
          />

          {/* Search bar */}
          <div className="flex gap-2 mb-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search restaurants, museums, tours, parks..."
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

          {/* Category tabs */}
          <DiscoverTabs activeTab={activeTab} onTabChange={handleTabChange} />

          {/* Filter chips */}
          <DiscoverFilters activeFilters={activeFilters} onToggleFilter={handleToggleFilter} />

          {/* AI Picks: locked state for free users */}
          {showAIPicks && userPlan === "FREE" && (
            <div className="text-center py-16">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-purple-50 mb-4">
                <Lock className="w-8 h-8 text-purple-300" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1">AI Picks for Your Group</h3>
              <p className="text-gray-500 text-sm mb-4 max-w-sm mx-auto">
                Get personalized recommendations based on your travelers, preferences, and trip details.
              </p>
              <button
                onClick={() => router.push("/settings/billing")}
                className="px-6 py-2.5 bg-purple-600 text-white text-sm font-medium rounded-xl hover:bg-purple-700 transition-colors"
              >
                Upgrade to unlock
              </button>
            </div>
          )}

          {/* AI Picks loading */}
          {showAIPicks && userPlan !== "FREE" && aiPicksLoading && (
            <div className="flex items-center justify-center py-16">
              <div className="text-center">
                <Loader2 className="w-8 h-8 text-purple-500 animate-spin mx-auto mb-2" />
                <p className="text-sm text-gray-500">AI is finding the best picks for your group...</p>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                {filteredAiPicks.map((place) => (
                  <BrowseCard
                    key={place.googlePlaceId}
                    place={place}
                    wishlistState={interestMap.get(place.googlePlaceId) || null}
                    onNope={handleNope}
                    onMaybe={handleMaybe}
                    onMustDo={handleMustDo}
                    isDismissing={dismissingIds.has(place.googlePlaceId)}
                    hotels={hotels}
                    destination={effectiveLocation || trip.destination}
                  />
                ))}
              </div>
            </div>
          )}

          {/* AI Picks empty (paid users only) */}
          {showAIPicks && userPlan !== "FREE" && !aiPicksLoading && filteredAiPicks.length === 0 && (
            <div className="text-center py-16">
              <Sparkles className="w-12 h-12 text-gray-200 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No AI picks available right now. Try again later.</p>
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
                  onClick={() => {
                    setSearchResults([])
                    setActiveTab("all")
                  }}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  Clear
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                {filteredResults.map((place) => (
                  <BrowseCard
                    key={place.googlePlaceId}
                    place={place}
                    wishlistState={interestMap.get(place.googlePlaceId) || null}
                    onNope={handleNope}
                    onMaybe={handleMaybe}
                    onMustDo={handleMustDo}
                    isDismissing={dismissingIds.has(place.googlePlaceId)}
                    hotels={hotels}
                    destination={effectiveLocation || trip.destination}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {!showAIPicks &&
            !loading &&
            filteredResults.length === 0 && (
              <div className="text-center py-20">
                <Search className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                <p className="text-gray-500 text-sm">
                  Search for places or pick a category to get started
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
