# Flights: search, price tracking, AI trip proposals, and booking

**Status:** proposal, not yet approved
**Author:** drafted 2026-09-10
**Scope:** add flight discovery, price tracking, and booking handoff to JourneyPerfect, plus an agentic "idea → costed options" planner.

---

## 1. Why now, and what's actually true

Three claims motivated this plan. Two hold up. One needs reframing before we build on it.

### 1.1 Google really has no flights API — and that gap is permanent by choice

Google killed **QPX Express on 10 April 2018**, citing "low interest among our travel partners," and has shipped no replacement. There is no key to request and no self-serve developer program. The ITA fare engine behind Google Flights is enterprise-only, reachable through curated partner agreements with airlines and large sellers.

What Google *has* shipped since is consumer- and agent-facing, never developer-facing:

| Date | What shipped |
|---|---|
| Aug 2025 | Flight Deals — natural-language fare search (US/CA/IN) |
| Nov 2025 | Flight Deals goes global (200+ countries) |
| Nov 2025 | Agentic booking in AI Mode, partners: Booking.com, Expedia, Marriott, IHG, Choice, Wyndham |
| Aug 2026 | AI Mode gains flight **price tracking** in 180+ countries, award/points pricing, and booking completion |

The observation that Gemini points developers at third-party scrapers is consistent with reality, though I found no primary source for that specific output. Scraper vendors genuinely are the de facto answer the whole industry gives.

### 1.2 The 2026 development that changes our options: Amadeus pulled the ladder up

This is the most important fact in this document and it postdates most advice you will find online.

Amadeus announced in **February 2026** that it is decommissioning its Self-Service developer portal. New registrations paused in spring 2026 and the portal was **fully decommissioned on 17 July 2026, with existing API keys deactivated**. Only enterprise contracts remain.

Amadeus Self-Service was the standard recommendation for exactly our use case: Flight Offers Search, Flight Price Analysis, Cheapest Date, and Create Orders on a free tier. **That path is closed.** Any plan or tutorial recommending it is now stale.

### 1.3 The acquisition thesis needs reframing

The instinct is that Google must be looking for partners to reimplement flights, and that this is one of the last services they never opened up. The premise is right; the inference does not follow.

Google acquired ITA Software in 2010 and owns the fare engine outright. The absent API is a deliberate strategic decision to keep fare data inside their surfaces, not a capability gap waiting for a partner to fill. And their announced agentic partners are distribution incumbents like Booking and Expedia, chosen for inventory and merchant-of-record status. A planning app does not fill either need.

More pointedly: **Google shipped flight price tracking natively in AI Mode in August 2026.** If we build only price tracking, we are building a feature Google now gives away, at global scale, for free.

So the strategy below deliberately does not compete on fare discovery. It treats flights as an input into the thing Google's AI Mode cannot hold: the **structured trip graph** that JourneyPerfect already owns. Itinerary items, reservations, outstanding tasks, attachments, traveler profiles, and multi-party collaboration. Google can find you a fare. It cannot tell your spouse that the ferry booking still has no confirmation number.

The strategic asset worth building toward an acquisition or partnership is that graph plus **agent-writable access to it** (§7).

---

## 2. What exists in the codebase today

The good news is that most of the scaffolding is already here.

