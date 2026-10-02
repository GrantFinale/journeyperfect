/**
 * Hilton-specific browser driving: sign-in page, signed-in detection, rate
 * searches, and snapshot extraction.
 *
 * ── Selector assumptions ────────────────────────────────────────────────────
 * hilton.com is a React app behind Akamai bot management; its DOM is not
 * documented and changes. Everything we rely on is collected in HILTON below
 * so it can be updated in one place. Each entry is an ASSUMPTION until checked
 * against the live site:
 *
 *   signInUrl        Where an interactive sign-in session starts: the Go Hilton
 *                    team-member travel portal (/en/go-hilton/; hilton.com/go
 *                    301s here). The user signs in from there in the live view
 *                    (the portal links to the Honors / team-member login).
 *                    Verified public URL (2026-10-02, residential connection).
 *   honorsLoginUrl   The plain Honors login page, kept for reference/fallback.
 *   goHiltonPath     Path prefix of the Go Hilton portal. Being on it is NOT by
 *                    itself a signed-in signal (the landing page is public).
 *   accountUrl       Honors account dashboard; unauthenticated visitors are
 *                    redirected to signInUrl. Used to verify a sealed profile is
 *                    still signed in.
 *   signedInPath     After login Hilton lands on /hilton-honors/guest/...;
 *                    any URL under this path means signed in.
 *   signedIn[]       Header widgets that only render for a signed-in member
 *                    (account menu / "Hi, <first name>" / points balance). The
 *                    sign-out link is an ASSUMED marker that also covers the Go
 *                    Hilton portal, which uses the same site header; it only
 *                    counts while no sign-in link (signedOut[]) is present.
 *   roomsUrl         Room-selection page keyed by ctyhocn (Hilton property
 *                    code, e.g. CHIPDHH), arrivalDate/departureDate (YYYY-MM-DD),
 *                    room1NumAdults. These params are widely used deep-link
 *                    params.
 *   rateCodeParam    How a rate code is passed. `corporateCode` is Hilton's
 *                    corporate/"special rate" param; whether the Team Member
 *                    rate is unlocked by this param or by a different toggle is
 *                    NOT verified. Override via HILTON_RATE_CODE_PARAM.
 *   searchUrl        Location search results (`query` = free text; lat/lng
 *                    optional). Property links on this page carry `ctyhocn=`.
 *   room.*           Room cards on the rooms page: card container, room name,
 *                    price and total text, sold-out marker.
 *   search.*         Property cards on the search page.
 *
 * Extraction is defensive: selector lists are tried in order and fall back to
 * scanning card text for a money pattern. Numbers are assumed to use US
 * grouping ("1,234.56"). Brand falls back to the ctyhocn brand suffix.
 * ────────────────────────────────────────────────────────────────────────────
 */
import type { BrowserContext, Page } from "playwright"
import { detectChallenge, type PageSignals } from "./challenges.js"
import { parseHiltonResults, type HiltonSnapshot } from "./parse-hilton.js"
import type { ChallengeKind, HiltonCityRatesTask, HiltonRatesTask, RateObservation, RunnerResult } from "./types.js"

export const HILTON = {
  origin: "https://www.hilton.com",
  signInUrl: "https://www.hilton.com/en/go-hilton/",
  honorsLoginUrl: "https://www.hilton.com/en/hilton-honors/login/",
  goHiltonPath: "/go-hilton/",
  accountUrl: "https://www.hilton.com/en/hilton-honors/guest/my-account/",
  signedInPath: "/hilton-honors/guest/",
  loginPath: "/hilton-honors/login",
  roomsUrl: "https://www.hilton.com/en/book/reservation/rooms/",
  searchUrl: "https://www.hilton.com/en/search/",
  defaultAdults: 2,
  selectors: {
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
      total: ['[data-testid*="total" i]', '[class*="total" i]'],
      soldOut: /sold out|not available|unavailable|no rooms/i,
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
      name: ['[data-testid*="hotel-name" i]', '[data-testid*="hotelName" i]', "h2", "h3"],
      price: ['[data-testid*="price" i]', '[data-testid*="rate" i]', '[class*="price" i]', '[class*="rate" i]'],
      link: 'a[href*="ctyhocn="]',
      soldOut: /sold out|not available|unavailable|no rooms/i,
    },
    propertyName: ['[data-testid="hotel-name"]', 'h1[class*="hotel" i]', "h1", 'meta[property="og:title"]'],
    brand: ['meta[name="brand"]', '[data-testid="brand-logo"] img[alt]', 'img[alt*="logo" i]'],
  },
} as const

