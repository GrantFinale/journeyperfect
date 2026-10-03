// node --test extensions/go-rates/test
// No DOM library (jsdom/linkedom) is installed in this repo, so these tests
// cover the pure helpers. Fixture HTML is reduced to text/hrefs/JSON with
// small regex helpers below; the DOM walking itself is exercised in Chrome.
"use strict"
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const X = require("../lib/extract.js")

const fixture = (name) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8")

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
}
function htmlToText(html) {
  return decodeEntities(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
}
function titleOf(html) {
  const m = /<title>([\s\S]*?)<\/title>/i.exec(html)
  return m ? decodeEntities(m[1]).trim() : ""
}
function hrefs(html) {
  return Array.from(html.matchAll(/href="([^"]+)"/g), (m) => decodeEntities(m[1]))
}

test("parseMoney handles symbols, codes, grouping and rejects points/zero", () => {
  assert.deepEqual(pick(X.parseMoney("From $1,234.56 /night")), { amount: 1234.56, currency: "USD" })
  assert.deepEqual(pick(X.parseMoney("US$89")), { amount: 89, currency: "USD" })
  assert.deepEqual(pick(X.parseMoney("CA$ 99")), { amount: 99, currency: "CAD" })
  assert.deepEqual(pick(X.parseMoney("€120 per night")), { amount: 120, currency: "EUR" })
  assert.deepEqual(pick(X.parseMoney("GBP 75.5")), { amount: 75.5, currency: "GBP" })
  assert.equal(X.parseMoney("80,000 Points"), null)
  assert.equal(X.parseMoney("$0"), null)
  assert.equal(X.parseMoney(""), null)
  assert.deepEqual(X.parseAllMoney("Team Member Rate $89 $249 per night").map((m) => m.amount), [89, 249])
  assert.equal(X.stripMoney("Team Member Rate $89 per night"), "Team Member Rate per night")
})

function pick(m) {
  return m && { amount: m.amount, currency: m.currency }
}

test("codeFromUrl reads ctyhocn params and /hotels/<code>- paths", () => {
  assert.equal(X.codeFromUrl("/en/book/reservation/rooms/?ctyhocn=chichhh&arrivalDate=2026-11-06"), "CHICHHH")
  assert.equal(X.codeFromUrl("https://www.hilton.com/en/hotels/chimmhx-hampton-chicago/"), "CHIMMHX")
  assert.equal(X.codeFromUrl("https://www.hilton.com/en/hilton-honors/"), undefined)
  assert.equal(X.codeFromUrl(""), undefined)
  const codes = hrefs(fixture("search.html")).map((h) => X.codeFromUrl(h)).filter(Boolean)
  assert.deepEqual(codes, ["CHICHHH", "CHIMMHX", "CHIRSCI"])
  assert.equal(X.brandFromCode("CHIMMHX"), "Hampton by Hilton")
  assert.equal(X.brandFromCode("CHIRSCI"), "Conrad")
})

test("detectBlocked recognises the Akamai page and not normal pages", () => {
  const b = fixture("blocked.html")
  assert.equal(X.detectBlocked({ title: titleOf(b), text: htmlToText(b), url: "https://www.hilton.com/en/search/" }), true)
  // Body alone (no title) is still enough: reference number + edgesuite host.
  assert.equal(X.detectBlocked({ title: "", text: htmlToText(b) }), true)
  for (const f of ["search.html", "rooms.html"]) {
    const h = fixture(f)
    assert.equal(X.detectBlocked({ title: titleOf(h), text: htmlToText(h), url: "https://www.hilton.com/en/search/" }), false, f)
  }
  assert.equal(X.detectBlocked({ title: "Hilton", text: "Something went wrong. Reference No. 18.ab12cd34.1759400000" }), true)
  assert.equal(X.detectBlocked({ title: "Hilton", text: "Something went wrong, please try again" }), false)
  assert.equal(X.detectBlocked({ url: "https://errors.edgesuite.net/18.7d3e1602" }), true)
})

test("detectPageKind", () => {
  assert.equal(X.detectPageKind("https://www.hilton.com/en/search/?query=Chicago"), "SEARCH")
  assert.equal(X.detectPageKind("https://www.hilton.com/en/locations/usa/illinois/chicago/"), "SEARCH")
  assert.equal(X.detectPageKind("https://www.hilton.com/en/book/reservation/rooms/?ctyhocn=CHICHHH"), "ROOMS")
  assert.equal(X.detectPageKind("https://www.hilton.com/en/go-hilton/"), "OTHER")
  assert.equal(X.detectPageKind("not a url"), "OTHER")
})

test("detectGoContext uses path, header text, title and markers only", () => {
  assert.equal(X.detectGoContext({ url: "https://www.hilton.com/en/go-hilton/search/" }), true)
  assert.equal(X.detectGoContext({ url: "https://www.hilton.com/en/search/", headerText: "Go Hilton Team Member Travel" }), true)
  assert.equal(X.detectGoContext({ url: "https://www.hilton.com/en/search/", marker: true }), true)
  assert.equal(X.detectGoContext({ url: "https://www.hilton.com/en/search/", headerText: "Hi, Member  Points 12,000" }), false)
})

test("classifyEntry ordering: strikethrough beats team-member wording", () => {
  assert.equal(X.classifyEntry({ text: "$249", struck: true, label: "Team Member Rate $89 $249" }), "PUBLIC")
  assert.equal(X.classifyEntry({ text: "$89", label: "Team Member Rate $89 $249 per night" }), "PRIVATE")
  assert.equal(X.classifyEntry({ text: "$89", label: "Go Hilton rate" }), "PRIVATE")
  assert.equal(X.classifyEntry({ text: "$89", label: "TMTP" }), "PRIVATE")
  assert.equal(X.classifyEntry({ text: "$179", label: "Was $199" }), "PUBLIC")
  assert.equal(X.classifyEntry({ text: "$179", label: "Standard rate" }), "PUBLIC")
  assert.equal(X.classifyEntry({ text: "$134", label: "$134 /night" }), null)
})

// Entries as collectEntries() would produce them from fixtures/search.html.
const searchCards = [
  {
    name: "Hilton Chicago", code: "CHICHHH", brand: "Hilton Hotels & Resorts", lat: 41.8725, lng: -87.6245,
    url: "https://www.hilton.com/en/book/reservation/rooms/?ctyhocn=CHICHHH&arrivalDate=2026-11-06&departureDate=2026-11-08",
    entries: [
      { text: "$89", label: "Team Member Rate $89 $249 per night" },
      { text: "$249", struck: true, label: "Team Member Rate $89 $249 per night" },
      { text: "Total $201.40 for 2 nights", label: "" },
    ],
  },
  { name: "Hampton Inn Chicago Downtown/Magnificent Mile", code: "CHIMMHX", entries: [{ text: "$134", label: "$134 /night" }] },
  { name: "Conrad Chicago Downtown", code: "CHIRSCI", soldOut: true, entries: [] },
]

test("search card with team-member label + strikethrough → PRIVATE and PUBLIC", () => {
  const obs = X.buildCardObservations(searchCards[0], { goContext: true })
  assert.equal(obs.length, 2)
  const [priv, pub] = obs
  assert.equal(priv.rateKind, "PRIVATE_HILTON_GO")
  assert.equal(priv.nightlyRate, 89)
  assert.equal(priv.totalRate, 201.4)
  assert.equal(priv.currency, "USD")
  assert.match(priv.rateLabel, /Team Member Rate/)
  assert.equal(priv.propertyCode, "CHICHHH")
  assert.equal(priv.lat, 41.8725)
  assert.equal(priv.available, true)
  assert.equal(pub.rateKind, "PUBLIC")
  assert.equal(pub.nightlyRate, 249)
  assert.equal(pub.rateLabel, "strikethrough")
  assert.equal(pub.totalRate, undefined)
  // Same card outside the portal: explicit label still wins.
  assert.equal(X.buildCardObservations(searchCards[0], { goContext: false })[0].rateKind, "PRIVATE_HILTON_GO")
})

test("single unlabelled price: inferred PRIVATE only in Go Hilton context while signed in", () => {
  const go = X.buildCardObservations(searchCards[1], { goContext: true })
  assert.equal(go.length, 1)
  assert.equal(go[0].rateKind, "PRIVATE_HILTON_GO")
  assert.match(go[0].rateLabel, /inferred/)
  assert.equal(go[0].brand, "Hampton by Hilton")
  const pub = X.buildCardObservations(searchCards[1], { goContext: false })
  assert.equal(pub[0].rateKind, "PUBLIC")
  const out = X.buildCardObservations(searchCards[1], { goContext: true, signedOut: true })
  assert.equal(out[0].rateKind, "PUBLIC")
  assert.equal(out[0].rateLabel, "signed-out")
})

test("signed out: even a team-member label is reported PUBLIC with rateLabel signed-out", () => {
  const obs = X.buildCardObservations(searchCards[0], { goContext: true, signedOut: true })
  assert.equal(obs.length, 1)
  assert.equal(obs[0].rateKind, "PUBLIC")
  assert.equal(obs[0].nightlyRate, 89)
  assert.equal(obs[0].rateLabel, "signed-out")
})

test("sold-out card → available:false; card with no price and no sold-out text → nothing", () => {
  const obs = X.buildCardObservations(searchCards[2], {})
  assert.equal(obs.length, 1)
  assert.equal(obs[0].available, false)
  assert.equal(obs[0].nightlyRate, 0)
  assert.deepEqual(X.buildCardObservations({ name: "X", entries: [] }, {}), [])
})

test("ignores 'save $40' and points amounts", () => {
  const obs = X.buildCardObservations(
    { name: "Y", entries: [{ text: "Save $40" }, { text: "$120", label: "per night" }, { text: "$5 resort fee" }] },
    {},
  )
  assert.equal(obs.length, 1)
  assert.equal(obs[0].nightlyRate, 120)
})

test("rooms page (signed out) reduces to cheapest per kind with room name", () => {
  const ctx = { signedOut: true, goContext: false }
  const base = { name: "Hilton Chicago", code: "CHICHHH" }
  const rooms = [
    { roomName: "1 King Bed", observations: X.buildCardObservations({ ...base, entries: [
      { text: "$179", label: "Hilton Honors Discount $179 per night" }, { text: "$199", label: "Flexible Rate $199 per night" } ] }, ctx) },
    { roomName: "2 Queen Beds", observations: X.buildCardObservations({ ...base, entries: [{ text: "$189", label: "$189 per night" }] }, ctx) },
    { roomName: "Executive Suite", observations: X.buildCardObservations({ ...base, soldOut: true, entries: [] }, ctx) },
  ]
  const obs = X.reduceRoomObservations(rooms)
  assert.equal(obs.length, 1)
  assert.equal(obs[0].nightlyRate, 179)
  assert.equal(obs[0].rateKind, "PUBLIC")
  assert.equal(obs[0].rateLabel, "1 King Bed · signed-out")
  assert.equal(obs[0].brand, "Hilton Hotels & Resorts")
})

test("rooms page in Go context: labelled public rates stay PUBLIC, unlabelled cheapest is inferred", () => {
  const ctx = { goContext: true }
  const card = { name: "Hilton Chicago", code: "CHICHHH", entries: [
    { text: "$179", label: "Hilton Honors Discount $179 per night" }, { text: "$99", label: "$99 per night" } ] }
  const obs = X.buildCardObservations(card, ctx)
  assert.deepEqual(obs.map((o) => [o.rateKind, o.nightlyRate]), [["PRIVATE_HILTON_GO", 99], ["PUBLIC", 179]])
})

test("indexGeo reads JSON-LD (fixture) and next-data style blobs", () => {
  const html = fixture("search.html")
  const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1])
  const idx = X.indexGeo(ld)
  assert.deepEqual({ ...idx.byName.get("hilton chicago") }, {
    url: "https://www.hilton.com/en/hotels/chichhh-hilton-chicago/", lat: 41.8725, lng: -87.6245,
  })
  assert.equal(idx.byName.get("hampton inn chicago downtown/magnificent mile").lat, 41.8937)
  const nd = { props: { pageProps: { hotels: [{ ctyhocn: "chimmhx", name: "Hampton", localization: { coordinate: { latitude: 41.89, longitude: -87.62 } } }] } } }
  const idx2 = X.indexGeo(nd)
  assert.equal(idx2.byCode.get("CHIMMHX").lng, -87.62)
  assert.equal(X.indexGeo({ geo: { latitude: 999, longitude: 0 }, name: "bad" }).byName.size, 0)
})

