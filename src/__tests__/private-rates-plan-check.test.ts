import { describe, it, expect } from "vitest"
import {
  applyRunnerOutcome,
  finalStatus,
  flattenCityRates,
  initialProgress,
  planRateChecks,
  runPlannedChecks,
  type PlanCandidate,
  type RateCheckGroup,
} from "@/lib/private-rates/plan-check"
import { HiltonRateProvider } from "@/lib/private-rates/providers/hilton"
import type { BrowserRunner, RateObservation, RunnerResult, RunnerTask } from "@/lib/private-rates/types"

// ─── Fixtures ────────────────────────────────────────────────────────────────

function cand(overrides: Partial<PlanCandidate> & { id: string }): PlanCandidate {
  return {
    destinationIata: "CHI",
    destinationName: "Chicago",
    destinationLat: 41.88,
    destinationLng: -87.63,
    checkIn: "2026-10-10",
    checkOut: "2026-10-12",
    stage: 2,
    pruned: false,
    score: 50,
    ...overrides,
  }
}

function obs(propertyCode: string, extra: Partial<RateObservation> = {}): RateObservation {
  return {
    propertyCode,
    propertyName: `Hotel ${propertyCode}`,
    checkIn: "2026-10-10",
    checkOut: "2026-10-12",
    rateKind: "PUBLIC",
    nightlyRate: 150,
    totalRate: 300,
    currency: "USD",
    available: true,
    ...extra,
  }
}

/**
 * Fake BrowserRunner. `script` decides each `run` call's result in order of
 * invocation; every task is recorded so tests can assert what was (not) sent.
 */
function fakeRunner(script: RunnerResult<RateObservation[]>[]): BrowserRunner & { tasks: RunnerTask[] } {
  const tasks: RunnerTask[] = []
  let i = 0
  return {
    tasks,
    async openInteractive() {
      return { sessionId: "s1", liveViewUrl: "ws://x" }
    },
    async awaitSignedIn() {
      return "SIGNED_IN"
    },
    async run<T>(_userId: string, task: RunnerTask): Promise<RunnerResult<T>> {
      tasks.push(task)
      const next = script[i++] ?? { ok: true, data: [] }
      return next as unknown as RunnerResult<T>
    },
    async destroy() {},
  }
}

const provider = new HiltonRateProvider({ rateCode: "TMTP" })

/** Wire a provider + fake runner into runPlannedChecks the way the server action does. */
function harness(runner: BrowserRunner, shouldContinue?: () => Promise<boolean>) {
  const written: { group: string; observations: RateObservation[] }[] = []
  const io = {
    execute: async (group: RateCheckGroup) =>
      flattenCityRates(
        await provider.checkCityRates(runner, "user-1", {
          location: group.location,
          lat: group.lat,
          lng: group.lng,
          checkIn: group.checkIn,
          checkOut: group.checkOut,
          maxProperties: group.maxProperties,
        }),
      ),
    write: async (group: RateCheckGroup, observations: RateObservation[]) => {
      written.push({ group: group.key, observations })
      return observations.length
    },
    shouldContinue,
  }
  return { io, written }
}

// ─── planRateChecks ──────────────────────────────────────────────────────────

