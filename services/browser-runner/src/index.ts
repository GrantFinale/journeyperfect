/**
 * Entry point: wire config, sealing, sessions, live view and the HTTP API.
 *
 * This process has no scheduler. It does nothing until the Next.js app calls it
 * on behalf of a user's explicit action, and every browser it launches belongs
 * to exactly one user's sealed profile.
 */
import fs from "node:fs/promises"
import path from "node:path"
import type { FastifyInstance } from "fastify"
import { chromium, type BrowserContext } from "playwright"
import { buildApi } from "./api.js"
import { loadConfig } from "./config.js"
import { collectPageSignals, isSignedIn, openSignIn } from "./hilton.js"
import { attachLiveView, VIEWPORT } from "./live-view.js"
import { runTask } from "./run.js"
import { destroySealed, makeScratchDir, sealProfile, unsealProfile, wipeDir, type SealContext } from "./seal.js"
import { SessionManager, UserLocks, type Logger } from "./sessions.js"

async function main(): Promise<void> {
  const config = loadConfig()
  const sealCtx: SealContext = { dataDir: config.dataDir, masterKey: config.masterKey }
  await fs.mkdir(path.join(config.dataDir, "sealed"), { recursive: true, mode: 0o700 })

  const launch = (profileDir: string): Promise<BrowserContext> =>
    chromium.launchPersistentContext(profileDir, {
      headless: config.headless,
      viewport: { ...VIEWPORT },
      locale: "en-US",
      // Chromium's own shared memory goes to /tmp so a small container /dev/shm
      // is not a crash risk; our scratch dirs pick tmpfs separately (seal.ts).
      args: ["--disable-dev-shm-usage"],
    })
  const seal = async (userId: string, dir: string): Promise<void> => {
    await sealProfile(userId, dir, sealCtx)
  }

  // The Fastify logger is created by buildApi(); the session manager is built
  // first, so it logs through a thin indirection that resolves at call time.
  // eslint-disable-next-line prefer-const -- assigned after the closures below capture it
  let api: FastifyInstance | undefined
  const log: Logger = {
    info: (o, m) => api?.log.info(o, m),
    warn: (o, m) => api?.log.warn(o, m),
    error: (o, m) => api?.log.error(o, m),
  }

  const locks = new UserLocks()
  const sessions = new SessionManager(
    {
      prepareProfile: async (userId) => (await unsealProfile(userId, sealCtx)) ?? makeScratchDir("jp-profile-"),
      launch,
      openSignIn,
      isSignedIn,
      collectSignals: collectPageSignals,
      sealProfile: seal,
      wipeDir,
    },
    locks,
    { loginTimeoutMs: config.sessionLoginTimeoutMs, log },
  )

  api = buildApi({
    config,
    locks,
    sessions,
    runTask: (userId, task) =>
      runTask(userId, task, {
        unsealProfile: (u) => unsealProfile(u, sealCtx),
        launch,
        sealProfile: seal,
        wipeDir,
        maxRunMs: config.maxRunMs,
        rateCodeParam: config.hiltonRateCodeParam,
        log,
      }),
    destroySealed: (userId) => destroySealed(userId, sealCtx),
  })

  attachLiveView(api.server, sessions, log, { allowedOrigins: config.liveViewAllowedOrigins })

  if (config.liveViewDefaulted) {
    log.warn({}, "LIVE_VIEW_PUBLIC_URL is not set; live view URLs point at localhost and will not work for remote users")
  }
  if (config.liveViewAllowedOrigins.length === 0) {
    log.warn({}, "LIVE_VIEW_ALLOWED_ORIGIN is not set; the live-view WebSocket accepts any Origin (token is the only guard)")
  }

  const server = api
  const shutdown = async (signal: string) => {
    log.info({ signal }, "shutting down")
    try {
      await sessions.shutdown()
      await server.close()
    } finally {
      process.exit(0)
    }
  }
  process.once("SIGTERM", () => void shutdown("SIGTERM"))
  process.once("SIGINT", () => void shutdown("SIGINT"))

  await api.listen({ port: config.port, host: config.host })
  log.info({ port: config.port, dataDir: config.dataDir, headless: config.headless }, "browser-runner listening")
}

main().catch((err) => {
  // Config errors are the common case here; print the message only.
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
