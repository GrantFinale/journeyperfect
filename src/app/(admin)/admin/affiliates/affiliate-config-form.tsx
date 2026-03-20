"use client"

import { useState } from "react"
import { updateAdminConfig, deleteAdminConfig } from "@/lib/actions/admin"
import { ExternalLink, Check, Trash2 } from "lucide-react"

interface Program {
  key: string
  name: string
  description: string
  signupUrl: string
  icon: string
  currentValue: string
  isConfigured: boolean
}

export function AffiliateConfigForm({ programs }: { programs: Program[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {programs.map(program => (
        <AffiliateCard key={program.key} program={program} />
      ))}
    </div>
  )
}

function AffiliateCard({ program }: { program: Program }) {
  const [value, setValue] = useState(program.currentValue)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      if (value.trim()) {
        await updateAdminConfig(program.key, value.trim())
      } else {
        await deleteAdminConfig(program.key)
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  const isChanged = value !== program.currentValue
  const isActive = !!value.trim()

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{program.icon}</span>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-gray-900">{program.name}</h3>
              <span className={`w-2 h-2 rounded-full ${isActive ? "bg-green-500" : "bg-gray-300"}`} />
            </div>
            <p className="text-xs text-gray-500">{program.description}</p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            {program.key.includes("tag") ? "Associate Tag" : program.key.includes("pid") ? "Partner ID" : "Affiliate ID"}
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={`Enter your ${program.name} ID...`}
              className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
            {value.trim() && (
              <button
                onClick={() => setValue("")}
                className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                title="Clear"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <a
            href={program.signupUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800"
          >
            Sign up for program
            <ExternalLink className="w-3 h-3" />
          </a>

          <button
            onClick={handleSave}
            disabled={!isChanged || saving}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              saved
                ? "bg-green-100 text-green-700"
                : isChanged
                  ? "bg-indigo-600 text-white hover:bg-indigo-700"
                  : "bg-gray-100 text-gray-400 cursor-not-allowed"
            }`}
          >
            {saved ? (
              <span className="flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Saved</span>
            ) : saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  )
}
