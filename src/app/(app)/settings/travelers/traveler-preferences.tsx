"use client"

import { useState, useCallback } from "react"
import { toast } from "sonner"
import { updateTravelerPreferences } from "@/lib/actions/travelers"
import { cn, getAgeGroupLabel } from "@/lib/utils"
import { Save, ChevronDown, ChevronRight } from "lucide-react"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TravelerPreferences {
  cuisine?: Record<string, number> // only non-default (non-3) values
  activities?: Record<string, number> // only non-default values
  dietary?: string[] // checked items
  mobility?: string[] // checked items
  pace?: string // single value
  sleepSchedule?: string // single value
  budgetComfort?: string // single value
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

const CUISINE_TYPES = [
  "American", "Mexican", "Italian", "Chinese", "Japanese/Sushi", "Thai",
  "Indian", "Mediterranean", "Korean", "Vietnamese", "BBQ", "Seafood",
  "Pizza", "Burgers", "Vegetarian/Vegan", "Desserts/Sweets",
]

const ACTIVITY_TYPES: { emoji: string; label: string }[] = [
  { emoji: "\u{1F3D6}\uFE0F", label: "Beach/Pool" },
  { emoji: "\u{1F97E}", label: "Hiking/Nature" },
  { emoji: "\u{1F3A2}", label: "Theme Parks/Rides" },
  { emoji: "\u{1F3DB}\uFE0F", label: "Museums/History" },
  { emoji: "\u{1F6CD}\uFE0F", label: "Shopping" },
  { emoji: "\u{1F3AD}", label: "Shows/Entertainment" },
  { emoji: "\u26F7\uFE0F", label: "Winter Sports" },
  { emoji: "\u{1F3A3}", label: "Water Activities" },
  { emoji: "\u{1F3CC}\uFE0F", label: "Golf" },
  { emoji: "\u{1F3A8}", label: "Arts/Creative" },
  { emoji: "\u{1F377}", label: "Breweries/Wineries" },
  { emoji: "\u{1F3B5}", label: "Live Music/Concerts" },
  { emoji: "\u{1F3DF}\uFE0F", label: "Sports Events" },
  { emoji: "\u{1F9D8}", label: "Spa/Relaxation" },
  { emoji: "\u{1F3B0}", label: "Nightlife/Casinos" },
]

const DIETARY_OPTIONS = [
  "Vegetarian", "Vegan", "Gluten-free", "Dairy-free", "Nut allergy",
  "Shellfish allergy", "Halal", "Kosher", "No spicy food", "No raw fish",
]

const MOBILITY_OPTIONS = [
  "Wheelchair accessible", "Limited walking ability", "Stroller needed",
  "Elevator required", "Motion sickness prone", "Fear of heights", "Claustrophobic",
]

const PACE_OPTIONS = [
  { value: "packed", label: "Packed schedule", desc: "go go go" },
  { value: "moderate", label: "Moderate", desc: "mix of activities and downtime" },
  { value: "relaxed", label: "Relaxed", desc: "take it easy" },
  { value: "very-relaxed", label: "Very relaxed", desc: "minimal plans" },
]

const SLEEP_OPTIONS = [
  { value: "early-bird", label: "Early bird", desc: "up by 6am" },
  { value: "normal", label: "Normal", desc: "up by 8am" },
  { value: "night-owl", label: "Night owl", desc: "up by 10am+" },
]

const BUDGET_OPTIONS = [
  { value: "budget", label: "Budget conscious" },
  { value: "moderate", label: "Moderate spender" },
  { value: "comfortable", label: "Comfortable" },
  { value: "luxury", label: "Luxury preferred" },
]

const EMOJI_SCALE = [
  { emoji: "\u{1F92E}", label: "Hate it" },
  { emoji: "\u{1F615}", label: "Not a fan" },
  { emoji: "\u{1F610}", label: "It's okay" },
  { emoji: "\u{1F60A}", label: "Like it" },
  { emoji: "\u{1F929}", label: "Love it" },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cuisineKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, "-")
}

function parsePreferences(raw: Record<string, unknown> | null): TravelerPreferences {
  if (!raw) return {}
  return {
    cuisine: (raw.cuisine as Record<string, number>) ?? undefined,
    activities: (raw.activities as Record<string, number>) ?? undefined,
    dietary: (raw.dietary as string[]) ?? undefined,
    mobility: (raw.mobility as string[]) ?? undefined,
    pace: (raw.pace as string) ?? undefined,
    sleepSchedule: (raw.sleepSchedule as string) ?? undefined,
    budgetComfort: (raw.budgetComfort as string) ?? undefined,
  }
}

