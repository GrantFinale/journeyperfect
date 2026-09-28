/**
 * Price-watch cron endpoint. Re-prices every tracked FlightSearch not checked
 * within `flights.checkIntervalHours`, records a FlightPricePoint, and sends a
 * "flight_alert" notification + email on a qualifying drop.
 *
 * Trigger: GitHub Actions (.github/workflows/flight-prices.yml) or a Coolify
 * scheduled task; see docs/ops/cron.md. Guarded by `Authorization: Bearer
 * $CRON_SECRET`; returns 503 when the secret is not configured so a
 * misconfigured deploy fails loudly rather than open.
 */
import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import { getConfigKeyNumber } from "@/lib/config-keys"
import { getFlightProvider, isProviderNotConfigured } from "@/lib/flights"
import { runFlightWatches } from "@/lib/flights/watch-runner"
import { createPrismaWatchStore } from "@/lib/flights/watch-store"

export const dynamic = "force-dynamic"
export const maxDuration = 300

function authorise(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 })
  const header = req.headers.get("authorization") ?? ""
  if (!bearerMatches(header, secret)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  return null
}

/** Constant-time comparison; lengths are checked first because timingSafeEqual requires equal buffers. */
function bearerMatches(header: string, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`)
  const actual = Buffer.from(header)
  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}

async function handle(req: Request) {
  const denied = authorise(req)
  if (denied) return denied

  try {
    const url = new URL(req.url)
    const dryRun = url.searchParams.get("dryRun") === "1"
    const provider = await getFlightProvider()
    const checkIntervalHours = await getConfigKeyNumber("flights.checkIntervalHours")

    if (dryRun) {
      return NextResponse.json({ ok: true, dryRun: true, provider: provider.id, checkIntervalHours })
    }

    const summary = await runFlightWatches({
      provider,
      store: createPrismaWatchStore(),
      checkIntervalHours,
      batchSize: 20,
      delayMs: 250,
    })
    if (summary.failed > 0) console.warn("[cron/flight-prices] failures:", summary.errors)
    return NextResponse.json(summary, { status: summary.ok ? 200 : 503 })
  } catch (err) {
    console.error("[cron/flight-prices] run failed:", err)
    const status = isProviderNotConfigured(err) ? 503 : 500
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" }, { status })
  }
}

export async function GET(req: Request) {
  return handle(req)
}

export async function POST(req: Request) {
  return handle(req)
}
