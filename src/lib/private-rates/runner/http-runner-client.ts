/**
 * Next.js-side BrowserRunner that talks to services/browser-runner over HTTP.
 *
 * The app never imports Playwright (§6.5). Every request carries
 * `Authorization: Bearer ${BROWSER_RUNNER_SECRET}`. Network failures, non-JSON
 * bodies and 5xx responses on `run` map to {ok:false, status:"RUNNER_UNAVAILABLE"}
 * so the UI can explain the outcome (§6.1 rule 7); there are no retries here.
 *
 * Service API (see services/browser-runner/README.md):
 *   POST   /sessions              {userId}        → {sessionId, liveViewUrl}
 *   GET    /sessions/:id/status                   → {status, challengeKind?, liveViewUrl?}
 *   POST   /run                   {userId, task}  → RunnerResult<RateObservation[]>
 *   DELETE /users/:userId                         → 204
 */
import type {
  AwaitSignedInOutcome,
  BrowserRunner,
  ChallengeKind,
  RunnerFailureStatus,
  RunnerResult,
  RunnerTask,
} from "../types"

export class RunnerUnavailableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = "RunnerUnavailableError"
  }
}

export interface HttpRunnerClientOptions {
  /** Defaults to process.env.BROWSER_RUNNER_SECRET. */
  secret?: string
  /** Interval between status polls in awaitSignedIn. */
  pollIntervalMs?: number
  /** Upper bound for a single `run` request (service MAX_RUN_MS plus headroom). */
  runRequestTimeoutMs?: number
  /** Consecutive poll failures tolerated before awaitSignedIn gives up. */
  maxConsecutivePollFailures?: number
  /** Injectable for tests. */
  fetchImpl?: typeof fetch
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>
}

type SessionStatusResponse = {
  status: "AWAITING_LOGIN" | "SIGNED_IN" | "CHALLENGE" | "TIMEOUT"
  challengeKind?: ChallengeKind
  /** Present while AWAITING_LOGIN with no viewer attached: a URL with a fresh one-time token. */
  liveViewUrl?: string
}

