import Link from "next/link"
import { Sparkles, Plus, ChevronRight, Lock, Plane, Calendar, Users } from "lucide-react"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { hasFeature, getUpgradeMessage } from "@/lib/features"
import { listOpportunitySearches } from "@/lib/actions/opportunities"
import type { OpportunitySearchView } from "@/lib/opportunities/views"
import { formatAgo, formatWindow, weekdayPatternLabel } from "./format"

export const dynamic = "force-dynamic"

export default async function OpportunitiesPage() {
  const session = await auth()
  const userId = session?.user?.id
  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId }, select: { plan: true } })
    : null
  const plan = user?.plan || "FREE"

  if (!hasFeature(plan, "opportunityDiscovery")) {
    return <UpgradeGate />
  }

  let searches: OpportunitySearchView[] = []
  try {
    searches = await listOpportunitySearches()
  } catch {
    searches = []
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between gap-4 mb-8">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900">Opportunities</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {searches.length === 0
              ? "Trips worth taking, found for you"
              : `${searches.length} search${searches.length !== 1 ? "es" : ""}`}
          </p>
        </div>
        <Link
          href="/opportunities/new"
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition-colors shrink-0"
        >
          <Plus className="w-4 h-4" />
          New search
        </Link>
      </div>

      {searches.length === 0 ? (
        <div className="text-center py-16 px-4">
          <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Sparkles className="w-8 h-8 text-indigo-600" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">Find a trip you didn&apos;t know to look for</h2>
          <p className="text-gray-500 max-w-xl mx-auto mb-6 leading-relaxed">
            Tell me when you&apos;re free, how long you&apos;d go, and who&apos;s coming. I&apos;ll look at every
            nonstop destination from your home airports across that window and surface the weekends where
            something lines up: an unusually cheap fare, a hotel rate far below public, good weather, an event
            worth planning around, or a place that fits your family especially well. Every number shows where
            it came from, and one tap builds the whole trip.
          </p>
          <Link
            href="/opportunities/new"
            className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Start a search
          </Link>
        </div>
      ) : (
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Past searches</h2>
          <div className="space-y-3">
            {searches.map((s) => (
              <SearchRow key={s.id} search={s} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function SearchRow({ search }: { search: OpportunitySearchView }) {
  const status = statusLabel(search.status)
  return (
    <Link
      href={`/opportunities/${search.id}`}
      className="block bg-white border border-gray-100 rounded-2xl p-5 hover:border-indigo-200 hover:shadow-sm transition-all group"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${status.className}`}
            >
              {status.pulse && <span className="w-1.5 h-1.5 bg-current rounded-full animate-pulse" />}
              {status.label}
            </span>
            <h3 className="font-semibold text-gray-900 truncate">
              {formatWindow(search.windowStart, search.windowEnd)}
            </h3>
          </div>
          <div className="flex items-center gap-3 text-sm text-gray-500 flex-wrap">
            <span className="flex items-center gap-1">
              <Plane className="w-3.5 h-3.5" />
              {search.originAirports.join(", ") || "Any airport"}
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              {search.nightsMin === search.nightsMax
                ? `${search.nightsMin} nights`
                : `${search.nightsMin}–${search.nightsMax} nights`}
              {search.weekdayPattern ? ` · ${weekdayPatternLabel(search.weekdayPattern)}` : ""}
            </span>
            <span className="flex items-center gap-1">
              <Users className="w-3.5 h-3.5" />
              {search.travelerProfileIds.length} traveler{search.travelerProfileIds.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-2 text-xs text-gray-400 flex-wrap">
            <span>Created {formatAgo(search.createdAt)}</span>
            {search.constraints?.nonstopOnly && <span>Nonstop only</span>}
            {search.constraints?.warm && <span>Warm</span>}
            {search.constraints?.regions && search.constraints.regions.length > 0 && (
              <span className="truncate">{search.constraints.regions.join(", ")}</span>
            )}
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-indigo-500 shrink-0 mt-1 transition-colors" />
      </div>
    </Link>
  )
}

function statusLabel(status: string): { label: string; className: string; pulse?: boolean } {
  switch (status) {
    case "DONE":
      return { label: "Ranked", className: "bg-green-50 text-green-700" }
    case "FAILED":
      return { label: "Failed", className: "bg-red-50 text-red-600" }
    case "DRAFT":
      return { label: "Draft", className: "bg-gray-100 text-gray-500" }
    default:
      return { label: "Searching", className: "bg-indigo-50 text-indigo-700", pulse: true }
  }
}

function UpgradeGate() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-8">Opportunities</h1>
      <div className="bg-white border border-gray-100 rounded-2xl p-8 text-center">
        <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Lock className="w-8 h-8 text-indigo-600" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Opportunity Discovery</h2>
        <p className="text-gray-500 max-w-md mx-auto mb-2">
          Tell me when you&apos;re free and who&apos;s coming, and I&apos;ll find the weekends where a nonstop
          fare, a hotel rate, the weather, or an event line up into a trip worth taking.
        </p>
        <p className="text-sm text-gray-400 max-w-md mx-auto mb-6">{getUpgradeMessage("opportunityDiscovery")}</p>
        <Link
          href="/settings/billing"
          className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 transition-colors"
        >
          <Sparkles className="w-4 h-4" />
          See plans
        </Link>
      </div>
    </div>
  )
}
