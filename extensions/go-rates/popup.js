/* JourneyPerfect Go Rates: popup (also shown as the status tab in the run window). */
;(function () {
  "use strict"

  const $ = (id) => document.getElementById(id)
  const isTabView = new URLSearchParams(location.search).get("view") === "tab"
  if (isTabView) {
    document.body.classList.add("tab")
    $("tabNote").classList.remove("hidden")
    $("capture").classList.add("hidden")
    $("snapshot").classList.add("hidden")
  }

  function say(text, cls) {
    const m = $("msg")
    m.textContent = text || ""
    m.className = cls || "muted"
  }

  function render(state) {
    const run = state && state.run
    $("none").classList.toggle("hidden", !!run)
    $("run").classList.toggle("hidden", !run)
    $("stop").disabled = !run || run.done
    $("capture").disabled = !run || !!run.fatal
    if (!run) return
    $("sid").textContent = run.searchIdShort
    $("opened").textContent = run.opened
    $("captured").textContent = run.captured
    $("failed").textContent = run.failed
    $("total").textContent = run.total
    $("status").textContent = run.fatal ? "· halted" : run.blocked ? "· blocked" : run.stopped ? "· stopped" : run.done ? "· done" : "· running"
    $("err").textContent = run.fatal || (run.blocked ? "Hilton's bot protection refused a page; no more tabs will open." : "") || run.lastError || ""
    const ul = $("items")
    ul.textContent = ""
    for (const it of run.items) {
      const li = document.createElement("li")
      const left = document.createElement("span")
      left.textContent = `${it.location || it.key} ${it.checkIn ? it.checkIn + "→" + it.checkOut : ""}`
      const right = document.createElement("span")
      right.className = it.status === "captured" ? "ok" : it.status === "failed" ? "bad" : "muted"
      right.textContent = it.status === "captured" ? `✓ ${it.observations}` : it.status === "failed" ? it.error || "failed" : it.status
      li.append(left, right)
      ul.append(li)
    }
  }

  function refresh() {
    chrome.runtime.sendMessage({ type: "GET_STATE" }).then(render, () => render(null))
  }

  $("capture").addEventListener("click", async () => {
    $("capture").disabled = true
    say("Capturing…")
    try {
      const r = await chrome.runtime.sendMessage({ type: "CAPTURE_ACTIVE_TAB" })
      if (r && r.ok) say(`Captured ${r.observations} rate(s) into item ${r.itemKey}.`, "ok")
      else if (r && r.blocked) say("This page is Hilton's bot-protection error page; recorded as blocked.", "bad")
      else say((r && r.error) || "Capture failed.", "bad")
    } finally {
      refresh()
    }
  })

  $("stop").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "STOP" })
    say("Stopped.")
    refresh()
  })

  $("snapshot").addEventListener("click", async () => {
    const r = await chrome.runtime.sendMessage({ type: "SNAPSHOT_ACTIVE_TAB" })
    if (!r || !r.ok) return say((r && r.error) || "No snapshot.", "bad")
    const json = JSON.stringify(r.snapshot, null, 2)
    try {
      await navigator.clipboard.writeText(json)
      say(`Snapshot copied (${r.snapshot.cardCount} cards, ${r.snapshot.observations.length} rates). Paste it to JourneyPerfect support.`, "ok")
    } catch (_e) {
      const t = $("snapOut")
      t.value = json
      t.classList.remove("hidden")
      t.select()
      say("Could not copy automatically; the snapshot is selected below, press Cmd/Ctrl+C.")
    }
  })

  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === "session") refresh()
  })
  refresh()
})()