/** Hilton property codes end in a two-letter brand code. Best-effort map. */
export const CTYHOCN_BRANDS: Record<string, string> = {
  HH: "Hilton Hotels & Resorts",
  HI: "Hilton Hotels & Resorts",
  WA: "Waldorf Astoria",
  CI: "Conrad",
  LX: "LXR Hotels & Resorts",
  OL: "LXR Hotels & Resorts",
  QQ: "Curio Collection",
  UP: "Canopy by Hilton",
  SA: "Signia by Hilton",
  DT: "DoubleTree by Hilton",
  DI: "DoubleTree by Hilton",
  PY: "Tapestry Collection",
  ES: "Embassy Suites by Hilton",
  GI: "Hilton Garden Inn",
  HX: "Hampton by Hilton",
  HT: "Home2 Suites by Hilton",
  PE: "Home2 Suites by Hilton",
  HW: "Homewood Suites by Hilton",
  RU: "Tru by Hilton",
  UA: "Motto by Hilton",
  GV: "Hilton Grand Vacations",
  TR: "Tempo by Hilton",
  SN: "Spark by Hilton",
  GU: "Graduate by Hilton",
  ND: "NoMad",
  LW: "Small Luxury Hotels",
  AH: "AutoCamp",
}

export function brandFromCtyhocn(code: string): string | undefined {
  const suffix = code.trim().toUpperCase().slice(-2)
  return CTYHOCN_BRANDS[suffix]
}

export interface RateSearchParams {
  propertyCode: string
  checkIn: string
  checkOut: string
  rateCode?: string
  adults?: number
}

export function buildRoomsUrl(p: RateSearchParams, rateCodeParam = "corporateCode"): string {
  const u = new URL(HILTON.roomsUrl)
  u.searchParams.set("ctyhocn", p.propertyCode.trim().toUpperCase())
  u.searchParams.set("arrivalDate", p.checkIn)
  u.searchParams.set("departureDate", p.checkOut)
  u.searchParams.set("room1NumAdults", String(p.adults ?? HILTON.defaultAdults))
  if (p.rateCode) u.searchParams.set(rateCodeParam, p.rateCode.trim())
  return u.toString()
}

export interface LocationSearchParams {
  location: string
  lat?: number
  lng?: number
  checkIn: string
  checkOut: string
  rateCode?: string
  adults?: number
}

export function buildLocationSearchUrl(p: LocationSearchParams, rateCodeParam = "corporateCode"): string {
  const u = new URL(HILTON.searchUrl)
  u.searchParams.set("query", p.location.trim())
  u.searchParams.set("arrivalDate", p.checkIn)
  u.searchParams.set("departureDate", p.checkOut)
  u.searchParams.set("room1NumAdults", String(p.adults ?? HILTON.defaultAdults))
  if (typeof p.lat === "number" && typeof p.lng === "number" && Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
    u.searchParams.set("lat", String(p.lat))
    u.searchParams.set("lng", String(p.lng))
  }
  if (p.rateCode) u.searchParams.set(rateCodeParam, p.rateCode.trim())
  return u.toString()
}

// ── Page helpers ───────────────────────────────────────────────────────────

export async function openSignIn(context: BrowserContext): Promise<Page> {
  const page = context.pages()[0] ?? (await context.newPage())
  await page.goto(HILTON.signInUrl, { waitUntil: "domcontentloaded", timeout: 45_000 })
  return page
}

/**
 * URL-only part of the signed-in check: true under the Honors guest area,
 * false on a login page (Honors login or any hilton.com /login path, including
 * one reached from the Go Hilton portal), undefined when the URL alone cannot
 * tell (e.g. the public Go Hilton landing page) so the caller inspects the DOM.
 */
export function signedInFromUrl(url: string): boolean | undefined {
  let pathname: string
  try {
    pathname = new URL(url).pathname
  } catch {
    return false
  }
  if (pathname.includes(HILTON.signedInPath)) return true
  if (pathname.includes(HILTON.loginPath) || /\/login\/?$/.test(pathname)) return false
  return undefined
}

/**
 * Signed-in check on the CURRENT page (no navigation, so it is safe to call
 * while the user is driving the live view). URL under signedInPath, or any
 * signed-in header widget present while no sign-in link is.
 */
