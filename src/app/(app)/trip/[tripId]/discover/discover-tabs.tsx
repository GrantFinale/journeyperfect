"use client"

import { cn } from "@/lib/utils"
import { Sparkles } from "lucide-react"

export type CategoryTab = {
  id: string
  label: string
  query: string
  types?: string[]
  isAI?: boolean
}

export const CATEGORY_TABS: CategoryTab[] = [
  { id: "all", label: "All", query: "" },
  {
    id: "attractions",
    label: "Attractions",
    query: "tourist attraction museum art gallery",
    types: ["tourist_attraction", "museum", "art_gallery", "amusement_park"],
  },
  {
    id: "dining",
    label: "Dining",
    query: "restaurant cafe bar bakery",
    types: ["restaurant", "cafe", "bar", "bakery"],
  },
  {
    id: "tours",
    label: "Tours",
    query: "guided tour walking tour sightseeing",
    types: ["travel_agency"],
  },
  {
    id: "shopping",
    label: "Shopping",
    query: "shopping mall store clothing book",
    types: ["shopping_mall", "store", "clothing_store", "book_store"],
  },
  {
    id: "nightlife",
    label: "Nightlife",
    query: "nightlife club bar casino",
    types: ["night_club", "bar", "casino"],
  },
  {
    id: "outdoors",
    label: "Outdoors",
    query: "park campground hiking beach nature trail",
    types: ["park", "campground", "hiking_area"],
  },
  {
    id: "family",
    label: "Family",
    query: "family friendly kids children amusement",
  },
  {
    id: "ai_picks",
    label: "For Your Group",
    query: "__ai_picks__",
    isAI: true,
  },
]

interface DiscoverTabsProps {
  activeTab: string
  onTabChange: (tab: CategoryTab) => void
}

export function DiscoverTabs({ activeTab, onTabChange }: DiscoverTabsProps) {
  return (
    <div className="flex gap-1 overflow-x-auto pb-2 mb-3 -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap scrollbar-hide">
      {CATEGORY_TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab)}
          className={cn(
            "px-3.5 py-2 text-xs font-medium rounded-full border transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5",
            activeTab === tab.id
              ? tab.isAI
                ? "bg-purple-600 text-white border-purple-600"
                : "bg-gray-900 text-white border-gray-900"
              : "bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:text-gray-900"
          )}
        >
          {tab.isAI && <Sparkles className="w-3 h-3" />}
          {tab.label}
          {tab.isAI && !activeTab && (
            <span className="text-[9px] font-bold bg-purple-100 text-purple-700 px-1 py-0.5 rounded-sm leading-none">AI</span>
          )}
        </button>
      ))}
    </div>
  )
}
