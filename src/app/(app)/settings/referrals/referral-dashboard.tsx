"use client"

import { useState } from "react"
import { Copy, Check, Share2, Gift, Users, TrendingUp, Award } from "lucide-react"
import { cn } from "@/lib/utils"

type ReferralStatus = "PENDING" | "SIGNED_UP" | "CONVERTED" | "REWARDED" | "EXPIRED"

interface Referral {
  id: string
  code: string
  status: ReferralStatus
  rewardGiven: boolean
  createdAt: string | Date
  convertedAt: string | Date | null
  referee: { name: string | null; email: string; plan: string } | null
}

interface Stats {
  total: number
  signedUp: number
  converted: number
  rewarded: number
}

interface Config {
  enabled: boolean
  rewardDescription: string
  maxRewards: number
}

interface Props {
  code: string
  referrals: Referral[]
  stats: Stats
  config: Config
}

const STATUS_STYLES: Record<ReferralStatus, { label: string; className: string }> = {
  PENDING: { label: "Pending", className: "bg-gray-100 text-gray-700" },
  SIGNED_UP: { label: "Signed Up", className: "bg-blue-100 text-blue-700" },
  CONVERTED: { label: "Converted", className: "bg-amber-100 text-amber-700" },
  REWARDED: { label: "Rewarded", className: "bg-green-100 text-green-700" },
  EXPIRED: { label: "Expired", className: "bg-red-100 text-red-700" },
}

const PLAN_LABELS: Record<string, string> = {
  FREE: "Free",
  PERSONAL: "Personal",
  FAMILY: "Family",
  PRO: "Pro",
}

export function ReferralDashboard({ code, referrals, stats, config }: Props) {
  const [copied, setCopied] = useState<"code" | "link" | null>(null)
  const referralLink = `https://journeyperfect.com/login?ref=${code}`

  if (!config.enabled) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-8 text-center">
        <Gift className="w-10 h-10 text-gray-400 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-gray-700 mb-1">
          Referral Program Paused
        </h2>
        <p className="text-sm text-gray-500">
          The referral program is currently not active. Check back soon!
        </p>
      </div>
    )
  }

  async function copyToClipboard(text: string, type: "code" | "link") {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(type)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      // fallback
    }
  }

  async function handleShare() {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Join JourneyPerfect",
          text: `Use my referral code ${code} to sign up for JourneyPerfect and we both get rewarded!`,
          url: referralLink,
        })
      } catch {
        // user cancelled
      }
    } else {
      copyToClipboard(referralLink, "link")
    }
  }

  return (
    <div className="space-y-6">
      {/* Referral code card */}
      <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-purple-50 p-6">
        <p className="text-xs font-medium text-indigo-600 uppercase tracking-wide mb-2">
          Your Referral Code
        </p>
        <div className="flex items-center gap-3 mb-4">
          <span className="text-3xl font-bold tracking-widest text-gray-900">
            {code}
          </span>
          <button
            onClick={() => copyToClipboard(code, "code")}
            className="p-2 rounded-lg hover:bg-indigo-100 transition-colors"
            title="Copy code"
          >
            {copied === "code" ? (
              <Check className="w-5 h-5 text-green-600" />
            ) : (
              <Copy className="w-5 h-5 text-indigo-600" />
            )}
          </button>
        </div>

        <div className="flex items-center gap-2 text-sm text-gray-600 bg-white/70 rounded-lg px-3 py-2 mb-4">
          <span className="truncate flex-1">{referralLink}</span>
          <button
            onClick={() => copyToClipboard(referralLink, "link")}
            className="text-indigo-600 hover:text-indigo-800 shrink-0"
          >
            {copied === "link" ? (
              <Check className="w-4 h-4 text-green-600" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
          </button>
        </div>

        <button
          onClick={handleShare}
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
        >
          <Share2 className="w-4 h-4" />
          Share with Friends
        </button>
      </div>

      {/* How it works */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">How it works</h3>
        <ol className="space-y-2 text-sm text-gray-600">
          <li className="flex gap-2">
            <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center shrink-0">
              1
            </span>
            Share your referral code or link with friends
          </li>
          <li className="flex gap-2">
            <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center shrink-0">
              2
            </span>
            They sign up using your link
          </li>
          <li className="flex gap-2">
            <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center shrink-0">
              3
            </span>
            When they upgrade to {PLAN_LABELS[config.rewardDescription] || config.rewardDescription} or higher, you get a {PLAN_LABELS[config.rewardDescription] || config.rewardDescription} plan upgrade
          </li>
        </ol>
        <p className="text-xs text-gray-400 mt-3">
          You can earn up to {config.maxRewards} referral rewards.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Shared", value: stats.total, icon: Users, color: "text-gray-600" },
          { label: "Signed Up", value: stats.signedUp, icon: TrendingUp, color: "text-blue-600" },
          { label: "Converted", value: stats.converted, icon: Gift, color: "text-amber-600" },
          { label: "Rewards", value: stats.rewarded, icon: Award, color: "text-green-600" },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-gray-200 bg-white p-4 text-center"
          >
            <s.icon className={cn("w-5 h-5 mx-auto mb-1", s.color)} />
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className="text-xs text-gray-500">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Referral list */}
      {referrals.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">Your Referrals</h3>
          </div>
          <div className="divide-y divide-gray-100">
            {referrals.map((r) => {
              const style = STATUS_STYLES[r.status]
              return (
                <div key={r.id} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {r.referee?.name || r.referee?.email || "Pending signup"}
                    </p>
                    <p className="text-xs text-gray-500">
                      {new Date(r.createdAt).toLocaleDateString()}
                      {r.referee?.plan && (
                        <span className="ml-2">
                          Plan: {PLAN_LABELS[r.referee.plan] || r.referee.plan}
                        </span>
                      )}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "text-xs font-medium px-2.5 py-0.5 rounded-full",
                      style.className
                    )}
                  >
                    {style.label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
