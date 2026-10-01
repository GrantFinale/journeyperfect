import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { checkWebhookSecret } from "@/lib/webhook-auth"

vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique: vi.fn() } } }))
vi.mock("@/lib/flight-parser-ai", () => ({ parseFlightTextWithAI: vi.fn() }))
vi.mock("@/lib/hotel-parser-ai", () => ({ parseHotelTextWithAI: vi.fn() }))
vi.mock("@/lib/rental-car-parser-ai", () => ({ parseRentalCarTextWithAI: vi.fn() }))
vi.mock("@/lib/transport-parser-ai", () => ({ parseTransportTextWithAI: vi.fn() }))
vi.mock("@/lib/email", () => ({ sendInboundConfirmation: vi.fn() }))
vi.mock("@/lib/config", () => ({ getConfig: vi.fn() }))
vi.mock("@/lib/ai-usage", () => ({ logAIUsage: vi.fn() }))

describe("checkWebhookSecret", () => {
  it("fails closed with 503 when the expected secret is unset or empty", () => {
    expect(checkWebhookSecret(undefined, "anything")).toEqual({ ok: false, status: 503 })
    expect(checkWebhookSecret("", "anything")).toEqual({ ok: false, status: 503 })
    expect(checkWebhookSecret("", "")).toEqual({ ok: false, status: 503 })
  })
  it("returns 401 for a missing, wrong, or different-length header", () => {
    expect(checkWebhookSecret("s3cret-value", null)).toEqual({ ok: false, status: 401 })
    expect(checkWebhookSecret("s3cret-value", "")).toEqual({ ok: false, status: 401 })
    expect(checkWebhookSecret("s3cret-value", "s3cret-valuX")).toEqual({ ok: false, status: 401 })
    expect(checkWebhookSecret("s3cret-value", "s3cret")).toEqual({ ok: false, status: 401 })
  })
  it("accepts an exact match", () => {
    expect(checkWebhookSecret("s3cret-value", "s3cret-value")).toEqual({ ok: true })
  })
})

describe("POST /api/inbound-email auth", () => {
  const original = process.env.INBOUND_WEBHOOK_SECRET
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => {
    if (original === undefined) delete process.env.INBOUND_WEBHOOK_SECRET
    else process.env.INBOUND_WEBHOOK_SECRET = original
    vi.restoreAllMocks()
  })

  function req(secret?: string) {
    const body = new URLSearchParams({ to: "nobody@example.com" })
    const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" }
    if (secret !== undefined) headers["x-webhook-secret"] = secret
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new Request("http://localhost/api/inbound-email", { method: "POST", headers, body }) as any
  }

  it("returns 503 when INBOUND_WEBHOOK_SECRET is missing", async () => {
    delete process.env.INBOUND_WEBHOOK_SECRET
    const { POST } = await import("@/app/api/inbound-email/route")
    const res = await POST(req("whatever"))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: "Service unavailable" })
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("not configured"))
  })

  it("returns 503 when INBOUND_WEBHOOK_SECRET is empty", async () => {
    process.env.INBOUND_WEBHOOK_SECRET = ""
    const { POST } = await import("@/app/api/inbound-email/route")
    const res = await POST(req())
    expect(res.status).toBe(503)
  })

  it("returns 401 for a wrong secret", async () => {
    process.env.INBOUND_WEBHOOK_SECRET = "correct-secret"
    const { POST } = await import("@/app/api/inbound-email/route")
    const res = await POST(req("wrong-secret!"))
    expect(res.status).toBe(401)
  })

  it("passes auth with the correct secret (then 400 Invalid recipient)", async () => {
    process.env.INBOUND_WEBHOOK_SECRET = "correct-secret"
    const { POST } = await import("@/app/api/inbound-email/route")
    const res = await POST(req("correct-secret"))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "Invalid recipient" })
  })
})