const FAILURE_STATUSES: ReadonlySet<string> = new Set<RunnerFailureStatus>([
  "CHALLENGE",
  "SIGNED_OUT",
  "TIMEOUT",
  "PARSE_FAILED",
  "RUNNER_UNAVAILABLE",
])

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export class HttpRunnerClient implements BrowserRunner {
  private readonly baseUrl: string
  private readonly secret: string
  private readonly pollIntervalMs: number
  private readonly runRequestTimeoutMs: number
  private readonly maxConsecutivePollFailures: number
  private readonly fetchImpl: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>
  /** Latest live-view URL seen in a status poll, per session (so getLiveViewUrl needs no extra request). */
  private readonly liveViewUrls = new Map<string, string>()

  constructor(baseUrl: string, options: HttpRunnerClientOptions = {}) {
    if (!baseUrl) throw new Error("HttpRunnerClient: runner base URL is required")
    const secret = options.secret ?? process.env.BROWSER_RUNNER_SECRET
    if (!secret) throw new Error("HttpRunnerClient: BROWSER_RUNNER_SECRET is not set")
    this.baseUrl = baseUrl.replace(/\/+$/, "")
    this.secret = secret
    this.pollIntervalMs = options.pollIntervalMs ?? 1500
    this.runRequestTimeoutMs = options.runRequestTimeoutMs ?? 210_000
    this.maxConsecutivePollFailures = options.maxConsecutivePollFailures ?? 5
    this.fetchImpl = options.fetchImpl ?? fetch
    this.sleep = options.sleep ?? defaultSleep
  }

  async openInteractive(userId: string): Promise<{ sessionId: string; liveViewUrl: string }> {
    const res = await this.request("POST", "/sessions", { userId })
    const body = await this.json(res)
    if (!res.ok) {
      throw new RunnerUnavailableError(`browser runner rejected POST /sessions (${res.status})`)
    }
    if (
      typeof body !== "object" ||
      body === null ||
      typeof (body as { sessionId?: unknown }).sessionId !== "string" ||
      typeof (body as { liveViewUrl?: unknown }).liveViewUrl !== "string"
    ) {
      throw new RunnerUnavailableError("browser runner returned a malformed session response")
    }
    const { sessionId, liveViewUrl } = body as { sessionId: string; liveViewUrl: string }
    return { sessionId, liveViewUrl }
  }

  async awaitSignedIn(sessionId: string, timeoutMs: number): Promise<AwaitSignedInOutcome> {
    const deadline = Date.now() + timeoutMs
    let failures = 0
    while (true) {
      let status: SessionStatusResponse | null = null
      try {
        const res = await this.request("GET", `/sessions/${encodeURIComponent(sessionId)}/status`)
        if (res.status === 404) return "TIMEOUT" // session gone: treat as expired
        const body = await this.json(res)
        if (res.ok && isStatusResponse(body)) {
          status = body
          failures = 0
        } else {
          failures++
        }
      } catch (err) {
        failures++
        if (failures >= this.maxConsecutivePollFailures) {
          throw new RunnerUnavailableError("browser runner unreachable while awaiting sign-in", err)
        }
      }

      if (status) {
        if (typeof status.liveViewUrl === "string" && status.liveViewUrl) this.liveViewUrls.set(sessionId, status.liveViewUrl)
        else this.liveViewUrls.delete(sessionId)
        if (status.status === "SIGNED_IN") return "SIGNED_IN"
        if (status.status === "CHALLENGE") return "CHALLENGE"
        if (status.status === "TIMEOUT") return "TIMEOUT"
      }
      if (failures >= this.maxConsecutivePollFailures) {
        throw new RunnerUnavailableError("browser runner returned malformed status responses")
      }
      if (Date.now() >= deadline) return "TIMEOUT"
      await this.sleep(Math.min(this.pollIntervalMs, Math.max(0, deadline - Date.now())))
    }
  }

  /**
   * The runner issues a new one-time live-view token in its status response
   * whenever the session is still AWAITING_LOGIN and no viewer is attached.
   * Returns the one seen by the most recent awaitSignedIn poll, or fetches
   * status once when nothing has been polled yet.
   */
  async getLiveViewUrl(sessionId: string): Promise<string | null> {
    const cached = this.liveViewUrls.get(sessionId)
    if (cached) return cached
    try {
      const res = await this.request("GET", `/sessions/${encodeURIComponent(sessionId)}/status`)
      if (!res.ok) return null
      const body = await this.json(res)
      if (!isStatusResponse(body) || typeof body.liveViewUrl !== "string" || !body.liveViewUrl) return null
      this.liveViewUrls.set(sessionId, body.liveViewUrl)
      return body.liveViewUrl
    } catch {
      return null
    }
  }

  async run<T>(userId: string, task: RunnerTask): Promise<RunnerResult<T>> {
    let res: Response
    let body: unknown
    try {
      res = await this.request("POST", "/run", { userId, task }, this.runRequestTimeoutMs)
      body = await this.json(res)
    } catch {
      return { ok: false, status: "RUNNER_UNAVAILABLE" }
    }
    if (!res.ok && res.status >= 500) return { ok: false, status: "RUNNER_UNAVAILABLE" }
    if (!isRunnerResult<T>(body)) return { ok: false, status: "RUNNER_UNAVAILABLE" }
    return body
  }

  async destroy(userId: string): Promise<void> {
    let res: Response
    try {
      res = await this.request("DELETE", `/users/${encodeURIComponent(userId)}`)
    } catch (err) {
      throw new RunnerUnavailableError("browser runner unreachable while destroying profile", err)
    }
    if (!res.ok && res.status !== 404) {
      throw new RunnerUnavailableError(`browser runner rejected DELETE /users (${res.status})`)
    }
  }

  private async request(method: string, path: string, body?: unknown, timeoutMs = 30_000): Promise<Response> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.secret}`,
      accept: "application/json",
    }
    if (body !== undefined) headers["content-type"] = "application/json"
    return this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    })
  }

  private async json(res: Response): Promise<unknown> {
    if (res.status === 204) return null
    const text = await res.text()
    if (!text) return null
    try {
      return JSON.parse(text)
    } catch {
      throw new RunnerUnavailableError("browser runner returned a non-JSON body")
    }
  }
}

function isStatusResponse(body: unknown): body is SessionStatusResponse {
  if (typeof body !== "object" || body === null) return false
  const s = (body as { status?: unknown }).status
  return s === "AWAITING_LOGIN" || s === "SIGNED_IN" || s === "CHALLENGE" || s === "TIMEOUT"
}

function isRunnerResult<T>(body: unknown): body is RunnerResult<T> {
  if (typeof body !== "object" || body === null) return false
  const b = body as { ok?: unknown; status?: unknown; data?: unknown }
  if (b.ok === true) return "data" in b
  if (b.ok === false) return typeof b.status === "string" && FAILURE_STATUSES.has(b.status)
  return false
}
