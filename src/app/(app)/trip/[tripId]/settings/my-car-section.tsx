"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Car, Plus, X, Copy, Check, CheckCircle2 } from "lucide-react"
import { createVehicle, setTripVehicle } from "@/lib/actions/vehicles"
import { cn } from "@/lib/utils"

export type SavedVehicle = {
  id: string
  make: string
  model: string
  year: number | null
  color: string | null
  licensePlate: string | null
  licensePlateState: string | null
  nickname: string | null
  isDefault: boolean
}

export function vehicleTitle(v: SavedVehicle): string {
  if (v.nickname) return v.nickname
  return [v.year, v.make, v.model].filter(Boolean).join(" ")
}

function vehicleSubtitle(v: SavedVehicle): string {
  const parts = [v.color, [v.year, v.make, v.model].filter(Boolean).join(" ")]
  return parts.filter(Boolean).join(" · ")
}

const inputCls =
  "w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"

interface Props {
  tripId: string
  vehicles: SavedVehicle[]
  selectedVehicleId: string | null
  onVehiclesChange: (vehicles: SavedVehicle[]) => void
  onSelectedChange: (vehicleId: string | null) => void
}

/**
 * "My car" — attach one of the user's saved vehicles to this trip. The licence
 * plate is the point of this feature (hotel parking forms ask for it), so it's
 * rendered large, monospaced, and one-tap copyable.
 */