test("sanitizeUrl keeps only harmless params; redact strips emails and long numbers", () => {
  assert.equal(
    X.sanitizeUrl("https://www.hilton.com/en/book/reservation/rooms/?ctyhocn=CHICHHH&arrivalDate=2026-11-06&token=abc&memberId=123#x"),
    "https://www.hilton.com/en/book/reservation/rooms/?ctyhocn=CHICHHH&arrivalDate=2026-11-06",
  )
  assert.equal(X.redact("Hi grant@example.com member 1234 5678 9012"), "Hi [email] member [number]")
})

test("SELECTORS are centralised and data-testid first", () => {
  for (const list of [X.SELECTORS.search.card, X.SELECTORS.room.card, X.SELECTORS.search.name, X.SELECTORS.search.price]) {
    assert.match(list[0], /data-testid/)
  }
})

// ── Hotel names (never a price) ──────────────────────────────────────────────

test("isPlausibleName rejects money, digit soup, short text and calls to action", () => {
  for (const bad of ["$317", "US$ 239", "$1,234.56", "317", "12 / 4", "Hi", "", "View rates", "Select", "Hotel details", "Book now", "From $207", "per night"]) {
    assert.equal(X.isPlausibleName(bad), false, bad)
  }
  for (const good of ["Hilton Chicago", "Hampton Inn Chicago Downtown/Magnificent Mile", "Home2 Suites by Hilton Chicago McCormick Place", "The Gwen"]) {
    assert.equal(X.isPlausibleName(good), true, good)
  }
})

