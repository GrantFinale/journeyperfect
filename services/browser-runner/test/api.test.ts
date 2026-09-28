import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { buildApi, validateTask } from "../src/api.js"
import { SessionManager, UserLocks, type InteractiveSession, type SessionBrowserOps } from "../src/sessions.js"
import type { RateObservation, RunnerResult, RunnerTask } from "../src/types.js"

const SECRET = "test-secret-0123456789abcdef"
const auth = { authorization: `Bearer ${SECRET}` }

/** Browser ops that never launch anything: a fake context/page pair. */
function fakeOps(overrides: Partial<SessionBrowserOps> = {}): SessionBrowserOps & { wiped: string[]; sealed: string[] } {
  const wiped: string[] = []
  const sealed: string[] = []
  const page = { isClosed: () => false, url: () => "https://www.hilton.com/en/hilton-honors/login/" }
  const context = { close: async () => {}, pages: () => [page] }
  return {
    wiped,
    sealed,
    prepareProfile: async (userId) => `/tmp/fake-${userId}`,
    launch: async () => context as never,
    openSignIn: async () => page as never,
    isSignedIn: async () => false,
    collectSignals: async () => ({ url: page.url(), title: "Sign in", bodyText: "Sign in", formFieldNames: ["username", "password"] }),
    sealProfile: async (userId) => {
      sealed.push(userId)
    },
    wipeDir: async (dir) => {
      wiped.push(dir)
    },
    ...overrides,
  }
}

function build(ops: SessionBrowserOps, runTask?: (u: string, t: RunnerTask) => Promise<RunnerResult<RateObservation[]>>) {
  const locks = new UserLocks()
  const sessions = new SessionManager(ops, locks, { loginTimeoutMs: 60_000, pollIntervalMs: 20, retentionMs: 60_000 })
  const destroyed: string[] = []
  const app = buildApi({
    config: { secret: SECRET, liveViewPublicUrl: "wss://runner.example.com" },
    sessions,
    locks,
    runTask: runTask ?? (async () => ({ ok: true, data: [] })),
    destroySealed: async (u) => {
      destroyed.push(u)
      return true
    },
    logger: false,
  })
  return { app, sessions, locks, destroyed }
}

let cleanup: Array<() => Promise<void>> = []
beforeEach(() => {
  cleanup = []
})
afterEach(async () => {
  for (const fn of cleanup) await fn()
  vi.useRealTimers()
})

describe("auth", () => {
  it("serves /healthz without a token and rejects everything else without one", async () => {
    const { app, sessions } = build(fakeOps())
    cleanup.push(() => sessions.shutdown(), () => app.close())
    expect((await app.inject({ method: "GET", url: "/healthz" })).statusCode).toBe(200)
    expect((await app.inject({ method: "POST", url: "/sessions", payload: { userId: "u1" } })).statusCode).toBe(401)
    expect((await app.inject({ method: "GET", url: "/sessions/abc/status" })).statusCode).toBe(401)
    expect((await app.inject({ method: "POST", url: "/run", payload: {} })).statusCode).toBe(401)
    expect((await app.inject({ method: "DELETE", url: "/users/u1" })).statusCode).toBe(401)
    expect(
      (await app.inject({ method: "POST", url: "/sessions", headers: { authorization: "Bearer nope" }, payload: { userId: "u1" } })).statusCode,
    ).toBe(401)
  })
})

