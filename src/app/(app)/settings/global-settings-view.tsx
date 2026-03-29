"use client"

import { useState, useRef } from "react"
import { toast } from "sonner"
import {
  createTravelerProfile,
  deleteTravelerProfile,
  updateTravelerProfile,
  updateTravelerPreferences,
} from "@/lib/actions/travelers"
import { updatePreferences, updateTimezone } from "@/lib/actions/preferences"
import { cn, getAgeGroupLabel, getCustomTags, getDefaultAvatar } from "@/lib/utils"
import { User, Users, Plus, Trash2, X, Save, Mail, Copy, Check, Globe, ChevronDown, ChevronRight, Camera, Clock } from "lucide-react"
import type { Prisma } from "@prisma/client"

type TravelerProfile = {
  id: string
  name: string
  birthDate: Date | null
  sex: string | null
  photoUrl: string | null
  tags: string[]
  isDefault: boolean
  preferences: Record<string, unknown> | null
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
  showFreeTime?: boolean
  freeTimeMinGapHours?: number
} | null

interface Props {
  user: { name?: string | null; email?: string | null; image?: string | null; id?: string } | null
  initialProfiles: TravelerProfile[]
  initialPrefs: Preferences
  initialTimezone: string
}

const TIMEZONE_OPTIONS = [
  { value: "AUTO", label: "Auto-detect (uses browser timezone)" },
  { value: "America/New_York", label: "Eastern (America/New_York)" },
  { value: "America/Chicago", label: "Central (America/Chicago)" },
  { value: "America/Denver", label: "Mountain (America/Denver)" },
  { value: "America/Los_Angeles", label: "Pacific (America/Los_Angeles)" },
  { value: "America/Anchorage", label: "Alaska (America/Anchorage)" },
  { value: "Pacific/Honolulu", label: "Hawaii (Pacific/Honolulu)" },
]

const PACING_STYLES = ["CHILL", "LEISURELY", "MODERATE", "ACTIVE", "PACKED"] as const
const TABS = ["Travelers", "Preferences", "Account"] as const
type Tab = (typeof TABS)[number]

const SUGGESTED_CUSTOM_TAGS = [
  "stroller-needed", "thrill-seeker", "picky-eater", "motion-sickness",
  "accessibility-needs", "early-riser", "nap-time", "vegetarian",
  "food-allergies", "fear-of-heights",
]
const MEAL_PREFS = ["quick", "sit-down", "local", "upscale", "vegetarian-friendly", "allergy-aware"]
const ACTIVITY_MIX = ["sightseeing", "beach", "food", "adventure", "relaxation", "museums", "nightlife", "shopping"]

// ─── Traveler Preference Constants (inline) ─────────────────────────────────

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

interface TravelerPreferencesData {
  cuisine?: Record<string, number>
  activities?: Record<string, number>
  dietary?: string[]
  mobility?: string[]
  pace?: string
  sleepSchedule?: string
  budgetComfort?: string
}

function cuisineKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, "-")
}

