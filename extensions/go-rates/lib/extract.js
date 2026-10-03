/*
 * JourneyPerfect Go Rates: Hilton and Marriott page extraction.
 *
 * Plain JS, no build step. Loaded three ways:
 *   - as a content script on www.hilton.com and www.marriott.com
 *     (attaches globalThis.JPGoRatesExtract)
 *   - by node tests (module.exports)
 *   - nowhere else: the background worker never parses pages.
 *
 * This module only READS the DOM. It never clicks, types, scrolls, or touches
 * cookies/storage.
 *
 * ── Selector assumptions ────────────────────────────────────────────────────
 * We cannot see the live (signed-in) Go Hilton pages from here, so every
 * selector below is an ASSUMPTION, reused from
 * services/browser-runner/src/hilton.ts where one existed. Lists are tried in
 * order: data-testid first, then class/element fallbacks. When no price
 * element matches, the extractor falls back to a money regex over card text.
 * If Hilton changes its markup, update SELECTORS (and the regexes next to it)
 * here only; use the popup's "Debug: copy page snapshot" to see what matched.
 *
 *   signedIn[]     header widgets that only render for a signed-in member
 *   signedOut[]    sign-in links/buttons (plus SIGN_IN_TEXT on header buttons)
 *   goHilton.*     Go Hilton / team-member branding. Only header/banner text,
 *                  the URL path and explicit go-hilton markers count, so a
 *                  footer link to the portal does not trigger inference.
 *   search.*       property cards on /en/search/ results
 *   room.*         room cards on /en/book/reservation/rooms/
 *   struck         strikethrough / "was" price containers. A computed
 *                  text-decoration of line-through also counts.
 *   codeAttrs      data attributes that may carry the ctyhocn on a card
 *
 * MARRIOTT_SELECTORS (same idea, also assumptions, written without seeing a
 * live Marriott page): property cards on /search/findHotels.mi results, the
 * MARSHA property code (5 letters) from links (`propertyCode=` param,
 * `/hotels/travel/<code>-…` or `/en-us/hotels/<code>-…` paths) or data
 * attributes, and the nightly price shown per card.
 *
 * Rate classification. When the run gives the item's INTENT (every tab the
 * extension opens, and manual captures matched to an item), the item decides:
 *   PUBLIC item   cheapest displayed (non-strikethrough) price → PUBLIC,
 *                 rateLabel "public search"
 *   PRIVATE item  cheapest displayed price → PRIVATE_HILTON_GO (hilton) or
 *                 PRIVATE_MARRIOTT_FF (marriott), rateLabel = the rate label
 *                 next to the price, else "Go Hilton search" / "MMF search".
 *                 Signed out of Hilton: PUBLIC with rateLabel "signed-out".
 * Strikethrough prices are ignored. Without an intent (legacy callers) the
 * page-guessing rules below (classifyEntry etc.) still apply.
 * ────────────────────────────────────────────────────────────────────────────
 */