test("choosePropertyName takes the first plausible candidate, else the property code", () => {
  assert.equal(X.choosePropertyName(["$317", "Hilton Chicago"], "CHICHHH"), "Hilton Chicago")
  assert.equal(X.choosePropertyName(["$317", "View rates", "Embassy Suites Chicago, opens new tab"], "CHIDWES"), "Embassy Suites Chicago")
  assert.equal(X.choosePropertyName(["$207", "", null], "CHITDHX"), "CHITDHX")
  assert.equal(X.choosePropertyName([], undefined), "Property")
  // buildCardObservations applies the same rule to whatever name the DOM layer passed.
  const [o] = X.buildCardObservations({ name: "$317", code: "CHICHHH", entries: [{ text: "$317", label: "$317 per night" }] }, { goContext: true })
  assert.equal(o.propertyName, "CHICHHH")
})

test("indexGeo keeps names keyed by property code, skipping money-like names", () => {
  const idx = X.indexGeo({ hotels: [{ ctyhocn: "chidtgi", name: "Hilton Garden Inn Chicago" }, { propCode: "CHITDHX", name: "$207" }] })
  assert.equal(idx.nameByCode.get("CHIDTGI"), "Hilton Garden Inn Chicago")
  assert.equal(idx.nameByCode.has("CHITDHX"), false)
})

