/*
 * JourneyPerfect Go Rates: bridge on journeyperfect.com (and localhost:3000 for dev).
 * - Marks the page so the app can tell the extension is installed.
 * - Relays JP_GO_RATES_PLAN messages from the page to the background worker.
 * - Relays progress from the background back to the page.
 */
;(function () {
  "use strict"

  const ALLOWED = ["https://journeyperfect.com", "https://www.journeyperfect.com", "http://localhost:3000"]
  const origin = window.location.origin
  if (ALLOWED.indexOf(origin) === -1) return

  function mark() {
    if (document.documentElement) document.documentElement.dataset.jpGoRates = "1"
  }
  mark()
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mark, { once: true })

  window.addEventListener("message", (event) => {
    if (event.source !== window) return
    if (ALLOWED.indexOf(event.origin) === -1 || event.origin !== origin) return
    const data = event.data
    if (!data || typeof data !== "object") return
    if (data.source !== "journeyperfect" || data.type !== "JP_GO_RATES_PLAN") return
    const plan = data.plan
    if (!plan || typeof plan !== "object" || plan.version !== 1 || !Array.isArray(plan.items)) return
    try {
      chrome.runtime.sendMessage({ type: "JP_PLAN", plan }).catch(() => {})
    } catch (_e) {
      // extension was reloaded; the page needs a refresh
    }
  })

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== "JP_PROGRESS" || !msg.payload) return false
    const p = msg.payload
    window.postMessage(
      {
        source: "jp-go-rates-extension",
        type: "JP_GO_RATES_PROGRESS",
        searchId: p.searchId,
        opened: p.opened,
        captured: p.captured,
        failed: p.failed,
        total: p.total,
        done: p.done,
      },
      origin,
    )
    return false
  })
})()
