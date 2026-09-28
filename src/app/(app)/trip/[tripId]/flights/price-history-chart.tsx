"use client"

import { useMemo, useRef, useState } from "react"
import { format } from "date-fns"
import { cn, formatCurrency } from "@/lib/utils"

export type PricePoint = { price: number; currency: string; capturedAt: string }

interface PriceHistoryChartProps {
  points: PricePoint[]
  targetPrice?: number | null
  currency?: string
  className?: string
}

const HEIGHT = 72
const PAD_X = 8
const PAD_Y = 8
const MIN_WIDTH = 280
/** Horizontal room per check; the container scrolls once there are many. */
const STEP = 28

function whenLabel(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : format(d, "MMM d, h:mm a")
}

/**
 * Inline SVG sparkline of the prices we have captured for one search. One
 * series, one hue (the app's indigo), a 2px line, direct labels only on the
 * lowest and latest points, and a dashed target line when the user set one.
 * A hover tooltip and a collapsed table give every value a non-visual path.
 */
export function PriceHistoryChart({ points, targetPrice, currency, className }: PriceHistoryChartProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)

  const sorted = useMemo(
    () =>
      points
        .filter((p) => Number.isFinite(p.price))
        .slice()
        .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)),
    [points]
  )
  const cur = currency ?? sorted[0]?.currency ?? "USD"
  const n = sorted.length

  if (n === 0) {
    return <p className={cn("text-xs text-gray-400", className)}>No price checks recorded yet.</p>
  }

  const prices = sorted.map((p) => p.price)
  const minPrice = Math.min(...prices)
  const maxPrice = Math.max(...prices)
  const latest = sorted[n - 1]
  const first = sorted[0]
  const delta = latest.price - first.price
  const minIdx = prices.indexOf(minPrice)

  if (n === 1) {
    return (
      <div className={cn("text-xs text-gray-500", className)}>
        <span className="font-semibold text-gray-900 tabular-nums">{formatCurrency(latest.price, cur)}</span>{" "}
        checked {whenLabel(latest.capturedAt)}. The trend line appears after the next check.
      </div>
    )
  }

  let lo = minPrice
  let hi = maxPrice
  if (targetPrice != null && Number.isFinite(targetPrice)) {
    lo = Math.min(lo, targetPrice)
    hi = Math.max(hi, targetPrice)
  }
  if (hi === lo) {
    hi += 1
    lo -= 1
  }

  const width = Math.max(MIN_WIDTH, PAD_X * 2 + (n - 1) * STEP)
  const x = (i: number) => PAD_X + (i * (width - PAD_X * 2)) / (n - 1)
  const y = (p: number) => PAD_Y + (1 - (p - lo) / (hi - lo)) * (HEIGHT - PAD_Y * 2)
  const path = sorted
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.price).toFixed(1)}`)
    .join(" ")

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    const px = ((e.clientX - rect.left) / rect.width) * width
    let best = 0
    let bestDist = Infinity
    for (let i = 0; i < n; i++) {
      const d = Math.abs(x(i) - px)
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    }
    setHover(best)
  }

  const hovered = hover != null ? sorted[hover] : null

  return (
    <div className={className}>
      {/* Stat row — text in text tokens, colour only on the delta glyph+number */}
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs mb-2">
        <div>
          <span className="text-gray-400">Latest </span>
          <span className="font-semibold text-gray-900 tabular-nums">{formatCurrency(latest.price, cur)}</span>
          {delta !== 0 && (
            <span
              className={cn(
                "ml-1 tabular-nums font-medium",
                delta < 0 ? "text-emerald-600" : "text-red-600"
              )}
            >
              {delta < 0 ? "↓" : "↑"} {formatCurrency(Math.abs(delta), cur)}
            </span>
          )}
        </div>
        <div>
          <span className="text-gray-400">Lowest </span>
          <span className="font-semibold text-gray-900 tabular-nums">{formatCurrency(minPrice, cur)}</span>
        </div>
        <div>
          <span className="text-gray-400">Highest </span>
          <span className="font-semibold text-gray-900 tabular-nums">{formatCurrency(maxPrice, cur)}</span>
        </div>
        {targetPrice != null && (
          <div>
            <span className="text-gray-400">Target </span>
            <span className="font-semibold text-gray-900 tabular-nums">{formatCurrency(targetPrice, cur)}</span>
          </div>
        )}
      </div>

      {/* The only thing on the page allowed to scroll sideways */}
      <div className="relative overflow-x-auto overflow-y-hidden -mx-1 px-1" onMouseLeave={() => setHover(null)}>
        <svg
          ref={svgRef}
          role="img"
          aria-label={`Price history: ${n} checks, lowest ${formatCurrency(minPrice, cur)}, latest ${formatCurrency(latest.price, cur)}`}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          width={width}
          height={HEIGHT}
          className="block max-w-none"
          onMouseMove={handleMove}
        >
          {targetPrice != null && Number.isFinite(targetPrice) && (
            <line
              x1={PAD_X}
              x2={width - PAD_X}
              y1={y(targetPrice)}
              y2={y(targetPrice)}
              stroke="#d1d5db"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}
          <path d={path} fill="none" stroke="#6366f1" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {/* Crosshair for the hovered check */}
          {hover != null && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD_Y / 2}
              y2={HEIGHT - PAD_Y / 2}
              stroke="#e5e7eb"
              strokeWidth={1}
            />
          )}
          {/* Markers only where they say something: the low and the latest */}
          {[minIdx, n - 1].map((i) => (
            <circle
              key={i}
              cx={x(i)}
              cy={y(prices[i])}
              r={4}
              fill={i === minIdx && i !== n - 1 ? "#10b981" : "#6366f1"}
              stroke="#ffffff"
              strokeWidth={2}
            />
          ))}
          {hover != null && (
            <circle cx={x(hover)} cy={y(prices[hover])} r={5} fill="#ffffff" stroke="#6366f1" strokeWidth={2} />
          )}
          {/* Wide invisible hit targets, one per check */}
          {sorted.map((_, i) => (
            <rect
              key={i}
              x={x(i) - STEP / 2}
              y={0}
              width={STEP}
              height={HEIGHT}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}
        </svg>

        {hovered && hover != null && (
          <div
            className="pointer-events-none absolute top-0 -translate-x-1/2 bg-gray-900 text-white text-[11px] rounded-lg px-2 py-1 shadow-md whitespace-nowrap"
            style={{ left: `${x(hover) + 4}px` }}
          >
            <span className="font-semibold tabular-nums">{formatCurrency(hovered.price, cur)}</span>
            <span className="text-gray-300"> · {whenLabel(hovered.capturedAt)}</span>
          </div>
        )}
      </div>

      <div className="flex justify-between text-[10px] text-gray-400 mt-1 tabular-nums">
        <span>{whenLabel(first.capturedAt)}</span>
        <span>{whenLabel(latest.capturedAt)}</span>
      </div>

      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-gray-400 hover:text-gray-600 select-none">Show as table</summary>
        <table className="mt-1 w-full text-left">
          <thead>
            <tr className="text-gray-400">
              <th className="font-medium py-0.5">Checked</th>
              <th className="font-medium py-0.5 text-right">Price</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p, i) => (
              <tr key={`${p.capturedAt}-${i}`} className="text-gray-700">
                <td className="py-0.5">{whenLabel(p.capturedAt)}</td>
                <td className="py-0.5 text-right tabular-nums">{formatCurrency(p.price, cur)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}
