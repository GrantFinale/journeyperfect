"use client"

import { useState } from "react"
import { toast } from "sonner"
import { createBudgetItem, deleteBudgetItem } from "@/lib/actions/budget"
import type { BudgetItemResult } from "@/lib/actions/budget"
import { formatCurrency } from "@/lib/utils"
import { cn } from "@/lib/utils"
import { Plus, Trash2, X, TrendingUp, DollarSign, CreditCard, Receipt } from "lucide-react"

type BudgetItem = {
  id: string
  category: string
  title: string
  amount: number
  isEstimate: boolean
  paidAt: Date | null
  notes: string | null
}

type BudgetSummary = {
  items: BudgetItem[]
  total: number
  committed: number
  estimated: number
  byCategory: Record<string, number>
}

const CATEGORIES = [
  "FLIGHTS",
  "LODGING",
  "ACTIVITIES",
  "DINING",
  "TRANSPORT",
  "SHOPPING",
  "OTHER",
] as const

type Category = (typeof CATEGORIES)[number]

const CATEGORY_LABELS: Record<Category, string> = {
  FLIGHTS: "Flights",
  LODGING: "Lodging",
  ACTIVITIES: "Activities",
  DINING: "Dining",
  TRANSPORT: "Transport",
  SHOPPING: "Shopping",
  OTHER: "Other",
}

const CATEGORY_COLORS: Record<Category, string> = {
  FLIGHTS: "bg-blue-500",
  LODGING: "bg-purple-500",
  ACTIVITIES: "bg-indigo-500",
  DINING: "bg-orange-500",
  TRANSPORT: "bg-gray-500",
  SHOPPING: "bg-pink-500",
  OTHER: "bg-teal-500",
}

const CATEGORY_LIGHT: Record<Category, string> = {
  FLIGHTS: "bg-blue-50 text-blue-700",
  LODGING: "bg-purple-50 text-purple-700",
  ACTIVITIES: "bg-indigo-50 text-indigo-700",
  DINING: "bg-orange-50 text-orange-700",
  TRANSPORT: "bg-gray-100 text-gray-700",
  SHOPPING: "bg-pink-50 text-pink-700",
  OTHER: "bg-teal-50 text-teal-700",
}

interface Props {
  tripId: string
  initialBudget: BudgetSummary
  tripTitle: string
}

