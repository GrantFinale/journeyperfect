/**
 * HTTP API. Bearer auth on every route except GET /healthz.
 *
 *   POST   /sessions              {userId}        → 201 {sessionId, liveViewUrl}
 *   GET    /sessions/:id/status                   → {status, challengeKind?, liveViewUrl?}
 *   POST   /run                   {userId, task}  → RunnerResult<RateObservation[]>
 *   DELETE /users/:userId                         → 204
 *   GET    /healthz                               → {ok:true}
 *
 * Hard rules:
 *   - a session is only reported to / acted on for its owner: the caller passes
 *     userId on /run and /users; /sessions/:id is keyed by an unguessable id and
 *     the record carries its owner, which the live view and DELETE assert against
 *   - nothing about credentials is ever logged: request logging is off, the
 *     Authorization header is redacted, live-view URLs (they carry the token)
 *     are never logged
 *   - no scheduler, no retries: every action here is a direct response to one
 *     request from the app, which itself acts only on explicit user action
 */
import Fastify, { LogController, type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify"
import { timingSafeEqual } from "node:crypto"
import type { RunnerConfig } from "./config.js"
import { isValidUserId } from "./seal.js"
import { SessionConflictError, type SessionManager, type UserLocks } from "./sessions.js"
import type { RateObservation, RunnerResult, RunnerTask, RunnerTaskProperty } from "./types.js"

export interface ApiDeps {
  config: Pick<RunnerConfig, "secret" | "liveViewPublicUrl">
  sessions: SessionManager
  locks: UserLocks
  runTask(userId: string, task: RunnerTask): Promise<RunnerResult<RateObservation[]>>
  destroySealed(userId: string): Promise<boolean>
  logger?: boolean | object
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const CODE_RE = /^[A-Za-z0-9]{3,12}$/

export function buildApi(deps: ApiDeps): FastifyInstance {
  const app = Fastify({
    logger: deps.logger ?? { level: "info", redact: ["req.headers.authorization"] },
    // No per-request access log: URLs and headers must never end up in logs.
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 64 * 1024,
  })

  const expected = Buffer.from(deps.config.secret)
  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.method === "GET" && req.url === "/healthz") return
    const header = req.headers.authorization ?? ""
    const token = header.startsWith("Bearer ") ? header.slice(7) : ""
    const given = Buffer.from(token)
    const ok = given.length === expected.length && given.length > 0 && timingSafeEqual(given, expected)
    if (!ok) {
      reply.code(401).send({ error: "unauthorized" })
      return reply
    }
  })

  app.get("/healthz", async () => ({ ok: true }))

  app.post("/sessions", async (req, reply) => {
    const body = req.body as { userId?: unknown } | null
    const userId = body?.userId
    if (!isValidUserId(userId)) return reply.code(400).send({ error: "userId is required" })
    try {
      const session = await deps.sessions.open(userId)
      const token = session.liveToken
      if (!token) throw new Error("live token missing")
      return reply.code(201).send({ sessionId: session.sessionId, liveViewUrl: liveViewUrl(deps, session.sessionId, token) })
    } catch (err) {
      if (err instanceof SessionConflictError) return reply.code(409).send({ error: err.message })
      req.log.error({ err: describe(err) }, "POST /sessions failed")
      return reply.code(503).send({ error: "could not start browser session" })
    }
  })

  app.get("/sessions/:id/status", async (req, reply) => {
    const { id } = req.params as { id: string }
    const session = deps.sessions.get(id)
    if (!session) return reply.code(404).send({ error: "unknown session" })
    const s = deps.sessions.statusOf(session)
    const out: Record<string, unknown> = { status: s.status }
    if (s.challengeKind) out.challengeKind = s.challengeKind
    if (s.liveToken) out.liveViewUrl = liveViewUrl(deps, session.sessionId, s.liveToken)
    return out
  })

  app.post("/run", async (req, reply) => {
    const body = req.body as { userId?: unknown; task?: unknown } | null
    const userId = body?.userId
    if (!isValidUserId(userId)) return reply.code(400).send({ error: "userId is required" })
    const task = validateTask(body?.task)
    if (!task.ok) return reply.code(400).send({ error: task.error })

    if (!deps.locks.tryAcquire(userId, "run")) {
      const holder = deps.locks.holder(userId)
      return reply.code(409).send({
        error: holder === "session" ? "an interactive sign-in is open for this user" : "a run is already in progress for this user",
      })
    }
    try {
      return await deps.runTask(userId, task.task)
    } catch (err) {
      req.log.error({ err: describe(err) }, "POST /run failed")
      const result: RunnerResult<RateObservation[]> = { ok: false, status: "RUNNER_UNAVAILABLE" }
      return reply.code(500).send(result)
    } finally {
      deps.locks.release(userId, "run")
    }
  })

  app.delete("/users/:userId", async (req, reply) => {
    const { userId } = req.params as { userId: string }
    if (!isValidUserId(userId)) return reply.code(400).send({ error: "invalid userId" })
    await deps.sessions.endForUser(userId)
    await deps.destroySealed(userId)
    return reply.code(204).send()
  })

  return app
}

