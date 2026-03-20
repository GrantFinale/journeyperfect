"use client"

import { useState, useTransition, useRef, useEffect, useCallback } from "react"
import { updateAdminConfig } from "@/lib/actions/admin"
import { getAIUsageStats } from "@/lib/actions/admin"
import type { OpenRouterModel } from "@/lib/actions/openrouter"
import type { AIUsageStats } from "@/lib/actions/admin"

const TIER_COLORS = {
  cheap: { dot: "bg-green-500", bg: "bg-green-50", text: "text-green-700", label: "Budget" },
  mid: { dot: "bg-orange-500", bg: "bg-orange-50", text: "text-orange-700", label: "Standard" },
  expensive: { dot: "bg-red-500", bg: "bg-red-50", text: "text-red-700", label: "Premium" },
} as const

const FEATURE_COLORS: Record<string, string> = {
  flight_parser: "bg-blue-500",
  hotel_parser: "bg-purple-500",
  rental_car_parser: "bg-amber-500",
  optimizer: "bg-emerald-500",
  dining_recs: "bg-rose-500",
  packing: "bg-cyan-500",
}

const PERIOD_OPTIONS = [
  { label: "24h", days: 1 },
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "All", days: 0 },
]

function formatCost(costPerToken: number): string {
  const perMillion = costPerToken * 1_000_000
  if (perMillion < 0.01) return "<$0.01/1M"
  return `$${perMillion.toFixed(2)}/1M`
}

type AIFeatureConfig = {
  key: string
  feature: string
  label: string
  description: string
  defaultModel: string
  currentModel: string
}

