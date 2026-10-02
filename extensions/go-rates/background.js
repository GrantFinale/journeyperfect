/*
 * JourneyPerfect Go Rates: background service worker.
 *
 * Holds one run at a time in chrome.storage.session (survives service-worker
 * restarts, cleared when Chrome quits). Opens the plan's Hilton URLs as normal
 * tabs in a separate window, at most maxConcurrentTabs at once and at least
 * 3 s apart, waits for the Hilton content script to report what the page shows,
 * POSTs that to the plan's captureUrl, and closes the tab.
 */
/* global importScripts, JPGoRatesPlan */
importScripts("lib/plan.js")

const P = JPGoRatesPlan
const RUN_KEY = "run"
const STAGGER_MS = 3000
const TAB_TIMEOUT_MS = 60000
const POST_TIMEOUT_MS = 20000
const MAX_POST_RETRIES = 2

// ── State (serialised through one promise chain) ─────────────────────────────

let chain = Promise.resolve()
function locked(fn) {
  const p = chain.then(fn, fn)
  chain = p.catch(() => {})
  return p
}

async function loadRun() {
  const got = await chrome.storage.session.get(RUN_KEY)
  return got[RUN_KEY] || null
}

async function saveRun(run) {
  if (run) await chrome.storage.session.set({ [RUN_KEY]: run })
  else await chrome.storage.session.remove(RUN_KEY)
}

function counts(run) {
  const c = { opened: 0, captured: 0, failed: 0, total: run.items.length }
  for (const it of run.items) {
    if (it.openedAt) c.opened++
    if (it.status === "captured") c.captured++
    if (it.status === "failed") c.failed++
  }
  c.done = run.items.every((it) => it.status === "captured" || it.status === "failed")
  return c
}

/** State for the popup: never includes the token or captureUrl path. */
function publicState(run) {
  if (!run) return { run: null }
  const c = counts(run)
  return {
    run: {
      searchId: run.searchId,
      searchIdShort: String(run.searchId).slice(0, 8),
      appOrigin: P.originOf(run.captureUrl),
      startedAt: run.startedAt,
      stopped: !!run.stopped,
      fatal: run.fatal || null,
      blocked: !!run.blocked,
      lastError: run.lastError || null,
      ...c,
      items: run.items.map((it) => ({
        key: it.key, location: it.location, checkIn: it.checkIn, checkOut: it.checkOut,
        status: it.status, error: it.error || null, observations: it.observations || 0,
      })),
    },
  }
}

// ── Progress reporting ───────────────────────────────────────────────────────

async function report(run) {
  if (!run) {
    await chrome.action.setBadgeText({ text: "" })
    return
  }
  const c = counts(run)
  await chrome.action.setBadgeBackgroundColor({ color: run.fatal || run.blocked ? "#b42318" : c.done ? "#067647" : "#1d4ed8" })
  await chrome.action.setBadgeText({ text: `${c.captured}/${c.total}` })
  const sig = [c.opened, c.captured, c.failed, c.done].join(",")
  if (run.lastReported === sig) return
  run.lastReported = sig
  if (run.sourceTabId != null) {
    chrome.tabs
      .sendMessage(run.sourceTabId, {
        type: "JP_PROGRESS",
        payload: { searchId: run.searchId, opened: c.opened, captured: c.captured, failed: c.failed, total: c.total, done: c.done },
      })
      .catch(() => {})
  }
}

// ── Scheduling ───────────────────────────────────────────────────────────────

let wakeTimer = null
function wakeIn(ms) {
  if (wakeTimer) clearTimeout(wakeTimer)
  wakeTimer = setTimeout(() => {
    wakeTimer = null
    pump()
  }, Math.max(250, ms))
}

async function ensureWindow(run) {
  if (run.windowId != null) {
    try {
      await chrome.windows.get(run.windowId)
      return run.windowId
    } catch (_e) {
      run.windowId = null
    }
  }
  // The window's first tab is a small status page so the window survives
  // between Hilton tabs; closing the window stops the run.
  const statusUrl = chrome.runtime.getURL("popup.html?view=tab")
  let win
  try {
    win = await chrome.windows.create({ url: statusUrl, focused: false, type: "normal" })
  } catch (_e) {
    win = await chrome.windows.create({ url: statusUrl, type: "normal" })
  }
  run.windowId = win.id
  run.statusTabId = win.tabs && win.tabs[0] ? win.tabs[0].id : null
  return run.windowId
}

