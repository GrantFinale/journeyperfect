/**
 * Turn nonstop offers into NonstopRoute observations for the Opportunity
 * Discovery Engine's stage 0 (docs/plans/opportunity-discovery-engine.md).
 * PURE; the Prisma upsert lives in ./index.ts.
 */
import type { FlightItinerary, FlightOfferResult } from "./types"

export type DepartureBucket = "EARLY" | "MORNING" | "MIDDAY" | "EVENING"

export interface NonstopObservation {
  originIata: string
  destIata: string
  carriers: string[]
  typicalDurationMins: number
  departureBuckets: DepartureBucket[]
}

/** Hour of a local ISO string -> bucket. EARLY <7, MORNING <12, MIDDAY <17, else EVENING. */
export function departureBucket(localIso: string): DepartureBucket | null {
  const m = /[T ](\d{2}):/.exec(localIso)
  if (!m) return null
  const hour = parseInt(m[1], 10)
  if (!Number.isFinite(hour)) return null
  if (hour < 7) return "EARLY"
  if (hour < 12) return "MORNING"
  if (hour < 17) return "MIDDAY"
  return "EVENING"
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

function collect(
  acc: Map<string, { carriers: Set<string>; durations: number[]; buckets: Set<DepartureBucket> }>,
  itin: FlightItinerary | undefined
) {
  if (!itin || itin.stops !== 0 || itin.segments.length !== 1) return
  const seg = itin.segments[0]
  const from = seg.from?.trim().toUpperCase()
  const to = seg.to?.trim().toUpperCase()
  if (!from || !to || from === to) return
  const key = `${from}-${to}`
  const entry = acc.get(key) ?? { carriers: new Set<string>(), durations: [], buckets: new Set<DepartureBucket>() }
  if (seg.carrier) entry.carriers.add(seg.carrier.trim().toUpperCase())
  const dur = seg.durationMins || itin.durationMins
  if (dur > 0) entry.durations.push(dur)
  const bucket = departureBucket(seg.departAt)
  if (bucket) entry.buckets.add(bucket)
  acc.set(key, entry)
}

/**
 * Group the nonstop (stops === 0, single segment) legs of `offers` by
 * origin/destination pair. Both directions of a round trip are observed.
 */
export function summariseNonstopObservations(offers: readonly FlightOfferResult[]): NonstopObservation[] {
  const acc = new Map<string, { carriers: Set<string>; durations: number[]; buckets: Set<DepartureBucket> }>()
  for (const offer of offers) {
    collect(acc, offer.outbound)
    collect(acc, offer.inbound)
  }
  const out: NonstopObservation[] = []
  for (const [key, entry] of acc) {
    if (entry.durations.length === 0) continue
    const [originIata, destIata] = key.split("-")
    out.push({
      originIata,
      destIata,
      carriers: [...entry.carriers].sort(),
      typicalDurationMins: median(entry.durations),
      departureBuckets: [...entry.buckets].sort(),
    })
  }
  return out
}

export function unionSorted(a: readonly string[], b: readonly string[]): string[] {
  return [...new Set([...a, ...b])].sort()
}