describe("planRateChecks", () => {
  const caps = { maxPropertiesPerCheck: 8, checksRemainingToday: 3 }

  it("groups un-pruned candidates by destination and dates and prefers stage >= 2", () => {
    const plan = planRateChecks(
      [
        cand({ id: "a" }),
        cand({ id: "b" }), // same group as a
        cand({ id: "c", checkIn: "2026-10-17", checkOut: "2026-10-19" }),
        cand({ id: "d", destinationIata: "DEN", destinationName: "Denver", destinationLat: 39.7, destinationLng: -104.9 }),
        cand({ id: "e", stage: 1 }), // below preferred stage: excluded when stage-2 rows exist
        cand({ id: "f", pruned: true }),
      ],
      caps,
    )
    expect(plan.skipped).toBeUndefined()
    expect(plan.stageUsed).toBe(2)
    expect(plan.groups).toHaveLength(3)
    const chi = plan.groups.find((g) => g.key === "CHI|2026-10-10|2026-10-12")!
    expect(chi.candidateIds.sort()).toEqual(["a", "b"])
    expect(plan.groups.flatMap((g) => g.candidateIds)).not.toContain("e")
    expect(plan.groups.flatMap((g) => g.candidateIds)).not.toContain("f")
  })

  it("falls back to stage >= 1 when nothing reached stage 2", () => {
    const plan = planRateChecks([cand({ id: "a", stage: 1 }), cand({ id: "b", stage: 0 })], caps)
    expect(plan.stageUsed).toBe(1)
    expect(plan.groups).toHaveLength(1)
    expect(plan.groups[0].candidateIds).toEqual(["a"])
  })

  it("returns NO_CANDIDATES when everything is pruned or stage 0", () => {
    const plan = planRateChecks([cand({ id: "a", pruned: true }), cand({ id: "b", stage: 0 })], caps)
    expect(plan.groups).toEqual([])
    expect(plan.skipped).toBe("NO_CANDIDATES")
  })

  it("returns LIMIT when the daily cap is exhausted, without planning anything", () => {
    const plan = planRateChecks([cand({ id: "a" })], { maxPropertiesPerCheck: 8, checksRemainingToday: 0 })
    expect(plan.groups).toEqual([])
    expect(plan.skipped).toBe("LIMIT")
  })

  it("spreads maxPropertiesPerCheck across groups, remainder to the best-scored groups", () => {
    const plan = planRateChecks(
      [
        cand({ id: "a", score: 10 }),
        cand({ id: "b", score: 90, checkIn: "2026-10-17", checkOut: "2026-10-19" }),
        cand({ id: "c", score: 50, destinationIata: "DEN", destinationName: "Denver" }),
      ],
      caps,
    )
    expect(plan.groups.map((g) => g.candidateIds[0])).toEqual(["b", "c", "a"])
    expect(plan.groups.map((g) => g.maxProperties)).toEqual([3, 3, 2])
    expect(plan.groups.reduce((n, g) => n + g.maxProperties, 0)).toBe(8)
  })

  it("drops groups beyond the property budget rather than exceeding it", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      cand({ id: `c${i}`, destinationIata: `D${i}`, destinationName: `Dest ${i}`, score: 100 - i }),
    )
    const plan = planRateChecks(many, { maxPropertiesPerCheck: 5, checksRemainingToday: 1 })
    expect(plan.groups).toHaveLength(5)
    expect(plan.groups.every((g) => g.maxProperties === 1)).toBe(true)
    expect(plan.groups.map((g) => g.candidateIds[0])).toEqual(["c0", "c1", "c2", "c3", "c4"])
  })
})

// ─── HiltonRateProvider with a fake runner ───────────────────────────────────

