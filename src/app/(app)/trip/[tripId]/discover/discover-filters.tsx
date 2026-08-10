"use client"

import { cn } from "@/lib/utils"

export type RefinementChip = {
  id: string
  label: string
}

/**
 * Cross-cutting refinements only — things that narrow *any* category.
 *
 * Deliberately excluded, because they were a second row of pseudo-categories
 * rather than refinements: "Top rated" (results already sort by rating desc),
 * "Kid-friendly" (duplicates the Family tab), and "Indoor"/"Outdoor" (overlap
 * the Outdoors tab and are only weakly inferrable from Places types).
 */
export const REFINEMENT_CHIPS: RefinementChip[] = [
  { id: "open_now", label: "Open now" },
  { id: "free", label: "Free" },
]

/** 1 statute mile in metres. */
export const METERS_PER_MILE = 1609.34

/** Distance presets, in miles. 0 means "no distance limit". */
export const RADIUS_OPTIONS: { label: string; miles: number }[] = [
  { label: "Any distance", miles: 0 },
  { label: "0.5 mi", miles: 0.5 },
  { label: "1 mi", miles: 1 },
  { label: "2 mi", miles: 2 },
  { label: "5 mi", miles: 5 },
  { label: "10 mi", miles: 10 },
]

interface DiscoverFiltersProps {
  activeFilters: Set<string>
  onToggleFilter: (filterId: string) => void
  /** Selected radius in miles; 0 = any distance. */
  radiusMi: number
  onRadiusChange: (miles: number) => void
  /**
   * What the radius is measured from — a hotel name, or a city when the trip
   * has no geocoded hotel. Omitted when nothing can be measured from, in which
   * case the control is hidden rather than shown doing nothing.
   */
  anchorLabel?: string | null
}

export function DiscoverFilters({
  activeFilters,
  onToggleFilter,
  radiusMi,
  onRadiusChange,
  anchorLabel,
}: DiscoverFiltersProps) {
  const radiusActive = radiusMi > 0

  return (
    // Horizontally scrollable so the distance control stays reachable on
    // mobile without wrapping into a second row.
    <div className="flex items-center gap-2 mb-4 overflow-x-auto scrollbar-hide">
      <span className="text-[11px] font-medium text-gray-400 shrink-0">Refine:</span>
      {REFINEMENT_CHIPS.map((chip) => (
        <button
          key={chip.id}
          onClick={() => onToggleFilter(chip.id)}
          className={cn(
            // Deliberately unlike the category pills: squared, dashed, ghosted
            // and smaller, so this reads as subordinate rather than a 2nd row.
            "px-2.5 py-1 text-[11px] font-medium rounded-md border border-dashed transition-colors whitespace-nowrap shrink-0",
            activeFilters.has(chip.id)
              ? "border-solid border-indigo-400 bg-indigo-50 text-indigo-700"
              : "border-gray-300 bg-transparent text-gray-500 hover:border-gray-400 hover:text-gray-700"
          )}
        >
          {chip.label}
        </button>
      ))}

      {/* Distance from the hotel — same subordinate treatment as the chips. */}
      {anchorLabel && (
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[11px] font-medium text-gray-400 shrink-0 ml-1">Within:</span>
          <select
            value={radiusMi}
            onChange={(e) => onRadiusChange(Number(e.target.value))}
            aria-label={`Maximum distance from ${anchorLabel}`}
            className={cn(
              "px-2 py-1 text-[11px] font-medium rounded-md border border-dashed bg-transparent",
              "transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-indigo-400",
              radiusActive
                ? "border-solid border-indigo-400 bg-indigo-50 text-indigo-700"
                : "border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700"
            )}
          >
            {RADIUS_OPTIONS.map((opt) => (
              <option key={opt.miles} value={opt.miles}>
                {opt.label}
              </option>
            ))}
          </select>
          <span
            className={cn(
              "text-[11px] whitespace-nowrap max-w-[180px] truncate",
              radiusActive ? "text-gray-600" : "text-gray-400"
            )}
            title={anchorLabel}
          >
            of {anchorLabel}
          </span>
        </div>
      )}
    </div>
  )
}
