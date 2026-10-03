"use strict"
const test = require("node:test")
const assert = require("node:assert/strict")
const P = require("../lib/plan.js")

const item = (n, extra) => ({
  key: `k${n}`,
  location: "Chicago, IL",
  checkIn: "2026-11-06",
  checkOut: "2026-11-08",
  url: `https://www.hilton.com/en/search/?query=Chicago&arrivalDate=2026-11-06&departureDate=2026-11-08&n=${n}`,
  ...extra,
})
const plan = (extra) => ({
  version: 1,
  searchId: "search_abc123456",
  token: "tok",
  captureUrl: "https://journeyperfect.com/api/go-rates/capture",
  items: [item(1), item(2)],
  ...extra,
})

test("accepts a valid plan and defaults concurrency to 3", () => {
  const v = P.validatePlan(plan())
  assert.equal(v.ok, true)
  assert.equal(v.plan.maxConcurrentTabs, 3)
  assert.equal(v.plan.items.length, 2)
  assert.equal(v.dropped, 0)
})

test("clamps concurrency to 1..4", () => {
  assert.equal(P.validatePlan(plan({ maxConcurrentTabs: 10 })).plan.maxConcurrentTabs, 4)
  assert.equal(P.validatePlan(plan({ maxConcurrentTabs: 0 })).plan.maxConcurrentTabs, 1)
  assert.equal(P.validatePlan(plan({ maxConcurrentTabs: "x" })).plan.maxConcurrentTabs, 3)
})

test("captureUrl must be on an allowed app origin", () => {
  for (const ok of [
    "https://journeyperfect.com/x",
    "https://www.journeyperfect.com/x",
    "http://localhost:3000/api/x",
  ]) assert.equal(P.validatePlan(plan({ captureUrl: ok })).ok, true, ok)
  for (const bad of [
    "http://journeyperfect.com/x",
    "https://evil.com/x",
    "https://journeyperfect.com.evil.com/x",
    "https://localhost:3000/x",
    "http://localhost:3001/x",
    "/api/relative",
    "https://user:pw@journeyperfect.com/x",
  ]) assert.equal(P.validatePlan(plan({ captureUrl: bad })).ok, false, bad)
})

test("drops off-site items, duplicates and caps at 24", () => {
  const v = P.validatePlan(plan({
    items: [
      item(1),
      item(2, { url: "https://hilton.com/en/search/" }),
      item(3, { url: "http://www.hilton.com/en/search/" }),
      item(4, { url: "https://www.hilton.com.evil.com/" }),
      item(5, { url: "javascript:alert(1)" }),
      item(1),
    ],
  }))
  assert.equal(v.ok, true)
  assert.deepEqual(v.plan.items.map((i) => i.key), ["k1"])
  assert.equal(v.dropped, 5)
  const many = P.validatePlan(plan({ items: Array.from({ length: 30 }, (_, i) => item(i)) }))
  assert.equal(many.plan.items.length, 24)
  assert.equal(many.dropped, 6)
  assert.equal(P.validatePlan(plan({ items: [item(1, { url: "https://evil.com/" })] })).ok, false)
})

test("rejects malformed plans", () => {
  assert.equal(P.validatePlan(null).ok, false)
  assert.equal(P.validatePlan(plan({ version: 2 })).ok, false)
  assert.equal(P.validatePlan(plan({ searchId: "" })).ok, false)
  assert.equal(P.validatePlan(plan({ token: undefined })).ok, false)
  assert.equal(P.validatePlan(plan({ items: "nope" })).ok, false)
})

test("keeps optional lat/lng and drops malformed dates", () => {
  const v = P.validatePlan(plan({ items: [item(1, { lat: 41.9, lng: -87.6, checkIn: "11/06/2026" })] }))
  assert.equal(v.plan.items[0].lat, 41.9)
  assert.equal(v.plan.items[0].checkIn, "")
})

test("matchItem: same dates & uncaptured, else first uncaptured", () => {
  const items = [
    { key: "a", checkIn: "2026-11-06", checkOut: "2026-11-08", status: "captured" },
    { key: "b", checkIn: "2026-11-13", checkOut: "2026-11-15", status: "pending" },
    { key: "c", checkIn: "2026-11-06", checkOut: "2026-11-08", status: "pending" },
  ]
  const u = (a, d) => `https://www.hilton.com/en/search/?arrivalDate=${a}&departureDate=${d}`
  assert.equal(P.matchItem(items, u("2026-11-06", "2026-11-08")).key, "c")
  assert.equal(P.matchItem(items, u("2026-11-13", "2026-11-15")).key, "b")
  assert.equal(P.matchItem(items, "https://www.hilton.com/en/search/?query=x").key, "b")
  const allDone = items.map((i) => ({ ...i, status: "captured" }))
  assert.equal(P.matchItem(allDone, u("2026-11-13", "2026-11-15")).key, "b")
  assert.equal(P.matchItem(allDone, "https://www.hilton.com/").key, "a")
  assert.equal(P.matchItem([], "x"), null)
})

