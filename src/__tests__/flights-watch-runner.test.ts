import { describe, it, expect, vi } from "vitest"
import { buildAlertMessage, runFlightWatches, watchLink, type WatchAlert, type WatchCheckResult, type WatchRecord, type WatchStore } from "@/lib/flights/watch-runner"
import type { FlightProvider } from "@/lib/flights/provider"
import type { FlightOfferResult, FlightQuery, ProviderSearchResult } from "@/lib/flights/types"
import { ProviderNotConfiguredError } from "@/lib/flights/errors"

const NOW = new Date("2026-09-27T09:00:00.000Z")

const baseQuery: FlightQuery = {
  origin: "DTW",
  destination: "MCO",
  departDate: "2026-12-01",
  returnDate: "2026-12-08",
  cabin: "economy",
  adults: 1,
  children: 0,
  currency: "USD",
}

function watch(overrides: Partial<WatchRecord> = {}): WatchRecord {
  return {
    id: "w1",
    userId: "u1",
    tripId: "t1",
    query: baseQuery,
    targetPrice: null,
    lastPrice: null,
    lowestPrice: null,
    lastCheckedAt: null,
    ...overrides,
  }
}

function offer(price: number): FlightOfferResult {
  return {
    provider: "fake",
    totalPrice: price,
    currency: "USD",
    carrierCodes: ["DL"],
    stops: 0,
    durationMins: 170,
    outbound: { segments: [], durationMins: 170, stops: 0 },
    bookingUrl: "https://example.test",
  }
}

function fakeProvider(prices: Record<string, number[] | Error>): FlightProvider & { calls: string[] } {
  const calls: string[] = []
  return {
    id: "fake",
    supportsBooking: false,
    calls,
    async search(q): Promise<ProviderSearchResult> {
      const key = `${q.origin}-${q.destination}-${q.departDate}`
      calls.push(key)
      const v = prices[key] ?? []
      if (v instanceof Error) throw v
      return { offers: v.map(offer), retrievedAt: NOW.toISOString(), fromCache: false }
    },
  }
}

function fakeStore(watches: WatchRecord[]) {
  const checks: { watch: WatchRecord; result: WatchCheckResult }[] = []
  const alerts: { watch: WatchRecord; alert: WatchAlert }[] = []
  const expired: string[] = []
  const listCalls: { cutoff: Date; take: number; afterId?: string }[] = []
  const store: WatchStore = {
    async listDue(opts) {
      listCalls.push(opts)
      return watches
        .filter((w) => !w.lastCheckedAt || w.lastCheckedAt < opts.cutoff)
        .filter((w) => !opts.afterId || w.id > opts.afterId)
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, opts.take)
    },
    async recordCheck(w, result) {
      checks.push({ watch: w, result })
    },
    async notify(w, alert) {
      alerts.push({ watch: w, alert })
    },
    async expire(w) {
      expired.push(w.id)
    },
  }
  return { store, checks, alerts, expired, listCalls }
}

