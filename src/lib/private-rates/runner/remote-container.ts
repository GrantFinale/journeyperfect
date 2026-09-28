/**
 * TODO: RemoteContainerRunner — a BrowserRunner that speaks the same interface
 * to a hosted browser provider (which supplies its own live-view URL). See
 * docs/plans/opportunity-discovery-engine.md §6.5: swapping this in behind
 * getBrowserRunner() must be a config change, not a rewrite.
 *
 * Every method throws until implemented. Type-compatible stub only.
 */
/* eslint-disable @typescript-eslint/no-unused-vars -- stub keeps the interface's parameter names */
import type { AwaitSignedInOutcome, BrowserRunner, RunnerResult, RunnerTask } from "../types"

export interface RemoteContainerRunnerConfig {
  /** Provider endpoint, e.g. a hosted browser API base URL. */
  runnerUrl: string
}

export class RemoteContainerRunner implements BrowserRunner {
  constructor(readonly config: RemoteContainerRunnerConfig) {}

  openInteractive(_userId: string): Promise<{ sessionId: string; liveViewUrl: string }> {
    return Promise.reject(notImplemented("openInteractive"))
  }

  awaitSignedIn(_sessionId: string, _timeoutMs: number): Promise<AwaitSignedInOutcome> {
    return Promise.reject(notImplemented("awaitSignedIn"))
  }

  run<T>(_userId: string, _task: RunnerTask): Promise<RunnerResult<T>> {
    return Promise.reject(notImplemented("run"))
  }

  destroy(_userId: string): Promise<void> {
    return Promise.reject(notImplemented("destroy"))
  }
}

function notImplemented(method: string): Error {
  return new Error(`RemoteContainerRunner.${method} is not implemented`)
}