describe("HiltonRateProvider.checkCityRates", () => {
  it("runs the private task then the public task and tags each list", async () => {
    const runner = fakeRunner([
      { ok: true, data: [obs("A", { nightlyRate: 99 })] },
      { ok: true, data: [obs("A", { nightlyRate: 149 })] },
    ])
    const res = await provider.checkCityRates(runner, "u", { location: "Chicago", checkIn: "2026-10-10", checkOut: "2026-10-12", maxProperties: 3 })
    expect(runner.tasks).toHaveLength(2)
    expect(runner.tasks[0]).toMatchObject({ kind: "HILTON_CITY_RATES", rateCode: "TMTP", maxProperties: 3 })
    expect(runner.tasks[1]).toMatchObject({ kind: "HILTON_CITY_RATES" })
    expect((runner.tasks[1] as { rateCode?: string }).rateCode).toBeUndefined()
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.privateRates[0].rateKind).toBe("PRIVATE_HILTON_GO")
      expect(res.data.publicRates[0].rateKind).toBe("PUBLIC")
    }
  })

  it("stops after a challenge on the private task and never issues the public task", async () => {
    const runner = fakeRunner([{ ok: false, status: "CHALLENGE", challengeKind: "MFA" }])
    const res = await provider.checkCityRates(runner, "u", { location: "Chicago", checkIn: "2026-10-10", checkOut: "2026-10-12" })
    expect(runner.tasks).toHaveLength(1) // no retry, no second task
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.status).toBe("CHALLENGE")
      expect(res.challengeKind).toBe("MFA")
    }
  })

  it("keeps private observations as partial data when the public task is signed out", async () => {
    const runner = fakeRunner([{ ok: true, data: [obs("A")] }, { ok: false, status: "SIGNED_OUT" }])
    const res = await provider.checkCityRates(runner, "u", { location: "Chicago", checkIn: "2026-10-10", checkOut: "2026-10-12" })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.status).toBe("SIGNED_OUT")
      expect(res.data?.privateRates).toHaveLength(1)
      expect(res.data?.privateRates[0].rateKind).toBe("PRIVATE_HILTON_GO")
      expect(res.data?.publicRates).toEqual([])
    }
  })

  it("skips the private task when no rate code is configured", async () => {
    const noCode = new HiltonRateProvider({ rateCode: "" })
    const runner = fakeRunner([{ ok: true, data: [obs("A")] }])
    const res = await noCode.checkCityRates(runner, "u", { location: "Chicago", checkIn: "2026-10-10", checkOut: "2026-10-12" })
    expect(runner.tasks).toHaveLength(1)
    expect(res.ok && res.data.privateRates).toEqual([])
  })
})

// ─── runPlannedChecks: the checkPrivateRatesForSearch loop ───────────────────

