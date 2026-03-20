"use client"

import { useState, useTransition } from "react"
import {
  addPackingItem,
  togglePackingItem,
  deletePackingItem,
  generatePackingList,
} from "@/lib/actions/packing"
import {
  CheckSquare,
  Square,
  Trash2,
  Plus,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Loader2,
  Package,
} from "lucide-react"
import { cn } from "@/lib/utils"

const CATEGORIES = [
  "Clothing",
  "Toiletries",
  "Electronics",
  "Documents",
  "Medical",
  "Entertainment",
  "General",
] as const

interface PackingItem {
  id: string
  tripId: string
  text: string
  category: string
  isPacked: boolean
  position: number
  createdAt: Date
}

interface PackingData {
  items: PackingItem[]
  grouped: Record<string, PackingItem[]>
  totalItems: number
  packedItems: number
}

interface PackingViewProps {
  tripId: string
  initialData: PackingData
  tripTitle: string
  userPlan: string
}

export function PackingView({ tripId, initialData, tripTitle, userPlan }: PackingViewProps) {
  const [data, setData] = useState<PackingData>(initialData)
  const [newItemText, setNewItemText] = useState("")
  const [newItemCategory, setNewItemCategory] = useState<string>("General")
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set())
  const [isPending, startTransition] = useTransition()
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isPaid = userPlan !== "FREE"
  const progressPercent = data.totalItems > 0 ? Math.round((data.packedItems / data.totalItems) * 100) : 0

  function toggleCategory(category: string) {
    setCollapsedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }

  function refreshData() {
    startTransition(async () => {
      try {
        const { getPackingList } = await import("@/lib/actions/packing")
        const fresh = await getPackingList(tripId)
        setData(fresh)
      } catch {
        // Ignore refresh errors
      }
    })
  }

  function handleAddItem(e: React.FormEvent) {
    e.preventDefault()
    if (!newItemText.trim()) return

    startTransition(async () => {
      try {
        setError(null)
        await addPackingItem(tripId, newItemText.trim(), newItemCategory)
        setNewItemText("")
        refreshData()
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add item")
      }
    })
  }

  function handleToggle(itemId: string) {
    // Optimistic update
    setData((prev) => {
      const items = prev.items.map((i) => (i.id === itemId ? { ...i, isPacked: !i.isPacked } : i))
      const grouped: Record<string, typeof items> = {}
      for (const item of items) {
        if (!grouped[item.category]) grouped[item.category] = []
        grouped[item.category].push(item)
      }
      return {
        items,
        grouped,
        totalItems: items.length,
        packedItems: items.filter((i) => i.isPacked).length,
      }
    })

    startTransition(async () => {
      try {
        await togglePackingItem(tripId, itemId)
      } catch {
        refreshData()
      }
    })
  }

  function handleDelete(itemId: string) {
    // Optimistic update
    setData((prev) => {
      const items = prev.items.filter((i) => i.id !== itemId)
      const grouped: Record<string, typeof items> = {}
      for (const item of items) {
        if (!grouped[item.category]) grouped[item.category] = []
        grouped[item.category].push(item)
      }
      return {
        items,
        grouped,
        totalItems: items.length,
        packedItems: items.filter((i) => i.isPacked).length,
      }
    })

    startTransition(async () => {
      try {
        await deletePackingItem(tripId, itemId)
      } catch {
        refreshData()
      }
    })
  }

  async function handleGenerate() {
    if (!isPaid) {
      setError("AI packing suggestions require a paid plan. Upgrade to unlock this feature.")
      return
    }

    setIsGenerating(true)
    setError(null)

    try {
      const result = await generatePackingList(tripId)
      if (result.added > 0) {
        refreshData()
      } else {
        setError("No new items to suggest — your list already looks comprehensive!")
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to generate suggestions"
      if (msg.includes("PLAN_LIMIT")) {
        setError("AI packing suggestions require a paid plan. Upgrade to unlock this feature.")
      } else {
        setError(msg)
      }
    } finally {
      setIsGenerating(false)
    }
  }

  const sortedCategories = Object.keys(data.grouped).sort()

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Packing List</h1>
        <p className="text-sm text-gray-500 mt-1">{tripTitle}</p>
      </div>

      {/* Progress bar */}
      {data.totalItems > 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">
              {data.packedItems} of {data.totalItems} packed
            </span>
            <span className="text-sm font-semibold text-gray-900">{progressPercent}%</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2.5">
            <div
              className={cn(
                "h-2.5 rounded-full transition-all duration-300",
                progressPercent === 100 ? "bg-green-500" : "bg-indigo-500"
              )}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          {progressPercent === 100 && (
            <p className="text-xs text-green-600 font-medium mt-2">All packed! Ready to go.</p>
          )}
        </div>
      )}

      {/* Add item form */}
      <form onSubmit={handleAddItem} className="bg-white border border-gray-100 rounded-2xl p-4 mb-6">
        <div className="flex gap-2">
          <input
            type="text"
            value={newItemText}
            onChange={(e) => setNewItemText(e.target.value)}
            placeholder="Add an item..."
            className="flex-1 min-w-0 px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
          />
          <select
            value={newItemCategory}
            onChange={(e) => setNewItemCategory(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
          >
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={isPending || !newItemText.trim()}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Add</span>
          </button>
        </div>
      </form>

      {/* AI Suggest button */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={handleGenerate}
          disabled={isGenerating}
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl transition-colors",
            isPaid
              ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:from-purple-700 hover:to-indigo-700"
              : "bg-gray-100 text-gray-500 cursor-not-allowed"
          )}
        >
          {isGenerating ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
          {isGenerating ? "Generating..." : "AI Suggest Items"}
        </button>
        {!isPaid && (
          <span className="text-xs text-gray-400">Paid plan required</span>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 mb-6">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Empty state */}
      {data.totalItems === 0 && (
        <div className="text-center py-12 bg-white border border-gray-100 rounded-2xl">
          <Package className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <h3 className="text-sm font-medium text-gray-900 mb-1">No items yet</h3>
          <p className="text-sm text-gray-500">
            Add items manually or use AI Suggest to get started.
          </p>
        </div>
      )}

      {/* Category sections */}
      <div className="space-y-3">
        {sortedCategories.map((category) => {
          const items = data.grouped[category]
          const isCollapsed = collapsedCategories.has(category)
          const categoryPacked = items.filter((i) => i.isPacked).length

          return (
            <div key={category} className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
              {/* Category header */}
              <button
                onClick={() => toggleCategory(category)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  {isCollapsed ? (
                    <ChevronRight className="w-4 h-4 text-gray-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-gray-400" />
                  )}
                  <span className="text-sm font-semibold text-gray-800">{category}</span>
                </div>
                <span className="text-xs text-gray-400">
                  {categoryPacked}/{items.length}
                </span>
              </button>

              {/* Items */}
              {!isCollapsed && (
                <div className="border-t border-gray-50 divide-y divide-gray-50">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 px-4 py-2.5 group hover:bg-gray-50 transition-colors"
                    >
                      <button
                        onClick={() => handleToggle(item.id)}
                        className="shrink-0 text-gray-400 hover:text-indigo-600 transition-colors"
                      >
                        {item.isPacked ? (
                          <CheckSquare className="w-5 h-5 text-green-500" />
                        ) : (
                          <Square className="w-5 h-5" />
                        )}
                      </button>
                      <span
                        className={cn(
                          "flex-1 text-sm transition-colors",
                          item.isPacked ? "text-gray-400 line-through" : "text-gray-800"
                        )}
                      >
                        {item.text}
                      </span>
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="shrink-0 opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
