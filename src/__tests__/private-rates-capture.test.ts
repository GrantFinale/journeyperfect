import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  CaptureCounter,
  MAX_CAPTURE_BODY_BYTES,
  namePropertyCode,
  nightsBetween,
  normaliseObservations,
  parseCaptureBody,
  type CaptureObservation,
} from "@/lib/private-rates/capture"
import { evaluateHotelValue } from "@/lib/opportunities/factors/hotel-value"

// ─── Route mocks ────────────────────────────────────────────────────────────

const db = vi.hoisted(() => ({
  candidateFindFirst: vi.fn(),
  deleteMany: vi.fn(),
  createMany: vi.fn(),
  transaction: vi.fn(),
}))
const gates = vi.hoisted(() => ({ assertEnabledAndEntitled: vi.fn(), audit: vi.fn() }))

vi.mock("@/lib/db", () => ({
  prisma: {
    opportunityCandidate: { findFirst: db.candidateFindFirst },
    hotelRateQuote: { deleteMany: db.deleteMany, createMany: db.createMany },
    $transaction: db.transaction,
  },
}))
vi.mock("@/lib/private-rates", () => {
  class PrivateRatesGateError extends Error {
    constructor(readonly reason: string) {
      super(reason)
    }
  }
  return {
    DEFAULT_PROVIDER: "hilton",
    PrivateRatesGateError,
    assertEnabledAndEntitled: gates.assertEnabledAndEntitled,
    audit: gates.audit,
  }
})

// ─── Pure helpers ───────────────────────────────────────────────────────────

const obs = (over: Partial<CaptureObservation> = {}): CaptureObservation => ({
  propertyName: "Conrad Chicago",
  nightlyRate: 120,
  currency: "usd",
  rateKind: "PRIVATE_HILTON_GO",
  available: true,
  ...over,
})

function body(over: Record<string, unknown> = {}) {
  return {
    token: "t",
    itemKey: "ORD|2026-11-06|2026-11-08",
    pageUrl: "https://www.hilton.com/en/search/?query=Chicago",
    capturedAt: "2026-10-02T12:00:00.000Z",
    pageKind: "SEARCH",
    observations: [obs()],
    ...over,
  }
}

describe("parseCaptureBody", () => {
  it("accepts a valid body", () => {
    const r = parseCaptureBody(body())
    expect(r.ok).toBe(true)
  })

  it.each([
    ["too many observations", { observations: Array.from({ length: 61 }, () => obs()) }],
    ["zero rate", { observations: [obs({ nightlyRate: 0 })] }],
    ["huge rate", { observations: [obs({ nightlyRate: 100_000 })] }],
    ["bad total", { observations: [obs({ totalRate: -5 })] }],
    ["bad currency", { observations: [obs({ currency: "US" })] }],
    ["long name", { observations: [obs({ propertyName: "x".repeat(201) })] }],
    ["empty name", { observations: [obs({ propertyName: "  " })] }],
    ["bad rateKind", { observations: [{ ...obs(), rateKind: "MEMBER" }] }],
    ["bad pageKind", { pageKind: "HOME" }],
    ["bad capturedAt", { capturedAt: "yesterday" }],
    ["bad lat", { observations: [obs({ lat: 91, lng: 0 })] }],
    ["missing token", { token: undefined }],
  ])("rejects %s", (_label, over) => {
    const r = parseCaptureBody(body(over as Record<string, unknown>))
    expect(r.ok).toBe(false)
  })
})

