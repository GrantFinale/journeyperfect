"use server"

/**
 * Private Rates (Hilton Go) server actions.
 * See docs/plans/opportunity-discovery-engine.md §6.
 *
 * Every action re-checks both gates (kill switch + entitlement) on the server;
 * the UI hiding the feature is a courtesy, not the control. Hilton is only ever
 * contacted from `connectHilton` (the user's own interactive sign-in) and
 * `checkPrivateRatesForSearch` (an explicit click). Nothing here polls Hilton,
 * schedules work or retries after a challenge. Sessions are looked up by the
 * calling user's id only; no action can touch another user's session or
 * quotes. Credentials never pass through this process: the user types them
 * into Hilton's page inside the runner's browser, and the app stores only the
 * session metadata row.
 */

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { setConfig } from "@/lib/config"
import { getConfigKey, getConfigKeyNumber } from "@/lib/config-keys"
import { signCaptureToken } from "@/lib/private-rates/capture-token"
import { GO_RATES_MAX_CONCURRENT_TABS, buildGoRatesItems, type GoRatesPlan } from "@/lib/private-rates/go-rates-plan"
import { revalidatePath } from "next/cache"
import {
  DEFAULT_PROVIDER,
  PrivateRatesGateError,
  assertCanRun,
  assertEnabledAndEntitled,
  audit,
  checksRemainingToday,
  getRateProvider,
  getRunner,
  isPrivateRatesEnabled,
  userIsEntitled,
} from "@/lib/private-rates"
import {
  flattenCityRates,
  planRateChecks,
  runPlannedChecks,
  type CheckStatus,
  type PlanCandidate,
  type RateCheckGroup,
} from "@/lib/private-rates/plan-check"
import type { ChallengeKind, RateObservation, RunnerResult, SessionStatus } from "@/lib/private-rates/types"

const PROVIDER = DEFAULT_PROVIDER
/** §6.3: AWAITING_LOGIN → EXPIRED after 10 minutes. */
const LOGIN_TIMEOUT_MS = 10 * 60_000
/** Per-poll wait inside pollHiltonConnect; the client polls every few seconds. */
const POLL_WAIT_MS = 5_000
/** HotelRateQuote.expiresAt = retrievedAt + 24h. */
const QUOTE_TTL_MS = 24 * 60 * 60_000

const CHALLENGE_KINDS: ReadonlySet<string> = new Set<ChallengeKind>([
  "NONE",
  "CAPTCHA",
  "MFA",
  "SECURITY_VERIFY",
  "SIGNED_OUT",
  "UNKNOWN_INTERSTITIAL",
  "BLOCKED",
])

async function requireUser(): Promise<{ id: string }> {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")
  return { id: session.user.id }
}

async function requireAdmin(): Promise<{ id: string }> {
  const { id } = await requireUser()
  const user = await prisma.user.findUnique({ where: { id }, select: { isAdmin: true } })
  if (!user?.isAdmin) throw new Error("Forbidden")
  return { id }
}

function asChallengeKind(value: string | null | undefined): ChallengeKind | undefined {
  return value && CHALLENGE_KINDS.has(value) ? (value as ChallengeKind) : undefined
}

function iso(d: Date | null | undefined): string | undefined {
  return d ? d.toISOString() : undefined
}

/** Prisma @db.Date comes back as UTC midnight; keep only the calendar day. */
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function dateOnly(ymdStr: string): Date {
  return new Date(`${ymdStr}T00:00:00.000Z`)
}

function sessionWhere(userId: string) {
  return { userId_provider: { userId, provider: PROVIDER } }
}

// ─── User-facing ────────────────────────────────────────────────────────────

