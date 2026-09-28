"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { generateDestinationProfileAdmin, seedOpportunityDataAdmin } from "@/lib/actions/opportunities"

type SeedResult = Awaited<ReturnType<typeof seedOpportunityDataAdmin>>
type ProfileResult = Awaited<ReturnType<typeof generateDestinationProfileAdmin>>

export function OpportunitiesAdminView() {
  const [seedResult, setSeedResult] = useState<SeedResult | null>(null)
  const [iata, setIata] = useState("")
  const [profileResult, setProfileResult] = useState<ProfileResult | null>(null)
  const [isSeeding, startSeeding] = useTransition()
  const [isGenerating, startGenerating] = useTransition()

  function seed() {
    startSeeding(async () => {
      try {
        const result = await seedOpportunityDataAdmin()
        setSeedResult(result)
        toast.success("Seed data loaded.")
      } catch {
        toast.error("Seeding failed.")
      }
    })
  }

  function generate() {
    const code = iata.trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(code)) {
      toast.error("Enter a three-letter IATA code.")
      return
    }
    startGenerating(async () => {
      try {
        const result = await generateDestinationProfileAdmin(code)
        setProfileResult(result)
        if (result.ok) toast.success(`${result.created ? "Created" : "Updated"} profile for ${result.iata}.`)
        else toast.error(result.error)
      } catch {
        toast.error("Profile generation failed.")
      }
    })
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h2 className="text-lg font-semibold text-gray-900">Seed data</h2>
        <p className="text-sm text-gray-500 mt-1">
          Upserts src/data/destination-profiles.json and src/data/nonstop-routes.json. Routes learned from live
          fares or a schedule API are never overwritten.
        </p>
        <button
          type="button"
          onClick={seed}
          disabled={isSeeding}
          className="mt-4 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
        >
          {isSeeding ? "Seeding…" : "Seed destination profiles + nonstop routes"}
        </button>
        {seedResult && (
          <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
              <dt className="text-gray-500">Routes created</dt>
              <dd className="font-semibold text-gray-900">{seedResult.routes.created}</dd>
            </div>
            <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
              <dt className="text-gray-500">Routes refreshed</dt>
              <dd className="font-semibold text-gray-900">{seedResult.routes.refreshed}</dd>
            </div>
            <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
              <dt className="text-gray-500">Routes skipped</dt>
              <dd className="font-semibold text-gray-900">{seedResult.routes.skipped}</dd>
            </div>
            <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
              <dt className="text-gray-500">Profiles upserted</dt>
              <dd className="font-semibold text-gray-900">{seedResult.profiles.upserted}</dd>
            </div>
          </dl>
        )}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h2 className="text-lg font-semibold text-gray-900">Generate a destination profile</h2>
        <p className="text-sm text-gray-500 mt-1">
          Uses the configured AI model to write a profile for one airport and stores it. Existing profiles are
          replaced.
        </p>
        <form
          className="mt-4 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            generate()
          }}
        >
          <input
            value={iata}
            onChange={(e) => setIata(e.target.value)}
            placeholder="IATA (e.g. LIS)"
            maxLength={3}
            className="w-36 px-3 py-2 rounded-lg border border-gray-300 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="submit"
            disabled={isGenerating}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {isGenerating ? "Generating…" : "Generate"}
          </button>
        </form>
        {profileResult && (
          <p className={`mt-3 text-sm ${profileResult.ok ? "text-green-700" : "text-red-700"}`}>
            {profileResult.ok
              ? `${profileResult.created ? "Created" : "Updated"} ${profileResult.iata} — ${profileResult.name} (${profileResult.model})`
              : profileResult.error}
          </p>
        )}
      </div>
    </div>
  )
}