test("search page where the price precedes the heading: names never look like money", () => {
  const { makeDocument } = require("./mini-dom.js")
  const url = "https://www.hilton.com/en/search/?query=Chicago&arrivalDate=2026-10-29&departureDate=2026-11-01"
  const doc = makeDocument(fixture("search-price-first.html"), url)
  const r = X.extractFromDocument(doc, { url })
  assert.equal(r.extractorVersion, "0.3.0")
  assert.equal(r.goContext, true)
  assert.equal(r.auth.signedIn, true)
  assert.equal(r.debug.cardSelector, '[data-testid="hotel-card"]')
  const byCode = Object.fromEntries(r.observations.map((o) => [o.propertyCode, o]))
  assert.deepEqual(Object.keys(byCode).sort(), ["CHICHHH", "CHIDTGI", "CHIDWES", "CHIGWQQ", "CHITDHX"])
  assert.equal(byCode.CHICHHH.propertyName, "Hilton Chicago") // heading after an <h3>$317</h3>
  assert.equal(byCode.CHICHHH.nightlyRate, 317)
  assert.equal(byCode.CHIDWES.propertyName, "Embassy Suites by Hilton Chicago Downtown Magnificent Mile") // link aria-label
  assert.equal(byCode.CHIGWQQ.propertyName, "The Gwen, Curio Collection by Hilton") // img alt, logo skipped
  assert.equal(byCode.CHIDTGI.propertyName, "Hilton Garden Inn Chicago Downtown Riverwalk") // __NEXT_DATA__
  assert.equal(byCode.CHIDTGI.lat, 41.8868)
  assert.equal(byCode.CHITDHX.propertyName, "CHITDHX") // nothing usable: the server resolves the code
  for (const o of r.observations) {
    assert.doesNotMatch(o.propertyName, /^\s*(US)?\$\s?\d/, o.propertyCode)
    assert.equal(o.rateKind, "PRIVATE_HILTON_GO", `${o.propertyCode} has one price: no invented public rate`)
  }
  assert.equal(r.observations.length, 5)
})