describe("normaliseObservations", () => {
  const item = { checkIn: "2026-11-06", checkOut: "2026-11-08", lat: 41.88, lng: -87.63 }

  it("uses the item's dates, fills total = nightly × nights, upper-cases currency", () => {
    const [q] = normaliseObservations([obs({ propertyCode: "CHICNCI" })], item)
    expect(q).toMatchObject({
      propertyCode: "CHICNCI",
      checkIn: "2026-11-06",
      checkOut: "2026-11-08",
      nightlyRate: 120,
      totalRate: 240,
      currency: "USD",
      lat: 41.88,
      lng: -87.63,
      roomType: null,
    })
  })

  it("keeps an explicit total and the observation's coordinates", () => {
    const [q] = normaliseObservations([obs({ totalRate: 260.5, lat: 41.9, lng: -87.62, rateLabel: "King Room" })], item)
    expect(q).toMatchObject({ totalRate: 260.5, lat: 41.9, lng: -87.62, roomType: "King Room" })
  })

  it("derives a stable name: code when the page gave none", () => {
    const [a] = normaliseObservations([obs({ lat: 41.9, lng: -87.62 })], item)
    const [b] = normaliseObservations([obs({ lat: 41.9, lng: -87.62, rateKind: "PUBLIC" })], item)
    expect(a.propertyCode).toBe("name:conrad-chicago@41.900,-87.620")
    expect(b.propertyCode).toBe(a.propertyCode) // private + public pair up
    expect(namePropertyCode("Hôtel Ñandú!")).toBe("name:hotel-nandu")
  })

  it("dedupes exact repeats but keeps different rooms and kinds", () => {
    const rows = normaliseObservations(
      [
        obs({ propertyCode: "A" }),
        obs({ propertyCode: "A" }),
        obs({ propertyCode: "A", rateLabel: "Suite", nightlyRate: 300 }),
        obs({ propertyCode: "A", rateKind: "PUBLIC", nightlyRate: 200 }),
      ],
      item,
    )
    expect(rows).toHaveLength(3)
  })

  it("counts nights from the dates", () => {
    expect(nightsBetween("2026-11-06", "2026-11-08")).toBe(2)
    expect(nightsBetween("2026-11-06", "2026-11-06")).toBe(1)
  })
})

describe("CaptureCounter", () => {
  it("allows exactly the limit per token", () => {
    const c = new CaptureCounter(3)
    const exp = Math.floor(Date.now() / 1000) + 600
    expect([1, 2, 3, 4].map(() => c.take("n1", exp))).toEqual([true, true, true, false])
    expect(c.take("n2", exp)).toBe(true)
  })
})

describe("hotel value never invents a missing rate kind", () => {
  const base = { propertyCode: "A", propertyName: "Conrad", brand: "Conrad", currency: "USD", available: true }
  it("private only: available, no public comparable, no savings", () => {
    const r = evaluateHotelValue({ quotes: [{ ...base, id: "p", rateKind: "PRIVATE_HILTON_GO", nightlyRate: 150, totalRate: 300 }], nights: 2 })
    expect(r.available).toBe(true)
    expect(r.facts.comparablePublicRate).toBe("")
    expect(r.facts.savingsTotal).toBe("")
    expect(r.facts.publicRateQuoteId).toBe("")
    expect(r.facts.hasPublicComparable).toBe(false)
  })
  it("public only: unavailable", () => {
    const r = evaluateHotelValue({ quotes: [{ ...base, id: "q", rateKind: "PUBLIC", nightlyRate: 150, totalRate: 300 }], nights: 2 })
    expect(r.available).toBe(false)
  })
})

// ─── Route ──────────────────────────────────────────────────────────────────