async function closeTab(tabId) {
  if (tabId == null) return
  try {
    await chrome.tabs.remove(tabId)
  } catch (_e) {
    // already gone
  }
}

function pump() {
  return locked(async () => {
    const run = await loadRun()
    if (!run) return
    const now = Date.now()

    // Time out tabs that never reported.
    for (const it of run.items) {
      if (it.status === "open" && it.openedAt && now - it.openedAt > TAB_TIMEOUT_MS) {
        it.status = "failed"
        it.error = "timeout"
        const tabId = it.tabId
        it.tabId = null
        await closeTab(tabId)
      }
      // A worker restart mid-POST would otherwise leave the item stuck.
      if (it.status === "posting" && it.postingAt && now - it.postingAt > 180000) {
        it.status = "failed"
        it.error = "capture POST interrupted"
      }
    }

    const halted = run.stopped || run.fatal || run.blocked
    if (halted) {
      for (const it of run.items) if (it.status === "pending") {
        it.status = "failed"
        it.error = run.fatal ? "unauthorized" : run.blocked ? "blocked" : "stopped"
      }
    }

    const active = run.items.filter((it) => it.status === "open" || it.status === "posting").length
    const next = run.items.find((it) => it.status === "pending")
    let nextWake = null
    if (!halted && next && active < run.maxConcurrentTabs) {
      const wait = (run.lastOpenAt || 0) + STAGGER_MS - now
      if (wait <= 0) {
        try {
          const windowId = await ensureWindow(run)
          const tab = await chrome.tabs.create({ windowId, url: next.url, active: false })
          next.tabId = tab.id
          next.status = "open"
          next.openedAt = Date.now()
          run.lastOpenAt = next.openedAt
        } catch (e) {
          next.status = "failed"
          next.error = "could not open tab"
          run.lastError = String((e && e.message) || e).slice(0, 200)
        }
        nextWake = STAGGER_MS
      } else {
        nextWake = wait
      }
    }
    // Wake for the earliest tab timeout too.
    for (const it of run.items) {
      if (it.status === "open" && it.openedAt) {
        const t = it.openedAt + TAB_TIMEOUT_MS - Date.now() + 100
        nextWake = nextWake == null ? t : Math.min(nextWake, t)
      }
    }

    const c = counts(run)
    if (c.done && !run.finishedAt) {
      run.finishedAt = Date.now()
      const windowId = run.windowId
      run.windowId = null
      if (windowId != null) setTimeout(() => chrome.windows.remove(windowId).catch(() => {}), 1500)
    }
    await report(run)
    await saveRun(run)
    if (nextWake != null && !c.done) wakeIn(nextWake)
  })
}

// ── Capture posting ──────────────────────────────────────────────────────────

async function postCapture(run, body) {
  let attempt = 0
  for (;;) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), POST_TIMEOUT_MS)
    let status = 0
    let retryAfter = 0
    try {
      const res = await fetch(run.captureUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "omit",
        cache: "no-store",
        signal: ctrl.signal,
      })
      status = res.status
      retryAfter = Number(res.headers.get("Retry-After")) || 0
    } catch (_e) {
      status = 0
    } finally {
      clearTimeout(timer)
    }
    const outcome = status === 0 ? "retry" : P.captureOutcome(status)
    if (outcome !== "retry" || attempt >= MAX_POST_RETRIES) return { status, outcome: outcome === "retry" ? "failed" : outcome }
    attempt++
    await new Promise((r) => setTimeout(r, Math.min(30000, Math.max(retryAfter * 1000, 5000 * attempt))))
  }
}

function captureBody(run, itemKey, result, pageUrl) {
  return {
    token: run.token,
    itemKey,
    pageUrl: String(pageUrl || "").split("#")[0],
    capturedAt: new Date().toISOString(),
    pageKind: ["SEARCH", "ROOMS", "OTHER"].includes(result.pageKind) ? result.pageKind : "OTHER",
    ...(result.blocked ? { blocked: true } : {}),
    observations: result.blocked ? [] : (Array.isArray(result.observations) ? result.observations : []).slice(0, 200),
  }
}

/**
 * Deliver a page result for one item. `fromRunTab` = the tab the run opened
 * (closed afterwards); manual captures leave the user's tab alone.
 */
