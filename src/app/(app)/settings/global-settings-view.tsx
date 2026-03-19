"use client"

import { useState } from "react"
import { toast } from "sonner"
import {
  createTravelerProfile,
  deleteTravelerProfile,
  updateTravelerProfile,
} from "@/lib/actions/travelers"
import type { TravelerProfileResult } from "@/lib/actions/travelers"
import { updatePreferences } from "@/lib/actions/preferences"
import { cn } from "@/lib/utils"
import { User, Users, Settings, Plus, Trash2, X, Save } from "lucide-react"

type TravelerProfile = {
  id: string
  name: string
  birthDate: Date | null
  tags: string[]
  isDefault: boolean
}

type Preferences = {
  airportArrivalBufferMins: number
  pacingStyle: string
  avgDailyBudget: number | null
  wakeUpTime: string
  bedTime: string
  mealStylePrefs: string[]
  activityMix: string[]
  mobilityNotes: string | null
  maxDailyTravelMins: number
} | null

interface Props {
  user: { name?: string | null; email?: string | null; image?: string | null } | null
  initialProfiles: TravelerProfile[]
  initialPrefs: Preferences
}

const PACING_STYLES = ["CHILL", "LEISURELY", "MODERATE", "ACTIVE", "PACKED"] as const
const TABS = ["Travelers", "Preferences", "Account"] as const
type Tab = (typeof TABS)[number]

const COMMON_TAGS = ["adult", "child", "senior", "stroller-needed", "thrill-seeker", "accessibility-needs"]
const MEAL_PREFS = ["quick", "sit-down", "local", "upscale", "vegetarian-friendly", "allergy-aware"]
const ACTIVITY_MIX = ["sightseeing", "beach", "food", "adventure", "relaxation", "museums", "nightlife", "shopping"]