function liveViewUrl(deps: ApiDeps, sessionId: string, token: string): string {
  return `${deps.config.liveViewPublicUrl}/live/${encodeURIComponent(sessionId)}?token=${encodeURIComponent(token)}`
}

type TaskValidation = { ok: true; task: RunnerTask } | { ok: false; error: string }

export function validateTask(input: unknown): TaskValidation {
  if (!input || typeof input !== "object") return { ok: false, error: "task is required" }
  const t = input as Record<string, unknown>
  const rateCode = t.rateCode === undefined ? undefined : typeof t.rateCode === "string" && /^[A-Za-z0-9-]{1,32}$/.test(t.rateCode) ? t.rateCode : null
  if (rateCode === null) return { ok: false, error: "task.rateCode is invalid" }

  if (t.kind === "HILTON_RATES") {
    if (!Array.isArray(t.properties) || t.properties.length === 0 || t.properties.length > 50) {
      return { ok: false, error: "task.properties must have 1–50 entries" }
    }
    const properties: RunnerTaskProperty[] = []
    for (const p of t.properties as unknown[]) {
      const q = p as Record<string, unknown> | null
      if (
        !q ||
        typeof q.propertyCode !== "string" ||
        !CODE_RE.test(q.propertyCode) ||
        typeof q.checkIn !== "string" ||
        !DATE_RE.test(q.checkIn) ||
        typeof q.checkOut !== "string" ||
        !DATE_RE.test(q.checkOut)
      ) {
        return { ok: false, error: "task.properties entries need propertyCode, checkIn, checkOut (YYYY-MM-DD)" }
      }
      properties.push({ propertyCode: q.propertyCode.toUpperCase(), checkIn: q.checkIn, checkOut: q.checkOut })
    }
    return { ok: true, task: { kind: "HILTON_RATES", properties, ...(rateCode ? { rateCode } : {}) } }
  }

  if (t.kind === "HILTON_CITY_RATES") {
    if (typeof t.location !== "string" || !t.location.trim() || t.location.length > 200) {
      return { ok: false, error: "task.location is required" }
    }
    if (typeof t.checkIn !== "string" || !DATE_RE.test(t.checkIn) || typeof t.checkOut !== "string" || !DATE_RE.test(t.checkOut)) {
      return { ok: false, error: "task.checkIn/checkOut must be YYYY-MM-DD" }
    }
    const lat = t.lat === undefined ? undefined : Number(t.lat)
    const lng = t.lng === undefined ? undefined : Number(t.lng)
    if ((lat !== undefined && !(Number.isFinite(lat) && Math.abs(lat) <= 90)) || (lng !== undefined && !(Number.isFinite(lng) && Math.abs(lng) <= 180))) {
      return { ok: false, error: "task.lat/lng are invalid" }
    }
    const maxProperties = t.maxProperties === undefined ? undefined : Number(t.maxProperties)
    if (maxProperties !== undefined && !(Number.isInteger(maxProperties) && maxProperties >= 1 && maxProperties <= 50)) {
      return { ok: false, error: "task.maxProperties must be 1–50" }
    }
    return {
      ok: true,
      task: {
        kind: "HILTON_CITY_RATES",
        location: t.location.trim(),
        checkIn: t.checkIn,
        checkOut: t.checkOut,
        ...(lat !== undefined ? { lat } : {}),
        ...(lng !== undefined ? { lng } : {}),
        ...(rateCode ? { rateCode } : {}),
        ...(maxProperties !== undefined ? { maxProperties } : {}),
      },
    }
  }

  return { ok: false, error: "task.kind must be HILTON_RATES or HILTON_CITY_RATES" }
}

function describe(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err)
}
