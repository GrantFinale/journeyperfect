import { describe, it, expect } from "vitest"
import {
  CAPTURE_TOKEN_TTL_MS,
  captureTokenSecret,
  signCaptureToken,
  verifyCaptureToken,
} from "@/lib/private-rates/capture-token"

const SECRET = "test-secret-value"
const NOW = Date.UTC(2026, 9, 2, 12, 0, 0)

describe("capture token", () => {
  it("round-trips userId, searchId, exp and nonce", () => {
    const { token, payload } = signCaptureToken({ userId: "u1", searchId: "s1" }, { secret: SECRET, now: NOW, nonce: "n1" })
    expect(payload).toEqual({ userId: "u1", searchId: "s1", exp: Math.floor((NOW + CAPTURE_TOKEN_TTL_MS) / 1000), nonce: "n1" })
    expect(token.split(".")).toHaveLength(2)
    const v = verifyCaptureToken(token, { secret: SECRET, now: NOW + 60_000 })
    expect(v).toEqual({ ok: true, payload })
  })

  it("defaults to a 45 minute expiry", () => {
    expect(CAPTURE_TOKEN_TTL_MS).toBe(45 * 60_000)
    const { token } = signCaptureToken({ userId: "u1", searchId: "s1" }, { secret: SECRET, now: NOW })
    expect(verifyCaptureToken(token, { secret: SECRET, now: NOW + 44 * 60_000 }).ok).toBe(true)
    expect(verifyCaptureToken(token, { secret: SECRET, now: NOW + 45 * 60_000 })).toEqual({ ok: false, reason: "EXPIRED" })
  })

  it("issues a fresh nonce per token", () => {
    const a = signCaptureToken({ userId: "u1", searchId: "s1" }, { secret: SECRET, now: NOW })
    const b = signCaptureToken({ userId: "u1", searchId: "s1" }, { secret: SECRET, now: NOW })
    expect(a.payload.nonce).not.toBe(b.payload.nonce)
    expect(a.token).not.toBe(b.token)
  })

  it("rejects a token signed with another secret", () => {
    const { token } = signCaptureToken({ userId: "u1", searchId: "s1" }, { secret: "other", now: NOW })
    expect(verifyCaptureToken(token, { secret: SECRET, now: NOW })).toEqual({ ok: false, reason: "BAD_SIGNATURE" })
  })

  it("rejects a tampered payload (e.g. a different userId)", () => {
    const { token } = signCaptureToken({ userId: "u1", searchId: "s1" }, { secret: SECRET, now: NOW })
    const [, sig] = token.split(".")
    const forged = Buffer.from(JSON.stringify({ userId: "u2", searchId: "s1", exp: 9e9, nonce: "x" })).toString("base64url")
    expect(verifyCaptureToken(`${forged}.${sig}`, { secret: SECRET, now: NOW })).toEqual({ ok: false, reason: "BAD_SIGNATURE" })
  })

  it("rejects malformed input", () => {
    for (const bad of [undefined, null, 42, "", "abc", "a.b.c", ".x", "x.", "x".repeat(2000)]) {
      const v = verifyCaptureToken(bad, { secret: SECRET, now: NOW })
      expect(v.ok).toBe(false)
    }
  })

  it("fails closed without a secret", () => {
    expect(verifyCaptureToken("a.b", { secret: null })).toEqual({ ok: false, reason: "NO_SECRET" })
    expect(() => signCaptureToken({ userId: "u", searchId: "s" }, { secret: null })).toThrow()
  })

  it("reads AUTH_SECRET first, then NEXTAUTH_SECRET", () => {
    expect(captureTokenSecret({ AUTH_SECRET: "a", NEXTAUTH_SECRET: "b" })).toBe("a")
    expect(captureTokenSecret({ NEXTAUTH_SECRET: "b" })).toBe("b")
    expect(captureTokenSecret({})).toBeNull()
  })
})
