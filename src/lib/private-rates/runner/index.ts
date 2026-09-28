/**
 * Runner selection (§6.5). The caller reads `privateRates.runner` and
 * `privateRates.runnerUrl` from config and passes them here; this module does
 * not touch the database or the config store itself.
 *
 *   "local"            → HttpRunnerClient. The "local" runner is the
 *                        services/browser-runner service deployed beside the
 *                        app (it is a separate process even when local, because
 *                        the Next.js app never imports Playwright).
 *   "remote-container" → RemoteContainerRunner (TODO stub; throws when used).
 */
import type { BrowserRunner } from "../types"
import { HttpRunnerClient, type HttpRunnerClientOptions } from "./http-runner-client"
import { RemoteContainerRunner } from "./remote-container"

export interface BrowserRunnerConfig {
  runner: string
  runnerUrl: string
}

export const KNOWN_RUNNERS = ["local", "remote-container"] as const

export function getBrowserRunner(
  config: BrowserRunnerConfig,
  clientOptions: HttpRunnerClientOptions = {},
): BrowserRunner {
  switch (config.runner) {
    case "local":
      if (!config.runnerUrl) {
        throw new Error('privateRates.runner is "local" but privateRates.runnerUrl is empty')
      }
      return new HttpRunnerClient(config.runnerUrl, clientOptions)
    case "remote-container":
      return new RemoteContainerRunner({ runnerUrl: config.runnerUrl })
    default:
      throw new Error(
        `Unknown privateRates.runner "${config.runner}". Expected one of: ${KNOWN_RUNNERS.join(", ")}`,
      )
  }
}

export { HttpRunnerClient, RunnerUnavailableError } from "./http-runner-client"
export { RemoteContainerRunner } from "./remote-container"
