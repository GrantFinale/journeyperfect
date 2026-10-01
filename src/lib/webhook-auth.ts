import { timingSafeEqual } from "crypto"

export type WebhookAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503 }

/**
 * Fail-closed shared-secret check for inbound webhooks.
 *
 * - Expected secret unset or empty -> 503 (misconfiguration; never skip auth).
 * - Provided header missing or not an exact match -> 401.
 * Comparison is constant-time; a length mismatch is a failure.
 */
export function checkWebhookSecret(
  expected: string | undefined,
  provided: string | null | undefined,
): WebhookAuthResult {
  if (!expected) return { ok: false, status: 503 }
  if (!provided) return { ok: false, status: 401 }
  const a = Buffer.from(provided, "utf8")
  const b = Buffer.from(expected, "utf8")
  if (a.length !== b.length) return { ok: false, status: 401 }
  return timingSafeEqual(a, b) ? { ok: true } : { ok: false, status: 401 }
}
