"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Bell, BellRing, Loader2, Lock, X } from "lucide-react"
import { setFlightTracking } from "@/lib/actions/flight-search"
import { getUpgradeMessage } from "@/lib/features"
import { cn, formatCurrency } from "@/lib/utils"

interface TrackPriceButtonProps {
  searchId: string
  isTracking: boolean
  targetPrice?: number | null
  currency?: string
  /**
   * Plan gate resolved on the server. When false the popover explains the
   * upgrade instead of firing a request that would only come back refused.
   */
  canTrack: boolean
  onChange?: (next: { isTracking: boolean; targetPrice?: number }) => void
  className?: string
}

/**
 * Toggle price tracking on a saved search, optionally with a target price to
 * be alerted at. The server owns the watch cap, so any error it returns (plan,
 * limit reached, …) is shown verbatim with an upgrade link.
 */
export function TrackPriceButton({
  searchId,
  isTracking,
  targetPrice,
  currency = "USD",
  canTrack,
  onChange,
  className,
}: TrackPriceButtonProps) {
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState(targetPrice != null ? String(targetPrice) : "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const upgradeMessage = getUpgradeMessage("flightPriceTracking")

  function parseTarget(): number | undefined {
    const trimmed = target.trim()
    if (!trimmed) return undefined
    const n = Number(trimmed)
    return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined
  }

  async function apply(next: boolean) {
    setBusy(true)
    setError(null)
    const parsed = next ? parseTarget() : undefined
    try {
      const res = await setFlightTracking(searchId, next, parsed)
      if (!res.ok) {
        setError(res.error)
        toast.error(res.error)
        return
      }
      onChange?.({ isTracking: next, targetPrice: parsed })
      if (next) {
        toast.success(
          parsed != null
            ? `Tracking — we'll let you know if it drops below ${formatCurrency(parsed, currency)}`
            : "Tracking this route — we'll let you know when the price moves"
        )
      } else {
        toast("Stopped tracking this route")
      }
      setOpen(false)
    } catch {
      const msg = "Couldn't update tracking. Please try again."
      setError(msg)
      toast.error(msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cn("relative shrink-0", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors",
          isTracking
            ? "bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100"
            : "border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300"
        )}
      >
        {isTracking ? <BellRing className="w-3.5 h-3.5" /> : <Bell className="w-3.5 h-3.5" />}
        {isTracking ? "Tracking" : "Track price"}
        {isTracking && targetPrice != null && (
          <span className="hidden sm:inline text-indigo-500 tabular-nums">
            · under {formatCurrency(targetPrice, currency)}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-64 max-w-[calc(100vw-2rem)] bg-white border border-gray-200 rounded-xl shadow-lg p-3">
          <div className="flex items-start justify-between gap-2 mb-2">
            <p className="text-xs font-semibold text-gray-900">
              {isTracking ? "Price tracking is on" : "Track this price"}
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="text-gray-300 hover:text-gray-600 transition-colors -m-1 p-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {!canTrack ? (
            <div className="flex items-start gap-2">
              <Lock className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-xs text-gray-600">{upgradeMessage}</p>
                <Link
                  href="/settings/billing"
                  className="inline-block mt-2 px-2.5 py-1 bg-indigo-600 text-white text-[11px] font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
                >
                  Upgrade
                </Link>
              </div>
            </div>
          ) : (
            <>
              <p className="text-[11px] text-gray-500 mb-2">
                We re-check this route on a schedule and tell you when the fare moves.
              </p>
              <label className="block text-[11px] font-medium text-gray-500 mb-1">
                Alert me below (optional)
              </label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">$</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  placeholder="e.g. 350"
                  className="w-full pl-6 pr-2 py-1.5 text-xs border border-gray-200 rounded-lg tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {error && (
                <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 border border-amber-100 px-2 py-1.5">
                  <Lock className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-px" />
                  <p className="text-[11px] text-amber-800">
                    {error}{" "}
                    <Link href="/settings/billing" className="font-semibold underline hover:text-amber-900">
                      Upgrade
                    </Link>
                  </p>
                </div>
              )}

              <div className="flex items-center gap-2 mt-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => apply(true)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {isTracking ? "Save target" : "Start tracking"}
                </button>
                {isTracking && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => apply(false)}
                    className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
                  >
                    Stop
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
