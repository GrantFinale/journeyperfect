/*
 * JourneyPerfect Go Rates: reader on www.marriott.com.
 *
 * Does nothing on pages the run did not open, except answer the popup's
 * explicit "Capture this tab" / "Debug: copy page snapshot" requests.
 * Never clicks, types, scrolls or reads cookies/storage: it waits for the page
 * to render, reads the DOM via lib/extract.js, and hands the result to the
 * background worker. The run tells it the tab's item intent (PRIVATE Friends &
 * Family search with the rate code, or PUBLIC search); that, not the page,
 * decides the rate kind.
 *
 * Same lifecycle as content/hilton.js; only BRAND differs.
 */
/* global JPGoRatesExtract */
;(function () {
  "use strict"

  const BRAND = "marriott"
  const X = JPGoRatesExtract
  const READY_TIMEOUT_MS = 30000
  const SETTLE_MS = 1500
  const KEEPALIVE_MS = 10000

  function send(msg) {
    try {
      return chrome.runtime.sendMessage(msg)
    } catch (_e) {
      return Promise.resolve(null)
    }
  }

  function isReady() {
    const p = X.quickProbe(document)
    // Ready once the site refused the page, said there are no results, or every
    // rendered card shows either a price or a sold-out notice.
    return p.blocked || p.noResults || (p.cardCount > 0 && p.priced + p.soldOut >= p.cardCount)
  }

  /** Resolve once results render (or a block/no-results page shows), max 30 s. */
  function waitForResults() {
    return new Promise((resolve) => {
      const started = Date.now()
      let done = false
      let throttle = null
      const keepalive = setInterval(() => send({ type: "SITE_KEEPALIVE", brand: BRAND }), KEEPALIVE_MS)
      const finish = () => {
        if (done) return
        done = true
        clearInterval(keepalive)
        if (observer) observer.disconnect()
        clearTimeout(timeout)
        // Give remaining prices on other cards a moment to hydrate.
        setTimeout(resolve, SETTLE_MS)
      }
      const check = () => {
        throttle = null
        if (isReady()) finish()
      }
      const observer = new MutationObserver(() => {
        if (!throttle && !done) throttle = setTimeout(check, 400)
      })
      const timeout = setTimeout(finish, Math.max(0, READY_TIMEOUT_MS - (Date.now() - started)))
      if (isReady()) return finish()
      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true })
    })
  }

  function extract(intent) {
    const r = X.extractFromDocument(document, { url: location.href, brand: BRAND, intent })
    return { pageKind: r.pageKind, blocked: r.blocked, observations: r.observations, auth: r.auth, goContext: r.goContext }
  }

  // Popup-initiated requests (manual capture / debug snapshot).
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return false
    if (msg.type === "EXTRACT") {
      try {
        sendResponse({ result: extract(msg.intent) })
      } catch (e) {
        sendResponse({ error: "Extraction failed: " + String((e && e.message) || e) })
      }
      return false
    }
    if (msg.type === "SNAPSHOT") {
      try {
        sendResponse({ snapshot: X.snapshot(document, { url: location.href, brand: BRAND, intent: msg.intent }) })
      } catch (e) {
        sendResponse({ error: "Snapshot failed: " + String((e && e.message) || e) })
      }
      return false
    }
    return false
  })

  // Automatic capture only for tabs the active run opened for this brand.
  ;(async () => {
    const hello = await send({ type: "SITE_HELLO", brand: BRAND })
    if (!hello || !hello.active || hello.brand !== BRAND) return
    await waitForResults()
    let result
    try {
      result = extract(hello.intent)
    } catch (_e) {
      result = { pageKind: X.detectPageKind(location.href), blocked: false, observations: [] }
    }
    await send({ type: "SITE_RESULT", brand: BRAND, result })
  })()
})()