describe("runFlightWatches", () => {
  it("checks due watches, records the lowest price, and alerts on a target hit", async () => {
    const w = watch({ targetPrice: 250, lastPrice: 300, lowestPrice: 280 })
    const { store, checks, alerts } = fakeStore([w])
    const provider = fakeProvider({ "DTW-MCO-2026-12-01": [312, 240, 299] })

    const summary = await runFlightWatches({ provider, store, checkIntervalHours: 24, now: () => NOW })

    expect(summary).toMatchObject({ ok: true, provider: "fake", scanned: 1, checked: 1, alerted: 1, failed: 0, skipped: 0, expired: 0 })
    expect(checks).toHaveLength(1)
    expect(checks[0].result.price).toBe(240)
    expect(checks[0].result.offers).toHaveLength(3)
    expect(checks[0].result.provider).toBe("fake")
    expect(alerts).toHaveLength(1)
    expect(alerts[0].alert.reason).toBe("TARGET_HIT")
    expect(alerts[0].alert.price).toBe(240)
    expect(alerts[0].alert.previousPrice).toBe(300)
    expect(alerts[0].alert.message.link).toBe("/trip/t1/flights?search=w1")
  })

  it("does not alert when the price is not notable, and records null when no offers", async () => {
    const steady = watch({ id: "a", lastPrice: 300, lowestPrice: 280 })
    const empty = watch({ id: "b", query: { ...baseQuery, destination: "LAS" } })
    const { store, checks, alerts } = fakeStore([steady, empty])
    const provider = fakeProvider({ "DTW-MCO-2026-12-01": [305], "DTW-LAS-2026-12-01": [] })

    const summary = await runFlightWatches({ provider, store, checkIntervalHours: 24, now: () => NOW })

    expect(summary.checked).toBe(2)
    expect(summary.alerted).toBe(0)
    expect(alerts).toHaveLength(0)
    expect(checks.find((c) => c.watch.id === "b")!.result.price).toBeNull()
  })

  it("skips watches checked within the interval and expires past departures", async () => {
    const fresh = watch({ id: "a", lastCheckedAt: new Date(NOW.getTime() - 2 * 3600 * 1000) })
    const past = watch({ id: "b", query: { ...baseQuery, departDate: "2026-09-01", returnDate: undefined } })
    const due = watch({ id: "c", lastCheckedAt: new Date(NOW.getTime() - 30 * 3600 * 1000) })
    const { store, checks, expired, listCalls } = fakeStore([fresh, past, due])
    const provider = fakeProvider({ "DTW-MCO-2026-12-01": [200] })

    const summary = await runFlightWatches({ provider, store, checkIntervalHours: 24, now: () => NOW })

    expect(listCalls[0].cutoff.toISOString()).toBe("2026-09-26T09:00:00.000Z")
    expect(summary.scanned).toBe(2) // the store filtered out "a"
    expect(summary.expired).toBe(1)
    expect(expired).toEqual(["b"])
    expect(summary.checked).toBe(1)
    expect(checks[0].watch.id).toBe("c")
    expect(provider.calls).toEqual(["DTW-MCO-2026-12-01"])
  })

  it("pages through the store in batches and keeps going after one watch fails", async () => {
    const watches = Array.from({ length: 45 }, (_, i) => {
      const id = `w${String(i).padStart(3, "0")}`
      const destination = i === 7 ? "ERR" : "MCO"
      return watch({ id, query: { ...baseQuery, destination }, lastPrice: 400, lowestPrice: 350 })
    })
    const { store, checks, alerts, listCalls } = fakeStore(watches)
    const provider = fakeProvider({ "DTW-MCO-2026-12-01": [300], "DTW-ERR-2026-12-01": new Error("boom") })

    const summary = await runFlightWatches({ provider, store, checkIntervalHours: 24, batchSize: 20, now: () => NOW })

    expect(listCalls.map((c) => c.take)).toEqual([20, 20, 20])
    expect(listCalls[1].afterId).toBe("w019")
    expect(summary.scanned).toBe(45)
    expect(summary.checked).toBe(44)
    expect(summary.failed).toBe(1)
    expect(summary.errors).toEqual([{ watchId: "w007", error: "boom" }])
    expect(summary.ok).toBe(true)
    expect(checks).toHaveLength(44)
    // 300 < lowest 350 -> NEW_LOW on every successful watch
    expect(alerts).toHaveLength(44)
    expect(alerts.every((a) => a.alert.reason === "NEW_LOW")).toBe(true)
  })

  it("aborts the run when the provider is not configured", async () => {
    const { store, checks } = fakeStore([watch({ id: "a" }), watch({ id: "b" })])
    const provider: FlightProvider = {
      id: "serpapi",
      supportsBooking: false,
      search: vi.fn(async () => {
        throw new ProviderNotConfiguredError("serpapi", "api.serpapi.key")
      }),
    }

    const summary = await runFlightWatches({ provider, store, checkIntervalHours: 24, now: () => NOW })

    expect(summary.ok).toBe(false)
    expect(summary.failed).toBe(1)
    expect(summary.scanned).toBe(1)
    expect(provider.search).toHaveBeenCalledTimes(1)
    expect(checks).toHaveLength(0)
    expect(summary.errors[0].error).toMatch(/api\.serpapi\.key/)
  })

  it("honours maxWatches", async () => {
    const watches = Array.from({ length: 10 }, (_, i) => watch({ id: `w${i}` }))
    const { store } = fakeStore(watches)
    const provider = fakeProvider({ "DTW-MCO-2026-12-01": [100] })
    const summary = await runFlightWatches({ provider, store, checkIntervalHours: 24, batchSize: 4, maxWatches: 6, now: () => NOW })
    expect(summary.checked).toBe(6)
  })
})

describe("buildAlertMessage", () => {
  it("names the route, reason and price, and links to the trip flights page", () => {
    const w = watch({ targetPrice: 250, lastPrice: 300 })
    const m = buildAlertMessage(w, 240, "USD", "TARGET_HIT", 300)
    expect(m.title).toBe("DTW ⇄ MCO hit your target price: $240")
    expect(m.message).toContain("2026-12-01 to 2026-12-08")
    expect(m.message).toContain("(was $300)")
    expect(m.message).toContain("Your target was $250")
    expect(m.subject).toBe("Flight alert: DTW ⇄ MCO hit your target price: $240")
    expect(m.link).toBe("/trip/t1/flights?search=w1")
    expect(m.html).toContain("https://journeyperfect.com/trip/t1/flights?search=w1")
  })

  it("uses an arrow for one-way and the dashboard for speculative watches", () => {
    const w = watch({ tripId: null, query: { ...baseQuery, returnDate: undefined } })
    const m = buildAlertMessage(w, 199, "USD", "NEW_LOW", null)
    expect(m.title).toBe("DTW → MCO is at a new low: $199")
    expect(m.message).not.toContain("(was")
    expect(watchLink(w)).toBe("/dashboard")
  })
})
