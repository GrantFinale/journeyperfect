/**
 * PURE (node:crypto only). Short-lived bearer token for Go Rates capture.
 *
 * The opportunities page asks the server for a capture plan; the plan carries
 * a token the user's Chrome extension sends back with every capture POST. The
 * capture endpoint is excluded from the cookie middleware, so this token is
 * the only thing that ties a capture to a user and a search.
 *
 * Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256(payloadPart))
 * Payload: { userId, searchId, exp (epoch seconds), nonce }
 * Secret:  AUTH_SECRET ?? NEXTAUTH_SECRET (the app's existing auth secret).
 *
 * The nonce makes every token unique, which is what the capture endpoint's
 * per-token rate counter keys on.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

export const CAPTURE_TOKEN_TTL_MS = 45 * 60_000
/** Longer strings are rejected before any parsing or HMAC work. */
export const MAX_CAPTURE_TOKEN_LENGTH = 1024

export interface CaptureTokenPayload {
  userId: string
  searchId: string
  /** Expiry, epoch seconds. */
  exp: number
  nonce: string
}

export type VerifyCaptureTokenResult =
  | { ok: true; payload: CaptureTokenPayload }
  | { ok: false; reason: "NO_SECRET" | "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED" }

export function captureTokenSecret(env: Record<string, string | undefined> = process.env): string | null {
  const s = env.AUTH_SECRET || env.NEXTAUTH_SECRET
  return s ? s : null
}

function hmac(secret: string, data: string): Buffer {
  // Domain-separate from any other use of the auth secret.
  return createHmac("sha256", secret).update(`jp-go-rates-capture.v1.${data}`).digest()
}

export function signCaptureToken(
  input: { userId: string; searchId: string },
  options: { secret?: string | null; now?: number; ttlMs?: number; nonce?: string } = {},
): { token: string; payload: CaptureTokenPayload } {
  const secret = options.secret === undefined ? captureTokenSecret() : options.secret
  if (!secret) throw new Error("Capture token secret is not configured (AUTH_SECRET / NEXTAUTH_SECRET)")
  const now = options.now ?? Date.now()
  const payload: CaptureTokenPayload = {
    userId: input.userId,
    searchId: input.searchId,
    exp: Math.floor((now + (options.ttlMs ?? CAPTURE_TOKEN_TTL_MS)) / 1000),
    nonce: options.nonce ?? randomBytes(12).toString("base64url"),
  }
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
  const sig = hmac(secret, body).toString("base64url")
  return { token: `${body}.${sig}`, payload }
}

export function verifyCaptureToken(
  token: unknown,
  options: { secret?: string | null; now?: number } = {},
): VerifyCaptureTokenResult {
  const secret = options.secret === undefined ? captureTokenSecret() : options.secret
  if (!secret) return { ok: false, reason: "NO_SECRET" }
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_CAPTURE_TOKEN_LENGTH) {
    return { ok: false, reason: "MALFORMED" }
  }
  const parts = token.split(".")
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "MALFORMED" }
  const [body, sigPart] = parts

  const expected = hmac(secret, body)
  const given = Buffer.from(sigPart, "base64url")
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "BAD_SIGNATURE" }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"))
  } catch {
    return { ok: false, reason: "MALFORMED" }
  }
  const p = parsed as Partial<CaptureTokenPayload> | null
  if (
    !p ||
    typeof p.userId !== "string" ||
    !p.userId ||
    typeof p.searchId !== "string" ||
    !p.searchId ||
    typeof p.exp !== "number" ||
    !Number.isFinite(p.exp) ||
    typeof p.nonce !== "string" ||
    !p.nonce
  ) {
    return { ok: false, reason: "MALFORMED" }
  }
  const now = options.now ?? Date.now()
  if (p.exp * 1000 <= now) return { ok: false, reason: "EXPIRED" }
  return { ok: true, payload: { userId: p.userId, searchId: p.searchId, exp: p.exp, nonce: p.nonce } }
}
