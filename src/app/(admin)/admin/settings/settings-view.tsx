"use client"

import { useState, useTransition } from "react"
import { updateAdminConfig, deleteAdminConfig } from "@/lib/actions/admin"

type Config = { key: string; value: string }

/** Serialised from CONFIG_KEYS on the server (see page.tsx). */
export type KnownConfigKey = { key: string; default: string; group: string; desc: string; secret: boolean }

const GROUP_LABELS: Record<string, string> = {
  flights: "Flights",
  api: "External API credentials",
  opportunities: "Opportunity Discovery",
  privateRates: "Private Rates (Hilton Go)",
  ai: "AI models",
}

export function SettingsView({
  configs: initialConfigs,
  knownKeys = [],
}: {
  configs: Config[]
  knownKeys?: KnownConfigKey[]
}) {
  const [configs, setConfigs] = useState(initialConfigs)
  const [newKey, setNewKey] = useState("")
  const [newValue, setNewValue] = useState("")
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editValue, setEditValue] = useState("")
  const [isPending, startTransition] = useTransition()

  function handleAdd() {
    if (!newKey.trim()) return
    startTransition(async () => {
      await updateAdminConfig(newKey.trim(), newValue)
      setConfigs((prev) => [...prev.filter((c) => c.key !== newKey.trim()), { key: newKey.trim(), value: newValue }])
      setNewKey("")
      setNewValue("")
    })
  }

  function handleDelete(key: string) {
    startTransition(async () => {
      await deleteAdminConfig(key)
      setConfigs((prev) => prev.filter((c) => c.key !== key))
    })
  }

  function handleStartEdit(config: Config) {
    setEditingKey(config.key)
    setEditValue(config.value)
  }

  function handleSaveEdit(key: string) {
    startTransition(async () => {
      await updateAdminConfig(key, editValue)
      setConfigs((prev) => prev.map((c) => (c.key === key ? { ...c, value: editValue } : c)))
      setEditingKey(null)
    })
  }

  const AFFILIATE_KEYS = [
    { key: "affiliate.booking.id", desc: "Booking.com affiliate ID (aid parameter)", example: "123456" },
    { key: "affiliate.rentalcars.id", desc: "RentalCars.com affiliate code", example: "abc123" },
    { key: "affiliate.viator.pid", desc: "Viator partner ID (pid parameter)", example: "P00012345" },
    { key: "affiliate.getyourguide.id", desc: "GetYourGuide partner ID", example: "ABCDEF" },
    { key: "affiliate.safetywing.id", desc: "SafetyWing referral ID", example: "journeyperfect" },
    { key: "affiliate.amazon.tag", desc: "Amazon Associates tag", example: "journeyperfect-20" },
  ]

  function handleQuickAdd(key: string, defaultValue = "") {
    setNewKey(key)
    setNewValue(defaultValue)
  }

  const knownGroups = Array.from(new Set(knownKeys.map((k) => k.group)))

  return (
    <div className="space-y-6">
      {/* Known runtime keys: flights + opportunities plans */}
      {knownKeys.length > 0 && (
        <div className="bg-slate-50 rounded-lg border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-1">Known keys</h2>
          <p className="text-xs text-slate-600 mb-3">
            Runtime keys read by the flights, opportunity discovery and private-rates features. An unset key uses the
            default shown. Changes take effect within a minute, no deploy needed.
          </p>
          <div className="space-y-4">
            {knownGroups.map((group) => (
              <div key={group}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
                  {GROUP_LABELS[group] ?? group}
                </h3>
                <div className="space-y-1.5">
                  {knownKeys
                    .filter((k) => k.group === group)
                    .map((k) => {
                      const current = configs.find((c) => c.key === k.key)
                      const isSet = current !== undefined
                      return (
                        <div key={k.key} className="flex items-start gap-2 text-xs">
                          <span className={`mt-1 w-2 h-2 shrink-0 rounded-full ${isSet ? "bg-green-500" : "bg-gray-300"}`} />
                          <code className="font-mono text-slate-800 bg-slate-200/70 px-1.5 py-0.5 rounded shrink-0">{k.key}</code>
                          <span className="text-slate-600 flex-1">
                            {k.desc}{" "}
                            <span className="text-slate-400">
                              default: <code className="font-mono">{k.default === "" ? '""' : k.default}</code>
                            </span>
                          </span>
                          {isSet ? (
                            <span className="ml-auto shrink-0 text-green-700 font-medium">
                              {k.secret ? "Configured" : `= ${current.value}`}
                            </span>
                          ) : (
                            <button
                              onClick={() => handleQuickAdd(k.key, k.secret ? "" : k.default)}
                              className="ml-auto shrink-0 text-slate-700 hover:text-slate-900 font-medium"
                            >
                              + Add
                            </button>
                          )}
                        </div>
                      )
                    })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Affiliate config reference */}
      <div className="bg-indigo-50 rounded-lg border border-indigo-100 p-5">
        <h2 className="text-sm font-semibold text-indigo-900 mb-1">Affiliate Link Configuration</h2>
        <p className="text-xs text-indigo-700 mb-3">
          Set these keys to enable affiliate commission links throughout the app. Links appear on trip dashboards, activity cards, and hotel listings.
        </p>
        <div className="space-y-1.5">
          {AFFILIATE_KEYS.map((ak) => {
            const isSet = configs.some((c) => c.key === ak.key)
            return (
              <div key={ak.key} className="flex items-center gap-2 text-xs">
                <span className={`w-2 h-2 rounded-full ${isSet ? "bg-green-500" : "bg-gray-300"}`} />
                <code className="font-mono text-indigo-800 bg-indigo-100 px-1.5 py-0.5 rounded">{ak.key}</code>
                <span className="text-indigo-600">{ak.desc}</span>
                {!isSet && (
                  <button
                    onClick={() => handleQuickAdd(ak.key)}
                    className="ml-auto text-indigo-600 hover:text-indigo-800 font-medium"
                  >
                    + Add
                  </button>
                )}
                {isSet && (
                  <span className="ml-auto text-green-700 font-medium">Configured</span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Add new setting */}
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h2 className="text-sm font-medium text-gray-700 mb-3">Add Setting</h2>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Key (e.g., feature.darkMode)"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
          <input
            type="text"
            placeholder="Value"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
          <button
            onClick={handleAdd}
            disabled={isPending || !newKey.trim()}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            Add
          </button>
        </div>
      </div>

      {/* Settings table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-700">Key</th>
              <th className="text-left px-4 py-3 font-medium text-gray-700">Value</th>
              <th className="text-right px-4 py-3 font-medium text-gray-700">Actions</th>
            </tr>
          </thead>
          <tbody>
            {configs.map((config) => (
              <tr key={config.key} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-3 font-mono text-xs text-gray-900">{config.key}</td>
                <td className="px-4 py-3">
                  {editingKey === config.key ? (
                    <input
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSaveEdit(config.key)}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      autoFocus
                    />
                  ) : (
                    <span className="text-gray-600">{config.value}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    {editingKey === config.key ? (
                      <>
                        <button
                          onClick={() => handleSaveEdit(config.key)}
                          disabled={isPending}
                          className="text-xs text-green-600 hover:text-green-800 disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingKey(null)}
                          className="text-xs text-gray-500 hover:text-gray-700"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => handleStartEdit(config)}
                          className="text-xs text-indigo-600 hover:text-indigo-800"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(config.key)}
                          disabled={isPending}
                          className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {configs.length === 0 && (
          <p className="text-center py-8 text-gray-500 text-sm">No settings configured yet</p>
        )}
      </div>
    </div>
  )
}