export async function getPrivateRateStatus(): Promise<{
  enabled: boolean
  entitled: boolean
  session: { status: SessionStatus; challengeKind?: ChallengeKind; lastValidatedAt?: string; lastUsedAt?: string } | null
  checksRemainingToday: number
}> {
  const { id: userId } = await requireUser()
  const [enabled, entitled] = await Promise.all([isPrivateRatesEnabled(), userIsEntitled(userId, PROVIDER)])
  // Hidden unless enabled AND entitled: do not even reveal whether a session exists.
  if (!enabled || !entitled) return { enabled, entitled, session: null, checksRemainingToday: 0 }

  const [row, remaining] = await Promise.all([
    prisma.privateRateSession.findUnique({ where: sessionWhere(userId) }),
    checksRemainingToday(userId, PROVIDER),
  ])

  if (!row) return { enabled, entitled, session: null, checksRemainingToday: remaining }

  // An AWAITING_LOGIN row older than the login timeout is expired; report it that way.
  let status = row.status as SessionStatus
  if (status === "AWAITING_LOGIN" && Date.now() - row.createdAt.getTime() > LOGIN_TIMEOUT_MS) {
    status = "EXPIRED"
    await prisma.privateRateSession.update({ where: { id: row.id }, data: { status } }).catch(() => undefined)
  }

  return {
    enabled,
    entitled,
    session: {
      status,
      challengeKind: asChallengeKind(row.challengeKind),
      lastValidatedAt: iso(row.lastValidatedAt),
      lastUsedAt: iso(row.lastUsedAt),
    },
    checksRemainingToday: remaining,
  }
}

/**
 * Open an isolated browser on Hilton's sign-in page for this user and return
 * the live view. The session row's id is the runner's session id so polls can
 * verify ownership without a second column.
 */
export async function connectHilton(): Promise<{ sessionId: string; liveViewUrl: string } | { error: string }> {
  const { id: userId } = await requireUser()
  try {
    await assertEnabledAndEntitled(userId, PROVIDER)
  } catch (err) {
    if (err instanceof PrivateRatesGateError) {
      return { error: err.reason === "DISABLED" ? "Private rates are turned off right now." : "Private rates are not available on your account." }
    }
    throw err
  }

  let runner
  try {
    runner = await getRunner()
  } catch {
    return { error: "The secure browser is not available right now. Try again in a few minutes." }
  }

  let opened: { sessionId: string; liveViewUrl: string }
  try {
    opened = await runner.openInteractive(userId)
  } catch {
    return { error: "The secure browser could not be started. Try again in a few minutes." }
  }

  // Replace any previous session row for this user. Old HotelRateQuote rows keep
  // their old sessionId (plain id, no FK), which is fine: they expire on their own.
  await prisma.$transaction([
    prisma.privateRateSession.deleteMany({ where: { userId, provider: PROVIDER } }),
    prisma.privateRateSession.create({
      data: { id: opened.sessionId, userId, provider: PROVIDER, status: "AWAITING_LOGIN", challengeKind: null },
    }),
  ])

  await audit(userId, "CONNECT", { sessionId: opened.sessionId }, { provider: PROVIDER })
  revalidatePath("/settings/private-rates")
  return opened
}

/**
 * One short poll of the interactive sign-in. The client calls this every few
 * seconds while the live view is open; each call waits at most POLL_WAIT_MS on
 * the runner. This polls OUR runner's sign-in state, never Hilton.
 */
