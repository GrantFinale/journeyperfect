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
} from "lucide-react"
import {
  createReservation,
  updateReservation,
  deleteReservation,
  type ReservationInput,
} from "@/lib/actions/reservations"
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
  const [specialRequests, setSpecialRequests] = useState(reservation?.specialRequests || "")
  const [status, setStatus] = useState(reservation?.status || "CONFIRMED")
  const [notes, setNotes] = useState(reservation?.notes || "")

  async function handleSave() {
    setSaving(true)
    try {
      const parsedParty = partySize ? parseInt(partySize, 10) : undefined
      const parsedPrice = price ? parseFloat(price) : undefined
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
    reservation.bookingUrl

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
              {new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: reservation.currency || "USD",
              }).format(reservation.price)}
            </p>
          </div>
        )}
      </div>

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
    <li className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-2.5">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-gray-100">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={meta.url}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <KindIcon kind={meta.kind} className="h-5 w-5 text-gray-400" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-900">{meta.fileName}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-gray-500">
          <span className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-600">
            <KindIcon kind={meta.kind} className="h-3 w-3" />
            {KIND_LABELS[meta.kind] || meta.kind}
          </span>
          <span>{formatBytes(meta.sizeBytes)}</span>
        </p>
      </div>

      <a
        href={meta.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${meta.fileName}`}
        className="shrink-0 rounded-md p-2 text-gray-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
      >
        <ExternalLink className="h-4 w-4" />
      </a>

      {confirming ? (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
          >
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Delete
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={deleting}
            className="rounded-md px-2 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label={`Delete ${meta.fileName}`}
          className="shrink-0 rounded-md p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
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
}: {
  tripId: string
  itineraryItemId: string
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

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

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
}: {
  item: EventDetailsItem
  tripId: string
  onClose: () => void
}) {
  const [mounted, setMounted] = useState(false)
  const [reservation, setReservation] = useState<EventReservation | null>(
    item.reservation ?? null
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
            <AttachmentsSection tripId={tripId} itineraryItemId={item.id} />
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(content, document.body)
}
