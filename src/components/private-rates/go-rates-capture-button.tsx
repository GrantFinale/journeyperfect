"use client"

/**
 * "Open Go rate tabs": hands a capture plan to the JourneyPerfect Go Rates
 * Chrome extension, which opens Hilton (Go + public) and Marriott (F&F +
 * public) search tabs in the user's own Chrome, reads the rates shown and posts them to
 * /api/private-rates/capture. When the extension reports it is done (or the
 * user presses "Finish now") the captured quotes are applied to the search.
 *
 * Renders nothing unless private rates are enabled AND the user is entitled.
 *
 * Page ↔ extension contract (window.postMessage, same origin only):
 *   page → ext  { source: "journeyperfect", type: "JP_GO_RATES_PLAN", plan }
 *   ext → page  { source: "jp-go-rates-extension", type: "JP_GO_RATES_PROGRESS",
 *                 searchId, opened, captured, failed, total, done }
 *   presence    document.documentElement.dataset.jpGoRates === "1"
 */

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { createGoRatesCapturePlan, finishGoRatesCapture, getPrivateRateStatus } from "@/lib/actions/private-rates"
import { useGoRatesExtension } from "./use-go-rates-extension"

type Status = Awaited<ReturnType<typeof getPrivateRateStatus>>
type FinishResult = Awaited<ReturnType<typeof finishGoRatesCapture>>

type Phase = "idle" | "starting" | "running" | "finishing"

interface Progress {
  opened: number
  captured: number
  failed: number
  total: number
  done: boolean
}

type PlanItem = { brand?: string; intent?: string }

const TAB_KIND_ORDER = ["hilton|PRIVATE", "hilton|PUBLIC", "marriott|PRIVATE", "marriott|PUBLIC"] as const
const TAB_KIND_LABEL: Record<(typeof TAB_KIND_ORDER)[number], string> = {
  "hilton|PRIVATE": "Hilton Go",
  "hilton|PUBLIC": "Hilton public",
  "marriott|PRIVATE": "Marriott F&F",
  "marriott|PUBLIC": "Marriott public",
}

/** "Hilton Go, Hilton public, Marriott F&F, Marriott public": the kinds of tab a plan opens, in a fixed order. */
export function describeTabKinds(items: readonly PlanItem[]): string {
  const have = new Set(items.map((i) => `${i.brand ?? "hilton"}|${i.intent ?? "PRIVATE"}`))
  return TAB_KIND_ORDER.filter((k) => have.has(k))
    .map((k) => TAB_KIND_LABEL[k])
    .join(", ")
}

/** "Opened 6 of 16 tabs (Hilton Go, Hilton public, Marriott F&F, Marriott public)" */
export function progressLine(opened: number, total: number, kinds: string): string {
  return `Opened ${opened} of ${total} ${total === 1 ? "tab" : "tabs"}${kinds ? ` (${kinds})` : ""}`
}

const BRAND_NAME: Record<string, string> = { hilton: "Hilton", marriott: "Marriott" }

/** If the extension sends nothing back this long after the plan, say so. */
const NO_RESPONSE_MS = 15_000

