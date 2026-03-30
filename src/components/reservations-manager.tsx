"use client"

import { useState } from "react"
import { Ticket, ChevronDown, ChevronUp, Plus, Pencil, Trash2, Loader2, X, Copy, Check, ExternalLink } from "lucide-react"
import { createReservation, updateReservation, deleteReservation } from "@/lib/actions/reservations"
import type { ReservationInput } from "@/lib/actions/reservations"
import { formatDate, formatTime } from "@/lib/utils"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

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
  type: string
  title: string
  durationMins: number
  reservation?: Reservation | null
}

interface ReservationsManagerProps {
  tripId: string
  itemsWithReservations: ItineraryItem[]
  itemsWithoutReservations: ItineraryItem[]
}

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
      toast.success(reservation ? "Reservation updated" : "Reservation created")
    } catch {
      toast.error("Failed to save reservation")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2.5 mt-3">
      <input
        type="text"
        placeholder="Confirmation number"
        value={confirmationNumber}
        onChange={(e) => setConfirmationNumber(e.target.value)}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
        autoFocus
      />
      <input
        type="text"
        placeholder="Provider (e.g. OpenTable, Viator)"
        value={provider}
        onChange={(e) => setProvider(e.target.value)}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      <div className="flex gap-2">
        <input
          type="number"
          placeholder="Party size"
          value={partySize}
          onChange={(e) => setPartySize(e.target.value)}
          className="w-1/2 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <input
          type="number"
          step="0.01"
          placeholder="Price"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="w-1/2 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>
      <input
        type="text"
        placeholder="Booking URL"
        value={bookingUrl}
        onChange={(e) => setBookingUrl(e.target.value)}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      <textarea
        placeholder="Special requests (dietary needs, accessibility, etc.)"
        value={specialRequests}
        onChange={(e) => setSpecialRequests(e.target.value)}
        rows={2}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
      />
      <textarea
        placeholder="Notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
      />
      <select
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
          className="flex-1 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors flex items-center justify-center gap-1"
        >
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {reservation ? "Update" : "Save Reservation"}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function ReservationRow({
  item,
  tripId,
  onUpdate,
  onDelete,
}: {
  item: ItineraryItem
  tripId: string
  onUpdate: (itemId: string, reservation: Reservation | null) => void
  onDelete: (itemId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [copied, setCopied] = useState(false)
  const reservation = item.reservation!

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
      onDelete(item.id)
      toast.success("Reservation deleted")
    } catch {
      toast.error("Failed to delete reservation")
      setDeleting(false)
    }
  }

  if (editing) {
    return (
      <div className="bg-gray-50 rounded-xl px-4 py-3">
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm font-medium text-gray-900">{item.title}</p>
        </div>
        <ReservationForm
          tripId={tripId}
          reservation={reservation}
          onSaved={(r) => {
            onUpdate(item.id, r)
            setEditing(false)
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    )
  }

  return (
    <div className="bg-gray-50 rounded-xl px-4 py-3">
      <button
        className="w-full text-left flex items-center gap-3"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{item.title}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <ReservationStatusBadge status={reservation.status} />
            {reservation.confirmationNumber && (
              <span className="text-xs text-gray-500 font-mono">#{reservation.confirmationNumber}</span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {formatDate(item.date, "EEE, MMM d")}
            {item.startTime && <>, {formatTime(item.startTime)}</>}
            {reservation.partySize && <> &middot; Party of {reservation.partySize}</>}
          </p>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-gray-200 space-y-2">
          {/* Confirmation number with copy */}
          {reservation.confirmationNumber && (
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Confirmation</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-sm font-bold text-gray-900 font-mono tracking-wide">
                  {reservation.confirmationNumber}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleCopy() }}
                  className="p-0.5 rounded hover:bg-gray-200 transition-colors"
                  title="Copy confirmation number"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5 text-gray-400" />}
                </button>
              </div>
            </div>
          )}

          {reservation.provider && (
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Provider</p>
              <p className="text-xs text-gray-700">{reservation.provider}</p>
            </div>
          )}

          {reservation.partySize && (
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Party Size</p>
              <p className="text-xs text-gray-700">{reservation.partySize} {reservation.partySize === 1 ? "guest" : "guests"}</p>
            </div>
          )}

          {reservation.price != null && (
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Price</p>
              <p className="text-xs text-gray-700">
                {new Intl.NumberFormat("en-US", { style: "currency", currency: reservation.currency || "USD" }).format(reservation.price)}
              </p>
            </div>
          )}

          {reservation.specialRequests && (
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Special Requests</p>
              <p className="text-xs text-gray-600">{reservation.specialRequests}</p>
            </div>
          )}

          {reservation.notes && (
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Notes</p>
              <p className="text-xs text-gray-600">{reservation.notes}</p>
            </div>
          )}

          {reservation.bookingUrl && (
            <a
              href={reservation.bookingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              View booking
            </a>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2 border-t border-gray-200">
            <button
              onClick={(e) => { e.stopPropagation(); setEditing(true) }}
              className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-indigo-600 font-medium py-1"
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleDelete() }}
              disabled={deleting}
              className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-red-600 font-medium py-1"
            >
              {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function ReservationsManager({
  tripId,
  itemsWithReservations: initialWithRes,
  itemsWithoutReservations: initialWithoutRes,
}: ReservationsManagerProps) {
  const [itemsWithRes, setItemsWithRes] = useState<ItineraryItem[]>(initialWithRes)
  const [itemsWithoutRes, setItemsWithoutRes] = useState<ItineraryItem[]>(initialWithoutRes)
  const [showAddForm, setShowAddForm] = useState(false)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)

  function handleReservationUpdate(itemId: string, reservation: Reservation | null) {
    setItemsWithRes((prev) =>
      prev.map((it) => (it.id === itemId ? { ...it, reservation } : it))
    )
  }

  function handleReservationDelete(itemId: string) {
    const item = itemsWithRes.find((it) => it.id === itemId)
    if (item) {
      setItemsWithRes((prev) => prev.filter((it) => it.id !== itemId))
      setItemsWithoutRes((prev) => [...prev, { ...item, reservation: null }].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()))
    }
  }

  function handleNewReservationSaved(reservation: Reservation) {
    const item = itemsWithoutRes.find((it) => it.id === selectedItemId)
    if (item) {
      setItemsWithoutRes((prev) => prev.filter((it) => it.id !== selectedItemId))
      setItemsWithRes((prev) => [...prev, { ...item, reservation }].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()))
    }
    setShowAddForm(false)
    setSelectedItemId(null)
  }

  // Group reservations by date
  const grouped = itemsWithRes.reduce<Record<string, ItineraryItem[]>>((acc, item) => {
    const dateKey = formatDate(item.date, "EEE, MMM d")
    if (!acc[dateKey]) acc[dateKey] = []
    acc[dateKey].push(item)
    return acc
  }, {})

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <Ticket className="w-4 h-4 text-indigo-500" />
        <h2 className="text-sm font-semibold text-gray-700">Reservations</h2>
        <span className="text-xs text-gray-400 ml-auto">
          {itemsWithRes.length} reservation{itemsWithRes.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Existing reservations */}
      {itemsWithRes.length > 0 ? (
        <div className="space-y-4">
          {Object.entries(grouped).map(([dateLabel, items]) => (
            <div key={dateLabel}>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">{dateLabel}</p>
              <div className="space-y-2">
                {items.map((item) => (
                  <ReservationRow
                    key={item.id}
                    item={item}
                    tripId={tripId}
                    onUpdate={handleReservationUpdate}
                    onDelete={handleReservationDelete}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-400 mb-3">No reservations yet.</p>
      )}

      {/* Add reservation flow */}
      {showAddForm && selectedItemId ? (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-700">
              New reservation for: {itemsWithoutRes.find((it) => it.id === selectedItemId)?.title}
            </p>
            <button
              onClick={() => { setShowAddForm(false); setSelectedItemId(null) }}
              className="p-1 rounded hover:bg-gray-100 transition-colors"
            >
              <X className="w-3.5 h-3.5 text-gray-400" />
            </button>
          </div>
          <ReservationForm
            tripId={tripId}
            itineraryItemId={selectedItemId}
            onSaved={handleNewReservationSaved}
            onCancel={() => { setShowAddForm(false); setSelectedItemId(null) }}
          />
        </div>
      ) : showAddForm ? (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-700">Select an event</p>
            <button
              onClick={() => setShowAddForm(false)}
              className="p-1 rounded hover:bg-gray-100 transition-colors"
            >
              <X className="w-3.5 h-3.5 text-gray-400" />
            </button>
          </div>
          {itemsWithoutRes.length > 0 ? (
            <div className="space-y-1 max-h-[240px] overflow-y-auto">
              {itemsWithoutRes.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSelectedItemId(item.id)}
                  className="w-full text-left px-3 py-2.5 bg-gray-50 hover:bg-indigo-50 rounded-lg transition-colors flex items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{item.title}</p>
                    <p className="text-xs text-gray-500">
                      {formatDate(item.date, "EEE, MMM d")}
                      {item.startTime && <> at {formatTime(item.startTime)}</>}
                    </p>
                  </div>
                  <Plus className="w-4 h-4 text-gray-400 shrink-0" />
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400 py-2">All activities already have reservations.</p>
          )}
        </div>
      ) : (
        <button
          onClick={() => setShowAddForm(true)}
          className="mt-3 w-full flex items-center justify-center gap-1.5 py-2 text-sm text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg transition-colors font-medium"
        >
          <Plus className="w-4 h-4" />
          Add Reservation
        </button>
      )}
    </div>
  )
}
