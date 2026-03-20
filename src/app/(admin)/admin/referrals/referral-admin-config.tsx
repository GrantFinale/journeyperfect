"use client"

import { useState, useTransition } from "react"
import { updateAdminConfig } from "@/lib/actions/admin"
import { cn } from "@/lib/utils"

type ReferralStatus = "PENDING" | "SIGNED_UP" | "CONVERTED" | "REWARDED" | "EXPIRED"

interface Referral {
  id: string
  code: string
  status: ReferralStatus
  rewardGiven: boolean
  createdAt: string
  convertedAt: string | null
  referrerName: string
  refereeName: string | null
  refereePlan: string | null
}

interface Stats {
  total: number
  signedUp: number
  converted: number
  rewarded: number
}

interface Props {
  configMap: Record<string, string>
  referrals: Referral[]
  stats: Stats
}

const PLANS = ["FREE", "PERSONAL", "FAMILY", "PRO"]

const STATUS_STYLES: Record<ReferralStatus, { label: string; className: string }> = {
  PENDING: { label: "Pending", className: "bg-gray-100 text-gray-700" },
  SIGNED_UP: { label: "Signed Up", className: "bg-blue-100 text-blue-700" },
  CONVERTED: { label: "Converted", className: "bg-amber-100 text-amber-700" },
  REWARDED: { label: "Rewarded", className: "bg-green-100 text-green-700" },
  EXPIRED: { label: "Expired", className: "bg-red-100 text-red-700" },
}

export function ReferralAdminConfig({ configMap, referrals, stats }: Props) {
  const [isPending, startTransition] = useTransition()
  const [enabled, setEnabled] = useState(configMap["referral.enabled"] !== "false")
  const [reward, setReward] = useState(configMap["referral.reward"] || "PERSONAL")
  const [refereeReward, setRefereeReward] = useState(configMap["referral.refereeReward"] || "1_month_free")
  const [requiredPlan, setRequiredPlan] = useState(configMap["referral.requiredPlan"] || "PERSONAL")
  const [maxRewards, setMaxRewards] = useState(configMap["referral.maxRewardsPerUser"] || "10")

  function handleSave() {
    startTransition(async () => {
      await Promise.all([
        updateAdminConfig("referral.enabled", enabled ? "true" : "false"),
        updateAdminConfig("referral.reward", reward),
        updateAdminConfig("referral.refereeReward", refereeReward),
        updateAdminConfig("referral.requiredPlan", requiredPlan),
        updateAdminConfig("referral.maxRewardsPerUser", maxRewards),
      ])
    })
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total Referrals", value: stats.total },
          { label: "Signed Up", value: stats.signedUp },
          { label: "Converted", value: stats.converted },
          { label: "Rewards Given", value: stats.rewarded },
        ].map((s) => (
          <div
            key={s.label}
            className="bg-white rounded-lg border border-gray-200 p-4"
          >
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className="text-xs text-gray-500">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Config */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Configuration
        </h2>
        <div className="space-y-4">
          {/* Enabled toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">
                Referral Program Enabled
              </p>
              <p className="text-xs text-gray-500">
                When disabled, no new referrals can be created or applied
              </p>
            </div>
            <button
              onClick={() => setEnabled(!enabled)}
              className={cn(
                "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                enabled ? "bg-indigo-600" : "bg-gray-300"
              )}
            >
              <span
                className={cn(
                  "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                  enabled ? "translate-x-6" : "translate-x-1"
                )}
              />
            </button>
          </div>

          {/* Reward (plan upgrade for referrer) */}
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">
              Referrer Reward (plan upgrade)
            </label>
            <select
              value={reward}
              onChange={(e) => setReward(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              {PLANS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          {/* Referee reward */}
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">
              Referee Reward
            </label>
            <input
              type="text"
              value={refereeReward}
              onChange={(e) => setRefereeReward(e.target.value)}
              placeholder="e.g. 1_month_free"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <p className="text-xs text-gray-400 mt-1">
              Description of what the new user gets (for display)
            </p>
          </div>

          {/* Required plan */}
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">
              Minimum Plan for Conversion
            </label>
            <select
              value={requiredPlan}
              onChange={(e) => setRequiredPlan(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              {PLANS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">
              Referee must upgrade to at least this plan for the referral to
              count
            </p>
          </div>

          {/* Max rewards */}
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">
              Max Rewards Per User
            </label>
            <input
              type="number"
              value={maxRewards}
              onChange={(e) => setMaxRewards(e.target.value)}
              min="1"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          <button
            onClick={handleSave}
            disabled={isPending}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {isPending ? "Saving..." : "Save Configuration"}
          </button>
        </div>
      </div>

      {/* Referral list */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">
            All Referrals
          </h2>
        </div>
        {referrals.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-gray-500">
            No referrals yet
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left">
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                    Referrer
                  </th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                    Referee
                  </th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                    Code
                  </th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                    Status
                  </th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {referrals.map((r) => {
                  const style = STATUS_STYLES[r.status]
                  return (
                    <tr key={r.id}>
                      <td className="px-6 py-3 text-gray-900">
                        {r.referrerName}
                      </td>
                      <td className="px-6 py-3 text-gray-900">
                        {r.refereeName || (
                          <span className="text-gray-400">--</span>
                        )}
                      </td>
                      <td className="px-6 py-3 font-mono text-xs text-gray-600">
                        {r.code}
                      </td>
                      <td className="px-6 py-3">
                        <span
                          className={cn(
                            "text-xs font-medium px-2 py-0.5 rounded-full",
                            style.className
                          )}
                        >
                          {style.label}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-gray-500 text-xs">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
