"use client"

/**
 * "Hotel rates from your tabs": every Hilton (Go) and Marriott (F&F) rate the
 * Go Rates extension captured for this search, grouped by destination +
 * dates. Collapsed by default to a one-line summary (cheapest private rate per
 * destination). Public rates and savings appear only when a public rate was
 * actually captured on the brand's public search, and not when that search
 * showed the private rate too (publicMatchesPrivate); nothing is estimated.
 */

import { useId, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { BedDouble, ChevronDown, ExternalLink, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { finishGoRatesCapture } from "@/lib/actions/private-rates"
import type { CapturedHotelRates, CapturedRateGroup, CaptureTabStats } from "@/lib/private-rates/captured-view"
import { SourceChip } from "../source-chip"
import { formatAgo, formatMoney, formatStayRange } from "../format"

type Brand = "hilton" | "marriott"
const BRAND_NAME: Record<Brand, string> = { hilton: "Hilton", marriott: "Marriott" }
const KIND_SHORT: Record<"GO" | "FF", string> = { GO: "Go", FF: "F&F" }

export function capturedRatesTitle(brands: readonly Brand[] | undefined): string {
  const names = (brands?.length ? brands : (["hilton"] as Brand[])).map((b) => BRAND_NAME[b])
  return `Hotel rates from your ${names.join(" & ")} tabs`
}
export const CAPTURED_RATES_TITLE = capturedRatesTitle(["hilton"])

const INFERRED_NOTE = "Go Hilton showed one price; assumed to be your Go rate"

export function publicMatchesPrivateNote(brand: Brand): string {
  return brand === "marriott"
    ? "Marriott showed your F&F rate on the public search too, so public prices weren't available."
    : "Hilton showed your Go rate on the public search too, so public prices weren't available."
}

function isInferred(label: string | undefined): boolean {
  return !!label && /inferred/i.test(label)
}

/** Cheapest private rate per destination, e.g. "Chicago from $207 · Las Vegas from $89". */
function summaryLine(groups: CapturedRateGroup[]): string {
  const best = new Map<string, { name: string; amount: number; currency: string }>()
  for (const g of groups) {
    for (const h of g.hotels) {
      if (h.privateNightly == null) continue
      const cur = best.get(g.destinationIata)
      if (!cur || h.privateNightly < cur.amount) best.set(g.destinationIata, { name: g.destinationName, amount: h.privateNightly, currency: h.currency })
    }
  }
  if (best.size === 0) return "No private rates yet, only public rates"
  return [...best.values()].map((b) => `${b.name} from ${formatMoney(b.amount, b.currency)}`).join(" · ")
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** "Hilton: 1 tab blocked, 2 with no rates · Marriott: 3 tabs blocked" (only brands with problems). */
function tabProblems(tabs: Partial<Record<Brand, CaptureTabStats>> | undefined): string | null {
  if (!tabs) return null
  const parts: string[] = []
  for (const b of ["hilton", "marriott"] as const) {
    const t = tabs[b]
    if (!t || (t.blocked === 0 && t.empty === 0)) continue
    const bits: string[] = []
    if (t.blocked > 0) bits.push(`${plural(t.blocked, "tab", "tabs")} blocked`)
    if (t.empty > 0) bits.push(`${plural(t.empty, "tab", "tabs")} with no rates`)
    parts.push(`${BRAND_NAME[b]}: ${bits.join(", ")}`)
  }
  return parts.length ? parts.join(" · ") : null
}

export function CapturedRatesPanel({ searchId, data }: { searchId: string; data: CapturedHotelRates }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [applying, startApply] = useTransition()
  const bodyId = useId()

  if (data.totalQuotes <= 0 || data.groups.length === 0) return null
  const ago = formatAgo(data.capturedAt)
  const title = capturedRatesTitle(data.brands)
  const problems = tabProblems(data.tabs)

  const handleApply = () => {
    startApply(async () => {
      try {
        const res = await finishGoRatesCapture(searchId)
        if (res.status.startsWith("FAILED")) toast.error(res.status.replace(/^FAILED:\s*/, "") || "Couldn't apply your rates")
        else toast.success(`Applied ${res.quotesUsed} hotel rate${res.quotesUsed === 1 ? "" : "s"} to your opportunities`)
      } catch {
        toast.error("Couldn't apply your rates. Please try again.")
      } finally {
        router.refresh()
      }
    })
  }

  return (
    <section className="bg-white border border-gray-100 rounded-2xl mb-6 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="w-full flex items-start gap-3 px-4 sm:px-5 py-3.5 text-left hover:bg-gray-50/60 transition-colors"
      >
        <BedDouble className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
        <span className="flex-1 min-w-0">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold text-gray-900">
              {title} ({data.totalQuotes})
            </span>
            <SourceChip source="RETRIEVED" suffix={ago || undefined} />
          </span>
          <span className="block text-xs text-gray-500 mt-0.5 break-words">{summaryLine(data.groups)}</span>
        </span>
        <ChevronDown className={cn("w-4 h-4 text-gray-400 shrink-0 mt-0.5 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div id={bodyId} className="border-t border-gray-100 px-4 sm:px-5 py-4 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
            <span>
              {data.totalHotels} hotel{data.totalHotels === 1 ? "" : "s"} across {data.groups.length} stay
              {data.groups.length === 1 ? "" : "s"}. Rates as shown in your own browser tabs.
              {problems && <span className="block text-amber-700 mt-0.5">Latest run: {problems}.</span>}
            </span>
            <button
              type="button"
              onClick={handleApply}
              disabled={applying}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {applying && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {applying ? "Applying…" : "Apply to opportunities"}
            </button>
          </div>
          {data.groups.map((g) => (
            <RateGroup key={`${g.destinationIata}|${g.checkIn}|${g.checkOut}`} group={g} />
          ))}
        </div>
      )}
    </section>
  )
}

function RateGroup({ group: g }: { group: CapturedRateGroup }) {
  const anyInferred = g.hotels.some((h) => isInferred(h.label))
  const kinds = [...new Set(g.hotels.map((h) => KIND_SHORT[h.rateLabelKind]))]
  const unreliable = (["hilton", "marriott"] as const).filter((b) => g.publicMatchesPrivate?.[b])
  return (
    <div className="min-w-0">
      <h3 className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm mb-2">
        <span className="font-semibold text-gray-900 uppercase tracking-wide">{g.destinationName}</span>
        <span className="text-gray-300">·</span>
        <span className="text-gray-700 font-medium">{formatStayRange(g.checkIn, g.checkOut)}</span>
        <span className="text-gray-300">·</span>
        <span className="text-gray-500">
          {g.nights} night{g.nights === 1 ? "" : "s"}
        </span>
      </h3>
      {/* Scrolls sideways inside itself on narrow screens; the page never does. */}
      <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400 border-b border-gray-100">
              <th scope="col" className="py-2 pr-3 font-semibold">Hotel</th>
              <th scope="col" className="py-2 px-3 font-semibold">Brand</th>
              <th scope="col" className="py-2 px-3 font-semibold text-right whitespace-nowrap">
                Private rate{kinds.length > 0 ? ` (${kinds.join(" / ")})` : ""}/night
              </th>
              <th scope="col" className="py-2 px-3 font-semibold text-right whitespace-nowrap">Public/night</th>
              <th scope="col" className="py-2 px-3 font-semibold text-right">Savings</th>
              <th scope="col" className="py-2 px-3 font-semibold text-right whitespace-nowrap">From airport</th>
              <th scope="col" className="py-2 pl-3 font-semibold">
                <span className="sr-only">Link</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {g.hotels.map((h) => (
              <tr key={`${h.brand}|${h.propertyCode}`} className="border-b border-gray-50 last:border-0 align-top">
                <td className="py-2 pr-3 min-w-0">
                  <div className="font-medium text-gray-900 break-words">{h.propertyName}</div>
                  {h.propertyBrand && <div className="text-xs text-gray-400 break-words">{h.propertyBrand}</div>}
                </td>
                <td className="py-2 px-3 whitespace-nowrap text-gray-600">{BRAND_NAME[h.brand]}</td>
                <td className="py-2 px-3 text-right whitespace-nowrap">
                  {h.privateNightly != null ? (
                    <span className="font-semibold text-gray-900">
                      {formatMoney(h.privateNightly, h.currency)}
                      <span className="ml-1 text-[11px] font-normal text-gray-400">{KIND_SHORT[h.rateLabelKind]}</span>
                      {isInferred(h.label) && (
                        <span className="text-gray-400 font-normal" title={INFERRED_NOTE}>
                          *
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="py-2 px-3 text-right whitespace-nowrap text-gray-600">
                  {h.publicNightly != null ? formatMoney(h.publicNightly, h.currency) : <span className="text-gray-400">—</span>}
                </td>
                <td className="py-2 px-3 text-right whitespace-nowrap">
                  {h.savingsPerNight != null && h.savingsPerNight > 0 ? (
                    <span className="font-medium text-emerald-700">{formatMoney(h.savingsPerNight, h.currency)}/night</span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="py-2 px-3 text-right whitespace-nowrap text-gray-500">{formatKm(h.distanceKm)}</td>
                <td className="py-2 pl-3 whitespace-nowrap">
                  {h.bookingUrl ? (
                    <a
                      href={h.bookingUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline"
                    >
                      View on {BRAND_NAME[h.brand]}
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {unreliable.map((b) => (
        <p key={b} className="mt-1.5 text-[11px] text-amber-700">
          {publicMatchesPrivateNote(b)}
        </p>
      ))}
      {anyInferred && <p className="mt-1.5 text-[11px] text-gray-400">* {INFERRED_NOTE}</p>}
    </div>
  )
}

function formatKm(km: number): string {
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`
}
