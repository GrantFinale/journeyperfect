"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Plane, TrainFront, Ship, Bus, Clipboard, CheckCircle2 } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import {
  createTransportSegment,
  createTransportSegmentsBatch,
  parseAndPreviewTransport,
  type TransportModeValue,
} from "@/lib/actions/transport"
import PlacesAutocomplete from "@/components/places-autocomplete"
import { cn } from "@/lib/utils"

/** The four kinds of point-to-point leg the Travel tab can hold. */
export type LegType = "FLIGHT" | TransportModeValue

export const LEG_TYPES: { value: LegType; label: string; icon: LucideIcon }[] = [
  { value: "FLIGHT", label: "Flight", icon: Plane },
  { value: "TRAIN", label: "Train", icon: TrainFront },
  { value: "FERRY", label: "Ferry", icon: Ship },
  { value: "BUS", label: "Bus", icon: Bus },
]

export const MODE_ICONS: Record<TransportModeValue, LucideIcon> = {
  TRAIN: TrainFront,
  FERRY: Ship,
  BUS: Bus,
}

export const MODE_LABELS: Record<TransportModeValue, string> = {
  TRAIN: "Train",
  FERRY: "Ferry",
  BUS: "Bus",
}

/** Client-side shape of a persisted TransportSegment row. */
export type TransportSegmentRow = {
  id: string
  mode: TransportModeValue
  operator: string
  serviceNumber: string | null
  departureLocation: string
  departureTerminal: string | null
  departureTime: Date | string
  departureTimezone: string | null
  arrivalLocation: string | null
  arrivalTerminal: string | null
  arrivalTime: Date | string | null
  arrivalTimezone: string | null
  confirmationNumber: string | null
  seatInfo: string | null
  vehicleOnBoard: boolean
  passengerCount: number | null
  price: number | null
}

const OPERATOR_PLACEHOLDER: Record<TransportModeValue, string> = {
  TRAIN: "Amtrak",
  FERRY: "Lake Express",
  BUS: "Greyhound",
}

const SERVICE_LABEL: Record<TransportModeValue, string> = {
  TRAIN: "Train number",
  FERRY: "Sailing number",
  BUS: "Route number",
}

const SEAT_LABEL: Record<TransportModeValue, string> = {
  TRAIN: "Car & seat",
  FERRY: "Cabin / deck",
  BUS: "Seat",
}

/** Segmented Flight · Train · Ferry · Bus picker shown at the top of "Add leg". */
export function LegTypePicker({
  value,
  onChange,
}: {
  value: LegType
  onChange: (v: LegType) => void
}) {
  return (
    <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-4">
      {LEG_TYPES.map(({ value: v, label, icon: Icon }) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded-lg transition-colors",
            value === v ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          )}
        >
          <Icon className="w-3.5 h-3.5" />
          {label}
        </button>
      ))}
    </div>
  )
}

function emptyForm() {
  return {
    operator: "",
    serviceNumber: "",
    departureLocation: "",
    departureTerminal: "",
    departureLat: undefined as number | undefined,
    departureLng: undefined as number | undefined,
    departureTime: "",
    arrivalLocation: "",
    arrivalTerminal: "",
    arrivalLat: undefined as number | undefined,
    arrivalLng: undefined as number | undefined,
    arrivalTime: "",
    confirmationNumber: "",
    bookingLink: "",
    seatInfo: "",
    vehicleOnBoard: false,
    passengerCount: "",
    price: "",
    notes: "",
  }
}

interface TransportLegFormProps {
  tripId: string
  mode: TransportModeValue
  placesApiKey?: string
  onCreated: (segments: TransportSegmentRow[]) => void
  onCancel: () => void
}

/**
 * Shared add-a-leg form for ferry / train / bus, plus the paste-a-confirmation
 * box. Mirrors the flight paste-parse UX (preview → confirm) exactly.
 */
