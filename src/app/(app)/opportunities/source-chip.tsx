import { cn } from "@/lib/utils"
import type { FactorSource } from "@/lib/opportunities/types"

const LABELS: Record<FactorSource, string> = {
  RETRIEVED: "retrieved",
  ESTIMATED: "estimated",
  HISTORICAL: "typical",
  UNKNOWN: "unknown",
}

/**
 * Muted provenance label for a number. Plan §9: every value carries its
 * source, and a HISTORICAL average never appears without the word "typical".
 */
export function SourceChip({
  source,
  className,
  suffix,
}: {
  source: FactorSource
  className?: string
  /** e.g. "2h ago" — rendered after the label in the same chip */
  suffix?: string | null
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-px rounded text-[10px] font-medium uppercase tracking-wide whitespace-nowrap shrink-0",
        source === "RETRIEVED" && "bg-emerald-50 text-emerald-700",
        source === "ESTIMATED" && "bg-gray-100 text-gray-500",
        source === "HISTORICAL" && "bg-amber-50 text-amber-700",
        source === "UNKNOWN" && "bg-gray-100 text-gray-400",
        className
      )}
      title={sourceTitle(source)}
    >
      {LABELS[source]}
      {suffix && <span className="normal-case tracking-normal font-normal opacity-80">{suffix}</span>}
    </span>
  )
}

function sourceTitle(source: FactorSource) {
  switch (source) {
    case "RETRIEVED":
      return "Live value retrieved from a provider"
    case "ESTIMATED":
      return "Estimated from typical costs, not a quote"
    case "HISTORICAL":
      return "Typical for this time of year, not a forecast"
    default:
      return "Source unknown"
  }
}
