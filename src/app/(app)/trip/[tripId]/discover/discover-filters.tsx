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

interface DiscoverFiltersProps {
  activeFilters: Set<string>
  onToggleFilter: (filterId: string) => void
}

export function DiscoverFilters({ activeFilters, onToggleFilter }: DiscoverFiltersProps) {
  return (
    <div className="flex items-center gap-2 mb-4">
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
    </div>
  )
}
