"use client"

import { useState, useTransition } from "react"
import { updateAdminConfig } from "@/lib/actions/admin"

export function AiConfigForm({
  hasOpenRouterKey,
  flightParserModel: initialModel,
}: {
  hasOpenRouterKey: boolean
  flightParserModel: string
}) {
  const [flightParserModel, setFlightParserModel] = useState(initialModel)
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)

  function handleSave() {
    startTransition(async () => {
      await updateAdminConfig("ai.flightParserModel", flightParserModel)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    })
  }

  return (
    <div className="space-y-6 max-w-xl">
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

      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <label htmlFor="flightParserModel" className="block text-sm font-medium text-gray-700 mb-1">
          Flight Parser Model
        </label>
        <input
          id="flightParserModel"
          type="text"
          value={flightParserModel}
          onChange={(e) => setFlightParserModel(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          placeholder="anthropic/claude-haiku-4-5-20251001"
        />
        <p className="text-xs text-gray-500 mt-1">OpenRouter model ID used for flight email parsing</p>
      </div>

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
