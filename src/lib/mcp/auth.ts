import { createHash, randomBytes } from "crypto"
import { prisma } from "@/lib/db"

/**
 * API keys look like `jp_<43 url-safe chars>`. Only the sha256 of the full
 * plaintext is stored (`ApiKey.keyHash`); `ApiKey.prefix` keeps the first 8
 * random characters so the settings page can tell keys apart.
 */
export const API_KEY_PREFIX = "jp_"
const MIN_RANDOM_LENGTH = 32
const BEARER_RE = new RegExp(`^Bearer\\s+(${API_KEY_PREFIX}[A-Za-z0-9_-]{${MIN_RANDOM_LENGTH},})\\s*$`, "i")

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex")
}

export interface GeneratedApiKey {
  plaintext: string
  /** First 8 characters after `jp_`, safe to display. */
  prefix: string
  keyHash: string
}

export function generateApiKey(): GeneratedApiKey {
  // 32 bytes -> 43 base64url characters, comfortably above MIN_RANDOM_LENGTH.
  const random = randomBytes(32).toString("base64url")
  const plaintext = `${API_KEY_PREFIX}${random}`
  return { plaintext, prefix: random.slice(0, 8), keyHash: hashApiKey(plaintext) }
}

/** Pulls the key out of an `Authorization: Bearer jp_...` header, or null. */
export function parseBearerApiKey(header: string | null | undefined): string | null {
  if (!header) return null
  const match = BEARER_RE.exec(header)
  return match ? match[1] : null
}

export interface ApiKeyPrincipal {
  userId: string
  keyId: string
}

/**
 * Resolves an Authorization header to the user who owns the key. Revoked keys
 * and malformed headers both resolve to null; the caller decides the status.
 * `lastUsedAt` is bumped without awaiting so a slow write never delays a call.
 */
export async function authenticateApiKey(header: string | null): Promise<ApiKeyPrincipal | null> {
  const plaintext = parseBearerApiKey(header)
  if (!plaintext) return null

  const key = await prisma.apiKey.findUnique({
    where: { keyHash: hashApiKey(plaintext) },
    select: { id: true, userId: true, revokedAt: true },
  })
  if (!key || key.revokedAt) return null

  void prisma.apiKey
    .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
    .catch((err) => console.error("[mcp/auth] failed to stamp lastUsedAt:", err))

  return { userId: key.userId, keyId: key.id }
}
