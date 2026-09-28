"use client"

/**
 * "Check my Hilton Go rates" — the one explicit user action that runs a
 * private-rate search (docs/plans/opportunity-discovery-engine.md §6.1 rule 3).
 *
 * Renders nothing unless the feature is enabled AND the user is entitled, so
 * it never appears for anyone else. It never polls or auto-runs; every check is
 * a click. Statuses come back typed and are explained in plain words.
 */

import { useEffect, useState, useTransition } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { checkPrivateRatesForSearch, getPrivateRateStatus } from "@/lib/actions/private-rates"

type Status = Awaited<ReturnType<typeof getPrivateRateStatus>>
type CheckResult = Awaited<ReturnType<typeof checkPrivateRatesForSearch>>

/** Bot protection refused the runner's browser (challengeKind BLOCKED). Signing in again will not help. */
export const BLOCKED_MESSAGE =
  "Hilton's site blocked the automated browser before the sign-in page loaded. Nothing was retrieved. This isn't something you can fix by signing in again."

export function explainCheckResult(result: CheckResult): { kind: "success" | "warning" | "error"; message: string } {
  const n = result.quotesWritten
  if (result.challengeKind === "BLOCKED") {
    if (result.status === "CHALLENGE") return { kind: "error", message: BLOCKED_MESSAGE }
    if (result.status === "PARTIAL") {
      return {
        kind: "warning",
        message: `Some rates were retrieved (${n}). Then Hilton's site blocked the automated browser, so the rest were not retrieved. This isn't something you can fix by signing in again.`,
      }
    }
  }
  switch (result.status) {
    case "OK":
      return { kind: "success", message: n > 0 ? `Hilton rates retrieved for ${n} ${n === 1 ? "listing" : "listings"}.` : "Nothing to price yet for this search." }
    case "PARTIAL":
      return {
        kind: "warning",
        message: `Some rates were retrieved (${n}). Hilton interrupted the rest, so sign in again from Settings and check once more for the remaining properties.`,
      }
    case "CHALLENGE":
      return { kind: "warning", message: "Hilton wants you to sign in again. Nothing was retrieved for the remaining properties." }
    case "SIGNED_OUT":
      return { kind: "warning", message: "Your Hilton session has signed out. Reconnect from Settings and try again." }
    case "NO_SESSION":
      return { kind: "warning", message: "Connect your Hilton account in Settings first." }
    case "LIMIT":
      return { kind: "warning", message: "You have reached today's limit for rate checks. Try again tomorrow." }
    case "DISABLED":
      return { kind: "error", message: "Private rates are turned off right now." }
    case "NOT_ENTITLED":
      return { kind: "error", message: "Private rates are not available on your account." }
    case "RUNNER_UNAVAILABLE":
      return { kind: "error", message: "The secure browser is not available right now. Nothing was retrieved." }
  }
}

export function CheckPrivateRatesButton({ searchId, onDone }: { searchId: string; onDone?: (result: CheckResult) => void }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    let cancelled = false
    getPrivateRateStatus()
      .then((s) => {
        if (!cancelled) setStatus(s)
      })
      .catch(() => {
        if (!cancelled) setStatus(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Hidden unless enabled AND entitled (§6.1 rule 5).
  if (!status || !status.enabled || !status.entitled) return null

  if (status.session?.status !== "ACTIVE") {
    return (
      <Link
        href="/settings/private-rates"
        className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        Connect Hilton to check Go rates
      </Link>
    )
  }

  function handleClick() {
    startTransition(async () => {
      let result: CheckResult
      try {
        result = await checkPrivateRatesForSearch(searchId)
      } catch {
        toast.error("Something went wrong while checking rates. Nothing was retrieved.")
        return
      }
      const { kind, message } = explainCheckResult(result)
      if (kind === "success") toast.success(message)
      else if (kind === "warning") toast.warning(message)
      else toast.error(message)
      onDone?.(result)
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending || status.checksRemainingToday <= 0}
      title={status.checksRemainingToday <= 0 ? "You have reached today's limit for rate checks." : undefined}
      className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {isPending ? "Checking Hilton…" : "Check my Hilton Go rates"}
    </button>
  )
}