| Capability | Where | Reusable? |
|---|---|---|
| `Flight` model with `price`, `priceCurrency`, `bookingLink` | [prisma/schema.prisma](../../prisma/schema.prisma) | Yes — keep as the *booked* record |
| `ItineraryItem` with `needsReservation` + `Reservation` | same | Yes — accepted offers land here |
| Outstanding-task logic, pure and tested | [src/lib/trip-tasks.ts](../../src/lib/trip-tasks.ts) | Yes — the template for new pure modules |
| External API call pattern with DB-stored key | [src/lib/actions/flight-alerts.ts](../../src/lib/actions/flight-alerts.ts) (AviationStack) | Yes — copy this shape |
| Runtime config with admin UI | [src/lib/config.ts](../../src/lib/config.ts), `/admin/settings` | Yes — all new keys go here |
| Affiliate deep links (Awin/Booking, Viator, GetYourGuide) | [src/lib/affiliates.ts](../../src/lib/affiliates.ts) | Yes — **no flight partner yet** |
| AI via OpenRouter, model IDs in DB, usage logged | [src/lib/flight-parser-ai.ts](../../src/lib/flight-parser-ai.ts), [src/lib/ai-usage.ts](../../src/lib/ai-usage.ts) | Partly — single-shot only, no tool loops |
| IATA airport data (500+ records) | [src/lib/airports.ts](../../src/lib/airports.ts) | Yes |
| Plan gating | [src/lib/features.ts](../../src/lib/features.ts), [src/lib/plans.ts](../../src/lib/plans.ts) | Yes |
| Notifications with a `"flight_alert"` type | schema line ~706 | Yes — already reserved |

**The gap.** Flights only enter the app *after* you have booked them, by pasting a confirmation email into trip settings ([trip-settings-view.tsx:580](<../../src/app/(app)/trip/[tripId]/settings/trip-settings-view.tsx>)). There is no flight *discovery*. Everything before the booking happens in someone else's product.

**Two missing pieces of infrastructure:**
1. **No background job runner.** No cron, no queue. Deployment is a Docker container on Coolify on the `benedict-ventures` droplet (moved off DigitalOcean App Platform 2026-09-23) whose [docker-entrypoint.sh](../../docker-entrypoint.sh) runs migrations then `server.js`. Price tracking cannot exist without solving this first. Coolify makes the cron trigger simpler than first drafted: a scheduled task in the same Coolify project can hit the route, so GitHub Actions is optional.
2. **No agent/tool-calling loop.** Every AI feature is a single prompt returning JSON.

---

## 3. Choosing data sources

### 3.1 The landscape as of September 2026

| Source | Search | Live price | History | Booking | Cost | ToS risk | Node |
|---|---|---|---|---|---|---|---|
| Amadeus Self-Service | — | — | — | — | **portal dead 2026-07-17** | — | — |
| **Duffel** | Yes (NDC) | Yes | No | **Yes, full** | $3/order + 1% order value, $0.005/search beyond a 1500:1 look-to-book ratio, 2% FX | Low, sanctioned | Official `@duffel/api` TS SDK |
| **SerpApi Google Flights** | Yes | Yes | **Yes** (Price Insights) | No, links out | Free 250/mo; $25/mo = 1k; $275/mo = 30k | **Medium-high** | Official `serpapi` npm |
| **Travelpayouts Data** | Cached | No (7-day stale) | Yes (calendars) | No, affiliate link | Free with affiliate account | Low | Plain JSON |
| Kiwi Tequila | Yes | Yes | Partial | Yes | Invite-only since ~2024 | Low if approved | REST |
| Skyscanner Partner | Yes | Yes | No | Referral | Rev-share | Low if approved | REST |
| Bright Data / Apify | Yes | Yes | No | No | ~$0.75/1k and ~$0.0003/search | High | REST / TS client |
| Seats.aero | Award | Award | No | No | $9.99/mo, **personal use only** | High if commercial | REST |

Skyscanner requires "an established business with a large audience" and Expedia TAAP requires IATA/ARC/CLIA credentials. Both are effectively closed to us today.

### 3.2 The known risk with SerpApi

Google sued SerpApi in N.D. Cal. on **19 December 2025** under DMCA §1201 anti-circumvention. On **20 July 2026 the court granted SerpApi's motion to dismiss**, holding the DMCA cannot protect uncopyrighted search results. Google filed an amended complaint on **10 August 2026** on a narrower content-licensing theory. Litigation is ongoing.

This matters because the usual mitigation — "use a vendor so the vendor carries the ToS relationship" — is weakened when the vendor is precisely who Google sued. Separately, `google.com/robots.txt` explicitly disallows `/travel/flights/search`, `/travel/flights/s/`, `/travel/flights/booking`, and `/travel/clk`.

