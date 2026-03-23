"use client"

import { useState } from "react"
import { CloudRain, ArrowRightLeft, X, Check } from "lucide-react"
import { toast } from "sonner"
import { swapWithIndoor } from "@/lib/actions/weather-prompts"
import type { WeatherSwapSuggestion } from "@/lib/actions/weather-prompts"

interface WeatherReschedulePromptProps {
  tripId: string
  suggestions: WeatherSwapSuggestion[]
}

export function WeatherReschedulePrompt({ tripId, suggestions: initialSuggestions }: WeatherReschedulePromptProps) {
  const [suggestions, setSuggestions] = useState(initialSuggestions)
  const [swapping, setSwapping] = useState<string | null>(null)

  if (suggestions.length === 0) return null

  async function handleSwap(suggestion: WeatherSwapSuggestion) {
    if (!suggestion.indoorAlternativeId) return
    setSwapping(suggestion.id)
    try {
      await swapWithIndoor(
        tripId,
        suggestion.outdoorActivityId,
        suggestion.indoorAlternativeId,
        suggestion.outdoorDate
      )
      toast.success(`Swapped to ${suggestion.indoorAlternativeName}!`)
      setSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id))
    } catch {
      toast.error("Failed to swap activities")
    } finally {
      setSwapping(null)
    }
  }

  function handleDismiss(id: string) {
    setSuggestions((prev) => prev.filter((s) => s.id !== id))
  }

  return (
    <div className="space-y-3 mb-6">
      {suggestions.map((s) => (
        <div
          key={s.id}
          className="bg-amber-50 border border-amber-200 rounded-2xl p-4"
        >
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
              <CloudRain className="w-4 h-4 text-amber-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-amber-900 font-medium">
                {s.weatherEmoji} Rain expected {s.outdoorDateLabel} ({s.rainProbability}% chance)
              </p>
              <p className="text-xs text-amber-700 mt-0.5">
                Your <strong>{s.outdoorActivityName}</strong> is outdoors.
                {s.indoorAlternativeName && (
                  <> Want to swap it with <strong>{s.indoorAlternativeName}</strong> (indoor)?</>
                )}
                {!s.indoorAlternativeName && s.betterDateLabel && (
                  <> Better weather on <strong>{s.betterDateLabel}</strong> ({s.betterWeather}).</>
                )}
              </p>
              <div className="flex items-center gap-2 mt-2">
                {s.indoorAlternativeId && (
                  <button
                    onClick={() => handleSwap(s)}
                    disabled={swapping === s.id}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
                  >
                    <ArrowRightLeft className="w-3 h-3" />
                    {swapping === s.id ? "Swapping..." : "Swap"}
                  </button>
                )}
                <button
                  onClick={() => handleDismiss(s.id)}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-amber-700 border border-amber-300 rounded-lg hover:bg-amber-100 transition-colors"
                >
                  <Check className="w-3 h-3" />
                  Keep
                </button>
              </div>
            </div>
            <button
              onClick={() => handleDismiss(s.id)}
              className="p-1 text-amber-400 hover:text-amber-600 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