export async function pollHiltonConnect(sessionId: string): Promise<{
  status: "AWAITING_LOGIN" | "ACTIVE" | "NEEDS_USER" | "EXPIRED"
  challengeKind?: ChallengeKind
  /** While AWAITING_LOGIN: a fresh live-view URL when the runner re-issued one (viewer socket dropped). */
  liveViewUrl?: string
}> {
  const { id: userId } = await requireUser()
  // One session, one user: the row must be this user's.
  const row = await prisma.privateRateSession.findFirst({ where: { id: sessionId, userId, provider: PROVIDER } })
  if (!row) return { status: "EXPIRED" }

  if (row.status === "ACTIVE") return { status: "ACTIVE" }
  if (row.status === "NEEDS_USER") return { status: "NEEDS_USER", challengeKind: asChallengeKind(row.challengeKind) }
  if (row.status === "EXPIRED" || row.status === "REVOKED") return { status: "EXPIRED" }

  const [enabled, entitled] = await Promise.all([isPrivateRatesEnabled(), userIsEntitled(userId, PROVIDER)])
  if (!enabled || !entitled) {
    // Kill switch flipped or entitlement revoked mid-login: do not keep the
    // interactive browser alive.
    await prisma.privateRateSession.update({ where: { id: row.id }, data: { status: "EXPIRED" } })
    return { status: "EXPIRED" }
  }

  const expireAt = row.createdAt.getTime() + LOGIN_TIMEOUT_MS
  if (Date.now() >= expireAt) {
    await prisma.privateRateSession.update({ where: { id: row.id }, data: { status: "EXPIRED" } })
    return { status: "EXPIRED" }
  }

  let outcome: "SIGNED_IN" | "TIMEOUT" | "CHALLENGE"
  let runner: Awaited<ReturnType<typeof getRunner>>
  try {
    runner = await getRunner()
    outcome = await runner.awaitSignedIn(sessionId, Math.min(POLL_WAIT_MS, Math.max(0, expireAt - Date.now())))
  } catch {
    // Runner unreachable on this poll; the client will poll again until the login timeout.
    return { status: "AWAITING_LOGIN" }
  }

  if (outcome === "SIGNED_IN") {
    const now = new Date()
    await prisma.privateRateSession.update({
      where: { id: row.id },
      data: { status: "ACTIVE", challengeKind: null, lastValidatedAt: now },
    })
    revalidatePath("/settings/private-rates")
    return { status: "ACTIVE" }
  }

  if (outcome === "CHALLENGE") {
    // The user handles every challenge; we never attempt to solve or bypass one.
    // BLOCKED (bot protection refused the runner's browser) stays NEEDS_USER too,
    // with its own kind so the UI can say signing in again will not help.
    const challengeKind: ChallengeKind =
      asChallengeKind(runner.getChallengeKind ? runner.getChallengeKind(sessionId) : null) ?? "UNKNOWN_INTERSTITIAL"
    await prisma.privateRateSession.update({
      where: { id: row.id },
      data: { status: "NEEDS_USER", challengeKind },
    })
    await audit(userId, "CHALLENGE", { phase: "connect", sessionId, challengeKind }, { provider: PROVIDER })
    revalidatePath("/settings/private-rates")
    return { status: "NEEDS_USER", challengeKind }
  }

  // Short poll elapsed without a sign-in; overall timeout is checked at the top of the next call.
  if (Date.now() >= expireAt) {
    await prisma.privateRateSession.update({ where: { id: row.id }, data: { status: "EXPIRED" } })
    return { status: "EXPIRED" }
  }
  // If the viewer's socket dropped, the runner has a fresh one-time URL; hand
  // it to the client so the live view can reconnect.
  const liveViewUrl = runner.getLiveViewUrl ? await runner.getLiveViewUrl(sessionId) : null
  return liveViewUrl ? { status: "AWAITING_LOGIN", liveViewUrl } : { status: "AWAITING_LOGIN" }
}

/** Destroy the sealed profile on the runner and the metadata row (§6.4). */
export async function disconnectHilton(): Promise<{ ok: true }> {
  const { id: userId } = await requireUser()
  let runnerDestroyed = true
  try {
    const runner = await getRunner()
    await runner.destroy(userId)
  } catch {
    // Still remove the row so the app forgets the session; the audit row records
    // that the runner-side blob may need cleaning up.
    runnerDestroyed = false
  }
  await prisma.privateRateSession.deleteMany({ where: { userId, provider: PROVIDER } })
  await audit(userId, "DISCONNECT", { runnerDestroyed }, { provider: PROVIDER })
  revalidatePath("/settings/private-rates")
  return { ok: true }
}