export function AiConfigDashboard({
  hasOpenRouterKey,
  aiFeatures,
  models,
  initialUsageStats,
}: {
  hasOpenRouterKey: boolean
  aiFeatures: AIFeatureConfig[]
  models: OpenRouterModel[]
  initialUsageStats: AIUsageStats
}) {
  const [selectedModels, setSelectedModels] = useState<Record<string, string>>(
    Object.fromEntries(aiFeatures.map((f) => [f.key, f.currentModel]))
  )
  const [isPending, startTransition] = useTransition()
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set())
  const [usageStats, setUsageStats] = useState<AIUsageStats>(initialUsageStats)
  const [selectedPeriod, setSelectedPeriod] = useState(30)
  const [loadingUsage, setLoadingUsage] = useState(false)

  const handleModelChange = (key: string, modelId: string) => {
    setSelectedModels((prev) => ({ ...prev, [key]: modelId }))
  }

  const handleSave = (key: string) => {
    startTransition(async () => {
      await updateAdminConfig(key, selectedModels[key])
      setSavedKeys((prev) => new Set(prev).add(key))
      setTimeout(() => {
        setSavedKeys((prev) => {
          const next = new Set(prev)
          next.delete(key)
          return next
        })
      }, 2000)
    })
  }

  const handleSaveAll = () => {
    startTransition(async () => {
      await Promise.all(
        aiFeatures.map((f) => updateAdminConfig(f.key, selectedModels[f.key]))
      )
      const allKeys = new Set(aiFeatures.map((f) => f.key))
      setSavedKeys(allKeys)
      setTimeout(() => setSavedKeys(new Set()), 2000)
    })
  }

  const handlePeriodChange = useCallback(async (days: number) => {
    setSelectedPeriod(days)
    setLoadingUsage(true)
    try {
      const stats = await getAIUsageStats(days)
      setUsageStats(stats)
    } catch {
      // ignore
    } finally {
      setLoadingUsage(false)
    }
  }, [])

  // Build per-feature usage lookup
  const featureUsage: Record<string, { calls: number; cost: number; tokens: number }> = {}
  for (const f of aiFeatures) {
    featureUsage[f.feature] = { calls: 0, cost: 0, tokens: 0 }
  }
  for (const row of usageStats.byFeature) {
    if (!featureUsage[row.feature]) {
      featureUsage[row.feature] = { calls: 0, cost: 0, tokens: 0 }
    }
    featureUsage[row.feature].calls += row._count
    featureUsage[row.feature].cost += row._sum.costUsd ?? 0
    featureUsage[row.feature].tokens += row._sum.tokens ?? 0
  }

  const totalCalls = usageStats.total._count ?? 0
  const totalCost = usageStats.total._sum?.costUsd ?? 0
  const totalTokens = usageStats.total._sum?.tokens ?? 0
  const maxCalls = Math.max(...Object.values(featureUsage).map((f) => f.calls), 1)

  return (
    <div className="space-y-6 max-w-3xl">
      {/* OpenRouter API Key Status */}
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <label className="block text-sm font-medium text-gray-700 mb-1">OpenRouter API Key</label>
        <div className="flex items-center gap-2">
          <span
            className={`inline-block px-2 py-1 rounded text-xs font-medium ${
              hasOpenRouterKey ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
            }`}
          >
            {hasOpenRouterKey ? "Set" : "Not set"}
          </span>
          <span className="text-xs text-gray-500">Configured via OPENROUTER_API_KEY environment variable</span>
        </div>
      </div>

      {/* Usage Summary */}
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Usage Summary</h2>
          <div className="flex gap-1 bg-gray-100 rounded-md p-0.5">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.days}
                onClick={() => handlePeriodChange(opt.days)}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                  selectedPeriod === opt.days
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-4 mb-5">
          <div className="bg-gray-50 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-gray-900">{totalCalls.toLocaleString()}</p>
            <p className="text-xs text-gray-500">API Calls</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-gray-900">
              ${totalCost < 0.01 && totalCost > 0 ? "<0.01" : totalCost.toFixed(2)}
            </p>
            <p className="text-xs text-gray-500">Est. Cost</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-gray-900">
              {totalTokens > 1_000_000
                ? `${(totalTokens / 1_000_000).toFixed(1)}M`
                : totalTokens > 1000
                ? `${(totalTokens / 1000).toFixed(1)}k`
                : totalTokens.toLocaleString()}
            </p>
            <p className="text-xs text-gray-500">Tokens</p>
          </div>
        </div>

        {/* Bar chart */}
        <div className="space-y-2">
          {loadingUsage && (
            <div className="text-center py-2 text-xs text-gray-400">Loading...</div>
          )}
          {aiFeatures.map((f) => {
            const usage = featureUsage[f.feature]
            const pct = maxCalls > 0 ? (usage.calls / maxCalls) * 100 : 0
            return (
              <div key={f.feature} className="flex items-center gap-3">
                <span className="w-36 text-xs text-gray-600 truncate text-right">{f.label}</span>
                <div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden relative">
                  <div
                    className={`h-full rounded transition-all duration-500 ${FEATURE_COLORS[f.feature] ?? "bg-gray-400"}`}
                    style={{ width: `${Math.max(pct, usage.calls > 0 ? 2 : 0)}%` }}
                  />
                </div>
                <span className="w-20 text-xs text-gray-500 tabular-nums">
                  {usage.calls} / ${usage.cost < 0.01 && usage.cost > 0 ? "<0.01" : usage.cost.toFixed(2)}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* AI Features with Model Selectors */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">AI Features</h2>
          <button
            onClick={handleSaveAll}
            disabled={isPending}
            className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {isPending ? "Saving..." : "Save All"}
          </button>
        </div>

        <div className="divide-y divide-gray-100">
          {aiFeatures.map((feature) => (
            <FeatureRow
              key={feature.key}
              feature={feature}
              models={models}
              selectedModel={selectedModels[feature.key]}
              onModelChange={(modelId) => handleModelChange(feature.key, modelId)}
              onSave={() => handleSave(feature.key)}
              isSaved={savedKeys.has(feature.key)}
              isPending={isPending}
              usage={featureUsage[feature.feature]}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function FeatureRow({
  feature,
  models,
  selectedModel,
  onModelChange,
  onSave,
  isSaved,
  isPending,
  usage,
}: {
  feature: AIFeatureConfig
  models: OpenRouterModel[]
  selectedModel: string
  onModelChange: (modelId: string) => void
  onSave: () => void
  isSaved: boolean
  isPending: boolean
  usage: { calls: number; cost: number; tokens: number }
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [search, setSearch] = useState("")
  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
        setSearch("")
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  useEffect(() => {
    if (dropdownOpen && searchRef.current) {
      searchRef.current.focus()
    }
  }, [dropdownOpen])

  const currentModel = models.find((m) => m.id === selectedModel)
  const filteredModels = search
    ? models.filter(
        (m) =>
          m.name.toLowerCase().includes(search.toLowerCase()) ||
          m.id.toLowerCase().includes(search.toLowerCase())
      )
    : models

  const hasChanged = selectedModel !== feature.currentModel

  return (
    <div className="px-5 py-4">
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${FEATURE_COLORS[feature.feature] ?? "bg-gray-400"}`}
            />
            <h3 className="text-sm font-semibold text-gray-900">{feature.label}</h3>
            <span className="text-xs text-gray-400 font-mono">{feature.key}</span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5 ml-4">{feature.description}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-4">
          <div className="text-right">
            <span className="text-xs font-medium text-gray-700">{usage.calls} calls</span>
            <span className="text-xs text-gray-400 ml-1">
              ${usage.cost < 0.01 && usage.cost > 0 ? "<0.01" : usage.cost.toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 ml-4">
        {/* Model dropdown */}
        {models.length > 0 ? (
          <div className="relative flex-1" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="w-full flex items-center justify-between px-3 py-1.5 border border-gray-300 rounded-md text-sm bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
            >
              <span className="flex items-center gap-2 min-w-0">
                {currentModel ? (
                  <>
                    <span
                      className={`inline-block w-2 h-2 rounded-full shrink-0 ${TIER_COLORS[currentModel.tier].dot}`}
                    />
                    <span className="truncate text-xs">{currentModel.name}</span>
                    <span className="text-xs text-gray-400 shrink-0">
                      {formatCost(currentModel.promptCost)}
                    </span>
                  </>
                ) : (
                  <span className="text-gray-500 truncate text-xs">{selectedModel || "Select a model..."}</span>
                )}
              </span>
              <svg
                className={`w-3.5 h-3.5 text-gray-400 shrink-0 ml-2 transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {dropdownOpen && (
              <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg">
                <div className="p-2 border-b border-gray-100">
                  <input
                    ref={searchRef}
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search models..."
                    className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div className="flex gap-3 px-3 py-1.5 border-b border-gray-100 bg-gray-50">
                  {(["cheap", "mid", "expensive"] as const).map((tier) => (
                    <span key={tier} className="flex items-center gap-1 text-xs text-gray-500">
                      <span className={`inline-block w-2 h-2 rounded-full ${TIER_COLORS[tier].dot}`} />
                      {TIER_COLORS[tier].label}
                    </span>
                  ))}
                </div>
                <div className="max-h-60 overflow-y-auto">
                  {filteredModels.length === 0 ? (
                    <div className="px-3 py-4 text-xs text-gray-500 text-center">No models found</div>
                  ) : (
                    filteredModels.map((model) => (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => {
                          onModelChange(model.id)
                          setDropdownOpen(false)
                          setSearch("")
                        }}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-indigo-50 transition-colors ${
                          model.id === selectedModel ? "bg-indigo-50 font-medium" : ""
                        }`}
                      >
                        <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${TIER_COLORS[model.tier].dot}`} />
                        <span className="truncate min-w-0 flex-1">{model.name}</span>
                        <span className="text-xs text-gray-400 shrink-0 tabular-nums">
                          {formatCost(model.promptCost)}
                        </span>
                        {model.contextLength > 0 && (
                          <span className="text-xs text-gray-300 shrink-0">
                            {Math.round(model.contextLength / 1000)}k
                          </span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <input
            type="text"
            value={selectedModel}
            onChange={(e) => onModelChange(e.target.value)}
            className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            placeholder="model-id"
          />
        )}

        <button
          onClick={onSave}
          disabled={isPending || !hasChanged}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            isSaved
              ? "bg-green-100 text-green-700"
              : hasChanged
              ? "bg-indigo-600 text-white hover:bg-indigo-700"
              : "bg-gray-100 text-gray-400 cursor-not-allowed"
          } disabled:opacity-50`}
        >
          {isSaved ? "Saved" : "Save"}
        </button>
      </div>
    </div>
  )
}
