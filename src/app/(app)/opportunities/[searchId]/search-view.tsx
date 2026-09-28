"use client"

import { useEffect, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Check, Loader2, RefreshCw, AlertTriangle, Plane, Calendar, Users, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { authorizePrivateRates, runOpportunitySearch } from "@/lib/actions/opportunities"
import type { OpportunitySearchView, TravelOpportunityView } from "@/lib/opportunities/views"
import { CheckPrivateRatesButton } from "@/components/private-rates/check-private-rates-button"
import { OpportunityCard } from "../opportunity-card"
import { formatAgo, formatWindow, weekdayPatternLabel } from "../format"

type CandidateCounts = { total: number; pruned: number; byStage: Record<number, number> }

/**
 * Stage strip. Index = pipeline stage; `status` STAGE_n means stage n is
 * running, DONE means all five finished. Private rates (stage 3) is the only
 * stage that waits on an explicit user action.
 */
const STAGES = [
  { index: 0, label: "Bounding", detail: "Dates × nonstop destinations" },
  { index: 1, label: "Free factors", detail: "Weather, family fit, anchors" },
  { index: 2, label: "Airfare", detail: "Live fares for the survivors" },
  { index: 3, label: "Private rates", detail: "Only when you ask" },
  { index: 4, label: "Ranked", detail: "Outliers, in order" },
] as const

type StageState = "done" | "active" | "pending" | "failed"

function stageStates(status: string): StageState[] {
  if (status === "DONE") return STAGES.map(() => "done")
  const m = /^STAGE_(\d)$/.exec(status)
  const running = m ? Number(m[1]) : status === "FAILED" ? -1 : -1
  if (status === "FAILED") {
    // We don't know where it failed; mark the strip failed at the end.
    return STAGES.map((s) => (s.index < 4 ? "pending" : "failed"))
  }
  return STAGES.map((s) => (s.index < running ? "done" : s.index === running ? "active" : "pending"))
}

export function SearchView({
  search,
  opportunities,
  candidateCounts,
}: {
  search: OpportunitySearchView
  opportunities: TravelOpportunityView[]
  candidateCounts: CandidateCounts
}) {
  const router = useRouter()
  const [rerunning, startRerun] = useTransition()
  const [authorizing, startAuthorize] = useTransition()

  const inProgress = /^STAGE_\d$/.test(search.status)
  const states = stageStates(search.status)

  // A run started elsewhere (or a long one) — keep the strip honest.
  useEffect(() => {
    if (!inProgress) return
    const id = setInterval(() => router.refresh(), 4000)
    return () => clearInterval(id)
  }, [inProgress, router])

  const handleRerun = () => {
    startRerun(async () => {
      try {
        const res = await runOpportunitySearch(search.id)
        if (res.status === "FAILED") toast.error("The search failed. Try again in a moment.")
        else toast.success(`${res.opportunityCount} opportunit${res.opportunityCount === 1 ? "y" : "ies"} found`)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't re-run the search")
      } finally {
        router.refresh()
      }
    })
  }

  const handlePrivateRatesDone = () => {
    startAuthorize(async () => {
      try {
        const res = await authorizePrivateRates(search.id)
        toast.success(
          res.opportunityCount > 0
            ? `Re-ranked with your rates: ${res.opportunityCount} opportunit${res.opportunityCount === 1 ? "y" : "ies"}`
            : "Private rates applied"
        )
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't apply private rates")
      } finally {
        router.refresh()
      }
    })
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 break-words">
            {formatWindow(search.windowStart, search.windowEnd)}
          </h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500 mt-1">
            <span className="inline-flex items-center gap-1">
              <Plane className="w-3.5 h-3.5" />
              {search.originAirports.join(", ") || "Any airport"}
            </span>
            <span className="inline-flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              {search.nightsMin === search.nightsMax
                ? `${search.nightsMin} nights`
                : `${search.nightsMin}–${search.nightsMax} nights`}
              {search.weekdayPattern ? ` · ${weekdayPatternLabel(search.weekdayPattern)}` : ""}
            </span>
            <span className="inline-flex items-center gap-1">
              <Users className="w-3.5 h-3.5" />
              {search.travelerProfileIds.length} traveler{search.travelerProfileIds.length !== 1 ? "s" : ""}
            </span>
            {search.completedAt && <span className="text-gray-400">ranked {formatAgo(search.completedAt)}</span>}
          </div>
          <ConstraintChips search={search} />
        </div>
        <button
          type="button"
          onClick={handleRerun}
          disabled={rerunning || inProgress}
          className="inline-flex items-center gap-2 px-3.5 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:border-gray-300 hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shrink-0"
        >
          {rerunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {rerunning ? "Running…" : "Re-run"}
        </button>
      </div>

      {/* Stage strip */}
      <section className="bg-white border border-gray-100 rounded-2xl p-4 sm:p-5 mb-6">
        <ol className="grid grid-cols-1 sm:grid-cols-5 gap-2 sm:gap-3">
          {STAGES.map((stage, i) => {
            const state = states[i]
            const count = candidateCounts.byStage?.[stage.index]
            return (
              <li key={stage.index} className="flex sm:flex-col items-start gap-3 sm:gap-2 min-w-0">
                <div className="flex items-center gap-2 sm:w-full">
                  <StageDot state={state} index={stage.index} />
                  <div className="hidden sm:block flex-1 h-px bg-gray-100 last:hidden" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      "text-sm font-medium leading-tight",
                      state === "done" && "text-gray-900",
                      state === "active" && "text-indigo-700",
                      state === "pending" && "text-gray-400",
                      state === "failed" && "text-red-600"
                    )}
                  >
                    {stage.label}
                  </div>
                  <div className="text-xs text-gray-400 leading-snug">
                    {typeof count === "number"
                      ? `${count} candidate${count !== 1 ? "s" : ""}`
                      : stage.detail}
                  </div>
                  {stage.index === 3 && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {authorizing ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Applying your rates…
                        </span>
                      ) : (
                        <CheckPrivateRatesButton searchId={search.id} onDone={handlePrivateRatesDone} />
                      )}
                      {search.privateRatesAuthorizedAt && (
                        <span className="text-xs text-emerald-700">
                          checked {formatAgo(search.privateRatesAuthorizedAt)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
        {(candidateCounts.total > 0 || candidateCounts.pruned > 0) && (
          <p className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-400">
            {candidateCounts.total} candidate{candidateCounts.total !== 1 ? "s" : ""} considered
            {candidateCounts.pruned > 0 && ` · ${candidateCounts.pruned} pruned along the way`}
            {` · ${opportunities.length} surfaced`}
          </p>
        )}
      </section>

      {/* Status notices */}
      {search.status === "FAILED" && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-100 rounded-2xl p-4 mb-6 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>This search didn&apos;t finish. Re-run it, or start a new one with a wider window.</span>
        </div>
      )}
      {inProgress && (
        <div className="flex items-start gap-3 bg-indigo-50 border border-indigo-100 rounded-2xl p-4 mb-6 text-sm text-indigo-700">
          <Loader2 className="w-4 h-4 shrink-0 mt-0.5 animate-spin" />
          <span>Still searching. This page refreshes itself as stages finish.</span>
        </div>
      )}

      {/* Opportunities */}
      {opportunities.length > 0 ? (
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            {opportunities.length} opportunit{opportunities.length === 1 ? "y" : "ies"}
          </h2>
          <div className="space-y-4">
            {opportunities.map((o) => (
              <OpportunityCard key={o.id} opportunity={o} />
            ))}
          </div>
        </section>
      ) : (
        search.status === "DONE" && (
          <div className="text-center py-14 px-4">
            <div className="w-14 h-14 bg-gray-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Sparkles className="w-7 h-7 text-gray-400" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Nothing stood out</h2>
            <p className="text-gray-500 text-sm max-w-md mx-auto">
              No weekend in this window was an outlier on fare, hotel value, weather, or an event. A wider
              window, another airport, or fewer constraints usually changes that.
            </p>
          </div>
        )
      )}
    </div>
  )
}

function StageDot({ state, index }: { state: StageState; index: number }) {
  return (
    <span
      className={cn(
        "w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0",
        state === "done" && "bg-emerald-500 text-white",
        state === "active" && "bg-indigo-600 text-white",
        state === "pending" && "bg-gray-100 text-gray-400",
        state === "failed" && "bg-red-100 text-red-600"
      )}
      aria-label={`${state}`}
    >
      {state === "done" ? (
        <Check className="w-3.5 h-3.5" />
      ) : state === "active" ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : state === "failed" ? (
        <AlertTriangle className="w-3.5 h-3.5" />
      ) : (
        index + 1
      )}
    </span>
  )
}

function ConstraintChips({ search }: { search: OpportunitySearchView }) {
  const c = search.constraints || {}
  const chips: string[] = []
  if (c.nonstopOnly) chips.push("Nonstop only")
  if (c.warm) chips.push("Warm")
  if (c.drivingOk) chips.push("Driving OK")
  if (c.maxFlightMins) chips.push(`≤ ${Math.round((c.maxFlightMins / 60) * 10) / 10}h flight`)
  if (c.maxCoreCost) chips.push(`≤ $${c.maxCoreCost.toLocaleString()} core`)
  for (const r of c.regions || []) chips.push(r.replace(/-/g, " "))
  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {chips.map((chip) => (
        <span
          key={chip}
          className="px-2 py-0.5 rounded-md border border-dashed border-gray-300 text-[11px] font-medium text-gray-500 capitalize"
        >
          {chip}
        </span>
      ))}
    </div>
  )
}
