"use client"

import Link from "next/link"
import { useDraggable, useDroppable } from "@dnd-kit/core"
import {
  ChevronRight,
  ChevronLeft,
  X,
  Clock,
  Sun,
  Home,
  Compass,
} from "lucide-react"
import { cn } from "@/lib/utils"

export type WishlistActivity = {
  id: string
  name: string
  durationMins: number
  priority: string // "MUST_DO" | "HIGH" | "MEDIUM" | "LOW"
  indoorOutdoor: string // "INDOOR" | "OUTDOOR" | "BOTH"
  imageUrl: string | null
  category: string | null
  lat: number | null
  lng: number | null
  address: string | null
}

interface WishlistPanelProps {
  tripId: string
  activities: WishlistActivity[]
  onRemove: (activityId: string) => void
  onTogglePriority: (activityId: string) => void
  collapsed: boolean
  onToggleCollapse: () => void
}

function IndoorOutdoorBadge({ value }: { value: string }) {
  if (value === "INDOOR") {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600">
        <Home className="w-2.5 h-2.5" />
        Indoor
      </span>
    )
  }
  if (value === "OUTDOOR") {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600">
        <Sun className="w-2.5 h-2.5" />
        Outdoor
      </span>
    )
  }
  return null
}

function DraggableWishlistItem({
  activity,
  onRemove,
  onTogglePriority,
}: {
  activity: WishlistActivity
  onRemove: () => void
  onTogglePriority: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: activity.id,
    data: { type: "wishlist-item", activity },
  })

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        zIndex: isDragging ? 50 : undefined,
        opacity: isDragging ? 0.5 : 1,
      }
    : undefined

  const isMustDo = activity.priority === "MUST_DO"

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "group relative bg-white border rounded-xl p-2.5 cursor-grab active:cursor-grabbing transition-all touch-none",
        isMustDo ? "border-green-200 bg-green-50/30" : "border-gray-200",
        isDragging && "shadow-lg"
      )}
    >
      <div className="flex items-start gap-2">
        {/* Thumbnail */}
        {activity.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={activity.imageUrl}
            alt=""
            className="w-10 h-10 rounded-lg object-cover shrink-0"
          />
        ) : (
          <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
            <Compass className="w-4 h-4 text-gray-400" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">
            {activity.name}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span className="flex items-center gap-0.5 text-[10px] text-gray-500">
              <Clock className="w-2.5 h-2.5" />
              {activity.durationMins >= 60
                ? `${Math.floor(activity.durationMins / 60)}h${activity.durationMins % 60 > 0 ? ` ${activity.durationMins % 60}m` : ""}`
                : `${activity.durationMins}m`}
            </span>
            <IndoorOutdoorBadge value={activity.indoorOutdoor} />
          </div>
        </div>
        {/* Remove button */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            onRemove()
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-red-500 transition-all shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {/* Priority toggle */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          onTogglePriority()
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className={cn(
          "mt-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full transition-colors",
          isMustDo
            ? "bg-green-100 text-green-700 hover:bg-green-200"
            : "bg-amber-100 text-amber-700 hover:bg-amber-200"
        )}
      >
        {isMustDo ? "Must Do" : "Maybe"}
      </button>
    </div>
  )
}

// Droppable zone for returning items to sidebar
function WishlistDropZone() {
  const { isOver, setNodeRef } = useDroppable({ id: "wishlist-drop-zone" })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "border-2 border-dashed rounded-xl p-3 text-center transition-all",
        isOver
          ? "border-amber-400 bg-amber-50 text-amber-700"
          : "border-gray-200 text-gray-400"
      )}
    >
      <p className="text-xs font-medium">
        {isOver ? "Drop to return to wishlist" : "Drag here to unschedule"}
      </p>
    </div>
  )
}

export function WishlistPanel({
  tripId,
  activities,
  onRemove,
  onTogglePriority,
  collapsed,
  onToggleCollapse,
}: WishlistPanelProps) {
  const mustDo = activities.filter((a) => a.priority === "MUST_DO")
  const maybe = activities.filter((a) => a.priority !== "MUST_DO")

  return (
    <div
      className={cn(
        "border-l border-gray-200 bg-gray-50/50 flex flex-col transition-all duration-200 shrink-0",
        collapsed ? "w-10" : "w-72 lg:w-80"
      )}
    >
      {/* Toggle button */}
      <button
        onClick={onToggleCollapse}
        className="flex items-center justify-center h-10 border-b border-gray-200 hover:bg-gray-100 transition-colors"
        title={collapsed ? "Show wishlist" : "Hide wishlist"}
      >
        {collapsed ? (
          <ChevronLeft className="w-4 h-4 text-gray-500" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-500" />
        )}
      </button>

      {!collapsed && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <h3 className="text-sm font-semibold text-gray-900 px-1">
            Wishlist
          </h3>

          {activities.length === 0 ? (
            <div className="text-center py-8 px-4">
              <Compass className="w-8 h-8 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-500 leading-relaxed">
                Browse activities, restaurants, and tours in Discover, then mark
                the ones you like to add them here.
              </p>
              <Link
                href={`/trip/${tripId}/discover`}
                className="inline-flex items-center gap-1.5 mt-4 text-sm font-medium text-indigo-600 hover:text-indigo-700 transition-colors"
              >
                Go to Discover
                <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          ) : (
            <>
              {/* Drop zone for returning items */}
              <WishlistDropZone />

              {/* Must Do section */}
              {mustDo.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-green-600 mb-1.5 px-1">
                    Must Do
                  </p>
                  <div className="space-y-1.5">
                    {mustDo.map((a) => (
                      <DraggableWishlistItem
                        key={a.id}
                        activity={a}
                        onRemove={() => onRemove(a.id)}
                        onTogglePriority={() => onTogglePriority(a.id)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Maybe section */}
              {maybe.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 mb-1.5 px-1">
                    Maybe
                  </p>
                  <div className="space-y-1.5">
                    {maybe.map((a) => (
                      <DraggableWishlistItem
                        key={a.id}
                        activity={a}
                        onRemove={() => onRemove(a.id)}
                        onTogglePriority={() => onTogglePriority(a.id)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
