"use client"

/**
 * Settings for private hotel rates: which programs the user has (Hilton Go,
 * Marriott F&F, and whether Marriott's rate code is set, never its value),
 * the Hilton Go runner connection, and the Go Rates extension.
 * See docs/plans/opportunity-discovery-engine.md §6.
 *
 * Connect → connectHilton() opens an isolated browser on Hilton's sign-in page
 * and we show its live view. While it is open we poll OUR runner (never Hilton)
 * every 3s via pollHiltonConnect until ACTIVE, NEEDS_USER or EXPIRED. There is
 * no automatic retry: if Hilton asks for anything, the user handles it.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { LiveView } from "@/components/private-rates/live-view"
import { useGoRatesExtension } from "@/components/private-rates/use-go-rates-extension"
import { connectHilton, disconnectHilton, getPrivateRateStatus, pollHiltonConnect } from "@/lib/actions/private-rates"

type Status = Awaited<ReturnType<typeof getPrivateRateStatus>>
type Live = { sessionId: string; liveViewUrl: string }

const POLL_EVERY_MS = 3_000

const CHALLENGE_TEXT: Record<string, string> = {
  CAPTCHA: "Hilton showed a security check.",
  MFA: "Hilton asked for a verification code.",
  SECURITY_VERIFY: "Hilton asked you to verify it's you.",
  SIGNED_OUT: "Hilton signed you out.",
  UNKNOWN_INTERSTITIAL: "Hilton showed a page we did not expect.",
  BLOCKED: "Hilton's site blocked the automated browser before the sign-in page loaded. Nothing was retrieved. This isn't something you can fix by signing in again.",
}

function formatWhen(isoStr?: string): string {
  if (!isoStr) return "never"
  const d = new Date(isoStr)
  return Number.isNaN(d.getTime()) ? "unknown" : d.toLocaleString()
}

export function PrivateRatesView({ initial }: { initial: Status }) {
  const [status, setStatus] = useState<Status>(initial)
  const [live, setLive] = useState<Live | null>(null)
  const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopped = useRef(false)

  const refresh = useCallback(async () => {
    try {
      setStatus(await getPrivateRateStatus())
    } catch {
      // keep the last known status
    }
  }, [])

  const stopPolling = useCallback(() => {
    stopped.current = true
    if (pollTimer.current) clearTimeout(pollTimer.current)
    pollTimer.current = null
  }, [])

  useEffect(() => () => stopPolling(), [stopPolling])

  const pollOnce = useCallback(
    async (sessionId: string) => {
      if (stopped.current) return
      let result: Awaited<ReturnType<typeof pollHiltonConnect>>
      try {
        result = await pollHiltonConnect(sessionId)
      } catch {
        result = { status: "AWAITING_LOGIN" }
      }
      if (stopped.current) return

      if (result.status === "ACTIVE") {
        stopPolling()
        setLive(null)
        setNotice(null)
        toast.success("Hilton connected.")
        await refresh()
        return
      }
      if (result.status === "NEEDS_USER") {
        stopPolling()
        setLive(null)
        // BLOCKED: reconnecting will not help, so do not suggest it.
        setNotice(
          result.challengeKind === "BLOCKED"
            ? CHALLENGE_TEXT.BLOCKED
            : `${CHALLENGE_TEXT[result.challengeKind ?? ""] ?? "Hilton needs your attention."} Connect again to continue.`,
        )
        await refresh()
        return
      }
      if (result.status === "EXPIRED") {
        stopPolling()
        setLive(null)
        setNotice("The sign-in window expired. Connect again when you are ready.")
        await refresh()
        return
      }
      // The runner re-issues a one-time live-view URL when the viewer's socket
      // dropped; swapping it in makes <LiveView> reconnect.
      const refreshedUrl = result.liveViewUrl
      if (refreshedUrl) {
        setLive((prev) => (prev && prev.sessionId === sessionId && prev.liveViewUrl !== refreshedUrl ? { ...prev, liveViewUrl: refreshedUrl } : prev))
      }
      pollTimer.current = setTimeout(() => void pollOnce(sessionId), POLL_EVERY_MS)
    },
    [refresh, stopPolling],
  )

  async function handleConnect() {
    setBusy("connect")
    setNotice(null)
    try {
      const res = await connectHilton()
      if ("error" in res) {
        toast.error(res.error)
        return
      }
      stopped.current = false
      setLive(res)
      pollTimer.current = setTimeout(() => void pollOnce(res.sessionId), POLL_EVERY_MS)
    } catch {
      toast.error("Could not start the secure browser.")
    } finally {
      setBusy(null)
    }
  }

  async function handleDisconnect() {
    if (!window.confirm("Disconnect Hilton? This deletes the saved session. You can connect again later.")) return
    setBusy("disconnect")
    try {
      stopPolling()
      setLive(null)
      await disconnectHilton()
      toast.success("Hilton disconnected.")
      await refresh()
    } catch {
      toast.error("Could not disconnect. Try again.")
    } finally {
      setBusy(null)
    }
  }

  function handleCancelLogin() {
    stopPolling()
    setLive(null)
    setNotice("Sign-in cancelled. Nothing was saved.")
  }

  const sessionStatus = status.session?.status ?? "NONE"
  const connected = sessionStatus === "ACTIVE"
  const needsUser = sessionStatus === "NEEDS_USER"

  const badge = connected
    ? { label: "Connected", className: "bg-green-100 text-green-800" }
    : needsUser
      ? { label: "Needs your attention", className: "bg-amber-100 text-amber-800" }
      : { label: "Not connected", className: "bg-gray-100 text-gray-700" }

  return (
    <div className="space-y-6">
      <ProgramsSection status={status} />

      {status.hiltonEntitled && (
        <section className="rounded-lg border border-gray-200 bg-white p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-gray-900">Hilton account</h2>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}>{badge.label}</span>
              </div>
              <p className="mt-1 text-sm text-gray-500">
                {connected && <>Last validated {formatWhen(status.session?.lastValidatedAt)}. Last used {formatWhen(status.session?.lastUsedAt)}.</>}
                {needsUser && (CHALLENGE_TEXT[status.session?.challengeKind ?? ""] ?? "Hilton needs your attention.")}
                {!connected && !needsUser && "Connect to let JourneyPerfect check Team Member rates on your behalf when you ask."}
              </p>
              <p className="mt-1 text-xs text-gray-400">
                {status.checksRemainingToday} rate {status.checksRemainingToday === 1 ? "check" : "checks"} left today.
              </p>
            </div>
            <div className="flex flex-shrink-0 gap-2">
              {!live && (
                <button
                  type="button"
                  onClick={handleConnect}
                  disabled={busy !== null}
                  className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
                >
                  {busy === "connect" ? "Starting…" : connected ? "Reconnect" : needsUser ? "Sign in again" : "Connect Hilton"}
                </button>
              )}
              {status.session && !live && (
                <button
                  type="button"
                  onClick={handleDisconnect}
                  disabled={busy !== null}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  {busy === "disconnect" ? "Removing…" : "Disconnect"}
                </button>
              )}
            </div>
          </div>

          {notice && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{notice}</div>}

          {live && (
            <div className="mt-4 space-y-3">
              <LiveView liveViewUrl={live.liveViewUrl} onSignedIn={() => void pollOnce(live.sessionId)} />
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>Waiting for you to finish signing in (up to 10 minutes)…</span>
                <button type="button" onClick={handleCancelLogin} className="text-gray-600 underline hover:text-gray-900">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      <GoRatesExtensionSection />

      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">How this works</h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-gray-600">
          <li>You sign in on Hilton&apos;s own page inside a browser we host. We never see, store or send your password.</li>
          <li>If Hilton asks for a code, a security check or anything else, it is yours to answer. We never try to get past it.</li>
          <li>Rates are checked only when you press the button. Nothing runs in the background, on a schedule or ahead of time.</li>
          <li>Your session is used only for your own searches. Your rates are never shared with or shown to anyone else.</li>
          <li>This feature is turned on for your account specifically. It is not advertised or offered generally.</li>
          <li>The browser that does the work can move between our servers; how it runs does not change what it is allowed to do.</li>
          <li>When something goes wrong you are told exactly what happened and what was not retrieved. There are no silent retries.</li>
        </ul>
      </section>
    </div>
  )
}

/** Which private-rate programs this account has; Marriott's rate code status (set / not set, never the value). */
function ProgramsSection({ status }: { status: Status }) {
  const rows: { name: string; on: boolean; detail: string }[] = [
    {
      name: "Hilton Go (team member)",
      on: status.providers.hilton,
      detail: status.providers.hilton ? "Go Hilton search plus a public search per destination." : "Not enabled for your account.",
    },
    {
      name: "Marriott Friends & Family",
      on: status.providers.marriott,
      detail: !status.providers.marriott
        ? "Not enabled for your account."
        : status.marriottRateCodeSet
          ? "Rate code: set. F&F search plus a public search per destination."
          : "Rate code: not set. No Marriott tabs open until an admin sets it.",
    },
  ]
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-gray-900">Your programs</h2>
      <ul className="mt-3 space-y-2">
        {rows.map((r) => (
          <li key={r.name} className="flex flex-wrap items-start justify-between gap-2 text-sm">
            <span className="min-w-0">
              <span className="font-medium text-gray-900">{r.name}</span>
              <span className="block text-xs text-gray-500">{r.detail}</span>
            </span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.on ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}>
              {r.on ? "On" : "Off"}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-gray-400">
        {status.checksRemainingToday} rate {status.checksRemainingToday === 1 ? "check" : "checks"} left today.
      </p>
    </section>
  )
}

/** Install guide + presence badge for the Go Rates Chrome extension (linked as #extension). */
function GoRatesExtensionSection() {
  const { detected, checking } = useGoRatesExtension()
  const badge = detected
    ? { label: "Installed", className: "bg-green-100 text-green-800" }
    : checking
      ? { label: "Checking…", className: "bg-gray-100 text-gray-600" }
      : { label: "Not detected", className: "bg-gray-100 text-gray-700" }

  return (
    <section id="extension" className="scroll-mt-6 rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-gray-900">Go Rates Chrome extension</h2>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}>{badge.label}</span>
      </div>
      <p className="mt-1 text-sm text-gray-600">
        The extension opens Hilton and Marriott search tabs in your own Chrome (a private-rate search and a public one for
        each destination), reads the rates shown on the page and sends them to your JourneyPerfect account. You stay
        signed in yourself, in your own browser. No password is involved: JourneyPerfect never sees your sign-in.
      </p>
      <p className="mt-2 text-sm text-gray-600">
        Once it is installed, an opportunity search shows an &ldquo;Open Go rate tabs&rdquo; button in its Private rates step.
        Tabs open only when you press it.
      </p>

      <h3 className="mt-4 text-sm font-semibold text-gray-900">Install</h3>
      <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-gray-600">
        <li>
          In Chrome, open <code className="rounded bg-gray-100 px-1 py-0.5 text-xs text-gray-800">chrome://extensions</code>.
        </li>
        <li>Turn on <strong>Developer mode</strong> (top right).</li>
        <li>
          Click <strong>Load unpacked</strong> and select the <code className="rounded bg-gray-100 px-1 py-0.5 text-xs text-gray-800">extensions/go-rates</code>{" "}
          folder from the JourneyPerfect repo:
          <div className="mt-1 break-all rounded bg-gray-50 px-2 py-1 font-mono text-xs text-gray-800">
            ~/claude-dashboard/journeyperfect/extensions/go-rates
          </div>
        </li>
        <li>Sign in to Go Hilton in Chrome once. The extension uses that sign-in; it does not store it. For Marriott the F&amp;F rate code is part of the search URL; sign in to Marriott too if your program asks for it.</li>
        <li>Reload this page. The badge above should say Installed.</li>
      </ol>
    </section>
  )
}
