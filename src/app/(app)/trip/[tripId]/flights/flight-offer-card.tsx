"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { format } from "date-fns"
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  Plus,
} from "lucide-react"
import { acceptFlightOffer, getFlightBookingLinks } from "@/lib/actions/flight-search"
import type { FlightOfferView } from "@/lib/flights/views"
import type { FlightItinerary, FlightSegment } from "@/lib/flights/types"
import { cn, formatCurrency, formatTime } from "@/lib/utils"

/* ─── Formatting helpers ───────────────────────────────────────────────────── */

/**
 * Segment times are ISO strings in the *airport's* local time. Read the clock
 * straight off the string rather than through `Date`, which would shift it into
 * the viewer's zone.
 */
function clock(iso: string): string {
  const m = iso.match(/T(\d{2}):(\d{2})/)
  return m ? formatTime(`${m[1]}:${m[2]}`) : iso
}

function dayKey(iso: string): string {
  return iso.slice(0, 10)
}

/** Calendar days from `a` to `b`, so a red-eye can show "+1". */
function dayOffset(a: string, b: string): number {
  const da = Date.parse(`${dayKey(a)}T00:00:00Z`)
  const db = Date.parse(`${dayKey(b)}T00:00:00Z`)
  if (Number.isNaN(da) || Number.isNaN(db)) return 0
  return Math.round((db - da) / 86_400_000)
}

function dateLabel(iso: string): string {
  const [y, m, d] = dayKey(iso).split("-").map(Number)
  if (!y || !m || !d) return ""
  return format(new Date(y, m - 1, d), "EEE, MMM d")
}