describe("runPlannedChecks", () => {
  const groups = planRateChecks(
    [
      cand({ id: "a", score: 90 }),
      cand({ id: "b", score: 80, destinationIata: "DEN", destinationName: "Denver" }),
      cand({ id: "c", score: 70, destinationIata: "AUS", destinationName: "Austin" }),
    ],
    { maxPropertiesPerCheck: 6, checksRemainingToday: 2 },
  ).groups

  it("prices every group and returns OK", async () => {
    const runner = fakeRunner([
      { ok: true, data: [obs("A1")] },
      { ok: true, data: [obs("A1")] },
      { ok: true, data: [obs("B1")] },
      { ok: true, data: [obs("B1")] },
      { ok: true, data: [obs("C1")] },
      { ok: true, data: [obs("C1")] },
    ])
    const { io, written } = harness(runner)
    const { status, progress } = await runPlannedChecks(groups, io)
    expect(status).toBe("OK")
    expect(progress.quotesWritten).toBe(6)
    expect(written.map((w) => w.group)).toEqual(groups.map((g) => g.key))
    expect(runner.tasks).toHaveLength(6)
  })

  it("stops at the first challenge, keeps quotes already written, and never calls the runner again", async () => {
    const runner = fakeRunner([
      { ok: true, data: [obs("A1")] }, // group 1 private
      { ok: true, data: [obs("A1")] }, // group 1 public
      { ok: false, status: "CHALLENGE", challengeKind: "CAPTCHA" }, // group 2 private → halt
    ])
    const { io, written } = harness(runner)
    const { status, progress } = await runPlannedChecks(groups, io)
    expect(status).toBe("PARTIAL")
    expect(progress.quotesWritten).toBe(2)
    expect(progress.stopped).toEqual({ kind: "FAILURE", status: "CHALLENGE", challengeKind: "CAPTCHA" })
    expect(written).toHaveLength(1)
    expect(runner.tasks).toHaveLength(3) // group 2's public task and all of group 3 were never sent
  })

  it("returns CHALLENGE when the very first task is challenged and nothing was written", async () => {
    const runner = fakeRunner([{ ok: false, status: "CHALLENGE", challengeKind: "MFA" }])
    const { io, written } = harness(runner)
    const { status, progress } = await runPlannedChecks(groups, io)
    expect(status).toBe("CHALLENGE")
    expect(progress.quotesWritten).toBe(0)
    expect(written).toEqual([])
    expect(runner.tasks).toHaveLength(1)
  })

  it("returns SIGNED_OUT and writes partial data retrieved before the sign-out", async () => {
    const runner = fakeRunner([{ ok: false, status: "SIGNED_OUT", data: [obs("A1", { rateKind: "PRIVATE_HILTON_GO" })] }])
    const { io, written } = harness(runner)
    const { status, progress } = await runPlannedChecks(groups, io)
    // Partial data from the aborted task is still persisted...
    expect(written).toHaveLength(1)
    expect(progress.quotesWritten).toBe(1)
    // ...so the outcome is PARTIAL rather than a bare SIGNED_OUT.
    expect(status).toBe("PARTIAL")
    expect(progress.stopped).toMatchObject({ kind: "FAILURE", status: "SIGNED_OUT" })
    expect(runner.tasks).toHaveLength(1)
  })

  it("halts on RUNNER_UNAVAILABLE without hammering the runner", async () => {
    const runner = fakeRunner([{ ok: false, status: "RUNNER_UNAVAILABLE" }])
    const { io } = harness(runner)
    const { status } = await runPlannedChecks(groups, io)
    expect(status).toBe("RUNNER_UNAVAILABLE")
    expect(runner.tasks).toHaveLength(1)
  })

  it("skips a group that timed out and continues with the next one", async () => {
    const runner = fakeRunner([
      { ok: false, status: "TIMEOUT" }, // group 1 private → skip group
      { ok: true, data: [obs("B1")] },
      { ok: true, data: [obs("B1")] },
      { ok: true, data: [obs("C1")] },
      { ok: true, data: [obs("C1")] },
    ])
    const { io } = harness(runner)
    const { status, progress } = await runPlannedChecks(groups, io)
    expect(status).toBe("PARTIAL")
    expect(progress.groupsSkipped).toBe(1)
    expect(progress.groupsSucceeded).toBe(2)
    expect(progress.quotesWritten).toBe(4)
  })

  it("stops at the next checkpoint when the kill switch flips off", async () => {
    const runner = fakeRunner([
      { ok: true, data: [obs("A1")] },
      { ok: true, data: [obs("A1")] },
    ])
    let calls = 0
    const { io } = harness(runner, async () => ++calls === 1) // enabled for group 1 only
    const { status, progress } = await runPlannedChecks(groups, io)
    expect(status).toBe("PARTIAL")
    expect(progress.stopped).toEqual({ kind: "DISABLED" })
    expect(runner.tasks).toHaveLength(2)
  })

  it("returns DISABLED when the kill switch is off before anything ran", async () => {
    const runner = fakeRunner([])
    const { io } = harness(runner, async () => false)
    const { status } = await runPlannedChecks(groups, io)
    expect(status).toBe("DISABLED")
    expect(runner.tasks).toHaveLength(0)
  })
})

// ─── applyRunnerOutcome / finalStatus edge cases ─────────────────────────────

describe("applyRunnerOutcome", () => {
  it("counts a successful group and does not halt", () => {
    const r = applyRunnerOutcome(initialProgress(2), { ok: true, data: [obs("A")] })
    expect(r.halt).toBe(false)
    expect(r.progress.groupsSucceeded).toBe(1)
    expect(r.observations).toHaveLength(1)
  })

  it("halts on CHALLENGE and carries the challengeKind", () => {
    const r = applyRunnerOutcome(initialProgress(2), { ok: false, status: "CHALLENGE", challengeKind: "SECURITY_VERIFY" })
    expect(r.halt).toBe(true)
    expect(r.progress.stopped).toEqual({ kind: "FAILURE", status: "CHALLENGE", challengeKind: "SECURITY_VERIFY" })
  })

  it("treats PARSE_FAILED as a skipped group, not a stop", () => {
    const r = applyRunnerOutcome(initialProgress(2), { ok: false, status: "PARSE_FAILED" })
    expect(r.halt).toBe(false)
    expect(r.progress.groupsSkipped).toBe(1)
    expect(finalStatus(r.progress)).toBe("RUNNER_UNAVAILABLE") // nothing written, nothing succeeded
  })
})