/**
 * The function the opportunities pipeline calls after the user clicks
 * "Check my Hilton Go rates". One click = one check against the daily cap.
 *
 *   1. gates: enabled, entitled, daily cap
 *   2. the search must belong to the caller
 *   3. an ACTIVE session must exist (anything else → NO_SESSION; the UI sends
 *      the user to /settings/private-rates)
 *   4. planRateChecks groups un-pruned stage>=2 candidates (fallback >=1) by
 *      (destination, checkIn, checkOut) and spreads maxPropertiesPerCheck
 *   5. one provider.checkCityRates per group; HotelRateQuote rows are written
 *      per group so a later challenge keeps what was already retrieved
 *   6. CHALLENGE / SIGNED_OUT stops the run at once: session → NEEDS_USER with
 *      challengeKind, CHALLENGE audited, no retry
 */
export async function checkPrivateRatesForSearch(
  searchId: string,
): Promise<{ status: CheckStatus; quotesWritten: number; challengeKind?: ChallengeKind }> {
  const { id: userId } = await requireUser()

  let remaining: number
  try {
    remaining = (await assertCanRun(userId, PROVIDER)).checksRemainingToday
  } catch (err) {
    if (err instanceof PrivateRatesGateError) return { status: err.reason, quotesWritten: 0 }
    throw err
  }

  const search = await prisma.opportunitySearch.findFirst({ where: { id: searchId, userId }, select: { id: true, privateRatesAuthorizedAt: true } })
  if (!search) throw new Error("Search not found")

  const sessionRow = await prisma.privateRateSession.findUnique({ where: sessionWhere(userId) })
  if (!sessionRow || sessionRow.status !== "ACTIVE") return { status: "NO_SESSION", quotesWritten: 0 }

  const [rows, maxPropertiesPerCheck] = await Promise.all([
    prisma.opportunityCandidate.findMany({
      where: { searchId, pruned: false, stage: { gte: 1 } },
      select: {
        id: true,
        destinationIata: true,
        destinationName: true,
        destinationLat: true,
        destinationLng: true,
        checkIn: true,
        checkOut: true,
        stage: true,
        pruned: true,
        score: true,
      },
    }),
    getConfigKeyNumber("privateRates.maxPropertiesPerCheck"),
  ])

  const candidates: PlanCandidate[] = rows.map((r) => ({
    id: r.id,
    destinationIata: r.destinationIata,
    destinationName: r.destinationName,
    destinationLat: r.destinationLat,
    destinationLng: r.destinationLng,
    checkIn: ymd(r.checkIn),
    checkOut: ymd(r.checkOut),
    stage: r.stage,
    pruned: r.pruned,
    score: r.score,
  }))

  const plan = planRateChecks(candidates, { maxPropertiesPerCheck, checksRemainingToday: remaining })
  if (plan.skipped === "LIMIT") return { status: "LIMIT", quotesWritten: 0 }
  if (plan.groups.length === 0) return { status: "OK", quotesWritten: 0 } // nothing to price; no check consumed

  // The click is the explicit authorisation for stage 3 on this search.
  if (!search.privateRatesAuthorizedAt) {
    await prisma.opportunitySearch.update({ where: { id: searchId }, data: { privateRatesAuthorizedAt: new Date() } })
  }

  // The CHECK_RATES audit row is what the daily cap counts, so it is written
  // BEFORE the runner call: two concurrent clicks cannot both pass assertCanRun
  // above and then both run. Its detail is filled in when the check finishes.
  const auditRow = await prisma.privateRateAuditLog.create({
    data: {
      userId,
      provider: PROVIDER,
      action: "CHECK_RATES",
      searchId,
      detail: { status: "STARTED", groupsPlanned: plan.groups.length, quotesWritten: 0 },
    },
    select: { id: true },
  })
  const settleAudit = async (detail: Record<string, unknown>) => {
    try {
      await prisma.privateRateAuditLog.update({
        where: { id: auditRow.id },
        data: { detail: JSON.parse(JSON.stringify(detail)) as object },
      })
    } catch (err) {
      console.error("[private-rates] could not settle CHECK_RATES audit row:", err)
    }
  }

  let runner
  try {
    runner = await getRunner()
  } catch {
    await settleAudit({ status: "RUNNER_UNAVAILABLE", groupsPlanned: plan.groups.length, quotesWritten: 0 })
    return { status: "RUNNER_UNAVAILABLE", quotesWritten: 0 }
  }
  const provider = await getRateProvider(PROVIDER)

  const retrievedAt = new Date()
  const expiresAt = new Date(retrievedAt.getTime() + QUOTE_TTL_MS)

  const execute = async (group: RateCheckGroup): Promise<RunnerResult<RateObservation[]>> => {
    try {
      const result = await provider.checkCityRates(runner, userId, {
        location: group.location,
        lat: group.lat,
        lng: group.lng,
        checkIn: group.checkIn,
        checkOut: group.checkOut,
        maxProperties: group.maxProperties,
      })
      return flattenCityRates(result)
    } catch {
      return { ok: false, status: "RUNNER_UNAVAILABLE" }
    }
  }

  const write = async (group: RateCheckGroup, observations: RateObservation[]): Promise<number> => {
    if (observations.length === 0) return 0
    const created = await prisma.hotelRateQuote.createMany({
      data: observations.map((o) => ({
        userId,
        provider: PROVIDER,
        propertyCode: o.propertyCode,
        propertyName: o.propertyName,
        brand: o.brand ?? null,
        // Property coordinates when the page exposed them; else the destination's.
        lat: typeof o.lat === "number" ? o.lat : group.lat,
        lng: typeof o.lng === "number" ? o.lng : group.lng,
        checkIn: dateOnly(o.checkIn || group.checkIn),
        checkOut: dateOnly(o.checkOut || group.checkOut),
        rateKind: o.rateKind,
        nightlyRate: o.nightlyRate,
        totalRate: o.totalRate,
        currency: o.currency || "USD",
        roomType: o.roomType ?? null,
        available: o.available,
        sessionId: sessionRow.id,
        retrievedAt,
        expiresAt,
      })),
    })
    return created.count
  }

  // Kill-switch checkpoint between groups. getConfig caches for 60s, so a flip
  // takes effect within a minute; that is the "next checkpoint" of §6.2.
  const { status, progress } = await runPlannedChecks(plan.groups, { execute, write, shouldContinue: isPrivateRatesEnabled })

  const stopped = progress.stopped
  let stoppedKind: ChallengeKind | undefined
  if (stopped?.kind === "FAILURE" && (stopped.status === "CHALLENGE" || stopped.status === "SIGNED_OUT")) {
    const challengeKind: ChallengeKind =
      stopped.status === "SIGNED_OUT" ? "SIGNED_OUT" : (stopped.challengeKind ?? "UNKNOWN_INTERSTITIAL")
    await prisma.privateRateSession.update({
      where: { id: sessionRow.id },
      data: { status: "NEEDS_USER", challengeKind, lastUsedAt: retrievedAt },
    })
    stoppedKind = challengeKind
    await audit(userId, "CHALLENGE", { phase: "check", challengeKind, groupsAttempted: progress.groupsAttempted }, { provider: PROVIDER, searchId })
  } else {
    await prisma.privateRateSession.update({ where: { id: sessionRow.id }, data: { lastUsedAt: retrievedAt } })
  }

  await settleAudit({
    status,
    stageUsed: plan.stageUsed,
    groupsPlanned: progress.groupsPlanned,
    groupsAttempted: progress.groupsAttempted,
    groupsSucceeded: progress.groupsSucceeded,
    groupsSkipped: progress.groupsSkipped,
    quotesWritten: progress.quotesWritten,
    maxPropertiesPerCheck,
    rateCodeConfigured: provider.hasPrivateRateCode,
  })

  revalidatePath("/settings/private-rates")
  return stoppedKind ? { status, quotesWritten: progress.quotesWritten, challengeKind: stoppedKind } : { status, quotesWritten: progress.quotesWritten }
}