test("captureOutcome: 401/403 fatal, 429/5xx retry, 400/413 failed", () => {
  assert.equal(P.captureOutcome(200), "ok")
  assert.equal(P.captureOutcome(401), "fatal")
  assert.equal(P.captureOutcome(403), "fatal")
  assert.equal(P.captureOutcome(429), "retry")
  assert.equal(P.captureOutcome(502), "retry")
  assert.equal(P.captureOutcome(400), "failed")
  assert.equal(P.captureOutcome(413), "failed")
})

const mItem = (n, extra) => ({
  key: `ORD|2026-11-06|2026-11-08|marriott|${n}`,
  brand: "marriott",
  intent: "PRIVATE",
  location: "Chicago, IL",
  checkIn: "2026-11-06",
  checkOut: "2026-11-08",
  url: "https://www.marriott.com/search/findHotels.mi?destinationAddress.destination=Chicago&fromDate=11%2F06%2F2026&toDate=11%2F08%2F2026",
  ...extra,
})

test("brand + intent: defaults for legacy items, origin must match the brand", () => {
  const v = P.validatePlan(plan({
    items: [
      item(1),
      item(2, { brand: "hilton", intent: "PUBLIC" }),
      mItem("a"),
      mItem("b", { intent: "PUBLIC" }),
      mItem("c", { url: "https://www.hilton.com/en/search/" }), // marriott item on hilton
      item(3, { brand: "marriott" }), // hilton URL claiming marriott
      item(4, { brand: "ihg" }),
      item(5, { intent: "MAYBE" }),
    ],
  }))
  assert.equal(v.ok, true)
  assert.deepEqual(v.plan.items.map((i) => [i.key, i.brand, i.intent]), [
    ["k1", "hilton", "PRIVATE"],
    ["k2", "hilton", "PUBLIC"],
    ["ORD|2026-11-06|2026-11-08|marriott|a", "marriott", "PRIVATE"],
    ["ORD|2026-11-06|2026-11-08|marriott|b", "marriott", "PUBLIC"],
  ])
  assert.equal(v.dropped, 4)
  assert.equal(P.brandOfOrigin("https://www.marriott.com"), "marriott")
  assert.equal(P.brandOfOrigin("https://marriott.com"), null)
})

test("datesFromUrl reads Marriott MM/DD/YYYY dates", () => {
  assert.deepEqual(
    P.datesFromUrl("https://www.marriott.com/search/findHotels.mi?fromDate=11%2F06%2F2026&toDate=11/08/2026"),
    { checkIn: "2026-11-06", checkOut: "2026-11-08" },
  )
  assert.equal(P.toYmd("1/2/2026"), "2026-01-02")
  assert.equal(P.toYmd("garbage"), "")
})

test("matchItem only picks items of the tab's brand, preferring the private search", () => {
  const items = [
    { key: "h-pub", brand: "hilton", intent: "PUBLIC", checkIn: "2026-11-06", checkOut: "2026-11-08", status: "pending" },
    { key: "h-priv", brand: "hilton", intent: "PRIVATE", checkIn: "2026-11-06", checkOut: "2026-11-08", status: "pending" },
    { key: "m-priv", brand: "marriott", intent: "PRIVATE", checkIn: "2026-11-06", checkOut: "2026-11-08", status: "pending" },
  ]
  const mUrl = "https://www.marriott.com/search/findHotels.mi?fromDate=11/06/2026&toDate=11/08/2026"
  assert.equal(P.matchItem(items, mUrl, "marriott").key, "m-priv")
  assert.equal(P.matchItem(items, "https://www.hilton.com/en/search/?arrivalDate=2026-11-06&departureDate=2026-11-08", "hilton").key, "h-priv")
  assert.equal(P.matchItem(items, mUrl, "marriott", "PUBLIC").key, "m-priv")
  assert.equal(P.matchItem(items.slice(0, 2), mUrl, "marriott"), null)
})
