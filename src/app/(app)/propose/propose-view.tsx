"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Sparkles,
  Loader2,
  Plane,
  BedDouble,
  Ticket,
  Calendar,
  Users,
  ArrowRight,
  Lock,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from "lucide-react"
import {
  proposeTrip,
  acceptProposalVariant,
  type TripProposal,
  type TripProposalVariant,
} from "@/lib/actions/trip-proposals"
import { formatCurrency } from "@/lib/utils"

const EXAMPLE = "Ten days in Portugal in May, two adults, mid-range"

type Props = {
  allowed: boolean
  upgradeMessage: string | null
  aiConfigured: boolean
  defaultOrigin: string
}

export function ProposeView({ allowed, upgradeMessage, aiConfigured, defaultOrigin }: Props) {
  const router = useRouter()
  const [idea, setIdea] = useState("")
  const [origin, setOrigin] = useState(defaultOrigin)
  const [windowStart, setWindowStart] = useState("")
  const [windowEnd, setWindowEnd] = useState("")
  const [nights, setNights] = useState("")
  const [travelers, setTravelers] = useState("")
  const [budget, setBudget] = useState("")
  const [showOptions, setShowOptions] = useState(false)

  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ proposalId: string; proposal: TripProposal } | null>(null)
  const [building, setBuilding] = useState<number | null>(null)

  const canSubmit = allowed && aiConfigured && idea.trim().length >= 3 && !pending

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setPending(true)
    setError(null)
    setResult(null)
    try {
      const res = await proposeTrip({
        idea: idea.trim(),
        origin: origin.trim() || undefined,
        windowStart: windowStart || undefined,
        windowEnd: windowEnd || undefined,
        nights: nights ? Number(nights) : undefined,
        travelers: travelers ? Number(travelers) : undefined,
        budget: budget ? Number(budget) : undefined,
      })
      if ("error" in res) {
        setError(res.error.replace(/^UPGRADE_REQUIRED:/, ""))
      } else {
        setResult(res)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setPending(false)
    }
  }

  async function onBuild(variant: TripProposalVariant, index: number) {
    setBuilding(index)
    try {
      const { tripId } = await acceptProposalVariant(variant)
      toast.success("Trip created")
      router.push(`/trip/${tripId}/itinerary`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't build this trip"
      toast.error(msg.replace(/^(UPGRADE_REQUIRED|PLAN_LIMIT):\s*/, ""))
      setBuilding(null)
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-indigo-600" />
          Plan from an idea
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          Describe the trip in a sentence. We&apos;ll search fares, shortlist things to do, estimate lodging and hand
          back two or three costed options you can build in one click.
        </p>
      </div>

      {!allowed && upgradeMessage && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <Lock className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <p>{upgradeMessage}</p>
            <Link href="/settings/billing" className="mt-1 inline-flex items-center gap-1 font-medium underline">
              See plans <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      )}

      {allowed && !aiConfigured && (
        <div className="mb-6 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
          AI planning isn&apos;t configured on this server yet.
        </div>
      )}

      <form onSubmit={onSubmit} className="bg-white border border-gray-100 rounded-2xl p-5 mb-8">
        <label htmlFor="idea" className="block text-sm font-medium text-gray-700 mb-1.5">
          Your idea
        </label>
        <textarea
          id="idea"
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          placeholder={EXAMPLE}
          rows={3}
          maxLength={600}
          disabled={!allowed || pending}
          className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50"
        />

        <button
          type="button"
          onClick={() => setShowOptions((s) => !s)}
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700"
        >
          {showOptions ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          Optional details
        </button>

        {showOptions && (
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Field label="Flying from" className="col-span-2 sm:col-span-1">
              <input
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                placeholder="City or airport"
                className={inputCls}
                disabled={!allowed || pending}
              />
            </Field>
            <Field label="Earliest start">
              <input
                type="date"
                value={windowStart}
                onChange={(e) => setWindowStart(e.target.value)}
                className={inputCls}
                disabled={!allowed || pending}
              />
            </Field>
            <Field label="Latest end">
              <input
                type="date"
                value={windowEnd}
                onChange={(e) => setWindowEnd(e.target.value)}
                className={inputCls}
                disabled={!allowed || pending}
              />
            </Field>
            <Field label="Nights">
              <input
                type="number"
                min={1}
                max={60}
                value={nights}
                onChange={(e) => setNights(e.target.value)}
                className={inputCls}
                disabled={!allowed || pending}
              />
            </Field>
            <Field label="Travelers">
              <input
                type="number"
                min={1}
                max={20}
                value={travelers}
                onChange={(e) => setTravelers(e.target.value)}
                className={inputCls}
                disabled={!allowed || pending}
              />
            </Field>
            <Field label="Total budget (USD)">
              <input
                type="number"
                min={0}
                step={100}
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                className={inputCls}
                disabled={!allowed || pending}
              />
            </Field>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-xs text-gray-400">Usually takes 30–90 seconds. Estimates are labelled; quoted fares are live.</p>
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {pending ? "Planning…" : "Propose trips"}
          </button>
        </div>
      </form>

      {error && (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
      )}

      {pending && (
        <div className="text-center py-16 text-gray-500">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-indigo-500" />
          <p className="text-sm">Searching fares, shortlisting activities and pricing lodging…</p>
        </div>
      )}

      {result && (
        <section>
          {result.proposal.summary && <p className="text-sm text-gray-600 mb-4">{result.proposal.summary}</p>}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {result.proposal.variants.map((v, i) => (
              <VariantCard
                key={`${result.proposalId}-${i}`}
                variant={v}
                building={building === i}
                disabled={building !== null}
                onBuild={() => onBuild(v, i)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

const inputCls =
  "w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50"

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-xs font-medium text-gray-500 mb-1">{label}</span>
      {children}
    </label>
  )
}

function SourceBadge({ source }: { source: "RETRIEVED" | "ESTIMATED" }) {
  const retrieved = source === "RETRIEVED"
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide ${
        retrieved ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"
      }`}
      title={retrieved ? "Live quote from a fare search" : "Planning estimate, not a quote"}
    >
      {source}
    </span>
  )
}

function fmtDate(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`)
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
}

function VariantCard({
  variant: v,
  building,
  disabled,
  onBuild,
}: {
  variant: TripProposalVariant
  building: boolean
  disabled: boolean
  onBuild: () => void
}) {
  const [showAll, setShowAll] = useState(false)
  const acts = showAll ? v.activities : v.activities.slice(0, 4)
  const currency = v.total.currency || "USD"

  return (
    <div className="flex flex-col bg-white border border-gray-100 rounded-2xl p-5 hover:border-indigo-200 hover:shadow-sm transition-all">
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="inline-flex px-2 py-0.5 bg-indigo-50 text-indigo-700 text-xs font-semibold rounded-full">
          {v.label}
        </span>
        <SourceBadge source={v.total.source} />
      </div>
      <h3 className="font-semibold text-gray-900 leading-snug">{v.destination.name}</h3>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
        <span className="inline-flex items-center gap-1">
          <Calendar className="w-3.5 h-3.5" />
          {fmtDate(v.startDate)} – {fmtDate(v.endDate)}
        </span>
        <span className="inline-flex items-center gap-1">
          <Users className="w-3.5 h-3.5" />
          {v.travelers}
        </span>
      </div>

      <div className="mt-4 mb-4">
        <div className="text-2xl font-bold text-gray-900">{formatCurrency(v.total.amount, currency)}</div>
        <div className="text-xs text-gray-400">total for {v.travelers} traveler{v.travelers === 1 ? "" : "s"}</div>
      </div>

      <ul className="space-y-2.5 text-sm">
        <li className="flex items-start gap-2">
          <Plane className="w-4 h-4 mt-0.5 text-gray-400 shrink-0" />
          <div className="min-w-0 flex-1">
            {v.flight ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-gray-900 font-medium">{formatCurrency(v.flight.totalPrice, v.flight.currency || currency)}</span>
                  <SourceBadge source={v.flight.source} />
                </div>
                <p className="text-xs text-gray-500 break-words">{v.flight.offerSummary}</p>
                {v.flight.bookingUrl && (
                  <a
                    href={v.flight.bookingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline mt-0.5"
                  >
                    View fare <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </>
            ) : (
              <span className="text-xs text-gray-500">No flight included</span>
            )}
          </div>
        </li>
        <li className="flex items-start gap-2">
          <BedDouble className="w-4 h-4 mt-0.5 text-gray-400 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-gray-900 font-medium">
                {formatCurrency(v.lodging.estimateTotal, v.lodging.currency || currency)}
              </span>
              <SourceBadge source={v.lodging.source} />
            </div>
            <p className="text-xs text-gray-500">
              ~{formatCurrency(v.lodging.perNight, v.lodging.currency || currency)}/night
              {v.lodging.tier ? ` · ${v.lodging.tier}` : ""}
            </p>
          </div>
        </li>
        <li className="flex items-start gap-2">
          <Ticket className="w-4 h-4 mt-0.5 text-gray-400 shrink-0" />
          <div className="min-w-0 flex-1">
            <span className="text-gray-900 font-medium">{v.activities.length} activities</span>
            <ul className="mt-1 space-y-0.5">
              {acts.map((a, i) => (
                <li key={i} className="text-xs text-gray-500 flex justify-between gap-2">
                  <span className="truncate">{a.title}</span>
                  {a.estCost !== undefined && a.estCost > 0 && (
                    <span className="shrink-0 text-gray-400">{formatCurrency(a.estCost, currency)}</span>
                  )}
                </li>
              ))}
            </ul>
            {v.activities.length > 4 && (
              <button
                type="button"
                onClick={() => setShowAll((s) => !s)}
                className="mt-1 text-xs text-indigo-600 hover:underline"
              >
                {showAll ? "Show fewer" : `Show all ${v.activities.length}`}
              </button>
            )}
          </div>
        </li>
      </ul>

      {v.rationale.length > 0 && (
        <ul className="mt-4 pt-4 border-t border-gray-100 space-y-1">
          {v.rationale.map((r, i) => (
            <li key={i} className="text-xs text-gray-600 flex gap-2">
              <span className="text-indigo-400">•</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={onBuild}
        disabled={disabled}
        className="mt-5 inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {building ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
        {building ? "Building…" : "Build this trip"}
      </button>
    </div>
  )
}