export async function isSignedIn(page: Page): Promise<boolean> {
  const byUrl = signedInFromUrl(page.url())
  if (byUrl !== undefined) return byUrl
  return page.evaluate(
    ({ signedIn, signedOut }) => {
      const has = (sels: readonly string[]) => sels.some((s) => document.querySelector(s) !== null)
      return has(signedIn) && !has(signedOut)
    },
    { signedIn: HILTON.selectors.signedIn, signedOut: HILTON.selectors.signedOut },
  )
}

/** Navigate to the account page and decide whether the sealed profile is still signed in. */
export async function verifySignedIn(page: Page, timeoutMs: number): Promise<boolean> {
  await page.goto(HILTON.accountUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs })
  await page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 15_000) }).catch(() => undefined)
  return isSignedIn(page)
}

/** PageSignals for detectChallenge. bodyText is truncated to 20k chars. */
export async function collectPageSignals(page: Page): Promise<PageSignals> {
  const signals = await page.evaluate(() => {
    const iframes = Array.from(document.querySelectorAll("iframe"))
      .map((f) => f.getAttribute("src") || "")
      .filter(Boolean)
    const fields = Array.from(document.querySelectorAll("input, select, textarea"))
      .map((el) => el.getAttribute("name") || el.getAttribute("id") || el.getAttribute("autocomplete") || "")
      .filter(Boolean)
    return {
      title: document.title || "",
      bodyText: (document.body?.innerText || "").slice(0, 20_000),
      hasIframeFrom: iframes,
      formFieldNames: fields,
    }
  })
  return { url: page.url(), ...signals }
}

// ── Snapshot extraction (runs inside the page; must be self-contained) ────

type RoomSelectors = {
  card: readonly string[]
  name: readonly string[]
  price: readonly string[]
  total: readonly string[]
  soldOutSource: string
}

export interface RoomsSnapshot extends HiltonSnapshot {
  /** The page as a whole says sold out / unavailable (so zero cards is a real answer). */
  soldOutPage: boolean
}

export async function extractRoomsSnapshot(page: Page): Promise<RoomsSnapshot> {
  const sel: RoomSelectors & { propertyName: readonly string[]; brand: readonly string[] } = {
    card: HILTON.selectors.room.card,
    name: HILTON.selectors.room.name,
    price: HILTON.selectors.room.price,
    total: HILTON.selectors.room.total,
    soldOutSource: HILTON.selectors.room.soldOut.source,
    propertyName: HILTON.selectors.propertyName,
    brand: HILTON.selectors.brand,
  }
  return page.evaluate((s) => {
    // NB: everything below executes in the browser; no outer-scope references.
    const MONEY = /(US\$|USD|CA\$|CAD|A\$|AUD|€|EUR|£|GBP|¥|JPY|\$)\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/
    const CURRENCY: Record<string, string> = {
      "US$": "USD", USD: "USD", "CA$": "CAD", CAD: "CAD", "A$": "AUD", AUD: "AUD",
      "€": "EUR", EUR: "EUR", "£": "GBP", GBP: "GBP", "¥": "JPY", JPY: "JPY", $: "USD",
    }
    const soldOut = new RegExp(s.soldOutSource, "i")
    const text = (el: Element | null): string => (el ? (el as HTMLElement).innerText || el.textContent || "" : "").trim()
    const firstIn = (root: ParentNode, sels: readonly string[]): Element | null => {
      for (const q of sels) {
        try {
          const el = root.querySelector(q)
          if (el && text(el)) return el
        } catch {
          // invalid selector on this engine; skip
        }
      }
      return null
    }
    const money = (t: string): { amount: number; currency: string } | null => {
      const m = MONEY.exec(t)
      if (!m) return null
      const amount = Number(m[2].replace(/,/g, ""))
      if (!Number.isFinite(amount)) return null
      return { amount, currency: CURRENCY[m[1]] || "USD" }
    }

    let cards: Element[] = []
    for (const q of s.card) {
      try {
        cards = Array.from(document.querySelectorAll(q))
      } catch {
        cards = []
      }
      if (cards.length) break
    }

    const rooms = cards.map((card) => {
      const cardText = text(card)
      const name = text(firstIn(card, s.name)) || cardText.split("\n")[0] || "Room"
      const priceEl = firstIn(card, s.price)
      const nightly = money(text(priceEl)) ?? money(cardText)
      const totalEl = firstIn(card, s.total)
      const total = totalEl ? money(text(totalEl)) : null
      const unavailable = soldOut.test(cardText) || nightly === null
      return {
        roomType: name.slice(0, 120),
        nightlyRate: nightly ? nightly.amount : null,
        totalRate: total ? total.amount : null,
        currency: nightly?.currency || total?.currency || "USD",
        available: !unavailable,
      }
    })

    const nameEl = firstIn(document, s.propertyName)
    const propertyName =
      (nameEl?.tagName === "META" ? nameEl.getAttribute("content") : text(nameEl)) || undefined
    let brand: string | undefined
    for (const q of s.brand) {
      const el = document.querySelector(q)
      const v = el?.getAttribute("content") || el?.getAttribute("alt")
      if (v) {
        brand = v.replace(/\s*logo\s*$/i, "").trim() || undefined
        break
      }
    }
    return { propertyName: propertyName?.trim(), brand, rooms, soldOutPage: soldOut.test(document.body?.innerText || "") }
  }, sel)
}

