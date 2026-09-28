/**
 * In-memory registry and lifecycle of interactive sign-in sessions (§6.3).
 *
 * Hard rules encoded here:
 *   - one interactive session per user at a time (opening a new one ends the old one)
 *   - a session is only ever touched on behalf of its owner (callers assert userId)
 *   - the login timeout ends the session and reports TIMEOUT
 *   - on SIGNED_IN the context is closed, the profile sealed, the scratch dir wiped
 *   - the scratch dir is wiped in `finally` on every exit path
 *   - nothing about what the user typed is ever read or logged; we only watch
 *     for the signed-in state
 *
 * There is no scheduler and no retry anywhere in this file.
 */
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import type { BrowserContext, Page } from "playwright"
import type { PageSignals } from "./challenges.js"
import { detectChallenge } from "./challenges.js"
import type { ChallengeKind, InteractiveStatus } from "./types.js"

export interface InteractiveSession {
  sessionId: string
  userId: string
  status: InteractiveStatus
  /** Informational while AWAITING_LOGIN (CAPTCHA/MFA/SECURITY_VERIFY only); terminal cause on CHALLENGE (e.g. BLOCKED). */
  challengeKind?: ChallengeKind
  context: BrowserContext | null
  page: Page | null
  profileDir: string | null
  createdAt: number
  endedAt?: number
  /** One-time token for the live view WebSocket. */
  liveToken: string | null
  liveTokenConsumed: boolean
  viewerAttached: boolean
  onEnd: Set<() => void>
}

export interface SessionBrowserOps {
  /** Unseal the user's profile or create a fresh scratch dir. */
  prepareProfile(userId: string): Promise<string>
  launch(profileDir: string): Promise<BrowserContext>
  openSignIn(context: BrowserContext): Promise<Page>
  isSignedIn(page: Page): Promise<boolean>
  collectSignals(page: Page): Promise<PageSignals>
  sealProfile(userId: string, profileDir: string): Promise<void>
  wipeDir(dir: string): Promise<void>
}

export interface SessionManagerOptions {
  loginTimeoutMs: number
  pollIntervalMs?: number
  /** How long a finished session stays queryable via GET /sessions/:id/status. */
  retentionMs?: number
  log?: Logger
}

export interface Logger {
  info(obj: Record<string, unknown>, msg?: string): void
  warn(obj: Record<string, unknown>, msg?: string): void
  error(obj: Record<string, unknown>, msg?: string): void
}

const noopLog: Logger = { info() {}, warn() {}, error() {} }

/** Per-user mutual exclusion between interactive sessions and runs. */
export class UserLocks {
  private readonly held = new Map<string, "session" | "run">()

  tryAcquire(userId: string, kind: "session" | "run"): boolean {
    if (this.held.has(userId)) return false
    this.held.set(userId, kind)
    return true
  }

  holder(userId: string): "session" | "run" | undefined {
    return this.held.get(userId)
  }

  release(userId: string, kind: "session" | "run"): void {
    if (this.held.get(userId) === kind) this.held.delete(userId)
  }
}

export class SessionManager {
  private readonly byId = new Map<string, InteractiveSession>()
  private readonly timers = new Map<string, { login: NodeJS.Timeout; poll: NodeJS.Timeout }>()
  private readonly pollInFlight = new Set<string>()
  private readonly log: Logger
  private readonly pollIntervalMs: number
  private readonly retentionMs: number
  private closing = false

  constructor(
    private readonly ops: SessionBrowserOps,
    private readonly locks: UserLocks,
    private readonly options: SessionManagerOptions,
  ) {
    this.log = options.log ?? noopLog
    this.pollIntervalMs = options.pollIntervalMs ?? 1000
    this.retentionMs = options.retentionMs ?? 15 * 60_000
  }

  get(sessionId: string): InteractiveSession | undefined {
    return this.byId.get(sessionId)
  }

  activeForUser(userId: string): InteractiveSession | undefined {
    for (const s of this.byId.values()) {
      if (s.userId === userId && s.status === "AWAITING_LOGIN") return s
    }
    return undefined
  }

  /**
   * Start an interactive session for `userId`. Any existing AWAITING_LOGIN
   * session for the same user is ended first (TIMEOUT). Throws if a run is
   * currently using this user's profile.
   */
  async open(userId: string): Promise<InteractiveSession> {
    if (this.closing) throw new Error("service is shutting down")
    const existing = this.activeForUser(userId)
    if (existing) await this.end(existing, "TIMEOUT")
    if (!this.locks.tryAcquire(userId, "session")) {
      throw new SessionConflictError("a rate check is running for this user; try again when it finishes")
    }

    const session: InteractiveSession = {
      sessionId: randomUUID(),
      userId,
      status: "AWAITING_LOGIN",
      context: null,
      page: null,
      profileDir: null,
      createdAt: Date.now(),
      liveToken: null,
      liveTokenConsumed: false,
      viewerAttached: false,
      onEnd: new Set(),
    }
    this.byId.set(session.sessionId, session)

    try {
      session.profileDir = await this.ops.prepareProfile(userId)
      session.context = await this.ops.launch(session.profileDir)
      session.page = await this.ops.openSignIn(session.context)
    } catch (err) {
      this.log.error({ sessionId: session.sessionId, err: describe(err) }, "failed to open interactive session")
      await this.end(session, "CHALLENGE", "UNKNOWN_INTERSTITIAL")
      throw err
    }

    this.issueLiveToken(session)
    const login = setTimeout(() => {
      void this.end(session, "TIMEOUT")
    }, this.options.loginTimeoutMs)
    const poll = setInterval(() => {
      void this.poll(session)
    }, this.pollIntervalMs)
    this.timers.set(session.sessionId, { login, poll })
    this.log.info({ sessionId: session.sessionId, userId }, "interactive session opened")
    // Classify the page the navigation landed on right away: if bot protection
    // refused the browser (BLOCKED) the session ends before anyone waits on it.
    void this.poll(session)
    return session
  }

