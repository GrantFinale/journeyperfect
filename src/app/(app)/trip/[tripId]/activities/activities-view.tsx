"use client"

import { useState } from "react"
import { toast } from "sonner"
import { createActivity, deleteActivity, updateActivity, searchPlaces } from "@/lib/actions/activities"
import { priorityColor, priorityLabel, formatCurrency } from "@/lib/utils"
import { cn } from "@/lib/utils"
import {
  Star,
  Plus,
  Trash2,
  Search,
  MapPin,
  Clock,
  DollarSign,
  X,
  ExternalLink,
  ChevronDown,
  Lock,
  CalendarDays,
} from "lucide-react"

type Activity = {
  id: string
  name: string
  description: string | null
  address: string | null
  category: string | null
  durationMins: number
  costPerAdult: number
  costPerChild: number
  priority: string
  status: string
  rating: number | null
  imageUrl: string | null
  reservationNeeded: boolean
  bookingLink: string | null
  notes: string | null
  indoorOutdoor: string
  isFixed: boolean
  fixedDateTime: Date | string | null
}

type SearchResult = {
  googlePlaceId: string
  name: string
  address: string
  lat?: number
  lng?: number
  rating?: number
  imageUrl?: string | null
  types: string[]
}

const PRIORITY_OPTIONS = ["MUST_DO", "HIGH", "MEDIUM", "LOW"] as const

interface Props {
  tripId: string
  initialActivities: Activity[]
  destination: string
}

