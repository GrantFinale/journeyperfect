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

import { serializeMealSlots, type MealSlot } from "@/lib/meal-slots"

import { BrowseCard, type Place } from "./browse-card"
import { WishlistSidebar, type Activity } from "./wishlist-sidebar"
import { DiscoverHeader } from "./discover-header"
import { DiscoverTabs, CATEGORY_TABS, DEFAULT_TAB_ID, type CategoryTab } from "./discover-tabs"
import { DiscoverFilters, METERS_PER_MILE } from "./discover-filters"
import { haversineDistance } from "@/lib/haversine"
import { AddCustomEvent } from "@/components/add-custom-event"
import { Plus } from "lucide-react"

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
export type HotelInfo = {
  name: string
  address?: string | null
  city?: string | null
  lat: number | null
  lng: number | null
}

/** The point a distance radius is measured from, and what to call it in the UI. */
export type DistanceAnchor = { name: string; lat: number; lng: number; isHotel: boolean }

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

/** "San Antonio, TX, USA" -> "san antonio", so the two spellings compare equal. */
function cityKey(name: string): string {
  return name.split(",")[0].trim().toLowerCase()
}

/**
 * Where "within X miles" is measured from, in priority order:
 *   1. a hotel in the city currently selected in the Discover dropdown — trips
 *      can span several cities, so the anchor has to agree with the city filter;
 *   2. failing that, the first hotel that has coordinates;
 *   3. failing that, the selected city's own centre.
 * The caller renders `anchor.name` next to the control so this is never a guess.
 */
function resolveAnchor(
  hotels: HotelInfo[],
  effectiveLocation: string,
  selected: string,
  opts: LocationOption[]
): DistanceAnchor | null {
  const geocoded = hotels.filter(
    (h): h is HotelInfo & { lat: number; lng: number } => h.lat != null && h.lng != null
  )

  // 1. Hotel in the selected city. `city` is often null on older rows, so fall
  //    back to a substring check against the address.
  const key = cityKey(effectiveLocation || "")
  if (key) {
    const match = geocoded.find((h) =>
      h.city ? cityKey(h.city) === key : (h.address || "").toLowerCase().includes(key)
    )
    if (match) return { name: match.name, lat: match.lat, lng: match.lng, isHotel: true }
  }

  // 2. Any hotel we can actually place on a map.
  if (geocoded[0]) {
    const h = geocoded[0]
    return { name: h.name, lat: h.lat, lng: h.lng, isHotel: true }
  }

  // 3. The city itself.
  const o = opts.find((x) => x.value === selected)
  if (o?.lat != null && o?.lng != null) {
    return { name: o.label, lat: o.lat, lng: o.lng, isHotel: false }
  }
  return null
}

const KM_PER_MILE = 1.609344

/** Straight-line miles from the anchor, or null when the place has no coords. */
function milesFromAnchor(place: Place, anchor: DistanceAnchor | null): number | null {
  if (!anchor || place.lat == null || place.lng == null) return null
  return haversineDistance(place.lat, place.lng, anchor.lat, anchor.lng) / KM_PER_MILE
}

/** Query for a category id, e.g. the default tab on mount. */
function queryForTab(tabId: string): string | undefined {
  return CATEGORY_TABS.find((t) => t.id === tabId)?.query
}

/** Merge pages without ever showing the same place twice. */
function dedupeByPlaceId(places: Place[]): Place[] {
  const seen = new Set<string>()
  const out: Place[] = []
  for (const p of places) {
    if (!p?.googlePlaceId || seen.has(p.googlePlaceId)) continue
    seen.add(p.googlePlaceId)
    out.push(p)
  }
  return out
}

/** Highest rated first; break ties on review volume; unrated places sort last. */
function byRatingDesc(a: Place, b: Place): number {
  const ar = a.rating ?? -1
  const br = b.rating ?? -1
  if (br !== ar) return br - ar
  return (b.ratingCount ?? 0) - (a.ratingCount ?? 0)
}

/**
 * Apply the client-side refinements (see REFINEMENT_CHIPS) to places, plus the
 * distance radius.
 *
 * The radius pass is a backstop, not the primary mechanism: the Places request
 * is already restricted to the bounding box around the anchor, but that box is
 * a square (and Google treats region hints loosely), so we clip to the exact
 * circle here. A place with no coordinates can't be verified, so it's dropped
 * while a radius is active and kept when it isn't.
 */
function applyFilters(
  places: Place[],
  filters: Set<string>,
  radius?: { anchor: DistanceAnchor | null; miles: number }
): Place[] {
  const radiusOn = !!radius && radius.miles > 0 && !!radius.anchor
  if (filters.size === 0 && !radiusOn) return places
  return places.filter((p) => {
    if (filters.has("open_now") && !p.openNow) return false
    if (filters.has("free") && p.priceLevel !== "PRICE_LEVEL_FREE") return false
    if (radiusOn) {
      const mi = milesFromAnchor(p, radius!.anchor)
      if (mi == null || mi > radius!.miles) return false
    }
    return true
  })
}