async function deliver(itemKey, result, pageUrl, fromRunTab) {
  const prep = await locked(async () => {
    const run = await loadRun()
    if (!run) return null
    const it = run.items.find((x) => x.key === itemKey)
    if (!it) return null
    if (fromRunTab && it.status !== "open") {
      // Already captured manually (or timed out): just close the run's tab.
      const tabId = it.tabId
      it.tabId = null
      await saveRun(run)
      return { skip: true, tabId }
    }
    it.status = "posting"
    it.postingAt = Date.now()
    await saveRun(run)
    return { run }
  })
  if (!prep) return { ok: false, error: "no active run item" }
  if (prep.skip) {
    await closeTab(prep.tabId)
    await pump()
    return { ok: false, error: "already handled" }
  }

  const { status, outcome } = await postCapture(prep.run, captureBody(prep.run, itemKey, result, pageUrl))

  let tabToClose = null
  await locked(async () => {
    const run = await loadRun()
    if (!run || run.searchId !== prep.run.searchId) return
    const it = run.items.find((x) => x.key === itemKey)
    if (!it) return
    if (fromRunTab) {
      tabToClose = it.tabId
      it.tabId = null
    }
    if (outcome === "ok" && !result.blocked) {
      it.status = "captured"
      it.observations = (result.observations || []).length
      it.error = null
    } else {
      it.status = "failed"
      it.error = result.blocked && outcome === "ok" ? "blocked by Hilton bot protection" : `capture ${status || "network error"}`
    }
    if (result.blocked) run.blocked = true // stop opening more tabs once Hilton refuses a page
    if (outcome === "fatal") {
      run.fatal = `capture rejected (${status}); re-run from JourneyPerfect`
      for (const other of run.items) {
        if (other.status === "open") {
          await closeTab(other.tabId)
          other.tabId = null
          other.status = "failed"
          other.error = "unauthorized"
        }
      }
    }
    if (outcome !== "ok") run.lastError = `capture POST returned ${status || "network error"}`
    await saveRun(run)
  })
  if (tabToClose != null) await closeTab(tabToClose)
  await pump()
  return { ok: outcome === "ok", status }
}

// ── Starting / stopping ──────────────────────────────────────────────────────

async function startRun(rawPlan, senderTab) {
  const v = P.validatePlan(rawPlan)
  if (!v.ok) return { ok: false, error: v.error }
  const old = await locked(async () => {
    const prev = await loadRun()
    const plan = v.plan
    const run = {
      searchId: plan.searchId,
      token: plan.token,
      captureUrl: plan.captureUrl,
      maxConcurrentTabs: plan.maxConcurrentTabs,
      sourceTabId: senderTab ? senderTab.id : null,
      startedAt: Date.now(),
      lastOpenAt: 0,
      windowId: null,
      items: plan.items.map((it) => ({ ...it, status: "pending", tabId: null, openedAt: null })),
    }
    await saveRun(run)
    return prev
  })
  // A new plan replaces the previous run (same search or not): close its tabs.
  if (old) {
    for (const it of old.items) if (it.tabId != null) await closeTab(it.tabId)
    if (old.windowId != null) await chrome.windows.remove(old.windowId).catch(() => {})
  }
  await pump()
  return { ok: true, accepted: v.plan.items.length, dropped: v.dropped }
}

async function stopRun(reason) {
  let windowId = null
  const toClose = await locked(async () => {
    const run = await loadRun()
    if (!run) return []
    run.stopped = reason || "stopped"
    windowId = run.windowId
    run.windowId = null
    const tabs = []
    for (const it of run.items) {
      if (it.status === "pending" || it.status === "open") {
        if (it.tabId != null) tabs.push(it.tabId)
        it.tabId = null
        it.status = "failed"
        it.error = "stopped"
      }
    }
    await saveRun(run)
    return tabs
  })
  for (const t of toClose) await closeTab(t)
  if (windowId != null) await chrome.windows.remove(windowId).catch(() => {})
  await pump()
}

// ── Manual capture / snapshot from the popup ────────────────────────────────

async function activeHiltonTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab || !tab.url || P.originOf(tab.url) !== P.HILTON_ORIGIN) return { error: "The active tab is not a www.hilton.com page." }
  return { tab }
}

async function askTab(tabId, msg) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg)
  } catch (_e) {
    return { error: "The page is not ready. Reload the Hilton tab and try again." }
  }
}