export interface SearchSnapshotEntry {
  propertyName: string
  propertyCode?: string
  propertyUrl?: string
  brand?: string
  nightlyRate: number | null
  currency: string
  available: boolean
  lat?: number
  lng?: number
}

export async function extractSearchSnapshot(page: Page, max: number): Promise<SearchSnapshotEntry[]> {
  const sel = {
    card: HILTON.selectors.search.card,
    name: HILTON.selectors.search.name,
    price: HILTON.selectors.search.price,
    link: HILTON.selectors.search.link,
    soldOutSource: HILTON.selectors.search.soldOut.source,
    max,
  }
  return page.evaluate((s) => {
    const MONEY = /(US\$|USD|CA\$|CAD|A\$|AUD|€|EUR|£|GBP|¥|JPY|\$)\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/
    const CURRENCY: Record<string, string> = {
      "US$": "USD", USD: "USD", "CA$": "CAD", CAD: "CAD", "A$": "AUD", AUD: "AUD",
      "€": "EUR", EUR: "EUR", "£": "GBP", GBP: "GBP", "¥": "JPY", JPY: "JPY", $: "USD",
    }
    const soldOut = new RegExp(s.soldOutSource, "i")
    const text = (el: Element | null): string => (el ? (el as HTMLElement).innerText || el.textContent || "" : "").trim()
    const firstIn = (root: ParentNode, sels: readonly string[]): Element | null => {
      for (const q of sels) {
        try {
          const el = root.querySelector(q)
          if (el && text(el)) return el
        } catch {
          // skip
        }
      }
      return null
    }
    const money = (t: string): { amount: number; currency: string } | null => {
      const m = MONEY.exec(t)
      if (!m) return null
      const amount = Number(m[2].replace(/,/g, ""))
      return Number.isFinite(amount) ? { amount, currency: CURRENCY[m[1]] || "USD" } : null
    }

    // JSON-LD often carries hotel name/url/geo; index by lower-cased name.
    const geoByName = new Map<string, { lat: number; lng: number; url?: string }>()
    for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
      try {
        const data = JSON.parse(script.textContent || "null")
        const items: unknown[] = Array.isArray(data) ? data : data && Array.isArray(data["@graph"]) ? data["@graph"] : [data]
        const visit = (node: unknown) => {
          if (!node || typeof node !== "object") return
          const n = node as Record<string, unknown>
          const geo = n.geo as Record<string, unknown> | undefined
          if (typeof n.name === "string" && geo && typeof geo.latitude !== "undefined") {
            const lat = Number(geo.latitude)
            const lng = Number(geo.longitude)
            if (Number.isFinite(lat) && Number.isFinite(lng)) {
              geoByName.set(n.name.trim().toLowerCase(), { lat, lng, url: typeof n.url === "string" ? n.url : undefined })
            }
          }
          for (const v of Object.values(n)) if (v && typeof v === "object") visit(v)
        }
        items.forEach(visit)
      } catch {
        // ignore malformed JSON-LD
      }
    }

    let cards: Element[] = []
    for (const q of s.card) {
      try {
        cards = Array.from(document.querySelectorAll(q))
      } catch {
        cards = []
      }
      if (cards.length) break
    }
    if (!cards.length) {
      // Fallback: every distinct link carrying a ctyhocn, walking up to a card-ish ancestor.
      const seen = new Set<Element>()
      for (const a of Array.from(document.querySelectorAll(s.link))) {
        let node: Element | null = a
        for (let i = 0; i < 4 && node && node.parentElement; i++) node = node.parentElement
        if (node && !seen.has(node)) {
          seen.add(node)
          cards.push(node)
        }
      }
    }

    const out: Array<{
      propertyName: string
      propertyCode?: string
      propertyUrl?: string
      brand?: string
      nightlyRate: number | null
      currency: string
      available: boolean
      lat?: number
      lng?: number
    }> = []
    const codes = new Set<string>()
    for (const card of cards) {
      if (out.length >= s.max) break
      const cardText = text(card)
      const link = card.querySelector(s.link) as HTMLAnchorElement | null
      let propertyCode: string | undefined
      let propertyUrl: string | undefined
      if (link) {
        try {
          const u = new URL(link.href, location.origin)
          propertyCode = u.searchParams.get("ctyhocn")?.toUpperCase() || undefined
          propertyUrl = u.toString()
        } catch {
          // ignore
        }
      }
      if (propertyCode && codes.has(propertyCode)) continue
      if (propertyCode) codes.add(propertyCode)
      const name = text(firstIn(card, s.name)) || cardText.split("\n")[0] || propertyCode || "Property"
      const priceEl = firstIn(card, s.price)
      const nightly = money(text(priceEl)) ?? money(cardText)
      const geo = geoByName.get(name.trim().toLowerCase())
      const brandImg = card.querySelector('img[alt*="logo" i]')
      out.push({
        propertyName: name.slice(0, 160),
        propertyCode,
        propertyUrl: propertyUrl ?? geo?.url,
        brand: brandImg?.getAttribute("alt")?.replace(/\s*logo\s*$/i, "").trim() || undefined,
        nightlyRate: nightly ? nightly.amount : null,
        currency: nightly?.currency || "USD",
        available: !(soldOut.test(cardText) || nightly === null),
        lat: geo?.lat,
        lng: geo?.lng,
      })
    }
    return out
  }, sel)
}