function count(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

export function explainFinish(res: FinishResult): { kind: "success" | "warning" | "error"; message: string } {
  if (res.status.startsWith("FAILED")) {
    return { kind: "error", message: res.status.replace(/^FAILED:\s*/, "") || "Your captured rates could not be applied." }
  }
  const byBrand = Object.entries(res.blockedByBrand ?? {}).filter(([, n]) => (n ?? 0) > 0) as [string, number][]
  const blockedList = byBrand.length
    ? byBrand.map(([b, n]) => `${BRAND_NAME[b] ?? b} blocked ${plural(n, "tab", "tabs")}`).join(", ")
    : res.blockedPages > 0
      ? `Hilton blocked ${plural(res.blockedPages, "tab", "tabs")}`
      : ""
  const blocked = blockedList
    ? ` ${blockedList}, so ${res.blockedPages === 1 ? "its" : "their"} rates were not captured. Check you are signed in in Chrome and try again later.`
    : ""
  const capturedQuotes = res.capturedQuotes ?? 0
  if (capturedQuotes > 0) {
    const hotels = Math.max(1, res.capturedHotels ?? 0)
    return {
      kind: blocked ? "warning" : "success",
      message: `Captured ${plural(capturedQuotes, "hotel rate", "hotel rates")} across ${plural(hotels, "hotel", "hotels")}. See 'Hotel rates from your tabs' below.${blocked}`,
    }
  }
  if (res.quotesUsed === 0) {
    return { kind: "warning", message: `None of the captured rates matched these destinations and dates.${blocked}` }
  }
  const opp = res.opportunityCount > 0 ? ` ${plural(res.opportunityCount, "opportunity", "opportunities")} re-ranked.` : ""
  return {
    kind: blocked ? "warning" : "success",
    message: `Applied ${plural(res.quotesUsed, "hotel rate", "hotel rates")} from your tabs.${opp}${blocked}`,
  }
}

export function GoRatesCaptureButton({
  searchId,
  onExtensionDetected,
}: {
  searchId: string
  /** Lets the parent hide the runner-based button once the extension is present. */
  onExtensionDetected?: (detected: boolean) => void
}) {
  const router = useRouter()
  const { detected, checking } = useGoRatesExtension()
  const [status, setStatus] = useState<Status | null>(null)
  const [phase, setPhaseState] = useState<Phase>("idle")
  // Mirrors `phase` synchronously so the message listener never misses an early progress event.
  const phaseRef = useRef<Phase>("idle")
  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p
    setPhaseState(p)
  }, [])
  const [progress, setProgress] = useState<Progress | null>(null)
  const [tabKinds, setTabKinds] = useState("")
  const [notice, setNotice] = useState<string | null>(null)
  const finishing = useRef(false)
  const noResponseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    getPrivateRateStatus()
      .then((s) => !cancelled && setStatus(s))
      .catch(() => !cancelled && setStatus(null))
    return () => {
      cancelled = true
    }
  }, [])

  const allowed = !!status?.enabled && !!status?.entitled

  useEffect(() => {
    onExtensionDetected?.(allowed && detected)
  }, [allowed, detected, onExtensionDetected])

  const clearNoResponse = useCallback(() => {
    if (noResponseTimer.current) clearTimeout(noResponseTimer.current)
    noResponseTimer.current = null
  }, [])
  useEffect(() => clearNoResponse, [clearNoResponse])

  const finish = useCallback(async () => {
    if (finishing.current) return
    finishing.current = true
    clearNoResponse()
    setPhase("finishing")
    try {
      const res = await finishGoRatesCapture(searchId)
      const { kind, message } = explainFinish(res)
      if (kind === "success") toast.success(message)
      else if (kind === "warning") toast.warning(message)
      else toast.error(message)
    } catch {
      toast.error("Your captured rates could not be applied. Please try again.")
    } finally {
      setPhase("idle")
      setProgress(null)
      finishing.current = false
      router.refresh()
      getPrivateRateStatus().then(setStatus).catch(() => undefined)
    }
  }, [router, searchId, setPhase, clearNoResponse])

  // Progress from the extension. Same window, same origin, our search only.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (phaseRef.current !== "running") return
      if (event.source !== window || event.origin !== window.location.origin) return
      const d = event.data as Record<string, unknown> | null
      if (!d || d.source !== "jp-go-rates-extension" || d.type !== "JP_GO_RATES_PROGRESS" || d.searchId !== searchId) return
      clearNoResponse()
      const next: Progress = {
        opened: count(d.opened),
        captured: count(d.captured),
        failed: count(d.failed),
        total: count(d.total),
        done: d.done === true,
      }
      setProgress(next)
      if (next.done) {
        if (next.captured > 0) {
          void finish()
        } else {
          setPhase("idle")
          setProgress(null)
          const msg =
            next.failed > 0
              ? `No rates were captured. ${plural(next.failed, "tab", "tabs")} could not be read; the hotel site may have blocked the page or signed you out. Check you are signed in (Go Hilton) in Chrome and try again.`
              : "No rates were captured from the hotel tabs."
          setNotice(msg)
          toast.warning(msg)
        }
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [searchId, finish, setPhase, clearNoResponse])

  if (!allowed) return null

  if (!detected) {
    if (checking) return null
    return (
      <span className="text-xs text-gray-500">
        <Link href="/settings/private-rates#extension" className="text-indigo-600 underline hover:text-indigo-800">
          Install the JourneyPerfect Go Rates extension
        </Link>
      </span>
    )
  }

  async function handleStart() {
    setNotice(null)
    setPhase("starting")
    let res: Awaited<ReturnType<typeof createGoRatesCapturePlan>>
    try {
      res = await createGoRatesCapturePlan(searchId)
    } catch {
      setPhase("idle")
      toast.error("Could not prepare the hotel tabs. Nothing was opened.")
      return
    }
    if ("error" in res) {
      setPhase("idle")
      toast.error(res.error)
      return
    }
    setTabKinds(describeTabKinds(res.plan.items))
    setProgress({ opened: 0, captured: 0, failed: 0, total: res.plan.items.length, done: false })
    setPhase("running")
    window.postMessage({ source: "journeyperfect", type: "JP_GO_RATES_PLAN", plan: res.plan }, window.location.origin)
    clearNoResponse()
    noResponseTimer.current = setTimeout(() => {
      if (phaseRef.current !== "running") return
      setPhase("idle")
      setProgress(null)
      setNotice("The Go Rates extension did not respond. Reload this page and try again.")
    }, NO_RESPONSE_MS)
    setStatus((s) => (s ? { ...s, checksRemainingToday: Math.max(0, s.checksRemainingToday - 1) } : s))
  }

  if (phase === "finishing") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Applying your private rates…
      </span>
    )
  }

  if (phase === "running" && progress) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
        <span className="inline-flex items-center gap-1.5" aria-live="polite">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          {progressLine(progress.opened, progress.total, tabKinds)} · captured {progress.captured}
          {progress.failed > 0 && ` · ${progress.failed} couldn't be read`}
        </span>
        {progress.captured >= 1 && (
          <button
            type="button"
            onClick={() => void finish()}
            className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Finish now
          </button>
        )}
      </div>
    )
  }

  const noChecksLeft = (status?.checksRemainingToday ?? 0) <= 0
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={handleStart}
        disabled={phase === "starting" || noChecksLeft}
        title={
          noChecksLeft
            ? "You have reached today's limit for rate checks."
            : "Opens private and public hotel search tabs (Hilton Go, Marriott F&F) in your own Chrome and reads the rates shown."
        }
        className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {phase === "starting" && <Loader2 className="w-4 h-4 animate-spin" />}
        {phase === "starting" ? "Preparing tabs…" : "Open Go rate tabs"}
      </button>
      {notice && <span className="text-xs text-amber-700">{notice}</span>}
    </div>
  )
}
