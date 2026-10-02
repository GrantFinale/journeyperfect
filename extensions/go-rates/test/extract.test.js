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