export function BudgetView({ tripId, initialBudget, tripTitle }: Props) {
  const [budget, setBudget] = useState<BudgetSummary>(initialBudget)
  const [showForm, setShowForm] = useState(false)
  const [filterCategory, setFilterCategory] = useState<string>("ALL")
  const [form, setForm] = useState({
    category: "OTHER" as Category,
    title: "",
    amount: "",
    isEstimate: true,
    notes: "",
  })

  const filteredItems = budget.items.filter(
    (i) => filterCategory === "ALL" || i.category === filterCategory
  )

  async function handleAdd() {
    if (!form.title || !form.amount) {
      toast.error("Title and amount are required")
      return
    }
    const amount = parseFloat(form.amount)
    if (isNaN(amount) || amount < 0) {
      toast.error("Invalid amount")
      return
    }
    try {
      const item = await createBudgetItem(tripId, {
        category: form.category,
        title: form.title,
        amount,
        isEstimate: form.isEstimate,
        notes: form.notes || undefined,
      })
      const newItem: BudgetItem = {
        id: item.id,
        category: item.category,
        title: item.title,
        amount: item.amount,
        isEstimate: item.isEstimate,
        paidAt: item.paidAt,
        notes: item.notes,
      }
      setBudget((prev) => {
        const items = [newItem, ...prev.items]
        return {
          items,
          total: prev.total + amount,
          committed: form.isEstimate ? prev.committed : prev.committed + amount,
          estimated: form.isEstimate ? prev.estimated + amount : prev.estimated,
          byCategory: {
            ...prev.byCategory,
            [form.category]: (prev.byCategory[form.category] || 0) + amount,
          },
        }
      })
      setShowForm(false)
      setForm({ category: "OTHER", title: "", amount: "", isEstimate: true, notes: "" })
      toast.success("Item added")
    } catch {
      toast.error("Failed to add budget item")
    }
  }

  async function handleDelete(itemId: string, amount: number, category: string, isEstimate: boolean) {
    try {
      await deleteBudgetItem(tripId, itemId)
      setBudget((prev) => {
        const items = prev.items.filter((i) => i.id !== itemId)
        return {
          items,
          total: prev.total - amount,
          committed: isEstimate ? prev.committed : prev.committed - amount,
          estimated: isEstimate ? prev.estimated - amount : prev.estimated,
          byCategory: {
            ...prev.byCategory,
            [category]: (prev.byCategory[category] || 0) - amount,
          },
        }
      })
      toast.success("Item removed")
    } catch {
      toast.error("Failed to remove item")
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Budget</h1>
          <p className="text-gray-500 text-sm mt-0.5">{tripTitle}</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add expense
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white border border-gray-100 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-indigo-500" />
            <span className="text-xs font-medium text-gray-500">Total Budget</span>
          </div>
          <div className="text-2xl font-bold text-gray-900">{formatCurrency(budget.total)}</div>
        </div>
        <div className="bg-white border border-gray-100 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <CreditCard className="w-4 h-4 text-green-500" />
            <span className="text-xs font-medium text-gray-500">Committed</span>
          </div>
          <div className="text-2xl font-bold text-green-600">{formatCurrency(budget.committed)}</div>
        </div>
        <div className="bg-white border border-gray-100 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Receipt className="w-4 h-4 text-orange-500" />
            <span className="text-xs font-medium text-gray-500">Estimates</span>
          </div>
          <div className="text-2xl font-bold text-orange-600">{formatCurrency(budget.estimated)}</div>
        </div>
      </div>

      {/* Category breakdown */}
      {budget.total > 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">By Category</h2>
          <div className="space-y-3">
            {CATEGORIES.filter((c) => budget.byCategory[c] > 0).map((cat) => {
              const amount = budget.byCategory[cat] || 0
              const pct = budget.total > 0 ? (amount / budget.total) * 100 : 0
              return (
                <div key={cat}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-gray-700 font-medium">{CATEGORY_LABELS[cat]}</span>
                    <span className="text-gray-900 font-semibold">{formatCurrency(amount)}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all", CATEGORY_COLORS[cat])}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">{pct.toFixed(1)}% of total</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Add form */}
      {showForm && (
        <div className="bg-white border border-indigo-200 rounded-2xl p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Add Budget Item</h3>
            <button onClick={() => setShowForm(false)}>
              <X className="w-4 h-4 text-gray-400" />
            </button>
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Category</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as Category }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Amount ($)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            <input
              type="text"
              placeholder="Description *"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <input
              type="text"
              placeholder="Notes (optional)"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={form.isEstimate}
                onChange={(e) => setForm((f) => ({ ...f, isEstimate: e.target.checked }))}
                className="rounded"
              />
              This is an estimate (not yet paid)
            </label>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setShowForm(false)}
                className="flex-1 py-2.5 border border-gray-200 text-gray-700 text-sm rounded-xl hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                className="flex-1 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700"
              >
                Add item
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Category filter */}
      <div className="flex gap-1 flex-wrap mb-4">
        <button
          onClick={() => setFilterCategory("ALL")}
          className={cn(
            "px-3 py-1.5 text-xs font-medium rounded-lg transition-colors",
            filterCategory === "ALL"
              ? "bg-indigo-600 text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          )}
        >
          All
        </button>
        {CATEGORIES.filter((c) => budget.byCategory[c] > 0).map((c) => (
          <button
            key={c}
            onClick={() => setFilterCategory(c)}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-lg transition-colors",
              filterCategory === c
                ? "bg-indigo-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            )}
          >
            {CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>

      {/* Items list */}
      {filteredItems.length === 0 && (
        <div className="text-center py-16">
          <DollarSign className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">No budget items yet</p>
          <p className="text-gray-400 text-xs mt-1">Add flights, hotels, and activities to track your spending</p>
        </div>
      )}

      <div className="space-y-2">
        {filteredItems.map((item) => (
          <div
            key={item.id}
            className="bg-white border border-gray-100 rounded-xl px-4 py-3 flex items-center gap-3 group hover:border-gray-200 transition-colors"
          >
            <div
              className={cn(
                "w-8 h-8 rounded-lg flex items-center justify-center text-xs font-semibold shrink-0",
                CATEGORY_LIGHT[item.category as Category] || "bg-gray-100 text-gray-600"
              )}
            >
              {CATEGORY_LABELS[item.category as Category]?.charAt(0) || "?"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm text-gray-900 truncate">{item.title}</div>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span>{CATEGORY_LABELS[item.category as Category]}</span>
                <span className={cn("font-medium", item.isEstimate ? "text-orange-600" : "text-green-600")}>
                  {item.isEstimate ? "Estimate" : "Paid"}
                </span>
                {item.notes && <span className="truncate">{item.notes}</span>}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="font-semibold text-gray-900">{formatCurrency(item.amount)}</div>
            </div>
            <button
              onClick={() => handleDelete(item.id, item.amount, item.category, item.isEstimate)}
              className="p-1 text-gray-400 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