test("original search fixture still extracts through the DOM layer", () => {
  const { makeDocument } = require("./mini-dom.js")
  const url = "https://www.hilton.com/en/search/?query=Chicago"
  const r = X.extractFromDocument(makeDocument(fixture("search.html"), url), { url })
  const names = [...new Set(r.observations.map((o) => o.propertyName))]
  assert.deepEqual(names, ["Hilton Chicago", "Hampton Inn Chicago Downtown/Magnificent Mile", "Conrad Chicago Downtown"])
  assert.equal(r.observations.find((o) => o.propertyCode === "CHIRSCI").available, false)
  const hilton = r.observations.filter((o) => o.propertyCode === "CHICHHH")
  assert.deepEqual(hilton.map((o) => [o.rateKind, o.nightlyRate]), [["PRIVATE_HILTON_GO", 89], ["PUBLIC", 249]])
})

// ── Intent-driven classification (0.3.0) ────────────────────────────────────

test("intent PUBLIC: every price is PUBLIC 'public search', one per card, strikethrough ignored", () => {
  const obs = X.buildCardObservations(searchCards[0], { goContext: true, brand: "hilton", intent: "PUBLIC" })
  assert.equal(obs.length, 1)
  assert.deepEqual([obs[0].rateKind, obs[0].nightlyRate, obs[0].rateLabel, obs[0].totalRate], ["PUBLIC", 89, "public search", 201.4])
  const m = X.buildCardObservations({ name: "JW Marriott Chicago", code: "CHIJW", entries: [{ text: "$189" }, { text: "$329", struck: true }] }, { brand: "marriott", intent: "PUBLIC" })
  assert.deepEqual(m.map((o) => [o.rateKind, o.nightlyRate, o.rateLabel]), [["PUBLIC", 189, "public search"]])
})

test("intent PRIVATE: displayed price is the brand's private kind, labelled from nearby rate text or the default", () => {
  const go = X.buildCardObservations(searchCards[0], { brand: "hilton", intent: "PRIVATE" })
  assert.deepEqual(go.map((o) => [o.rateKind, o.nightlyRate, o.rateLabel]), [["PRIVATE_HILTON_GO", 89, "Team Member Rate"]])
  const plain = X.buildCardObservations(searchCards[1], { brand: "hilton", intent: "PRIVATE" })
  assert.deepEqual(plain.map((o) => [o.rateKind, o.rateLabel]), [["PRIVATE_HILTON_GO", "Go Hilton search"]])
  const ff = X.buildCardObservations({ name: "JW Marriott Chicago", entries: [{ text: "$189", label: "$189 /night" }] }, { brand: "marriott", intent: "PRIVATE" })
  assert.deepEqual(ff.map((o) => [o.rateKind, o.rateLabel]), [["PRIVATE_MARRIOTT_FF", "MMF search"]])
  const labelled = X.buildCardObservations(
    { name: "JW Marriott Chicago", entries: [{ text: "$189", label: "$189 Select" }] },
    { brand: "marriott", intent: "PRIVATE", rateLabel: "Friends & Family Rate" },
  )
  assert.equal(labelled[0].rateLabel, "Friends & Family Rate")
  // "Select" next to a price is not a rate name.
  assert.equal(X.buildCardObservations({ name: "X Hotel", entries: [{ text: "$99", label: "$99 Select" }] }, { brand: "hilton", intent: "PRIVATE" })[0].rateLabel, "Go Hilton search")
})

test("intent PRIVATE on Hilton while signed out: PUBLIC with rateLabel signed-out", () => {
  const obs = X.buildCardObservations(searchCards[0], { brand: "hilton", intent: "PRIVATE", signedOut: true })
  assert.deepEqual(obs.map((o) => [o.rateKind, o.nightlyRate, o.rateLabel]), [["PUBLIC", 89, "signed-out"]])
  // Marriott's F&F is a rate code, not a sign-in: never downgraded.
  const m = X.buildCardObservations({ name: "JW Marriott Chicago", entries: [{ text: "$189" }] }, { brand: "marriott", intent: "PRIVATE", signedOut: true })
  assert.equal(m[0].rateKind, "PRIVATE_MARRIOTT_FF")
})