**This does not block us, but it dictates the architecture: every provider must be swappable by config, never by code change.** See §4.2. None of this is legal advice; a lawyer should review before we go to paid scale.

### 3.3 Decision

A three-tier split by job, not a single vendor:

1. **Discovery and price history → SerpApi Google Flights.** It is the only affordable source that returns Google's own Price Insights (low/typical/high plus typical range). Start on the free 250/month tier during development.
2. **Booking → Duffel.** The only credible self-serve path to real bookings now that Amadeus is gone. Native TypeScript SDK, and Duffel Payments acts as merchant of record so we need no travel accreditation. Deferred to Phase 4.
3. **Monetization and inspiration → Travelpayouts.** Free, no traffic minimum, near-instant approval. Powers affiliate deep links and cheap fare calendars.

**Do not** build anything that talks to Google directly, and do not use Seats.aero commercially without a written agreement.

### 3.4 Open source worth borrowing from

We should not fork wholesale, but three repos are worth reading before writing our provider layer:

| Repo | Why | Last activity |
|---|---|---|
| [affromero/flight-finder](https://github.com/affromero/flight-finder) | TypeScript, Next.js, Prisma, Playwright. Scheduled trackers, target-price and new-low alerts. Closest thing to our Phase 2 already built. MIT, 149★ | 2026-09-08 |
| [punitarani/fli](https://github.com/punitarani/fli) | Cleanest `tfs` protobuf encoder, HTTP-only with no browser. Ships an **MCP server** — read this for §7. MIT, 3.1k★ | 2026-05-29 |
| [AWeirdDev/flights](https://github.com/AWeirdDev/flights) | Most battle-tested parser, exposes Google's `price_insights`. Python-only, so reference not dependency. MIT, 2.0k★ | 2026-08-31 |

Avoid the npm trap: `google-flights-api` wraps the dead QPX Express and was last published in 2017. The TypeScript ports (`@punitarani/fli`, `fast-flights-ts`, `google-flights-ts`) are all 1-star and immature. Note also that fli's README names its npm package `fli-js`, which 404s; the real name is `@punitarani/fli`.

Direct scraping from our own servers additionally needs residential proxying because Google blocks datacenter IPs, which is a second reason to pay a vendor rather than self-host the scrape.

---

## 4. Architecture

### 4.1 Data model

New models in [prisma/schema.prisma](../../prisma/schema.prisma). `Flight` stays exactly as it is and continues to mean "a flight you have booked."

```prisma
/// A route the user is shopping for. Becomes a price watch when isTracking.
model FlightSearch {
  id            String    @id @default(cuid())
  userId        String
  tripId        String?              // null = speculative, not yet tied to a trip
  origin        String               // IATA
  destination   String               // IATA
  departDate    DateTime  @db.Date
  returnDate    DateTime? @db.Date
  cabin         String    @default("economy")
  adults        Int       @default(1)
  children      Int       @default(0)
  maxStops      Int?
  isTracking    Boolean   @default(false)
  targetPrice   Float?               // notify at or below
  currency      String    @default("USD")
  lastCheckedAt DateTime?
  lastPrice     Float?
  lowestPrice   Float?               // best ever seen, for "new low" alerts
  queryHash     String               // normalised key, dedupes cache + provider calls
  // relations, timestamps, @@index([userId]), @@index([tripId]), @@index([queryHash])
}

/// One option a provider returned. Snapshot, not live.
model FlightOffer {
  id           String   @id @default(cuid())
  searchId     String
  provider     String                // "serpapi" | "duffel" | "travelpayouts"
  providerRef  String?               // Duffel offer id, needed to book
  totalPrice   Float
  currency     String
  carrierCodes String[]
  stops        Int
  durationMins Int
  outbound     Json                  // normalised FlightSegment[]
  inbound      Json?
  bookingUrl   String
  capturedAt   DateTime @default(now())
  expiresAt    DateTime?             // Duffel offers expire; SerpApi ones just go stale
}

/// One price sample. Drives the history chart and drop detection.
model FlightPricePoint {
  id        String   @id @default(cuid())
  searchId  String
  price     Float
  currency  String
  provider  String
  insight   Json?                    // Google's low/typical/high band when available
  capturedAt DateTime @default(now())
  // @@index([searchId, capturedAt])
}
```

Add `flightSearches` relations to `Trip` and `User`.

**Why store history ourselves rather than lean on the provider:** it makes provider churn survivable, it is the one dataset we accumulate that a competitor cannot buy, and it lets us answer "is this a good price *for this user's route*" rather than Google's generic band.

### 4.2 Provider abstraction

This is the single most important design decision, given §3.2.

```
src/lib/flights/
  types.ts                 FlightQuery, FlightItinerary, FlightSegment, PriceInsight, ProviderResult
  provider.ts              interface FlightProvider { search(); supportsBooking; ... }
  providers/serpapi.ts
  providers/duffel.ts
  providers/travelpayouts.ts
  index.ts                 getFlightProvider() reads getConfig("flights.provider", "serpapi")
  cache.ts                 Postgres-backed, keyed on queryHash, TTL from config
  pricing.ts               PURE: priceVerdict(), shouldAlert(), isNewLow()
  deeplinks.ts             PURE: googleFlightsUrl(), travelpayoutsUrl(), airlineUrl()
```

Rules for this layer:
- **Nothing outside `src/lib/flights/` may know which provider is active.** Swapping vendors must be an `/admin/settings` change, not a deploy.
- API keys go through `getConfig("api.serpapi.key", "")`, matching the AviationStack precedent, so they are rotatable without a redeploy.
- `pricing.ts` and `deeplinks.ts` are pure with no Prisma imports, following the [trip-tasks.ts](../../src/lib/trip-tasks.ts) convention, so client components can use them and Vitest can test them directly.
- **Cache before every provider call**, TTL default 6 hours, keyed on `queryHash`. This is simultaneously the cost control, the rate-limit defence, and the good-citizen ToS posture. It also keeps Duffel's 1500:1 look-to-book ratio satisfiable later.

Deep links use the simple, stable Google Flights form rather than the protobuf one:

```
https://www.google.com/travel/flights?q=Flights%20to%20JFK%20from%20LAX%20on%202026-12-01&curr=USD
```

The `?tfs=<base64url protobuf>` form carries more fidelity (cabin, stops, passengers, multi-city) and is worth adding later, but the `?q=` form is what maintained code uses and it will not break.

### 4.3 Background jobs

We must build this first because Phase 2 depends on it, and there is currently nothing.

- `src/app/api/cron/flight-prices/route.ts`, `export const dynamic = "force-dynamic"`, guarded by a `CRON_SECRET` bearer token.
- Triggered by a **GitHub Actions scheduled workflow** (free, no new infrastructure, and the repo has no `.github/workflows` yet so this is a clean addition). The droplet crontab is the fallback if we want it off GitHub.
- The route iterates active watches in batches, respects per-plan caps, writes a `FlightPricePoint` per watch, and on a qualifying drop creates a `Notification` of the existing `"flight_alert"` type plus an email via [src/lib/email.ts](../../src/lib/email.ts).
- Daily by default, configurable via `flights.checkIntervalHours`. Daily is enough: fares do not move minute to minute, and every extra run multiplies SerpApi spend.

### 4.4 UI

```
src/app/(app)/trip/[tripId]/flights/
  page.tsx                 server component, loads searches + latest offers
  flights-view.tsx         search form + results, patterned on discover/
  flight-offer-card.tsx    one option: price, carriers, stops, duration, book button
  price-history-chart.tsx  sparkline over FlightPricePoint
  track-price-button.tsx   toggles isTracking, sets targetPrice
```

Entry points:
- Nav item in [src/components/app-shell.tsx](../../src/components/app-shell.tsx) between Plan and Map, using the `Plane` lucide icon, following the existing `TRIP_NAV_PRIMARY` pattern.
- Trip Overview: if the trip has an origin, destination and dates, show a one-click "Find flights" card.
- To Do screen: a trip with no `Flight` rows but with dates and an origin should surface "No flights booked yet."

**Accepting an offer must go through the existing path**, creating a `Flight` plus an `ItineraryItem` of type `FLIGHT` via [src/lib/actions/flights.ts](../../src/lib/actions/flights.ts), so `needsReservation`, the To Do badge, the red-timeline state, and calendar export all keep working with zero changes.

### 4.5 Gating

Add to [features.ts](../../src/lib/features.ts):

```ts
flightSearch:        { name: "Flight Search",         minPlan: "PERSONAL" },
flightPriceTracking: { name: "Flight Price Tracking", minPlan: "PERSONAL" },
aiTripProposals:     { name: "AI Trip Proposals",     minPlan: "FAMILY"   },
```

Add a `maxFlightWatches` limit read through `getDynamicPlanLimits()`, defaulting to 0 free / 3 Personal / 10 Family / 50 Pro. Watches carry recurring cost, so this cap is the primary spend control and must be tunable from `/admin/settings` without a deploy.

---

## 5. The differentiated piece: idea → costed options

This is the part of the original idea worth the most, and the part Google's AI Mode does not do. AI Mode answers a fare question. It does not return three complete, costed, bookable trip shapes that drop into a real itinerary.

**"Ten days in Portugal in May, two adults, mid-range" → three variants, each fully costed and acceptable in one click.**

Implementation, in `src/lib/actions/trip-proposal-ai.ts`:

- The app's first genuine **tool-calling loop** over OpenRouter, rather than another single-shot prompt.
- Tools exposed to the model, nearly all wrapping code that already exists:

  | Tool | Backed by |
  |---|---|
  | `resolveDestination` | Google Places, [activities.ts](../../src/lib/actions/activities.ts) |
  | `searchFlights` | new provider layer (§4.2) |
  | `getFareCalendar` | Travelpayouts, for "which week is cheapest" |
  | `suggestActivities` | existing [ai-picks.ts](../../src/lib/actions/ai-picks.ts) |
  | `findStays` | affiliate search, [affiliates.ts](../../src/lib/affiliates.ts) |
  | `estimateBudget` | existing [costs.ts](../../src/lib/actions/costs.ts) |

- Output is a `TripProposal`: 2-3 variants along a real axis such as cheapest, fastest, and best value, each with a flight option, lodging estimate, activity shortlist, and a total.
- New config key `ai.tripPlannerModel`, defaulting to a stronger model than the `anthropic/claude-haiku-4.5` used for parsing, since this is multi-step reasoning. Log through the existing `logAIUsage` with feature `"trip_proposal"`.
- **Hard guards:** max 12 tool iterations, a per-proposal token budget, and a per-user daily cap. An unbounded agent loop against paid APIs is the one way this feature becomes expensive by accident.

Accepting a variant creates a real `Trip` with `Flight`, `Activity` and `BudgetItem` rows, so the proposal is an on-ramp to the existing product rather than a parallel universe.

---

## 6. Money

Be clear-eyed: **flights are not the revenue.**

| Category | Typical commission |
|---|---|
| Flights | 1.1–1.5% via Travelpayouts, roughly $5–10 on a $500 ticket |
| Hotels | 4–5% of network revenue, often 4–8% gross |
| Activities, insurance, fintech add-ons | Higher still |

Hopper's actual margin is service fees and fintech products like price freeze, not ticket commission. Going sells a $49/year subscription and links out.

So flights should be justified as a **retention and conversion feature** that pulls users into the paid tiers and pulls the pre-booking phase of the trip inside JourneyPerfect. Once a user searches flights here, the hotel, car, and activity bookings that actually pay follow. Joining Travelpayouts is worth doing anyway since it is free and instant, but the revenue line to model is upgrades to Personal and Family, not flight commission.

---

## 7. The strategic play, if the partnership thesis is to go anywhere

Rather than pitching flight data to a company that owns ITA Software, make JourneyPerfect the **trip system of record that external agents write into**.

Ship an **MCP server** exposing the trip graph as tools: `create_trip`, `add_flight`, `add_reservation`, `list_outstanding_tasks`, `get_itinerary`. Then a user talking to Gemini, ChatGPT, or Claude can say "add that flight to my Portugal trip" and it lands here, with the confirmation number, the check-in window, and the To Do state intact.

Why this is the right shape:
- It rides the agentic wave Google announced in November 2025 instead of competing with it.
- It requires no business development deal and no accreditation. Anyone can publish an MCP server today.
- It inverts the dependency. Rather than us needing Google's fare data, Google's agent needs somewhere to put the booking.
- `punitarani/fli` already ships an MCP server for flight search, which is a working reference for the pattern.

The acquirable asset is the graph plus the agent interface, not a fare scraper.

---

## 8. Phasing

| Phase | Scope | Est. | Ships value |
|---|---|---|---|
| **0** | Cron route + `CRON_SECRET` + GitHub Actions schedule. Provider abstraction skeleton with types and cache. | 2–3 days | No, but unblocks everything |
| **1** | SerpApi provider, flight search UI, deep-link handoff, accept-offer into `Flight` + `ItineraryItem`. | 1–2 weeks | **Yes — search inside JourneyPerfect** |
| **2** | Price tracking: `isTracking`, cron re-pricing, history chart, `flight_alert` notifications and email. | 1 week | **Yes — the retention hook** |
| **3** | AI trip proposals: tool-calling loop, 2–3 costed variants, accept into a real trip. | 2–3 weeks | **Yes — the differentiator** |
| **4** | Duffel: real in-app booking, merchant of record, order management. | 2–3 weeks | Only if Phase 1–2 volume justifies it |
| **5** | Travelpayouts affiliate links, fare calendars, inspiration rows in Discover. | 3–4 days | Revenue |
| **6** | MCP server exposing the trip graph. | 1 week | Strategic |

Phases 1 and 2 are the minimum coherent product. Phase 3 is where this stops being a commodity. Phase 4 should not start until we know people actually book.

---

## 9. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| SerpApi enjoined or killed by ongoing Google litigation | Medium | Provider abstraction (§4.2) makes swapping a config change. Keep Travelpayouts wired as a live fallback. |
| Per-search cost runs away | Medium | 6-hour cache, per-plan watch caps, daily not hourly checks, all tunable from `/admin/settings`. |
| Google AI Mode's free price tracking makes ours redundant | **High** | Do not compete on tracking alone. The value is tracking *attached to a trip that already exists here* with tasks, travelers, and reservations. Phase 3 is the real answer. |
| AI proposal loop burns tokens unpredictably | Medium | Iteration cap, token budget, per-user daily cap, `logAIUsage` monitoring from day one. |
| Scraped prices go stale and a user trusts a wrong number | Medium | Label every price as indicative with a captured-at timestamp, always deep-link out to confirm before booking. |
| Flight commissions never cover API spend | **High, expected** | Treat flights as a conversion feature (§6). Track upgrade rate, not commission. |
| Legal exposure from scraped data | Low-medium | Vendor relationship rather than self-scraping, aggressive caching, never re-expose prices as a public API or bulk feed, no reproduction of Google branding or UI. Get counsel before paid scale. |

---

## 10. Open questions for the founder

1. **Budget ceiling for flight data per month?** This decides SerpApi tier and watch caps. The $25/month 1,000-search tier supports roughly 30 tracked routes checked daily.
2. **Is booking in-app actually wanted, or is deep-link handoff enough?** Phase 4 is the single largest chunk of work and carries support obligations like cancellations and schedule changes. Handoff may be permanently sufficient.
3. **Should flight search be available to FREE users as an acquisition hook**, rather than gated at PERSONAL as proposed in §4.5?
4. **Appetite for the MCP server (§7)?** It is a week of work with no direct revenue and the highest strategic upside in this document.