async function captureActiveTab() {
  const { tab, error } = await activeHiltonTab()
  if (error) return { ok: false, error }
  const run = await loadRun()
  if (!run) return { ok: false, error: "No run in progress. Start one from JourneyPerfect first." }
  if (run.fatal) return { ok: false, error: run.fatal }
  const item = P.matchItem(run.items, tab.url)
  const res = await askTab(tab.id, { type: "EXTRACT" })
  if (!res || res.error || !res.result) return { ok: false, error: (res && res.error) || "Nothing extracted." }
  const out = await deliver(item.key, res.result, tab.url, false)
  return { ...out, itemKey: item.key, observations: (res.result.observations || []).length, blocked: !!res.result.blocked }
}

async function snapshotActiveTab() {
  const { tab, error } = await activeHiltonTab()
  if (error) return { ok: false, error }
  const res = await askTab(tab.id, { type: "SNAPSHOT" })
  if (!res || res.error) return { ok: false, error: (res && res.error) || "No snapshot." }
  return { ok: true, snapshot: res.snapshot }
}

// ── Messages ────────────────────────────────────────────────────────────────

function senderIsApp(sender) {
  return !!(sender && sender.tab && sender.url && P.isAppOrigin(P.originOf(sender.url)))
}
function senderIsHilton(sender) {
  return !!(sender && sender.tab && sender.url && P.originOf(sender.url) === P.HILTON_ORIGIN)
}
function senderIsExtension(sender) {
  return !!(sender && sender.url && sender.url.startsWith(chrome.runtime.getURL("")))
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string" || sender.id !== chrome.runtime.id) return false
  const reply = (p) => p.then(sendResponse, (e) => sendResponse({ ok: false, error: String((e && e.message) || e) }))

  switch (msg.type) {
    case "JP_PLAN":
      if (!senderIsApp(sender)) return false
      reply(startRun(msg.plan, sender.tab))
      return true

    case "HILTON_HELLO":
      if (!senderIsHilton(sender)) return false
      reply(
        (async () => {
          const run = await loadRun()
          const it = run && run.items.find((x) => x.tabId === sender.tab.id && x.status === "open")
          return it ? { active: true, itemKey: it.key } : { active: false }
        })(),
      )
      return true

    case "HILTON_KEEPALIVE":
      if (!senderIsHilton(sender)) return false
      pump()
      sendResponse({ ok: true })
      return false

    case "HILTON_RESULT":
      if (!senderIsHilton(sender)) return false
      reply(
        (async () => {
          const run = await loadRun()
          const it = run && run.items.find((x) => x.tabId === sender.tab.id)
          if (!it) return { ok: false, error: "tab not in run" }
          return deliver(it.key, msg.result || {}, sender.tab.url, true)
        })(),
      )
      return true

    case "GET_STATE":
      if (!senderIsExtension(sender)) return false
      reply(loadRun().then(publicState))
      return true

    case "STOP":
      if (!senderIsExtension(sender)) return false
      reply(stopRun("stopped by user").then(() => ({ ok: true })))
      return true

    case "CAPTURE_ACTIVE_TAB":
      if (!senderIsExtension(sender)) return false
      reply(captureActiveTab())
      return true

    case "SNAPSHOT_ACTIVE_TAB":
      if (!senderIsExtension(sender)) return false
      reply(snapshotActiveTab())
      return true

    case "CLEAR":
      if (!senderIsExtension(sender)) return false
      reply(locked(() => saveRun(null)).then(() => report(null)).then(() => ({ ok: true })))
      return true
  }
  return false
})

// ── Tab / window events ─────────────────────────────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (!info.url && info.status !== "complete") return
  const url = info.url || tab.url || ""
  // Akamai sometimes redirects to its own error host, where our content script never runs.
  if (/^https?:\/\/errors\.edgesuite\.net\//i.test(url)) {
    loadRun().then((run) => {
      const it = run && run.items.find((x) => x.tabId === tabId && x.status === "open")
      if (it) deliver(it.key, { pageKind: "OTHER", blocked: true, observations: [] }, url, true)
    })
    return
  }
  if (P.originOf(url) === P.HILTON_ORIGIN) pump()
})

chrome.tabs.onRemoved.addListener((tabId) => {
  locked(async () => {
    const run = await loadRun()
    if (!run) return
    const it = run.items.find((x) => x.tabId === tabId)
    if (!it) return
    it.tabId = null
    if (it.status === "open") {
      it.status = "failed"
      it.error = "tab closed before capture"
    }
    await saveRun(run)
  }).then(() => pump())
})

chrome.windows.onRemoved.addListener((windowId) => {
  loadRun().then((run) => {
    if (run && run.windowId === windowId && !counts(run).done) stopRun("run window closed")
  })
})

// Resume after a service-worker restart.
pump()
