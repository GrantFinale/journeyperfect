/**
 * The price-watch loop, written against a `WatchStore` interface and a
 * `FlightProvider` so it runs in Vitest with fakes and in the cron route with
 * Prisma (./watch-store.ts). PURE apart from the injected dependencies.
 * See docs/plans/flights-search-tracking-and-booking.md §4.3.
 */
import type { FlightProvider } from "./provider"
import type { FlightOfferResult, FlightQuery, PriceInsight } from "./types"
import { shouldAlert, type AlertReason } from "./pricing"
import { lowestOfferPrice } from "./rows"
import { isProviderNotConfigured } from "./errors"

export interface WatchRecord {
  id: string
  userId: string
  tripId: string | null
  query: FlightQuery
  targetPrice: number | null
  lastPrice: number | null
  lowestPrice: number | null
  lastCheckedAt: Date | null
}

export interface WatchCheckResult {
  /** Lowest offer price this run, or null when no offers came back. */
  price: number | null
  currency: string
  provider: string
  insight?: PriceInsight
  retrievedAt: Date
  offers: FlightOfferResult[]
}

export interface AlertMessage {
  title: string
  message: string
  subject: string
  html: string
  link: string
}

export interface WatchAlert {
  reason: AlertReason
  price: number
  currency: string
  previousPrice: number | null
  message: AlertMessage
}

export interface WatchStore {
  /** Tracked watches not checked since `cutoff`, ordered by id, `take` at a time, after `afterId`. */
  listDue(opts: { cutoff: Date; take: number; afterId?: string }): Promise<WatchRecord[]>
  /** Persist offers + price point and roll lastPrice/lowestPrice/lastCheckedAt forward. */
  recordCheck(watch: WatchRecord, result: WatchCheckResult): Promise<void>
  /** Create the Notification (+ email) for an alert. */
  notify(watch: WatchRecord, alert: WatchAlert): Promise<void>
  /** Optional: stop tracking a watch whose departure date has passed. */
  expire?(watch: WatchRecord): Promise<void>
}

export interface WatchRunOptions {
  provider: FlightProvider
  store: WatchStore
  /** Minimum hours between checks (`flights.checkIntervalHours`). */
  checkIntervalHours: number
  /** Watches fetched per store call. Default 20. */
  batchSize?: number
  /** Safety cap on watches processed in one run. Default 500. */
  maxWatches?: number
  now?: () => Date
  /** Optional pause between provider calls (ms), to be polite to the vendor. */
  delayMs?: number
}

export interface WatchRunSummary {
  ok: boolean
  provider: string
  startedAt: string
  finishedAt: string
  scanned: number
  checked: number
  skipped: number
  expired: number
  alerted: number
  failed: number
  errors: { watchId: string | null; error: string }[]
}

const REASON_LABEL: Record<AlertReason, string> = {
  TARGET_HIT: "hit your target price",
  NEW_LOW: "is at a new low",
  DROP_10PCT: "dropped more than 10%",
}

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `${currency} ${Math.round(amount)}`
  }
}

function routeLabel(q: FlightQuery): string {
  return `${q.origin.toUpperCase()} ${q.returnDate ? "⇄" : "→"} ${q.destination.toUpperCase()}`
}

/** The link the alert should open: the trip's flights page, or the dashboard for speculative watches. */
export function watchLink(watch: Pick<WatchRecord, "tripId" | "id">): string {
  return watch.tripId ? `/trip/${watch.tripId}/flights?search=${watch.id}` : `/dashboard`
}