describe("POST /api/private-rates/capture", () => {
  const SECRET = "route-test-secret"
  const originalAuth = process.env.AUTH_SECRET

  beforeEach(() => {
    vi.resetModules()
    process.env.AUTH_SECRET = SECRET
    db.candidateFindFirst.mockReset().mockResolvedValue({ destinationLat: 41.88, destinationLng: -87.63 })
    db.deleteMany.mockReset().mockReturnValue("deleteMany")
    db.createMany.mockReset().mockImplementation(({ data }: { data: unknown[] }) => ({ count: data.length }))
    db.transaction.mockReset().mockImplementation(async (ops: unknown[]) => ops)
    gates.assertEnabledAndEntitled.mockReset().mockResolvedValue(undefined)
    gates.audit.mockReset().mockResolvedValue(undefined)
  })
  afterEach(() => {
    if (originalAuth === undefined) delete process.env.AUTH_SECRET
    else process.env.AUTH_SECRET = originalAuth
  })

  async function token(over: { now?: number } = {}) {
    const { signCaptureToken } = await import("@/lib/private-rates/capture-token")
    return signCaptureToken({ userId: "user-1", searchId: "search-1" }, { secret: SECRET, now: over.now }).token
  }

  function req(payload: unknown, method = "POST") {
    const text = typeof payload === "string" ? payload : JSON.stringify(payload)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new Request("http://localhost/api/private-rates/capture", { method, headers: { "content-type": "application/json" }, body: text }) as any
  }

  it("writes quotes and audits counts only", async () => {
    const { POST } = await import("@/app/api/private-rates/capture/route")
    const res = await POST(req(body({ token: await token(), observations: [obs({ propertyCode: "CHICNCI" }), obs({ propertyCode: "CHICNCI", rateKind: "PUBLIC", nightlyRate: 200 })] })))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, written: 2, itemKey: "ORD|2026-11-06|2026-11-08" })

    expect(db.candidateFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ searchId: "search-1", search: { userId: "user-1" }, destinationIata: "ORD", pruned: false }),
      }),
    )
    const data = db.createMany.mock.calls[0][0].data
    expect(data[0]).toMatchObject({ userId: "user-1", provider: "hilton", propertyCode: "CHICNCI", sessionId: null, totalRate: 240, lat: 41.88 })
    expect(data[0].expiresAt.getTime() - data[0].retrievedAt.getTime()).toBe(24 * 60 * 60_000)
    expect(gates.audit).toHaveBeenCalledWith(
      "user-1",
      "CAPTURE",
      { searchId: "search-1", itemKey: "ORD|2026-11-06|2026-11-08", written: 2, blocked: false, pageKind: "SEARCH", observations: 2 },
      { provider: "hilton", searchId: "search-1" },
    )
  })

  it("blocked=true writes nothing but is audited", async () => {
    const { POST } = await import("@/app/api/private-rates/capture/route")
    const res = await POST(req(body({ token: await token(), blocked: true, pageKind: "OTHER", observations: [] })))
    expect(res.status).toBe(200)
    expect((await res.json()).written).toBe(0)
    expect(db.createMany).not.toHaveBeenCalled()
    expect(gates.audit.mock.calls[0][2]).toMatchObject({ blocked: true, written: 0 })
  })

  it("401 for a bad or expired token", async () => {
    const { POST } = await import("@/app/api/private-rates/capture/route")
    expect((await POST(req(body({ token: "nope.nope" })))).status).toBe(401)
    const old = await token({ now: Date.now() - 46 * 60_000 })
    expect((await POST(req(body({ token: old })))).status).toBe(401)
  })

  it("403 when the kill switch is off or the user is not entitled", async () => {
    const { PrivateRatesGateError } = await import("@/lib/private-rates")
    gates.assertEnabledAndEntitled.mockRejectedValueOnce(new PrivateRatesGateError("DISABLED"))
    const { POST } = await import("@/app/api/private-rates/capture/route")
    expect((await POST(req(body({ token: await token() })))).status).toBe(403)
    expect(db.createMany).not.toHaveBeenCalled()
  })

  it("400 for an itemKey that is not on the search", async () => {
    db.candidateFindFirst.mockResolvedValueOnce(null)
    const { POST } = await import("@/app/api/private-rates/capture/route")
    expect((await POST(req(body({ token: await token() })))).status).toBe(400)
    expect((await POST(req(body({ token: await token(), itemKey: "garbage" })))).status).toBe(400)
  })

  it("400 for invalid JSON or schema", async () => {
    const { POST } = await import("@/app/api/private-rates/capture/route")
    expect((await POST(req("{not json"))).status).toBe(400)
    expect((await POST(req(body({ token: await token(), observations: [obs({ currency: "dollars" })] })))).status).toBe(400)
  })

  it("413 above 512 KB", async () => {
    const { POST } = await import("@/app/api/private-rates/capture/route")
    const big = body({ token: await token(), pageUrl: "x".repeat(MAX_CAPTURE_BODY_BYTES) })
    expect((await POST(req(big))).status).toBe(413)
  })

  it("429 after 200 captures on one token", async () => {
    const { POST } = await import("@/app/api/private-rates/capture/route")
    const t = await token()
    for (let i = 0; i < 200; i++) expect((await POST(req(body({ token: t, blocked: true, observations: [] })))).status).toBe(200)
    expect((await POST(req(body({ token: t })))).status).toBe(429)
  })

  it("405 for other methods", async () => {
    const route = await import("@/app/api/private-rates/capture/route")
    expect(route.GET().status).toBe(405)
    expect(route.PUT().status).toBe(405)
  })
})
