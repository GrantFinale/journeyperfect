"use client"

import { cn } from "@/lib/utils"
import { Sparkles } from "lucide-react"

export type FilterDef = { label: string; query: string }

export const ACTIVITY_FILTERS: FilterDef[] = [
  { label: "AI Picks", query: "__ai_picks__" },
  { label: "Museums", query: "museum gallery" },
  { label: "Outdoors/Parks", query: "outdoor park nature hiking trail" },
  { label: "Cultural", query: "cultural heritage historical monument" },
  { label: "Food & Drink", query: "food drink market tour tasting" },
  { label: "Nightlife", query: "nightlife bar club lounge" },
  { label: "Family", query: "family kids children amusement" },
  { label: "Shopping", query: "shopping market boutique" },
  { label: "Tours", query: "guided tour walking tour" },
]

interface FilterChipsProps {
  filters: FilterDef[]
  activeFilter: string | null
  onSelect: (filter: FilterDef) => void
}

export function FilterChips({ filters, activeFilter, onSelect }: FilterChipsProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2 mb-4 -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap scrollbar-hide">
      {filters.map((filter) => (
        <button
          key={filter.query}
          onClick={() => onSelect(filter)}
          className={cn(
            "px-3 py-1.5 text-xs font-medium rounded-full border transition-colors whitespace-nowrap shrink-0 flex items-center gap-1",
            activeFilter === filter.query
              ? filter.query === "__ai_picks__"
                ? "bg-purple-600 text-white border-purple-600"
                : "bg-indigo-600 text-white border-indigo-600"
              : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300 hover:text-indigo-600"
          )}
        >
          {filter.query === "__ai_picks__" && <Sparkles className="w-3 h-3" />}
          {filter.label}
        </button>
      ))}
    </div>
  )
}
