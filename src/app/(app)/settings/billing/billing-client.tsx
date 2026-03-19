"use client"

import { useState } from "react"
import type { Plan } from "@/lib/plans"

export function BillingClient({ plan }: { plan: Plan }) {
  const [loading, setLoading] = useState(false)

  async function handleUpgrade(targetPlan: Exclude<Plan, "FREE">) {
    setLoading(true)
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: targetPlan }),
      })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleManageBilling() {
    setLoading(true)
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      }
    } finally {
      setLoading(false)
    }
  }

  if (plan === "FREE") {
    return (
      <div className="rounded-lg border p-6 space-y-4">
        <h2 className="text-lg font-semibold">Upgrade your plan</h2>
        <p className="text-sm text-muted-foreground">
          Unlock more trips, more travelers, and sharing capabilities.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => handleUpgrade("PERSONAL")}
            disabled={loading}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Upgrade to Personal
          </button>
          <button
            onClick={() => handleUpgrade("FAMILY")}
            disabled={loading}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Upgrade to Family
          </button>
          <button
            onClick={() => handleUpgrade("PRO")}
            disabled={loading}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Upgrade to Pro
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border p-6 space-y-4">
      <h2 className="text-lg font-semibold">Manage subscription</h2>
      <p className="text-sm text-muted-foreground">
        Update your payment method, change plans, or cancel your subscription.
      </p>
      <button
        onClick={handleManageBilling}
        disabled={loading}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        Manage Billing
      </button>
    </div>
  )
}
