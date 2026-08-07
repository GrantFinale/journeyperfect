"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Hotel, Trash2, Pencil, X, MapPin } from "lucide-react"
import { backfillHotelPhoto, updateHotel } from "@/lib/actions/hotels"
import { formatDate, cn } from "@/lib/utils"
import PlacesAutocomplete from "@/components/places-autocomplete"
import {
  DateTimeField,
  DEFAULT_CHECK_IN_TIME,
  DEFAULT_CHECK_OUT_TIME,
  CHECK_IN_QUICK_TIMES,
  CHECK_OUT_QUICK_TIMES,
} from "./date-time-fields"

export type HotelRow = {
  id: string
  name: string
  address: string | null
  city?: string | null
  lat?: number | null
  lng?: number | null
  checkIn: Date | string
  checkOut: Date | string
  confirmationNumber: string | null
  bookingLink?: string | null
  notes?: string | null
  isVacationRental: boolean
  price?: number | null
  roomCount?: number | null
  roomType?: string | null
  photoRef?: string | null
  googlePlaceId?: string | null
}

function nightsBetween(checkIn: Date | string, checkOut: Date | string): number {
  const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime()
  return Math.max(1, Math.round(ms / 86400000))
}

/** A Date/ISO value -> the "YYYY-MM-DDTHH:MM" local string the form fields use. */
function toLocalInput(value: Date | string | null | undefined): string {
  if (!value) return ""
  const d = new Date(value)
  if (isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function HotelPhoto({ photoRef, name }: { photoRef?: string | null; name: string }) {
  const [broken, setBroken] = useState(false)

  if (!photoRef || broken) {
    return (
      <div className="w-24 h-20 rounded-xl bg-gradient-to-br from-purple-50 to-indigo-50 flex items-center justify-center shrink-0">
        <Hotel className="w-5 h-5 text-purple-300" />
      </div>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/places/photo/${encodeURIComponent(photoRef)}`}
      alt={name}
      onError={() => setBroken(true)}
      className="w-24 h-20 rounded-xl object-cover bg-gray-100 shrink-0"
    />
  )
}

interface HotelTileProps {
  tripId: string
  hotel: HotelRow
  placesApiKey?: string
  onUpdated: (hotel: HotelRow) => void
  onDelete: (hotelId: string) => void
}

export function HotelTile({ tripId, hotel, placesApiKey, onUpdated, onDelete }: HotelTileProps) {
  const [editing, setEditing] = useState(false)
  const backfilled = useRef(false)

  // Hotels created before photoRef existed have no photo — fill it in lazily on
  // first view. Best-effort: a failure just leaves the placeholder in place.
  useEffect(() => {
    if (hotel.photoRef || backfilled.current) return
    backfilled.current = true
    backfillHotelPhoto(tripId, hotel.id)
      .then((res) => {
        if (res?.photoRef) {
          onUpdated({ ...hotel, photoRef: res.photoRef, city: res.city ?? hotel.city })
        }
      })
      .catch(() => {
        // Photo enrichment is cosmetic — stay silent.
      })
    // Only ever attempt once per hotel per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotel.id, hotel.photoRef, tripId])

  const nights = nightsBetween(hotel.checkIn, hotel.checkOut)

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 group">
      <div className="flex items-start gap-3">
        <HotelPhoto photoRef={hotel.photoRef} name={hotel.name} />

        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm text-gray-900 truncate">
            {hotel.isVacationRental ? "\u{1F3E1} " : "\u{1F3E8} "}
            {hotel.name}
          </div>

          {/* Stay dates — the primary fact on this tile */}
          <div className="mt-1 text-base font-semibold text-gray-900 leading-snug">
            {formatDate(hotel.checkIn, "MMM d")} <span className="text-gray-300">&rarr;</span>{" "}
            {formatDate(hotel.checkOut, "MMM d, yyyy")}
          </div>
          <div className="text-xs text-gray-400">
            {nights} night{nights === 1 ? "" : "s"}
            {hotel.confirmationNumber && (
              <>
                {" · "}
                <span className="font-mono">{hotel.confirmationNumber}</span>
              </>
            )}
          </div>

          {/* Address on its own line */}
          {hotel.address && (
            <div className="flex items-start gap-1 mt-1.5 text-xs text-gray-500">
              <MapPin className="w-3 h-3 mt-0.5 shrink-0" />
              <span className="min-w-0">{hotel.address}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => setEditing((v) => !v)}
            aria-label="Edit hotel"
            className="p-2 text-gray-400 hover:text-indigo-600 transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onDelete(hotel.id)}
            aria-label="Delete hotel"
            className="p-2 text-gray-400 hover:text-red-500 transition-colors sm:opacity-0 sm:group-hover:opacity-100"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {editing && (
        <HotelEditPanel
          tripId={tripId}
          hotel={hotel}
          placesApiKey={placesApiKey}
          onSaved={(updated) => {
            onUpdated(updated)
            setEditing(false)
          }}
          onCancel={() => setEditing(false)}
        />
      )}
    </div>
  )
}

interface HotelEditPanelProps {
  tripId: string
  hotel: HotelRow
  placesApiKey?: string
  onSaved: (hotel: HotelRow) => void
  onCancel: () => void
}

/** Inline expanding editor for every hotel field, including notes. */
export function HotelEditPanel({ tripId, hotel, placesApiKey, onSaved, onCancel }: HotelEditPanelProps) {
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: hotel.name,
    address: hotel.address || "",
    lat: hotel.lat ?? undefined as number | undefined,
    lng: hotel.lng ?? undefined as number | undefined,
    checkIn: toLocalInput(hotel.checkIn),
    checkOut: toLocalInput(hotel.checkOut),
    confirmationNumber: hotel.confirmationNumber || "",
    bookingLink: hotel.bookingLink || "",
    notes: hotel.notes || "",
    isVacationRental: hotel.isVacationRental,
    price: hotel.price != null ? String(hotel.price) : "",
    roomCount: hotel.roomCount != null ? String(hotel.roomCount) : "1",
    roomType: hotel.roomType || "",
  })

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error("Name is required")
      return
    }
    if (!form.checkIn || !form.checkOut) {
      toast.error("Check-in and check-out dates are required")
      return
    }
    if (new Date(form.checkOut) <= new Date(form.checkIn)) {
      toast.error("Check-out must be after check-in")
      return
    }
    setSaving(true)
    try {
      const addressChanged = (form.address || "") !== (hotel.address || "")
      const updated = await updateHotel(tripId, hotel.id, {
        name: form.name.trim(),
        address: form.address || undefined,
        // Only send coords when they came from a fresh Places pick; otherwise
        // let the server re-resolve them from the new address.
        ...(addressChanged && form.lat != null && form.lng != null
          ? { lat: form.lat, lng: form.lng }
          : {}),
        checkIn: new Date(form.checkIn).toISOString(),
        checkOut: new Date(form.checkOut).toISOString(),
        confirmationNumber: form.confirmationNumber || undefined,
        bookingLink: form.bookingLink || undefined,
        notes: form.notes || undefined,
        isVacationRental: form.isVacationRental,
        price: form.price ? parseFloat(form.price) : undefined,
        roomCount: form.roomCount ? parseInt(form.roomCount, 10) : 1,
        roomType: form.roomType || undefined,
      })
      onSaved(updated as unknown as HotelRow)
      toast.success("Hotel updated")
    } catch {
      toast.error("Failed to update hotel")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-900">Edit stay</h4>
        <button onClick={onCancel} className="p-1.5" aria-label="Close editor">
          <X className="w-4 h-4 text-gray-400" />
        </button>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Name *</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Address</label>
        <PlacesAutocomplete
          value={form.address}
          onChange={(val) => setForm((f) => ({ ...f, address: val, lat: undefined, lng: undefined }))}
          onSelect={(place) => setForm((f) => ({ ...f, address: place.name, lat: place.lat, lng: place.lng }))}
          placeholder="Search for an address..."
          className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          apiKey={placesApiKey}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <DateTimeField
          label="Check-in"
          required
          value={form.checkIn}
          onChange={(v) => setForm((f) => ({ ...f, checkIn: v }))}
          defaultTime={DEFAULT_CHECK_IN_TIME}
          quickTimes={CHECK_IN_QUICK_TIMES}
        />
        <DateTimeField
          label="Check-out"
          required
          value={form.checkOut}
          onChange={(v) => setForm((f) => ({ ...f, checkOut: v }))}
          defaultTime={DEFAULT_CHECK_OUT_TIME}
          quickTimes={CHECK_OUT_QUICK_TIMES}
          min={form.checkIn ? form.checkIn.split("T")[0] : undefined}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Confirmation #</label>
          <input
            type="text"
            value={form.confirmationNumber}
            onChange={(e) => setForm((f) => ({ ...f, confirmationNumber: e.target.value }))}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Booking link</label>
          <input
            type="url"
            value={form.bookingLink}
            onChange={(e) => setForm((f) => ({ ...f, bookingLink: e.target.value }))}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Price per night ($)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.price}
            onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Number of rooms</label>
          <input
            type="number"
            min="1"
            value={form.roomCount}
            onChange={(e) => setForm((f) => ({ ...f, roomCount: e.target.value }))}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Room type</label>
          <input
            type="text"
            placeholder="2 Queen Beds"
            value={form.roomType}
            onChange={(e) => setForm((f) => ({ ...f, roomType: e.target.value }))}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Notes</label>
        <textarea
          rows={2}
          value={form.notes}
          placeholder="Parking, breakfast, late arrival instructions..."
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700 p-1">
        <input
          type="checkbox"
          checked={form.isVacationRental}
          onChange={(e) => setForm((f) => ({ ...f, isVacationRental: e.target.checked }))}
          className="rounded"
        />
        This is a vacation rental (Airbnb, VRBO, etc.)
      </label>

      <div className="flex gap-3 pt-1">
        <button
          onClick={onCancel}
          className="flex-1 py-2.5 border border-gray-200 text-gray-700 text-sm rounded-xl hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className={cn(
            "flex-1 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition-colors",
            saving && "opacity-50"
          )}
        >
          {saving ? "Saving..." : "Save changes"}
        </button>
      </div>
    </div>
  )
}
