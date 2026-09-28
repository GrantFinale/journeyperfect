/**
 * Environment configuration. Fails fast on anything security-relevant.
 *
 *   BROWSER_RUNNER_SECRET     required  bearer token the Next.js app presents on every request
 *   PRIVATE_RATES_MASTER_KEY  required  base64, >= 32 bytes; HKDF root for per-user profile keys.
 *                                       Never reaches the Next.js app (§6.4).
 *   DATA_DIR                  /data     sealed profile blobs live under ${DATA_DIR}/sealed/
 *   PORT                      8787
 *   HOST                      0.0.0.0
 *   LIVE_VIEW_PUBLIC_URL      base URL the USER'S BROWSER can reach for the WebSocket live view,
 *                             e.g. https://runner.journeyperfect.com. Converted to ws(s)://.
 *   LIVE_VIEW_ALLOWED_ORIGIN  origin(s) allowed to open the live-view WebSocket, comma-separated,
 *                             e.g. https://journeyperfect.com,https://www.journeyperfect.com.
 *                             Unset = any Origin is accepted (a warning is logged at boot).
 *   SESSION_LOGIN_TIMEOUT_MS  600000    interactive sign-in window (10 min)
 *   MAX_RUN_MS                180000    hard deadline for one POST /run
 *   HEADLESS                  true
 *   HILTON_RATE_CODE_PARAM    corporateCode   query param used to request a rate code (assumption, see hilton.ts)
 */

export interface RunnerConfig {
  secret: string
  masterKey: Buffer
  dataDir: string
  port: number
  host: string
  liveViewPublicUrl: string
  liveViewDefaulted: boolean
  /** Normalised origins (scheme://host[:port]); empty = accept any Origin. */
  liveViewAllowedOrigins: string[]
  sessionLoginTimeoutMs: number
  maxRunMs: number
  headless: boolean
  hiltonRateCodeParam: string
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ConfigError"
  }
}

/** Plain string map rather than NodeJS.ProcessEnv so tests (and any host augmentations of ProcessEnv) can pass partial envs. */
export type Env = Record<string, string | undefined>

function intFrom(env: Env, name: string, fallback: number, min: number): number {
  const raw = env[name]
  if (raw === undefined || raw === "") return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min) throw new ConfigError(`${name} must be an integer >= ${min}`)
  return n
}

export function loadConfig(env: Env = process.env): RunnerConfig {
  const secret = env.BROWSER_RUNNER_SECRET
  if (!secret || secret.length < 16) {
    throw new ConfigError("BROWSER_RUNNER_SECRET is required (at least 16 characters)")
  }

  const rawKey = env.PRIVATE_RATES_MASTER_KEY
  if (!rawKey) throw new ConfigError("PRIVATE_RATES_MASTER_KEY is required (base64, >= 32 bytes)")
  const masterKey = Buffer.from(rawKey.trim(), "base64")
  if (masterKey.length < 32) {
    throw new ConfigError("PRIVATE_RATES_MASTER_KEY must decode to at least 32 bytes")
  }

  const port = intFrom(env, "PORT", 8787, 1)
  const liveViewRaw = env.LIVE_VIEW_PUBLIC_URL?.trim()
  const liveViewDefaulted = !liveViewRaw
  const liveViewPublicUrl = toWsBase(liveViewRaw || `http://localhost:${port}`)
  const liveViewAllowedOrigins = parseOrigins(env.LIVE_VIEW_ALLOWED_ORIGIN)

  return {
    secret,
    masterKey,
    dataDir: env.DATA_DIR?.trim() || "/data",
    port,
    host: env.HOST?.trim() || "0.0.0.0",
    liveViewPublicUrl,
    liveViewDefaulted,
    liveViewAllowedOrigins,
    sessionLoginTimeoutMs: intFrom(env, "SESSION_LOGIN_TIMEOUT_MS", 600_000, 10_000),
    maxRunMs: intFrom(env, "MAX_RUN_MS", 180_000, 10_000),
    headless: (env.HEADLESS ?? "true").toLowerCase() !== "false",
    hiltonRateCodeParam: env.HILTON_RATE_CODE_PARAM?.trim() || "corporateCode",
  }
}

/** Comma-separated origins → normalised `scheme://host[:port]` list (paths dropped). */
export function parseOrigins(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) return []
  return raw.split(",").map((part) => {
    const s = part.trim()
    let u: URL
    try {
      u = new URL(s)
    } catch {
      throw new ConfigError(`LIVE_VIEW_ALLOWED_ORIGIN entry is not a valid URL: ${s}`)
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      throw new ConfigError("LIVE_VIEW_ALLOWED_ORIGIN entries must be http(s):// origins")
    }
    return u.origin
  })
}

/** http(s):// → ws(s)://, trailing slashes trimmed. */
export function toWsBase(url: string): string {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    throw new ConfigError(`LIVE_VIEW_PUBLIC_URL is not a valid URL: ${url}`)
  }
  if (u.protocol === "http:") u.protocol = "ws:"
  else if (u.protocol === "https:") u.protocol = "wss:"
  else if (u.protocol !== "ws:" && u.protocol !== "wss:") {
    throw new ConfigError("LIVE_VIEW_PUBLIC_URL must be http(s):// or ws(s)://")
  }
  return u.toString().replace(/\/+$/, "")
}
