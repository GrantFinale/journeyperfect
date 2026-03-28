"use client"

import { useState, useMemo } from "react"
import { Star, MapPin, X, Bookmark, CloudSun, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Phone, Clock, ExternalLink, Loader2, Hotel, Ticket } from "lucide-react"
import { cn } from "@/lib/utils"
import { getPlaceDetails } from "@/lib/actions/places-detail"
import { haversineDistance } from "@/lib/haversine"

export type Place = {
  googlePlaceId: string
  name: string
  address: string
  lat?: number
  lng?: number
  rating?: number
  ratingCount?: number
  imageUrl?: string | null
  photoUrls?: string[]
  types: string[]
  primaryType?: string
  priceLevel?: string
  goodForChildren?: boolean
  dineIn?: boolean
  delivery?: boolean
  takeout?: boolean
  openNow?: boolean
}

type HotelInfo = { name: string; lat: number | null; lng: number | null }

const PRICE_LABEL: Record<string, string> = {
  PRICE_LEVEL_FREE: "Free",
  PRICE_LEVEL_INEXPENSIVE: "$",
  PRICE_LEVEL_MODERATE: "$$",
  PRICE_LEVEL_EXPENSIVE: "$$$",
  PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
}

const KM_TO_MI = 0.621371

function classifyIndoorOutdoorFromTypes(types: string[]): "Indoor" | "Outdoor" | null {
  const outdoor = ["park", "garden", "beach", "trail", "zoo", "amusement_park", "campground", "golf_course", "playground", "stadium", "water_park", "natural_feature", "hiking_area"]
  const indoor = ["museum", "restaurant", "cafe", "bar", "movie_theater", "bowling_alley", "library", "spa", "shopping_mall", "aquarium", "art_gallery"]
  for (const t of types) {
    if (outdoor.includes(t)) return "Outdoor"
    if (indoor.includes(t)) return "Indoor"
  }
  return null
}

interface BrowseCardProps {
  place: Place
  wishlistState: "MUST_DO" | "LOW" | null // null = not on wishlist
  onNope: (place: Place) => void
  onMaybe: (place: Place) => void
  onMustDo: (place: Place) => void
  onDurationChange?: (place: Place, durationMins: number) => void
  isDismissing?: boolean
  hotels?: HotelInfo[]
  destination?: string
}

type PlaceDetails = {
  name?: string
  address?: string
  phone?: string
  hours?: string[]
  rating?: number
  ratingCount?: number
  website?: string
  openNow?: boolean
} | null

// Types that should show booking links (not restaurants/cafes)
const BOOKABLE_TYPES = [
  "tourist_attraction", "museum", "art_gallery", "amusement_park", "aquarium",
  "zoo", "park", "travel_agency", "stadium", "bowling_alley", "movie_theater",
  "spa", "water_park", "hiking_area", "campground", "natural_feature",
]

function isBookablePlace(types: string[]): boolean {
  const nonBookable = ["restaurant", "cafe", "bar", "bakery", "food", "meal_delivery", "meal_takeaway"]
  if (types.some((t) => nonBookable.includes(t))) return false
  return true
}

const DURATION_PRESETS = [30, 60, 90, 120, 180, 240]