export function MyCarSection({
  tripId,
  vehicles,
  selectedVehicleId,
  onVehiclesChange,
  onSelectedChange,
}: Props) {
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [copied, setCopied] = useState(false)
  const [form, setForm] = useState({
    make: "",
    model: "",
    year: "",
    color: "",
    licensePlate: "",
    licensePlateState: "",
    nickname: "",
  })

  const selected = vehicles.find((v) => v.id === selectedVehicleId) || null

  async function handleAssign(vehicleId: string | null) {
    setAssigning(true)
    try {
      await setTripVehicle(tripId, vehicleId)
      onSelectedChange(vehicleId)
      toast.success(vehicleId ? "Car attached to this trip" : "Car removed from this trip")
    } catch {
      toast.error("Failed to update trip vehicle")
    } finally {
      setAssigning(false)
    }
  }

  async function handleCreate() {
    if (!form.make.trim() || !form.model.trim()) {
      toast.error("Make and model are required")
      return
    }
    setSaving(true)
    try {
      const created = (await createVehicle({
        make: form.make.trim(),
        model: form.model.trim(),
        year: form.year ? parseInt(form.year, 10) : null,
        color: form.color || null,
        licensePlate: form.licensePlate ? form.licensePlate.toUpperCase() : null,
        licensePlateState: form.licensePlateState ? form.licensePlateState.toUpperCase() : null,
        nickname: form.nickname || null,
        isDefault: vehicles.length === 0,
      })) as unknown as SavedVehicle

      onVehiclesChange([...vehicles, created])
      // A car you just added is almost certainly the one you're driving.
      await setTripVehicle(tripId, created.id).catch(() => {})
      onSelectedChange(created.id)

      setForm({
        make: "",
        model: "",
        year: "",
        color: "",
        licensePlate: "",
        licensePlateState: "",
        nickname: "",
      })
      setShowAdd(false)
      toast.success("Car saved")
    } catch {
      toast.error("Failed to save car")
    } finally {
      setSaving(false)
    }
  }

  function copyPlate(plate: string) {
    navigator.clipboard.writeText(plate)
    setCopied(true)
    toast.success("Licence plate copied")
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-1">
        <Car className="w-4 h-4 text-gray-500" />
        <h3 className="font-semibold text-gray-900">My car</h3>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Driving your own car? Attach it so your plate is handy when a hotel asks for it at check-in.
      </p>

      {/* Currently attached vehicle */}
      {selected && (
        <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 mb-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 bg-white border border-gray-200 rounded-xl flex items-center justify-center shrink-0">
              <Car className="w-4 h-4 text-gray-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm text-gray-900 truncate">
                  {vehicleTitle(selected)}
                </span>
                <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" />
              </div>
              <div className="text-xs text-gray-500 truncate">{vehicleSubtitle(selected)}</div>

              {selected.licensePlate ? (
                <div className="flex items-center gap-2 mt-2">
                  <span className="font-mono text-base font-semibold tracking-wider text-gray-900">
                    {selected.licensePlate}
                  </span>
                  {selected.licensePlateState && (
                    <span className="text-xs text-gray-400">{selected.licensePlateState}</span>
                  )}
                  <button
                    onClick={() => copyPlate(selected.licensePlate as string)}
                    aria-label="Copy licence plate"
                    className="p-1.5 text-gray-400 hover:text-indigo-600 transition-colors"
                  >
                    {copied ? (
                      <Check className="w-3.5 h-3.5 text-green-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              ) : (
                <p className="text-xs text-amber-600 mt-2">
                  No licence plate saved — add one in Settings so it&apos;s ready at check-in.
                </p>
              )}
            </div>
            <button
              onClick={() => handleAssign(null)}
              disabled={assigning}
              className="text-xs text-gray-400 hover:text-red-500 transition-colors shrink-0 p-1"
            >
              Remove
            </button>
          </div>
        </div>
      )}

      {/* Picker */}
      {vehicles.length > 0 && (
        <div className="mb-3">
          <label className="block text-xs text-gray-500 mb-1">
            {selected ? "Change car" : "Use a saved car"}
          </label>
          <select
            value={selectedVehicleId || ""}
            disabled={assigning}
            onChange={(e) => handleAssign(e.target.value || null)}
            className={cn(inputCls, "bg-white")}
          >
            <option value="">Not driving my own car</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {vehicleTitle(v)}
                {v.licensePlate ? ` — ${v.licensePlate}` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {vehicles.length === 0 && !showAdd && (
        <p className="text-sm text-gray-500 mb-3">No saved cars yet.</p>
      )}

      {!showAdd ? (
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add a car
        </button>
      ) : (
        <div className="border-t border-gray-100 pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-gray-900">Add a car</h4>
            <button onClick={() => setShowAdd(false)} className="p-1.5" aria-label="Cancel">
              <X className="w-4 h-4 text-gray-400" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Make *</label>
              <input
                type="text"
                placeholder="Subaru"
                value={form.make}
                onChange={(e) => setForm((f) => ({ ...f, make: e.target.value }))}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Model *</label>
              <input
                type="text"
                placeholder="Outback"
                value={form.model}
                onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Year</label>
              <input
                type="number"
                placeholder="2022"
                min="1900"
                max="2100"
                value={form.year}
                onChange={(e) => setForm((f) => ({ ...f, year: e.target.value }))}
                className={inputCls}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Colour</label>
              <input
                type="text"
                placeholder="Silver"
                value={form.color}
                onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Licence plate</label>
              <input
                type="text"
                placeholder="ABC 1234"
                value={form.licensePlate}
                onChange={(e) => setForm((f) => ({ ...f, licensePlate: e.target.value }))}
                className={cn(inputCls, "font-mono uppercase")}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Plate state</label>
              <input
                type="text"
                placeholder="MI"
                maxLength={3}
                value={form.licensePlateState}
                onChange={(e) => setForm((f) => ({ ...f, licensePlateState: e.target.value }))}
                className={cn(inputCls, "uppercase")}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Nickname</label>
            <input
              type="text"
              placeholder="The Wagon"
              value={form.nickname}
              onChange={(e) => setForm((f) => ({ ...f, nickname: e.target.value }))}
              className={inputCls}
            />
          </div>

          <div className="flex gap-3 pt-1">
            <button
              onClick={() => setShowAdd(false)}
              className="flex-1 py-2.5 border border-gray-200 text-gray-700 text-sm rounded-xl hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={saving}
              className="flex-1 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving..." : "Save car"}
            </button>
          </div>
        </div>
      )}

      <p className="text-[11px] text-gray-400 mt-3">
        Saved cars are reusable across every trip —{" "}
        <a href="/settings" className="text-indigo-600 hover:text-indigo-700">
          manage them in Settings
        </a>
        .
      </p>
    </div>
  )
}
