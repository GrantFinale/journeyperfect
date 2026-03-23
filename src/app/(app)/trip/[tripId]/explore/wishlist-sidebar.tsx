"use client"

import { Star, Bookmark, X, ArrowUp, ArrowDown, Sparkles, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

export type Activity = {
  id: string
  name: string
  description: string | null
  address: string | null
  lat: number | null
  lng: number | null
  googlePlaceId: string | null
  category: string | null
  durationMins: number
  costPerAdult: number
  priority: string
  status: string
  rating: number | null
  imageUrl: string | null
  notes: string | null
  indoorOutdoor?: string
}

function IndoorOutdoorBadge({ value }: { value?: string }) {
  if (!value || value === "BOTH") return null
  return (
    <span className={cn(
      "px-1.5 py-0.5 text-[9px] font-semibold rounded-full",
      value === "OUTDOOR" ? "bg-green-100 text-green-600" : "bg-blue-100 text-blue-600"
    )}>
      {value === "OUTDOOR" ? "Outdoor" : "Indoor"}
    </span>
  )
}

interface WishlistItemProps {
  activity: Activity
  onRemove: (id: string) => void
  onUpgrade?: (id: string) => void
  onDowngrade?: (id: string) => void
}

function WishlistItem({ activity, onRemove, onUpgrade, onDowngrade }: WishlistItemProps) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg group/item hover:bg-gray-50 transition-colors">
      {activity.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={activity.imageUrl} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0" />
      ) : (
        <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
          <Star className="w-4 h-4 text-gray-300" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-gray-900 truncate">{activity.name}</div>
        <div className="flex items-center gap-1 mt-0.5">
          <span className="text-[10px] text-gray-400">{activity.durationMins} min</span>
          <IndoorOutdoorBadge value={activity.indoorOutdoor} />
        </div>
      </div>
      {/* Action buttons */}
      <div className="flex items-center gap-0.5 shrink-0">
        {onUpgrade && (
          <button
            onClick={(e) => { e.stopPropagation(); onUpgrade(activity.id) }}
            className="p-0.5 text-gray-300 hover:text-green-500 opacity-0 group-hover/item:opacity-100 transition-opacity"
            title="Upgrade to Must Do"
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
        )}
        {onDowngrade && (
          <button
            onClick={(e) => { e.stopPropagation(); onDowngrade(activity.id) }}
            className="p-0.5 text-gray-300 hover:text-amber-500 opacity-0 group-hover/item:opacity-100 transition-opacity"
            title="Downgrade to Maybe"
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(activity.id) }}
          className="p-0.5 text-gray-300 hover:text-red-500 opacity-0 group-hover/item:opacity-100 transition-opacity"
          title="Remove"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

interface WishlistSidebarProps {
  mustDoItems: Activity[]
  maybeItems: Activity[]
  onRemove: (id: string) => void
  onUpgradeToMustDo: (id: string) => void
  onDowngradeToMaybe: (id: string) => void
  onClose: () => void
  onAIFill: () => void
  isAIFilling: boolean
  isMobile?: boolean
}

export function WishlistSidebar({
  mustDoItems,
  maybeItems,
  onRemove,
  onUpgradeToMustDo,
  onDowngradeToMaybe,
  onClose,
  onAIFill,
  isAIFilling,
  isMobile,
}: WishlistSidebarProps) {
  const totalCount = mustDoItems.length + maybeItems.length

  const content = (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-gray-900 text-sm">Wishlist ({totalCount})</h2>
        <button onClick={onClose} className="p-1">
          <X className="w-4 h-4 text-gray-400" />
        </button>
      </div>

      {totalCount === 0 && (
        <div className="text-center py-8">
          <Bookmark className="w-8 h-8 text-gray-200 mx-auto mb-2" />
          <p className="text-xs text-gray-400">Tap Maybe or Must Do on any card to save it here</p>
        </div>
      )}

      {/* Must Do section */}
      {mustDoItems.length > 0 && (
        <div className="mb-4">
          <h3 className="text-xs font-semibold text-green-600 mb-1.5 flex items-center gap-1">
            <Star className="w-3 h-3 fill-green-500 text-green-500" />
            Must Do ({mustDoItems.length})
          </h3>
          <div className="space-y-0.5 bg-green-50/50 rounded-xl p-1.5 border border-green-100">
            {mustDoItems.map((a) => (
              <WishlistItem
                key={a.id}
                activity={a}
                onRemove={onRemove}
                onDowngrade={onDowngradeToMaybe}
              />
            ))}
          </div>
        </div>
      )}

      {/* Maybe section */}
      {maybeItems.length > 0 && (
        <div className="mb-4">
          <h3 className="text-xs font-semibold text-amber-600 mb-1.5 flex items-center gap-1">
            <Bookmark className="w-3 h-3 fill-amber-400 text-amber-400" />
            Maybe ({maybeItems.length})
          </h3>
          <div className="space-y-0.5 bg-amber-50/50 rounded-xl p-1.5 border border-amber-100">
            {maybeItems.map((a) => (
              <WishlistItem
                key={a.id}
                activity={a}
                onRemove={onRemove}
                onUpgrade={onUpgradeToMustDo}
              />
            ))}
          </div>
        </div>
      )}

      {/* AI Fill Itinerary button */}
      {totalCount > 0 && (
        <button
          onClick={onAIFill}
          disabled={isAIFilling}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors mt-2"
        >
          {isAIFilling ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Building itinerary...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              AI Fill My Itinerary
            </>
          )}
        </button>
      )}
    </div>
  )

  if (isMobile) {
    return (
      <div className="fixed inset-0 z-40">
        <div className="absolute inset-0 bg-black/40" onClick={onClose} />
        <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl max-h-[75vh] overflow-y-auto pb-24">
          {content}
        </div>
      </div>
    )
  }

  return (
    <div className="w-80 border-l border-gray-200 bg-white overflow-y-auto">
      {content}
    </div>
  )
}