// ─── Go Rates capture (user-run Chrome extension) ───────────────────────────

/**
 * The capture endpoint's absolute URL. Read NEXT_PUBLIC_APP_URL through a
 * computed key: a literal `process.env.NEXT_PUBLIC_APP_URL` is inlined at build
 * time, and the Docker build sets it to http://localhost:3000.
 */
function captureEndpointUrl(): string {
  const key = ["NEXT_PUBLIC", "APP_URL"].join("_")
  const base = process.env[key] || process.env.AUTH_URL || process.env.NEXTAUTH_URL || "https://www.journeyperfect.com"
  return `${base.replace(/\/+$/, "")}/api/private-rates/capture`
}

function gateMessage(reason: string): string {
  switch (reason) {
    case "DISABLED":
      return "Private rates are turned off right now."
    case "NOT_ENTITLED":
      return "Private rates are not available on your account."
    case "LIMIT":
      return "You have reached today's limit for rate checks. Try again tomorrow."
    default:
      return "Private rates are not available right now."
  }
}

/**
 * Build the plan the Go Rates extension executes in the user's own Chrome:
 * one Hilton search tab per (destination, dates) group, plus a 45-minute
 * capture token bound to this user and search. Never touches the browser
 * runner or the PrivateRateSession.
 *
 * Gates: enabled + entitled + daily cap. One plan = one check: a CHECK_RATES
 * audit row (detail.mode "extension") is written here, before any tab opens,
 * so two quick clicks cannot both slip under the cap. An empty plan consumes
 * nothing.
 */
