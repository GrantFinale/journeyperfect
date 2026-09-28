"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Check, Minus, Loader2, ArrowRight, ExternalLink, Clock } from "lucide-react"
import { buildTrip } from "@/lib/actions/opportunities"
import type { TravelOpportunityView } from "@/lib/opportunities/views"
import type { FactorKind, FactorSource, OpportunityReason } from "@/lib/opportunities/types"
import { SourceChip } from "./source-chip"
import { formatAgo, formatMins, formatMoney, formatStayRange } from "./format"

/**
 * Plan §9. Every number carries its source. No score is ever rendered —
 * `magnitude` is used for nothing here; ordering is whatever the server sent.
 */
export function OpportunityCard({ opportunity: o }: { opportunity: TravelOpportunityView }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [builtTripId, setBuiltTripId] = useState<string | null | undefined>(o.builtTripId)

  const ago = formatAgo(o.retrievedAt)
  const nightsLabel = `${o.nights} night${o.nights !== 1 ? "s" : ""}`
  const travelersLabel = `${o.travelerCount} traveler${o.travelerCount !== 1 ? "s" : ""}`
  const showWeatherMeta = !o.reasons.some((r) => r.factor === "weather") && o.weatherContext?.summary

  const handleBuild = () => {
    startTransition(async () => {
      try {
        const res = await buildTrip(o.id)
        if ("error" in res) {
          toast.error(res.error)
          return
        }
        setBuiltTripId(res.tripId)
        toast.success(`Trip to ${o.destinationName} created`)
        router.push(`/trip/${res.tripId}/itinerary`)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't build this trip")
      }
    })
  }

  return (
    <article className="bg-white border border-gray-100 rounded-2xl p-5 sm:p-6 overflow-hidden">
      {/* Header line */}
      <header className="mb-4">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-gray-500 min-w-0">
          <h3 className="text-lg font-bold text-gray-900 uppercase tracking-wide break-words">
            {o.destinationName}
          </h3>
          <span className="text-gray-300">·</span>
          <span className="text-gray-700 font-medium">{formatStayRange(o.checkIn, o.checkOut)}</span>
          <span className="text-gray-300">·</span>
          <span>{nightsLabel}</span>
          <span className="text-gray-300">·</span>
          <span>{travelersLabel}</span>
        </div>
        {(showWeatherMeta || o.anchorExperience) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
            {showWeatherMeta && (
              <span className="inline-flex items-center gap-1.5 min-w-0">
                <span className="break-words">{o.weatherContext.summary}</span>
                <SourceChip source={o.weatherContext.kind === "HISTORICAL" ? "HISTORICAL" : "RETRIEVED"} />
              </span>
            )}
            {o.anchorExperience && (
              <span className="inline-flex items-center gap-1.5 min-w-0">
                {o.anchorExperience.url ? (
                  <a
                    href={o.anchorExperience.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-indigo-600 hover:underline break-words"
                  >
                    {o.anchorExperience.title}
                    <ExternalLink className="w-3 h-3 shrink-0" />
                  </a>
                ) : (
                  <span className="break-words">{o.anchorExperience.title}</span>
                )}
                <SourceChip source={o.anchorExperience.source} />
              </span>
            )}
          </div>
        )}
      </header>

      {/* Why this surfaced */}
      {o.reasons.length > 0 && (
        <section className="mb-4">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Why this surfaced</h4>
          <ul className="space-y-1.5">
            {o.reasons.map((r, i) => (
              <ReasonLine key={`${r.factor}-${i}`} reason={r} source={sourceFor(r.factor, o)} ago={ago} positive />
            ))}
          </ul>
        </section>
      )}

      {/* Hotel private-rate line: only when a private rate exists */}
      {o.hotelName && o.privateNightlyRate != null && (
        <section className="mb-4 rounded-xl bg-emerald-50/60 border border-emerald-100 px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium text-gray-900 break-words">{o.hotelName}</span>
            <span className="text-gray-600">
              private {formatMoney(o.privateNightlyRate)}/night
              {o.comparablePublicRate != null && (
                <>
                  {" "}
                  vs public <span className="line-through text-gray-400">{formatMoney(o.comparablePublicRate)}</span>
                </>
              )}
            </span>
            {o.hotelSavingsTotal != null && o.hotelSavingsTotal > 0 && (
              <span className="text-emerald-700 font-medium">saves {formatMoney(o.hotelSavingsTotal)}</span>
            )}
            <SourceChip source="RETRIEVED" suffix={ago || undefined} />
          </div>
        </section>
      )}

      {/* Worth knowing */}
      {o.worthKnowing.length > 0 && (
        <section className="mb-4">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Worth knowing</h4>
          <ul className="space-y-1.5">
            {o.worthKnowing.map((r, i) => (
              <ReasonLine key={`${r.factor}-${i}`} reason={r} source={sourceFor(r.factor, o)} ago={ago} />
            ))}
          </ul>
        </section>
      )}

      {/* Core trip estimate */}
      <CoreEstimate o={o} ago={ago} />

      {/* Footer: CTA + door-to-door */}
      <footer className="mt-5 pt-4 border-t border-gray-100 flex flex-wrap items-center justify-between gap-3">
        {builtTripId ? (
          <Link
            href={`/trip/${builtTripId}/itinerary`}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-indigo-200 text-indigo-700 text-sm font-medium rounded-xl hover:bg-indigo-50 transition-colors"
          >
            View trip
            <ArrowRight className="w-4 h-4" />
          </Link>
        ) : (
          <button
            type="button"
            onClick={handleBuild}
            disabled={pending}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {pending ? "Building…" : "Build This Trip"}
          </button>
        )}
        <div className="flex items-center gap-1.5 text-sm text-gray-500 min-w-0">
          <Clock className="w-3.5 h-3.5 shrink-0" />
          {o.transportation.doorToDoorMins != null ? (
            <span>
              door-to-door ≈ <span className="font-medium text-gray-700">{formatMins(o.transportation.doorToDoorMins)}</span>
            </span>
          ) : (
            <span>
              {o.transportation.mode === "DRIVE" ? "drive" : "flight"} ≈{" "}
              <span className="font-medium text-gray-700">{formatMins(o.transportation.durationMins)}</span>
            </span>
          )}
          <SourceChip source={o.transportation.source} />
        </div>
      </footer>
    </article>
  )
}