;(function (root) {
  "use strict"

  const VERSION = "0.3.0"

  const SELECTORS = {
    signedIn: [
      '[data-testid="header-account-menu"]',
      '[data-testid="honors-account-menu"]',
      'button[aria-label*="account" i][aria-haspopup]',
      'a[href*="/hilton-honors/guest/"]',
      '[data-testid="points-balance"]',
      'button[data-e2e="account-menu"]',
      'a[href*="logout" i]',
      'a[href*="signout" i]',
    ],
    signedOut: ['a[href*="/hilton-honors/login"]', '[data-testid="header-sign-in"]'],
    header: ['header', '[role="banner"]', '[data-testid*="header" i]', "nav"],
    goHilton: {
      markers: [
        '[data-testid*="go-hilton" i]',
        '[data-testid*="goHilton" i]',
        '[class*="go-hilton" i]',
        '[class*="goHilton" i]',
        'img[alt*="go hilton" i]',
        'img[alt*="team member" i]',
      ],
      path: "/go-hilton/",
    },
    search: {
      card: [
        '[data-testid="hotel-card"]',
        '[data-testid*="hotelCard" i]',
        '[data-testid*="property-card" i]',
        'li[class*="hotel" i]',
        'article[class*="hotel" i]',
        '[class*="HotelCard" i]',
      ],
      // Tried in order; every candidate must pass isPlausibleName (never a price).
      name: [
        '[data-testid*="hotel-name" i]',
        '[data-testid*="property-name" i]',
        '[data-testid*="hotelName" i]',
        '[data-testid*="propertyName" i]',
        "h2",
        "h3",
        "h4",
      ],
      price: ['[data-testid*="price" i]', '[data-testid*="rate" i]', '[class*="price" i]', '[class*="rate" i]'],
      link: ['a[href*="ctyhocn="]', 'a[href*="/hotels/"]'],
    },
    room: {
      card: [
        '[data-testid="room-type-card"]',
        '[data-testid*="roomTypeCard" i]',
        '[data-testid*="room-card" i]',
        'article[class*="room" i]',
        'li[class*="room" i]',
        '[class*="RoomCard" i]',
      ],
      name: ['[data-testid*="room-name" i]', '[data-testid*="roomName" i]', "h2", "h3", "h4"],
      price: ['[data-testid*="price" i]', '[data-testid*="rate" i]', '[class*="price" i]', '[class*="rate" i]'],
    },
    propertyName: ['[data-testid="hotel-name"]', 'h1[class*="hotel" i]', "h1", 'meta[property="og:title"]'],
    brand: ['meta[name="brand"]', '[data-testid="brand-logo"] img[alt]', 'img[alt*="logo" i]'],
    struck: [
      "s",
      "del",
      "strike",
      '[class*="strike" i]',
      '[class*="crossed" i]',
      '[class*="was-price" i]',
      '[class*="wasPrice" i]',
      '[data-testid*="strike" i]',
      '[data-testid*="original-price" i]',
    ],
    codeAttrs: ["data-ctyhocn", "data-property-code", "data-propcode"],
    jsonLd: 'script[type="application/ld+json"]',
    nextData: "script#__NEXT_DATA__",
  }

  const MARRIOTT_SELECTORS = {
    search: {
      card: [
        '[data-testid="property-card"]',
        '[data-testid*="property-card" i]',
        '[data-component-name*="PropertyCard" i]',
        'div[class*="property-card" i]',
        'li[class*="property-card" i]',
        '[class*="PropertyCard" i]',
        "[data-marsha]",
      ],
      // Tried in order; every candidate must pass isPlausibleName (never a price).
      name: [
        '[data-testid*="property-name" i]',
        '[data-testid*="hotel-name" i]',
        '[class*="property-name" i]',
        '[class*="hotel-name" i]',
        "h2",
        "h3",
        "h4",
      ],
      price: ['[data-testid*="price" i]', '[data-testid*="rate" i]', '[class*="price" i]', '[class*="rate" i]'],
      link: ['a[href*="propertyCode="]', 'a[href*="/hotels/travel/"]', 'a[href*="/hotels/"]'],
    },
    room: {
      card: ['[data-testid*="rate-card" i]', '[data-testid*="room-rate" i]', '[class*="rate-card" i]', '[class*="RateCard" i]'],
      price: ['[data-testid*="price" i]', '[class*="price" i]', '[class*="rate" i]'],
    },
    propertyName: ['[data-testid*="property-name" i]', "h1", 'meta[property="og:title"]'],
    codeAttrs: ["data-marsha", "data-marsha-code", "data-property-code", "data-propertycode", "data-property-id"],
    // Labels Marriott may print next to a corporate/F&F price.
    rateLabel: ['[data-testid*="rate-name" i]', '[class*="rate-name" i]', '[class*="rateName" i]', '[class*="rate-label" i]'],
  }

  /** Marriott sub-brands, matched longest first against a hotel name or logo alt. */
  const MARRIOTT_BRANDS = [
    "The Ritz-Carlton", "Ritz-Carlton", "St. Regis", "JW Marriott", "EDITION", "The Luxury Collection", "W Hotels",
    "Bulgari", "Autograph Collection", "Tribute Portfolio", "Le Méridien", "Le Meridien", "Westin", "Sheraton",
    "Renaissance", "Gaylord", "Delta Hotels", "Courtyard", "Residence Inn", "SpringHill Suites", "Fairfield",
    "TownePlace Suites", "AC Hotel", "Aloft", "Moxy", "Four Points", "Element", "Design Hotels", "Marriott",
  ]

  // Text patterns (also assumptions about Hilton copy).
  const SIGN_IN_TEXT = /^\s*(sign in|sign in or join|log in|join\s*\/\s*sign in)\s*$/i
  const GO_TEXT = /go\s*hilton|team\s*member|\btmtp\b|team member travel/i
  const TEAM_RE = /team\s*member|go\s*hilton|\btmtp\b|travel\s*program|friends\s*(and|&)\s*family/i
  const PUBLIC_RE = /\b(standard|was|regular|best available|lowest public|public rate|flexible rate|base rate|honors discount|honors member|original price|before discount)\b/i
  const TOTAL_RE = /\btotal\b|for\s+\d+\s+nights?/i
  const PER_NIGHT_RE = /per\s*night|\/\s*night|a night|nightly|avg/i
  const IGNORE_RE = /\b(save|you save|off|points?|fee|fees|deposit)\b/i
  const SOLD_OUT_RE = /sold out|not available|unavailable|no rooms/i
  const NO_RESULTS_RE = /no hotels found|no results|we couldn.t find|no rooms available|no availability/i

  const CURRENCY = {
    "US$": "USD", USD: "USD", "CA$": "CAD", CAD: "CAD", "A$": "AUD", AUD: "AUD", "MX$": "MXN", MXN: "MXN",
    "€": "EUR", EUR: "EUR", "£": "GBP", GBP: "GBP", "¥": "JPY", JPY: "JPY", $: "USD",
  }
  const MONEY_SRC =
    "(US\\$|USD|CA\\$|CAD|A\\$|AUD|MX\\$|MXN|€|EUR|£|GBP|¥|JPY|\\$)\\s?(\\d{1,3}(?:,\\d{3})+(?:\\.\\d{1,2})?|\\d+(?:\\.\\d{1,2})?)"

  /** Hilton property codes end in a two-letter brand code. Best-effort map (from hilton.ts). */
  const CTYHOCN_BRANDS = {
    HH: "Hilton Hotels & Resorts", HI: "Hilton Hotels & Resorts", WA: "Waldorf Astoria", CI: "Conrad",
    LX: "LXR Hotels & Resorts", OL: "LXR Hotels & Resorts", QQ: "Curio Collection", UP: "Canopy by Hilton",
    SA: "Signia by Hilton", DT: "DoubleTree by Hilton", DI: "DoubleTree by Hilton", PY: "Tapestry Collection",
    ES: "Embassy Suites by Hilton", GI: "Hilton Garden Inn", HX: "Hampton by Hilton", HT: "Home2 Suites by Hilton",
    PE: "Home2 Suites by Hilton", HW: "Homewood Suites by Hilton", RU: "Tru by Hilton", UA: "Motto by Hilton",
    GV: "Hilton Grand Vacations", TR: "Tempo by Hilton", SN: "Spark by Hilton", GU: "Graduate by Hilton",
    ND: "NoMad", LW: "Small Luxury Hotels", AH: "AutoCamp",
  }

  // ── Pure helpers (unit-tested in node) ─────────────────────────────────────

  function norm(s) {
    return String(s == null ? "" : s).replace(/\s+/g, " ").trim()
  }

  /** First money amount in text → { amount, currency, raw } or null. US grouping assumed. */
  function parseMoney(text) {
    const m = new RegExp(MONEY_SRC).exec(String(text || ""))
    if (!m) return null
    const amount = Number(m[2].replace(/,/g, ""))
    if (!Number.isFinite(amount) || amount <= 0) return null
    return { amount, currency: CURRENCY[m[1]] || "USD", raw: m[0], index: m.index }
  }

  /** Every money amount in text, in order. */
  function parseAllMoney(text) {
    const re = new RegExp(MONEY_SRC, "g")
    const out = []
    const s = String(text || "")
    let m
    while ((m = re.exec(s))) {
      const amount = Number(m[2].replace(/,/g, ""))
      if (Number.isFinite(amount) && amount > 0) out.push({ amount, currency: CURRENCY[m[1]] || "USD", raw: m[0], index: m.index })
    }
    return out
  }

  function stripMoney(text) {
    return norm(String(text || "").replace(new RegExp(MONEY_SRC, "g"), " "))
  }

  /** Property code (ctyhocn) from a Hilton URL: `ctyhocn=` param, else `/hotels/<code>-slug`. */
  function codeFromUrl(href, base) {
    if (!href) return undefined
    try {
      const u = new URL(href, base || "https://www.hilton.com")
      const q = u.searchParams.get("ctyhocn")
      if (q && /^[A-Za-z0-9]{4,10}$/.test(q)) return q.toUpperCase()
      const m = /\/hotels\/([a-z0-9]{5,8})-/i.exec(u.pathname)
      if (m) return m[1].toUpperCase()
    } catch (_e) {
      // not a URL
    }
    return undefined
  }

  function brandFromCode(code) {
    if (!code) return undefined
    return CTYHOCN_BRANDS[String(code).trim().toUpperCase().slice(-2)]
  }

  const MARSHA_RE = /^[A-Za-z]{5}$/

  /**
   * Marriott MARSHA code (5 letters, upper-cased) from a URL: `propertyCode=`
   * param, else `/hotels/travel/<code>-…` or `/<locale>/hotels/<code>-…`.
   */
  function marriottCodeFromUrl(href, base) {
    if (!href) return undefined
    try {
      const u = new URL(href, base || "https://www.marriott.com")
      const q = u.searchParams.get("propertyCode") || u.searchParams.get("marshaCode")
      if (q && MARSHA_RE.test(q)) return q.toUpperCase()
      const m = /\/hotels\/(?:travel\/)?([a-z]{5})-/i.exec(u.pathname)
      if (m) return m[1].toUpperCase()
    } catch (_e) {
      // not a URL
    }
    return undefined
  }

  /** A data-attribute value that is a MARSHA code, upper-cased; else undefined. */
  function marriottCodeFromAttr(v) {
    const t = String(v || "").trim()
    return MARSHA_RE.test(t) ? t.toUpperCase() : undefined
  }

  /** Marriott sub-brand named in a hotel name ("JW Marriott Chicago" → "JW Marriott"). */
  function marriottBrandFromName(name) {
    const n = String(name || "").toLowerCase()
    if (!n) return undefined
    const sorted = MARRIOTT_BRANDS.slice().sort((a, b) => b.length - a.length)
    for (const b of sorted) if (n.includes(b.toLowerCase())) return b.replace(/^The /, "")
    return undefined
  }

  /** "hilton" | "marriott" from a page URL's host; null for anything else. */
  function brandFromUrl(url) {
    try {
      const h = new URL(url).host
      if (h === "www.hilton.com") return "hilton"
      if (h === "www.marriott.com") return "marriott"
    } catch (_e) {
      // ignore
    }
    return null
  }

  // Card text that is never a hotel name: calls to action and rate/price chrome.
  const CTA_RE = /^(view|see|book|select|check|choose|show|more|reserve|explore|compare|find|learn|go to)\b|\b(rates?|details|deals?|availability|more info)$/i
  const NOT_NAME_RE = /^(sold out|not available|unavailable|per night|nightly|total|from|team member|go hilton|member rate|lowest|price|rate|save|free)\b/i

  /** Light clean-up of a name candidate: aria-label boilerplate, "View rates for X", "opens in new tab". */
  function cleanNameCandidate(text) {
    return norm(text)
      .replace(/^(view|see|book|select|check)\s+(rates|details|hotel details|hotel|rooms|availability)?\s*(for|at)\s+/i, "")
      .replace(/,?\s*\(?opens?\s+(in\s+)?(a\s+)?new\s+(tab|window)\)?\.?$/i, "")
      .trim()
  }

  /**
   * True when text can be a hotel name: never money ("$317"), not mostly
   * digits/currency symbols, at least 3 letters, not a call to action.
   */
  function isPlausibleName(text) {
    const t = norm(text)
    if (!t || t.length > 160) return false
    if (new RegExp(MONEY_SRC).test(t)) return false
    const letters = (t.match(/\p{L}/gu) || []).length
    if (letters < 3) return false
    const compact = t.replace(/\s+/g, "")
    const numeric = (compact.match(/[\d$€£¥.,%+\-/]/g) || []).length
    if (numeric * 2 >= compact.length) return false
    if (CTA_RE.test(t) || NOT_NAME_RE.test(t)) return false
    return true
  }

  /**
   * First plausible name among ordered candidates; otherwise the property code
   * (the server resolves it to a stored name), otherwise "Property".
   */
  function choosePropertyName(candidates, code) {
    for (const c of candidates || []) {
      if (typeof c !== "string") continue
      const t = cleanNameCandidate(c)
      if (isPlausibleName(t)) return t.slice(0, 160)
    }
    return code ? String(code) : "Property"
  }

  /** Akamai / bot-protection error page detection from title + body text + url. */
  function detectBlocked(sig) {
    const title = String((sig && sig.title) || "").toLowerCase()
    const body = String((sig && sig.text) || "").toLowerCase()
    const url = String((sig && sig.url) || "").toLowerCase()
    if (url.includes("errors.edgesuite.net") || body.includes("errors.edgesuite.net")) return true
    if (/access denied/.test(title)) return true
    if (/reference\s*(no\.?|#|number)\s*:?\s*\d+\.[0-9a-f]{4,}/.test(body)) return true
    if (/you don.t have permission to access/.test(body)) return true
    if (/something went wrong/.test(body) && /reference/.test(body)) return true
    // Marriott's error page; on a real results page this phrase never appears alone.
    if (/we.re having trouble/.test(title)) return true
    if (/we.re having trouble/.test(body) && body.length < 4000) return true
    return false
  }

  function detectPageKind(url) {
    let path = ""
    try {
      path = new URL(url).pathname.toLowerCase()
    } catch (_e) {
      return "OTHER"
    }
    if (/\/book\/reservation\/rooms/.test(path)) return "ROOMS"
    if (/\/reservation\/(availabilitysearch|ratelistmenu)/.test(path)) return "ROOMS"
    if (/\/search(\/|$)/.test(path) || /\/locations\//.test(path)) return "SEARCH"
    return "OTHER"
  }

  /** Go Hilton portal context from url path + header/banner text + explicit markers. */
  function detectGoContext(sig) {
    const url = String((sig && sig.url) || "")
    try {
      if (new URL(url).pathname.toLowerCase().includes(SELECTORS.goHilton.path)) return true
    } catch (_e) {
      // ignore
    }
    if (sig && sig.marker) return true
    return GO_TEXT.test(String((sig && sig.headerText) || "")) || GO_TEXT.test(String((sig && sig.title) || ""))
  }

  /** Strip query params to a known-harmless whitelist (dates, property, search text). */
  function sanitizeUrl(href) {
    try {
      const u = new URL(href)
      // Never the Marriott corporateCode/clusterCode: the rate code stays out of snapshots.
      const keep = [
        "ctyhocn", "arrivalDate", "departureDate", "query", "room1NumAdults", "numRooms", "flexibleDates",
        "propertyCode", "fromDate", "toDate", "roomCount", "numberOfRooms", "numAdultsPerRoom", "numberOfAdults",
        "destinationAddress.destination",
      ]
      const out = new URL(u.origin + u.pathname)
      for (const k of keep) if (u.searchParams.has(k)) out.searchParams.set(k, u.searchParams.get(k))
      return out.toString()
    } catch (_e) {
      return ""
    }
  }

  /** Remove anything that looks like an email or a long number (account/confirmation ids). */
  function redact(s) {
    return norm(s)
      .replace(/[^\s@]+@[^\s@]+\.[a-z]{2,}/gi, "[email]")
      .replace(/\d[\d -]{8,}\d/g, "[number]")
      .slice(0, 160)
  }

  /**
   * Classify one price entry. Returns "PUBLIC" | "PRIVATE" | null (unlabelled).
   * Order: strikethrough → PUBLIC; team-member wording → PRIVATE; standard/was wording → PUBLIC.
   */
  function classifyEntry(entry) {
    if (entry.struck) return "PUBLIC"
    const ctx = (entry.text || "") + " " + (entry.label || "")
    if (TEAM_RE.test(ctx)) return "PRIVATE"
    if (PUBLIC_RE.test(ctx)) return "PUBLIC"
    return null
  }

  function cleanLabel(entry) {
    const l = stripMoney(entry.label || "").replace(/\b(per\s*night|a night|nightly|avg\.?)\b|\/\s*night/gi, " ")
    return redact(l).slice(0, 80) || undefined
  }

  const RATE_WORD_RE = /\b(rate|team\s*member|go\s*hilton|tmtp|friends|family|f&f|mmf|corporate|special|discount|package)\b/i
  const PRIVATE_KIND = { hilton: "PRIVATE_HILTON_GO", marriott: "PRIVATE_MARRIOTT_FF" }
  const PRIVATE_FALLBACK_LABEL = { hilton: "Go Hilton search", marriott: "MMF search" }

  /**
   * Classification driven by the run item's intent (see the header): one
   * observation per card from the cheapest displayed, non-strikethrough price.
   */
  function buildIntentObservation(nightly, totals, base, ctx) {
    const shown = nightly.filter((e) => !e.struck)
    if (!shown.length) return []
    const best = shown.reduce((a, b) => (b.amount < a.amount ? b : a))
    const brand = ctx.brand === "marriott" ? "marriott" : "hilton"
    let rateKind
    let rateLabel
    if (ctx.intent === "PUBLIC") {
      rateKind = "PUBLIC"
      rateLabel = "public search"
    } else if (ctx.signedOut && brand === "hilton") {
      rateKind = "PUBLIC"
      rateLabel = "signed-out"
    } else {
      rateKind = PRIVATE_KIND[brand]
      // Only text that reads like a rate name counts ("Team Member Rate", "Friends & Family"), never "Select".
      const near = [ctx.rateLabel && redact(stripMoney(ctx.rateLabel)).slice(0, 80), cleanLabel(best)]
      rateLabel = near.find((l) => l && RATE_WORD_RE.test(l)) || PRIVATE_FALLBACK_LABEL[brand]
    }
    const obs = Object.assign({}, base, { nightlyRate: best.amount, currency: best.currency, rateKind, rateLabel, available: true })
    const total = totals.length ? totals.slice().sort((a, b) => a.amount - b.amount)[0] : null
    if (total && total.amount >= best.amount && total.currency === best.currency) obs.totalRate = total.amount
    return [obs]
  }

  /**
   * Turn one card's raw price entries into observations.
   * card: { name, code?, url?, brand?, lat?, lng?, soldOut?, entries: [{ text, struck?, label? }] }
   * ctx:  { signedOut?: boolean, goContext?: boolean,
   *         brand?: "hilton" | "marriott", intent?: "PRIVATE" | "PUBLIC", rateLabel?: string }
   * With ctx.intent the item decides the rate kind (buildIntentObservation);
   * without it the legacy page-guessing rules apply.
   */
  function buildCardObservations(card, ctx) {
    ctx = ctx || {}
    const parsed = []
    for (const e of card.entries || []) {
      if (IGNORE_RE.test(e.text || "")) continue
      const m = parseMoney(e.text)
      if (!m) continue
      parsed.push(Object.assign({}, e, { amount: m.amount, currency: m.currency }))
    }
    const totals = parsed.filter(
      (e) => !e.struck && (TOTAL_RE.test(e.text || "") || (TOTAL_RE.test(e.label || "") && !PER_NIGHT_RE.test(e.label || ""))),
    )
    const nightly = parsed.filter((e) => totals.indexOf(e) === -1)

    const base = {
      propertyCode: card.code || undefined,
      propertyName: choosePropertyName([card.name], card.code),
      brand: card.brand || brandFromCode(card.code),
      lat: typeof card.lat === "number" ? card.lat : undefined,
      lng: typeof card.lng === "number" ? card.lng : undefined,
      propertyUrl: card.url || undefined,
    }

    if (!nightly.length) {
      if (card.soldOut) {
        return [Object.assign({}, base, {
          nightlyRate: 0, currency: "USD", rateKind: "PUBLIC",
          rateLabel: ctx.signedOut ? "signed-out" : "sold out", available: false,
        })]
      }
      return []
    }
    if (ctx.intent === "PRIVATE" || ctx.intent === "PUBLIC") return buildIntentObservation(nightly, totals, base, ctx)

    for (const e of nightly) {
      e.kind = classifyEntry(e)
      e.tag = e.kind ? cleanLabel(e) || (e.struck ? "strikethrough" : e.kind === "PRIVATE" ? "Team Member rate" : undefined) : undefined
      if (e.struck) {
        const l = cleanLabel(e)
        e.tag = l && PUBLIC_RE.test(l) && !TEAM_RE.test(l) ? l + " (strikethrough)" : "strikethrough"
      }
    }
    const hasPrivate = nightly.some((e) => e.kind === "PRIVATE")
    // The same unlabelled amount shown twice on a card (price + "$239 Select"
    // button) is one price, not a private rate and a public comparable.
    const seenAmounts = new Set()
    const unlabelled = nightly
      .filter((e) => e.kind === null)
      .sort((a, b) => a.amount - b.amount)
      .filter((e) => (seenAmounts.has(e.amount) ? false : (seenAmounts.add(e.amount), true)))
    const hasStruck = nightly.some((e) => e.struck)
    unlabelled.forEach((e, i) => {
      if (!hasPrivate && i === 0 && ctx.goContext && !ctx.signedOut) {
        e.kind = "PRIVATE"
        e.tag = hasStruck ? "inferred (Go Hilton portal, discounted vs strikethrough)" : "inferred (Go Hilton portal, single price)"
      } else {
        e.kind = "PUBLIC"
        e.tag = cleanLabel(e)
      }
    })
    if (ctx.signedOut) for (const e of nightly) {
      e.kind = "PUBLIC"
      e.tag = "signed-out"
    }

    const best = {}
    for (const e of nightly) if (!best[e.kind] || e.amount < best[e.kind].amount) best[e.kind] = e
    const total = totals.length ? totals.slice().sort((a, b) => a.amount - b.amount)[0] : null
    const primaryKind = best.PRIVATE ? "PRIVATE" : "PUBLIC"
    const out = []
    for (const kind of ["PRIVATE", "PUBLIC"]) {
      const e = best[kind]
      if (!e) continue
      const obs = Object.assign({}, base, {
        nightlyRate: e.amount,
        currency: e.currency,
        rateKind: kind === "PRIVATE" ? "PRIVATE_HILTON_GO" : "PUBLIC",
        rateLabel: e.tag,
        available: true,
      })
      if (total && kind === primaryKind && total.amount >= e.amount && total.currency === e.currency) obs.totalRate = total.amount
      out.push(obs)
    }
    return out
  }

  /** Reduce room-level observations to the cheapest per rate kind, prefixing labels with the room name. */
  function reduceRoomObservations(rooms) {
    const best = {}
    for (const r of rooms) {
      for (const o of r.observations) {
        if (!o.available) continue
        const cur = best[o.rateKind]
        if (!cur || o.nightlyRate < cur.nightlyRate) {
          best[o.rateKind] = Object.assign({}, o, {
            rateLabel: r.roomName ? norm(r.roomName + (o.rateLabel ? " · " + o.rateLabel : "")).slice(0, 120) : o.rateLabel,
          })
        }
      }
    }
    const out = []
    for (const kind of ["PRIVATE_HILTON_GO", "PRIVATE_MARRIOTT_FF", "PUBLIC"]) if (best[kind]) out.push(best[kind])
    if (!out.length && rooms.length) {
      const soldOut = rooms.find((r) => r.observations.some((o) => !o.available))
      if (soldOut) out.push(soldOut.observations.find((o) => !o.available))
    }
    return out
  }

  /**
   * Walk parsed JSON (JSON-LD or __NEXT_DATA__) collecting coordinates by
   * lower-cased name and by property code. Budgeted so huge blobs stay cheap.
   */
  function indexGeo(value, index, budget) {
    index = index || { byName: new Map(), byCode: new Map(), nameByCode: new Map() }
    if (!index.nameByCode) index.nameByCode = new Map()
    let left = budget || 200000
    const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v))
    const coords = (n) => {
      const pick = (o) => {
        if (!o || typeof o !== "object") return null
        const lat = num(o.latitude !== undefined ? o.latitude : o.lat)
        const lng = num(o.longitude !== undefined ? o.longitude : o.lng !== undefined ? o.lng : o.lon)
        return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null
      }
      return pick(n.geo) || pick(n.coordinate) || pick(n.coordinates) || pick(n.localization && n.localization.coordinate) || pick(n)
    }
    const stack = [value]
    while (stack.length && left-- > 0) {
      const n = stack.pop()
      if (!n || typeof n !== "object") continue
      if (Array.isArray(n)) {
        for (const v of n) if (v && typeof v === "object") stack.push(v)
        continue
      }
      // Names keyed by property code, with or without coordinates.
      const anyCode = [n.ctyhocn, n.propCode, n.propertyCode, n.marshaCode, n.marsha].find((v) => typeof v === "string" && /^[A-Za-z0-9]{4,10}$/.test(v))
      if (anyCode && !index.nameByCode.has(anyCode.toUpperCase())) {
        const nm = [n.name, n.propertyName, n.hotelName].find((v) => typeof v === "string" && isPlausibleName(v))
        if (nm) index.nameByCode.set(anyCode.toUpperCase(), norm(nm).slice(0, 160))
      }
      const c = coords(n)
      if (c) {
        const code = [n.ctyhocn, n.propCode, n.propertyCode, n.marshaCode, n.marsha].find((v) => typeof v === "string" && /^[A-Za-z0-9]{4,10}$/.test(v))
        const name = typeof n.name === "string" ? n.name : typeof n.propertyName === "string" ? n.propertyName : null
        const url = typeof n.url === "string" ? n.url : undefined
        if (code && !index.byCode.has(code.toUpperCase())) index.byCode.set(code.toUpperCase(), Object.assign({ url }, c))
        if (name && !index.byName.has(norm(name).toLowerCase())) index.byName.set(norm(name).toLowerCase(), Object.assign({ url }, c))
      }
      for (const k in n) {
        const v = n[k]
        if (v && typeof v === "object") stack.push(v)
      }
    }
    return index
  }

  // ── DOM layer (runs in the Hilton content script) ──────────────────────────

  function textOf(el) {
    if (!el) return ""
    if (el.tagName === "META") return norm(el.getAttribute("content"))
    return norm(el.textContent)
  }

  function safeAll(rootEl, q) {
    try {
      return Array.from(rootEl.querySelectorAll(q))
    } catch (_e) {
      return []
    }
  }

  function safeOne(rootEl, q) {
    try {
      return rootEl.querySelector(q)
    } catch (_e) {
      return null
    }
  }

  function firstText(rootEl, sels) {
    for (const q of sels) {
      const el = safeOne(rootEl, q)
      const t = textOf(el)
      if (t) return t
    }
    return ""
  }

  function anyMatch(rootEl, sels) {
    return sels.some((q) => safeOne(rootEl, q) !== null)
  }

  function detectAuth(doc) {
    const signedIn = anyMatch(doc, SELECTORS.signedIn)
    let signIn = anyMatch(doc, SELECTORS.signedOut)
    if (!signIn) {
      for (const h of SELECTORS.header) {
        for (const hdr of safeAll(doc, h)) {
          for (const el of safeAll(hdr, "a, button")) {
            if (SIGN_IN_TEXT.test(el.textContent || "")) {
              signIn = true
              break
            }
          }
          if (signIn) break
        }
        if (signIn) break
      }
    }
    return { signedIn, signedOut: signIn && !signedIn }
  }

  function headerText(doc) {
    const parts = []
    for (const h of SELECTORS.header) for (const el of safeAll(doc, h).slice(0, 3)) parts.push(textOf(el).slice(0, 2000))
    return parts.join(" ")
  }

  function isStruck(el, card, win) {
    for (const q of SELECTORS.struck) {
      let c = null
      try {
        c = el.closest(q)
      } catch (_e) {
        c = null
      }
      if (c && (c === card || card.contains(c))) return true
    }
    if (win && win.getComputedStyle) {
      let node = el
      for (let i = 0; i < 2 && node && node !== card; i++, node = node.parentElement) {
        try {
          const st = win.getComputedStyle(node)
          if (/line-through/.test(st.textDecorationLine || st.textDecoration || "")) return true
        } catch (_e) {
          // ignore
        }
      }
    }
    return false
  }

  function labelFor(el, card) {
    const own = textOf(el)
    const bits = []
    const aria = el.closest && el.closest("[aria-label]")
    if (aria && card.contains(aria)) bits.push(aria.getAttribute("aria-label") || "")
    let node = el.parentElement
    for (let i = 0; i < 3 && node; i++) {
      const t = textOf(node)
      if (t.length > own.length + 2 && t.length <= 160) {
        bits.push(t)
        break
      }
      if (node === card) break
      node = node.parentElement
    }
    return norm(bits.join(" ")).slice(0, 200)
  }

  /** Smallest elements inside the card whose text holds one full money string. */
  function collectEntries(card, priceSels, win) {
    const moneyRe = new RegExp(MONEY_SRC)
    const out = []
    const all = safeAll(card, "*")
    for (const el of all) {
      if (out.length >= 12) break
      const tag = el.tagName
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") continue
      const t = textOf(el)
      if (!t || t.length > 60 || !moneyRe.test(t)) continue
      let childHas = false
      for (const ch of Array.from(el.children)) if (moneyRe.test(textOf(ch))) childHas = true
      if (childHas) continue
      out.push({ text: t, struck: isStruck(el, card, win), label: labelFor(el, card), via: "element" })
    }
    if (!out.length) {
      for (const q of priceSels) {
        for (const el of safeAll(card, q)) {
          const t = textOf(el)
          if (moneyRe.test(t)) out.push({ text: t.slice(0, 60), struck: isStruck(el, card, win), label: labelFor(el, card), via: q })
        }
        if (out.length) break
      }
    }
    if (!out.length) {
      const ct = textOf(card)
      for (const m of parseAllMoney(ct).slice(0, 6)) {
        out.push({ text: m.raw, struck: false, label: ct.slice(Math.max(0, m.index - 60), m.index), via: "text-scan" })
      }
    }
    return out
  }

  function findCards(doc, cardSels, linkSels, codeFn) {
    codeFn = codeFn || codeFromUrl
    for (const q of cardSels) {
      const cards = safeAll(doc, q)
      if (cards.length) return { cards, selector: q }
    }
    if (!linkSels) return { cards: [], selector: null }
    const seen = new Set()
    const cards = []
    for (const lq of linkSels) {
      for (const a of safeAll(doc, lq)) {
        if (!codeFn(a.getAttribute("href"))) continue
        let node = a
        for (let i = 0; i < 4 && node && node.parentElement && node.parentElement !== doc.body; i++) node = node.parentElement
        if (node && !seen.has(node)) {
          seen.add(node)
          cards.push(node)
        }
      }
      if (cards.length) return { cards, selector: "fallback:" + lq + " ancestor" }
    }
    return { cards: [], selector: null }
  }

  function geoIndexFor(doc) {
    const index = { byName: new Map(), byCode: new Map(), nameByCode: new Map() }
    for (const s of safeAll(doc, SELECTORS.jsonLd)) {
      try {
        indexGeo(JSON.parse(s.textContent || "null"), index, 50000)
      } catch (_e) {
        // malformed JSON-LD
      }
    }
    const nd = safeOne(doc, SELECTORS.nextData)
    if (nd && (nd.textContent || "").length < 8000000) {
      try {
        indexGeo(JSON.parse(nd.textContent || "null"), index, 200000)
      } catch (_e) {
        // ignore
      }
    }
    return index
  }

  /**
   * Property code (and sanitized link) for a card. `site` defaults to Hilton:
   * { codeAttrs, codeFn(href, base), attrFn(value) }.
   */
  function cardCode(card, linkSels, base, site) {
    const attrs = (site && site.codeAttrs) || SELECTORS.codeAttrs
    const codeFn = (site && site.codeFn) || codeFromUrl
    const attrFn = (site && site.attrFn) || ((v) => String(v || "").toUpperCase() || undefined)
    for (const attr of attrs) {
      const v = card.getAttribute && card.getAttribute(attr)
      if (v && attrFn(v)) return { code: attrFn(v) }
      const el = safeOne(card, "[" + attr + "]")
      if (el && attrFn(el.getAttribute(attr))) return { code: attrFn(el.getAttribute(attr)) }
    }
    for (const q of linkSels) {
      for (const a of safeAll(card, q)) {
        const href = a.getAttribute("href")
        const code = codeFn(href, base)
        if (code) {
          let url
          try {
            url = sanitizeUrl(new URL(href, base).toString())
          } catch (_e) {
            url = undefined
          }
          return { code, url }
        }
      }
    }
    return {}
  }

  /**
   * Ordered hotel-name candidates for one search card:
   *   1. headings / name test-ids (SELECTORS.search.name, every match in order)
   *   2. text, aria-label and title of the link carrying this card's ctyhocn
   *   3. img alt inside the card (logos excluded)
   *   4. __NEXT_DATA__ / JSON-LD name keyed by the property code
   * choosePropertyName() rejects anything money-like, so a price that comes
   * before the heading can never become the name.
   */
  function cardNameCandidates(card, code, linkSels, nameByCode, base, nameSels, codeFn) {
    const out = []
    codeFn = codeFn || codeFromUrl
    for (const q of nameSels || SELECTORS.search.name) for (const el of safeAll(card, q).slice(0, 6)) out.push(textOf(el))
    for (const q of linkSels) {
      for (const a of safeAll(card, q)) {
        const c = codeFn(a.getAttribute("href"), base)
        if (!c || (code && c !== code)) continue
        out.push(textOf(a), a.getAttribute("aria-label") || "", a.getAttribute("title") || "")
      }
    }
    for (const img of safeAll(card, "img[alt]")) {
      const alt = img.getAttribute("alt") || ""
      if (alt && !/logo/i.test(alt)) out.push(alt)
    }
    if (code && nameByCode && nameByCode.get(code)) out.push(nameByCode.get(code))
    return out
  }

  function cardBrand(card) {
    const img = safeOne(card, 'img[alt*="logo" i]')
    const alt = img && img.getAttribute("alt")
    return alt ? norm(alt.replace(/\s*logo\s*$/i, "")) || undefined : undefined
  }

  /** Cheap readiness probe used by the content script's MutationObserver. */
  function quickProbe(doc, url) {
    const loc = url || (doc.location && doc.location.href) || ""
    const body = doc.body ? norm(doc.body.textContent).slice(0, 30000) : ""
    const blocked = detectBlocked({ title: doc.title, text: body, url: loc })
    const kind = detectPageKind(loc)
    const marriott = brandFromUrl(loc) === "marriott"
    const S = marriott ? MARRIOTT_SELECTORS : SELECTORS
    const sels = kind === "ROOMS" ? S.room.card : S.search.card
    const { cards } = findCards(doc, sels, kind === "ROOMS" ? null : S.search.link, marriott ? marriottCodeFromUrl : codeFromUrl)
    const moneyRe = new RegExp(MONEY_SRC)
    let priced = 0
    let soldOut = 0
    for (const c of cards) {
      const t = textOf(c)
      if (moneyRe.test(t)) priced++
      else if (SOLD_OUT_RE.test(t)) soldOut++
    }
    return { blocked, pageKind: kind, cardCount: cards.length, priced, soldOut, noResults: NO_RESULTS_RE.test(body) }
  }

  /**
   * Extract everything we can from a rendered Hilton or Marriott document.
   * opts: { url?, brand?: "hilton" | "marriott", intent?: "PRIVATE" | "PUBLIC" }.
   * The brand defaults to the URL's host (Hilton otherwise). Without an intent
   * the legacy page-guessing classification applies.
   * Returns { pageKind, blocked, auth, goContext, brand, intent, observations, debug }.
   */
  function extractFromDocument(doc, opts) {
    opts = opts || {}
    const loc0 = opts.url || (doc.location && doc.location.href) || ""
    const brand = opts.brand === "marriott" || opts.brand === "hilton" ? opts.brand : brandFromUrl(loc0) || "hilton"
    const intent = opts.intent === "PRIVATE" || opts.intent === "PUBLIC" ? opts.intent : undefined
    if (brand === "marriott") return extractMarriott(doc, Object.assign({}, opts, { url: loc0, intent }))
    const win = doc.defaultView || null
    const loc = loc0
    const title = doc.title || ""
    const bodyText = doc.body ? norm(doc.body.innerText || doc.body.textContent).slice(0, 30000) : ""
    const pageKind = detectPageKind(loc)
    const blocked = detectBlocked({ title, text: bodyText, url: loc })
    const result = {
      extractorVersion: VERSION,
      pageKind,
      blocked,
      brand: "hilton",
      intent: intent || null,
      auth: { signedIn: false, signedOut: false },
      goContext: false,
      observations: [],
      debug: { url: sanitizeUrl(loc), title: redact(title), cardSelector: null, cardCount: 0, cards: [] },
    }
    if (blocked) return result

    const auth = detectAuth(doc)
    const goContext = detectGoContext({
      url: loc,
      title,
      headerText: headerText(doc),
      marker: anyMatch(doc, SELECTORS.goHilton.markers),
    })
    result.auth = auth
    result.goContext = goContext
    const ctx = { signedOut: auth.signedOut, goContext, brand: "hilton", intent }
    const geo = geoIndexFor(doc)

    if (pageKind === "ROOMS") {
      let propertyCode = codeFromUrl(loc)
      const nameCands = []
      for (const q of SELECTORS.propertyName) for (const el of safeAll(doc, q).slice(0, 3)) nameCands.push(textOf(el))
      if (propertyCode && geo.nameByCode.get(propertyCode)) nameCands.push(geo.nameByCode.get(propertyCode))
      const propertyName = choosePropertyName(nameCands, propertyCode)
      let brand
      for (const q of SELECTORS.brand) {
        const el = safeOne(doc, q)
        const v = el && (el.getAttribute("content") || el.getAttribute("alt"))
        if (v) {
          brand = norm(v.replace(/\s*logo\s*$/i, "")) || undefined
          break
        }
      }
      const g = (propertyCode && geo.byCode.get(propertyCode)) || geo.byName.get(propertyName.toLowerCase()) || {}
      const found = findCards(doc, SELECTORS.room.card, null)
      let cards = found.cards
      result.debug.cardSelector = found.selector
      if (!cards.length) {
        const main = safeOne(doc, "main") || doc.body
        cards = main ? [main] : []
        result.debug.cardSelector = "fallback:main"
      }
      result.debug.cardCount = cards.length
      const rooms = []
      for (const card of cards.slice(0, 40)) {
        const roomName = firstText(card, SELECTORS.room.name).slice(0, 80)
        const entries = collectEntries(card, SELECTORS.room.price, win)
        const c = {
          name: propertyName, code: propertyCode, brand: brand || brandFromCode(propertyCode),
          lat: g.lat, lng: g.lng, url: sanitizeUrl(loc), soldOut: SOLD_OUT_RE.test(textOf(card)), entries,
        }
        rooms.push({ roomName, observations: buildCardObservations(c, ctx) })
        result.debug.cards.push({ name: redact(roomName), code: propertyCode, soldOut: c.soldOut, entries: entries.map(debugEntry) })
      }
      result.observations = reduceRoomObservations(rooms)
      return result
    }

    if (pageKind === "SEARCH" || pageKind === "OTHER") {
      const found = findCards(doc, SELECTORS.search.card, SELECTORS.search.link)
      result.debug.cardSelector = found.selector
      result.debug.cardCount = found.cards.length
      const codes = new Set()
      for (const card of found.cards.slice(0, 60)) {
        const { code, url } = cardCode(card, SELECTORS.search.link, loc || "https://www.hilton.com/")
        if (code && codes.has(code)) continue
        if (code) codes.add(code)
        const base = loc || "https://www.hilton.com/"
        const name = choosePropertyName(cardNameCandidates(card, code, SELECTORS.search.link, geo.nameByCode, base), code)
        const g = (code && geo.byCode.get(code)) || geo.byName.get(name.toLowerCase()) || {}
        const entries = collectEntries(card, SELECTORS.search.price, win)
        const c = {
          name, code, url: url || g.url, brand: cardBrand(card) || brandFromCode(code),
          lat: g.lat, lng: g.lng, soldOut: SOLD_OUT_RE.test(textOf(card)), entries,
        }
        result.observations.push(...buildCardObservations(c, ctx))
        result.debug.cards.push({ name: redact(name), code, brand: c.brand, soldOut: c.soldOut, entries: entries.map(debugEntry) })
      }
    }
    return result
  }

  /** Marriott results (or rate) page. Same output shape as the Hilton path. */
  function extractMarriott(doc, opts) {
    const win = doc.defaultView || null
    const loc = opts.url || ""
    const base = loc || "https://www.marriott.com/"
    const title = doc.title || ""
    const bodyText = doc.body ? norm(doc.body.innerText || doc.body.textContent).slice(0, 30000) : ""
    const pageKind = detectPageKind(loc)
    const blocked = detectBlocked({ title, text: bodyText, url: loc })
    const result = {
      extractorVersion: VERSION,
      pageKind,
      blocked,
      brand: "marriott",
      intent: opts.intent || null,
      auth: { signedIn: false, signedOut: false },
      goContext: false,
      observations: [],
      debug: { url: sanitizeUrl(loc), title: redact(title), cardSelector: null, cardCount: 0, cards: [] },
    }
    if (blocked) return result
    const M = MARRIOTT_SELECTORS
    // Marriott's F&F rate is a rate code on the search, not a member sign-in: never "signed-out".
    const ctx = { signedOut: false, goContext: false, brand: "marriott", intent: opts.intent }
    const geo = geoIndexFor(doc)
    const site = { codeAttrs: M.codeAttrs, codeFn: marriottCodeFromUrl, attrFn: marriottCodeFromAttr }

    if (pageKind === "ROOMS") {
      const code = marriottCodeFromUrl(loc)
      const nameCands = []
      for (const q of M.propertyName) for (const el of safeAll(doc, q).slice(0, 3)) nameCands.push(textOf(el))
      if (code && geo.nameByCode.get(code)) nameCands.push(geo.nameByCode.get(code))
      const name = choosePropertyName(nameCands, code)
      const g = (code && geo.byCode.get(code)) || geo.byName.get(name.toLowerCase()) || {}
      const found = findCards(doc, M.room.card, null)
      let cards = found.cards
      result.debug.cardSelector = found.selector
      if (!cards.length) {
        const main = safeOne(doc, "main") || doc.body
        cards = main ? [main] : []
        result.debug.cardSelector = "fallback:main"
      }
      result.debug.cardCount = cards.length
      const rooms = []
      for (const card of cards.slice(0, 40)) {
        const entries = collectEntries(card, M.room.price, win)
        const c = {
          name, code, brand: marriottBrandFromName(name), lat: g.lat, lng: g.lng, url: sanitizeUrl(loc),
          soldOut: SOLD_OUT_RE.test(textOf(card)), entries,
        }
        const cardCtx = Object.assign({}, ctx, { rateLabel: firstText(card, M.rateLabel) })
        rooms.push({ roomName: "", observations: buildCardObservations(c, cardCtx) })
        result.debug.cards.push({ name: redact(name), code, soldOut: c.soldOut, entries: entries.map(debugEntry) })
      }
      result.observations = reduceRoomObservations(rooms)
      return result
    }

    const found = findCards(doc, M.search.card, M.search.link, marriottCodeFromUrl)
    result.debug.cardSelector = found.selector
    result.debug.cardCount = found.cards.length
    const codes = new Set()
    for (const card of found.cards.slice(0, 60)) {
      const { code, url } = cardCode(card, M.search.link, base, site)
      if (code && codes.has(code)) continue
      if (code) codes.add(code)
      const name = choosePropertyName(cardNameCandidates(card, code, M.search.link, geo.nameByCode, base, M.search.name, marriottCodeFromUrl), code)
      const g = (code && geo.byCode.get(code)) || geo.byName.get(name.toLowerCase()) || {}
      const entries = collectEntries(card, M.search.price, win)
      const c = {
        name, code, url: url || g.url, brand: marriottBrandFromName(cardBrand(card)) || marriottBrandFromName(name),
        lat: g.lat, lng: g.lng, soldOut: SOLD_OUT_RE.test(textOf(card)), entries,
      }
      const cardCtx = Object.assign({}, ctx, { rateLabel: firstText(card, M.rateLabel) })
      result.observations.push(...buildCardObservations(c, cardCtx))
      result.debug.cards.push({ name: redact(name), code, brand: c.brand, soldOut: c.soldOut, entries: entries.map(debugEntry) })
    }
    return result
  }

  function debugEntry(e) {
    return { text: redact(e.text).slice(0, 60), struck: !!e.struck, label: redact(e.label || "").slice(0, 120), via: e.via }
  }

  /** Sanitized JSON for the popup's "Debug: copy page snapshot". No cookies, storage, or account details. */
  function snapshot(doc, opts) {
    const r = extractFromDocument(doc, opts)
    return {
      kind: "jp-go-rates-snapshot",
      extractorVersion: VERSION,
      takenAt: new Date().toISOString(),
      url: r.debug.url,
      title: r.debug.title,
      pageKind: r.pageKind,
      blocked: r.blocked,
      brand: r.brand,
      intent: r.intent,
      auth: r.auth,
      goContext: r.goContext,
      cardSelector: r.debug.cardSelector,
      cardCount: r.debug.cardCount,
      cards: r.debug.cards.slice(0, 30),
      observations: r.observations.map((o) => Object.assign({}, o, { propertyName: redact(o.propertyName) })),
      probe: quickProbe(doc, opts && opts.url),
    }
  }

  const api = {
    VERSION, SELECTORS, MARRIOTT_SELECTORS, CTYHOCN_BRANDS, MARRIOTT_BRANDS,
    TEAM_RE, PUBLIC_RE, TOTAL_RE, IGNORE_RE, SOLD_OUT_RE, NO_RESULTS_RE,
    parseMoney, parseAllMoney, stripMoney, codeFromUrl, brandFromCode, detectBlocked, detectPageKind,
    detectGoContext, sanitizeUrl, redact, classifyEntry, buildCardObservations, reduceRoomObservations, indexGeo,
    detectAuth, quickProbe, extractFromDocument, snapshot,
    isPlausibleName, choosePropertyName, cardNameCandidates,
    marriottCodeFromUrl, marriottCodeFromAttr, marriottBrandFromName, brandFromUrl, extractMarriott,
  }
  root.JPGoRatesExtract = api
  if (typeof module !== "undefined" && module.exports) module.exports = api
})(typeof globalThis !== "undefined" ? globalThis : this)