export function formatDuration(mins: number): string {
  if (!Number.isFinite(mins) || mins <= 0) return ""
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m}m`
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

export function stopsLabel(stops: number): string {
  if (stops <= 0) return "Nonstop"
  return stops === 1 ? "1 stop" : `${stops} stops`
}

function layoverMins(prev: FlightSegment, next: FlightSegment): number | null {
  const a = Date.parse(prev.arriveAt)
  const d = Date.parse(next.departAt)
  if (Number.isNaN(a) || Number.isNaN(d) || d < a) return null
  return Math.round((d - a) / 60_000)
}

const PROVIDER_LABEL: Record<string, string> = {
  serpapi: "Google Flights",
  duffel: "Duffel",
  travelpayouts: "Aviasales",
}

function providerLabel(provider: string): string {
  return PROVIDER_LABEL[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1)
}

function carrierNames(offer: FlightOfferView): string[] {
  const seen = new Map<string, string>()
  const legs = [offer.outbound, offer.inbound].filter(Boolean) as FlightItinerary[]
  for (const leg of legs) {
    for (const s of leg.segments) {
      if (!seen.has(s.carrier)) seen.set(s.carrier, s.carrierName || s.carrier)
    }
  }
  if (seen.size === 0) return offer.carrierCodes
  return Array.from(seen.values())
}

/* ─── Sub-components ───────────────────────────────────────────────────────── */

function LegRow({ label, leg }: { label: string; leg: FlightItinerary }) {
  const first = leg.segments[0]
  const last = leg.segments[leg.segments.length - 1]
  if (!first || !last) return null
  const offset = dayOffset(first.departAt, last.arriveAt)

  return (
    <div className="flex items-start gap-3">
      <span className="w-12 shrink-0 pt-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
        {label}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5 text-sm font-semibold text-gray-900 tabular-nums">
          <span>{clock(first.departAt)}</span>
          <ArrowRight className="w-3 h-3 text-gray-400 self-center" aria-hidden="true" />
          <span>{clock(last.arriveAt)}</span>
          {offset > 0 && (
            <span className="text-[10px] font-medium text-amber-600" title="Arrives the next day">
              +{offset}
            </span>
          )}
        </div>
        <div className="text-xs text-gray-500 truncate">
          {first.from} &rarr; {last.to} &middot; {formatDuration(leg.durationMins)} &middot; {stopsLabel(leg.stops)}
        </div>
      </div>
      <span className="shrink-0 text-xs text-gray-400 pt-0.5">{dateLabel(first.departAt)}</span>
    </div>
  )
}

function SegmentList({ leg }: { leg: FlightItinerary }) {
  return (
    <ol className="space-y-1.5">
      {leg.segments.map((s, i) => {
        const prev = leg.segments[i - 1]
        const layover = prev ? layoverMins(prev, s) : null
        return (
          <li key={`${s.carrier}-${s.flightNumber ?? i}-${s.departAt}`} className="text-xs">
            {prev && (
              <p className="text-gray-400 mb-1.5 pl-2 border-l-2 border-dashed border-gray-200">
                Layover in {prev.to}
                {layover != null ? ` · ${formatDuration(layover)}` : ""}
              </p>
            )}
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-gray-700 font-medium truncate">
                {s.carrierName || s.carrier}
                {s.flightNumber ? ` ${s.flightNumber}` : ""}
              </span>
              <span className="text-gray-400 shrink-0">{formatDuration(s.durationMins)}</span>
            </div>
            <div className="text-gray-500 tabular-nums">
              {clock(s.departAt)} {s.from} &rarr; {clock(s.arriveAt)} {s.to}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/* ─── Card ─────────────────────────────────────────────────────────────────── */

interface FlightOfferCardProps {
  offer: FlightOfferView
  searchId: string
  tripId: string
  /** e.g. "Cheapest" — shown as a small badge. */
  badge?: string | null
  onAdded?: (offerId: string) => void
}

export function FlightOfferCard({ offer, searchId, tripId, badge, onAdded }: FlightOfferCardProps) {
  const router = useRouter()
  const [expanded, setExpanded] = useState(false)
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState(false)
  const [linksOpen, setLinksOpen] = useState(false)
  const [links, setLinks] = useState<{ provider: string; url: string; label: string }[] | null>(null)
  const [linksLoading, setLinksLoading] = useState(false)

  const carriers = carrierNames(offer)
  const expired = offer.expiresAt ? Date.parse(offer.expiresAt) < Date.now() : false

  async function toggleLinks() {
    const next = !linksOpen
    setLinksOpen(next)
    if (!next || links !== null || linksLoading) return
    setLinksLoading(true)
    try {
      const result = await getFlightBookingLinks(offer.id)
      setLinks(result)
    } catch {
      setLinks([])
      toast.error("Couldn't load other booking sites")
    } finally {
      setLinksLoading(false)
    }
  }

  async function handleAdd() {
    if (adding || added) return
    setAdding(true)
    try {
      const result = await acceptFlightOffer(searchId, offer.id)
      setAdded(true)
      onAdded?.(offer.id)
      const count = result.flightIds.length
      toast.success(`Added ${count} flight${count === 1 ? "" : "s"} to your trip`, {
        description: "It's on your plan now — add the confirmation once you've booked.",
        action: {
          label: "View itinerary",
          onClick: () => router.push(`/trip/${tripId}/itinerary`),
        },
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ""
      toast.error(
        msg === "UPGRADE_REQUIRED"
          ? "Adding flights from search requires a paid plan."
          : msg || "Couldn't add this flight to your trip"
      )
    } finally {
      setAdding(false)
    }
  }

  return (
    <article
      className={cn(
        "bg-white border rounded-2xl p-4 transition-shadow",
        added ? "border-emerald-200 bg-emerald-50/30" : "border-gray-100 hover:shadow-md"
      )}
    >
      {/* Price + carriers */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-sm font-semibold text-gray-900 truncate">{carriers.join(" · ")}</h3>
            {badge && (
              <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-semibold rounded-full bg-emerald-100 text-emerald-700">
                {badge}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {stopsLabel(offer.stops)} &middot; {formatDuration(offer.durationMins)} in the air
            {offer.inbound ? " · Round trip" : " · One way"}
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-lg font-bold text-gray-900 tabular-nums leading-tight">
            {formatCurrency(offer.totalPrice, offer.currency)}
          </div>
          <div className="text-[10px] text-gray-400">total &middot; via {providerLabel(offer.provider)}</div>
        </div>
      </div>

      {/* Per-direction summary */}
      <div className="mt-3 space-y-2.5">
        <LegRow label="Depart" leg={offer.outbound} />
        {offer.inbound && <LegRow label="Return" leg={offer.inbound} />}
      </div>

      {expired && (
        <p className="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1">
          This fare was quoted a while ago and may have changed.
        </p>
      )}

      {/* Expand to segments */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-indigo-600 transition-colors"
      >
        {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        {expanded ? "Hide flight details" : "Flight details"}
      </button>

      {expanded && (
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-xl bg-gray-50 p-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Outbound</p>
            <SegmentList leg={offer.outbound} />
          </div>
          {offer.inbound && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Return</p>
              <SegmentList leg={offer.inbound} />
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="mt-3 pt-3 border-t border-gray-100 flex items-stretch gap-2">
        <div className="relative flex flex-1 min-w-0">
          <a
            href={offer.bookingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-gray-900 text-white text-xs font-medium rounded-l-xl hover:bg-gray-800 transition-colors"
          >
            Book
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
          <button
            type="button"
            onClick={toggleLinks}
            aria-label="Other booking sites"
            aria-expanded={linksOpen}
            className="px-2 bg-gray-900 text-white border-l border-white/20 rounded-r-xl hover:bg-gray-800 transition-colors"
          >
            <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", linksOpen && "rotate-180")} />
          </button>

          {linksOpen && (
            <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
              {linksLoading ? (
                <div className="flex items-center justify-center gap-2 py-3 text-xs text-gray-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Finding booking sites…
                </div>
              ) : links && links.length > 0 ? (
                <ul className="divide-y divide-gray-100">
                  {links.map((l) => (
                    <li key={`${l.provider}-${l.url}`}>
                      <a
                        href={l.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setLinksOpen(false)}
                        className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
                      >
                        <span className="truncate">{l.label}</span>
                        <ExternalLink className="w-3 h-3 text-gray-400 shrink-0" />
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-3 py-2.5 text-xs text-gray-400">No other booking sites for this fare.</p>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={handleAdd}
          disabled={adding || added}
          className={cn(
            "flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl border transition-colors",
            added
              ? "bg-emerald-100 border-emerald-200 text-emerald-700"
              : "bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100 disabled:opacity-60"
          )}
        >
          {added ? (
            <>
              <Check className="w-3.5 h-3.5" />
              Added
            </>
          ) : adding ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Adding…
            </>
          ) : (
            <>
              <Plus className="w-3.5 h-3.5" />
              Add to trip
            </>
          )}
        </button>
      </div>

      {added && (
        <Link
          href={`/trip/${tripId}/itinerary`}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"
        >
          On your plan — view itinerary
          <ArrowRight className="w-3 h-3" />
        </Link>
      )}
    </article>
  )
}
