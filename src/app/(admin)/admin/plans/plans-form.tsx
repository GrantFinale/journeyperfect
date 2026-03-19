"use client"

import { useState, useTransition } from "react"
import { updateAdminConfig } from "@/lib/actions/admin"

type PlanRow = {
  key: string
  name: string
  maxTrips: number
  maxTravelersPerTrip: number
  canShare: boolean
}

export function PlansForm({ plans: initialPlans }: { plans: PlanRow[] }) {
  const [plans, setPlans] = useState(initialPlans)
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)

  function updatePlan(index: number, field: keyof PlanRow, value: number | boolean) {
    setPlans((prev) => prev.map((p, i) => (i === index ? { ...p, [field]: value } : p)))
  }

  function handleSave() {
    startTransition(async () => {
      for (const plan of plans) {
        await updateAdminConfig(`plan.${plan.key}.maxTrips`, String(plan.maxTrips))
        await updateAdminConfig(`plan.${plan.key}.maxTravelersPerTrip`, String(plan.maxTravelersPerTrip))
        await updateAdminConfig(`plan.${plan.key}.canShare`, String(plan.canShare))
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    })
  }

  return (
    <div>
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-700">Plan</th>
              <th className="text-left px-4 py-3 font-medium text-gray-700">Max Trips</th>
              <th className="text-left px-4 py-3 font-medium text-gray-700">Max Travelers / Trip</th>
              <th className="text-left px-4 py-3 font-medium text-gray-700">Can Share</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((plan, i) => (
              <tr key={plan.key} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-3 font-medium text-gray-900">{plan.name}</td>
                <td className="px-4 py-3">
                  <input
                    type="number"
                    value={plan.maxTrips}
                    onChange={(e) => updatePlan(i, "maxTrips", Number(e.target.value))}
                    className="w-24 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </td>
                <td className="px-4 py-3">
                  <input
                    type="number"
                    value={plan.maxTravelersPerTrip}
                    onChange={(e) => updatePlan(i, "maxTravelersPerTrip", Number(e.target.value))}
                    className="w-24 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => updatePlan(i, "canShare", !plan.canShare)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      plan.canShare ? "bg-indigo-600" : "bg-gray-300"
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                        plan.canShare ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        onClick={handleSave}
        disabled={isPending}
        className="mt-4 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors"
      >
        {isPending ? "Saving..." : saved ? "Saved!" : "Save Changes"}
      </button>
    </div>
  )
}
