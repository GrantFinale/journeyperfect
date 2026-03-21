"use client"

import { useState, useEffect, useCallback } from "react"
import { toast } from "sonner"
import { createBudgetItem, deleteBudgetItem } from "@/lib/actions/budget"
import type { BudgetItemResult } from "@/lib/actions/budget"
import type { TripPerson } from "@/lib/actions/expenses"
import { cn } from "@/lib/utils"
import { formatCurrency } from "@/lib/utils"
import { Plus, Trash2, X, TrendingUp, DollarSign, CreditCard, Receipt, ArrowRightLeft, ArrowRight, Users, Plane, Hotel as HotelIcon, Car, Star } from "lucide-react"
import {
  CURRENCIES,
  type CurrencyCode,
  getExchangeRates,
  convertCurrency,
  formatCurrencyAmount,
} from "@/lib/currency"

type BudgetItem = {
  id: string
  category: string
  title: string
  amount: number
  currency: string
  isEstimate: boolean
  paidAt: Date | null
  notes: string | null
  paidBy: string | null
  splitAmong: string[]
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

type CostSummary = {
  flights: number
  hotels: number
  activities: number
  dining: number
  transport: number
  other: number
  totalPaid: number
  totalEstimated: number
  grandTotal: number
}

interface Props {
  tripId: string
  initialBudget: BudgetSummary
  tripTitle: string
  costSummary: CostSummary
  settlements: { from: string; to: string; amount: number }[]
  balances: Record<string, number>
  people: TripPerson[]
}

export function BudgetView({ tripId, initialBudget, tripTitle, costSummary, settlements, balances, people }: Props) {
  const [budget, setBudget] = useState<BudgetSummary>(initialBudget)
  const [showForm, setShowForm] = useState(false)
  const [filterCategory, setFilterCategory] = useState<string>("ALL")
  const [baseCurrency, setBaseCurrency] = useState<CurrencyCode>("USD")
  const [rates, setRates] = useState<Record<string, number>>({})
  const [ratesLoading, setRatesLoading] = useState(false)
  const [form, setForm] = useState({
    category: "OTHER" as Category,
    title: "",
    amount: "",
    currency: "USD" as CurrencyCode,
    isEstimate: true,
    notes: "",
    paidBy: "",
    splitAmong: [] as string[],
  })

  const fetchRates = useCallback(async () => {
    setRatesLoading(true)
    try {
      const r = await getExchangeRates("USD")
      setRates(r)
    } catch {
      // fallback
    } finally {
      setRatesLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRates()
  }, [fetchRates])

  // Compute converted totals
  const hasRates = Object.keys(rates).length > 0

  function convertToBase(amount: number, fromCurrency: string): number {
    if (!hasRates || fromCurrency === baseCurrency) return amount
    return convertCurrency(amount, fromCurrency, baseCurrency, rates)
  }

  const convertedTotal = budget.items.reduce(
    (sum, i) => sum + convertToBase(i.amount, i.currency || "USD"),
    0
  )
  const convertedCommitted = budget.items
    .filter((i) => !i.isEstimate)
    .reduce((sum, i) => sum + convertToBase(i.amount, i.currency || "USD"), 0)
  const convertedEstimated = budget.items
    .filter((i) => i.isEstimate)
    .reduce((sum, i) => sum + convertToBase(i.amount, i.currency || "USD"), 0)
  const convertedByCategory = budget.items.reduce(
    (acc, item) => {
      acc[item.category] =
        (acc[item.category] || 0) +
        convertToBase(item.amount, item.currency || "USD")
      return acc
    },
    {} as Record<string, number>
  )

  const filteredItems = budget.items.filter(
    (i) => filterCategory === "ALL" || i.category === filterCategory
  )

  const peopleNames = people.map((p) => p.name)

  function toggleSplitPerson(name: string) {
    setForm((f) => ({
      ...f,
      splitAmong: f.splitAmong.includes(name)
        ? f.splitAmong.filter((n) => n !== name)
        : [...f.splitAmong, name],
    }))
  }

  function selectAllSplit() {
    setForm((f) => ({ ...f, splitAmong: [...peopleNames] }))
  }

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
        currency: form.currency,
        isEstimate: form.isEstimate,
        notes: form.notes || undefined,
        paidBy: form.paidBy || undefined,
        splitAmong: form.splitAmong.length > 0 ? form.splitAmong : undefined,
      })
      const newItem: BudgetItem = {
        id: item.id,
        category: item.category,
        title: item.title,
        amount: item.amount,
        currency: item.currency,
        isEstimate: item.isEstimate,
        paidAt: item.paidAt,
        notes: item.notes,
        paidBy: item.paidBy,
        splitAmong: item.splitAmong,
      }
      setBudget((prev) => ({
        items: [newItem, ...prev.items],
        total: prev.total + amount,
        committed: form.isEstimate ? prev.committed : prev.committed + amount,
        estimated: form.isEstimate ? prev.estimated + amount : prev.estimated,
        byCategory: {
          ...prev.byCategory,
          [form.category]: (prev.byCategory[form.category] || 0) + amount,
        },
      }))
      setShowForm(false)
      setForm({
        category: "OTHER",
        title: "",
        amount: "",
        currency: form.currency,
        isEstimate: true,
        notes: "",
        paidBy: "",
        splitAmong: [],
      })
      toast.success("Item added")
    } catch {
      toast.error("Failed to add budget item")
    }
  }

  async function handleDelete(
    itemId: string,
    amount: number,
    category: string,
    isEstimate: boolean
  ) {
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

      {/* Trip Currency Selector */}
      <div className="flex items-center gap-3 mb-6 bg-white border border-gray-100 rounded-2xl px-4 py-3">
        <ArrowRightLeft className="w-4 h-4 text-gray-400" />
        <span className="text-sm text-gray-600 font-medium">
          Trip Currency
        </span>
        <select
          value={baseCurrency}
          onChange={(e) => setBaseCurrency(e.target.value as CurrencyCode)}
          className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
        >
          {CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.symbol} {c.code} - {c.name}
            </option>
          ))}
        </select>
        {ratesLoading && (
          <span className="text-xs text-gray-400">Loading rates...</span>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white border border-gray-100 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-indigo-500" />
            <span className="text-xs font-medium text-gray-500">
              Total Budget
            </span>
          </div>
          <div className="text-2xl font-bold text-gray-900">
            {formatCurrencyAmount(convertedTotal, baseCurrency)}
          </div>
        </div>
        <div className="bg-white border border-gray-100 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <CreditCard className="w-4 h-4 text-green-500" />
            <span className="text-xs font-medium text-gray-500">
              Committed
            </span>
          </div>
          <div className="text-2xl font-bold text-green-600">
            {formatCurrencyAmount(convertedCommitted, baseCurrency)}
          </div>
        </div>
        <div className="bg-white border border-gray-100 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Receipt className="w-4 h-4 text-orange-500" />
            <span className="text-xs font-medium text-gray-500">
              Estimates
            </span>
          </div>
          <div className="text-2xl font-bold text-orange-600">
            {formatCurrencyAmount(convertedEstimated, baseCurrency)}
          </div>
        </div>
      </div>

      {/* Trip Cost Estimate (flights + hotels + rental cars + budget items) */}
      {costSummary.grandTotal > 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="w-4 h-4 text-green-600" />
            <h2 className="text-sm font-semibold text-gray-700">Trip Cost Estimate</h2>
          </div>
          <div className="text-2xl font-bold text-gray-900 mb-4">
            {formatCurrency(costSummary.grandTotal)}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {costSummary.flights > 0 && (
              <div className="flex items-center gap-2 bg-blue-50 rounded-xl px-3 py-2">
                <Plane className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span className="text-xs text-blue-800">Flights</span>
                <span className="text-xs font-semibold text-blue-900 ml-auto">{formatCurrency(costSummary.flights)}</span>
              </div>
            )}
            {costSummary.hotels > 0 && (
              <div className="flex items-center gap-2 bg-purple-50 rounded-xl px-3 py-2">
                <HotelIcon className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                <span className="text-xs text-purple-800">Hotels</span>
                <span className="text-xs font-semibold text-purple-900 ml-auto">{formatCurrency(costSummary.hotels)}</span>
              </div>
            )}
            {costSummary.transport > 0 && (
              <div className="flex items-center gap-2 bg-green-50 rounded-xl px-3 py-2">
                <Car className="w-3.5 h-3.5 text-green-600 shrink-0" />
                <span className="text-xs text-green-800">Transport</span>
                <span className="text-xs font-semibold text-green-900 ml-auto">{formatCurrency(costSummary.transport)}</span>
              </div>
            )}
            {costSummary.activities > 0 && (
              <div className="flex items-center gap-2 bg-amber-50 rounded-xl px-3 py-2">
                <Star className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span className="text-xs text-amber-800">Activities</span>
                <span className="text-xs font-semibold text-amber-900 ml-auto">{formatCurrency(costSummary.activities)}</span>
              </div>
            )}
            {costSummary.dining > 0 && (
              <div className="flex items-center gap-2 bg-orange-50 rounded-xl px-3 py-2">
                <span className="text-xs text-orange-800 shrink-0">F</span>
                <span className="text-xs text-orange-800">Dining</span>
                <span className="text-xs font-semibold text-orange-900 ml-auto">{formatCurrency(costSummary.dining)}</span>
              </div>
            )}
            {costSummary.other > 0 && (
              <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
                <span className="text-xs text-gray-600 shrink-0">$</span>
                <span className="text-xs text-gray-800">Other</span>
                <span className="text-xs font-semibold text-gray-900 ml-auto">{formatCurrency(costSummary.other)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Settlements section */}
      {settlements.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-4 h-4 text-indigo-500" />
            <h2 className="text-sm font-semibold text-gray-700">Settlements</h2>
          </div>
          <p className="text-xs text-gray-500 mb-3">To settle all expenses, these payments are needed:</p>
          <div className="space-y-2">
            {settlements.map((s, i) => (
              <div
                key={i}
                className="flex items-center gap-3 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3"
              >
                <span className="text-sm font-medium text-gray-900">{s.from}</span>
                <ArrowRight className="w-4 h-4 text-amber-600 shrink-0" />
                <span className="text-sm font-medium text-gray-900">{s.to}</span>
                <span className="ml-auto text-sm font-bold text-amber-700">
                  {formatCurrency(s.amount)}
                </span>
              </div>
            ))}
          </div>

          {/* Individual balances */}
          <div className="mt-4 pt-4 border-t border-gray-100">
            <h3 className="text-xs font-medium text-gray-500 mb-2">Individual Balances</h3>
            <div className="flex flex-wrap gap-2">
              {Object.entries(balances)
                .filter(([, v]) => Math.abs(v) > 0.01)
                .sort((a, b) => b[1] - a[1])
                .map(([name, balance]) => (
                  <div
                    key={name}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-medium",
                      balance > 0
                        ? "bg-green-50 text-green-700 border border-green-100"
                        : "bg-red-50 text-red-700 border border-red-100"
                    )}
                  >
                    {name}: {balance > 0 ? "+" : ""}
                    {formatCurrency(Math.abs(balance))}
                    {balance > 0 ? " (owed)" : " (owes)"}
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Category breakdown */}
      {convertedTotal > 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">
            By Category
          </h2>
          <div className="space-y-3">
            {CATEGORIES.filter((c) => (convertedByCategory[c] || 0) > 0).map(
              (cat) => {
                const amount = convertedByCategory[cat] || 0
                const pct =
                  convertedTotal > 0 ? (amount / convertedTotal) * 100 : 0
                return (
                  <div key={cat}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-gray-700 font-medium">
                        {CATEGORY_LABELS[cat]}
                      </span>
                      <span className="text-gray-900 font-semibold">
                        {formatCurrencyAmount(amount, baseCurrency)}
                      </span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          CATEGORY_COLORS[cat]
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {pct.toFixed(1)}% of total
                    </div>
                  </div>
                )
              }
            )}
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
                <label className="block text-xs text-gray-500 mb-1">
                  Category
                </label>
                <select
                  value={form.category}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      category: e.target.value as Category,
                    }))
                  }
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Amount
                </label>
                <div className="flex gap-2">
                  <select
                    value={form.currency}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        currency: e.target.value as CurrencyCode,
                      }))
                    }
                    className="w-24 px-2 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.symbol} {c.code}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={form.amount}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, amount: e.target.value }))
                    }
                    className="flex-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
            </div>
            <input
              type="text"
              placeholder="Description *"
              value={form.title}
              onChange={(e) =>
                setForm((f) => ({ ...f, title: e.target.value }))
              }
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <input
              type="text"
              placeholder="Notes (optional)"
              value={form.notes}
              onChange={(e) =>
                setForm((f) => ({ ...f, notes: e.target.value }))
              }
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />

            {/* Paid by */}
            {peopleNames.length > 0 && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Paid by</label>
                <select
                  value={form.paidBy}
                  onChange={(e) => setForm((f) => ({ ...f, paidBy: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                >
                  <option value="">-- Select who paid --</option>
                  {peopleNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Split among */}
            {peopleNames.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs text-gray-500">Split between</label>
                  <button
                    type="button"
                    onClick={selectAllSplit}
                    className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
                  >
                    Select all
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {peopleNames.map((name) => (
                    <label
                      key={name}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm cursor-pointer transition-colors border",
                        form.splitAmong.includes(name)
                          ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                          : "bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100"
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={form.splitAmong.includes(name)}
                        onChange={() => toggleSplitPerson(name)}
                        className="rounded text-indigo-600 w-3.5 h-3.5"
                      />
                      {name}
                    </label>
                  ))}
                </div>
                {form.splitAmong.length > 0 && form.amount && (
                  <div className="mt-2 text-xs text-gray-500">
                    {formatCurrencyAmount(parseFloat(form.amount) / form.splitAmong.length, form.currency)} per person
                  </div>
                )}
              </div>
            )}

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={form.isEstimate}
                onChange={(e) =>
                  setForm((f) => ({ ...f, isEstimate: e.target.checked }))
                }
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
        {CATEGORIES.filter((c) => (convertedByCategory[c] || 0) > 0).map(
          (c) => (
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
          )
        )}
      </div>

      {/* Items list */}
      {filteredItems.length === 0 && (
        <div className="text-center py-16">
          <DollarSign className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">No budget items yet</p>
          <p className="text-gray-400 text-xs mt-1">
            Add flights, hotels, and activities to track your spending
          </p>
        </div>
      )}

      <div className="space-y-2">
        {filteredItems.map((item) => {
          const itemCurrency = item.currency || "USD"
          const isDifferentCurrency = itemCurrency !== baseCurrency
          const convertedAmount = convertToBase(item.amount, itemCurrency)

          return (
            <div
              key={item.id}
              className="bg-white border border-gray-100 rounded-xl px-4 py-3 flex items-center gap-3 group hover:border-gray-200 transition-colors"
            >
              <div
                className={cn(
                  "w-8 h-8 rounded-lg flex items-center justify-center text-xs font-semibold shrink-0",
                  CATEGORY_LIGHT[item.category as Category] ||
                    "bg-gray-100 text-gray-600"
                )}
              >
                {CATEGORY_LABELS[item.category as Category]?.charAt(0) || "?"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-gray-900 truncate">
                  {item.title}
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
                  <span>{CATEGORY_LABELS[item.category as Category]}</span>
                  <span
                    className={cn(
                      "font-medium",
                      item.isEstimate ? "text-orange-600" : "text-green-600"
                    )}
                  >
                    {item.isEstimate ? "Estimate" : "Paid"}
                  </span>
                  {item.paidBy && (
                    <span className="text-indigo-600">Paid by {item.paidBy}</span>
                  )}
                  {item.splitAmong.length > 0 && (
                    <span className="text-gray-400">
                      Split {item.splitAmong.length} ways
                    </span>
                  )}
                  {item.notes && (
                    <span className="truncate">{item.notes}</span>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-semibold text-gray-900">
                  {isDifferentCurrency
                    ? formatCurrencyAmount(convertedAmount, baseCurrency)
                    : formatCurrencyAmount(item.amount, itemCurrency)}
                </div>
                {isDifferentCurrency && hasRates && (
                  <div className="text-xs text-gray-400">
                    {formatCurrencyAmount(item.amount, itemCurrency)}
                  </div>
                )}
                {item.splitAmong.length > 1 && (
                  <div className="text-xs text-gray-400">
                    {formatCurrencyAmount(item.amount / item.splitAmong.length, itemCurrency)}/ea
                  </div>
                )}
              </div>
              <button
                onClick={() =>
                  handleDelete(
                    item.id,
                    item.amount,
                    item.category,
                    item.isEstimate
                  )
                }
                className="p-1 text-gray-400 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
