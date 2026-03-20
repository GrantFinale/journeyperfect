"use client"

import { useState, useCallback } from "react"
import { toast } from "sonner"
import { updateTravelerPreferences } from "@/lib/actions/travelers"
import { cn } from "@/lib/utils"
import { Save, ChevronDown } from "lucide-react"

// ─── Types ───────────────────────────────────────────────────────────────────

interface TravelerPreferencesData {
  cuisineRatings: Record<string, number>
  dietaryRestrictions: string[]
  adventureLevel: number
  walkingTolerance: number
  culturalInterest: number
  nightlifeInterest: number
  shoppingInterest: number
  natureInterest: number
  mobilityNeeds: string[]
  sleepSchedule: "early-bird" | "normal" | "night-owl"
  budgetPreference: "budget" | "moderate" | "comfort" | "luxury"
  travelPace: "relaxed" | "moderate" | "active" | "packed"
  interests: string[]
  heatTolerance: number
  coldTolerance: number
}

interface TravelerProfile {
  id: string
  name: string
  birthDate: Date | null
  tags: string[]
  isDefault: boolean
  preferences: Record<string, unknown> | null
}

interface Props {
  initialProfiles: TravelerProfile[]
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CUISINES = [
  "Italian", "Mexican", "Japanese/Sushi", "Chinese", "Indian", "Thai", "Korean",
  "Mediterranean", "American/BBQ", "French", "Vietnamese", "Middle Eastern",
  "Greek", "Cajun/Creole", "Caribbean", "Ethiopian", "Seafood",
  "Vegetarian/Vegan", "Fast Food", "Fine Dining",
]

const DIETARY_RESTRICTIONS = [
  "Vegetarian", "Vegan", "Pescatarian", "Gluten-free", "Dairy-free",
  "Nut allergy", "Halal", "Kosher", "Low-sodium", "Keto",
]

const ACTIVITY_SLIDERS: { key: keyof TravelerPreferencesData; label: string; leftEmoji: string; leftLabel: string; rightEmoji: string; rightLabel: string }[] = [
  { key: "adventureLevel", label: "Adventure Level", leftEmoji: "\u{1F6CB}\uFE0F", leftLabel: "Couch potato", rightEmoji: "\u{1FA82}", rightLabel: "Adrenaline junkie" },
  { key: "walkingTolerance", label: "Walking Tolerance", leftEmoji: "\u{1F697}", leftLabel: "Drive everywhere", rightEmoji: "\u{1F97E}", rightLabel: "Walk all day" },
  { key: "culturalInterest", label: "Cultural Interest", leftEmoji: "\u{1F4F1}", leftLabel: "Not really", rightEmoji: "\u{1F3DB}\uFE0F", rightLabel: "Every museum" },
  { key: "nightlifeInterest", label: "Nightlife", leftEmoji: "\u{1F634}", leftLabel: "Early bed", rightEmoji: "\u{1F389}", rightLabel: "Night owl" },
  { key: "shoppingInterest", label: "Shopping", leftEmoji: "\u{1F6AB}", leftLabel: "Avoid", rightEmoji: "\u{1F6CD}\uFE0F", rightLabel: "Shopaholic" },
  { key: "natureInterest", label: "Nature", leftEmoji: "\u{1F3D9}\uFE0F", leftLabel: "City only", rightEmoji: "\u{1F332}", rightLabel: "Wilderness" },
]

const INTERESTS = [
  "History", "Art", "Food tours", "Photography", "Sports", "Live music",
  "Architecture", "Wildlife", "Beaches", "Mountains", "Theme parks",
  "Water sports", "Spa/Wellness", "Wine/Beer tasting", "Cooking classes",
  "Street markets",
]

const MOBILITY_NEEDS = [
  "Wheelchair accessible", "Limited walking", "Stroller needed", "Elevator required",
]

const SLEEP_SCHEDULES: { value: TravelerPreferencesData["sleepSchedule"]; label: string }[] = [
  { value: "early-bird", label: "Early bird" },
  { value: "normal", label: "Normal" },
  { value: "night-owl", label: "Night owl" },
]

const BUDGET_PREFERENCES: { value: TravelerPreferencesData["budgetPreference"]; label: string }[] = [
  { value: "budget", label: "Budget" },
  { value: "moderate", label: "Moderate" },
  { value: "comfort", label: "Comfort" },
  { value: "luxury", label: "Luxury" },
]

const TRAVEL_PACES: { value: TravelerPreferencesData["travelPace"]; label: string }[] = [
  { value: "relaxed", label: "Relaxed" },
  { value: "moderate", label: "Moderate" },
  { value: "active", label: "Active" },
  { value: "packed", label: "Packed" },
]

const TABS = ["Food", "Activities", "Interests", "Practical", "Climate"] as const
type Tab = (typeof TABS)[number]

// ─── Default preferences ─────────────────────────────────────────────────────

function defaultPreferences(): TravelerPreferencesData {
  return {
    cuisineRatings: {},
    dietaryRestrictions: [],
    adventureLevel: 3,
    walkingTolerance: 3,
    culturalInterest: 3,
    nightlifeInterest: 3,
    shoppingInterest: 3,
    natureInterest: 3,
    mobilityNeeds: [],
    sleepSchedule: "normal",
    budgetPreference: "moderate",
    travelPace: "moderate",
    interests: [],
    heatTolerance: 3,
    coldTolerance: 3,
  }
}

function parsePreferences(raw: Record<string, unknown> | null): TravelerPreferencesData {
  if (!raw) return defaultPreferences()
  const d = defaultPreferences()
  return {
    cuisineRatings: (raw.cuisineRatings as Record<string, number>) ?? d.cuisineRatings,
    dietaryRestrictions: (raw.dietaryRestrictions as string[]) ?? d.dietaryRestrictions,
    adventureLevel: (raw.adventureLevel as number) ?? d.adventureLevel,
    walkingTolerance: (raw.walkingTolerance as number) ?? d.walkingTolerance,
    culturalInterest: (raw.culturalInterest as number) ?? d.culturalInterest,
    nightlifeInterest: (raw.nightlifeInterest as number) ?? d.nightlifeInterest,
    shoppingInterest: (raw.shoppingInterest as number) ?? d.shoppingInterest,
    natureInterest: (raw.natureInterest as number) ?? d.natureInterest,
    mobilityNeeds: (raw.mobilityNeeds as string[]) ?? d.mobilityNeeds,
    sleepSchedule: (raw.sleepSchedule as TravelerPreferencesData["sleepSchedule"]) ?? d.sleepSchedule,
    budgetPreference: (raw.budgetPreference as TravelerPreferencesData["budgetPreference"]) ?? d.budgetPreference,
    travelPace: (raw.travelPace as TravelerPreferencesData["travelPace"]) ?? d.travelPace,
    interests: (raw.interests as string[]) ?? d.interests,
    heatTolerance: (raw.heatTolerance as number) ?? d.heatTolerance,
    coldTolerance: (raw.coldTolerance as number) ?? d.coldTolerance,
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TravelerPreferences({ initialProfiles }: Props) {
  const [profiles] = useState(initialProfiles)
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    initialProfiles.find((p) => p.isDefault)?.id ?? initialProfiles[0]?.id ?? null
  )
  const [activeTab, setActiveTab] = useState<Tab>("Food")
  const [saving, setSaving] = useState(false)

  // Each profile gets its own preferences state
  const [prefsMap, setPrefsMap] = useState<Record<string, TravelerPreferencesData>>(() => {
    const map: Record<string, TravelerPreferencesData> = {}
    for (const p of initialProfiles) {
      map[p.id] = parsePreferences(p.preferences)
    }
    return map
  })

  const selectedProfile = profiles.find((p) => p.id === selectedProfileId)
  const prefs = selectedProfileId ? prefsMap[selectedProfileId] : null

  const updatePrefs = useCallback(
    (updater: (prev: TravelerPreferencesData) => TravelerPreferencesData) => {
      if (!selectedProfileId) return
      setPrefsMap((prev) => ({
        ...prev,
        [selectedProfileId]: updater(prev[selectedProfileId] ?? defaultPreferences()),
      }))
    },
    [selectedProfileId]
  )

  function toggleArrayItem(arr: string[], item: string): string[] {
    return arr.includes(item) ? arr.filter((i) => i !== item) : [...arr, item]
  }

  async function handleSave() {
    if (!selectedProfileId || !prefs) return
    setSaving(true)
    try {
      await updateTravelerPreferences(selectedProfileId, prefs as unknown as Parameters<typeof updateTravelerPreferences>[1])
      toast.success("Preferences saved")
    } catch {
      toast.error("Failed to save preferences")
    } finally {
      setSaving(false)
    }
  }

  if (profiles.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Traveler Profiles</h1>
        <div className="text-center py-16">
          <p className="text-gray-500 text-sm">No traveler profiles yet.</p>
          <p className="text-gray-400 text-xs mt-1">
            Go to <a href="/settings" className="text-indigo-600 hover:underline">Settings</a> to create traveler profiles first.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Traveler Profiles</h1>
      <p className="text-sm text-gray-500 mb-6">
        Set detailed preferences for each traveler to get personalized recommendations.
      </p>

      {/* Profile selector */}
      <div className="relative mb-6">
        <label className="block text-xs text-gray-500 mb-1.5">Select traveler</label>
        <div className="relative">
          <select
            value={selectedProfileId ?? ""}
            onChange={(e) => setSelectedProfileId(e.target.value)}
            className="w-full appearance-none bg-white border border-gray-200 rounded-xl px-4 py-3 pr-10 text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.isDefault ? "(Default)" : ""}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        </div>
      </div>

      {selectedProfile && prefs && (
        <>
          {/* Tabs */}
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-6 overflow-x-auto">
            {TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "flex-1 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap px-3",
                  activeTab === tab
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                )}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* ─── Food Tab ──────────────────────────────────────────────── */}
          {activeTab === "Food" && (
            <div className="space-y-6">
              <div className="bg-white border border-gray-100 rounded-2xl p-5">
                <h3 className="font-semibold text-gray-900 mb-1">Cuisine Ratings</h3>
                <p className="text-xs text-gray-500 mb-4">Rate each cuisine type from 1 (hate) to 5 (love)</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {CUISINES.map((cuisine) => {
                    const key = cuisine.toLowerCase().replace(/[^a-z]/g, "-")
                    const value = prefs.cuisineRatings[key] ?? 3
                    return (
                      <div key={cuisine} className="flex items-center gap-3">
                        <span className="text-sm text-gray-700 w-36 truncate">{cuisine}</span>
                        <div className="flex items-center gap-1 flex-1">
                          <span className="text-xs">{"\u{1F922}"}</span>
                          <input
                            type="range"
                            min={1}
                            max={5}
                            value={value}
                            onChange={(e) =>
                              updatePrefs((p) => ({
                                ...p,
                                cuisineRatings: { ...p.cuisineRatings, [key]: parseInt(e.target.value) },
                              }))
                            }
                            className="flex-1 h-2 accent-indigo-600"
                          />
                          <span className="text-xs">{"\u{1F60D}"}</span>
                          <span className="text-xs font-medium text-gray-500 w-4 text-center">{value}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="bg-white border border-gray-100 rounded-2xl p-5">
                <h3 className="font-semibold text-gray-900 mb-1">Dietary Restrictions</h3>
                <p className="text-xs text-gray-500 mb-3">Select all that apply</p>
                <div className="flex flex-wrap gap-2">
                  {DIETARY_RESTRICTIONS.map((item) => (
                    <button
                      key={item}
                      onClick={() =>
                        updatePrefs((p) => ({
                          ...p,
                          dietaryRestrictions: toggleArrayItem(p.dietaryRestrictions, item),
                        }))
                      }
                      className={cn(
                        "px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors",
                        prefs.dietaryRestrictions.includes(item)
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"
                      )}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ─── Activities Tab ────────────────────────────────────────── */}
          {activeTab === "Activities" && (
            <div className="bg-white border border-gray-100 rounded-2xl p-5">
              <h3 className="font-semibold text-gray-900 mb-1">Activity Preferences</h3>
              <p className="text-xs text-gray-500 mb-4">Slide to set your comfort level for each category</p>
              <div className="space-y-5">
                {ACTIVITY_SLIDERS.map((slider) => {
                  const value = prefs[slider.key] as number
                  return (
                    <div key={slider.key}>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {slider.label}
                      </label>
                      <div className="flex items-center gap-2">
                        <span className="text-lg w-8 text-center">{slider.leftEmoji}</span>
                        <span className="text-[10px] text-gray-400 w-24 hidden sm:block">{slider.leftLabel}</span>
                        <input
                          type="range"
                          min={1}
                          max={5}
                          value={value}
                          onChange={(e) =>
                            updatePrefs((p) => ({
                              ...p,
                              [slider.key]: parseInt(e.target.value),
                            }))
                          }
                          className="flex-1 h-2 accent-indigo-600"
                        />
                        <span className="text-[10px] text-gray-400 w-24 text-right hidden sm:block">{slider.rightLabel}</span>
                        <span className="text-lg w-8 text-center">{slider.rightEmoji}</span>
                      </div>
                      <div className="flex justify-between mt-1 px-10 sm:px-36">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <span
                            key={n}
                            className={cn(
                              "text-[10px] font-medium",
                              value === n ? "text-indigo-600" : "text-gray-300"
                            )}
                          >
                            {n}
                          </span>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ─── Interests Tab ─────────────────────────────────────────── */}
          {activeTab === "Interests" && (
            <div className="bg-white border border-gray-100 rounded-2xl p-5">
              <h3 className="font-semibold text-gray-900 mb-1">Interests</h3>
              <p className="text-xs text-gray-500 mb-4">Select everything that sounds fun</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {INTERESTS.map((interest) => (
                  <button
                    key={interest}
                    onClick={() =>
                      updatePrefs((p) => ({
                        ...p,
                        interests: toggleArrayItem(p.interests, interest),
                      }))
                    }
                    className={cn(
                      "px-3 py-2.5 text-sm font-medium rounded-xl border transition-colors text-left",
                      prefs.interests.includes(interest)
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"
                    )}
                  >
                    {interest}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ─── Practical Tab ─────────────────────────────────────────── */}
          {activeTab === "Practical" && (
            <div className="space-y-6">
              <div className="bg-white border border-gray-100 rounded-2xl p-5">
                <h3 className="font-semibold text-gray-900 mb-3">Mobility Needs</h3>
                <div className="flex flex-wrap gap-2">
                  {MOBILITY_NEEDS.map((need) => (
                    <button
                      key={need}
                      onClick={() =>
                        updatePrefs((p) => ({
                          ...p,
                          mobilityNeeds: toggleArrayItem(p.mobilityNeeds, need),
                        }))
                      }
                      className={cn(
                        "px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors",
                        prefs.mobilityNeeds.includes(need)
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"
                      )}
                    >
                      {need}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-white border border-gray-100 rounded-2xl p-5">
                <h3 className="font-semibold text-gray-900 mb-3">Sleep Schedule</h3>
                <div className="flex gap-2">
                  {SLEEP_SCHEDULES.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => updatePrefs((p) => ({ ...p, sleepSchedule: opt.value }))}
                      className={cn(
                        "flex-1 px-3 py-2.5 text-sm font-medium rounded-xl border transition-colors",
                        prefs.sleepSchedule === opt.value
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-white border border-gray-100 rounded-2xl p-5">
                <h3 className="font-semibold text-gray-900 mb-3">Budget Preference</h3>
                <div className="flex gap-2">
                  {BUDGET_PREFERENCES.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => updatePrefs((p) => ({ ...p, budgetPreference: opt.value }))}
                      className={cn(
                        "flex-1 px-3 py-2.5 text-sm font-medium rounded-xl border transition-colors",
                        prefs.budgetPreference === opt.value
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-white border border-gray-100 rounded-2xl p-5">
                <h3 className="font-semibold text-gray-900 mb-3">Travel Pace</h3>
                <div className="flex gap-2">
                  {TRAVEL_PACES.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => updatePrefs((p) => ({ ...p, travelPace: opt.value }))}
                      className={cn(
                        "flex-1 px-3 py-2.5 text-sm font-medium rounded-xl border transition-colors",
                        prefs.travelPace === opt.value
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ─── Climate Tab ───────────────────────────────────────────── */}
          {activeTab === "Climate" && (
            <div className="bg-white border border-gray-100 rounded-2xl p-5">
              <h3 className="font-semibold text-gray-900 mb-1">Climate Preferences</h3>
              <p className="text-xs text-gray-500 mb-6">How do you handle temperature extremes?</p>
              <div className="space-y-8">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-3">Heat Tolerance</label>
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{"\u2744\uFE0F"}</span>
                    <span className="text-xs text-gray-400 w-20 hidden sm:block">Hate heat</span>
                    <input
                      type="range"
                      min={1}
                      max={5}
                      value={prefs.heatTolerance}
                      onChange={(e) =>
                        updatePrefs((p) => ({ ...p, heatTolerance: parseInt(e.target.value) }))
                      }
                      className="flex-1 h-2 accent-indigo-600"
                    />
                    <span className="text-xs text-gray-400 w-20 text-right hidden sm:block">Love heat</span>
                    <span className="text-lg">{"\u{1F525}"}</span>
                  </div>
                  <div className="flex justify-between mt-1 px-8 sm:px-28">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <span
                        key={n}
                        className={cn(
                          "text-[10px] font-medium",
                          prefs.heatTolerance === n ? "text-indigo-600" : "text-gray-300"
                        )}
                      >
                        {n}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-3">Cold Tolerance</label>
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{"\u{1F525}"}</span>
                    <span className="text-xs text-gray-400 w-20 hidden sm:block">Hate cold</span>
                    <input
                      type="range"
                      min={1}
                      max={5}
                      value={prefs.coldTolerance}
                      onChange={(e) =>
                        updatePrefs((p) => ({ ...p, coldTolerance: parseInt(e.target.value) }))
                      }
                      className="flex-1 h-2 accent-indigo-600"
                    />
                    <span className="text-xs text-gray-400 w-20 text-right hidden sm:block">Love cold</span>
                    <span className="text-lg">{"\u2744\uFE0F"}</span>
                  </div>
                  <div className="flex justify-between mt-1 px-8 sm:px-28">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <span
                        key={n}
                        className={cn(
                          "text-[10px] font-medium",
                          prefs.coldTolerance === n ? "text-indigo-600" : "text-gray-300"
                        )}
                      >
                        {n}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Save button */}
          <div className="mt-6">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              <Save className="w-4 h-4" />
              {saving ? "Saving..." : `Save ${selectedProfile.name}'s preferences`}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
