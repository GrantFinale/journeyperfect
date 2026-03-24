"use client"

import { cn } from "@/lib/utils"

export type FilterChip = {
  id: string
  label: string
}

export const FILTER_CHIPS: FilterChip[] = [
  { id: "kid_friendly", label: "Kid-friendly" },
  { id: "open_now", label: "Open now" },
  { id: "top_rated", label: "Top rated" },
  { id: "free", label: "Free" },
  { id: "indoor", label: "Indoor" },
  { id: "outdoor", label: "Outdoor" },
]

interface DiscoverFiltersProps {
  activeFilters: Set<string>
  onToggleFilter: (filterId: string) => void
}

export function DiscoverFilters({ activeFilters, onToggleFilter }: DiscoverFiltersProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2 mb-4 -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap scrollbar-hide">
      {FILTER_CHIPS.map((chip) => (
        <button
          key={chip.id}
          onClick={() => onToggleFilter(chip.id)}
          className={cn(
            "px-3 py-1.5 text-xs font-medium rounded-full border transition-colors whitespace-nowrap shrink-0",
            activeFilters.has(chip.id)
              ? "bg-indigo-100 text-indigo-700 border-indigo-300"
              : "bg-white text-gray-500 border-gray-200 hover:border-indigo-200 hover:text-indigo-600"
          )}
        >
          {chip.label}
        </button>
      ))}
    </div>
  )
}