export async function createGoRatesCapturePlan(searchId: string): Promise<{ plan: GoRatesPlan } | { error: string }> {
  const { id: userId } = await requireUser()
  try {
    await assertCanRun(userId, PROVIDER)
  } catch (err) {
    if (err instanceof PrivateRatesGateError) return { error: gateMessage(err.reason) }
    throw err
  }

  const search = await prisma.opportunitySearch.findFirst({
    where: { id: searchId, userId },
    select: { id: true, travelerProfileIds: true },
  })
  if (!search) return { error: "Search not found." }

  const [rows, maxItems, urlTemplate] = await Promise.all([
    prisma.opportunityCandidate.findMany({
      where: { searchId, pruned: false, stage: { gte: 1 } },
      select: {
        id: true,
        destinationIata: true,
        destinationName: true,
        destinationLat: true,
        destinationLng: true,
        checkIn: true,
        checkOut: true,
        stage: true,
        pruned: true,
        score: true,
      },
    }),
    getConfigKeyNumber("privateRates.maxPropertiesPerCheck"),
    getConfigKey("privateRates.hilton.searchUrlTemplate"),
  ])

  const candidates: PlanCandidate[] = rows.map((r) => ({
    id: r.id,
    destinationIata: r.destinationIata,
    destinationName: r.destinationName,
    destinationLat: r.destinationLat,
    destinationLng: r.destinationLng,
    checkIn: ymd(r.checkIn),
    checkOut: ymd(r.checkOut),
    stage: r.stage,
    pruned: r.pruned,
    score: r.score,
  }))
  const items = buildGoRatesItems(candidates, {
    maxItems,
    urlTemplate,
    travelerCount: Math.max(1, search.travelerProfileIds.length),
  })
  if (items.length === 0) return { error: "Nothing to price yet for this search." }

  let token: string
  try {
    token = signCaptureToken({ userId, searchId }).token
  } catch {
    console.error("[private-rates] capture token secret is not configured")
    return { error: "Go rates capture is not set up on the server yet." }
  }

  // Reserve the daily check before any tab opens.
  await prisma.privateRateAuditLog.create({
    data: {
      userId,
      provider: PROVIDER,
      action: "CHECK_RATES",
      searchId,
      detail: { mode: "extension", status: "PLANNED", itemsPlanned: items.length },
    },
  })
  revalidatePath("/settings/private-rates")

  return {
    plan: {
      version: 1,
      searchId,
      token,
      captureUrl: captureEndpointUrl(),
      maxConcurrentTabs: GO_RATES_MAX_CONCURRENT_TABS,
      items,
    },
  }
}

/**
 * Apply what the extension captured: mark the search authorised for private
 * rates, then re-run stage 3 in "captured" mode (scores only from quotes
 * already stored for this user, ≤24h old; the browser runner is never called)
 * and stage 4. `blockedPages` counts tabs the extension reported as blocked
 * since this search's latest extension plan.
 */