describe("sessions", () => {
  it("opens a session, reports AWAITING_LOGIN, then SIGNED_IN once the page shows the signed-in state", async () => {
    let signedIn = false
    const ops = fakeOps({ isSignedIn: async () => signedIn })
    const { app, sessions } = build(ops)
    cleanup.push(() => sessions.shutdown(), () => app.close())

    const res = await app.inject({ method: "POST", url: "/sessions", headers: auth, payload: { userId: "user-a" } })
    expect(res.statusCode).toBe(201)
    const { sessionId, liveViewUrl } = res.json() as { sessionId: string; liveViewUrl: string }
    expect(liveViewUrl.startsWith(`wss://runner.example.com/live/${sessionId}?token=`)).toBe(true)

    const status1 = await app.inject({ method: "GET", url: `/sessions/${sessionId}/status`, headers: auth })
    expect(status1.json()).toMatchObject({ status: "AWAITING_LOGIN" })
    // The token in the original liveViewUrl is still unconsumed, so status re-offers the same URL.
    expect((status1.json() as { liveViewUrl: string }).liveViewUrl).toBe(liveViewUrl)

    signedIn = true
    await vi.waitFor(async () => {
      const s = await app.inject({ method: "GET", url: `/sessions/${sessionId}/status`, headers: auth })
      expect(s.json()).toEqual({ status: "SIGNED_IN" })
    })
    expect(ops.sealed).toEqual(["user-a"])
    expect(ops.wiped).toEqual(["/tmp/fake-user-a"])
    expect(sessions.activeForUser("user-a")).toBeUndefined()
  })

  it("surfaces informational challenge kinds while awaiting login", async () => {
    const ops = fakeOps({
      collectSignals: async () => ({ url: "https://www.hilton.com/en/hilton-honors/login/", title: "", bodyText: "Enter the verification code we sent" }),
    })
    const { app, sessions } = build(ops)
    cleanup.push(() => sessions.shutdown(), () => app.close())
    const { sessionId } = (await app.inject({ method: "POST", url: "/sessions", headers: auth, payload: { userId: "user-a" } })).json()
    await vi.waitFor(async () => {
      const s = await app.inject({ method: "GET", url: `/sessions/${sessionId}/status`, headers: auth })
      expect(s.json()).toMatchObject({ status: "AWAITING_LOGIN", challengeKind: "MFA" })
    })
  })

  it("times out, wipes the scratch dir without sealing, and is one-per-user", async () => {
    const ops = fakeOps()
    const locks = new UserLocks()
    const sessions = new SessionManager(ops, locks, { loginTimeoutMs: 50, pollIntervalMs: 10, retentionMs: 60_000 })
    cleanup.push(() => sessions.shutdown())

    const first = await sessions.open("user-a")
    const second = await sessions.open("user-a") // ends `first`
    expect(first.status).toBe("TIMEOUT")
    expect(second.status).toBe("AWAITING_LOGIN")
    await vi.waitFor(() => expect(second.status).toBe("TIMEOUT"))
    expect(ops.sealed).toEqual([])
    expect(ops.wiped).toEqual(["/tmp/fake-user-a", "/tmp/fake-user-a"])
    expect(locks.holder("user-a")).toBeUndefined()
  })

  it("consumes the live token exactly once and only while awaiting login", async () => {
    const ops = fakeOps()
    const locks = new UserLocks()
    const sessions = new SessionManager(ops, locks, { loginTimeoutMs: 60_000, pollIntervalMs: 1000 })
    cleanup.push(() => sessions.shutdown())
    const s: InteractiveSession = await sessions.open("user-a")
    const token = s.liveToken!
    expect(sessions.consumeLiveToken(s, "wrong")).toBe(false)
    expect(sessions.consumeLiveToken(s, token)).toBe(true)
    expect(sessions.consumeLiveToken(s, token)).toBe(false)
    // With no viewer attached, status mints a fresh token.
    const st = sessions.statusOf(s)
    expect(st.liveToken).toBeDefined()
    expect(st.liveToken).not.toBe(token)
    await sessions.end(s, "TIMEOUT")
    expect(sessions.consumeLiveToken(s, st.liveToken!)).toBe(false)
  })

  it("returns 404 for unknown sessions and 400 for bad user ids", async () => {
    const { app, sessions } = build(fakeOps())
    cleanup.push(() => sessions.shutdown(), () => app.close())
    expect((await app.inject({ method: "GET", url: "/sessions/nope/status", headers: auth })).statusCode).toBe(404)
    expect((await app.inject({ method: "POST", url: "/sessions", headers: auth, payload: { userId: "../x" } })).statusCode).toBe(400)
  })
})

