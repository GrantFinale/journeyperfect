/**
 * POST /run orchestration: unseal → launch → verify signed in → task → seal.
 *
 * Hard rules:
 *   - the profile unsealed here belongs to `userId` and is used for nothing else
 *   - no scheduler: this runs once per explicit request
 *   - no retries after a challenge (the task returns and we stop)
 *   - one hard deadline (MAX_RUN_MS) for the whole run
 *   - the scratch dir is wiped in `finally`, including on crash paths
 *   - the profile is re-sealed after the browser closes so refreshed cookies persist
 */
import type { BrowserContext } from "playwright"
import { detectChallenge } from "./challenges.js"
import { collectPageSignals, runHiltonCityRatesTask, runHiltonRatesTask, verifySignedIn } from "./hilton.js"
import type { Logger } from "./sessions.js"
import type { RateObservation, RunnerResult, RunnerTask } from "./types.js"

export interface RunDeps {
  unsealProfile(userId: string): Promise<string | null>
  launch(profileDir: string): Promise<BrowserContext>
  sealProfile(userId: string, profileDir: string): Promise<void>
  wipeDir(dir: string): Promise<void>
  maxRunMs: number
  rateCodeParam: string
  log: Logger
}

export async function runTask(userId: string, task: RunnerTask, deps: RunDeps): Promise<RunnerResult<RateObservation[]>> {
  const deadlineAt = Date.now() + deps.maxRunMs
  const remaining = () => deadlineAt - Date.now()

  const profileDir = await deps.unsealProfile(userId)
  if (!profileDir) return { ok: false, status: "SIGNED_OUT" }

  let context: BrowserContext | null = null
  let result: RunnerResult<RateObservation[]>
  try {
    context = await deps.launch(profileDir)
    const page = context.pages()[0] ?? (await context.newPage())

    const signedIn = await verifySignedIn(page, Math.max(5_000, Math.min(45_000, remaining()))).catch(() => false)
    if (!signedIn) {
      // An Akamai block on the account page also looks "not signed in"; report
      // it as BLOCKED so the user is not told to sign in again for nothing.
      const kind = await collectPageSignals(page)
        .then(detectChallenge)
        .catch(() => "NONE" as const)
      result = kind === "BLOCKED" ? { ok: false, status: "CHALLENGE", challengeKind: "BLOCKED" } : { ok: false, status: "SIGNED_OUT" }
    } else {
      const ctx = { deadlineAt, rateCodeParam: deps.rateCodeParam, log: deps.log }
      result =
        task.kind === "HILTON_CITY_RATES"
          ? await runHiltonCityRatesTask(page, task, ctx)
          : await runHiltonRatesTask(page, task, ctx)
    }
  } catch (err) {
    deps.log.error({ userId, err: err instanceof Error ? `${err.name}: ${err.message}` : String(err) }, "run failed")
    result = { ok: false, status: remaining() <= 0 ? "TIMEOUT" : "PARSE_FAILED" }
  } finally {
    try {
      if (context) await context.close().catch(() => undefined)
      // Re-seal so the refreshed session state is what the next run opens.
      await deps.sealProfile(userId, profileDir).catch((err: unknown) => {
        deps.log.error({ userId, err: err instanceof Error ? err.message : String(err) }, "re-seal failed")
      })
    } finally {
      await deps.wipeDir(profileDir)
    }
  }
  return result
}