export async function finishGoRatesCapture(
  searchId: string,
): Promise<{ status: string; opportunityCount: number; quotesUsed: number; blockedPages: number }> {
  const { id: userId } = await requireUser()
  const search = await prisma.opportunitySearch.findFirst({ where: { id: searchId, userId }, select: { id: true, privateRatesAuthorizedAt: true } })
  if (!search) throw new Error("Search not found")

  const countOpportunities = () => prisma.travelOpportunity.count({ where: { searchId, userId } })

  try {
    await assertEnabledAndEntitled(userId, PROVIDER)
  } catch (err) {
    if (err instanceof PrivateRatesGateError) {
      return { status: `FAILED: ${gateMessage(err.reason)}`, opportunityCount: await countOpportunities(), quotesUsed: 0, blockedPages: 0 }
    }
    throw err
  }

  if (!search.privateRatesAuthorizedAt) {
    await prisma.opportunitySearch.update({ where: { id: searchId }, data: { privateRatesAuthorizedAt: new Date() } })
  }

  const blockedPages = await blockedPagesSinceLatestPlan(userId, searchId)

  // Dynamic import: the pipeline imports this module (runner-mode stage 3).
  const { runStage, StageRefusedError } = await import("@/lib/opportunities/pipeline")
  let status: string
  let quotesUsed = 0
  try {
    const s3 = await runStage(searchId, 3, { privateRatesMode: "captured" })
    quotesUsed = s3.quotesUsed ?? 0
    const s4 = await runStage(searchId, 4)
    status = s4.status
  } catch (err) {
    console.error("[private-rates] finishGoRatesCapture failed:", err)
    status = err instanceof StageRefusedError ? `FAILED: ${err.message}` : "FAILED: Your captured rates could not be applied. Please try again."
  }

  revalidatePath(`/opportunities/${searchId}`)
  return { status, opportunityCount: await countOpportunities(), quotesUsed, blockedPages }
}