export function TransportLegForm({
  tripId,
  mode,
  placesApiKey,
  onCreated,
  onCancel,
}: TransportLegFormProps) {
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  // Paste & parse
  const [pasteText, setPasteText] = useState("")
  const [parsing, setParsing] = useState(false)
  const [addingBatch, setAddingBatch] = useState(false)
  const [parsed, setParsed] = useState<
    Awaited<ReturnType<typeof parseAndPreviewTransport>>["segments"]
  >([])

  const ModeIcon = MODE_ICONS[mode]
  const modeLabel = MODE_LABELS[mode]

  async function handleParse() {
    if (!pasteText.trim()) return
    setParsing(true)
    try {
      const result = await parseAndPreviewTransport(pasteText)
      if (result && result.segments.length > 0) {
        setParsed(result.segments)
        // Prefill the manual form from the first segment as a fallback.
        const s = result.segments[0]
        setForm((f) => ({
          ...f,
          operator: s.operator || "",
          serviceNumber: s.serviceNumber || "",
          departureLocation: s.departureLocation || "",
          departureTerminal: s.departureTerminal || "",
          departureLat: s.departureLat ?? undefined,
          departureLng: s.departureLng ?? undefined,
          departureTime: s.departureTime ? new Date(s.departureTime).toISOString().slice(0, 16) : "",
          arrivalLocation: s.arrivalLocation || "",
          arrivalTerminal: s.arrivalTerminal || "",
          arrivalLat: s.arrivalLat ?? undefined,
          arrivalLng: s.arrivalLng ?? undefined,
          arrivalTime: s.arrivalTime ? new Date(s.arrivalTime).toISOString().slice(0, 16) : "",
          confirmationNumber: s.confirmationNumber || "",
          bookingLink: s.bookingLink || "",
          seatInfo: s.seatInfo || "",
          vehicleOnBoard: s.vehicleOnBoard ?? false,
          passengerCount: s.passengerCount != null ? String(s.passengerCount) : "",
          price: s.price != null ? String(s.price) : "",
          notes: s.notes || "",
        }))
        toast.success(`Found ${result.segments.length} leg(s)!`)
      } else {
        setParsed([])
        toast.error("Could not parse that -- fill in manually below")
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ""
      if (msg.includes("UPGRADE_REQUIRED")) {
        toast.error(msg.split(":").slice(1).join(":"))
      } else if (msg.includes("PARSE_FAILED")) {
        toast.error(msg.split(":").slice(1).join(":"))
      } else {
        toast.error("Failed to parse -- check API configuration in admin")
      }
    } finally {
      setParsing(false)
    }
  }

  async function handleAddAllParsed() {
    if (parsed.length === 0) return
    setAddingBatch(true)
    try {
      const batch = parsed
        .filter((s) => s.departureTime)
        .map((s) => ({
          ...s,
          mode: s.mode || mode,
          departureTime: new Date(s.departureTime as string).toISOString(),
          arrivalTime: s.arrivalTime ? new Date(s.arrivalTime).toISOString() : null,
        }))
      if (batch.length === 0) {
        toast.error("Parsed legs are missing a departure time")
        return
      }
      const created = await createTransportSegmentsBatch(tripId, batch)
      onCreated(created as unknown as TransportSegmentRow[])
      setParsed([])
      setPasteText("")
      toast.success(`Added ${batch.length} leg(s)!`)
    } catch {
      toast.error("Failed to add legs")
    } finally {
      setAddingBatch(false)
    }
  }

  async function handleAdd() {
    if (!form.operator.trim()) {
      toast.error("Operator is required")
      return
    }
    if (!form.departureLocation.trim()) {
      toast.error("Departure location is required")
      return
    }
    if (!form.departureTime) {
      toast.error("Departure time is required")
      return
    }
    setSaving(true)
    try {
      const created = await createTransportSegment(tripId, {
        mode,
        operator: form.operator.trim(),
        serviceNumber: form.serviceNumber || null,
        departureLocation: form.departureLocation.trim(),
        departureTerminal: form.departureTerminal || null,
        departureLat: form.departureLat ?? null,
        departureLng: form.departureLng ?? null,
        departureTime: new Date(form.departureTime).toISOString(),
        arrivalLocation: form.arrivalLocation || null,
        arrivalTerminal: form.arrivalTerminal || null,
        arrivalLat: form.arrivalLat ?? null,
        arrivalLng: form.arrivalLng ?? null,
        arrivalTime: form.arrivalTime ? new Date(form.arrivalTime).toISOString() : null,
        confirmationNumber: form.confirmationNumber || null,
        bookingLink: form.bookingLink || null,
        seatInfo: form.seatInfo || null,
        vehicleOnBoard: form.vehicleOnBoard,
        passengerCount: form.passengerCount ? parseInt(form.passengerCount, 10) : null,
        price: form.price ? parseFloat(form.price) : null,
        notes: form.notes || null,
      })
      onCreated([created as unknown as TransportSegmentRow])
      setForm(emptyForm())
      toast.success(`${modeLabel} added!`)
    } catch {
      toast.error(`Failed to add ${modeLabel.toLowerCase()}`)
    } finally {
      setSaving(false)
    }
  }

  const inputCls =
    "w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"

  return (
    <div>
      {/* Paste & parse */}
      <div className="mb-4">
        <label className="block text-xs font-medium text-gray-500 mb-1.5">
          Paste confirmation email (optional -- auto-parses)
        </label>
        <textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          rows={4}
          placeholder={`Paste your ${modeLabel.toLowerCase()} confirmation email here...`}
          className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none font-mono text-xs"
        />
        <button
          onClick={handleParse}
          disabled={parsing || !pasteText.trim()}
          className="mt-2 flex items-center gap-2 px-3 py-2 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
        >
          <Clipboard className="w-3.5 h-3.5" />
          {parsing ? "Parsing..." : "Parse booking info"}
        </button>
      </div>

      {/* Parsed preview */}
      {parsed.length > 0 && (
        <div className="mb-4 bg-gray-50 border border-gray-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <span className="text-sm font-medium text-gray-900">
              Found {parsed.length} leg{parsed.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="space-y-2 mb-4">
            {parsed.map((s, i) => {
              const Icon = MODE_ICONS[s.mode] ?? ModeIcon
              return (
                <div
                  key={i}
                  className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-100 rounded-xl flex-wrap"
                >
                  <Icon className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
                  <span className="text-sm text-gray-900 font-medium">
                    {s.operator || MODE_LABELS[s.mode] || modeLabel}
                    {s.serviceNumber ? ` ${s.serviceNumber}` : ""}
                  </span>
                  <span className="text-sm text-gray-500">
                    {s.departureLocation || "???"} &rarr; {s.arrivalLocation || "???"}
                  </span>
                  {s.departureTime && (
                    <span className="text-xs text-gray-400 sm:ml-auto">
                      {new Date(s.departureTime).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                      ,{" "}
                      {new Date(s.departureTime).toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setParsed([])
                setPasteText("")
              }}
              className="flex-1 py-2.5 border border-gray-200 text-gray-700 text-sm rounded-xl hover:bg-gray-50"
            >
              Discard
            </button>
            <button
              onClick={handleAddAllParsed}
              disabled={addingBatch}
              className="flex-1 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {addingBatch
                ? "Adding..."
                : `Add ${parsed.length === 1 ? "leg" : `all ${parsed.length} legs`}`}
            </button>
          </div>
          <div className="flex items-center gap-3 mt-3">
            <div className="flex-1 border-t border-gray-200" />
            <span className="text-xs text-gray-400">or edit individually below</span>
            <div className="flex-1 border-t border-gray-200" />
          </div>
        </div>
      )}

      {/* Manual form */}
      <div className="border-t border-gray-100 pt-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Operator *</label>
            <input
              type="text"
              placeholder={OPERATOR_PLACEHOLDER[mode]}
              value={form.operator}
              onChange={(e) => setForm((f) => ({ ...f, operator: e.target.value }))}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">{SERVICE_LABEL[mode]}</label>
            <input
              type="text"
              placeholder="350"
              value={form.serviceNumber}
              onChange={(e) => setForm((f) => ({ ...f, serviceNumber: e.target.value }))}
              className={inputCls}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">From *</label>
            <PlacesAutocomplete
              value={form.departureLocation}
              onChange={(val) =>
                setForm((f) => ({
                  ...f,
                  departureLocation: val,
                  departureLat: undefined,
                  departureLng: undefined,
                }))
              }
              onSelect={(place) =>
                setForm((f) => ({
                  ...f,
                  departureLocation: place.name,
                  departureLat: place.lat,
                  departureLng: place.lng,
                }))
              }
              placeholder="Muskegon, MI"
              className={inputCls}
              apiKey={placesApiKey}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Departure terminal</label>
            <input
              type="text"
              placeholder="Lake Express Terminal"
              value={form.departureTerminal}
              onChange={(e) => setForm((f) => ({ ...f, departureTerminal: e.target.value }))}
              className={inputCls}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">To</label>
            <PlacesAutocomplete
              value={form.arrivalLocation}
              onChange={(val) =>
                setForm((f) => ({
                  ...f,
                  arrivalLocation: val,
                  arrivalLat: undefined,
                  arrivalLng: undefined,
                }))
              }
              onSelect={(place) =>
                setForm((f) => ({
                  ...f,
                  arrivalLocation: place.name,
                  arrivalLat: place.lat,
                  arrivalLng: place.lng,
                }))
              }
              placeholder="Milwaukee, WI"
              className={inputCls}
              apiKey={placesApiKey}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Arrival terminal</label>
            <input
              type="text"
              placeholder="Milwaukee Terminal"
              value={form.arrivalTerminal}
              onChange={(e) => setForm((f) => ({ ...f, arrivalTerminal: e.target.value }))}
              className={inputCls}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Departure *</label>
            <input
              type="datetime-local"
              value={form.departureTime}
              onChange={(e) => setForm((f) => ({ ...f, departureTime: e.target.value }))}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Arrival</label>
            <input
              type="datetime-local"
              value={form.arrivalTime}
              onChange={(e) => setForm((f) => ({ ...f, arrivalTime: e.target.value }))}
              className={inputCls}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Confirmation #</label>
            <input
              type="text"
              placeholder="ABC123"
              value={form.confirmationNumber}
              onChange={(e) => setForm((f) => ({ ...f, confirmationNumber: e.target.value }))}
              className={cn(inputCls, "font-mono")}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">{SEAT_LABEL[mode]}</label>
            <input
              type="text"
              placeholder="Car 5, Seat 12A"
              value={form.seatInfo}
              onChange={(e) => setForm((f) => ({ ...f, seatInfo: e.target.value }))}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Passengers</label>
            <input
              type="number"
              min="1"
              placeholder="2"
              value={form.passengerCount}
              onChange={(e) => setForm((f) => ({ ...f, passengerCount: e.target.value }))}
              className={inputCls}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Price (total $)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={form.price}
              onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Booking link</label>
            <input
              type="url"
              placeholder="https://..."
              value={form.bookingLink}
              onChange={(e) => setForm((f) => ({ ...f, bookingLink: e.target.value }))}
              className={inputCls}
            />
          </div>
        </div>

        {mode === "FERRY" && (
          <label className="flex items-center gap-2 text-sm text-gray-700 p-1">
            <input
              type="checkbox"
              checked={form.vehicleOnBoard}
              onChange={(e) => setForm((f) => ({ ...f, vehicleOnBoard: e.target.checked }))}
              className="rounded"
            />
            I&apos;m bringing a vehicle aboard
          </label>
        )}

        <div>
          <label className="block text-xs text-gray-500 mb-1">Notes</label>
          <textarea
            rows={2}
            value={form.notes}
            placeholder="Boarding instructions, baggage rules..."
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
          />
        </div>

        <div className="flex gap-3 pt-1">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 border border-gray-200 text-gray-700 text-sm rounded-xl hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={saving}
            className="flex-1 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {saving ? "Adding..." : `Add ${modeLabel.toLowerCase()}`}
          </button>
        </div>
      </div>
    </div>
  )
}

interface TransportTileProps {
  segment: TransportSegmentRow
  onDelete: (segmentId: string) => void
}

/** Read-only tile for a saved ferry / train / bus leg in the Travel list. */
export function TransportTile({ segment, onDelete }: TransportTileProps) {
  const Icon = MODE_ICONS[segment.mode] ?? TrainFront
  const dep = new Date(segment.departureTime)
  const arr = segment.arrivalTime ? new Date(segment.arrivalTime) : null

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 group">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 bg-teal-50 rounded-xl flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-teal-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm text-gray-900 truncate">
            {segment.operator}
            {segment.serviceNumber ? ` ${segment.serviceNumber}` : ""} ·{" "}
            {segment.departureLocation} &rarr; {segment.arrivalLocation || "?"}
          </div>
          <div className="text-xs text-gray-500 truncate">
            {dep.toLocaleDateString("en-US", { month: "short", day: "numeric" })},{" "}
            {dep.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            {arr && (
              <>
                {" → "}
                {arr.toLocaleDateString("en-US", { month: "short", day: "numeric" })},{" "}
                {arr.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
              </>
            )}
            {segment.confirmationNumber && ` · ${segment.confirmationNumber}`}
            {segment.seatInfo && ` · ${segment.seatInfo}`}
            {segment.vehicleOnBoard && " · \u{1F697} vehicle aboard"}
          </div>
        </div>
        <button
          onClick={() => onDelete(segment.id)}
          aria-label="Delete leg"
          className="p-2 text-gray-400 hover:text-red-500 transition-colors sm:opacity-0 sm:group-hover:opacity-100"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </button>
      </div>
    </div>
  )
}