function toggleArrayItem(arr: string[], item: string): string[] {
  return arr.includes(item) ? arr.filter((i) => i !== item) : [...arr, item]
}

// ─── Collapsible Section ─────────────────────────────────────────────────────

function Section({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-5 text-left hover:bg-gray-50 transition-colors"
      >
        <h3 className="font-semibold text-gray-900">{title}</h3>
        {open ? (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-400" />
        )}
      </button>
      {open && <div className="px-5 pb-5 -mt-1">{children}</div>}
    </div>
  )
}

// ─── Emoji Rating Row ────────────────────────────────────────────────────────

function EmojiRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      {EMOJI_SCALE.map((item, i) => {
        const rating = i + 1
        return (
          <button
            key={rating}
            onClick={() => onChange(rating)}
            title={item.label}
            className={cn(
              "w-8 h-8 text-lg rounded-lg transition-all flex items-center justify-center",
              value === rating
                ? "bg-indigo-100 scale-110 ring-2 ring-indigo-300"
                : "hover:bg-gray-100 opacity-40 hover:opacity-70"
            )}
          >
            {item.emoji}
          </button>
        )
      })}
    </div>
  )
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TravelerPreferences({ initialProfiles }: Props) {
  const [profiles] = useState(initialProfiles)
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    initialProfiles.find((p) => p.isDefault)?.id ?? initialProfiles[0]?.id ?? null
  )
  const [saving, setSaving] = useState(false)

  const [prefsMap, setPrefsMap] = useState<Record<string, TravelerPreferences>>(() => {
    const map: Record<string, TravelerPreferences> = {}
    for (const p of initialProfiles) {
      map[p.id] = parsePreferences(p.preferences)
    }
    return map
  })

  const selectedProfile = profiles.find((p) => p.id === selectedProfileId)
  const prefs = selectedProfileId ? (prefsMap[selectedProfileId] ?? {}) : null

  const updatePrefs = useCallback(
    (updater: (prev: TravelerPreferences) => TravelerPreferences) => {
      if (!selectedProfileId) return
      setPrefsMap((prev) => ({
        ...prev,
        [selectedProfileId]: updater(prev[selectedProfileId] ?? {}),
      }))
    },
    [selectedProfileId]
  )

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
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Traveler Preferences</h1>
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
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Traveler Preferences</h1>
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
                {p.name}
                {p.birthDate ? ` \u00B7 ${getAgeGroupLabel(p.birthDate)}` : ""}
                {p.isDefault ? " (Default)" : ""}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        </div>
      </div>

      {selectedProfile && prefs && (
        <>
          <div className="space-y-4">
            {/* ─── Cuisine Preferences ──────────────────────────────── */}
            <Section title="Cuisine Preferences" defaultOpen={true}>
              <p className="text-xs text-gray-500 mb-4">
                Rate each cuisine type. Click the emoji that matches your feeling.
              </p>
              <div className="space-y-3">
                {CUISINE_TYPES.map((cuisine) => {
                  const key = cuisineKey(cuisine)
                  const value = prefs.cuisine?.[key] ?? 3
                  return (
                    <div key={cuisine} className="flex items-center gap-3">
                      <span className="text-sm text-gray-700 w-36 shrink-0 truncate">{cuisine}</span>
                      <EmojiRating
                        value={value}
                        onChange={(v) =>
                          updatePrefs((p) => {
                            const cuisine = { ...p.cuisine }
                            if (v === 3) {
                              delete cuisine[key]
                            } else {
                              cuisine[key] = v
                            }
                            return { ...p, cuisine }
                          })
                        }
                      />
                    </div>
                  )
                })}
              </div>
            </Section>

            {/* ─── Activity Preferences ─────────────────────────────── */}
            <Section title="Activity Preferences">
              <p className="text-xs text-gray-500 mb-4">
                Rate how much you enjoy each activity type.
              </p>
              <div className="space-y-3">
                {ACTIVITY_TYPES.map((activity) => {
                  const key = cuisineKey(activity.label)
                  const value = prefs.activities?.[key] ?? 3
                  return (
                    <div key={activity.label} className="flex items-center gap-3">
                      <span className="text-sm text-gray-700 w-36 shrink-0 truncate">
                        {activity.emoji} {activity.label}
                      </span>
                      <EmojiRating
                        value={value}
                        onChange={(v) =>
                          updatePrefs((p) => {
                            const activities = { ...p.activities }
                            if (v === 3) {
                              delete activities[key]
                            } else {
                              activities[key] = v
                            }
                            return { ...p, activities }
                          })
                        }
                      />
                    </div>
                  )
                })}
              </div>
            </Section>

            {/* ─── Dietary Restrictions ──────────────────────────────── */}
            <Section title="Dietary Restrictions">
              <p className="text-xs text-gray-500 mb-3">Select all that apply</p>
              <div className="flex flex-wrap gap-2">
                {DIETARY_OPTIONS.map((item) => (
                  <button
                    key={item}
                    onClick={() =>
                      updatePrefs((p) => ({
                        ...p,
                        dietary: toggleArrayItem(p.dietary ?? [], item),
                      }))
                    }
                    className={cn(
                      "px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors",
                      (prefs.dietary ?? []).includes(item)
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"
                    )}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </Section>

            {/* ─── Mobility / Comfort ────────────────────────────────── */}
            <Section title="Mobility & Comfort">
              <p className="text-xs text-gray-500 mb-3">Select all that apply</p>
              <div className="flex flex-wrap gap-2">
                {MOBILITY_OPTIONS.map((item) => (
                  <button
                    key={item}
                    onClick={() =>
                      updatePrefs((p) => ({
                        ...p,
                        mobility: toggleArrayItem(p.mobility ?? [], item),
                      }))
                    }
                    className={cn(
                      "px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors",
                      (prefs.mobility ?? []).includes(item)
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"
                    )}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </Section>

            {/* ─── Travel Pace ────────────────────────────────────────── */}
            <Section title="Travel Pace">
              <div className="space-y-2">
                {PACE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => updatePrefs((p) => ({ ...p, pace: opt.value }))}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors text-left",
                      prefs.pace === opt.value
                        ? "bg-indigo-50 border-indigo-300 ring-1 ring-indigo-200"
                        : "bg-white border-gray-200 hover:border-indigo-200"
                    )}
                  >
                    <div className={cn(
                      "w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center",
                      prefs.pace === opt.value ? "border-indigo-600" : "border-gray-300"
                    )}>
                      {prefs.pace === opt.value && (
                        <div className="w-2 h-2 rounded-full bg-indigo-600" />
                      )}
                    </div>
                    <div>
                      <span className="text-sm font-medium text-gray-900">{opt.label}</span>
                      <span className="text-xs text-gray-500 ml-2">({opt.desc})</span>
                    </div>
                  </button>
                ))}
              </div>
            </Section>

            {/* ─── Sleep Schedule ──────────────────────────────────────── */}
            <Section title="Sleep Schedule">
              <div className="space-y-2">
                {SLEEP_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => updatePrefs((p) => ({ ...p, sleepSchedule: opt.value }))}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors text-left",
                      prefs.sleepSchedule === opt.value
                        ? "bg-indigo-50 border-indigo-300 ring-1 ring-indigo-200"
                        : "bg-white border-gray-200 hover:border-indigo-200"
                    )}
                  >
                    <div className={cn(
                      "w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center",
                      prefs.sleepSchedule === opt.value ? "border-indigo-600" : "border-gray-300"
                    )}>
                      {prefs.sleepSchedule === opt.value && (
                        <div className="w-2 h-2 rounded-full bg-indigo-600" />
                      )}
                    </div>
                    <div>
                      <span className="text-sm font-medium text-gray-900">{opt.label}</span>
                      <span className="text-xs text-gray-500 ml-2">({opt.desc})</span>
                    </div>
                  </button>
                ))}
              </div>
            </Section>

            {/* ─── Budget Comfort ──────────────────────────────────────── */}
            <Section title="Budget Comfort">
              <div className="flex gap-2 flex-wrap">
                {BUDGET_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => updatePrefs((p) => ({ ...p, budgetComfort: opt.value }))}
                    className={cn(
                      "flex-1 min-w-[120px] px-3 py-2.5 text-sm font-medium rounded-xl border transition-colors",
                      prefs.budgetComfort === opt.value
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </Section>
          </div>

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