// ── Task runners ──────────────────────────────────────────────────────────

export interface TaskContext {
  /** Absolute epoch ms after which no further navigation may start. */
  deadlineAt: number
  rateCodeParam: string
  log?: { info(obj: Record<string, unknown>, msg?: string): void }
}

function remaining(ctx: TaskContext): number {
  return ctx.deadlineAt - Date.now()
}

function navTimeout(ctx: TaskContext): number {
  return Math.max(1_000, Math.min(45_000, remaining(ctx)))
}

/**
 * Navigate, give the app a moment to render, collect signals, classify.
 * Returns the challenge kind (NONE when the page looks like real content).
 */
export async function navigateAndClassify(
  page: Page,
  url: string,
  ctx: TaskContext,
  readyPredicate: { selectors: readonly string[]; textSource: string },
): Promise<{ challenge: ChallengeKind; signals: PageSignals }> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: navTimeout(ctx) })
  const settle = Math.max(1_000, Math.min(20_000, remaining(ctx)))
  await page
    .waitForFunction(
      ({ selectors, textSource }) => {
        const re = new RegExp(textSource, "i")
        const anySel = selectors.some((q) => {
          try {
            return document.querySelector(q) !== null
          } catch {
            return false
          }
        })
        return anySel || re.test(document.body?.innerText || "")
      },
      readyPredicate,
      { timeout: settle, polling: 500 },
    )
    .catch(() => undefined) // not ready in time: classify whatever rendered
  const signals = await collectPageSignals(page)
  return { challenge: detectChallenge(signals), signals }
}

const ROOMS_READY = {
  selectors: HILTON.selectors.room.card,
  textSource: `${HILTON.selectors.room.soldOut.source}|per night|\\/\\s?night|select (a |your )?room`,
}
const SEARCH_READY = {
  selectors: [...HILTON.selectors.search.card, HILTON.selectors.search.link],
  textSource: `${HILTON.selectors.search.soldOut.source}|per night|\\/\\s?night|hotels? found|results`,
}

/**
 * HILTON_RATES: one rooms-page visit per property, sequentially. Stops at the
 * first challenge (no retry) or when the deadline is reached, returning
 * whatever was retrieved so far as `data`.
 */