test("Hilton DOM with an intent: one observation per card of the item's kind", () => {
  const { makeDocument } = require("./mini-dom.js")
  const url = "https://www.hilton.com/en/search/?query=Chicago&arrivalDate=2026-10-29&departureDate=2026-11-01"
  const doc = makeDocument(fixture("search-price-first.html"), url)
  const priv = X.extractFromDocument(doc, { url, brand: "hilton", intent: "PRIVATE" })
  assert.equal(priv.observations.length, 5)
  assert.ok(priv.observations.every((o) => o.rateKind === "PRIVATE_HILTON_GO" && o.rateLabel === "Go Hilton search"))
  const pub = X.extractFromDocument(doc, { url, brand: "hilton", intent: "PUBLIC" })
  assert.ok(pub.observations.every((o) => o.rateKind === "PUBLIC" && o.rateLabel === "public search"))
  assert.deepEqual(pub.observations.map((o) => o.propertyCode).sort(), priv.observations.map((o) => o.propertyCode).sort())
})

// ── Marriott ─────────────────────────────────────────────────────────────────

test("marriottCodeFromUrl reads propertyCode params and /hotels/ paths; attrs must be 5 letters", () => {
  assert.equal(X.marriottCodeFromUrl("/reservation/availabilitySearch.mi?propertyCode=chidt&fromDate=11/06/2026"), "CHIDT")
  assert.equal(X.marriottCodeFromUrl("https://www.marriott.com/hotels/travel/chicd-courtyard-chicago-downtown-river-north/"), "CHICD")
  assert.equal(X.marriottCodeFromUrl("https://www.marriott.com/en-us/hotels/chijw-jw-marriott-chicago/overview/"), "CHIJW")
  assert.equal(X.marriottCodeFromUrl("/en-us/hotels/chijw1-x/"), undefined)
  assert.equal(X.marriottCodeFromUrl("/reservation/availabilitySearch.mi?propertyCode=CHI1W"), undefined)
  assert.equal(X.marriottCodeFromUrl("https://www.marriott.com/default.mi"), undefined)
  assert.equal(X.marriottCodeFromUrl(""), undefined)
  assert.equal(X.marriottCodeFromAttr(" chijw "), "CHIJW")
  assert.equal(X.marriottCodeFromAttr("12345"), undefined)
  const codes = hrefs(fixture("marriott-search.html")).map((h) => X.marriottCodeFromUrl(h)).filter(Boolean)
  assert.deepEqual(codes, ["CHIJW", "CHIDT", "CHICD"])
  assert.equal(X.marriottBrandFromName("The Ritz-Carlton, Chicago"), "Ritz-Carlton")
  assert.equal(X.marriottBrandFromName("JW Marriott Chicago"), "JW Marriott")
  assert.equal(X.marriottBrandFromName("Residence Inn by Marriott"), "Residence Inn")
})

test("Marriott error / bot pages are blocked; results pages are not", () => {
  const e = fixture("marriott-error.html")
  assert.equal(X.detectBlocked({ title: titleOf(e), text: htmlToText(e), url: "https://www.marriott.com/search/findHotels.mi" }), true)
  assert.equal(X.detectBlocked({ title: "Access Denied", text: "You don't have permission to access", url: "https://www.marriott.com/" }), true)
  for (const f of ["marriott-search.html", "marriott-search-price-first.html"]) {
    const h = fixture(f)
    assert.equal(X.detectBlocked({ title: titleOf(h), text: htmlToText(h), url: "https://www.marriott.com/search/findHotels.mi" }), false, f)
  }
  assert.equal(X.detectPageKind("https://www.marriott.com/search/findHotels.mi?x=1"), "SEARCH")
  assert.equal(X.detectPageKind("https://www.marriott.com/reservation/availabilitySearch.mi?propertyCode=CHIJW"), "ROOMS")
})

