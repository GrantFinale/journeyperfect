/**
 * PURE. Classify a page (after a navigation) into a ChallengeKind from
 * URL/DOM-derived signals. No network, no DOM access: the runner extracts
 * PageSignals and hands them here.
 *
 * IMPORTANT: services/browser-runner/src/challenges.ts is a byte-for-byte copy
 * of this file (only the `./types` import specifier differs). The service's test
 * suite asserts the two stay identical; edit both together.
 *
 * Invocation contract: detectChallenge is only called on pages where we expected
 * real content (a results page or the account page). A sign-in page in that
 * position therefore always means SIGNED_OUT. During the interactive sign-in the
 * runner calls it on every poll too, but only acts on BLOCKED there (the other
 * kinds are informational while the user drives the live view).
 *
 * Rule order (first match wins):
 *   1. BLOCKED               bot protection refused the page (Akamai "Access Denied" / "Reference No. 18.x")
 *   2. CAPTCHA               recaptcha/hcaptcha/arkose iframes, "verify you are human", bot walls
 *   3. MFA                   "verification code" / "one-time" / "authenticator" / OTP field names
 *   4. SECURITY_VERIFY       "verify it's you" / "unusual activity" / "confirm your identity"
 *   5. SIGNED_OUT            sign-in URL, or a sign-in (password) form where results were expected
 *   6. UNKNOWN_INTERSTITIAL  no results/account markers and none of the above
 *   7. NONE
 */
import type { ChallengeKind } from "./types"

export interface PageSignals {
  url: string
  title: string
  /** Visible text of the document (the runner sends at most the first 20k chars). */
  bodyText: string
  /** `src` of every iframe on the page. */
  hasIframeFrom?: string[]
  /** `name` (or id) of every input/select/textarea on the page. */
  formFieldNames?: string[]
}

/**
 * Akamai (hilton.com's bot protection) block pages: HTTP 403, usually titled
 * "Access Denied", or a "Something went wrong ... Reference No. 18.<hex>" page.
 * There is nothing for the user to solve here; the browser was refused.
 */
const BLOCKED_TITLE = [/access denied/]
const BLOCKED_TEXT = [/reference\s*(no\.?|#)\s*\d+\.[0-9a-f]+/, /you don't have permission to access/, /errors\.edgesuite\.net/]

const CAPTCHA_IFRAME_HOSTS = [
  "recaptcha.net",
  "google.com/recaptcha",
  "gstatic.com/recaptcha",
  "hcaptcha.com",
  "arkoselabs.com",
  "funcaptcha.com",
  "challenges.cloudflare.com",
  "perimeterx.net",
  "px-cdn.net",
  "px-cloud.net",
]

const CAPTCHA_TEXT = [
  /verify (that )?you are (a )?human/,
  /i'm not a robot/,
  /prove you are human/,
  /press (and|&) hold/,
  /checking (your|the) browser/,
  /complete the security check/,
  /captcha/,
]

const CAPTCHA_TITLE = [/^just a moment/, /attention required/, /captcha/, /human verification/]

const MFA_TEXT = [
  /verification code/,
  /one[- ]time (code|passcode|password|pin)/,
  /one[- ]time\b/,
  /authenticator/,
  /enter the (\d[- ]digit )?code (we|that was) sent/,
  /security code (was|has been) sent/,
  /two[- ](step|factor) (verification|authentication)/,
]

const MFA_FIELD = [
  /^otp/,
  /otp$/,
  /one[-_]?time/,
  /verification[-_]?code/,
  /^mfa/,
  /mfa[-_]?code/,
  /^totp/,
  /passcode/,
  /security[-_]?code/,
  /^auth[-_]?code$/,
  /^code[-_]?\d$/, // per-digit code inputs: code1..code6
]

const SECURITY_TEXT = [
  /verify it'?s you/,
  /unusual activity/,
  /suspicious activity/,
  /confirm (your|it'?s your) identity/,
  /verify your identity/,
  /we need to verify (your account|it'?s you)/,
  /account (has been )?(temporarily )?locked/,
]

const SIGN_IN_PATH = /\/(login|log-in|signin|sign-in|sign_in|auth(entication)?)(\/|\?|#|$)/
const SIGN_IN_TEXT = [
  /your session has (expired|timed out)/,
  /please sign in again/,
  /you('ve| have) been signed out/,
  /sign in to (continue|your account)/,
]
const PASSWORD_FIELD = /^(password|passwd|pwd|pass|current-?password)$/
const USERNAME_FIELD = /^(username|user-?name|email|email-?address|login|honors-?number|hhonors|userid|user-?id)$/

/** Markers that a results page (or the account page) actually rendered. */
const CONTENT_PATH = /\/(book|search|reservation|reservations|rooms|hilton-honors\/guest)(\/|\?|#|$)/
const CONTENT_TEXT = [
  /per night/,
  /\/\s?night/,
  /select (a |your )?room/,
  /view (rates|rooms)/,
  /rooms? available/,
  /no rooms (are )?available/,
  /sold out/,
  /rate details/,
  /total for (your )?stay/,
  /nightly/,
  /room type/,
  /points per night/,
  /honors points/,
  /my account/,
  /sign out/,
]

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
}

function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase()
  } catch {
    return url.toLowerCase()
  }
}

function any(patterns: RegExp[], text: string): boolean {
  return patterns.some((p) => p.test(text))
}

export function detectChallenge(signals: PageSignals): ChallengeKind {
  const body = normalize(signals.bodyText ?? "")
  const title = normalize(signals.title ?? "")
  const path = pathnameOf(signals.url ?? "")
  const iframes = (signals.hasIframeFrom ?? []).map((s) => s.toLowerCase())
  const fields = (signals.formFieldNames ?? []).map((f) => f.toLowerCase().trim())

  // 1. Blocked outright by bot protection (checked before CAPTCHA: nothing to solve)
  if (any(BLOCKED_TITLE, title) || any(BLOCKED_TEXT, body)) return "BLOCKED"
  if (/something went wrong/.test(body) && /reference/.test(body)) return "BLOCKED"

  // 2. CAPTCHA / bot wall
  if (iframes.some((src) => CAPTCHA_IFRAME_HOSTS.some((host) => src.includes(host)))) return "CAPTCHA"
  if (any(CAPTCHA_TITLE, title) || any(CAPTCHA_TEXT, body)) return "CAPTCHA"

  // 3. MFA
  if (fields.some((f) => any(MFA_FIELD, f))) return "MFA"
  if (any(MFA_TEXT, body)) return "MFA"

  // 4. Security verification interstitial
  if (any(SECURITY_TEXT, body) || any(SECURITY_TEXT, title)) return "SECURITY_VERIFY"

  // 5. Signed out: we expected content, got a sign-in page/form instead
  if (SIGN_IN_PATH.test(path)) return "SIGNED_OUT"
  const hasPassword = fields.some((f) => PASSWORD_FIELD.test(f))
  const hasUsername = fields.some((f) => USERNAME_FIELD.test(f))
  if (hasPassword && hasUsername) return "SIGNED_OUT"
  if (any(SIGN_IN_TEXT, body)) return "SIGNED_OUT"

  // 6. Nothing recognisable rendered
  const hasContent = CONTENT_PATH.test(path) || any(CONTENT_TEXT, body)
  if (!hasContent) return "UNKNOWN_INTERSTITIAL"

  // 7. Looks like a normal page
  return "NONE"
}
