/**
 * Private Rates: gating, provider/runner selection and audit.
 * See docs/plans/opportunity-discovery-engine.md §6.
 *
 * Server-only (Prisma via getConfig and the audit log).
 *
 * Two independent gates, both required (§6.2):
 *   - app-wide kill switch  getConfig("privateRates.enabled", "false")
 *   - per-user entitlement  PrivateRateEntitlement row with revokedAt null
 * Plus a per-user daily cap counted from CHECK_RATES audit rows.
 *
 * The feature is hidden unless BOTH gates pass; nothing here ever reads, logs
 * or stores a credential, and every session lookup is keyed on the calling
 * user's id (one session, one user).
 */
import { prisma } from "@/lib/db"
import { getConfig } from "@/lib/config"
import { getConfigKey, getConfigKeyBoolean, getConfigKeyNumber } from "@/lib/config-keys"
import { getBrowserRunner } from "./runner"
import { HiltonRateProvider, HILTON_RATE_CODE_CONFIG_KEY } from "./providers/hilton"
import type { BrowserRunner, PrivateRateAuditAction, PrivateRateProviderId } from "./types"

export const DEFAULT_PROVIDER: PrivateRateProviderId = "hilton"

export type GateReason = "DISABLED" | "NOT_ENTITLED" | "LIMIT"

/** Thrown by assertCanRun / assertEnabledAndEntitled; `reason` maps 1:1 onto UI statuses. */
export class PrivateRatesGateError extends Error {
  constructor(readonly reason: GateReason) {
    super(`private rates: ${reason}`)
    this.name = "PrivateRatesGateError"
  }
}

/** App-wide kill switch. Off by default. */
export async function isPrivateRatesEnabled(): Promise<boolean> {
  return getConfigKeyBoolean("privateRates.enabled")
}

/** Admin-granted, per-user, not a plan tier. Revoked rows do not count. */
export async function userIsEntitled(userId: string, provider: PrivateRateProviderId = DEFAULT_PROVIDER): Promise<boolean> {
  const row = await prisma.privateRateEntitlement.findUnique({
    where: { userId_provider: { userId, provider } },
    select: { revokedAt: true },
  })
  return !!row && row.revokedAt === null
}

/** Start of the current UTC day; the daily cap is counted in UTC to keep it simple and predictable. */
export function startOfTodayUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

/** CHECK_RATES audit rows today. Each user click is one check. */
export async function checksUsedToday(userId: string, provider: PrivateRateProviderId = DEFAULT_PROVIDER): Promise<number> {
  return prisma.privateRateAuditLog.count({
    where: { userId, provider, action: "CHECK_RATES", createdAt: { gte: startOfTodayUtc() } },
  })
}

export async function checksRemainingToday(userId: string, provider: PrivateRateProviderId = DEFAULT_PROVIDER): Promise<number> {
  const [cap, used] = await Promise.all([getConfigKeyNumber("privateRates.maxChecksPerDay"), checksUsedToday(userId, provider)])
  return Math.max(0, Math.floor(cap) - used)
}

/** Enabled + entitled. Used by connect/disconnect, which do not consume a daily check. */
export async function assertEnabledAndEntitled(userId: string, provider: PrivateRateProviderId = DEFAULT_PROVIDER): Promise<void> {
  if (!(await isPrivateRatesEnabled())) throw new PrivateRatesGateError("DISABLED")
  if (!(await userIsEntitled(userId, provider))) throw new PrivateRatesGateError("NOT_ENTITLED")
}

/**
 * Enabled + entitled + under the daily cap. Returns the remaining count so the
 * caller can pass it to the planner.
 */
export async function assertCanRun(
  userId: string,
  provider: PrivateRateProviderId = DEFAULT_PROVIDER,
): Promise<{ checksRemainingToday: number }> {
  await assertEnabledAndEntitled(userId, provider)
  const remaining = await checksRemainingToday(userId, provider)
  if (remaining <= 0) throw new PrivateRatesGateError("LIMIT")
  return { checksRemainingToday: remaining }
}

/**
 * Append-only audit row. `detail` must never contain credentials, cookies,
 * page contents or screencast frames: counts, statuses and ids only.
 */
export async function audit(
  userId: string,
  action: PrivateRateAuditAction,
  detail?: Record<string, unknown>,
  options: { provider?: PrivateRateProviderId; searchId?: string } = {},
): Promise<void> {
  try {
    await prisma.privateRateAuditLog.create({
      data: {
        userId,
        provider: options.provider ?? DEFAULT_PROVIDER,
        action,
        searchId: options.searchId,
        detail: detail === undefined ? undefined : (JSON.parse(JSON.stringify(detail)) as object),
      },
    })
  } catch (err) {
    // Auditing must never take the feature down, but it must not be silent either.
    console.error("[private-rates] audit write failed", { action, err })
  }
}

/**
 * Provider factory. The Hilton Team Member rate code is a config key because it
 * depends on the user's program; an empty code means only public rates are run.
 */
export async function getRateProvider(providerId: PrivateRateProviderId = DEFAULT_PROVIDER): Promise<HiltonRateProvider> {
  switch (providerId) {
    case "hilton": {
      const rateCode = await getConfig(HILTON_RATE_CODE_CONFIG_KEY, "")
      return new HiltonRateProvider({ rateCode })
    }
    default: {
      const never: never = providerId
      throw new Error(`Unknown private-rate provider "${String(never)}"`)
    }
  }
}

/**
 * Runner selection from config (§6.5). Throws when the runner is misconfigured
 * or BROWSER_RUNNER_SECRET is missing; callers map that to RUNNER_UNAVAILABLE.
 */
export async function getRunner(): Promise<BrowserRunner> {
  const [runner, runnerUrl] = await Promise.all([getConfigKey("privateRates.runner"), getConfigKey("privateRates.runnerUrl")])
  return getBrowserRunner({ runner, runnerUrl })
}

export { HiltonRateProvider, HILTON_RATE_CODE_CONFIG_KEY } from "./providers/hilton"
export type * from "./types"