  /** Mint a fresh one-time live-view token (invalidates the previous one). */
  issueLiveToken(session: InteractiveSession): string {
    session.liveToken = randomBytes(32).toString("base64url")
    session.liveTokenConsumed = false
    return session.liveToken
  }

  /** True when the token matches and has not been used; consumes it. */
  consumeLiveToken(session: InteractiveSession, token: string): boolean {
    if (session.status !== "AWAITING_LOGIN" || !session.liveToken || session.liveTokenConsumed) return false
    const a = Buffer.from(session.liveToken)
    const b = Buffer.from(token)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false
    session.liveTokenConsumed = true
    return true
  }

  /** Reported to GET /sessions/:id/status. A fresh live token is issued when no viewer is attached. */
  statusOf(session: InteractiveSession): { status: InteractiveStatus; challengeKind?: ChallengeKind; liveToken?: string } {
    const out: { status: InteractiveStatus; challengeKind?: ChallengeKind; liveToken?: string } = {
      status: session.status,
    }
    if (session.challengeKind) out.challengeKind = session.challengeKind
    if (session.status === "AWAITING_LOGIN" && !session.viewerAttached) {
      out.liveToken = session.liveTokenConsumed || !session.liveToken ? this.issueLiveToken(session) : session.liveToken
    }
    return out
  }

  /**
   * Re-check the live page now (GET /sessions/:id/status calls this so the
   * reported status is current). No-op once the session has ended or while a
   * check is already in flight.
   */
  async refresh(session: InteractiveSession): Promise<void> {
    await this.poll(session)
  }

  private async poll(session: InteractiveSession): Promise<void> {
    if (session.status !== "AWAITING_LOGIN" || !session.page) return
    if (this.pollInFlight.has(session.sessionId)) return
    this.pollInFlight.add(session.sessionId)
    try {
      if (session.page.isClosed()) {
        await this.end(session, "CHALLENGE", "UNKNOWN_INTERSTITIAL")
        return
      }
      if (await this.ops.isSignedIn(session.page)) {
        await this.end(session, "SIGNED_IN")
        return
      }
      const signals = await this.ops.collectSignals(session.page)
      const kind = detectChallenge(signals)
      if (session.status !== "AWAITING_LOGIN") return // ended while we were looking
      if (kind === "BLOCKED") {
        // Bot protection refused the browser: nothing for the user to do in the
        // live view, so end the session (closes the browser and the live view).
        this.log.warn({ sessionId: session.sessionId }, "sign-in page blocked by bot protection")
        await this.end(session, "CHALLENGE", "BLOCKED")
        return
      }
      // Informational only: the user resolves these themselves in the live view.
      session.challengeKind = kind === "CAPTCHA" || kind === "MFA" || kind === "SECURITY_VERIFY" ? kind : undefined
    } catch (err) {
      // Navigation in progress or page transitioning; try again next tick.
      this.log.warn({ sessionId: session.sessionId, err: describe(err) }, "poll skipped")
    } finally {
      this.pollInFlight.delete(session.sessionId)
    }
  }

  /**
   * Terminal transition. Idempotent. Closes the browser, seals on SIGNED_IN,
   * wipes the scratch dir in `finally`, releases the user lock, notifies the
   * live view, and schedules the record for removal after the retention window.
   */
  async end(session: InteractiveSession, status: Exclude<InteractiveStatus, "AWAITING_LOGIN">, challengeKind?: ChallengeKind): Promise<void> {
    if (session.status !== "AWAITING_LOGIN") return
    session.status = status
    session.challengeKind = status === "CHALLENGE" ? (challengeKind ?? "UNKNOWN_INTERSTITIAL") : undefined
    session.endedAt = Date.now()
    session.liveToken = null

    const timers = this.timers.get(session.sessionId)
    if (timers) {
      clearTimeout(timers.login)
      clearInterval(timers.poll)
      this.timers.delete(session.sessionId)
    }
    for (const cb of session.onEnd) {
      try {
        cb()
      } catch {
        // listeners must not break teardown
      }
    }
    session.onEnd.clear()

    const { context, profileDir, userId } = session
    session.context = null
    session.page = null
    try {
      if (context) {
        try {
          await context.close()
        } catch (err) {
          this.log.warn({ sessionId: session.sessionId, err: describe(err) }, "context close failed")
        }
      }
      if (status === "SIGNED_IN" && profileDir) {
        await this.ops.sealProfile(userId, profileDir)
      }
    } catch (err) {
      this.log.error({ sessionId: session.sessionId, err: describe(err) }, "sealing after sign-in failed")
      session.status = "CHALLENGE"
      session.challengeKind = "UNKNOWN_INTERSTITIAL"
    } finally {
      if (profileDir) await this.ops.wipeDir(profileDir)
      session.profileDir = null
      this.locks.release(userId, "session")
    }
    this.log.info({ sessionId: session.sessionId, status: session.status }, "interactive session ended")

    const t = setTimeout(() => this.byId.delete(session.sessionId), this.retentionMs)
    t.unref()
  }

  /** End the user's active session if any (DELETE /users/:id, shutdown). */
  async endForUser(userId: string): Promise<void> {
    const s = this.activeForUser(userId)
    if (s) await this.end(s, "TIMEOUT")
  }

  async shutdown(): Promise<void> {
    this.closing = true
    const active = [...this.byId.values()].filter((s) => s.status === "AWAITING_LOGIN")
    await Promise.all(active.map((s) => this.end(s, "TIMEOUT")))
  }
}

export class SessionConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SessionConflictError"
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err)
}