/**
 * Columns in the results grid at its widest (`lg:grid-cols-3`). Narrower
 * breakpoints render 1 or 2 columns, so a multiple of 3 only guarantees a full
 * final row on large screens — see trimToFullRows.
 */
const GRID_COLUMNS = 3

/**
 * Hold back the 1–2 places that would leave a half-empty final row, so the grid
 * always ends on a full row of 3.
 *
 * This is a *render-time* trim: the trimmed places stay in `searchResults`, and
 * `moreAvailable` guarantees they become visible again the moment the next page
 * lands (either via "Show more" or a fresh search). Two cases deliberately
 * render everything, ragged row and all, because trimming there would hide
 * results the user cannot get back:
 *
 *   1. `!moreAvailable` — this is the true end of the list, so a partial last
 *      row is unavoidable and strictly better than dropping places.
 *   2. Fewer than GRID_COLUMNS results — trimming would empty the grid and trip
 *      the "no results" state while results exist.
 */
function trimToFullRows<T>(items: T[], moreAvailable: boolean): T[] {
  if (!moreAvailable) return items
  const fullRows = Math.floor(items.length / GRID_COLUMNS) * GRID_COLUMNS
  if (fullRows === 0 || fullRows === items.length) return items
  return items.slice(0, fullRows)
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
  const [activeTab, setActiveTab] = useState(DEFAULT_TAB_ID)
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set())
  const [selectedLocation, setSelectedLocation] = useState(locationOptions[0]?.value ?? trip.destination)
  const [customLocation, setCustomLocation] = useState("")
  const [searchResults, setSearchResults] = useState<Place[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextPageToken, setNextPageToken] = useState<string | null>(null)
  const [lastSearchQuery, setLastSearchQuery] = useState<string>("")
  const [lastSearchBias, setLastSearchBias] = useState<string | undefined>(undefined)
  // Places requires every paging call to repeat the original region params, so
  // "Show more" has to reuse the radius the first page was fetched with.
  const [lastSearchRadius, setLastSearchRadius] = useState<number | undefined>(undefined)
  // Max distance from the anchor, in miles. 0 = no limit.
  const [radiusMi, setRadiusMi] = useState(0)

  // Activities and dismissed
  const [activities, setActivities] = useState<Activity[]>(initialActivities)
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set(initialDismissed))
  const [dismissingIds, setDismissingIds] = useState<Set<string>>(new Set())

  // AI state
  const [aiPicks, setAiPicks] = useState<Place[]>([])
  const [aiPicksLoading, setAiPicksLoading] = useState(false)
  const [isAIFilling, setIsAIFilling] = useState(false)

  // Track custom durations per place
  const [placeDurations, setPlaceDurations] = useState<Map<string, number>>(new Map())

  // Initial results loaded on mount
  const initialLoaded = useRef(false)
  // `city|radius` the current results belong to, so a change to either can
  // re-search while a no-op change (or the initial mount) doesn't fire a
  // duplicate call.
  const searchedKey = useRef<string | null>(null)

  // Custom event modal
  const [showAddCustom, setShowAddCustom] = useState(false)

  // Mobile
  const [isMobile, setIsMobile] = useState(false)

  const effectiveLocation = selectedLocation === "__other__" ? customLocation : selectedLocation
  const locationBias = getLocationBias(selectedLocation, locationOptions)

  // What "within N miles" is measured from — usually the hotel in the selected city.
  const distanceAnchor = resolveAnchor(hotels, effectiveLocation, selectedLocation, locationOptions)
  // No anchor means nothing to measure from, so the radius is ignored entirely
  // rather than silently re-centred on the city.
  const radiusMeters =
    radiusMi > 0 && distanceAnchor ? Math.round(radiusMi * METERS_PER_MILE) : undefined
  // With a radius the search must be centred on the anchor, not the city centre.
  const searchCenter = radiusMeters && distanceAnchor
    ? `${distanceAnchor.lat},${distanceAnchor.lng}`
    : locationBias

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

  // Filter out dismissed places from results, apply user filters, then always
  // surface the highest-rated first (covers "Show more" appends too).
  const filteredResults = applyFilters(
    searchResults.filter((p) => !dismissedIds.has(p.googlePlaceId)),
    activeFilters,
    { anchor: distanceAnchor, miles: radiusMi }
  )
    .slice()
    .sort(byRatingDesc)
  // Dismissals and the open-now/free/radius refinements all run after the fetch,
  // so 12 fetched places routinely render as 10 or 11. Trim to whole rows of 3
  // while there's another page to pull the remainder from; render everything once
  // the list is exhausted.
  const visibleResults = trimToFullRows(filteredResults, !!nextPageToken)
  // AI Picks come back as one fixed list with no pagination, so there's no later
  // page to reveal a held-back item — they're rendered in full, ragged row and all.
  const filteredAiPicks = aiPicks.filter((p) => !dismissedIds.has(p.googlePlaceId))

  // Detect mobile
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener("resize", check)
    return () => window.removeEventListener("resize", check)
  }, [])

  // Load the default category (Attractions) on mount — one Places call.
  useEffect(() => {
    if (initialLoaded.current) return
    initialLoaded.current = true
    searchedKey.current = `${effectiveLocation || trip.destination}|${radiusMi}`
    handleSearch(queryForTab(DEFAULT_TAB_ID))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Picking a different city — or a different distance radius — re-runs the
  // active category straight away, no manual re-search. Typing a custom city is
  // debounced so we don't issue a Places call per keystroke.
  useEffect(() => {
    // Mount hasn't searched yet, so there's nothing to replace.
    if (searchedKey.current === null) return

    const city = (effectiveLocation || trip.destination || "").trim()
    const key = `${city}|${radiusMi}`
    if (!city || key === searchedKey.current) return
    // A half-typed custom city isn't worth searching.
    if (selectedLocation === "__other__" && city.length < 3) return

    const timer = setTimeout(() => {
      searchedKey.current = key
      if (activeTab === "ai_picks") loadAIPicks()
      else handleSearch(queryForTab(activeTab), searchQuery || undefined)
    }, selectedLocation === "__other__" ? 600 : 0)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveLocation, selectedLocation, radiusMi])

  // ─── Handlers ─────────────────────────────────────────────────────────────

  /** Exactly one `searchPlaces` call per invocation. */
  async function handleSearch(filterQuery?: string, keyword?: string) {
    const city = effectiveLocation || trip.destination
    const parts = [filterQuery, keyword, city].filter(Boolean)
    if (parts.length === 0) return

    const fullQuery = parts.join(" ")
    const bias = searchCenter || undefined
    setLoading(true)
    setLastSearchQuery(fullQuery)
    setLastSearchBias(bias)
    setLastSearchRadius(radiusMeters)
    // Drop any page token from the previous query/radius so a stray "Show more"
    // can't append results from a search we're replacing.
    setNextPageToken(null)
    try {
      const result = await searchPlaces(fullQuery, bias, { limit: 12, radiusMeters })
      setSearchResults(dedupeByPlaceId(result.results))
      setNextPageToken(result.nextPageToken)
      if (result.error && result.results.length === 0) {
        toast.error(result.error || "No results found")
      }
    } catch {
      toast.error("Search failed")
    } finally {
      setLoading(false)
    }
  }

  async function handleGetMore() {
    if (!nextPageToken || loadingMore) return
    setLoadingMore(true)
    try {
      const result = await searchPlaces(lastSearchQuery, lastSearchBias, {
        limit: 12,
        pageToken: nextPageToken,
        radiusMeters: lastSearchRadius,
      })
      // Append + de-dupe; the rating sort in `filteredResults` re-ranks the
      // combined list rather than resetting it.
      setSearchResults((prev) => dedupeByPlaceId([...prev, ...result.results]))
      setNextPageToken(result.nextPageToken)
    } catch {
      toast.error("Failed to load more results")
    } finally {
      setLoadingMore(false)
    }
  }

  function handleTabChange(tab: CategoryTab) {
    // A category is always selected, so re-clicking the active pill is a no-op
    // rather than a toggle — that also keeps it to one Places call per change.
    if (tab.id === activeTab) return
    setActiveTab(tab.id)

    if (tab.isAI) {
      loadAIPicks()
      return
    }

    setAiPicks([])
    handleSearch(tab.query, searchQuery || undefined)
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
    // Free users stay on the tab and get the locked upsell panel below
    // instead of a wasted request.
    if (userPlan === "FREE") return
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
    // A keyword search is always scoped to a real category; searching from the
    // AI tab drops you back onto the default one.
    let tabId = activeTab
    if (activeTab === "ai_picks") {
      tabId = DEFAULT_TAB_ID
      setActiveTab(DEFAULT_TAB_ID)
      setAiPicks([])
    }
    handleSearch(queryForTab(tabId), searchQuery || undefined)
  }

  /** "Clear" returns to the default view rather than an empty screen. */
  function handleClearSearch() {
    setSearchQuery("")
    setAiPicks([])
    setNextPageToken(null)
    setActiveTab(DEFAULT_TAB_ID)
    handleSearch(queryForTab(DEFAULT_TAB_ID))
  }

  function getPlaceData(place: Place, mealSlots?: MealSlot[]) {
    return {
      googlePlaceId: place.googlePlaceId,
      name: place.name,
      address: place.address,
      lat: place.lat,
      lng: place.lng,
      rating: place.rating,
      imageUrl: place.imageUrl || undefined,
      category: place.types?.[0],
      types: place.types || [],
      durationMins: placeDurations.get(place.googlePlaceId) || undefined,
      mealSlots: mealSlots?.length ? serializeMealSlots(mealSlots) ?? undefined : undefined,
    }
  }

  function handleDurationChange(place: Place, durationMins: number) {
    setPlaceDurations((prev) => {
      const next = new Map(prev)
      next.set(place.googlePlaceId, durationMins)
      return next
    })
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

  async function handleMaybe(place: Place, mealSlots?: MealSlot[]) {
    const data = getPlaceData(place, mealSlots)
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
            durationMins: result.durationMins,
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

  async function handleMustDo(place: Place, mealSlots?: MealSlot[]) {
    const data = getPlaceData(place, mealSlots)
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
            durationMins: result.durationMins,
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

          {/* Add your own + Category tabs row */}
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <DiscoverTabs activeTab={activeTab} onTabChange={handleTabChange} />
            </div>
            <button
              onClick={() => setShowAddCustom(true)}
              className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-indigo-600 transition-colors shrink-0 ml-2 mt-1"
            >
              <Plus className="w-3.5 h-3.5" />
              Add your own
            </button>
          </div>

          {/* Filter chips + distance-from-hotel control */}
          <DiscoverFilters
            activeFilters={activeFilters}
            onToggleFilter={handleToggleFilter}
            radiusMi={radiusMi}
            onRadiusChange={setRadiusMi}
            anchorLabel={distanceAnchor?.name ?? null}
          />

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
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <Sparkles className="w-4 h-4 text-purple-600" />
                <h2 className="text-sm font-semibold text-purple-900">AI Picks for {effectiveLocation || trip.destination}</h2>
                {/* AI picks are names, not Places records — they carry no
                    coordinates, so the distance filter can't be applied. */}
                {radiusMi > 0 && (
                  <span className="text-[11px] text-gray-400">
                    (distance filter doesn&apos;t apply to AI Picks)
                  </span>
                )}
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
                    onDurationChange={handleDurationChange}
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
          {!showAIPicks && !loading && visibleResults.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-900">
                  {visibleResults.length} results
                </h2>
                <button
                  onClick={handleClearSearch}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  Clear
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                {visibleResults.map((place) => (
                  <BrowseCard
                    key={place.googlePlaceId}
                    place={place}
                    wishlistState={interestMap.get(place.googlePlaceId) || null}
                    onNope={handleNope}
                    onMaybe={handleMaybe}
                    onMustDo={handleMustDo}
                    onDurationChange={handleDurationChange}
                    isDismissing={dismissingIds.has(place.googlePlaceId)}
                    hotels={hotels}
                    distanceAnchor={radiusMi > 0 ? distanceAnchor : null}
                    destination={effectiveLocation || trip.destination}
                  />
                ))}
              </div>

              {/* Get More button */}
              {nextPageToken && (
                <button
                  onClick={handleGetMore}
                  disabled={loadingMore}
                  className="w-full mt-6 py-3 text-sm font-medium text-gray-500 hover:text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loadingMore ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Loading more...
                    </>
                  ) : (
                    "Show more results \u2192"
                  )}
                </button>
              )}
            </div>
          )}

          {/* Empty state */}
          {/* Empty state. `visibleResults` is only empty when `filteredResults`
              is too — trimToFullRows never trims a non-empty list to nothing. */}
          {!showAIPicks &&
            !loading &&
            visibleResults.length === 0 && (
              <div className="text-center py-20">
                <Search className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                {radiusMi > 0 && distanceAnchor ? (
                  <>
                    <p className="text-gray-500 text-sm">
                      Nothing within {radiusMi} mi of {distanceAnchor.name}
                    </p>
                    <button
                      onClick={() => setRadiusMi(0)}
                      className="mt-2 text-xs font-medium text-indigo-600 hover:text-indigo-700"
                    >
                      Clear distance filter
                    </button>
                  </>
                ) : (
                  <p className="text-gray-500 text-sm">
                    Search for places or pick a category to get started
                  </p>
                )}
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

      {/* Add Custom Event modal */}
      {showAddCustom && (
        <AddCustomEvent
          tripId={tripId}
          tripDates={{ start: trip.startDate, end: trip.endDate }}
          destinations={destinations}
          onCreated={() => router.refresh()}
          onClose={() => setShowAddCustom(false)}
        />
      )}
    </div>
  )
}
