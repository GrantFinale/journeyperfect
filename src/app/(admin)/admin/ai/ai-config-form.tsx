"use client"

import { useState, useTransition, useRef, useEffect } from "react"
import { updateAdminConfig } from "@/lib/actions/admin"
import type { OpenRouterModel } from "@/lib/actions/openrouter"

const TIER_COLORS = {
  cheap: { dot: "bg-green-500", bg: "bg-green-50", text: "text-green-700", label: "Budget" },
  mid: { dot: "bg-orange-500", bg: "bg-orange-50", text: "text-orange-700", label: "Standard" },
  expensive: { dot: "bg-red-500", bg: "bg-red-50", text: "text-red-700", label: "Premium" },
} as const

function formatCost(costPerToken: number): string {
  const perMillion = costPerToken * 1_000_000
  if (perMillion < 0.01) return `<$0.01/1M tokens`
  return `$${perMillion.toFixed(2)}/1M tokens`
}

export function AiConfigForm({
  hasOpenRouterKey,
  flightParserModel: initialModel,
  models,
}: {
  hasOpenRouterKey: boolean
  flightParserModel: string
  models: OpenRouterModel[]
}) {
  const [selectedModel, setSelectedModel] = useState(initialModel)
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [search, setSearch] = useState("")
  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Close dropdown on outside click
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

  // Focus search when dropdown opens
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

  function handleSelect(modelId: string) {
    setSelectedModel(modelId)
    setDropdownOpen(false)
    setSearch("")
  }

  function handleSave() {
    startTransition(async () => {
      await updateAdminConfig("ai.flightParserModel", selectedModel)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    })
  }

  return (
    <div className="space-y-6 max-w-xl">
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

      {/* Flight Parser Model Selector */}
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <label className="block text-sm font-medium text-gray-700 mb-2">Flight Parser Model</label>

        {models.length > 0 ? (
          <div className="relative" ref={dropdownRef}>
            {/* Selected model button */}
            <button
              type="button"
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="w-full flex items-center justify-between px-3 py-2 border border-gray-300 rounded-md text-sm bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
            >
              <span className="flex items-center gap-2 min-w-0">
                {currentModel ? (
                  <>
                    <span
                      className={`inline-block w-2 h-2 rounded-full shrink-0 ${TIER_COLORS[currentModel.tier].dot}`}
                    />
                    <span className="truncate">{currentModel.name}</span>
                    <span className="text-xs text-gray-400 shrink-0">
                      {formatCost(currentModel.promptCost)}
                    </span>
                  </>
                ) : (
                  <span className="text-gray-500 truncate">{selectedModel || "Select a model..."}</span>
                )}
              </span>
              <svg
                className={`w-4 h-4 text-gray-400 shrink-0 ml-2 transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Dropdown list */}
            {dropdownOpen && (
              <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg">
                {/* Search input */}
                <div className="p-2 border-b border-gray-100">
                  <input
                    ref={searchRef}
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search models..."
                    className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                {/* Tier legend */}
                <div className="flex gap-3 px-3 py-1.5 border-b border-gray-100 bg-gray-50">
                  {(["cheap", "mid", "expensive"] as const).map((tier) => (
                    <span key={tier} className="flex items-center gap-1 text-xs text-gray-500">
                      <span className={`inline-block w-2 h-2 rounded-full ${TIER_COLORS[tier].dot}`} />
                      {TIER_COLORS[tier].label}
                    </span>
                  ))}
                </div>

                {/* Model list */}
                <div className="max-h-72 overflow-y-auto">
                  {filteredModels.length === 0 ? (
                    <div className="px-3 py-4 text-sm text-gray-500 text-center">No models found</div>
                  ) : (
                    filteredModels.map((model) => (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => handleSelect(model.id)}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-indigo-50 transition-colors ${
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
          /* Fallback text input when no models available */
          <input
            type="text"
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            placeholder="anthropic/claude-haiku-4-5-20251001"
          />
        )}

        <p className="text-xs text-gray-500 mt-1.5">
          OpenRouter model ID used for flight email parsing
          {models.length > 0 && (
            <span className="text-gray-400"> &middot; {models.length} models available</span>
          )}
        </p>
      </div>

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={isPending}
        className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors"
      >
        {isPending ? "Saving..." : saved ? "Saved!" : "Save"}
      </button>
    </div>
  )
}
