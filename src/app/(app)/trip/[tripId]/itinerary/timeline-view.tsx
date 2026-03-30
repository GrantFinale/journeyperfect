"use client"

import { useState, useRef, useCallback, useMemo, useEffect } from "react"
import { cn } from "@/lib/utils"
import { formatTime } from "@/lib/utils"
import type { GroupedDay } from "@/lib/itinerary-utils"
import { calculateTravel } from "./travel-connector"
import { useDroppable, useDraggable } from "@dnd-kit/core"
import type { WishlistActivity } from "./wishlist-panel"
import type { DayForecast } from "@/lib/weather"
import { CalendarDays, ArrowRight, X, MapPin, Plus, ChevronLeft, ChevronRight, Copy, Check, ExternalLink, Ticket, Pencil, Trash2, Loader2, Clock } from "lucide-react"
import { createReservation, updateReservation, deleteReservation } from "@/lib/actions/reservations"
import type { ReservationInput } from "@/lib/actions/reservations"

type Reservation = {
  id: string
  confirmationNumber: string | null
  provider: string | null
  bookingUrl: string | null
  partySize: number | null
  specialRequests: string | null
  price: number | null
  currency: string
  status: string
  notes: string | null
}

type ItineraryItem = {
  id: string
  date: Date
  startTime: string | null
  endTime: string | null
  type: string
  title: string
  notes: string | null
  durationMins: number
  travelTimeToNextMins: number
  costEstimate: number
  position: number
  activityId?: string | null
  flight?: {
    airline: string | null
    flightNumber: string | null
    departureAirport: string | null
    arrivalAirport: string | null
  } | null
  activity?: {
    lat: number | null
    lng: number | null
    address: string | null
    name: string
    imageUrl?: string | null
    indoorOutdoor?: string | null
  } | null
  hotel?: {
    lat: number | null
    lng: number | null
    address: string | null
    name: string
  } | null
  reservation?: Reservation | null
}

const HOUR_START = 7
const HOUR_END = 23
const TOTAL_HOURS = HOUR_END - HOUR_START
const HOUR_HEIGHT_DESKTOP = 56
const HOUR_HEIGHT_MOBILE = 64
const MIN_DURATION_MINS = 15
const SNAP_MINS = 15

function useResponsiveMode() {
  const [mode, setMode] = useState<"mobile" | "tablet" | "desktop">("desktop")
  useEffect(() => {
    const check = () => {
      const w = window.innerWidth
      if (w < 768) setMode("mobile")
      else if (w < 1024) setMode("tablet")
      else setMode("desktop")
    }
    check()
    window.addEventListener("resize", check)
    return () => window.removeEventListener("resize", check)
  }, [])
  return mode
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number)
  return h * 60 + (m || 0)
}

