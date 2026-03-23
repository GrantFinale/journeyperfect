"use client"

import { useState, useRef } from "react"
import { Star, MapPin, X, Bookmark, CloudSun } from "lucide-react"
import { cn } from "@/lib/utils"

export type Place = {
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
  openNow?: boolean
}

const PRICE_LABEL: Record<string, string> = {
  PRICE_LEVEL_FREE: "Free",
  PRICE_LEVEL_INEXPENSIVE: "$",
  PRICE_LEVEL_MODERATE: "$$",
  PRICE_LEVEL_EXPENSIVE: "$$$",
  PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
}

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
  isDismissing?: boolean
}

export function BrowseCard({
  place,
  wishlistState,
  onNope,
  onMaybe,
  onMustDo,
  isDismissing,
}: BrowseCardProps) {
  const indoorOutdoor = classifyIndoorOutdoorFromTypes(place.types)

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
      {/* Hero image */}
      <div className="relative aspect-video overflow-hidden">
        {place.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={place.imageUrl}
            alt=""
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-indigo-50 to-purple-50 flex items-center justify-center">
            <Star className="w-8 h-8 text-indigo-200" />
          </div>
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
        <h3 className="font-semibold text-gray-900 text-sm leading-tight truncate">
          {place.name}
        </h3>

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

        {/* Triage buttons */}
        <div className="flex items-center gap-2 pt-2 border-t border-gray-100 mt-2">
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
