"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { toast } from "sonner"
import { cn, formatDate, formatTime } from "@/lib/utils"
import {
  X,
  MapPin,
  Phone,
  Globe,
  Clock,
  Ticket,
  Copy,
  Check,
  ExternalLink,
  Pencil,
  Trash2,
  Loader2,
  Upload,
  Paperclip,
  Receipt,
  FileText,
  BadgeCheck,
  Plus,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  CalendarClock,
  Wallet,
  ClipboardCheck,
} from "lucide-react"
import {
  createReservation,
  updateReservation,
  deleteReservation,
  setCheckInCompleted,
  type ReservationInput,
} from "@/lib/actions/reservations"
import { setNeedsReservation } from "@/lib/actions/itinerary"
import {
  hasBookingProof,
  isAwaitingReservation,
  type TaskSubject,
} from "@/lib/trip-tasks"
import {
  listAttachments,
  uploadAttachment,
  deleteAttachment,
  formatBytes,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_ITEM,
  ALLOWED_ATTACHMENT_TYPES,
  type AttachmentMeta,
  type AttachmentKindValue,
} from "@/lib/actions/attachments"
import { getPlaceDetails } from "@/lib/actions/places-detail"

/* ─── Types ───────────────────────────────────────────────────────────────── */

export type EventReservation = {
  id: string
  confirmationNumber: string | null
  /** Who it was booked through — OpenTable, Viator, the hotel direct. */
  provider: string | null
  /** The name the booking is held under, which is often someone else. */
  reservationName: string | null
  bookingUrl: string | null
  partySize: number | null
  specialRequests: string | null
  price: number | null
  currency: string
  status: string
  notes: string | null
  /** Still owed, distinct from `price` (what the booking costs). */
  balanceDue?: number | null
  balanceDueDate?: Date | string | null
  /** Explicit check-in window; travel legs otherwise derive it from departure. */
  checkInOpensAt?: Date | string | null
  /** Stamped once the traveller has checked in, which clears the To Do row. */
  checkInCompletedAt?: Date | string | null
}

/**
 * Structural shape the modal needs. Deliberately looser than the timeline's
 * own `ItineraryItem` so the two files stay decoupled — anything with these
 * fields is assignable.
 */
export type EventDetailsItem = {
  id: string
  title: string
  type: string
  date: Date | string
  startTime: string | null
  endTime: string | null
  durationMins: number
  notes: string | null
  /** The traveller flagged this as still needing to be booked. */
  needsReservation?: boolean | null
  /** From `getItinerary`'s `_count` — a voucher on file counts as booking proof. */
  _count?: { attachments: number } | null
  transportSegment?: { departureTime?: Date | string | null } | null
  activity?: {
    name: string
    address: string | null
    lat: number | null
    lng: number | null
    imageUrl?: string | null
    googlePlaceId?: string | null
    websiteUrl?: string | null
  } | null
  hotel?: {
    name: string
    address: string | null
    lat: number | null
    lng: number | null
  } | null
  reservation?: EventReservation | null
}

/* ─── Google Maps deep link ───────────────────────────────────────────────── */

/**
 * Builds a Google Maps "search" deep link for a place, mirroring the approach
 * in `discover/browse-card.tsx`: prefer exact coordinates plus the place id
 * (which pins the actual business rather than a nearby point), and fall back to
 * a plain text query built from the name and address.
 *
 * Exported so the inline timeline panel can link addresses the same way.
 */