test("Marriott search page (3 cards) with a PRIVATE (F&F) item", () => {
  const { makeDocument } = require("./mini-dom.js")
  const url = "https://www.marriott.com/search/findHotels.mi?destinationAddress.destination=Chicago&fromDate=11/06/2026&toDate=11/08/2026&clusterCode=corp&corporateCode=MMF"
  const r = X.extractFromDocument(makeDocument(fixture("marriott-search.html"), url), { url, intent: "PRIVATE" })
  assert.equal(r.brand, "marriott")
  assert.equal(r.intent, "PRIVATE")
  assert.equal(r.blocked, false)
  assert.equal(r.debug.cardSelector, '[data-testid="property-card"]')
  assert.equal(r.debug.cardCount, 3)
  assert.doesNotMatch(r.debug.url, /corporateCode|MMF/, "the rate code never lands in a snapshot")
  const byCode = Object.fromEntries(r.observations.map((o) => [o.propertyCode, o]))
  assert.deepEqual(Object.keys(byCode).sort(), ["CHICD", "CHIDT", "CHIJW"])
  assert.deepEqual(
    [byCode.CHIJW.propertyName, byCode.CHIJW.rateKind, byCode.CHIJW.nightlyRate, byCode.CHIJW.rateLabel, byCode.CHIJW.brand],
    ["JW Marriott Chicago", "PRIVATE_MARRIOTT_FF", 189, "Friends & Family Rate", "JW Marriott"],
  )
  assert.equal(byCode.CHIJW.lat, 41.8794)
  assert.deepEqual([byCode.CHIDT.rateKind, byCode.CHIDT.nightlyRate, byCode.CHIDT.rateLabel], ["PRIVATE_MARRIOTT_FF", 219, "MMF search"])
  assert.doesNotMatch(byCode.CHIDT.propertyUrl, /corporateCode/)
  assert.equal(byCode.CHICD.available, false)
  // Exactly one observation per priced card: the struck $329 is not a public rate.
  assert.equal(r.observations.filter((o) => o.available).length, 2)
})

test("Marriott search page with a PUBLIC item: same hotels, PUBLIC kind", () => {
  const { makeDocument } = require("./mini-dom.js")
  const url = "https://www.marriott.com/search/findHotels.mi?destinationAddress.destination=Chicago&fromDate=11/06/2026&toDate=11/08/2026"
  const r = X.extractFromDocument(makeDocument(fixture("marriott-search.html"), url), { url, brand: "marriott", intent: "PUBLIC" })
  const priced = r.observations.filter((o) => o.available)
  assert.deepEqual(priced.map((o) => [o.propertyCode, o.rateKind, o.nightlyRate, o.rateLabel]), [
    ["CHIJW", "PUBLIC", 189, "public search"],
    ["CHIDT", "PUBLIC", 219, "public search"],
  ])
})

test("Marriott cards where the price precedes the name: names never look like money", () => {
  const { makeDocument } = require("./mini-dom.js")
  const url = "https://www.marriott.com/search/findHotels.mi?destinationAddress.destination=Chicago&fromDate=11/06/2026&toDate=11/08/2026"
  const r = X.extractFromDocument(makeDocument(fixture("marriott-search-price-first.html"), url), { url, intent: "PRIVATE" })
  const byCode = Object.fromEntries(r.observations.map((o) => [o.propertyCode, o]))
  assert.deepEqual(Object.keys(byCode).sort(), ["CHIAL", "CHIRZ", "CHIWI"])
  assert.equal(byCode.CHIRZ.propertyName, "The Ritz-Carlton, Chicago") // heading after an <h3>$249</h3>
  assert.equal(byCode.CHIRZ.nightlyRate, 249)
  assert.equal(byCode.CHIRZ.brand, "Ritz-Carlton")
  assert.equal(byCode.CHIWI.propertyName, "The Westin Michigan Avenue Chicago") // link aria-label
  assert.equal(byCode.CHIWI.brand, "Westin")
  assert.equal(byCode.CHIAL.propertyName, "Aloft Chicago Mag Mile") // __NEXT_DATA__
  assert.equal(byCode.CHIAL.lat, 41.8935)
  for (const o of r.observations) {
    assert.doesNotMatch(o.propertyName, /^\s*(US)?\$\s?\d/, o.propertyCode)
    assert.equal(o.rateKind, "PRIVATE_MARRIOTT_FF")
  }
})

test("quickProbe and snapshot work on Marriott pages", () => {
  const { makeDocument } = require("./mini-dom.js")
  const url = "https://www.marriott.com/search/findHotels.mi?fromDate=11/06/2026&toDate=11/08/2026&corporateCode=MMF"
  const doc = makeDocument(fixture("marriott-search.html"), url)
  const p = X.quickProbe(doc, url)
  assert.deepEqual([p.cardCount, p.priced, p.soldOut, p.blocked], [3, 2, 1, false])
  const snap = X.snapshot(doc, { url, intent: "PRIVATE" })
  assert.equal(snap.brand, "marriott")
  assert.equal(snap.cardCount, 3)
  assert.doesNotMatch(JSON.stringify(snap), /corporateCode|clusterCode/)
})
