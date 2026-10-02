/*
 * JourneyPerfect Go Rates: plan validation and item matching.
 * Shared by the background service worker (importScripts) and node tests (module.exports).
 */
;(function (root) {
  "use strict"

  const APP_ORIGINS = ["https://journeyperfect.com", "https://www.journeyperfect.com", "http://localhost:3000"]
  const HILTON_ORIGIN = "https://www.hilton.com"
  const MAX_ITEMS = 12
  const DEFAULT_CONCURRENCY = 3
  const MAX_CONCURRENCY = 4
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

  function originOf(url) {
    try {
      return new URL(url).origin
    } catch (_e) {
      return null
    }
  }

  function isAppOrigin(origin) {
    return APP_ORIGINS.indexOf(origin) !== -1
  }

  function str(v, max) {
    return typeof v === "string" && v.length > 0 && v.length <= max
  }

  /**
   * Validate a plan from the page. Returns { ok: true, plan, dropped } with a
   * normalised copy, or { ok: false, error }.
   */
  function validatePlan(plan) {
    if (!plan || typeof plan !== "object") return { ok: false, error: "plan is not an object" }
    if (plan.version !== 1) return { ok: false, error: "unsupported plan version" }
    if (!str(plan.searchId, 200)) return { ok: false, error: "missing searchId" }
    if (!str(plan.token, 4096)) return { ok: false, error: "missing token" }
    if (!str(plan.captureUrl, 2048)) return { ok: false, error: "missing captureUrl" }
    let cu
    try {
      cu = new URL(plan.captureUrl)
    } catch (_e) {
      return { ok: false, error: "captureUrl is not an absolute URL" }
    }
    if (!isAppOrigin(cu.origin)) return { ok: false, error: "captureUrl origin not allowed" }
    if (cu.username || cu.password) return { ok: false, error: "captureUrl must not carry credentials" }

    let conc = plan.maxConcurrentTabs === undefined ? DEFAULT_CONCURRENCY : Number(plan.maxConcurrentTabs)
    if (!Number.isFinite(conc)) conc = DEFAULT_CONCURRENCY
    conc = Math.max(1, Math.min(MAX_CONCURRENCY, Math.floor(conc)))

    if (!Array.isArray(plan.items)) return { ok: false, error: "items must be an array" }
    const items = []
    const keys = new Set()
    let dropped = 0
    for (const it of plan.items) {
      if (items.length >= MAX_ITEMS) {
        dropped++
        continue
      }
      if (!it || typeof it !== "object" || !str(it.key, 200) || keys.has(it.key) || !str(it.url, 4096)) {
        dropped++
        continue
      }
      let u
      try {
        u = new URL(it.url)
      } catch (_e) {
        dropped++
        continue
      }
      if (u.origin !== HILTON_ORIGIN || u.username || u.password) {
        dropped++
        continue
      }
      keys.add(it.key)
      const clean = {
        key: it.key,
        location: typeof it.location === "string" ? it.location.slice(0, 200) : "",
        checkIn: typeof it.checkIn === "string" && DATE_RE.test(it.checkIn) ? it.checkIn : "",
        checkOut: typeof it.checkOut === "string" && DATE_RE.test(it.checkOut) ? it.checkOut : "",
        url: u.toString(),
      }
      if (typeof it.lat === "number" && Number.isFinite(it.lat)) clean.lat = it.lat
      if (typeof it.lng === "number" && Number.isFinite(it.lng)) clean.lng = it.lng
      items.push(clean)
    }
    if (!items.length) return { ok: false, error: "no valid www.hilton.com items" }
    return {
      ok: true,
      dropped,
      plan: {
        version: 1,
        searchId: plan.searchId,
        token: plan.token,
        captureUrl: cu.toString(),
        maxConcurrentTabs: conc,
        items,
      },
    }
  }

  /** Dates a Hilton URL carries (arrivalDate/departureDate, with checkIn/checkOut fallbacks). */
  function datesFromUrl(url) {
    try {
      const p = new URL(url).searchParams
      return {
        checkIn: p.get("arrivalDate") || p.get("checkInDate") || p.get("checkIn") || "",
        checkOut: p.get("departureDate") || p.get("checkOutDate") || p.get("checkOut") || "",
      }
    } catch (_e) {
      return { checkIn: "", checkOut: "" }
    }
  }

  /**
   * Choose the run item a manually captured tab belongs to: an uncaptured
   * item with the same dates, else any item with the same dates, else the
   * first uncaptured item, else the first item.
   */
  function matchItem(items, url) {
    if (!items || !items.length) return null
    const d = datesFromUrl(url)
    const sameDates = (it) => d.checkIn && it.checkIn === d.checkIn && (!d.checkOut || it.checkOut === d.checkOut)
    const open = (it) => it.status !== "captured"
    return (
      items.find((it) => sameDates(it) && open(it)) ||
      items.find(sameDates) ||
      items.find(open) ||
      items[0]
    )
  }

  /** How the background reacts to a capture POST status. */
  function captureOutcome(status) {
    if (status >= 200 && status < 300) return "ok"
    if (status === 401 || status === 403) return "fatal"
    if (status === 429 || status >= 500) return "retry"
    return "failed"
  }

  const api = {
    APP_ORIGINS, HILTON_ORIGIN, MAX_ITEMS, DEFAULT_CONCURRENCY, MAX_CONCURRENCY,
    originOf, isAppOrigin, validatePlan, datesFromUrl, matchItem, captureOutcome,
  }
  root.JPGoRatesPlan = api
  if (typeof module !== "undefined" && module.exports) module.exports = api
})(typeof globalThis !== "undefined" ? globalThis : this)