function minutesToTime(mins: number): string {
  const clamped = Math.max(HOUR_START * 60, Math.min(HOUR_END * 60, mins))
  const h = Math.floor(clamped / 60)
  const m = clamped % 60
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`
}

function snapToGrid(mins: number): number {
  return Math.round(mins / SNAP_MINS) * SNAP_MINS
}

function typeColor(type: string) {
  switch (type) {
    case "FLIGHT":
      return "bg-blue-100 border-blue-300 text-blue-800"
    case "HOTEL_CHECK_IN":
    case "HOTEL_CHECK_OUT":
      return "bg-sky-100 border-sky-300 text-sky-800"
    case "ACTIVITY":
      return "bg-indigo-100 border-indigo-300 text-indigo-800"
    case "MEAL":
      return "bg-amber-100 border-amber-300 text-amber-800"
    case "TRANSIT":
      return "bg-gray-100 border-gray-300 text-gray-700"
    case "BUFFER":
      return "bg-yellow-100 border-yellow-300 text-yellow-800"
    default:
      return "bg-gray-100 border-gray-300 text-gray-700"
  }
}

function typeIcon(type: string): string {
  switch (type) {
    case "FLIGHT": return "\u2708\uFE0F"
    case "HOTEL_CHECK_IN":
    case "HOTEL_CHECK_OUT": return "\uD83C\uDFE8"
    case "MEAL": return "\uD83C\uDF7D\uFE0F"
    case "TRANSIT": return "\uD83D\uDE8C"
    default: return ""
  }
}

function formatDuration(mins: number) {
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

// ─── Visual Duration for Flights ─────────────────────────────────────────
function getVisualDuration(item: ItineraryItem): number {
  if (item.type === "FLIGHT" && item.startTime && item.endTime) {
    const startMins = timeToMinutes(item.startTime)
    const endMins = timeToMinutes(item.endTime)
    return endMins > startMins ? endMins - startMins : item.durationMins
  }
  return item.durationMins
}

// ─── Overlap Detection (Google Calendar algorithm) ────────────────────────

type OverlapLayout = {
  item: ItineraryItem
  column: number
  totalColumns: number
}

function computeOverlapLayout(items: ItineraryItem[], previewDurations?: Map<string, number>, previewStartTimes?: Map<string, number>): OverlapLayout[] {
  const timed = items
    .filter((item) => item.startTime)
    .sort((a, b) => {
      const aStart = previewStartTimes?.get(a.id) ?? timeToMinutes(a.startTime!)
      const bStart = previewStartTimes?.get(b.id) ?? timeToMinutes(b.startTime!)
      return aStart - bStart
    })

  if (timed.length === 0) return []

  const result: OverlapLayout[] = []
  const itemColumns = new Map<string, number>()

  let groupStart = 0
  while (groupStart < timed.length) {
    const group: ItineraryItem[] = [timed[groupStart]]
    let maxEnd = getItemEnd(timed[groupStart], previewDurations, previewStartTimes)
    let groupEnd = groupStart + 1

    while (groupEnd < timed.length) {
      const itemStart = previewStartTimes?.get(timed[groupEnd].id) ?? timeToMinutes(timed[groupEnd].startTime!)
      if (itemStart < maxEnd) {
        group.push(timed[groupEnd])
        maxEnd = Math.max(maxEnd, getItemEnd(timed[groupEnd], previewDurations, previewStartTimes))
        groupEnd++
      } else {
        break
      }
    }

    const columns: { end: number }[] = []
    for (const item of group) {
      const start = previewStartTimes?.get(item.id) ?? timeToMinutes(item.startTime!)
      let col = -1
      for (let c = 0; c < columns.length; c++) {
        if (columns[c].end <= start) {
          col = c
          break
        }
      }
      if (col === -1) {
        col = columns.length
        columns.push({ end: getItemEnd(item, previewDurations, previewStartTimes) })
      } else {
        columns[col].end = getItemEnd(item, previewDurations, previewStartTimes)
      }
      itemColumns.set(item.id, col)
    }

    const totalCols = columns.length
    for (const item of group) {
      result.push({
        item,
        column: itemColumns.get(item.id)!,
        totalColumns: totalCols,
      })
    }

    groupStart = groupEnd
  }

  return result
}

function getItemEnd(item: ItineraryItem, previewDurations?: Map<string, number>, previewStartTimes?: Map<string, number>): number {
  const duration = previewDurations?.get(item.id) ?? getVisualDuration(item)
  const startMins = previewStartTimes?.get(item.id) ?? timeToMinutes(item.startTime!)
  return startMins + duration
}

// ─── Droppable Hour Slot ─────────────────────────────────────────────────

function DroppableHourSlot({
  dayStr,
  hour,
  hourHeight,
}: {
  dayStr: string
  hour: number
  hourHeight: number
}) {
  const timeStr = `${hour.toString().padStart(2, "0")}:00`
  const { isOver, setNodeRef } = useDroppable({
    id: `timeline-day-${dayStr}-${timeStr}`,
    data: { type: "timeline-slot", dayStr, time: timeStr },
  })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "absolute left-0 right-0 transition-colors",
        isOver && "bg-indigo-50/60"
      )}
      style={{ top: (hour - HOUR_START) * hourHeight, height: hourHeight }}
    />
  )
}

// ─── Move to Day Modal ──────────────────────────────────────────────────

function MoveToDayMenu({
  item,
  days,
  currentDayStr,
  onMove,
  onMoveToWishlist,
  onClose,
  position,
}: {
  item: ItineraryItem
  days: { dateStr: string; label: string; dayIdx: number }[]
  currentDayStr: string
  onMove: (itemId: string, newDayStr: string, newStartTime: string) => void
  onMoveToWishlist?: (itemId: string) => void
  onClose: () => void
  position: { x: number; y: number }
}) {
  const otherDays = days.filter((d) => d.dateStr !== currentDayStr)
  const canUnschedule = item.type === "ACTIVITY" || item.type === "MEAL" || item.type === "BUFFER"

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 bg-white border border-gray-200 rounded-xl shadow-xl py-1 min-w-[180px] max-h-[300px] overflow-y-auto"
        style={{
          left: Math.min(position.x, window.innerWidth - 200),
          top: Math.min(position.y, window.innerHeight - 200),
        }}
      >
        {canUnschedule && onMoveToWishlist && (
          <>
            <button
              onClick={() => {
                onMoveToWishlist(item.id)
                onClose()
              }}
              className="w-full text-left px-3 py-2 text-sm text-orange-600 hover:bg-orange-50 transition-colors flex items-center gap-2"
            >
              <X className="w-3.5 h-3.5" />
              <span>Remove from plan</span>
            </button>
            <div className="border-b border-gray-100" />
          </>
        )}

        <div className="px-3 py-2 border-b border-gray-100">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Move to day
          </p>
        </div>
        {otherDays.length === 0 ? (
          <div className="px-3 py-2 text-xs text-gray-400">No other days</div>
        ) : (
          otherDays.map((d) => (
            <button
              key={d.dateStr}
              onClick={() => {
                onMove(item.id, d.dateStr, item.startTime || "09:00")
                onClose()
              }}
              className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors flex items-center gap-2"
            >
              <CalendarDays className="w-3.5 h-3.5 text-gray-400" />
              <span>Day {d.dayIdx + 1}</span>
              <span className="text-xs text-gray-400 ml-auto">{d.label}</span>
            </button>
          ))
        )}
      </div>
    </>
  )
}

// ─── Add Event Popover ───────────────────────────────────────────────────

function AddEventPopover({
  dayStr,
  startTime,
  position,
  wishlistItems,
  onAddFromWishlist,
  onAddCustom,
  onOpenCustomModal,
  onClose,
}: {
  dayStr: string
  startTime: string
  position: { x: number; y: number }
  wishlistItems: WishlistActivity[]
  onAddFromWishlist?: (activityId: string, dayStr: string, startTime: string) => void
  onAddCustom?: (dayStr: string, startTime: string, title: string, durationMins: number) => void
  onOpenCustomModal?: (dayStr: string, startTime: string) => void
  onClose: () => void
}) {
  const [mode, setMode] = useState<"menu" | "wishlist" | "custom">("menu")
  const [title, setTitle] = useState("")
  const [duration, setDuration] = useState(60)

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 bg-white border border-gray-200 rounded-xl shadow-xl py-2 min-w-[220px] max-w-[280px]"
        style={{
          left: Math.min(position.x, window.innerWidth - 300),
          top: Math.min(position.y, window.innerHeight - 250),
        }}
      >
        <div className="px-3 pb-2 border-b border-gray-100">
          <p className="text-xs font-semibold text-gray-500">Add at {formatTime(startTime)}</p>
        </div>

        {mode === "menu" && (
          <div className="py-1">
            {wishlistItems.length > 0 && onAddFromWishlist && (
              <button
                onClick={() => setMode("wishlist")}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors flex items-center gap-2"
              >
                <Plus className="w-3.5 h-3.5 text-indigo-500" />
                <span>From wishlist</span>
                <span className="text-[10px] text-gray-400 ml-auto">({wishlistItems.length})</span>
              </button>
            )}
            {onAddCustom && (
              <button
                onClick={() => setMode("custom")}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2"
              >
                <Plus className="w-3.5 h-3.5 text-gray-500" />
                <span>Quick custom event</span>
              </button>
            )}
            {onOpenCustomModal && (
              <button
                onClick={() => {
                  onOpenCustomModal(dayStr, startTime)
                  onClose()
                }}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2"
              >
                <MapPin className="w-3.5 h-3.5 text-gray-500" />
                <span>Full custom event</span>
                <span className="text-[10px] text-gray-400 ml-auto">place, notes...</span>
              </button>
            )}
          </div>
        )}

        {mode === "wishlist" && (
          <div className="py-1 max-h-[200px] overflow-y-auto">
            <button
              onClick={() => setMode("menu")}
              className="w-full text-left px-3 py-1.5 text-[10px] text-gray-400 hover:text-gray-600 uppercase tracking-wide"
            >
              &larr; Back
            </button>
            {wishlistItems.map((a) => (
              <button
                key={a.id}
                onClick={() => {
                  onAddFromWishlist?.(a.id, dayStr, startTime)
                  onClose()
                }}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors flex items-center gap-2"
              >
                <span className="flex-1 truncate">{a.name}</span>
                <span className="text-[10px] text-gray-400 shrink-0">{formatDuration(a.durationMins)}</span>
              </button>
            ))}
          </div>
        )}

        {mode === "custom" && (
          <div className="p-3 space-y-2">
            <button
              onClick={() => setMode("menu")}
              className="text-[10px] text-gray-400 hover:text-gray-600 uppercase tracking-wide"
            >
              &larr; Back
            </button>
            <input
              type="text"
              placeholder="Event title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              autoFocus
            />
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">Duration:</label>
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white"
              >
                <option value={30}>30m</option>
                <option value={60}>1h</option>
                <option value={90}>1h 30m</option>
                <option value={120}>2h</option>
                <option value={180}>3h</option>
              </select>
            </div>
            <button
              onClick={() => {
                if (title.trim()) {
                  onAddCustom?.(dayStr, startTime, title, duration)
                  onClose()
                }
              }}
              disabled={!title.trim()}
              className="w-full py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors"
            >
              Add
            </button>
            {onOpenCustomModal && (
              <button
                onClick={() => {
                  onOpenCustomModal(dayStr, startTime)
                  onClose()
                }}
                className="w-full py-1 text-[11px] text-gray-400 hover:text-indigo-600 transition-colors"
              >
                More options (address, place search, notes...)
              </button>
            )}
          </div>
        )}
      </div>
    </>
  )
}

// ─── Reservation Status Badge ─────────────────────────────────────────────

function ReservationStatusBadge({ status }: { status: string }) {
  const config: Record<string, { dot: string; text: string; bg: string }> = {
    CONFIRMED: { dot: "bg-green-500", text: "text-green-700", bg: "bg-green-50" },
    PENDING: { dot: "bg-yellow-500", text: "text-yellow-700", bg: "bg-yellow-50" },
    CANCELLED: { dot: "bg-red-500", text: "text-red-700", bg: "bg-red-50" },
    WAITLISTED: { dot: "bg-purple-500", text: "text-purple-700", bg: "bg-purple-50" },
  }
  const c = config[status] || config.CONFIRMED
  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full", c.bg, c.text)}>
      <span className={cn("w-1.5 h-1.5 rounded-full", c.dot)} />
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  )
}

// ─── Reservation Detail Panel ─────────────────────────────────────────────

function ReservationDetailPanel({
  reservation,
  tripId,
  onUpdate,
  onDelete,
}: {
  reservation: Reservation
  tripId: string
  onUpdate: (updated: Reservation) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    if (reservation.confirmationNumber) {
      await navigator.clipboard.writeText(reservation.confirmationNumber)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteReservation(tripId, reservation.id)
      onDelete()
    } catch {
      setDeleting(false)
    }
  }

  if (editing) {
    return (
      <ReservationForm
        tripId={tripId}
        reservation={reservation}
        onSaved={(r) => {
          onUpdate(r)
          setEditing(false)
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  return (
    <div className="space-y-2">
      {/* Confirmation number */}
      {reservation.confirmationNumber && (
        <div>
          <p className="text-[9px] text-gray-400 uppercase tracking-wide font-medium">Confirmation</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-sm font-bold text-gray-900 font-mono tracking-wide">
              {reservation.confirmationNumber}
            </span>
            <button
              onClick={handleCopy}
              className="p-0.5 rounded hover:bg-gray-100 transition-colors"
              title="Copy confirmation number"
            >
              {copied ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3 text-gray-400" />}
            </button>
          </div>
        </div>
      )}

      {/* Provider */}
      {reservation.provider && (
        <div>
          <p className="text-[9px] text-gray-400 uppercase tracking-wide font-medium">Provider</p>
          <p className="text-xs text-gray-700">{reservation.provider}</p>
        </div>
      )}

      {/* Party size */}
      {reservation.partySize && (
        <div>
          <p className="text-[9px] text-gray-400 uppercase tracking-wide font-medium">Party Size</p>
          <p className="text-xs text-gray-700">{reservation.partySize} {reservation.partySize === 1 ? "guest" : "guests"}</p>
        </div>
      )}

      {/* Price */}
      {reservation.price != null && (
        <div>
          <p className="text-[9px] text-gray-400 uppercase tracking-wide font-medium">Price</p>
          <p className="text-xs text-gray-700">
            {new Intl.NumberFormat("en-US", { style: "currency", currency: reservation.currency || "USD" }).format(reservation.price)}
          </p>
        </div>
      )}

      {/* Special requests */}
      {reservation.specialRequests && (
        <div>
          <p className="text-[9px] text-gray-400 uppercase tracking-wide font-medium">Special Requests</p>
          <p className="text-xs text-gray-600">{reservation.specialRequests}</p>
        </div>
      )}

      {/* Notes */}
      {reservation.notes && (
        <div>
          <p className="text-[9px] text-gray-400 uppercase tracking-wide font-medium">Notes</p>
          <p className="text-xs text-gray-600">{reservation.notes}</p>
        </div>
      )}

      {/* Booking link */}
      {reservation.bookingUrl && (
        <a
          href={reservation.bookingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[10px] text-indigo-600 hover:text-indigo-800 font-medium"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <ExternalLink className="w-3 h-3" />
          View booking
        </a>
      )}

      {/* Status */}
      <div className="flex items-center gap-2 pt-1">
        <ReservationStatusBadge status={reservation.status} />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 border-t border-gray-100">
        <button
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1 text-[10px] text-gray-500 hover:text-indigo-600 font-medium py-1"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Pencil className="w-3 h-3" />
          Edit
        </button>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="inline-flex items-center gap-1 text-[10px] text-gray-500 hover:text-red-600 font-medium py-1"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
          Delete
        </button>
      </div>
    </div>
  )
}

// ─── Reservation Form (Add/Edit) ───────────────────────────────────────────

function ReservationForm({
  tripId,
  itineraryItemId,
  reservation,
  onSaved,
  onCancel,
}: {
  tripId: string
  itineraryItemId?: string
  reservation?: Reservation
  onSaved: (r: Reservation) => void
  onCancel: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [confirmationNumber, setConfirmationNumber] = useState(reservation?.confirmationNumber || "")
  const [provider, setProvider] = useState(reservation?.provider || "")
  const [partySize, setPartySize] = useState(reservation?.partySize?.toString() || "")
  const [specialRequests, setSpecialRequests] = useState(reservation?.specialRequests || "")
  const [price, setPrice] = useState(reservation?.price?.toString() || "")
  const [bookingUrl, setBookingUrl] = useState(reservation?.bookingUrl || "")
  const [status, setStatus] = useState(reservation?.status || "CONFIRMED")
  const [notes, setNotes] = useState(reservation?.notes || "")

  async function handleSave() {
    setSaving(true)
    try {
      const data: ReservationInput = {
        confirmationNumber: confirmationNumber || undefined,
        provider: provider || undefined,
        bookingUrl: bookingUrl || undefined,
        partySize: partySize ? parseInt(partySize) : undefined,
        specialRequests: specialRequests || undefined,
        price: price ? parseFloat(price) : undefined,
        currency: "USD",
        status: status as ReservationInput["status"],
        notes: notes || undefined,
      }

      let result
      if (reservation) {
        result = await updateReservation(tripId, reservation.id, data)
      } else if (itineraryItemId) {
        result = await createReservation(tripId, itineraryItemId, data)
      } else {
        return
      }
      onSaved(result as unknown as Reservation)
    } catch {
      // error handling
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <input
        type="text"
        placeholder="Confirmation number"
        value={confirmationNumber}
        onChange={(e) => setConfirmationNumber(e.target.value)}
        className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
        autoFocus
      />
      <input
        type="text"
        placeholder="Provider (e.g. OpenTable, Viator)"
        value={provider}
        onChange={(e) => setProvider(e.target.value)}
        className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      <div className="flex gap-2">
        <input
          type="number"
          placeholder="Party size"
          value={partySize}
          onChange={(e) => setPartySize(e.target.value)}
          className="w-1/2 px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <input
          type="number"
          step="0.01"
          placeholder="Price"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="w-1/2 px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>
      <input
        type="text"
        placeholder="Booking URL"
        value={bookingUrl}
        onChange={(e) => setBookingUrl(e.target.value)}
        className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      <textarea
        placeholder="Special requests (dietary needs, accessibility, etc.)"
        value={specialRequests}
        onChange={(e) => setSpecialRequests(e.target.value)}
        rows={2}
        className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
      />
      <textarea
        placeholder="Notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
      />
      <select
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        <option value="CONFIRMED">Confirmed</option>
        <option value="PENDING">Pending</option>
        <option value="WAITLISTED">Waitlisted</option>
        <option value="CANCELLED">Cancelled</option>
      </select>
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 py-1.5 bg-indigo-600 text-white text-xs rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors flex items-center justify-center gap-1"
        >
          {saving && <Loader2 className="w-3 h-3 animate-spin" />}
          {reservation ? "Update" : "Save"}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Read-Only Event Detail Panel (replaces reservation form on timeline tap) ─

function EventDetailPanel({
  item,
  tripId,
  onClose,
}: {
  item: ItineraryItem
  tripId: string
  onClose: () => void
}) {
  const startMins = item.startTime ? timeToMinutes(item.startTime) : null
  const endMins = startMins != null ? startMins + getVisualDuration(item) : null
  const endTimeStr = endMins != null ? minutesToTime(endMins) : null
  const address = item.activity?.address || item.hotel?.address
  const reservation = item.reservation

  return (
    <div
      className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 mt-1 z-40 relative"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-900 truncate flex-1">{item.title}</p>
        <button
          onClick={onClose}
          className="p-0.5 rounded hover:bg-gray-100 transition-colors shrink-0 ml-2"
        >
          <X className="w-3 h-3 text-gray-400" />
        </button>
      </div>

      <div className="space-y-1.5">
        {/* Time & duration */}
        {item.startTime && (
          <div className="flex items-center gap-1 text-xs text-gray-600">
            <Clock className="w-3 h-3 text-gray-400 shrink-0" />
            <span>{formatTime(item.startTime)}{endTimeStr ? ` - ${formatTime(endTimeStr)}` : ""}</span>
            <span className="text-gray-400">&middot;</span>
            <span>{formatDuration(getVisualDuration(item))}</span>
          </div>
        )}

        {/* Location */}
        {address && (
          <div className="flex items-center gap-1 text-xs text-gray-600">
            <MapPin className="w-3 h-3 text-gray-400 shrink-0" />
            <span className="truncate">{address}</span>
          </div>
        )}

        {/* Reservation info (read-only) */}
        {reservation && (
          <div className="mt-2 pt-2 border-t border-gray-100 space-y-1.5">
            <div className="flex items-center gap-1">
              <Ticket className="w-3 h-3 text-indigo-500 shrink-0" />
              <span className="text-[10px] font-semibold text-gray-700 uppercase tracking-wide">Reservation</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <ReservationStatusBadge status={reservation.status} />
              {reservation.confirmationNumber && (
                <span className="text-[10px] font-mono text-gray-700 bg-gray-50 px-1.5 py-0.5 rounded">
                  #{reservation.confirmationNumber}
                </span>
              )}
            </div>
            {reservation.provider && (
              <p className="text-[10px] text-gray-500">via {reservation.provider}</p>
            )}
            {reservation.partySize && (
              <p className="text-[10px] text-gray-500">Party of {reservation.partySize}</p>
            )}
            {reservation.price != null && (
              <p className="text-[10px] text-gray-500">
                {new Intl.NumberFormat("en-US", { style: "currency", currency: reservation.currency || "USD" }).format(reservation.price)}
              </p>
            )}
            {reservation.specialRequests && (
              <p className="text-[10px] text-gray-500 italic">{reservation.specialRequests}</p>
            )}
            {reservation.bookingUrl && (
              <a
                href={reservation.bookingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[10px] text-indigo-600 hover:text-indigo-800 font-medium"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <ExternalLink className="w-3 h-3" />
                View booking
              </a>
            )}
          </div>
        )}

        {/* View in overview link */}
        <div className="pt-1.5 mt-1.5 border-t border-gray-100">
          <a
            href={`/trip/${tripId}`}
            className="text-[10px] text-indigo-600 hover:text-indigo-800 font-medium"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            View in overview
          </a>
        </div>
      </div>
    </div>
  )
}

// ─── Timeline Item (Enhanced) ────────────────────────────────────────────

function TimelineItem({
  item,
  column,
  totalColumns,
  hourHeight,
  dayStr,
  tripId,
  onResize,
  onDragMove,
  onContextMenu,
  onMoveToWishlist,
  onPreviewChange,
}: {
  item: ItineraryItem
  column: number
  totalColumns: number
  hourHeight: number
  dayStr: string
  tripId: string
  onResize: (itemId: string, newDurationMins: number) => void
  onDragMove: (itemId: string, newStartTime: string, newDurationMins: number) => void
  onContextMenu: (e: React.MouseEvent, item: ItineraryItem) => void
  onMoveToWishlist?: (itemId: string) => void
  onPreviewChange?: (itemId: string, previewDuration: number | null) => void
}) {
  const [resizing, setResizing] = useState(false)
  const [previewDuration, setPreviewDuration] = useState<number | null>(null)
  const [expanded, setExpanded] = useState(false)
  const resizeRef = useRef<{ startY: number; startDuration: number } | null>(null)
  const lastDragEndRef = useRef(0)

  const isFixed = item.type === "FLIGHT" || item.type === "HOTEL_CHECK_IN" || item.type === "HOTEL_CHECK_OUT"
  const hasReservation = !!item.reservation

  // @dnd-kit draggable for cross-day drag
  const { attributes, listeners, setNodeRef: setDragRef, isDragging: isDndDragging } = useDraggable({
    id: `timeline-item-${item.id}`,
    data: { type: "itinerary-item", itemId: item.id },
    disabled: isFixed,
  })

  if (!item.startTime) return null
  const startMins = timeToMinutes(item.startTime)
  const offsetMins = startMins - HOUR_START * 60
  if (offsetMins < 0) return null

  const currentDuration = previewDuration ?? getVisualDuration(item)
  const top = (offsetMins / 60) * hourHeight
  const height = Math.max((currentDuration / 60) * hourHeight, 20)

  const widthPercent = 100 / totalColumns
  const leftPercent = column * widthPercent
  const gap = totalColumns > 1 ? 2 : 0
  const leftPx = gap / 2
  const rightPx = gap / 2

  // Card size tiers
  const isLarge = height > 60
  const isMedium = height > 40 && height <= 60

  // Compute end time for display
  const endMins = startMins + currentDuration
  const endTimeStr = minutesToTime(endMins)

  // Resize handlers — stopPropagation prevents interfering with card-level DnD listeners
  function handleResizePointerDown(e: React.PointerEvent) {
    if (isFixed) return
    e.stopPropagation()
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    setResizing(true)
    resizeRef.current = { startY: e.clientY, startDuration: item.durationMins }
  }

  function handleResizePointerMove(e: React.PointerEvent) {
    if (!resizing || !resizeRef.current) return
    e.stopPropagation()
    e.preventDefault()
    const deltaY = e.clientY - resizeRef.current.startY
    const deltaMins = (deltaY / hourHeight) * 60
    const newDuration = snapToGrid(Math.max(MIN_DURATION_MINS, resizeRef.current.startDuration + deltaMins))
    setPreviewDuration(newDuration)
    onPreviewChange?.(item.id, newDuration)
  }

  function handleResizePointerUp(e: React.PointerEvent) {
    if (!resizing) return
    e.stopPropagation()
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    setResizing(false)
    if (previewDuration != null && previewDuration !== item.durationMins) {
      onResize(item.id, previewDuration)
    }
    setPreviewDuration(null)
    onPreviewChange?.(item.id, null)
    resizeRef.current = null
  }

  function handleContextMenuEvent(e: React.MouseEvent) {
    e.preventDefault()
    onContextMenu(e, item)
  }

  const showDurationLabel = resizing && previewDuration != null
  const originalDuration = item.durationMins

  // --- Render card content based on type and size ---
  function renderCardContent() {
    // FLIGHT items
    if (item.type === "FLIGHT") {
      const f = item.flight
      return (
        <div className="flex flex-col h-full overflow-hidden">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs shrink-0">{"\u2708\uFE0F"}</span>
            <p className="text-[11px] font-semibold truncate leading-tight">
              {f?.departureAirport && f?.arrivalAirport
                ? `${f.departureAirport} \u2192 ${f.arrivalAirport}`
                : item.title}
            </p>
          </div>
          {isLarge && f && (
            <>
              {(f.airline || f.flightNumber) && (
                <p className="text-[9px] opacity-70 mt-0.5 truncate">
                  {[f.airline, f.flightNumber].filter(Boolean).join(" ")}
                </p>
              )}
              <p className="text-[9px] opacity-70 mt-0.5">
                {formatTime(minutesToTime(startMins))} - {formatTime(endTimeStr)} {"\u00B7"} {formatDuration(currentDuration)}
              </p>
              <div className="flex items-center gap-2 mt-1">
                {f.departureAirport && (
                  <a
                    href={`https://www.google.com/maps/search/${f.departureAirport}+airport`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[8px] text-blue-600 hover:text-blue-800 underline flex items-center gap-0.5"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <MapPin className="w-2 h-2" />{f.departureAirport}
                  </a>
                )}
                {f.arrivalAirport && (
                  <a
                    href={`https://www.google.com/maps/search/${f.arrivalAirport}+airport`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[8px] text-blue-600 hover:text-blue-800 underline flex items-center gap-0.5"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <MapPin className="w-2 h-2" />{f.arrivalAirport}
                  </a>
                )}
              </div>
            </>
          )}
          {isMedium && (
            <p className="text-[9px] opacity-70 mt-0.5">
              {formatTime(minutesToTime(startMins))} - {formatTime(endTimeStr)}
            </p>
          )}
        </div>
      )
    }

    // HOTEL items — strip leading 🏨 from title since we render it separately
    if (item.type === "HOTEL_CHECK_IN" || item.type === "HOTEL_CHECK_OUT") {
      const hotelTitle = item.title.replace(/^\uD83C\uDFE8\s*/, "")
      return (
        <div className="flex flex-col h-full overflow-hidden">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs shrink-0">{"\uD83C\uDFE8"}</span>
            <p className="text-[11px] font-semibold truncate leading-tight">{hotelTitle}</p>
          </div>
          {isLarge && (
            <>
              <p className="text-[9px] opacity-70 mt-0.5">
                {item.type === "HOTEL_CHECK_IN" ? "Check-in" : "Check-out"} {"\u00B7"} {formatTime(minutesToTime(startMins))}
              </p>
              {item.hotel?.name && (
                <p className="text-[9px] opacity-60 truncate mt-0.5">{item.hotel.name}</p>
              )}
            </>
          )}
          {isMedium && (
            <p className="text-[9px] opacity-70 mt-0.5">
              {formatTime(minutesToTime(startMins))} {"\u00B7"} {formatDuration(currentDuration)}
            </p>
          )}
        </div>
      )
    }

    // LARGE card (> 60px, ~1hr+): full details
    if (isLarge) {
      const imgUrl = item.activity?.imageUrl
      const address = item.activity?.address || item.hotel?.address
      const io = item.activity?.indoorOutdoor
      return (
        <div className="flex gap-2 h-full overflow-hidden">
          {totalColumns === 1 && imgUrl && (
            <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 mt-0.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imgUrl} alt="" className="w-full h-full object-cover" />
            </div>
          )}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex items-start justify-between gap-1">
              <p className="text-[11px] font-semibold truncate leading-tight flex-1">
                {typeIcon(item.type) ? `${typeIcon(item.type)} ` : ""}{item.title}
              </p>
              {hasReservation && item.reservation?.confirmationNumber && (
                <span className="shrink-0 inline-flex items-center gap-0.5 text-[8px] font-medium bg-indigo-100 text-indigo-700 px-1 py-0.5 rounded">
                  {"\uD83C\uDFAB"} {item.reservation.confirmationNumber}
                </span>
              )}
              {hasReservation && !item.reservation?.confirmationNumber && (
                <span className="shrink-0 text-[8px]">{"\uD83C\uDFAB"}</span>
              )}
            </div>
            <p className="text-[9px] opacity-70 mt-0.5">
              {formatTime(minutesToTime(startMins))} - {formatTime(endTimeStr)} {"\u00B7"} {formatDuration(currentDuration)}
            </p>
            {address && (
              <p className="text-[8px] opacity-50 truncate mt-0.5 flex items-center gap-0.5">
                <MapPin className="w-2 h-2 shrink-0" />{address}
              </p>
            )}
            {hasReservation && item.reservation?.status && item.reservation.status !== "CONFIRMED" && (
              <ReservationStatusBadge status={item.reservation.status} />
            )}
            {io && io !== "BOTH" && (
              <span className={cn(
                "inline-flex items-center gap-0.5 text-[8px] font-medium px-1 py-0.5 rounded-full mt-0.5 w-fit",
                io === "INDOOR" ? "bg-blue-50/80 text-blue-600" : "bg-green-50/80 text-green-600"
              )}>
                {io === "INDOOR" ? "\uD83C\uDFE0" : "\uD83C\uDF33"} {io === "INDOOR" ? "Indoor" : "Outdoor"}
              </span>
            )}
          </div>
        </div>
      )
    }

    // MEDIUM card (40-60px): title + time on one line, duration badge
    if (isMedium) {
      return (
        <div className="flex flex-col h-full overflow-hidden">
          <p className="text-[10px] font-semibold truncate leading-tight">
            {typeIcon(item.type) ? `${typeIcon(item.type)} ` : ""}{item.title}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[9px] opacity-70">
              {formatTime(minutesToTime(startMins))} - {formatTime(endTimeStr)}
            </span>
            <span className="text-[8px] bg-black/5 rounded px-1 py-0.5 font-medium">
              {formatDuration(currentDuration)}
            </span>
          </div>
        </div>
      )
    }

    // SMALL card (< 40px): just title
    return (
      <p className="text-[10px] font-medium truncate leading-tight pr-4">
        {typeIcon(item.type) ? `${typeIcon(item.type)} ` : ""}{item.title}
      </p>
    )
  }

  // Issue 5: Past events greyed out
  const isPast = (() => {
    const now = new Date()
    const today = now.toISOString().split("T")[0]
    if (dayStr < today) return true
    if (dayStr === today && item.endTime) {
      const endMinsVal = timeToMinutes(item.endTime)
      const nowMins = now.getHours() * 60 + now.getMinutes()
      return endMinsVal < nowMins
    }
    return false
  })()

  function handleCardClick(e: React.MouseEvent) {
    // Don't expand if we're dragging, resizing, or clicking a link/button
    if (resizing || isDndDragging) return
    // Skip if a drag just ended (within last 200ms) to prevent accidental tap after drag
    if (Date.now() - lastDragEndRef.current < 200) return
    const target = e.target as HTMLElement
    if (target.closest("a") || target.closest("button")) return
    setExpanded(!expanded)
  }

  // Track when DnD drag ends to prevent click-after-drag
  useEffect(() => {
    if (!isDndDragging) {
      lastDragEndRef.current = Date.now()
    }
  }, [isDndDragging])

  return (
    <>
      <div
        ref={setDragRef}
        className={cn(
          "absolute rounded-lg border overflow-hidden select-none transition-shadow group/timeline-item",
          typeColor(item.type),
          !isFixed && "cursor-grab active:cursor-grabbing",
          resizing && "z-20 shadow-lg ring-2 ring-indigo-400/50",
          isDndDragging && "opacity-50 z-30",
          isPast && "opacity-40 grayscale",
          expanded && "z-20 ring-2 ring-indigo-400/40"
        )}
        style={{
          top,
          height: Math.min(height, (TOTAL_HOURS * hourHeight) - top),
          left: `calc(${leftPercent}% + ${leftPx + 4}px)`,
          width: `calc(${widthPercent}% - ${leftPx + rightPx + 8}px)`,
          touchAction: isDndDragging || resizing ? "none" : "auto",
          WebkitTouchCallout: "none",
        }}
        title={`${item.title} (${formatTime(item.startTime!)}${item.endTime ? ` - ${formatTime(item.endTime)}` : ""}, ${formatDuration(currentDuration)})`}
        onContextMenu={(e) => {
          e.preventDefault()
          if (!isFixed) onContextMenu(e, item)
        }}
        onClick={handleCardClick}
        {...(!isFixed ? { ...attributes, ...listeners } : {})}
      >
        <div className="px-2 py-1 h-full">
          {renderCardContent()}
        </div>

        {/* Unschedule button: visible on tap (expanded) or hover on desktop */}
        {(expanded || isDndDragging) && !isFixed && onMoveToWishlist && (
          <button
            className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-white/90 hover:bg-red-100 text-gray-400 hover:text-red-600 opacity-0 group-hover/timeline-item:opacity-100 transition-all flex items-center justify-center z-10 shadow-sm"
            style={{ opacity: expanded ? 1 : undefined }}
            title="Remove from plan"
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              onMoveToWishlist(item.id)
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <X className="w-3 h-3" />
          </button>
        )}

        {/* Duration change indicator */}
        {showDurationLabel && (
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap z-30 shadow-md">
            {formatDuration(originalDuration)} &rarr; {formatDuration(previewDuration)}
          </div>
        )}

        {/* Resize handle at bottom edge */}
        {!isFixed && (
          <div
            className="absolute bottom-0 left-0 right-0 h-2 cursor-row-resize group/resize flex items-center justify-center"
            onPointerDown={handleResizePointerDown}
            onPointerMove={handleResizePointerMove}
            onPointerUp={handleResizePointerUp}
          >
            <div className="w-8 h-1 rounded-full bg-current opacity-30 group-hover/resize:opacity-60 transition-opacity" />
          </div>
        )}
      </div>

      {/* Read-only event detail panel below the card */}
      {expanded && (
        <div
          className="absolute z-30"
          style={{
            top: top + Math.min(height, (TOTAL_HOURS * hourHeight) - top) + 2,
            left: `calc(${leftPercent}% + ${leftPx + 4}px)`,
            width: `calc(${widthPercent}% - ${leftPx + rightPx + 8}px)`,
            minWidth: 220,
          }}
        >
          <EventDetailPanel
            item={item}
            tripId={tripId}
            onClose={() => setExpanded(false)}
          />
        </div>
      )}
    </>
  )
}