function parsePreferences(raw: Record<string, unknown> | null): TravelerPreferencesData {
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

// Max photo size: 200KB
const MAX_PHOTO_SIZE = 200 * 1024

function getPreferenceSummary(prefs: TravelerPreferencesData): string[] {
  const summary: string[] = []
  if (prefs.cuisine) {
    const loved = Object.entries(prefs.cuisine)
      .filter(([, v]) => v >= 4)
      .map(([k]) => k.replace(/-/g, " "))
    if (loved.length > 0) summary.push(`Loves ${loved.slice(0, 2).join(", ")}`)
  }
  if (prefs.activities) {
    const loved = Object.entries(prefs.activities)
      .filter(([, v]) => v >= 4)
      .map(([k]) => k.replace(/-/g, " "))
    if (loved.length > 0) summary.push(`Enjoys ${loved.slice(0, 2).join(", ")}`)
  }
  if (prefs.dietary && prefs.dietary.length > 0) {
    summary.push(prefs.dietary.slice(0, 2).join(", "))
  }
  if (prefs.mobility && prefs.mobility.length > 0) {
    summary.push(prefs.mobility[0])
  }
  if (prefs.pace) summary.push(`${prefs.pace} pace`)
  if (prefs.budgetComfort) summary.push(prefs.budgetComfort)
  return summary
}

// ─── Collapsible Section ─────────────────────────────────────────────────────

function Section({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition-colors"
      >
        <h4 className="font-medium text-sm text-gray-900">{title}</h4>
        {open ? (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-400" />
        )}
      </button>
      {open && <div className="px-4 pb-4 -mt-1">{children}</div>}
    </div>
  )
}

// ─── Emoji Rating ─────────────────────────────────────────────────────────────

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

// ─── Avatar Component ─────────────────────────────────────────────────────────

function TravelerAvatar({ profile, size = "md" }: { profile: TravelerProfile; size?: "sm" | "md" | "lg" }) {
  const sizeClasses = size === "sm" ? "w-9 h-9 text-lg" : size === "lg" ? "w-16 h-16 text-3xl" : "w-10 h-10 text-xl"
  if (profile.photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={profile.photoUrl}
        alt={profile.name}
        className={cn(sizeClasses, "rounded-full object-cover")}
      />
    )
  }
  const emoji = getDefaultAvatar(profile.birthDate, profile.sex)
  return (
    <div className={cn(sizeClasses, "bg-indigo-50 rounded-full flex items-center justify-center")}>
      {emoji}
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function GlobalSettingsView({ user, initialProfiles, initialPrefs, initialTimezone }: Props) {
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
  const [timezone, setTimezone] = useState(initialTimezone)
  const [savingTimezone, setSavingTimezone] = useState(false)
  const [showAddProfile, setShowAddProfile] = useState(false)
  const [savingPrefs, setSavingPrefs] = useState(false)
  const [copiedEmail, setCopiedEmail] = useState(false)
  const [expandedProfileId, setExpandedProfileId] = useState<string | null>(null)
  const [profileForm, setProfileForm] = useState({
    name: "",
    birthDate: "",
    sex: "" as string,
    photoUrl: "" as string,
    tags: [] as string[],
    isDefault: false,
  })

  // Per-profile traveler preferences state
  const [travPrefsMap, setTravPrefsMap] = useState<Record<string, TravelerPreferencesData>>(() => {
    const map: Record<string, TravelerPreferencesData> = {}
    for (const p of initialProfiles) {
      map[p.id] = parsePreferences(p.preferences)
    }
    return map
  })
  const [savingTravPrefs, setSavingTravPrefs] = useState<string | null>(null)

  // Edit form state for expanded profile
  const [editForm, setEditForm] = useState<{
    name: string
    birthDate: string
    sex: string
    photoUrl: string
    tags: string[]
    isDefault: boolean
  } | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const addFileInputRef = useRef<HTMLInputElement>(null)

  function toggleTag(list: string[], tag: string): string[] {
    return list.includes(tag) ? list.filter((t) => t !== tag) : [...list, tag]
  }

  function handleExpandProfile(profileId: string) {
    if (expandedProfileId === profileId) {
      setExpandedProfileId(null)
      setEditForm(null)
      return
    }
    setExpandedProfileId(profileId)
    const p = profiles.find((x) => x.id === profileId)
    if (p) {
      setEditForm({
        name: p.name,
        birthDate: p.birthDate ? new Date(p.birthDate).toISOString().split("T")[0] : "",
        sex: p.sex || "",
        photoUrl: p.photoUrl || "",
        tags: [...p.tags],
        isDefault: p.isDefault,
      })
    }
  }

  async function handleFileUpload(file: File, target: "add" | "edit") {
    if (file.size > MAX_PHOTO_SIZE * 3) {
      // Try to compress
    }
    return new Promise<string>((resolve, reject) => {
      const img = new Image()
      const reader = new FileReader()
      reader.onload = () => {
        img.onload = () => {
          const canvas = document.createElement("canvas")
          const maxDim = 200
          let w = img.width
          let h = img.height
          if (w > maxDim || h > maxDim) {
            if (w > h) { h = Math.round(h * maxDim / w); w = maxDim }
            else { w = Math.round(w * maxDim / h); h = maxDim }
          }
          canvas.width = w
          canvas.height = h
          const ctx = canvas.getContext("2d")!
          ctx.drawImage(img, 0, 0, w, h)
          let quality = 0.8
          let dataUrl = canvas.toDataURL("image/jpeg", quality)
          // Shrink quality until under 200KB
          while (dataUrl.length > MAX_PHOTO_SIZE * 1.37 && quality > 0.1) {
            quality -= 0.1
            dataUrl = canvas.toDataURL("image/jpeg", quality)
          }
          if (target === "add") {
            setProfileForm((f) => ({ ...f, photoUrl: dataUrl }))
          } else if (editForm) {
            setEditForm((f) => f ? { ...f, photoUrl: dataUrl } : f)
          }
          resolve(dataUrl)
        }
        img.src = reader.result as string
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
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
        sex: (profileForm.sex as "male" | "female" | "other") || undefined,
        photoUrl: profileForm.photoUrl || undefined,
        tags: profileForm.tags,
        isDefault: profileForm.isDefault,
      })
      const newProfile: TravelerProfile = {
        id: profile.id,
        name: profile.name,
        birthDate: profile.birthDate,
        sex: profile.sex,
        photoUrl: profile.photoUrl,
        tags: profile.tags,
        isDefault: profile.isDefault,
        preferences: null,
      }
      setProfiles((prev) => [...prev, newProfile])
      setTravPrefsMap((prev) => ({ ...prev, [profile.id]: {} }))
      setShowAddProfile(false)
      setProfileForm({ name: "", birthDate: "", sex: "", photoUrl: "", tags: [], isDefault: false })
      toast.success("Traveler added")
    } catch {
      toast.error("Failed to add traveler")
    }
  }

  async function handleSaveEdit(profileId: string) {
    if (!editForm || !editForm.name.trim()) {
      toast.error("Name is required")
      return
    }
    setSavingEdit(true)
    try {
      await updateTravelerProfile(profileId, {
        name: editForm.name.trim(),
        birthDate: editForm.birthDate || undefined,
        sex: (editForm.sex as "male" | "female" | "other") || undefined,
        photoUrl: editForm.photoUrl || undefined,
        tags: editForm.tags,
        isDefault: editForm.isDefault,
      })
      setProfiles((prev) =>
        prev.map((p) =>
          p.id === profileId
            ? {
                ...p,
                name: editForm.name.trim(),
                birthDate: editForm.birthDate ? new Date(editForm.birthDate) : null,
                sex: editForm.sex || null,
                photoUrl: editForm.photoUrl || null,
                tags: editForm.tags,
                isDefault: editForm.isDefault,
              }
            : editForm.isDefault ? { ...p, isDefault: false } : p
        )
      )
      toast.success("Traveler updated")
    } catch {
      toast.error("Failed to update traveler")
    } finally {
      setSavingEdit(false)
    }
  }

  async function handleDeleteProfile(profileId: string) {
    if (!confirm("Delete this traveler profile? This cannot be undone.")) return
    try {
      await deleteTravelerProfile(profileId)
      setProfiles((prev) => prev.filter((p) => p.id !== profileId))
      if (expandedProfileId === profileId) {
        setExpandedProfileId(null)
        setEditForm(null)
      }
      toast.success("Traveler removed")
    } catch {
      toast.error("Failed to remove traveler")
    }
  }

  function updateTravPrefs(profileId: string, updater: (prev: TravelerPreferencesData) => TravelerPreferencesData) {
    setTravPrefsMap((prev) => ({
      ...prev,
      [profileId]: updater(prev[profileId] ?? {}),
    }))
  }

  async function handleSaveTravPrefs(profileId: string) {
    const prefs = travPrefsMap[profileId]
    if (!prefs) return
    setSavingTravPrefs(profileId)
    try {
      await updateTravelerPreferences(profileId, prefs as unknown as Prisma.InputJsonValue)
      setProfiles((prev) =>
        prev.map((p) =>
          p.id === profileId ? { ...p, preferences: prefs as unknown as Record<string, unknown> } : p
        )
      )
      toast.success("Preferences saved")
    } catch {
      toast.error("Failed to save preferences")
    } finally {
      setSavingTravPrefs(null)
    }
  }

  async function handleTimezoneChange(newTimezone: string) {
    setTimezone(newTimezone)
    setSavingTimezone(true)
    try {
      await updateTimezone(newTimezone)
      toast.success("Timezone updated")
    } catch {
      toast.error("Failed to update timezone")
    } finally {
      setSavingTimezone(false)
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
                Manage profiles, preferences, and photos for everyone who travels with you
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
          <div className="space-y-3 mb-4">
            {profiles.map((profile) => {
              const isExpanded = expandedProfileId === profile.id
              const travPrefs = travPrefsMap[profile.id] ?? {}
              const prefsSummary = getPreferenceSummary(parsePreferences(profile.preferences))

              return (
                <div key={profile.id} className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
                  {/* Summary row */}
                  <button
                    onClick={() => handleExpandProfile(profile.id)}
                    className="w-full p-4 flex items-center gap-3 text-left hover:bg-gray-50 transition-colors"
                  >
                    <TravelerAvatar profile={profile} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900 text-sm">
                          {profile.name}
                          {profile.birthDate && (
                            <span className="text-gray-400 font-normal">
                              {" "}&middot; {getAgeGroupLabel(profile.birthDate)}
                            </span>
                          )}
                        </span>
                        {profile.isDefault && (
                          <span className="px-1.5 py-0.5 text-[10px] bg-indigo-50 text-indigo-600 rounded font-medium">
                            Default
                          </span>
                        )}
                      </div>
                      {prefsSummary.length > 0 && (
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {prefsSummary.slice(0, 3).map((s, i) => (
                            <span key={i} className="px-1.5 py-0.5 text-[10px] bg-gray-100 text-gray-500 rounded">
                              {s}
                            </span>
                          ))}
                          {prefsSummary.length > 3 && (
                            <span className="px-1.5 py-0.5 text-[10px] bg-gray-100 text-gray-400 rounded">
                              +{prefsSummary.length - 3} more
                            </span>
                          )}
                        </div>
                      )}
                      {prefsSummary.length === 0 && getCustomTags(profile.tags).length > 0 && (
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {getCustomTags(profile.tags).map((tag) => (
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
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                    )}
                  </button>

                  {/* Expanded editor */}
                  {isExpanded && editForm && (
                    <div className="border-t border-gray-100 p-5 space-y-5">
                      {/* Photo + basic info */}
                      <div className="flex gap-5">
                        <div className="flex flex-col items-center gap-2">
                          <TravelerAvatar profile={{ ...profile, photoUrl: editForm.photoUrl || null, sex: editForm.sex || null, birthDate: editForm.birthDate ? new Date(editForm.birthDate) : null }} size="lg" />
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0]
                              if (file) handleFileUpload(file, "edit")
                            }}
                          />
                          <button
                            onClick={() => fileInputRef.current?.click()}
                            className="flex items-center gap-1 px-2 py-1 text-xs text-indigo-600 hover:text-indigo-800 transition-colors"
                          >
                            <Camera className="w-3 h-3" />
                            {editForm.photoUrl ? "Change" : "Upload"}
                          </button>
                          {editForm.photoUrl && (
                            <button
                              onClick={() => setEditForm((f) => f ? { ...f, photoUrl: "" } : f)}
                              className="text-[10px] text-red-500 hover:text-red-700"
                            >
                              Remove photo
                            </button>
                          )}
                        </div>
                        <div className="flex-1 space-y-3">
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">Name *</label>
                            <input
                              type="text"
                              value={editForm.name}
                              onChange={(e) => setEditForm((f) => f ? { ...f, name: e.target.value } : f)}
                              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">Birth date</label>
                              <input
                                type="date"
                                value={editForm.birthDate}
                                onChange={(e) => setEditForm((f) => f ? { ...f, birthDate: e.target.value } : f)}
                                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">Sex</label>
                              <select
                                value={editForm.sex}
                                onChange={(e) => setEditForm((f) => f ? { ...f, sex: e.target.value } : f)}
                                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                              >
                                <option value="">Not specified</option>
                                <option value="male">Male</option>
                                <option value="female">Female</option>
                                <option value="other">Other</option>
                              </select>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Tags */}
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Custom tags</label>
                        <div className="flex flex-wrap gap-1.5">
                          {SUGGESTED_CUSTOM_TAGS.map((tag) => (
                            <button
                              key={tag}
                              onClick={() => setEditForm((f) => f ? { ...f, tags: toggleTag(f.tags, tag) } : f)}
                              className={cn(
                                "px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors",
                                editForm.tags.includes(tag)
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
                          checked={editForm.isDefault}
                          onChange={(e) => setEditForm((f) => f ? { ...f, isDefault: e.target.checked } : f)}
                          className="rounded"
                        />
                        Default traveler (you)
                      </label>

                      <div className="flex gap-3">
                        <button
                          onClick={() => handleSaveEdit(profile.id)}
                          disabled={savingEdit}
                          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                        >
                          <Save className="w-3.5 h-3.5" />
                          {savingEdit ? "Saving..." : "Save profile"}
                        </button>
                        <button
                          onClick={() => handleDeleteProfile(profile.id)}
                          className="flex items-center gap-2 px-4 py-2 text-red-600 text-sm font-medium hover:text-red-700 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Delete
                        </button>
                      </div>

                      {/* ─── Preferences Section ─── */}
                      <div className="border-t border-gray-100 pt-5">
                        <h3 className="font-semibold text-gray-900 mb-3">
                          {editForm.name || profile.name}&apos;s Preferences
                        </h3>
                        <div className="space-y-3">
                          {/* Cuisine */}
                          <Section title="Cuisine Preferences">
                            <p className="text-xs text-gray-500 mb-3">Rate each cuisine type.</p>
                            <div className="space-y-2">
                              {CUISINE_TYPES.map((cuisine) => {
                                const key = cuisineKey(cuisine)
                                const value = travPrefs.cuisine?.[key] ?? 3
                                return (
                                  <div key={cuisine} className="flex items-center gap-3">
                                    <span className="text-sm text-gray-700 w-36 shrink-0 truncate">{cuisine}</span>
                                    <EmojiRating
                                      value={value}
                                      onChange={(v) =>
                                        updateTravPrefs(profile.id, (p) => {
                                          const c = { ...p.cuisine }
                                          if (v === 3) delete c[key]; else c[key] = v
                                          return { ...p, cuisine: c }
                                        })
                                      }
                                    />
                                  </div>
                                )
                              })}
                            </div>
                          </Section>

                          {/* Activities */}
                          <Section title="Activity Preferences">
                            <p className="text-xs text-gray-500 mb-3">Rate how much you enjoy each activity type.</p>
                            <div className="space-y-2">
                              {ACTIVITY_TYPES.map((activity) => {
                                const key = cuisineKey(activity.label)
                                const value = travPrefs.activities?.[key] ?? 3
                                return (
                                  <div key={activity.label} className="flex items-center gap-3">
                                    <span className="text-sm text-gray-700 w-36 shrink-0 truncate">
                                      {activity.emoji} {activity.label}
                                    </span>
                                    <EmojiRating
                                      value={value}
                                      onChange={(v) =>
                                        updateTravPrefs(profile.id, (p) => {
                                          const a = { ...p.activities }
                                          if (v === 3) delete a[key]; else a[key] = v
                                          return { ...p, activities: a }
                                        })
                                      }
                                    />
                                  </div>
                                )
                              })}
                            </div>
                          </Section>

                          {/* Dietary */}
                          <Section title="Dietary Restrictions">
                            <p className="text-xs text-gray-500 mb-3">Select all that apply</p>
                            <div className="flex flex-wrap gap-2">
                              {DIETARY_OPTIONS.map((item) => (
                                <button
                                  key={item}
                                  onClick={() =>
                                    updateTravPrefs(profile.id, (p) => ({
                                      ...p,
                                      dietary: toggleArrayItem(p.dietary ?? [], item),
                                    }))
                                  }
                                  className={cn(
                                    "px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors",
                                    (travPrefs.dietary ?? []).includes(item)
                                      ? "bg-indigo-600 text-white border-indigo-600"
                                      : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"
                                  )}
                                >
                                  {item}
                                </button>
                              ))}
                            </div>
                          </Section>

                          {/* Mobility */}
                          <Section title="Mobility & Comfort">
                            <p className="text-xs text-gray-500 mb-3">Select all that apply</p>
                            <div className="flex flex-wrap gap-2">
                              {MOBILITY_OPTIONS.map((item) => (
                                <button
                                  key={item}
                                  onClick={() =>
                                    updateTravPrefs(profile.id, (p) => ({
                                      ...p,
                                      mobility: toggleArrayItem(p.mobility ?? [], item),
                                    }))
                                  }
                                  className={cn(
                                    "px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors",
                                    (travPrefs.mobility ?? []).includes(item)
                                      ? "bg-indigo-600 text-white border-indigo-600"
                                      : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"
                                  )}
                                >
                                  {item}
                                </button>
                              ))}
                            </div>
                          </Section>

                          {/* Pace */}
                          <Section title="Travel Pace">
                            <div className="space-y-2">
                              {PACE_OPTIONS.map((opt) => (
                                <button
                                  key={opt.value}
                                  onClick={() => updateTravPrefs(profile.id, (p) => ({ ...p, pace: opt.value }))}
                                  className={cn(
                                    "w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors text-left",
                                    travPrefs.pace === opt.value
                                      ? "bg-indigo-50 border-indigo-300 ring-1 ring-indigo-200"
                                      : "bg-white border-gray-200 hover:border-indigo-200"
                                  )}
                                >
                                  <div className={cn(
                                    "w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center",
                                    travPrefs.pace === opt.value ? "border-indigo-600" : "border-gray-300"
                                  )}>
                                    {travPrefs.pace === opt.value && <div className="w-2 h-2 rounded-full bg-indigo-600" />}
                                  </div>
                                  <div>
                                    <span className="text-sm font-medium text-gray-900">{opt.label}</span>
                                    <span className="text-xs text-gray-500 ml-2">({opt.desc})</span>
                                  </div>
                                </button>
                              ))}
                            </div>
                          </Section>

                          {/* Sleep */}
                          <Section title="Sleep Schedule">
                            <div className="space-y-2">
                              {SLEEP_OPTIONS.map((opt) => (
                                <button
                                  key={opt.value}
                                  onClick={() => updateTravPrefs(profile.id, (p) => ({ ...p, sleepSchedule: opt.value }))}
                                  className={cn(
                                    "w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors text-left",
                                    travPrefs.sleepSchedule === opt.value
                                      ? "bg-indigo-50 border-indigo-300 ring-1 ring-indigo-200"
                                      : "bg-white border-gray-200 hover:border-indigo-200"
                                  )}
                                >
                                  <div className={cn(
                                    "w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center",
                                    travPrefs.sleepSchedule === opt.value ? "border-indigo-600" : "border-gray-300"
                                  )}>
                                    {travPrefs.sleepSchedule === opt.value && <div className="w-2 h-2 rounded-full bg-indigo-600" />}
                                  </div>
                                  <div>
                                    <span className="text-sm font-medium text-gray-900">{opt.label}</span>
                                    <span className="text-xs text-gray-500 ml-2">({opt.desc})</span>
                                  </div>
                                </button>
                              ))}
                            </div>
                          </Section>

                          {/* Budget */}
                          <Section title="Budget Comfort">
                            <div className="flex gap-2 flex-wrap">
                              {BUDGET_OPTIONS.map((opt) => (
                                <button
                                  key={opt.value}
                                  onClick={() => updateTravPrefs(profile.id, (p) => ({ ...p, budgetComfort: opt.value }))}
                                  className={cn(
                                    "flex-1 min-w-[120px] px-3 py-2.5 text-sm font-medium rounded-xl border transition-colors",
                                    travPrefs.budgetComfort === opt.value
                                      ? "bg-indigo-600 text-white border-indigo-600"
                                      : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"
                                  )}
                                >
                                  {opt.label}
                                </button>
                              ))}
                            </div>
                          </Section>

                          {/* Save prefs button */}
                          <button
                            onClick={() => handleSaveTravPrefs(profile.id)}
                            disabled={savingTravPrefs === profile.id}
                            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                          >
                            <Save className="w-3.5 h-3.5" />
                            {savingTravPrefs === profile.id ? "Saving..." : `Save ${editForm.name || profile.name}'s preferences`}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
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
                <div className="flex gap-4">
                  {/* Photo upload */}
                  <div className="flex flex-col items-center gap-2">
                    {profileForm.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={profileForm.photoUrl} alt="" className="w-16 h-16 rounded-full object-cover" />
                    ) : (
                      <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center text-2xl">
                        {getDefaultAvatar(
                          profileForm.birthDate ? new Date(profileForm.birthDate) : undefined,
                          profileForm.sex || undefined
                        )}
                      </div>
                    )}
                    <input
                      ref={addFileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) handleFileUpload(file, "add")
                      }}
                    />
                    <button
                      onClick={() => addFileInputRef.current?.click()}
                      className="flex items-center gap-1 px-2 py-1 text-xs text-indigo-600 hover:text-indigo-800"
                    >
                      <Camera className="w-3 h-3" />
                      Photo
                    </button>
                  </div>
                  <div className="flex-1 space-y-3">
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
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Birth date</label>
                        <input
                          type="date"
                          value={profileForm.birthDate}
                          onChange={(e) => setProfileForm((f) => ({ ...f, birthDate: e.target.value }))}
                          className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Sex</label>
                        <select
                          value={profileForm.sex}
                          onChange={(e) => setProfileForm((f) => ({ ...f, sex: e.target.value }))}
                          className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                        >
                          <option value="">Not specified</option>
                          <option value="male">Male</option>
                          <option value="female">Female</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-gray-500 mb-1">Custom tags</label>
                  <p className="text-[10px] text-gray-400 mb-2">
                    Age group is auto-derived from birth date. Add custom tags for special needs or traits.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {SUGGESTED_CUSTOM_TAGS.map((tag) => (
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
            <div className="flex items-center gap-2 mb-4">
              <Globe className="w-4 h-4 text-indigo-500" />
              <h3 className="font-semibold text-gray-900">Timezone</h3>
            </div>
            <p className="text-sm text-gray-500 mb-3">
              Used for displaying dates and countdown timers across the app.
            </p>
            <select
              value={timezone}
              onChange={(e) => handleTimezoneChange(e.target.value)}
              disabled={savingTimezone}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white disabled:opacity-50"
            >
              {TIMEZONE_OPTIONS.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
            {timezone === "AUTO" && (
              <p className="text-xs text-gray-400 mt-2">
                Your browser reports: {typeof window !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "detecting..."}
              </p>
            )}
          </div>

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
            <div className="flex items-center gap-2 mb-4">
              <Clock className="w-4 h-4 text-indigo-500" />
              <h3 className="font-semibold text-gray-900">Free Time Display</h3>
            </div>
            <p className="text-sm text-gray-500 mb-3">
              Show free time blocks on your itinerary to identify gaps in your schedule.
              You can also toggle this directly from the Plan page header.
            </p>
            <div className="space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs.showFreeTime ?? false}
                  onChange={(e) => setPrefs((p) => p ? { ...p, showFreeTime: e.target.checked } : p)}
                  className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm font-medium text-gray-700">Show free time blocks on itinerary</span>
              </label>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Minimum gap to show (hours)
                </label>
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={prefs.freeTimeMinGapHours ?? 2}
                  onChange={(e) =>
                    setPrefs((p) => p ? { ...p, freeTimeMinGapHours: parseInt(e.target.value) || 2 } : p)
                  }
                  className="w-24 px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
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

          {user?.id && (
            <div className="bg-white border border-gray-100 rounded-2xl p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
                  <Mail className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">Email Forwarding</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Auto-import flights and hotels from confirmation emails
                  </p>
                </div>
              </div>
              <p className="text-sm text-gray-600 mb-3">
                Forward your flight or hotel confirmation emails to this address and
                we&apos;ll automatically add them to your next trip.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-800 font-mono truncate">
                  trips+{user.id}@inbound.journeyperfect.com
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(`trips+${user.id}@inbound.journeyperfect.com`)
                    setCopiedEmail(true)
                    setTimeout(() => setCopiedEmail(false), 2000)
                  }}
                  className="shrink-0 p-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
                  title="Copy email address"
                >
                  {copiedEmail ? (
                    <Check className="w-4 h-4 text-green-600" />
                  ) : (
                    <Copy className="w-4 h-4 text-gray-500" />
                  )}
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Works with flight confirmations from airlines and hotel booking confirmations.
                Requires a paid plan.
              </p>
            </div>
          )}

          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <h3 className="font-semibold text-gray-900 mb-2">About JourneyPerfect</h3>
            <p className="text-sm text-gray-500">
              JourneyPerfect helps you plan perfect vacations by organizing flights, hotels, activities,
              budgets, and itineraries in one beautifully designed app.
            </p>
            <div className="mt-4 text-xs text-gray-400">Version 1.0 · Built with &#9829;</div>
          </div>
        </div>
      )}
    </div>
  )
}