export function ActivitiesView({ tripId, initialActivities, destination }: Props) {
  const [activities, setActivities] = useState<Activity[]>(initialActivities)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [filterPriority, setFilterPriority] = useState<string>("ALL")
  const [filterStatus, setFilterStatus] = useState<string>("ALL")
  const [addForm, setAddForm] = useState({
    name: "",
    address: "",
    category: "",
    durationMins: 120,
    costPerAdult: 0,
    priority: "MEDIUM" as const,
    notes: "",
    reservationNeeded: false,
    bookingLink: "",
    isFixed: false,
    fixedDateTime: "",
  })

  const filtered = activities.filter((a) => {
    if (filterPriority !== "ALL" && a.priority !== filterPriority) return false
    if (filterStatus !== "ALL" && a.status !== filterStatus) return false
    return true
  })

  async function handleSearch() {
    if (!searchQuery.trim()) return
    setSearching(true)
    try {
      const result = await searchPlaces(searchQuery + " " + destination)
      setSearchResults(result.results)
      if (result.error) toast.error(result.error)
    } catch {
      toast.error("Search failed")
    } finally {
      setSearching(false)
    }
  }

  async function handleSaveFromSearch(place: SearchResult) {
    try {
      const activity = await createActivity(tripId, {
        name: place.name,
        address: place.address,
        lat: place.lat,
        lng: place.lng,
        googlePlaceId: place.googlePlaceId,
        rating: place.rating,
        imageUrl: place.imageUrl || undefined,
        priority: "MEDIUM",
        durationMins: 120,
        costPerAdult: 0,
        costPerChild: 0,
        category: place.types[0] || undefined,
        indoorOutdoor: "BOTH",
        reservationNeeded: false,
        isFixed: false,
      })
      setActivities((prev) => [activity as unknown as Activity, ...prev])
      toast.success(`${place.name} added to wishlist`)
    } catch {
      toast.error("Failed to save activity")
    }
  }

  async function handleAddManual() {
    if (!addForm.name) {
      toast.error("Name is required")
      return
    }
    try {
      const activity = await createActivity(tripId, {
        ...addForm,
        costPerChild: 0,
        indoorOutdoor: "BOTH",
        isFixed: addForm.isFixed,
        fixedDateTime: addForm.isFixed && addForm.fixedDateTime ? addForm.fixedDateTime : undefined,
        bookingLink: addForm.bookingLink || undefined,
      })
      setActivities((prev) => [activity as unknown as Activity, ...prev])
      setShowAddForm(false)
      setAddForm({
        name: "",
        address: "",
        category: "",
        durationMins: 120,
        costPerAdult: 0,
        priority: "MEDIUM",
        notes: "",
        reservationNeeded: false,
        bookingLink: "",
        isFixed: false,
        fixedDateTime: "",
      })
      toast.success("Activity added")
    } catch {
      toast.error("Failed to add activity")
    }
  }

  async function handleDelete(activityId: string) {
    try {
      await deleteActivity(tripId, activityId)
      setActivities((prev) => prev.filter((a) => a.id !== activityId))
      toast.success("Activity removed")
    } catch {
      toast.error("Failed to remove activity")
    }
  }

  async function handlePriorityChange(activityId: string, priority: string) {
    try {
      await updateActivity(tripId, activityId, { priority: priority as "MUST_DO" | "HIGH" | "MEDIUM" | "LOW" })
      setActivities((prev) => prev.map((a) => (a.id === activityId ? { ...a, priority } : a)))
    } catch {
      toast.error("Failed to update priority")
    }
  }

  async function handleToggleFixed(activityId: string, currentlyFixed: boolean) {
    try {
      await updateActivity(tripId, activityId, { isFixed: !currentlyFixed, ...(!currentlyFixed ? {} : { fixedDateTime: undefined }) })
      setActivities((prev) =>
        prev.map((a) =>
          a.id === activityId
            ? { ...a, isFixed: !currentlyFixed, fixedDateTime: !currentlyFixed ? a.fixedDateTime : null }
            : a
        )
      )
      toast.success(currentlyFixed ? "Date unlocked" : "Date locked")
    } catch {
      toast.error("Failed to update")
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Activities</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {activities.length} saved · {activities.filter((a) => a.status === "SCHEDULED").length} scheduled
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add activity
        </button>
      </div>

      {/* Search places */}
      <div className="bg-white border border-gray-100 rounded-2xl p-4 mb-6">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder={`Search places in ${destination}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={searching}
            className="px-4 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            {searching ? "..." : "Search"}
          </button>
        </div>

        {/* Search results */}
        {searchResults.length > 0 && (
          <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
            {searchResults.map((place) => (
              <div
                key={place.googlePlaceId}
                className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm text-gray-900 truncate">{place.name}</div>
                  <div className="text-xs text-gray-500 truncate flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {place.address}
                  </div>
                  {place.rating && (
                    <div className="text-xs text-yellow-600 flex items-center gap-1 mt-0.5">
                      <Star className="w-3 h-3 fill-current" />
                      {place.rating}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => handleSaveFromSearch(place)}
                  className="shrink-0 px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                >
                  Save
                </button>
              </div>
            ))}
            <button
              onClick={() => setSearchResults([])}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors w-full text-center py-1"
            >
              Clear results
            </button>
          </div>
        )}
      </div>

      {/* Add manual form */}
      {showAddForm && (
        <div className="bg-white border border-indigo-200 rounded-2xl p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Add Activity</h3>
            <button onClick={() => setShowAddForm(false)}>
              <X className="w-4 h-4 text-gray-400" />
            </button>
          </div>
          <div className="space-y-3">
            <input
              type="text"
              placeholder="Activity name *"
              value={addForm.name}
              onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                placeholder="Address"
                value={addForm.address}
                onChange={(e) => setAddForm((f) => ({ ...f, address: e.target.value }))}
                className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <input
                type="text"
                placeholder="Category (museum, beach, etc.)"
                value={addForm.category}
                onChange={(e) => setAddForm((f) => ({ ...f, category: e.target.value }))}
                className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Duration (min)</label>
                <input
                  type="number"
                  value={addForm.durationMins}
                  onChange={(e) => setAddForm((f) => ({ ...f, durationMins: parseInt(e.target.value) || 60 }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Cost/adult ($)</label>
                <input
                  type="number"
                  value={addForm.costPerAdult}
                  onChange={(e) => setAddForm((f) => ({ ...f, costPerAdult: parseFloat(e.target.value) || 0 }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Priority</label>
                <select
                  value={addForm.priority}
                  onChange={(e) => setAddForm((f) => ({ ...f, priority: e.target.value as typeof addForm.priority }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                >
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p} value={p}>{priorityLabel(p)}</option>
                  ))}
                </select>
              </div>
            </div>
            <input
              type="url"
              placeholder="Booking link (optional)"
              value={addForm.bookingLink}
              onChange={(e) => setAddForm((f) => ({ ...f, bookingLink: e.target.value }))}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <textarea
              placeholder="Notes..."
              value={addForm.notes}
              onChange={(e) => setAddForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={addForm.reservationNeeded}
                onChange={(e) => setAddForm((f) => ({ ...f, reservationNeeded: e.target.checked }))}
                className="rounded"
              />
              Reservation required
            </label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={addForm.isFixed}
                  onChange={(e) => setAddForm((f) => ({ ...f, isFixed: e.target.checked, fixedDateTime: e.target.checked ? f.fixedDateTime : "" }))}
                  className="rounded"
                />
                <Lock className="w-3.5 h-3.5 text-gray-400" />
                Date is locked (tickets purchased in advance)
              </label>
              {addForm.isFixed && (
                <div className="flex items-center gap-2 ml-6">
                  <CalendarDays className="w-4 h-4 text-gray-400" />
                  <input
                    type="datetime-local"
                    value={addForm.fixedDateTime}
                    onChange={(e) => setAddForm((f) => ({ ...f, fixedDateTime: e.target.value }))}
                    className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              )}
            </div>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setShowAddForm(false)}
                className="flex-1 py-2.5 border border-gray-200 text-gray-700 text-sm rounded-xl hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddManual}
                className="flex-1 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition-colors"
              >
                Add activity
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex gap-1">
          {["ALL", ...PRIORITY_OPTIONS].map((p) => (
            <button
              key={p}
              onClick={() => setFilterPriority(p)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-lg transition-colors",
                filterPriority === p
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              )}
            >
              {p === "ALL" ? "All" : priorityLabel(p)}
            </button>
          ))}
        </div>
        <div className="h-4 w-px bg-gray-200" />
        <div className="flex gap-1">
          {["ALL", "WISHLIST", "SCHEDULED", "DONE"].map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-lg transition-colors",
                filterStatus === s
                  ? "bg-gray-900 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              )}
            >
              {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Activity list */}
      {filtered.length === 0 && (
        <div className="text-center py-16">
          <Star className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">No activities yet</p>
          <p className="text-gray-400 text-xs mt-1">Search for places or add one manually</p>
        </div>
      )}

      <div className="space-y-3">
        {filtered.map((activity) => (
          <div
            key={activity.id}
            className="bg-white border border-gray-100 rounded-2xl p-4 hover:border-gray-200 transition-colors group"
          >
            <div className="flex items-start gap-3">
              {activity.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={activity.imageUrl}
                  alt=""
                  className="w-16 h-16 rounded-xl object-cover shrink-0"
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-gray-900 text-sm">{activity.name}</h3>
                      <span
                        className={cn(
                          "px-2 py-0.5 text-[11px] font-medium rounded-full",
                          priorityColor(activity.priority)
                        )}
                      >
                        {priorityLabel(activity.priority)}
                      </span>
                      {activity.status === "SCHEDULED" && (
                        <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-green-50 text-green-700">
                          Scheduled
                        </span>
                      )}
                      {activity.isFixed && (
                        <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-indigo-50 text-indigo-700 flex items-center gap-0.5">
                          <Lock className="w-2.5 h-2.5" />
                          Locked
                        </span>
                      )}
                      {activity.reservationNeeded && (
                        <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-amber-50 text-amber-700">
                          Reservation needed
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
                      {activity.address && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {activity.address}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {activity.durationMins} min
                      </span>
                      {activity.costPerAdult > 0 && (
                        <span className="flex items-center gap-1">
                          <DollarSign className="w-3 h-3" />
                          {formatCurrency(activity.costPerAdult)}/adult
                        </span>
                      )}
                      {activity.rating && (
                        <span className="flex items-center gap-1 text-yellow-600">
                          <Star className="w-3 h-3 fill-current" />
                          {activity.rating}
                        </span>
                      )}
                      {activity.isFixed && activity.fixedDateTime && (
                        <span className="flex items-center gap-1 text-indigo-600">
                          <CalendarDays className="w-3 h-3" />
                          {new Date(activity.fixedDateTime).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>
                      )}
                    </div>
                    {activity.notes && (
                      <p className="text-xs text-gray-400 mt-1">{activity.notes}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {activity.bookingLink && (
                      <a
                        href={activity.bookingLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 text-gray-400 hover:text-indigo-600 transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                    <button
                      onClick={() => handleDelete(activity.id)}
                      className="p-1.5 text-gray-400 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Priority selector + lock toggle */}
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <span className="text-[11px] text-gray-400">Priority:</span>
                  <div className="flex gap-1">
                    {PRIORITY_OPTIONS.map((p) => (
                      <button
                        key={p}
                        onClick={() => handlePriorityChange(activity.id, p)}
                        className={cn(
                          "px-2 py-0.5 text-[10px] font-medium rounded-md transition-colors",
                          activity.priority === p
                            ? priorityColor(p)
                            : "text-gray-400 hover:text-gray-600"
                        )}
                      >
                        {priorityLabel(p)}
                      </button>
                    ))}
                  </div>
                  <div className="h-3 w-px bg-gray-200" />
                  <button
                    onClick={() => handleToggleFixed(activity.id, activity.isFixed)}
                    className={cn(
                      "flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-md transition-colors",
                      activity.isFixed
                        ? "bg-indigo-50 text-indigo-700"
                        : "text-gray-400 hover:text-gray-600"
                    )}
                  >
                    <Lock className="w-2.5 h-2.5" />
                    {activity.isFixed ? "Locked" : "Lock date"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