function ReasonLine({
  reason,
  source,
  ago,
  positive,
}: {
  reason: OpportunityReason
  source: FactorSource | null
  ago: string
  positive?: boolean
}) {
  return (
    <li className="flex items-start gap-2 text-sm min-w-0">
      {positive ? (
        <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
      ) : (
        <Minus className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
      )}
      <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-baseline sm:gap-2">
        <span className="font-medium text-gray-900 break-words sm:shrink-0">{reason.headline}</span>
        <span className="flex-1 min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {reason.detail && <span className="text-gray-500 break-words">{reason.detail}</span>}
          {source && <SourceChip source={source} suffix={source === "RETRIEVED" && ago ? ago : undefined} />}
        </span>
      </div>
    </li>
  )
}

function CoreEstimate({ o, ago }: { o: TravelOpportunityView; ago: string }) {
  const hotelTotal =
    o.privateNightlyRate != null
      ? { amount: o.privateNightlyRate * o.nights, source: "RETRIEVED" as FactorSource }
      : o.comparablePublicRate != null
        ? { amount: o.comparablePublicRate * o.nights, source: "ESTIMATED" as FactorSource }
        : null

  const parts: { label: string; amount: number; source: FactorSource }[] = []
  if (o.airfareTotal != null) parts.push({ label: "Flights", amount: o.airfareTotal, source: asSource(o.airfareSource) })
  if (hotelTotal) parts.push({ label: "Hotel", amount: hotelTotal.amount, source: hotelTotal.source })
  if (o.groundTransportEstimate != null)
    parts.push({ label: "Car + parking", amount: o.groundTransportEstimate, source: "ESTIMATED" })
  if (o.majorActivityEstimate != null)
    parts.push({ label: "Attractions", amount: o.majorActivityEstimate, source: "ESTIMATED" })

  if (o.coreTripCost == null && parts.length === 0) return null

  return (
    <section className="rounded-xl bg-gray-50 px-3 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        <span className="font-semibold text-gray-700">Core trip estimate</span>
        {o.coreTripCost != null && (
          <>
            <span className="text-base font-bold text-gray-900">{formatMoney(o.coreTripCost)}</span>
            <span className="text-gray-500">before food</span>
            <SourceChip
              source={asSource(o.coreTripCostSource)}
              suffix={o.coreTripCostSource === "RETRIEVED" && ago ? ago : undefined}
            />
          </>
        )}
      </div>
      {parts.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-xs text-gray-500">
          {parts.map((p, i) => (
            <span key={p.label} className="inline-flex items-baseline gap-1 flex-wrap">
              {i > 0 && <span className="text-gray-300 mr-0.5">·</span>}
              <span>{p.label}</span>
              <span className="font-medium text-gray-700">{formatMoney(p.amount)}</span>
              <SourceChip source={p.source} />
            </span>
          ))}
        </div>
      )}
    </section>
  )
}

/** The view types carry sources as plain strings; narrow defensively. */
function asSource(s: string | null | undefined): FactorSource {
  return s === "RETRIEVED" || s === "ESTIMATED" || s === "HISTORICAL" ? s : "UNKNOWN"
}

/**
 * Which value on the view a reason's number came from. Family fit and trip
 * length are derived from the user's own profiles and carry no source label,
 * matching the §9 mock.
 */
function sourceFor(factor: FactorKind, o: TravelOpportunityView): FactorSource | null {
  switch (factor) {
    case "hotelValue":
      return o.privateNightlyRate != null ? "RETRIEVED" : o.comparablePublicRate != null ? "ESTIMATED" : "UNKNOWN"
    case "nonstop":
    case "doorToDoor":
      return o.transportation.source
    case "airfare":
      return asSource(o.airfareSource)
    case "weather":
      return o.weatherContext.kind === "HISTORICAL" ? "HISTORICAL" : "RETRIEVED"
    case "anchor":
      return o.anchorExperience?.source ?? "UNKNOWN"
    case "groundFriction":
      return "ESTIMATED"
    case "familyFit":
    case "tripLengthFit":
      return null
    default:
      return null
  }
}