// ─── Current Time Indicator ─────────────────────────────────────────────

function CurrentTimeIndicator({ hourHeight, dayStr }: { hourHeight: number; dayStr: string }) {
  const now = new Date()
  const today = now.toISOString().split("T")[0]
  if (dayStr !== today) return null
  const mins = now.getHours() * 60 + now.getMinutes()
  if (mins < HOUR_START * 60 || mins > HOUR_END * 60) return null
  const top = ((mins - HOUR_START * 60) / 60) * hourHeight

  return (
    <div className="absolute left-0 right-0 z-30 pointer-events-none" style={{ top }}>
      <div className="flex items-center">
        <div className="w-2.5 h-2.5 rounded-full bg-red-500 -ml-1 shadow-sm" />
        <div className="flex-1 h-0.5 bg-red-500/80" />
      </div>
    </div>
  )
}

// ─── Wishlist Drop Preview ──────────────────────────────────────────────

function WishlistDropPreview({
  isOver,
}: {
  dayStr: string
  isOver: boolean
}) {
  if (!isOver) return null

  return (
    <div className="absolute inset-0 z-10 pointer-events-none">
      <div className="absolute inset-0 bg-indigo-50/40 border-2 border-dashed border-indigo-300 rounded-lg flex items-center justify-center">
        <div className="bg-white/90 px-3 py-1.5 rounded-lg shadow-sm border border-indigo-200">
          <p className="text-xs font-medium text-indigo-600 flex items-center gap-1.5">
            <ArrowRight className="w-3.5 h-3.5" />
            Drop to add to this day
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── Timeline Day ───────────────────────────────────────────────────────

function TimelineDay({
  tripId,
  day,
  dayIdx,
  hourHeight,
  onResize,
  onDragMove,
  onContextMenu,
  onMoveToWishlist,
  hotel,
  wishlistItems,
  onAddFromWishlist,
  onAddCustom,
  onOpenCustomModal,
  isMobileFullWidth,
}: {
  tripId: string
  day: GroupedDay<ItineraryItem>
  dayIdx: number
  hourHeight: number
  onResize: (itemId: string, newDurationMins: number) => void
  onDragMove: (itemId: string, newStartTime: string, newDurationMins: number) => void
  onContextMenu: (e: React.MouseEvent, item: ItineraryItem) => void
  onMoveToWishlist?: (itemId: string) => void
  hotel?: HotelInfo | null
  wishlistItems?: WishlistActivity[]
  onAddFromWishlist?: (activityId: string, dayStr: string, startTime: string) => void
  onAddCustom?: (dayStr: string, startTime: string, title: string, durationMins: number) => void
  onOpenCustomModal?: (dayStr: string, startTime: string) => void
  isMobileFullWidth?: boolean
}) {
  const dayDate = new Date(day.date)
  const dayLabel = dayDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })

  const [previewDurations, setPreviewDurations] = useState<Map<string, number>>(new Map())
  const [addPopover, setAddPopover] = useState<{ startTime: string; position: { x: number; y: number } } | null>(null)

  const handlePreviewChange = useCallback((itemId: string, previewDuration: number | null) => {
    setPreviewDurations(prev => {
      const next = new Map(prev)
      if (previewDuration == null) next.delete(itemId)
      else next.set(itemId, previewDuration)
      return next
    })
  }, [])

  const layoutItems = useMemo(
    () => computeOverlapLayout(
      day.items,
      previewDurations.size > 0 ? previewDurations : undefined,
      undefined
    ),
    [day.items, previewDurations]
  )

  const hourSlots = useMemo(
    () => Array.from({ length: TOTAL_HOURS }, (_, i) => HOUR_START + i),
    []
  )

  const { isOver: isDayOver, setNodeRef: setDayDropRef } = useDroppable({
    id: `day-${day.dateStr}`,
    data: { type: "timeline-day", dayStr: day.dateStr },
  })

  // Click on empty space to add event
  function handleTimelineClick(e: React.MouseEvent<HTMLDivElement>) {
    // Only handle clicks on the timeline background, not on items
    if ((e.target as HTMLElement).closest(".group\\/timeline-item")) return
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    const mins = Math.round(((y / hourHeight) * 60 + HOUR_START * 60) / SNAP_MINS) * SNAP_MINS
    const timeStr = minutesToTime(mins)
    setAddPopover({
      startTime: timeStr,
      position: { x: e.clientX, y: e.clientY },
    })
  }

  return (
    <div className={cn("flex-1", isMobileFullWidth ? "w-full" : "min-w-[200px] max-w-[320px]")} ref={setDayDropRef}>
      {/* Day header */}
      <div className="sticky top-0 bg-white z-10 border-b border-gray-200 px-2 py-2 text-center">
        <p className="text-xs font-semibold text-gray-900">Day {dayIdx + 1}</p>
        <p className="text-[10px] text-gray-500">{dayLabel}</p>
      </div>

      {/* Timeline grid */}
      <div
        className="relative cursor-crosshair"
        style={{ height: TOTAL_HOURS * hourHeight }}
        onClick={handleTimelineClick}
      >
        {/* Hour lines */}
        {Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => (
          <div
            key={i}
            className="absolute left-0 right-0 border-t border-gray-100"
            style={{ top: i * hourHeight }}
          />
        ))}

        {/* Droppable hour slots for wishlist drops */}
        {hourSlots.map((hour) => (
          <DroppableHourSlot
            key={hour}
            dayStr={day.dateStr}
            hour={hour}
            hourHeight={hourHeight}
          />
        ))}

        {/* Wishlist drop preview overlay */}
        <WishlistDropPreview dayStr={day.dateStr} isOver={isDayOver} />

        {/* Current time indicator - only on today's column */}
        <CurrentTimeIndicator hourHeight={hourHeight} dayStr={day.dateStr} />

        {/* Items with overlap layout */}
        {layoutItems.map((layout) => {
          const { item, column, totalColumns } = layout

          return (
            <TimelineItem
              key={item.id}
              item={item}
              column={column}
              totalColumns={totalColumns}
              hourHeight={hourHeight}
              dayStr={day.dateStr}
              tripId={tripId}
              onResize={onResize}
              onDragMove={onDragMove}
              onContextMenu={onContextMenu}
              onMoveToWishlist={onMoveToWishlist}
              onPreviewChange={handlePreviewChange}
            />
          )
        })}

        {/* Travel connectors between non-overlapping sequential items */}
        {(() => {
          const layoutMap = new Map<string, OverlapLayout>()
          for (const l of layoutItems) layoutMap.set(l.item.id, l)

          const sorted = day.items
            .filter((item) => item.startTime)
            .sort((a, b) => timeToMinutes(a.startTime!) - timeToMinutes(b.startTime!))

          return sorted.map((item, i) => {
            if (i >= sorted.length - 1) return null
            const nextItem = sorted[i + 1]
            if (!nextItem.startTime) return null

            const hotelTypes = ["HOTEL_CHECK_IN", "HOTEL_CHECK_OUT"]
            if (hotel && (hotelTypes.includes(item.type) || hotelTypes.includes(nextItem.type))) return null
            if (item.type === "FLIGHT") return null

            const activePreviews = previewDurations.size > 0 ? previewDurations : undefined
            const itemEnd = getItemEnd(item, activePreviews, undefined)
            const nextStart = timeToMinutes(nextItem.startTime!)

            if (nextStart < itemEnd) return null

            const itemLayout = layoutMap.get(item.id)
            const nextLayout = layoutMap.get(nextItem.id)
            if (itemLayout && nextLayout && itemLayout.totalColumns > 1 && nextLayout.totalColumns > 1) {
              if (nextStart < itemEnd) return null
            }

            const fromLat = item.activity?.lat || item.hotel?.lat
            const fromLng = item.activity?.lng || item.hotel?.lng
            const toLat = nextItem.activity?.lat || nextItem.hotel?.lat
            const toLng = nextItem.activity?.lng || nextItem.hotel?.lng
            const travel = calculateTravel(fromLat, fromLng, toLat, toLng)

            if (!travel) return null

            const travelTop = ((itemEnd - HOUR_START * 60) / 60) * hourHeight
            const gapHeight = ((nextStart - itemEnd) / 60) * hourHeight
            const travelHeight = Math.min((travel.travelMins / 60) * hourHeight, gapHeight, 40)
            const modeIcon = travel.mode === "walk" ? "\uD83D\uDEB6" : "\uD83D\uDE97"

            const mapsUrl = fromLat && fromLng && toLat && toLng
              ? `https://www.google.com/maps/dir/?api=1&origin=${fromLat},${fromLng}&destination=${toLat},${toLng}&travelmode=${travel.mode === "walk" ? "walking" : "driving"}`
              : null

            if (travelHeight <= 2) return null

            const connectorContent = (
              <>
                <div className="w-px flex-1 border-l border-dashed border-gray-300 group-hover/travel:border-indigo-400 transition-colors mx-auto" />
                <div className="text-[8px] text-gray-400 group-hover/travel:text-indigo-600 whitespace-nowrap flex items-center gap-0.5 bg-white px-1.5 py-0.5 rounded-full shadow-sm border border-gray-100 group-hover/travel:border-indigo-200">
                  <span>{modeIcon}</span>
                  <span>{travel.travelMins}m</span>
                </div>
                <div className="w-px flex-1 border-l border-dashed border-gray-300 group-hover/travel:border-indigo-400 transition-colors mx-auto" />
              </>
            )

            return mapsUrl ? (
              <a
                key={`travel-${item.id}`}
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="absolute left-0 right-0 flex flex-col items-center group/travel cursor-pointer z-10"
                style={{ top: travelTop, height: Math.max(travelHeight, 16) }}
                title={`${travel.travelMins} min ${travel.mode === "walk" ? "walk" : "drive"} - Click for directions`}
                onClick={(e) => e.stopPropagation()}
              >
                {connectorContent}
              </a>
            ) : (
              <div
                key={`travel-${item.id}`}
                className="absolute left-0 right-0 flex flex-col items-center z-10"
                style={{ top: travelTop, height: Math.max(travelHeight, 16) }}
                title={`${travel.travelMins} min ${travel.mode === "walk" ? "walk" : "drive"}`}
              >
                {connectorContent}
              </div>
            )
          })
        })()}

        {/* Hotel-to-first-event and last-event-to-hotel travel connectors */}
        {hotel && (() => {
          const sorted = day.items
            .filter((item) => item.startTime && item.type !== "FLIGHT" && item.type !== "HOTEL_CHECK_IN" && item.type !== "HOTEL_CHECK_OUT")
            .sort((a, b) => timeToMinutes(a.startTime!) - timeToMinutes(b.startTime!))
          if (sorted.length === 0) return null

          const firstItem = sorted[0]
          const lastItem = sorted[sorted.length - 1]
          const elements: React.ReactNode[] = []

          // Travel from hotel to first event
          if (firstItem.startTime) {
            const firstStart = timeToMinutes(firstItem.startTime!)
            const toLat = firstItem.activity?.lat || firstItem.hotel?.lat
            const toLng = firstItem.activity?.lng || firstItem.hotel?.lng
            const travel = calculateTravel(hotel.lat, hotel.lng, toLat, toLng)
            if (travel) {
              const travelEndTop = ((firstStart - HOUR_START * 60) / 60) * hourHeight
              const travelHeight = Math.min((travel.travelMins / 60) * hourHeight, 40)
              const travelTop = Math.max(0, travelEndTop - travelHeight)
              const modeIcon = travel.mode === "walk" ? "\uD83D\uDEB6" : "\uD83D\uDE97"
              const mapsUrl = hotel.lat && hotel.lng && toLat && toLng
                ? `https://www.google.com/maps/dir/?api=1&origin=${hotel.lat},${hotel.lng}&destination=${toLat},${toLng}&travelmode=${travel.mode === "walk" ? "walking" : "driving"}`
                : null

              if (travelHeight > 2) {
                const connectorContent = (
                  <>
                    <div className="w-px flex-1 border-l border-dashed border-green-300 group-hover/travel:border-green-500 transition-colors mx-auto" />
                    <div className="text-[8px] text-green-600 group-hover/travel:text-green-700 whitespace-nowrap flex items-center gap-0.5 bg-white px-1.5 py-0.5 rounded-full shadow-sm border border-green-100">
                      <span>{modeIcon}</span>
                      <span>{travel.travelMins}m</span>
                    </div>
                    <div className="w-px flex-1 border-l border-dashed border-green-300 group-hover/travel:border-green-500 transition-colors mx-auto" />
                  </>
                )
                elements.push(
                  mapsUrl ? (
                    <a
                      key="travel-hotel-to-first"
                      href={mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="absolute left-0 right-0 flex flex-col items-center group/travel cursor-pointer z-10"
                      style={{ top: travelTop, height: Math.max(travelHeight, 16) }}
                      title={`${travel.travelMins} min ${travel.mode === "walk" ? "walk" : "drive"} from hotel`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {connectorContent}
                    </a>
                  ) : (
                    <div
                      key="travel-hotel-to-first"
                      className="absolute left-0 right-0 flex flex-col items-center z-10"
                      style={{ top: travelTop, height: Math.max(travelHeight, 16) }}
                    >
                      {connectorContent}
                    </div>
                  )
                )
              }
            }
          }

          // Travel from last event back to hotel
          if (lastItem.startTime) {
            const lastEnd = lastItem.endTime
              ? timeToMinutes(lastItem.endTime)
              : timeToMinutes(lastItem.startTime!) + lastItem.durationMins
            const fromLat = lastItem.activity?.lat || lastItem.hotel?.lat
            const fromLng = lastItem.activity?.lng || lastItem.hotel?.lng
            const travel = calculateTravel(fromLat, fromLng, hotel.lat, hotel.lng)
            if (travel) {
              const travelTop = ((lastEnd - HOUR_START * 60) / 60) * hourHeight
              const travelHeight = Math.min((travel.travelMins / 60) * hourHeight, 40)
              const modeIcon = travel.mode === "walk" ? "\uD83D\uDEB6" : "\uD83D\uDE97"
              const mapsUrl = fromLat && fromLng && hotel.lat && hotel.lng
                ? `https://www.google.com/maps/dir/?api=1&origin=${fromLat},${fromLng}&destination=${hotel.lat},${hotel.lng}&travelmode=${travel.mode === "walk" ? "walking" : "driving"}`
                : null

              if (travelHeight > 2) {
                const connectorContent = (
                  <>
                    <div className="w-px flex-1 border-l border-dashed border-green-300 group-hover/travel:border-green-500 transition-colors mx-auto" />
                    <div className="text-[8px] text-green-600 group-hover/travel:text-green-700 whitespace-nowrap flex items-center gap-0.5 bg-white px-1.5 py-0.5 rounded-full shadow-sm border border-green-100">
                      <span>{modeIcon}</span>
                      <span>{travel.travelMins}m</span>
                    </div>
                    <div className="w-px flex-1 border-l border-dashed border-green-300 group-hover/travel:border-green-500 transition-colors mx-auto" />
                  </>
                )
                elements.push(
                  mapsUrl ? (
                    <a
                      key="travel-last-to-hotel"
                      href={mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="absolute left-0 right-0 flex flex-col items-center group/travel cursor-pointer z-10"
                      style={{ top: travelTop, height: Math.max(travelHeight, 16) }}
                      title={`${travel.travelMins} min ${travel.mode === "walk" ? "walk" : "drive"} to hotel`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {connectorContent}
                    </a>
                  ) : (
                    <div
                      key="travel-last-to-hotel"
                      className="absolute left-0 right-0 flex flex-col items-center z-10"
                      style={{ top: travelTop, height: Math.max(travelHeight, 16) }}
                    >
                      {connectorContent}
                    </div>
                  )
                )
              }
            }
          }

          return elements
        })()}
      </div>

      {/* Add event popover */}
      {addPopover && (
        <AddEventPopover
          dayStr={day.dateStr}
          startTime={addPopover.startTime}
          position={addPopover.position}
          wishlistItems={wishlistItems || []}
          onAddFromWishlist={onAddFromWishlist}
          onAddCustom={onAddCustom}
          onOpenCustomModal={onOpenCustomModal}
          onClose={() => setAddPopover(null)}
        />
      )}
    </div>
  )
}

// ─── Mobile Day Selector ─────────────────────────────────────────────────

function MobileDaySelector({
  days,
  selectedIdx,
  onSelect,
  forecasts,
}: {
  days: GroupedDay<ItineraryItem>[]
  selectedIdx: number
  onSelect: (idx: number) => void
  forecasts?: DayForecast[]
}) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Build a lookup from date string to forecast
  const forecastMap = useMemo(() => {
    const map = new Map<string, DayForecast>()
    if (forecasts) {
      for (const f of forecasts) map.set(f.date, f)
    }
    return map
  }, [forecasts])

  useEffect(() => {
    if (scrollRef.current) {
      const btn = scrollRef.current.children[selectedIdx] as HTMLElement
      if (btn) {
        btn.scrollIntoView({ inline: "center", behavior: "smooth", block: "nearest" })
      }
    }
  }, [selectedIdx])

  return (
    <div
      ref={scrollRef}
      className="flex gap-2 overflow-x-auto pb-2 px-1 scrollbar-none -mx-1"
      style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
    >
      {days.map((day, i) => {
        const dayDate = new Date(day.date)
        const weekday = dayDate.toLocaleDateString("en-US", { weekday: "short" })
        const monthDay = dayDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })
        const forecast = forecastMap.get(day.dateStr)
        return (
          <button
            key={day.dateStr}
            onClick={() => onSelect(i)}
            className={cn(
              "flex flex-col items-center px-3 py-2 rounded-xl text-xs font-medium transition-all shrink-0 min-w-[64px]",
              i === selectedIdx
                ? "bg-indigo-600 text-white shadow-md"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            )}
          >
            <span className="text-[10px] font-semibold">Day {i + 1}</span>
            <span className="text-[9px] opacity-80">{weekday}, {monthDay}</span>
            {forecast && (
              <span className="text-[10px] mt-0.5">
                {forecast.emoji} {forecast.highTemp}&deg;
              </span>
            )}
            <span className={cn(
              "text-[9px] mt-0.5",
              i === selectedIdx ? "opacity-80" : "opacity-50"
            )}>
              {day.items.length} item{day.items.length !== 1 ? "s" : ""}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ─── Main TimelineView ──────────────────────────────────────────────────

type HotelInfo = {
  id: string
  name: string
  lat: number | null
  lng: number | null
  checkIn: Date
  checkOut: Date
}

interface TimelineViewProps {
  tripId: string
  days: GroupedDay<ItineraryItem>[]
  onResizeItem?: (itemId: string, newDurationMins: number) => void
  onMoveItem?: (itemId: string, newStartTime: string, newDurationMins: number) => void
  onDropFromWishlist?: (dayStr: string, startTime: string, activityId: string) => void
  onMoveToWishlist?: (itemId: string) => void
  onMoveToDay?: (itemId: string, newDayStr: string, newStartTime: string) => void
  onAddFromWishlist?: (activityId: string, dayStr: string, startTime: string) => void
  onAddCustom?: (dayStr: string, startTime: string, title: string, durationMins: number) => void
  onOpenCustomModal?: (dayStr: string, startTime: string) => void
  wishlistItems?: WishlistActivity[]
  hotels?: HotelInfo[]
  forecasts?: DayForecast[]
}

export function TimelineView({
  tripId,
  days,
  onResizeItem,
  onMoveItem,
  onMoveToWishlist,
  onMoveToDay,
  onAddFromWishlist,
  onAddCustom,
  onOpenCustomModal,
  wishlistItems,
  hotels,
  forecasts,
}: TimelineViewProps) {
  const [contextMenu, setContextMenu] = useState<{
    item: ItineraryItem
    position: { x: number; y: number }
    dayStr: string
  } | null>(null)
  const [mobileSelectedDay, setMobileSelectedDay] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const mode = useResponsiveMode()

  // Track scroll state for arrow buttons
  const updateScrollState = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 0)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    updateScrollState()
    el.addEventListener("scroll", updateScrollState)
    const observer = new ResizeObserver(updateScrollState)
    observer.observe(el)
    return () => {
      el.removeEventListener("scroll", updateScrollState)
      observer.disconnect()
    }
  }, [updateScrollState, days])
  const hourHeight = mode === "mobile" ? HOUR_HEIGHT_MOBILE : HOUR_HEIGHT_DESKTOP

  const handleResize = useCallback((itemId: string, newDurationMins: number) => {
    onResizeItem?.(itemId, newDurationMins)
  }, [onResizeItem])

  const handleDragMove = useCallback((itemId: string, newStartTime: string, newDurationMins: number) => {
    onMoveItem?.(itemId, newStartTime, newDurationMins)
  }, [onMoveItem])

  const handleContextMenu = useCallback((e: React.MouseEvent, item: ItineraryItem, dayStr: string) => {
    setContextMenu({
      item,
      position: { x: e.clientX, y: e.clientY },
      dayStr,
    })
  }, [])

  const handleMoveToDay = useCallback((itemId: string, newDayStr: string, newStartTime: string) => {
    onMoveToDay?.(itemId, newDayStr, newStartTime)
  }, [onMoveToDay])

  const getHotelForDate = useCallback((dateStr: string): HotelInfo | null => {
    if (!hotels) return null
    for (const h of hotels) {
      const checkIn = new Date(h.checkIn).toISOString().split("T")[0]
      const checkOut = new Date(h.checkOut).toISOString().split("T")[0]
      if (dateStr >= checkIn && dateStr <= checkOut) return h
    }
    return null
  }, [hotels])

  const dayInfos = useMemo(
    () =>
      days.map((d, i) => {
        const dayDate = new Date(d.date)
        return {
          dateStr: d.dateStr,
          label: dayDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
          dayIdx: i,
        }
      }),
    [days]
  )

  // Determine which days to show based on responsive mode
  const visibleDays = useMemo(() => {
    if (mode === "mobile") {
      return days.length > 0 ? [days[mobileSelectedDay]] : []
    }
    if (mode === "tablet") {
      // Show 2-3 days centered around mobile selected day
      const start = Math.max(0, Math.min(mobileSelectedDay, days.length - 3))
      return days.slice(start, start + 3)
    }
    // Desktop: show all days (or up to 5 with scroll)
    return days
  }, [mode, days, mobileSelectedDay])

  // Swipe support for mobile
  const touchRef = useRef<{ startX: number; startY: number } | null>(null)

  function handleTouchStart(e: React.TouchEvent) {
    if (mode !== "mobile") return
    touchRef.current = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
    }
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (mode !== "mobile" || !touchRef.current) return
    const deltaX = e.changedTouches[0].clientX - touchRef.current.startX
    const deltaY = e.changedTouches[0].clientY - touchRef.current.startY
    touchRef.current = null
    // Only trigger swipe if horizontal movement is dominant
    if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
      if (deltaX < 0 && mobileSelectedDay < days.length - 1) {
        setMobileSelectedDay(mobileSelectedDay + 1)
      } else if (deltaX > 0 && mobileSelectedDay > 0) {
        setMobileSelectedDay(mobileSelectedDay - 1)
      }
    }
  }

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Mobile day selector (includes weather when available) */}
      {mode === "mobile" && (
        <div className="mb-3">
          <MobileDaySelector
            days={days}
            selectedIdx={mobileSelectedDay}
            onSelect={setMobileSelectedDay}
            forecasts={forecasts}
          />
        </div>
      )}

      {/* Scroll arrows for horizontal navigation (desktop/tablet only) */}
      {mode !== "mobile" && (canScrollLeft || canScrollRight) && (
        <div className="flex items-center justify-end gap-1.5 mb-2">
          <button
            disabled={!canScrollLeft}
            onClick={() => scrollRef.current?.scrollBy({ left: -240, behavior: "smooth" })}
            className="w-7 h-7 rounded-full border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors shadow-sm"
            aria-label="Scroll left"
          >
            <ChevronLeft className="w-4 h-4 text-gray-600" />
          </button>
          <button
            disabled={!canScrollRight}
            onClick={() => scrollRef.current?.scrollBy({ left: 240, behavior: "smooth" })}
            className="w-7 h-7 rounded-full border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors shadow-sm"
            aria-label="Scroll right"
          >
            <ChevronRight className="w-4 h-4 text-gray-600" />
          </button>
        </div>
      )}

      <div className="overflow-x-auto" ref={scrollRef}>
        <div className="flex gap-0">
          {/* Hour labels — sticky on left when scrolling horizontally */}
          <div className={cn("shrink-0 sticky left-0 z-10 bg-white", mode === "mobile" ? "w-10" : "w-12")}>
            <div className="h-[42px] border-b border-gray-200" />
            <div className="relative" style={{ height: TOTAL_HOURS * hourHeight }}>
              {Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => {
                const hour = HOUR_START + i
                return (
                  <div
                    key={i}
                    className={cn(
                      "absolute left-0 right-0 text-gray-400 text-right pr-2 -translate-y-1/2",
                      mode === "mobile" ? "text-[9px]" : "text-[10px]"
                    )}
                    style={{ top: i * hourHeight }}
                  >
                    {hour <= 23
                      ? `${hour > 12 ? hour - 12 : hour}${hour >= 12 ? "pm" : "am"}`
                      : ""}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Day columns */}
          {visibleDays.map((day) => {
            const dayIdx = days.findIndex(d => d.dateStr === day.dateStr)
            return (
              <div key={day.dateStr} className={cn("border-l border-gray-200", mode === "mobile" && "flex-1")}>
                <TimelineDay
                  tripId={tripId}
                  day={day}
                  dayIdx={dayIdx}
                  hourHeight={hourHeight}
                  onResize={handleResize}
                  onDragMove={handleDragMove}
                  onContextMenu={(e, item) => handleContextMenu(e, item, day.dateStr)}
                  onMoveToWishlist={onMoveToWishlist}

                  hotel={getHotelForDate(day.dateStr)}
                  wishlistItems={wishlistItems}
                  onAddFromWishlist={onAddFromWishlist}
                  onAddCustom={onAddCustom}
                  onOpenCustomModal={onOpenCustomModal}
                  isMobileFullWidth={mode === "mobile"}
                />
              </div>
            )
          })}
        </div>
      </div>

      {/* Context menu for moving items between days */}
      {contextMenu && onMoveToDay && (
        <MoveToDayMenu
          item={contextMenu.item}
          days={dayInfos}
          currentDayStr={contextMenu.dayStr}
          onMove={handleMoveToDay}
          onMoveToWishlist={onMoveToWishlist}
          onClose={() => setContextMenu(null)}
          position={contextMenu.position}
        />
      )}
    </div>
  )
}