async function blockedPagesSinceLatestPlan(userId: string, searchId: string): Promise<number> {
  try {
    const plans = await prisma.privateRateAuditLog.findMany({
      where: { userId, provider: PROVIDER, action: "CHECK_RATES", searchId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { createdAt: true, detail: true },
    })
    const latest = plans.find((p) => (p.detail as { mode?: unknown } | null)?.mode === "extension")
    if (!latest) return 0
    const captures = await prisma.privateRateAuditLog.findMany({
      where: { userId, provider: PROVIDER, action: "CAPTURE", searchId, createdAt: { gte: latest.createdAt } },
      select: { detail: true },
      take: 1000,
    })
    return captures.filter((c) => (c.detail as { blocked?: unknown } | null)?.blocked === true).length
  } catch {
    return 0
  }
}

// ─── Admin ──────────────────────────────────────────────────────────────────

export async function adminListPrivateRates(): Promise<{
  enabled: boolean
  entitlements: {
    id: string
    userId: string
    email: string
    name: string | null
    grantedBy: string
    grantedAt: string
    revokedAt: string | null
    notes: string | null
  }[]
  sessions: {
    id: string
    userId: string
    email: string
    status: string
    challengeKind: string | null
    lastValidatedAt: string | null
    lastUsedAt: string | null
    createdAt: string
  }[]
}> {
  await requireAdmin()
  const [enabled, entitlements, sessions] = await Promise.all([
    isPrivateRatesEnabled(),
    prisma.privateRateEntitlement.findMany({
      where: { provider: PROVIDER },
      include: { user: { select: { email: true, name: true } } },
      orderBy: { grantedAt: "desc" },
    }),
    prisma.privateRateSession.findMany({
      where: { provider: PROVIDER },
      include: { user: { select: { email: true } } },
      orderBy: { updatedAt: "desc" },
    }),
  ])
  return {
    enabled,
    entitlements: entitlements.map((e) => ({
      id: e.id,
      userId: e.userId,
      email: e.user.email,
      name: e.user.name,
      grantedBy: e.grantedBy,
      grantedAt: e.grantedAt.toISOString(),
      revokedAt: e.revokedAt ? e.revokedAt.toISOString() : null,
      notes: e.notes,
    })),
    sessions: sessions.map((s) => ({
      id: s.id,
      userId: s.userId,
      email: s.user.email,
      status: s.status,
      challengeKind: s.challengeKind,
      lastValidatedAt: s.lastValidatedAt ? s.lastValidatedAt.toISOString() : null,
      lastUsedAt: s.lastUsedAt ? s.lastUsedAt.toISOString() : null,
      createdAt: s.createdAt.toISOString(),
    })),
  }
}

/**
 * Grant (or re-grant) the Hilton entitlement. `userId` may be a User id or, when
 * it contains "@", the user's email; the admin UI works by email lookup.
 */
export async function adminGrantEntitlement(
  userId: string,
  notes?: string,
): Promise<{ ok: true; userId: string; email: string } | { error: string }> {
  const admin = await requireAdmin()
  const needle = userId.trim()
  if (!needle) return { error: "Enter a user id or email." }
  const user = needle.includes("@")
    ? await prisma.user.findUnique({ where: { email: needle.toLowerCase() }, select: { id: true, email: true } })
    : await prisma.user.findUnique({ where: { id: needle }, select: { id: true, email: true } })
  if (!user) return { error: "No user with that email." }

  await prisma.privateRateEntitlement.upsert({
    where: { userId_provider: { userId: user.id, provider: PROVIDER } },
    update: { revokedAt: null, grantedBy: admin.id, grantedAt: new Date(), notes: notes?.trim() || null },
    create: { userId: user.id, provider: PROVIDER, grantedBy: admin.id, notes: notes?.trim() || null },
  })
  revalidatePath("/admin/private-rates")
  return { ok: true, userId: user.id, email: user.email }
}

/** Revoke the entitlement and destroy the user's session (blob + row), per §6.3/§6.4. */
export async function adminRevokeEntitlement(userId: string): Promise<{ ok: true } | { error: string }> {
  const admin = await requireAdmin()
  const existing = await prisma.privateRateEntitlement.findUnique({ where: { userId_provider: { userId, provider: PROVIDER } } })
  if (!existing) return { error: "No entitlement for that user." }

  await prisma.privateRateEntitlement.update({ where: { id: existing.id }, data: { revokedAt: new Date() } })

  let runnerDestroyed = true
  try {
    const runner = await getRunner()
    await runner.destroy(userId)
  } catch {
    runnerDestroyed = false
  }
  await prisma.privateRateSession.deleteMany({ where: { userId, provider: PROVIDER } })
  await audit(userId, "REVOKE", { by: admin.id, runnerDestroyed }, { provider: PROVIDER })
  revalidatePath("/admin/private-rates")
  return { ok: true }
}

/** App-wide kill switch. Off disables every private-rate action at its next checkpoint. */
export async function adminSetKillSwitch(enabled: boolean): Promise<{ ok: true; enabled: boolean }> {
  const admin = await requireAdmin()
  await setConfig("privateRates.enabled", enabled ? "true" : "false")
  await audit(admin.id, "KILL_SWITCH", { enabled }, { provider: PROVIDER })
  revalidatePath("/admin/private-rates")
  revalidatePath("/admin/settings")
  return { ok: true, enabled }
}

export async function adminListAudit(limit = 100): Promise<
  { id: string; userId: string; email: string | null; action: string; searchId: string | null; detail: unknown; createdAt: string }[]
> {
  await requireAdmin()
  const take = Math.min(Math.max(1, Math.floor(limit)), 500)
  const rows = await prisma.privateRateAuditLog.findMany({ where: { provider: PROVIDER }, orderBy: { createdAt: "desc" }, take })
  const userIds = [...new Set(rows.map((r) => r.userId))]
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } })
    : []
  const emailById = new Map(users.map((u) => [u.id, u.email]))
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    email: emailById.get(r.userId) ?? null,
    action: r.action,
    searchId: r.searchId,
    detail: r.detail,
    createdAt: r.createdAt.toISOString(),
  }))
}