describe("run", () => {
  const task: RunnerTask = {
    kind: "HILTON_RATES",
    properties: [{ propertyCode: "CHIPDHH", checkIn: "2026-10-10", checkOut: "2026-10-12" }],
    rateCode: "TMTP",
  }

  it("validates the body and passes a normalised task through", async () => {
    const seen: Array<[string, RunnerTask]> = []
    const { app, sessions } = build(fakeOps(), async (u, t) => {
      seen.push([u, t])
      return { ok: true, data: [] }
    })
    cleanup.push(() => sessions.shutdown(), () => app.close())

    expect((await app.inject({ method: "POST", url: "/run", headers: auth, payload: { userId: "u1" } })).statusCode).toBe(400)
    expect(
      (await app.inject({ method: "POST", url: "/run", headers: auth, payload: { userId: "u1", task: { kind: "NOPE" } } })).statusCode,
    ).toBe(400)
    const ok = await app.inject({
      method: "POST",
      url: "/run",
      headers: auth,
      payload: { userId: "u1", task: { ...task, properties: [{ ...task.properties[0], propertyCode: "chipdhh" }] } },
    })
    expect(ok.statusCode).toBe(200)
    expect(ok.json()).toEqual({ ok: true, data: [] })
    expect(seen).toEqual([["u1", task]])
  })

  it("refuses to run while the same user has an interactive session open (and vice versa)", async () => {
    const { app, sessions } = build(fakeOps())
    cleanup.push(() => sessions.shutdown(), () => app.close())
    await app.inject({ method: "POST", url: "/sessions", headers: auth, payload: { userId: "u1" } })
    const res = await app.inject({ method: "POST", url: "/run", headers: auth, payload: { userId: "u1", task } })
    expect(res.statusCode).toBe(409)
    // A different user is unaffected.
    expect((await app.inject({ method: "POST", url: "/run", headers: auth, payload: { userId: "u2", task } })).statusCode).toBe(200)
  })

  it("serialises runs per user and maps thrown errors to RUNNER_UNAVAILABLE", async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const { app, sessions } = build(fakeOps(), async (u) => {
      if (u === "slow") await gate
      if (u === "boom") throw new Error("browser crashed")
      return { ok: true, data: [] }
    })
    cleanup.push(() => sessions.shutdown(), () => app.close())

    const p1 = app.inject({ method: "POST", url: "/run", headers: auth, payload: { userId: "slow", task } })
    await new Promise((r) => setTimeout(r, 10))
    const p2 = await app.inject({ method: "POST", url: "/run", headers: auth, payload: { userId: "slow", task } })
    expect(p2.statusCode).toBe(409)
    release()
    expect((await p1).statusCode).toBe(200)

    const boom = await app.inject({ method: "POST", url: "/run", headers: auth, payload: { userId: "boom", task } })
    expect(boom.statusCode).toBe(500)
    expect(boom.json()).toEqual({ ok: false, status: "RUNNER_UNAVAILABLE" })
  })
})

describe("DELETE /users/:userId", () => {
  it("ends the session and destroys the sealed blob", async () => {
    const ops = fakeOps()
    const { app, sessions, destroyed } = build(ops)
    cleanup.push(() => sessions.shutdown(), () => app.close())
    const { sessionId } = (await app.inject({ method: "POST", url: "/sessions", headers: auth, payload: { userId: "u1" } })).json()
    const res = await app.inject({ method: "DELETE", url: "/users/u1", headers: auth })
    expect(res.statusCode).toBe(204)
    expect(destroyed).toEqual(["u1"])
    expect(sessions.get(sessionId)?.status).toBe("TIMEOUT")
    expect(ops.wiped).toEqual(["/tmp/fake-u1"])
  })
})

describe("validateTask", () => {
  it("accepts HILTON_CITY_RATES with optional fields", () => {
    const v = validateTask({ kind: "HILTON_CITY_RATES", location: " Denver ", checkIn: "2026-10-10", checkOut: "2026-10-12", lat: 39.7, lng: -104.9, maxProperties: 5 })
    expect(v).toEqual({
      ok: true,
      task: { kind: "HILTON_CITY_RATES", location: "Denver", checkIn: "2026-10-10", checkOut: "2026-10-12", lat: 39.7, lng: -104.9, maxProperties: 5 },
    })
  })

  it("rejects malformed input", () => {
    expect(validateTask(null).ok).toBe(false)
    expect(validateTask({ kind: "HILTON_RATES", properties: [] }).ok).toBe(false)
    expect(validateTask({ kind: "HILTON_RATES", properties: [{ propertyCode: "CHIPDHH", checkIn: "10/10/2026", checkOut: "2026-10-12" }] }).ok).toBe(false)
    expect(validateTask({ kind: "HILTON_RATES", properties: [{ propertyCode: "CHIPDHH", checkIn: "2026-10-10", checkOut: "2026-10-12" }], rateCode: "bad code!" }).ok).toBe(false)
    expect(validateTask({ kind: "HILTON_CITY_RATES", location: "", checkIn: "2026-10-10", checkOut: "2026-10-12" }).ok).toBe(false)
    expect(validateTask({ kind: "HILTON_CITY_RATES", location: "X", checkIn: "2026-10-10", checkOut: "2026-10-12", lat: 999 }).ok).toBe(false)
    expect(validateTask({ kind: "HILTON_CITY_RATES", location: "X", checkIn: "2026-10-10", checkOut: "2026-10-12", maxProperties: 0 }).ok).toBe(false)
  })
})