export function buildMapsUrl(place: {
  name?: string | null
  address?: string | null
  lat?: number | null
  lng?: number | null
  googlePlaceId?: string | null
}): string | null {
  const { name, address, lat, lng, googlePlaceId } = place
  if (lat != null && lng != null) {
    const base = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
    return googlePlaceId
      ? `${base}&query_place_id=${encodeURIComponent(googlePlaceId)}`
      : base
  }
  const query = [name, address].filter(Boolean).join(" ").trim()
  if (!query) return null
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

/* ─── Outstanding-arrangement subject ─────────────────────────────────────── */

/**
 * Anything the modal or the timeline can hand to `buildTaskSubject`. Kept
 * structural so the timeline's own `ItineraryItem` satisfies it without either
 * file importing the other's types.
 */
export type TaskSubjectSource = {
  id: string
  title: string
  type: string
  date: Date | string
  startTime?: string | null
  needsReservation?: boolean | null
  reservation?: EventReservation | null
  _count?: { attachments: number } | null
  // Both carry a departure, and either can drive a derived check-in window.
  // Flights especially: airline check-in is the canonical case, so omitting it
  // here would let the To Do screen list "Check in" for a flight while this
  // modal showed no check-in affordance at all.
  flight?: { departureTime?: Date | string | null } | null
  transportSegment?: { departureTime?: Date | string | null } | null
}

function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * Itinerary dates are midnight-UTC standing in for a local date (see
 * `groupByDay`), so read the UTC parts rather than letting the local timezone
 * shift the day.
 */
function toDateKey(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ""
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  const day = String(d.getUTCDate()).padStart(2, "0")
  return `${d.getUTCFullYear()}-${m}-${day}`
}

/**
 * Flattens an itinerary item into the shape `lib/trip-tasks` reasons over, so
 * the modal, the plan, the To Do screen and the nav badge can never disagree
 * about whether something still needs doing.
 *
 * `overrides` lets the open modal answer from live local state (the freshly
 * saved reservation, the file the user just uploaded) instead of the props it
 * mounted with.
 */
export function buildTaskSubject(
  item: TaskSubjectSource,
  overrides?: {
    needsReservation?: boolean
    hasAttachments?: boolean
    reservation?: EventReservation | null
  }
): TaskSubject {
  const reservation =
    overrides?.reservation !== undefined ? overrides.reservation : item.reservation ?? null

  return {
    itineraryItemId: item.id,
    title: item.title,
    type: item.type,
    date: toDateKey(item.date),
    startTime: item.startTime ?? null,
    needsReservation: overrides?.needsReservation ?? !!item.needsReservation,
    hasAttachments: overrides?.hasAttachments ?? (item._count?.attachments ?? 0) > 0,
    reservation: reservation
      ? {
          confirmationNumber: reservation.confirmationNumber,
          reservationName: reservation.reservationName,
          bookingUrl: reservation.bookingUrl,
          status: reservation.status,
          price: reservation.price,
          balanceDue: reservation.balanceDue ?? null,
          balanceDueDate: toIsoOrNull(reservation.balanceDueDate),
          checkInOpensAt: toIsoOrNull(reservation.checkInOpensAt),
          checkInCompletedAt: toIsoOrNull(reservation.checkInCompletedAt),
        }
      : null,
    departureTime: toIsoOrNull(item.flight?.departureTime ?? item.transportSegment?.departureTime),
  }
}

/* ─── Small helpers ───────────────────────────────────────────────────────── */

function typeEmoji(type: string): string {
  switch (type) {
    case "FLIGHT":
      return "✈️"
    case "HOTEL_CHECK_IN":
    case "HOTEL_CHECK_OUT":
      return "🏨"
    case "MEAL":
      return "🍽️"
    case "TRANSIT":
      return "🚌"
    case "TRANSPORT":
      return "⛴️"
    case "ACTIVITY":
      return "📍"
    default:
      return "🗓️"
  }
}

function typeGradient(type: string): string {
  switch (type) {
    case "FLIGHT":
      return "from-blue-100 to-blue-200"
    case "HOTEL_CHECK_IN":
    case "HOTEL_CHECK_OUT":
      return "from-sky-100 to-sky-200"
    case "TRANSPORT":
      return "from-teal-100 to-teal-200"
    case "MEAL":
      return "from-amber-100 to-amber-200"
    case "ACTIVITY":
      return "from-indigo-100 to-indigo-200"
    default:
      return "from-gray-100 to-gray-200"
  }
}

function formatDurationMins(mins: number): string {
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

/**
 * Itinerary item dates are stored as midnight UTC standing in for the intended
 * local date (see `groupByDay` in lib/itinerary-utils), so read the UTC parts
 * and re-anchor at noon before formatting — otherwise US users see yesterday.
 */
function formatItemDate(date: Date | string): string {
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return ""
  const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
  return formatDate(new Date(`${dateStr}T12:00:00`), "EEE, MMM d")
}

const KIND_LABELS: Record<AttachmentKindValue, string> = {
  VOUCHER: "Voucher",
  RECEIPT: "Receipt",
  TICKET: "Ticket",
  CONFIRMATION: "Confirmation",
  OTHER: "Other",
}

const KIND_ORDER: AttachmentKindValue[] = [
  "VOUCHER",
  "RECEIPT",
  "TICKET",
  "CONFIRMATION",
  "OTHER",
]

function KindIcon({ kind, className }: { kind: AttachmentKindValue; className?: string }) {
  switch (kind) {
    case "VOUCHER":
      return <BadgeCheck className={className} />
    case "RECEIPT":
      return <Receipt className={className} />
    case "TICKET":
      return <Ticket className={className} />
    case "CONFIRMATION":
      return <FileText className={className} />
    default:
      return <Paperclip className={className} />
  }
}

/**
 * Extension fallback for browsers that hand us an empty `file.type` (common for
 * PDFs dragged out of some mail clients). Only used when the MIME type is blank;
 * the server re-validates either way.
 */
const EXTENSION_FALLBACK: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
}

/** Normalised the same way the server does before checking the allowlist. */
function effectiveMimeType(file: File): string {
  const declared = (file.type || "").toLowerCase().split(";")[0].trim()
  if (declared) return declared
  const ext = file.name.split(".").pop()?.toLowerCase()
  return (ext && EXTENSION_FALLBACK[ext]) || ""
}

const MIME_LABELS: Record<string, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPEG",
  "image/jpg": "JPEG",
  "image/png": "PNG",
  "image/webp": "WEBP",
  "image/heic": "HEIC",
  "image/heif": "HEIF",
}

/**
 * The headline on an uploaded file tile: "PDF", never "application/pdf". Falls
 * back to the MIME subtype and then the filename extension, so an unexpected
 * type still reads as something rather than blank.
 */
function fileTypeLabel(mimeType: string, fileName: string): string {
  const mime = (mimeType || "").toLowerCase().split(";")[0].trim()
  const known = MIME_LABELS[mime]
  if (known) return known
  const subtype = mime.split("/")[1]
  if (subtype) return subtype.replace(/^x-/, "").toUpperCase().slice(0, 6)
  const ext = fileName.split(".").pop()
  return ext && ext !== fileName ? ext.toUpperCase().slice(0, 6) : "FILE"
}

/* ─── Date <input> plumbing ───────────────────────────────────────────────── */

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