export function GlobalSettingsView({ user, initialProfiles, initialPrefs }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("Travelers")
  const [profiles, setProfiles] = useState<TravelerProfile[]>(initialProfiles)
  const [prefs, setPrefs] = useState<Preferences>(
    initialPrefs || {
      airportArrivalBufferMins: 90,
      pacingStyle: "MODERATE",
      avgDailyBudget: null,
      wakeUpTime: "08:00",
      bedTime: "22:00",
      mealStylePrefs: [],
      activityMix: [],
      mobilityNotes: null,
      maxDailyTravelMins: 60,
    }
  )
  const [showAddProfile, setShowAddProfile] = useState(false)
  const [savingPrefs, setSavingPrefs] = useState(false)
  const [profileForm, setProfileForm] = useState({
    name: "",
    birthDate: "",
    tags: [] as string[],
    isDefault: false,
  })

  function toggleTag(list: string[], tag: string): string[] {
    return list.includes(tag) ? list.filter((t) => t !== tag) : [...list, tag]
  }

  async function handleAddProfile() {
    if (!profileForm.name) {
      toast.error("Name is required")
      return
    }
    try {
      const profile = await createTravelerProfile({
        name: profileForm.name,
        birthDate: profileForm.birthDate || undefined,
        tags: profileForm.tags,
        isDefault: profileForm.isDefault,
      })
      const newProfile: TravelerProfile = {
        id: profile.id,
        name: profile.name,
        birthDate: profile.birthDate,
        tags: profile.tags,
        isDefault: profile.isDefault,
      }
      setProfiles((prev) => [...prev, newProfile])
      setShowAddProfile(false)
      setProfileForm({ name: "", birthDate: "", tags: [], isDefault: false })
      toast.success("Traveler added")
    } catch {
      toast.error("Failed to add traveler")
    }
  }

  async function handleDeleteProfile(profileId: string) {
    try {
      await deleteTravelerProfile(profileId)
      setProfiles((prev) => prev.filter((p) => p.id !== profileId))
      toast.success("Traveler removed")
    } catch {
      toast.error("Failed to remove traveler")
    }
  }

  async function handleSavePrefs() {
    if (!prefs) return
    setSavingPrefs(true)
    try {
      await updatePreferences({
        airportArrivalBufferMins: prefs.airportArrivalBufferMins,
        pacingStyle: prefs.pacingStyle as "CHILL" | "LEISURELY" | "MODERATE" | "ACTIVE" | "PACKED",
        avgDailyBudget: prefs.avgDailyBudget ?? undefined,
        wakeUpTime: prefs.wakeUpTime,
        bedTime: prefs.bedTime,
        mealStylePrefs: prefs.mealStylePrefs,
        activityMix: prefs.activityMix,
        mobilityNotes: prefs.mobilityNotes ?? undefined,
        maxDailyTravelMins: prefs.maxDailyTravelMins,
      })
      toast.success("Preferences saved")
    } catch {
      toast.error("Failed to save preferences")
    } finally {
      setSavingPrefs(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-8">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "flex-1 py-2 text-sm font-medium rounded-lg transition-colors",
              activeTab === tab
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* TRAVELERS */}
      {activeTab === "Travelers" && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold text-gray-900">Traveler Profiles</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Add people who travel with you for accurate pricing and scheduling
              </p>
            </div>
            <button
              onClick={() => setShowAddProfile(true)}
              className="flex items-center gap-2 px-3 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add traveler
            </button>
          </div>

          {profiles.length === 0 && !showAddProfile && (
            <div className="text-center py-12">
              <Users className="w-10 h-10 text-gray-200 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No traveler profiles yet</p>
              <p className="text-gray-400 text-xs mt-1">
                Add yourself, your partner, kids, etc.
              </p>
            </div>
          )}

          {/* Profile list */}
          <div className="space-y-2 mb-4">
            {profiles.map((profile) => (
              <div
                key={profile.id}
                className="bg-white border border-gray-100 rounded-2xl p-4 flex items-center gap-3 group"
              >
                <div className="w-10 h-10 bg-indigo-50 rounded-full flex items-center justify-center text-sm font-bold text-indigo-600">
                  {profile.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 text-sm">{profile.name}</span>
                    {profile.isDefault && (
                      <span className="px-1.5 py-0.5 text-[10px] bg-indigo-50 text-indigo-600 rounded font-medium">
                        Default
                      </span>
                    )}
                  </div>
                  {profile.birthDate && (
                    <div className="text-xs text-gray-500 mt-0.5">
                      Born {new Date(profile.birthDate).toLocaleDateString()}
                    </div>
                  )}
                  {profile.tags.length > 0 && (
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {profile.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-1.5 py-0.5 text-[10px] bg-gray-100 text-gray-600 rounded"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => handleDeleteProfile(profile.id)}
                  className="p-1.5 text-gray-400 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          {/* Add profile form */}
          {showAddProfile && (
            <div className="bg-white border border-indigo-200 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-900">Add Traveler</h3>
                <button onClick={() => setShowAddProfile(false)}>
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              </div>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Name *</label>
                    <input
                      type="text"
                      placeholder="e.g. Mom, Alex, Baby Sam"
                      value={profileForm.name}
                      onChange={(e) => setProfileForm((f) => ({ ...f, name: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Birth date (optional)</label>
                    <input
                      type="date"
                      value={profileForm.birthDate}
                      onChange={(e) => setProfileForm((f) => ({ ...f, birthDate: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-gray-500 mb-2">Tags</label>
                  <div className="flex flex-wrap gap-1.5">
                    {COMMON_TAGS.map((tag) => (
                      <button
                        key={tag}
                        onClick={() =>
                          setProfileForm((f) => ({ ...f, tags: toggleTag(f.tags, tag) }))
                        }
                        className={cn(
                          "px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors",
                          profileForm.tags.includes(tag)
                            ? "bg-indigo-600 text-white border-indigo-600"
                            : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"
                        )}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={profileForm.isDefault}
                    onChange={(e) => setProfileForm((f) => ({ ...f, isDefault: e.target.checked }))}
                    className="rounded"
                  />
                  Make this the default traveler (you)
                </label>

                <div className="flex gap-3 pt-1">
                  <button
                    onClick={() => setShowAddProfile(false)}
                    className="flex-1 py-2.5 border border-gray-200 text-gray-700 text-sm rounded-xl hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddProfile}
                    className="flex-1 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700"
                  >
                    Add traveler
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* PREFERENCES */}
      {activeTab === "Preferences" && prefs && (
        <div className="space-y-6">
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <h3 className="font-semibold text-gray-900 mb-4">Schedule & Pacing</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Pacing style</label>
                <div className="flex gap-2 flex-wrap">
                  {PACING_STYLES.map((style) => (
                    <button
                      key={style}
                      onClick={() => setPrefs((p) => p ? { ...p, pacingStyle: style } : p)}
                      className={cn(
                        "px-3 py-2 text-sm font-medium rounded-xl border transition-colors",
                        prefs.pacingStyle === style
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"
                      )}
                    >
                      {style.charAt(0) + style.slice(1).toLowerCase()}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  Chill = lots of downtime · Packed = activities from open to close
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Wake up time</label>
                  <input
                    type="time"
                    value={prefs.wakeUpTime}
                    onChange={(e) => setPrefs((p) => p ? { ...p, wakeUpTime: e.target.value } : p)}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Bed time</label>
                  <input
                    type="time"
                    value={prefs.bedTime}
                    onChange={(e) => setPrefs((p) => p ? { ...p, bedTime: e.target.value } : p)}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Airport arrival buffer (min)
                  </label>
                  <input
                    type="number"
                    min={30}
                    max={240}
                    value={prefs.airportArrivalBufferMins}
                    onChange={(e) =>
                      setPrefs((p) => p ? { ...p, airportArrivalBufferMins: parseInt(e.target.value) || 90 } : p)
                    }
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Max daily travel (min)
                  </label>
                  <input
                    type="number"
                    min={15}
                    max={300}
                    value={prefs.maxDailyTravelMins}
                    onChange={(e) =>
                      setPrefs((p) => p ? { ...p, maxDailyTravelMins: parseInt(e.target.value) || 60 } : p)
                    }
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <h3 className="font-semibold text-gray-900 mb-4">Budget & Spending</h3>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Average daily budget ($ per person)
              </label>
              <input
                type="number"
                min={0}
                placeholder="e.g. 150"
                value={prefs.avgDailyBudget ?? ""}
                onChange={(e) =>
                  setPrefs((p) => p ? { ...p, avgDailyBudget: e.target.value ? parseFloat(e.target.value) : null } : p)
                }
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <h3 className="font-semibold text-gray-900 mb-4">Activity Preferences</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Activity mix</label>
                <div className="flex flex-wrap gap-1.5">
                  {ACTIVITY_MIX.map((pref) => (
                    <button
                      key={pref}
                      onClick={() =>
                        setPrefs((p) => p ? { ...p, activityMix: toggleTag(p.activityMix, pref) } : p)
                      }
                      className={cn(
                        "px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors",
                        prefs.activityMix.includes(pref)
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"
                      )}
                    >
                      {pref}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Dining style</label>
                <div className="flex flex-wrap gap-1.5">
                  {MEAL_PREFS.map((pref) => (
                    <button
                      key={pref}
                      onClick={() =>
                        setPrefs((p) => p ? { ...p, mealStylePrefs: toggleTag(p.mealStylePrefs, pref) } : p)
                      }
                      className={cn(
                        "px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors",
                        prefs.mealStylePrefs.includes(pref)
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"
                      )}
                    >
                      {pref}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Mobility notes (optional)
                </label>
                <textarea
                  value={prefs.mobilityNotes ?? ""}
                  onChange={(e) => setPrefs((p) => p ? { ...p, mobilityNotes: e.target.value || null } : p)}
                  placeholder="e.g. Need wheelchair-accessible venues, avoid stairs"
                  rows={2}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>
            </div>
          </div>

          <button
            onClick={handleSavePrefs}
            disabled={savingPrefs}
            className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            <Save className="w-4 h-4" />
            {savingPrefs ? "Saving..." : "Save preferences"}
          </button>
        </div>
      )}

      {/* ACCOUNT */}
      {activeTab === "Account" && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <h3 className="font-semibold text-gray-900 mb-4">Account</h3>
            <div className="flex items-center gap-4">
              {user?.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.image} alt="" className="w-14 h-14 rounded-full" />
              ) : (
                <div className="w-14 h-14 rounded-full bg-indigo-50 flex items-center justify-center">
                  <User className="w-7 h-7 text-indigo-600" />
                </div>
              )}
              <div>
                <div className="font-semibold text-gray-900">{user?.name || "No name"}</div>
                <div className="text-sm text-gray-500">{user?.email}</div>
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <h3 className="font-semibold text-gray-900 mb-2">About JourneyPerfect</h3>
            <p className="text-sm text-gray-500">
              JourneyPerfect helps you plan perfect vacations by organizing flights, hotels, activities,
              budgets, and itineraries in one beautifully designed app.
            </p>
            <div className="mt-4 text-xs text-gray-400">Version 1.0 · Built with ♥</div>
          </div>
        </div>
      )}
    </div>
  )
}