/** Build the in-app notification and email copy for an alert. PURE. */
export function buildAlertMessage(watch: WatchRecord, price: number, currency: string, reason: AlertReason, previousPrice: number | null): AlertMessage {
  const route = routeLabel(watch.query)
  const dates = watch.query.returnDate ? `${watch.query.departDate} to ${watch.query.returnDate}` : watch.query.departDate
  const title = `${route} ${REASON_LABEL[reason]}: ${money(price, currency)}`
  const delta = previousPrice !== null && previousPrice > price ? ` (was ${money(previousPrice, currency)})` : ""
  const target = reason === "TARGET_HIT" && watch.targetPrice !== null ? ` Your target was ${money(watch.targetPrice, currency)}.` : ""
  const message = `Fares for ${route} on ${dates} are now ${money(price, currency)}${delta}.${target} Prices are indicative; confirm with the seller before booking.`
  const link = watchLink(watch)
  const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #4f46e5; padding: 24px; text-align: center; border-radius: 12px 12px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 24px;">Flight price alert</h1>
        </div>
        <div style="padding: 24px; background: #f9fafb; border-radius: 0 0 12px 12px;">
          <h2 style="color: #111827;">${route} · ${money(price, currency)}</h2>
          <p style="color: #4b5563;">${message}</p>
          <a href="https://journeyperfect.com${link}" style="display: inline-block; background: #4f46e5; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 16px;">View flights</a>
          <p style="color: #9ca3af; font-size: 12px; margin-top: 16px;">You are receiving this because you are tracking this route in JourneyPerfect. Stop tracking from the trip's Flights page.</p>
        </div>
      </div>
    `
  return { title, message, subject: `Flight alert: ${title}`, html, link }
}

function isoDateOf(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Run every due watch once. Never throws for a single watch's failure; only a
 * missing provider credential aborts the run (every watch would fail the same
 * way, and each attempt would otherwise be logged as an error).
 */
export async function runFlightWatches(opts: WatchRunOptions): Promise<WatchRunSummary> {
  const now = opts.now ?? (() => new Date())
  const startedAt = now()
  const batchSize = Math.max(1, opts.batchSize ?? 20)
  const maxWatches = Math.max(1, opts.maxWatches ?? 500)
  const intervalHours = Number.isFinite(opts.checkIntervalHours) && opts.checkIntervalHours > 0 ? opts.checkIntervalHours : 24
  const cutoff = new Date(startedAt.getTime() - intervalHours * 3600 * 1000)
  const today = isoDateOf(startedAt)

  const summary: WatchRunSummary = {
    ok: true,
    provider: opts.provider.id,
    startedAt: startedAt.toISOString(),
    finishedAt: startedAt.toISOString(),
    scanned: 0,
    checked: 0,
    skipped: 0,
    expired: 0,
    alerted: 0,
    failed: 0,
    errors: [],
  }

  let afterId: string | undefined
  let aborted = false
  while (!aborted && summary.scanned < maxWatches) {
    const batch = await opts.store.listDue({ cutoff, take: batchSize, afterId })
    if (batch.length === 0) break
    for (const watch of batch) {
      afterId = watch.id
      summary.scanned++
      if (summary.scanned > maxWatches) break

      // Belt and braces: the store filters on cutoff, but a watch checked by
      // a concurrent run (or a user search) since listing should be skipped.
      if (watch.lastCheckedAt && watch.lastCheckedAt > cutoff) {
        summary.skipped++
        continue
      }
      if (watch.query.departDate < today) {
        summary.expired++
        try {
          await opts.store.expire?.(watch)
        } catch (err) {
          summary.errors.push({ watchId: watch.id, error: `expire: ${errMessage(err)}` })
        }
        continue
      }

      try {
        const result = await opts.provider.search(watch.query)
        const price = lowestOfferPrice(result.offers)
        const currency = result.offers[0]?.currency ?? watch.query.currency
        await opts.store.recordCheck(watch, {
          price,
          currency,
          provider: opts.provider.id,
          insight: result.insight,
          retrievedAt: new Date(result.retrievedAt),
          offers: result.offers,
        })
        summary.checked++

        if (price !== null) {
          const decision = shouldAlert(watch, price)
          if (decision.alert && decision.reason) {
            const message = buildAlertMessage(watch, price, currency, decision.reason, watch.lastPrice)
            await opts.store.notify(watch, { reason: decision.reason, price, currency, previousPrice: watch.lastPrice, message })
            summary.alerted++
          }
        }
      } catch (err) {
        summary.failed++
        summary.errors.push({ watchId: watch.id, error: errMessage(err) })
        if (isProviderNotConfigured(err)) {
          summary.ok = false
          aborted = true
          break
        }
      }

      if (opts.delayMs && opts.delayMs > 0) await new Promise((r) => setTimeout(r, opts.delayMs))
    }
    if (batch.length < batchSize) break
  }

  summary.finishedAt = now().toISOString()
  return summary
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