/** `yyyy-MM-dd` in the viewer's own timezone, for `<input type="date">`. */
function toDateInputValue(value: Date | string | null | undefined): string {
  if (!value) return ""
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ""
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** `yyyy-MM-ddTHH:mm` in the viewer's own timezone, for `datetime-local`. */
function toDateTimeInputValue(value: Date | string | null | undefined): string {
  const datePart = toDateInputValue(value)
  if (!datePart) return ""
  const d = value instanceof Date ? value : new Date(value as string | Date)
  return `${datePart}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** Empty input means "clear it"; the action treats `null` as an explicit unset. */
function fromDateInputValue(raw: string): Date | null {
  if (!raw) return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

function formatMoney(amount: number, currency: string | null | undefined): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
    }).format(amount)
  } catch {
    // An unknown/empty ISO code would otherwise throw and blank the modal.
    return `${currency || ""} ${amount.toFixed(2)}`.trim()
  }
}

function formatWhen(value: Date | string | null | undefined, withTime: boolean): string {
  if (!value) return ""
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ""
  return formatDate(d, withTime ? "EEE, MMM d 'at' h:mm a" : "EEE, MMM d")
}

/**
 * Client-side gate so a 20MB drop fails instantly instead of after a slow round
 * trip through a Postgres-backed upload. The server re-validates everything
 * (including magic bytes and the per-trip quota) — this is purely for feel.
 */
function validateFile(file: File): string | null {
  const mime = effectiveMimeType(file)
  if (!mime || !ALLOWED_ATTACHMENT_TYPES.includes(mime)) {
    return `${file.name}: unsupported file type. Attach a PDF, JPEG, PNG, WebP or HEIC.`
  }
  if (file.size === 0) {
    return `${file.name} is empty.`
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return `${file.name} is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_ATTACHMENT_BYTES)}.`
  }
  return null
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === "string" && err) return err
  return fallback
}

/* ─── Copyable value ──────────────────────────────────────────────────────── */

function CopyableValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Couldn't copy to clipboard")
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={`Copy ${label}`}
      className="group/copy inline-flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50 active:bg-indigo-100"
    >
      <span className="flex-1 truncate font-mono text-base font-bold tracking-wide text-gray-900">
        {value}
      </span>
      {copied ? (
        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-green-600">
          <Check className="h-4 w-4" /> Copied
        </span>
      ) : (
        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-gray-400 group-hover/copy:text-indigo-600">
          <Copy className="h-4 w-4" /> Copy
        </span>
      )}
    </button>
  )
}

/* ─── Reservation section ─────────────────────────────────────────────────── */

const STATUS_STYLE: Record<string, { dot: string; text: string; bg: string }> = {
  CONFIRMED: { dot: "bg-green-500", text: "text-green-700", bg: "bg-green-50" },
  PENDING: { dot: "bg-yellow-500", text: "text-yellow-700", bg: "bg-yellow-50" },
  CANCELLED: { dot: "bg-red-500", text: "text-red-700", bg: "bg-red-50" },
  WAITLISTED: { dot: "bg-purple-500", text: "text-purple-700", bg: "bg-purple-50" },
}

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_STYLE[status] || STATUS_STYLE.CONFIRMED
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        c.bg,
        c.text
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", c.dot)} />
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  )
}

const fieldLabelClass =
  "block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1"
const inputClass =
  "w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"

function ReservationEditor({
  tripId,
  itineraryItemId,
  reservation,
  onSaved,
  onCancel,
}: {
  tripId: string
  itineraryItemId: string
  reservation: EventReservation | null
  onSaved: (r: EventReservation) => void
  onCancel: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [confirmationNumber, setConfirmationNumber] = useState(
    reservation?.confirmationNumber || ""
  )
  const [provider, setProvider] = useState(reservation?.provider || "")
  const [reservationName, setReservationName] = useState(
    reservation?.reservationName || ""
  )
  const [partySize, setPartySize] = useState(reservation?.partySize?.toString() || "")
  const [bookingUrl, setBookingUrl] = useState(reservation?.bookingUrl || "")
  const [price, setPrice] = useState(reservation?.price?.toString() || "")
  const [balanceDue, setBalanceDue] = useState(
    reservation?.balanceDue != null ? String(reservation.balanceDue) : ""
  )
  const [balanceDueDate, setBalanceDueDate] = useState(
    toDateInputValue(reservation?.balanceDueDate)
  )
  const [checkInOpensAt, setCheckInOpensAt] = useState(
    toDateTimeInputValue(reservation?.checkInOpensAt)
  )
  const [specialRequests, setSpecialRequests] = useState(reservation?.specialRequests || "")
  const [status, setStatus] = useState(reservation?.status || "CONFIRMED")
  const [notes, setNotes] = useState(reservation?.notes || "")

  async function handleSave() {
    setSaving(true)
    try {
      const parsedParty = partySize ? parseInt(partySize, 10) : undefined
      const parsedPrice = price ? parseFloat(price) : undefined
      // Money, same handling as `price` — a blank box clears the balance rather
      // than leaving a stale amount owing.
      const parsedBalance = balanceDue ? parseFloat(balanceDue) : null
      const data: ReservationInput = {
        confirmationNumber: confirmationNumber.trim() || undefined,
        provider: provider.trim() || undefined,
        reservationName: reservationName.trim() || undefined,
        bookingUrl: bookingUrl.trim() || undefined,
        partySize: Number.isFinite(parsedParty) ? parsedParty : undefined,
        specialRequests: specialRequests.trim() || undefined,
        price: Number.isFinite(parsedPrice) ? parsedPrice : undefined,
        currency: reservation?.currency || "USD",
        status: status as ReservationInput["status"],
        notes: notes.trim() || undefined,
        balanceDue:
          parsedBalance != null && Number.isFinite(parsedBalance) ? parsedBalance : null,
        balanceDueDate: fromDateInputValue(balanceDueDate),
        checkInOpensAt: fromDateInputValue(checkInOpensAt),
        // Deliberately not edited here — the read view's one-tap "Mark as
        // checked in" owns that stamp, and omitting the key leaves it untouched.
      }

      const result = reservation
        ? await updateReservation(tripId, reservation.id, data)
        : await createReservation(tripId, itineraryItemId, data)

      onSaved(result as unknown as EventReservation)
      toast.success(reservation ? "Booking details updated" : "Booking details saved")
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't save booking details"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <label className={fieldLabelClass} htmlFor="res-confirmation">
          Confirmation number
        </label>
        <input
          id="res-confirmation"
          value={confirmationNumber}
          onChange={(e) => setConfirmationNumber(e.target.value)}
          placeholder="e.g. AB12CD34"
          className={cn(inputClass, "font-mono tracking-wide")}
          autoComplete="off"
          autoCapitalize="characters"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={fieldLabelClass} htmlFor="res-provider">
            Booked with
          </label>
          <input
            id="res-provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            placeholder="OpenTable, Viator, hotel direct"
            className={inputClass}
          />
        </div>
        <div>
          <label className={fieldLabelClass} htmlFor="res-name">
            Reserved under
          </label>
          <input
            id="res-name"
            value={reservationName}
            onChange={(e) => setReservationName(e.target.value)}
            placeholder="Name on the booking"
            className={inputClass}
            autoComplete="off"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={fieldLabelClass} htmlFor="res-party">
            Party size
          </label>
          <input
            id="res-party"
            type="number"
            inputMode="numeric"
            min={1}
            value={partySize}
            onChange={(e) => setPartySize(e.target.value)}
            placeholder="2"
            className={inputClass}
          />
        </div>
        <div>
          <label className={fieldLabelClass} htmlFor="res-price">
            Price
          </label>
          <input
            id="res-price"
            type="number"
            inputMode="decimal"
            step="0.01"
            min={0}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="0.00"
            className={inputClass}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={fieldLabelClass} htmlFor="res-balance">
            Balance due
          </label>
          <input
            id="res-balance"
            type="number"
            inputMode="decimal"
            step="0.01"
            min={0}
            value={balanceDue}
            onChange={(e) => setBalanceDue(e.target.value)}
            placeholder="0.00"
            className={inputClass}
          />
        </div>
        <div>
          <label className={fieldLabelClass} htmlFor="res-balance-date">
            Pay by
          </label>
          <input
            id="res-balance-date"
            type="date"
            value={balanceDueDate}
            onChange={(e) => setBalanceDueDate(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label className={fieldLabelClass} htmlFor="res-checkin-opens">
          Check-in opens
        </label>
        <input
          id="res-checkin-opens"
          type="datetime-local"
          value={checkInOpensAt}
          onChange={(e) => setCheckInOpensAt(e.target.value)}
          className={inputClass}
        />
        <p className="mt-1 text-[11px] text-gray-400">
          Leave blank for flights and ferries — check-in is assumed to open 24
          hours before departure.
        </p>
      </div>

      <div>
        <label className={fieldLabelClass} htmlFor="res-status">
          Status
        </label>
        <select
          id="res-status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className={inputClass}
        >
          <option value="CONFIRMED">Confirmed</option>
          <option value="PENDING">Pending</option>
          <option value="WAITLISTED">Waitlisted</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>

      <div>
        <label className={fieldLabelClass} htmlFor="res-booking-url">
          Booking link
        </label>
        <input
          id="res-booking-url"
          type="url"
          inputMode="url"
          value={bookingUrl}
          onChange={(e) => setBookingUrl(e.target.value)}
          placeholder="https://..."
          className={inputClass}
        />
      </div>

      <div>
        <label className={fieldLabelClass} htmlFor="res-requests">
          Special requests
        </label>
        <textarea
          id="res-requests"
          value={specialRequests}
          onChange={(e) => setSpecialRequests(e.target.value)}
          rows={2}
          placeholder="Window table, high chair, late check-in..."
          className={cn(inputClass, "resize-y")}
        />
      </div>

      <div>
        <label className={fieldLabelClass} htmlFor="res-notes">
          Notes
        </label>
        <textarea
          id="res-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Anything else worth remembering"
          className={cn(inputClass, "resize-y")}
        />
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-60"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function ReservationSection({
  tripId,
  itineraryItemId,
  reservation,
  onChange,
}: {
  tripId: string
  itineraryItemId: string
  reservation: EventReservation | null
  onChange: (r: EventReservation | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [checkingIn, setCheckingIn] = useState(false)

  async function handleToggleCheckIn(completed: boolean) {
    if (!reservation) return
    setCheckingIn(true)
    try {
      const result = await setCheckInCompleted(tripId, reservation.id, completed)
      onChange(result as unknown as EventReservation)
      toast.success(completed ? "Marked as checked in" : "Check-in cleared")
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't update check-in"))
    } finally {
      setCheckingIn(false)
    }
  }

  async function handleDelete() {
    if (!reservation) return
    setDeleting(true)
    try {
      await deleteReservation(tripId, reservation.id)
      onChange(null)
      setConfirmDelete(false)
      toast.success("Booking details removed")
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't remove booking details"))
    } finally {
      setDeleting(false)
    }
  }

  if (editing) {
    return (
      <ReservationEditor
        tripId={tripId}
        itineraryItemId={itineraryItemId}
        reservation={reservation}
        onSaved={(r) => {
          onChange(r)
          setEditing(false)
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  if (!reservation) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-3 text-sm font-medium text-gray-600 transition-colors hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-700"
      >
        <Plus className="h-4 w-4" />
        Add confirmation details
      </button>
    )
  }

  const hasAnyDetail =
    reservation.confirmationNumber ||
    reservation.provider ||
    reservation.reservationName ||
    reservation.partySize ||
    reservation.price != null ||
    reservation.specialRequests ||
    reservation.notes ||
    reservation.bookingUrl ||
    reservation.balanceDue != null ||
    reservation.balanceDueDate ||
    reservation.checkInOpensAt ||
    reservation.checkInCompletedAt

  const balanceOutstanding =
    reservation.balanceDue != null && reservation.balanceDue > 0

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <StatusBadge status={reservation.status} />
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-indigo-600"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
          {confirmDelete ? (
            <>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-60"
              >
                {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Confirm
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              aria-label="Remove booking details"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {reservation.confirmationNumber && (
        <div>
          <p className={fieldLabelClass}>Confirmation number</p>
          <CopyableValue
            value={reservation.confirmationNumber}
            label="confirmation number"
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        {reservation.provider && (
          <div>
            <p className={fieldLabelClass}>Booked with</p>
            <p className="text-sm text-gray-800">{reservation.provider}</p>
          </div>
        )}
        {reservation.reservationName && (
          <div>
            <p className={fieldLabelClass}>Reserved under</p>
            <p className="text-sm text-gray-800">{reservation.reservationName}</p>
          </div>
        )}
        {reservation.partySize != null && (
          <div>
            <p className={fieldLabelClass}>Party size</p>
            <p className="text-sm text-gray-800">
              {reservation.partySize} {reservation.partySize === 1 ? "guest" : "guests"}
            </p>
          </div>
        )}
        {reservation.price != null && (
          <div>
            <p className={fieldLabelClass}>Price</p>
            <p className="text-sm text-gray-800">
              {formatMoney(reservation.price, reservation.currency)}
            </p>
          </div>
        )}
      </div>

      {/* Payment still owing */}
      {(reservation.balanceDue != null || reservation.balanceDueDate) && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-lg border p-2.5",
            balanceOutstanding
              ? "border-amber-200 bg-amber-50"
              : "border-gray-200 bg-gray-50"
          )}
        >
          <Wallet
            className={cn(
              "mt-0.5 h-4 w-4 shrink-0",
              balanceOutstanding ? "text-amber-600" : "text-gray-400"
            )}
          />
          <div className="min-w-0">
            <p
              className={cn(
                "text-sm font-medium",
                balanceOutstanding ? "text-amber-900" : "text-gray-700"
              )}
            >
              {reservation.balanceDue != null
                ? `${formatMoney(reservation.balanceDue, reservation.currency)} still to pay`
                : "Payment due"}
            </p>
            {reservation.balanceDueDate && (
              <p
                className={cn(
                  "text-xs",
                  balanceOutstanding ? "text-amber-700" : "text-gray-500"
                )}
              >
                By {formatWhen(reservation.balanceDueDate, false)}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Check-in */}
      {(reservation.checkInOpensAt || reservation.checkInCompletedAt) && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-lg border p-2.5",
            reservation.checkInCompletedAt
              ? "border-green-200 bg-green-50"
              : "border-indigo-200 bg-indigo-50"
          )}
        >
          {reservation.checkInCompletedAt ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
          ) : (
            <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
          )}
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "text-sm font-medium",
                reservation.checkInCompletedAt ? "text-green-900" : "text-indigo-900"
              )}
            >
              {reservation.checkInCompletedAt
                ? `Checked in ${formatWhen(reservation.checkInCompletedAt, true)}`
                : `Check-in opens ${formatWhen(reservation.checkInOpensAt, true)}`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => handleToggleCheckIn(!reservation.checkInCompletedAt)}
            disabled={checkingIn}
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors disabled:opacity-60",
              reservation.checkInCompletedAt
                ? "text-green-700 hover:bg-green-100"
                : "bg-indigo-600 text-white hover:bg-indigo-700"
            )}
          >
            {checkingIn ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ClipboardCheck className="h-3.5 w-3.5" />
            )}
            {reservation.checkInCompletedAt ? "Undo" : "I've checked in"}
          </button>
        </div>
      )}

      {reservation.specialRequests && (
        <div>
          <p className={fieldLabelClass}>Special requests</p>
          <p className="whitespace-pre-wrap text-sm text-gray-700">
            {reservation.specialRequests}
          </p>
        </div>
      )}

      {reservation.notes && (
        <div>
          <p className={fieldLabelClass}>Notes</p>
          <p className="whitespace-pre-wrap text-sm text-gray-700">{reservation.notes}</p>
        </div>
      )}

      {reservation.bookingUrl && (
        <a
          href={reservation.bookingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-800"
        >
          <ExternalLink className="h-4 w-4" />
          View booking
        </a>
      )}

      {!hasAnyDetail && (
        <p className="text-sm text-gray-400">
          No confirmation details recorded yet.
        </p>
      )}
    </div>
  )
}

/* ─── Attachments section ─────────────────────────────────────────────────── */

/**
 * One uploaded file, as a green "this is on file" tile.
 *
 * The whole tile is the anchor, so on a phone the tap target is the card rather
 * than a 16px icon. The delete control sits *outside* that anchor as a sibling —
 * a button nested inside an `<a>` is invalid HTML and makes the tap ambiguous —
 * while keeping its two-step confirmation.
 */
function AttachmentRow({
  meta,
  onDeleted,
  tripId,
}: {
  meta: AttachmentMeta
  tripId: string
  onDeleted: (id: string) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const isImage = meta.mimeType.startsWith("image/")
  const typeLabel = fileTypeLabel(meta.mimeType, meta.fileName)

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteAttachment(tripId, meta.id)
      onDeleted(meta.id)
      toast.success("File deleted")
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't delete this file"))
      setDeleting(false)
    }
  }

  return (
    <li className="flex items-stretch gap-2">
      <a
        href={meta.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${meta.fileName} (${typeLabel}, ${formatBytes(meta.sizeBytes)})`}
        className="flex min-h-[60px] min-w-0 flex-1 items-center gap-3 rounded-xl border border-green-300 bg-green-50 px-3 py-2.5 text-left transition-colors hover:border-green-400 hover:bg-green-100 active:bg-green-200"
      >
        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-green-200 bg-white">
          {isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={meta.url}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <KindIcon kind={meta.kind} className="h-5 w-5 text-green-600" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          {/* File type is the headline — big, and the first thing read. */}
          <p className="text-base font-bold leading-tight text-green-900">
            {typeLabel}
          </p>
          {/* Filename matters less, so it's smaller and truncates. */}
          <p className="truncate text-xs leading-tight text-green-800">
            {meta.fileName}
          </p>
          {/* Size matters least of all. */}
          <p className="mt-0.5 truncate text-[10px] leading-tight text-green-700/70">
            {KIND_LABELS[meta.kind] || meta.kind} · {formatBytes(meta.sizeBytes)}
          </p>
        </div>

        <ExternalLink className="h-4 w-4 shrink-0 text-green-600" aria-hidden="true" />
      </a>

      {confirming ? (
        <div className="flex shrink-0 flex-col justify-center gap-1">
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="inline-flex items-center justify-center gap-1 rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
          >
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Delete
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={deleting}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label={`Delete ${meta.fileName}`}
          className="flex w-11 shrink-0 items-center justify-center rounded-xl border border-gray-200 text-gray-400 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </li>
  )
}

function AttachmentsSection({
  tripId,
  itineraryItemId,
  onCountChange,
}: {
  tripId: string
  itineraryItemId: string
  /** Reports the live file count so the modal's booking-proof state stays honest. */
  onCountChange?: (count: number) => void
}) {
  const [files, setFiles] = useState<AttachmentMeta[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(0)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [kind, setKind] = useState<AttachmentKindValue>("VOUCHER")
  const inputRef = useRef<HTMLInputElement>(null)
  const aliveRef = useRef(true)
  // Mirrors of the two counters `handleFiles` needs, so the callback can read
  // current values without listing them as dependencies.
  const filesRef = useRef<AttachmentMeta[] | null>(files)
  const uploadingRef = useRef(uploading)
  filesRef.current = files
  uploadingRef.current = uploading
  // Held in a ref so a new callback identity from the parent can't re-fire the
  // notification effect below.
  const onCountChangeRef = useRef(onCountChange)
  onCountChangeRef.current = onCountChange

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // Null means "still loading" — don't claim zero files before we know.
  useEffect(() => {
    if (files === null) return
    onCountChangeRef.current?.(files.length)
  }, [files])

  // Files live in Postgres, so this list is fetched only when the modal opens
  // for this one event — never per timeline row.
  useEffect(() => {
    let cancelled = false
    listAttachments(tripId, itineraryItemId)
      .then((result) => {
        if (!cancelled) setFiles(result)
      })
      .catch((err) => {
        if (!cancelled) {
          setFiles([])
          setLoadError(errorMessage(err, "Couldn't load attachments"))
        }
      })
    return () => {
      cancelled = true
    }
  }, [tripId, itineraryItemId])

  const acceptAttr = useMemo(
    () => ALLOWED_ATTACHMENT_TYPES.join(","),
    []
  )

  const handleFiles = useCallback(
    async (list: FileList | File[] | null) => {
      const picked = Array.from(list || [])
      if (picked.length === 0) return
      setValidationError(null)

      const rejected: string[] = []
      const accepted: File[] = []
      // Count what's already stored plus anything mid-flight, so a burst of
      // drops can't sail past the per-event cap the server enforces.
      let slotsLeft = MAX_ATTACHMENTS_PER_ITEM - (filesRef.current?.length ?? 0) - uploadingRef.current
      for (const file of picked) {
        const problem = validateFile(file)
        if (problem) {
          rejected.push(problem)
          continue
        }
        if (slotsLeft <= 0) {
          rejected.push(
            `${file.name}: an event can hold at most ${MAX_ATTACHMENTS_PER_ITEM} files.`
          )
          continue
        }
        slotsLeft -= 1
        accepted.push(file)
      }

      if (rejected.length > 0) setValidationError(rejected.join("\n"))
      if (accepted.length === 0) return

      setUploading((n) => n + accepted.length)
      for (const file of accepted) {
        try {
          const form = new FormData()
          form.append("file", file)
          form.append("kind", kind)
          const meta = await uploadAttachment(tripId, itineraryItemId, form)
          if (aliveRef.current) {
            setFiles((prev) => [...(prev || []), meta])
          }
        } catch (err) {
          toast.error(errorMessage(err, `Couldn't upload ${file.name}`))
        } finally {
          if (aliveRef.current) setUploading((n) => Math.max(0, n - 1))
        }
      }
    },
    [tripId, itineraryItemId, kind]
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label
          className="text-[11px] font-semibold uppercase tracking-wide text-gray-500"
          htmlFor="attachment-kind"
        >
          File type
        </label>
        <select
          id="attachment-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as AttachmentKindValue)}
          className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-700 outline-none focus:border-indigo-400"
        >
          {KIND_ORDER.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </div>

      {/* Drop zone + picker */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={(e) => {
          // Ignore the dragleave fired when crossing into a child element.
          const next = e.relatedTarget as Node | null
          if (next && e.currentTarget.contains(next)) return
          setDragOver(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          void handleFiles(e.dataTransfer?.files ?? null)
        }}
        className={cn(
          "rounded-xl border-2 border-dashed p-4 text-center transition-colors",
          dragOver
            ? "border-indigo-400 bg-indigo-50"
            : "border-gray-200 bg-gray-50/60"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={acceptAttr}
          className="sr-only"
          onChange={(e) => {
            void handleFiles(e.target.files)
            e.target.value = ""
          }}
        />
        <Upload className="mx-auto h-6 w-6 text-gray-400" />
        <p className="mt-2 text-sm text-gray-600">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="font-semibold text-indigo-600 underline-offset-2 hover:underline"
          >
            Choose a file
          </button>{" "}
          <span className="hidden sm:inline">or drag it here</span>
        </p>
        <p className="mt-1 text-[11px] text-gray-400">
          PDFs and images, up to {formatBytes(MAX_ATTACHMENT_BYTES)} each
        </p>
      </div>

      {validationError && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
          <p className="whitespace-pre-line text-xs text-red-700">{validationError}</p>
        </div>
      )}

      {loadError && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <p className="text-xs text-amber-700">{loadError}</p>
        </div>
      )}

      {/* List */}
      {files === null ? (
        <div className="flex items-center gap-2 py-3 text-sm text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading files...
        </div>
      ) : (
        <ul className="space-y-2">
          {files.map((meta) => (
            <AttachmentRow
              key={meta.id}
              meta={meta}
              tripId={tripId}
              onDeleted={(id) =>
                setFiles((prev) => (prev || []).filter((f) => f.id !== id))
              }
            />
          ))}
          {Array.from({ length: uploading }, (_, i) => (
            <li
              key={`pending-${i}`}
              className="flex items-center gap-3 rounded-lg border border-indigo-200 bg-indigo-50/50 p-2.5"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-indigo-100">
                <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
              </div>
              <p className="text-sm text-indigo-700">Uploading...</p>
            </li>
          ))}
          {files.length === 0 && uploading === 0 && (
            <li className="py-3 text-center text-sm text-gray-400">
              No files attached yet
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

/* ─── Still-needs-arranging flag ──────────────────────────────────────────── */

/**
 * Lets the traveller declare "this isn't booked yet", and shows whether that
 * declaration is still outstanding.
 *
 * The stored boolean is the *intent* and is never cleared behind the user's
 * back — `isAwaitingReservation` decides the presentation, so the moment a
 * confirmation number or a voucher exists this reads as sorted instead of
 * nagging, and it goes back to nagging if that proof is later removed.
 */
function NeedsReservationSection({
  tripId,
  itineraryItemId,
  needsReservation,
  awaiting,
  hasProof,
  onChange,
}: {
  tripId: string
  itineraryItemId: string
  needsReservation: boolean
  awaiting: boolean
  hasProof: boolean
  onChange: (value: boolean) => void
}) {
  const [saving, setSaving] = useState(false)

  async function handleToggle() {
    const next = !needsReservation
    setSaving(true)
    // Optimistic: the toggle is the whole interaction, so it has to feel instant.
    onChange(next)
    try {
      await setNeedsReservation(tripId, itineraryItemId, next)
    } catch (err) {
      onChange(!next)
      toast.error(errorMessage(err, "Couldn't update this event"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2.5">
      <button
        type="button"
        role="switch"
        aria-checked={needsReservation}
        onClick={handleToggle}
        disabled={saving}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors disabled:opacity-60",
          needsReservation
            ? "border-rose-300 bg-rose-50 hover:bg-rose-100"
            : "border-gray-200 bg-white hover:border-indigo-300 hover:bg-indigo-50"
        )}
      >
        <span
          className={cn(
            "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors",
            needsReservation ? "bg-rose-500" : "bg-gray-300"
          )}
          aria-hidden="true"
        >
          <span
            className={cn(
              "absolute h-5 w-5 rounded-full bg-white shadow transition-transform",
              needsReservation ? "translate-x-[1.125rem]" : "translate-x-0.5"
            )}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-gray-900">
            Still needs to be booked
          </span>
          <span className="block text-xs text-gray-500">
            Flags this event on your plan and in your to-do list.
          </span>
        </span>
        {saving && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" />}
      </button>

      {needsReservation && awaiting && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <p className="text-xs text-rose-800">
            <span className="font-semibold">Not booked yet.</span> Add a
            confirmation number or attach a voucher below and this clears itself.
          </p>
        </div>
      )}

      {needsReservation && !awaiting && (
        <div className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 p-2.5">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
          <p className="text-xs text-green-800">
            <span className="font-semibold">Sorted.</span>{" "}
            {hasProof
              ? "You've got proof of this booking on file, so it no longer shows as outstanding."
              : "This no longer shows as outstanding."}
          </p>
        </div>
      )}
    </div>
  )
}

/* ─── Modal ───────────────────────────────────────────────────────────────── */

function SectionHeading({
  icon,
  children,
}: {
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <h3 className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
      {icon}
      {children}
    </h3>
  )
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export function EventDetailsModal({
  item,
  tripId,
  onClose,
  onOutstandingChange,
}: {
  item: EventDetailsItem
  tripId: string
  onClose: () => void
  /**
   * Fires whenever this event's outstanding state changes while the modal is
   * open, so the plan behind it can go red (or stop being red) immediately
   * rather than waiting for a server round trip.
   */
  onOutstandingChange?: (awaiting: boolean) => void
}) {
  const [mounted, setMounted] = useState(false)
  const [reservation, setReservation] = useState<EventReservation | null>(
    item.reservation ?? null
  )
  const [needsReservationFlag, setNeedsReservationFlag] = useState(
    !!item.needsReservation
  )
  // Seeded from the server's count, then kept live by the attachments list.
  const [attachmentCount, setAttachmentCount] = useState(
    item._count?.attachments ?? 0
  )
  const [phone, setPhone] = useState<string | null>(null)
  const [website, setWebsite] = useState<string | null>(
    item.activity?.websiteUrl ?? null
  )
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  // Kept in a ref so the mount effect can stay dependency-free — otherwise a new
  // `onClose` identity on every parent render would re-lock scroll and steal focus.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => setMounted(true), [])

  // Single source of truth for "does this still need doing", shared with the
  // To Do screen, the nav badge and the plan's red events.
  const subject = buildTaskSubject(item, {
    needsReservation: needsReservationFlag,
    hasAttachments: attachmentCount > 0,
    reservation,
  })
  const awaiting = isAwaitingReservation(subject)
  const proof = hasBookingProof(subject)

  const onOutstandingChangeRef = useRef(onOutstandingChange)
  onOutstandingChangeRef.current = onOutstandingChange
  useEffect(() => {
    onOutstandingChangeRef.current?.(awaiting)
  }, [awaiting])

  const place = item.activity || item.hotel || null
  const address = item.activity?.address || item.hotel?.address || null
  const placeName = item.activity?.name || item.hotel?.name || item.title
  const googlePlaceId = item.activity?.googlePlaceId ?? null
  const mapsUrl = place
    ? buildMapsUrl({
        name: placeName,
        address,
        lat: place.lat,
        lng: place.lng,
        googlePlaceId,
      })
    : null

  // Phone lives on Google, not in our DB — pull it lazily, once, on open.
  useEffect(() => {
    if (!googlePlaceId) return
    let cancelled = false
    getPlaceDetails(googlePlaceId)
      .then((details: { phone?: string; website?: string } | null) => {
        if (cancelled || !details) return
        if (details.phone) setPhone(details.phone)
        if (details.website) setWebsite((prev) => prev || details.website || null)
      })
      .catch(() => {
        /* phone is a nice-to-have; never block the modal on it */
      })
    return () => {
      cancelled = true
    }
  }, [googlePlaceId])

  // Escape to close, Tab trapped inside, body scroll locked, focus restored.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    const focusTimer = setTimeout(() => closeRef.current?.focus(), 0)

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      if (e.key !== "Tab") return
      const root = dialogRef.current
      if (!root) return
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(FOCUSABLE)
      ).filter((el) => el.offsetParent !== null || el === document.activeElement)
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", handleKeyDown, true)
    return () => {
      clearTimeout(focusTimer)
      document.removeEventListener("keydown", handleKeyDown, true)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus?.()
    }
  }, [])

  if (!mounted) return null

  const imageUrl = item.activity?.imageUrl || null
  const titleId = `event-details-title-${item.id}`

  const content = (
    // React portals bubble synthetic events through the React tree, not the DOM
    // tree — without these guards a click in here would reach the timeline card's
    // onClick (collapsing it) and the timeline background's add-event handler.
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div
        className="absolute inset-0 bg-black/40 sm:backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-h-[90vh] sm:max-w-lg sm:rounded-2xl sm:border sm:border-gray-200"
      >
        {/* Hero */}
        <div className="relative h-36 w-full shrink-0 sm:h-44">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div
              className={cn(
                "flex h-full w-full items-center justify-center bg-gradient-to-br",
                typeGradient(item.type)
              )}
            >
              <span className="text-5xl opacity-70" aria-hidden="true">
                {typeEmoji(item.type)}
              </span>
            </div>
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/70 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-4">
            <h2
              id={titleId}
              className="line-clamp-2 text-lg font-semibold leading-tight text-white drop-shadow"
            >
              {item.title}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close event details"
            className="absolute right-3 top-3 rounded-full bg-black/40 p-2 text-white transition-colors hover:bg-black/60 focus:outline-none focus:ring-2 focus:ring-white/70"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-8 pt-4 sm:pb-5">
          {/* When & where */}
          <div className="space-y-2.5">
            <div className="flex items-start gap-2 text-sm text-gray-700">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
              <span>
                {formatItemDate(item.date)}
                {item.startTime ? ` · ${formatTime(item.startTime)}` : ""}
                {item.startTime && item.endTime ? ` – ${formatTime(item.endTime)}` : ""}
                <span className="text-gray-400">
                  {" · "}
                  {formatDurationMins(item.durationMins)}
                </span>
              </span>
            </div>

            {address &&
              (mapsUrl ? (
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-2 text-sm text-indigo-600 transition-colors hover:text-indigo-800"
                >
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-indigo-400" />
                  <span className="underline decoration-indigo-200 underline-offset-2">
                    {address}
                  </span>
                  <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 opacity-60" />
                </a>
              ) : (
                <div className="flex items-start gap-2 text-sm text-gray-700">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                  <span>{address}</span>
                </div>
              ))}

            {phone && (
              <a
                href={`tel:${phone.replace(/[^+\d]/g, "")}`}
                className="flex items-center gap-2 text-sm text-indigo-600 transition-colors hover:text-indigo-800"
              >
                <Phone className="h-4 w-4 shrink-0 text-indigo-400" />
                <span className="underline decoration-indigo-200 underline-offset-2">
                  {phone}
                </span>
              </a>
            )}

            {website && (
              <a
                href={website}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-indigo-600 transition-colors hover:text-indigo-800"
              >
                <Globe className="h-4 w-4 shrink-0 text-indigo-400" />
                <span className="truncate underline decoration-indigo-200 underline-offset-2">
                  Website
                </span>
              </a>
            )}

            {item.notes && (
              <p className="whitespace-pre-wrap pt-1 text-sm text-gray-600">
                {item.notes}
              </p>
            )}
          </div>

          {/* Still needs arranging */}
          <div className="mt-5 border-t border-gray-100 pt-4">
            <SectionHeading
              icon={
                awaiting ? (
                  <AlertTriangle className="h-3.5 w-3.5 text-rose-500" />
                ) : (
                  <ClipboardCheck className="h-3.5 w-3.5 text-indigo-500" />
                )
              }
            >
              Arrangements
            </SectionHeading>
            <NeedsReservationSection
              tripId={tripId}
              itineraryItemId={item.id}
              needsReservation={needsReservationFlag}
              awaiting={awaiting}
              hasProof={proof}
              onChange={setNeedsReservationFlag}
            />
          </div>

          {/* Confirmation details */}
          <div className="mt-5 border-t border-gray-100 pt-4">
            <SectionHeading icon={<Ticket className="h-3.5 w-3.5 text-indigo-500" />}>
              Confirmation &amp; booking
            </SectionHeading>
            <ReservationSection
              tripId={tripId}
              itineraryItemId={item.id}
              reservation={reservation}
              onChange={setReservation}
            />
          </div>

          {/* Attachments */}
          <div className="mt-5 border-t border-gray-100 pt-4">
            <SectionHeading icon={<Paperclip className="h-3.5 w-3.5 text-indigo-500" />}>
              Vouchers &amp; receipts
            </SectionHeading>
            <AttachmentsSection
              tripId={tripId}
              itineraryItemId={item.id}
              onCountChange={setAttachmentCount}
            />
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(content, document.body)
}