function formatDurationLabel(mins: number): string {
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

export function BrowseCard({
  place,
  wishlistState,
  onNope,
  onMaybe,
  onMustDo,
  onDurationChange,
  isDismissing,
  hotels = [],
  destination = "",
}: BrowseCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [details, setDetails] = useState<PlaceDetails>(undefined as unknown as PlaceDetails)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [photoIndex, setPhotoIndex] = useState(0)
  const [durationMins, setDurationMins] = useState(90)
  const [showCustomDuration, setShowCustomDuration] = useState(false)
  const [customDurationValue, setCustomDurationValue] = useState("")

  const photos = place.photoUrls && place.photoUrls.length > 0
    ? place.photoUrls
    : place.imageUrl
      ? [place.imageUrl]
      : []

  const indoorOutdoor = classifyIndoorOutdoorFromTypes(place.types)

  // Calculate distance to nearest hotel
  const nearestHotel = useMemo(() => {
    if (!place.lat || !place.lng || hotels.length === 0) return null
    let closest: { name: string; distanceMi: number } | null = null
    for (const h of hotels) {
      if (h.lat == null || h.lng == null) continue
      const distKm = haversineDistance(place.lat, place.lng, h.lat, h.lng)
      const distMi = distKm * KM_TO_MI
      if (!closest || distMi < closest.distanceMi) {
        closest = { name: h.name, distanceMi: distMi }
      }
    }
    return closest
  }, [place.lat, place.lng, hotels])

  async function handleExpand() {
    const willExpand = !expanded
    setExpanded(willExpand)

    // Lazy-load details on first expand
    if (willExpand && details === undefined && !detailsLoading) {
      // Don't try to fetch details for AI-generated picks (they have synthetic IDs)
      if (place.googlePlaceId.startsWith("ai-pick-")) return
      setDetailsLoading(true)
      try {
        const result = await getPlaceDetails(place.googlePlaceId)
        setDetails(result)
      } catch {
        setDetails(null)
      } finally {
        setDetailsLoading(false)
      }
    }
  }

  const mapsUrl = place.lat && place.lng
    ? `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}&query_place_id=${place.googlePlaceId}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name + " " + place.address)}`

  return (
    <div
      className={cn(
        "bg-white border rounded-2xl overflow-hidden transition-all group",
        isDismissing && "opacity-0 scale-95 translate-x-4 pointer-events-none",
        wishlistState === "MUST_DO" && "border-green-200 bg-green-50/30",
        wishlistState === "LOW" && "border-amber-200 bg-amber-50/30",
        !wishlistState && !isDismissing && "border-gray-100 hover:shadow-md",
      )}
      style={{ transition: "opacity 0.3s, transform 0.3s, background-color 0.2s" }}
    >
      {/* Clickable area for expanding */}
      <div className="cursor-pointer" onClick={handleExpand}>
        {/* Hero image with carousel */}
        <div className="relative aspect-video overflow-hidden">
          {photos.length > 0 ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photos[photoIndex]}
              alt=""
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-indigo-50 to-purple-50 flex items-center justify-center">
              <Star className="w-8 h-8 text-indigo-200" />
            </div>
          )}
          {/* Carousel arrows */}
          {photos.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); setPhotoIndex((i) => (i - 1 + photos.length) % photos.length) }}
                className="absolute left-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="Previous photo"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setPhotoIndex((i) => (i + 1) % photos.length) }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="Next photo"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              {/* Dots indicator */}
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                {photos.map((_, i) => (
                  <span
                    key={i}
                    className={cn(
                      "w-1.5 h-1.5 rounded-full transition-colors",
                      i === photoIndex ? "bg-white" : "bg-white/50"
                    )}
                  />
                ))}
              </div>
            </>
          )}
          {/* Indoor/Outdoor badge */}
          {indoorOutdoor && (
            <div className="absolute top-2 left-2">
              <span className={cn(
                "px-2 py-0.5 text-[10px] font-semibold rounded-full",
                indoorOutdoor === "Outdoor" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
              )}>
                {indoorOutdoor === "Outdoor" ? (
                  <><CloudSun className="w-3 h-3 inline mr-0.5 -mt-0.5" />{indoorOutdoor}</>
                ) : (
                  indoorOutdoor
                )}
              </span>
            </div>
          )}
          {/* Wishlist indicator */}
          {wishlistState && (
            <div className="absolute top-2 right-2">
              <span className={cn(
                "px-2 py-0.5 text-[10px] font-bold rounded-full",
                wishlistState === "MUST_DO" ? "bg-green-500 text-white" : "bg-amber-400 text-white"
              )}>
                {wishlistState === "MUST_DO" ? "Must Do" : "Maybe"}
              </span>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="p-3.5 space-y-1.5">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-900 text-sm leading-tight truncate flex-1">
              <a
                href={details?.website || mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="hover:text-indigo-600 transition-colors hover:underline"
              >
                {place.name}
              </a>
            </h3>
            {expanded ? (
              <ChevronUp className="w-4 h-4 text-gray-400 shrink-0 ml-1" />
            ) : (
              <ChevronDown className="w-4 h-4 text-gray-400 shrink-0 ml-1" />
            )}
          </div>

          {/* Stats row */}
          <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
            {place.priceLevel && PRICE_LABEL[place.priceLevel] && (
              <span className="font-semibold text-gray-700">
                {PRICE_LABEL[place.priceLevel]}
              </span>
            )}
            {place.rating != null && (
              <span className="flex items-center gap-0.5 text-yellow-600 font-medium">
                <Star className="w-3 h-3 fill-current" />
                {place.rating.toFixed(1)}
                {place.ratingCount != null && (
                  <span className="text-gray-400 font-normal">({place.ratingCount.toLocaleString()})</span>
                )}
              </span>
            )}
            {place.types?.length > 0 && (
              <span className="capitalize truncate max-w-[120px]">
                {place.types
                  .filter((t) => !["point_of_interest", "establishment", "food", "store"].includes(t))
                  .slice(0, 1)
                  .map((t) => t.replace(/_/g, " "))
                  .join(", ")}
              </span>
            )}
          </div>

          {/* Location */}
          <div className="flex items-start gap-1 text-xs text-gray-400">
            <MapPin className="w-3 h-3 shrink-0 mt-0.5" />
            <span className="line-clamp-1">{place.address}</span>
          </div>

          {/* Distance from hotel */}
          {nearestHotel && (
            <div className="flex items-start gap-1 text-xs text-gray-400">
              <Hotel className="w-3 h-3 shrink-0 mt-0.5" />
              <span className="line-clamp-1">
                {nearestHotel.distanceMi.toFixed(1)} mi from {nearestHotel.name}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3.5 pb-3 space-y-2 border-t border-gray-100 pt-2">
          {detailsLoading && (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
            </div>
          )}

          {details && !detailsLoading && (
            <div className="space-y-2 text-xs">
              {/* Full address */}
              {details.address && (
                <div className="flex items-start gap-1.5 text-gray-600">
                  <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5 text-gray-400" />
                  <span>{details.address}</span>
                </div>
              )}

              {/* Phone */}
              {details.phone && (
                <div className="flex items-center gap-1.5 text-gray-600">
                  <Phone className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                  <a href={`tel:${details.phone}`} className="hover:text-indigo-600 transition-colors">
                    {details.phone}
                  </a>
                </div>
              )}

              {/* Rating with count */}
              {details.rating != null && (
                <div className="flex items-center gap-1.5">
                  <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
                  <span className="text-gray-700 font-medium">{details.rating.toFixed(1)}</span>
                  {details.ratingCount != null && (
                    <span className="text-gray-400">({details.ratingCount.toLocaleString()} reviews)</span>
                  )}
                </div>
              )}

              {/* Opening hours */}
              {details.hours && details.hours.length > 0 && (
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 text-gray-600 font-medium">
                    <Clock className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                    <span>Hours</span>
                    {details.openNow != null && (
                      <span className={cn(
                        "text-[10px] font-semibold px-1.5 py-0.5 rounded-full",
                        details.openNow ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                      )}>
                        {details.openNow ? "Open now" : "Closed"}
                      </span>
                    )}
                  </div>
                  <div className="ml-5 text-gray-500 space-y-0.5">
                    {details.hours.map((h, i) => (
                      <div key={i}>{h}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* View on Google Maps */}
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-700 font-medium mt-1"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                View on Google Maps
              </a>

              {/* Booking links for activities/tours/attractions */}
              {isBookablePlace(place.types) && (
                <div className="flex flex-wrap gap-2 mt-1">
                  <a
                    href={`https://www.viator.com/searchResults/all?text=${encodeURIComponent(place.name + " " + destination)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 text-orange-600 hover:text-orange-700 font-medium"
                  >
                    <Ticket className="w-3.5 h-3.5" />
                    Book on Viator
                  </a>
                  <a
                    href={`https://www.getyourguide.com/s/?q=${encodeURIComponent(place.name + " " + destination)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 text-teal-600 hover:text-teal-700 font-medium"
                  >
                    <Ticket className="w-3.5 h-3.5" />
                    Book on GetYourGuide
                  </a>
                </div>
              )}
            </div>
          )}

          {/* If details fetch returned null (or AI pick with no real place ID) */}
          {details === null && !detailsLoading && (
            <div className="text-xs text-gray-400">
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-700 font-medium"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                View on Google Maps
              </a>
            </div>
          )}

          {/* Duration editor */}
          <div className="pt-2 border-t border-gray-100 mt-2">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Clock className="w-3.5 h-3.5 text-gray-400" />
              <span className="text-xs font-medium text-gray-600">
                Estimated duration: ~{formatDurationLabel(durationMins)}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DURATION_PRESETS.map((preset) => (
                <button
                  key={preset}
                  onClick={(e) => {
                    e.stopPropagation()
                    setDurationMins(preset)
                    setShowCustomDuration(false)
                    onDurationChange?.(place, preset)
                  }}
                  className={cn(
                    "px-2 py-1 text-[11px] font-medium rounded-md border transition-colors",
                    durationMins === preset && !showCustomDuration
                      ? "bg-indigo-100 border-indigo-300 text-indigo-700"
                      : "border-gray-200 text-gray-500 hover:bg-gray-50 hover:border-gray-300"
                  )}
                >
                  {formatDurationLabel(preset)}
                </button>
              ))}
              {!showCustomDuration ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowCustomDuration(true)
                    setCustomDurationValue(String(durationMins))
                  }}
                  className="px-2 py-1 text-[11px] font-medium rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50 hover:border-gray-300 transition-colors"
                >
                  Custom
                </button>
              ) : (
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="number"
                    min={15}
                    max={600}
                    value={customDurationValue}
                    onChange={(e) => setCustomDurationValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const val = parseInt(customDurationValue)
                        if (val >= 15 && val <= 600) {
                          setDurationMins(val)
                          setShowCustomDuration(false)
                          onDurationChange?.(place, val)
                        }
                      }
                    }}
                    className="w-14 px-1.5 py-1 text-[11px] border border-indigo-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    placeholder="min"
                    autoFocus
                  />
                  <button
                    onClick={() => {
                      const val = parseInt(customDurationValue)
                      if (val >= 15 && val <= 600) {
                        setDurationMins(val)
                        setShowCustomDuration(false)
                        onDurationChange?.(place, val)
                      }
                    }}
                    className="px-1.5 py-1 text-[11px] font-medium bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
                  >
                    Set
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Triage buttons */}
      <div className="px-3.5 pb-3.5">
        <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
          <button
            onClick={(e) => { e.stopPropagation(); onNope(place) }}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-500 hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-colors"
            title="Nope"
          >
            <X className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Nope</span>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onMaybe(place) }}
            className={cn(
              "flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg border transition-colors",
              wishlistState === "LOW"
                ? "bg-amber-100 border-amber-300 text-amber-700"
                : "border-gray-200 text-gray-500 hover:bg-amber-50 hover:border-amber-200 hover:text-amber-600"
            )}
            title="Maybe"
          >
            <Bookmark className={cn("w-3.5 h-3.5", wishlistState === "LOW" && "fill-amber-500")} />
            <span className="hidden sm:inline">Maybe</span>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onMustDo(place) }}
            className={cn(
              "flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg border transition-colors",
              wishlistState === "MUST_DO"
                ? "bg-green-100 border-green-300 text-green-700"
                : "border-gray-200 text-gray-500 hover:bg-green-50 hover:border-green-200 hover:text-green-600"
            )}
            title="Must Do"
          >
            <Star className={cn("w-3.5 h-3.5", wishlistState === "MUST_DO" && "fill-green-500")} />
            <span className="hidden sm:inline">Must Do</span>
          </button>
        </div>
      </div>
    </div>
  )
}