export async function runHiltonRatesTask(
  page: Page,
  task: HiltonRatesTask,
  ctx: TaskContext,
): Promise<RunnerResult<RateObservation[]>> {
  const rateKind = task.rateCode ? "PRIVATE_HILTON_GO" : "PUBLIC"
  const data: RateObservation[] = []
  let parseFailures = 0

  for (const prop of task.properties) {
    if (remaining(ctx) < 3_000) return { ok: false, status: "TIMEOUT", data }
    const url = buildRoomsUrl({ ...prop, rateCode: task.rateCode }, ctx.rateCodeParam)
    let challenge: ChallengeKind
    try {
      ;({ challenge } = await navigateAndClassify(page, url, ctx, ROOMS_READY))
    } catch (err) {
      if (isTimeoutError(err)) return { ok: false, status: "TIMEOUT", data }
      throw err
    }
    if (challenge !== "NONE") {
      // Hard rule: stop immediately, hand control back to the user, never retry.
      return { ok: false, status: "CHALLENGE", challengeKind: challenge, data }
    }

    const { soldOutPage, ...snapshot } = await extractRoomsSnapshot(page)
    if (snapshot.rooms.length === 0 && !soldOutPage) {
      parseFailures++
      ctx.log?.info({ propertyCode: prop.propertyCode }, "no room cards recognised")
      continue
    }
    const obs = parseHiltonResults(
      { ...snapshot, brand: snapshot.brand ?? brandFromCtyhocn(prop.propertyCode) },
      { propertyCode: prop.propertyCode, checkIn: prop.checkIn, checkOut: prop.checkOut, rateKind },
    )
    for (const o of obs) data.push({ ...o, propertyUrl: url })
  }

  if (parseFailures > 0 && data.length === 0) return { ok: false, status: "PARSE_FAILED", data }
  return parseFailures > 0 ? { ok: true, data, partial: true } : { ok: true, data }
}

/**
 * HILTON_CITY_RATES: one location-search visit; take up to maxProperties
 * properties from the results list. Rates come from the list's "from" price
 * (lowest nightly); totals are derived. Same challenge/deadline rules.
 */
export async function runHiltonCityRatesTask(
  page: Page,
  task: HiltonCityRatesTask,
  ctx: TaskContext,
): Promise<RunnerResult<RateObservation[]>> {
  const rateKind = task.rateCode ? "PRIVATE_HILTON_GO" : "PUBLIC"
  const max = Math.max(1, Math.min(50, task.maxProperties ?? 8))
  if (remaining(ctx) < 3_000) return { ok: false, status: "TIMEOUT", data: [] }

  const url = buildLocationSearchUrl(task, ctx.rateCodeParam)
  let challenge: ChallengeKind
  try {
    ;({ challenge } = await navigateAndClassify(page, url, ctx, SEARCH_READY))
  } catch (err) {
    if (isTimeoutError(err)) return { ok: false, status: "TIMEOUT", data: [] }
    throw err
  }
  if (challenge !== "NONE") return { ok: false, status: "CHALLENGE", challengeKind: challenge, data: [] }

  const entries = await extractSearchSnapshot(page, max)
  if (entries.length === 0) return { ok: false, status: "PARSE_FAILED", data: [] }

  const data: RateObservation[] = entries.map((e, i) => {
    const propertyCode = e.propertyCode ?? `UNKNOWN-${i + 1}`
    const [obs] = parseHiltonResults(
      {
        propertyName: e.propertyName,
        brand: e.brand ?? (e.propertyCode ? brandFromCtyhocn(e.propertyCode) : undefined),
        rooms: [{ roomType: "Lowest listed", nightlyRate: e.nightlyRate, totalRate: null, currency: e.currency, available: e.available }],
      },
      { propertyCode, checkIn: task.checkIn, checkOut: task.checkOut, rateKind },
    )
    const out: RateObservation = { ...obs }
    if (out.available) out.roomType = undefined
    if (typeof e.lat === "number") out.lat = e.lat
    if (typeof e.lng === "number") out.lng = e.lng
    if (e.propertyUrl) out.propertyUrl = e.propertyUrl
    return out
  })
  const unknownCodes = data.filter((d) => d.propertyCode.startsWith("UNKNOWN-")).length
  return unknownCodes > 0 ? { ok: true, data, partial: true } : { ok: true, data }
}

export function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || /Timeout \d+ms exceeded/.test(err.message))
}
