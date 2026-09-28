# Opportunity Discovery Engine, with Private Rates (Hilton Go)

**Status:** proposal, not yet approved
**Drafted:** 2026-09-27
**Builds on:** [flights-search-tracking-and-booking.md](./flights-search-tracking-and-booking.md) (the flights plan). Read that first; this document reuses its provider layer, its `FlightSearch` / `FlightOffer` models, and its AI tool loop.

> **Assumption to confirm.** The spec this plan implements refers to a "previously described Private Rates destination-discovery capability" and to prior requirements on feature flags, entitlements, Hilton authentication, Playwright session isolation, caching, security, graceful failure, provider abstraction and no public exposure. **None of that exists in this repo, in git history, or in this session.** Section 6 reconstructs those requirements from the spec's own wording and states each one explicitly. If a fuller Private Rates document exists elsewhere, reconcile section 6 against it before building.

---

## 1. The product shift

JourneyPerfect today starts from a destination: tell me where you want to go and I'll help plan it. Every screen is scoped to a `Trip`.

The Opportunity Discovery Engine starts from constraints instead: tell me when you're free, who's traveling, and what you'd enjoy, and I'll find the unusually good opportunities. It answers questions like:

- "We have a free 3- or 4-day weekend sometime in the next six weeks. Given our private hotel rates, nonstop flights, family airfare, weather and what we'd actually enjoy, show me the unusually good options."
- "Where does my Hilton Go access give us an incredible deal?"
- "Somewhere warm, nonstop, with a great resort deal."
- "Find me something I wouldn't have thought of."

The core principle is temporal. We never ask "is this a good place?" We ask **"is there something unusually compelling about this destination on these dates?"** A $1,000-a-night resort available privately at $75 is a more interesting opportunity than a $175 hotel available at $65, even though the second is cheaper. The value of the experience unlocked is what we score.

This is also the first surface in the app that exists *before* a trip does. That has architectural consequences (section 4.5).

---

## 2. What this reuses

| Need | Existing asset | Notes |
|---|---|---|
| Airfare, nonstop detection, price history | `FlightSearch`, `FlightOffer`, `FlightPricePoint`, `src/lib/flights/` provider layer | From the flights plan. Not built yet. This plan's Phase B depends on flights Phase 1. |
| Traveler ages and interests | `TravelerProfile.birthDate`, `tags[]`, `preferences Json` ([schema.prisma:97](../../prisma/schema.prisma)) | No children-ages field. Derive age from `birthDate`, fall back to the `"child"` tag. Preferences carry `activities` ratings, `pace`, `budgetComfort`, `mobility`. |
| Household defaults | `UserPreferences` | `airportArrivalBufferMins`, `pacingStyle`, `avgDailyBudget`, `activityMix[]`, `maxDailyTravelMins` |
| Origin | `User.homeLat/homeLng`, `Trip.origin*` | Home address already prefills a new trip's origin |
| Weather, 16-day horizon | [src/lib/weather.ts](../../src/lib/weather.ts) | Open-Meteo, free, no key. Beyond 16 days we need the Open-Meteo climate endpoint, labelled historical (section 4.3) |
| Door-to-door estimation | [src/lib/departure-planner.ts](../../src/lib/departure-planner.ts) | Haversine-only: check-in buffers by mode, walk/drive/rideshare speeds, `computeLeaveBy()`. No routing API, no parking, no security wait |
| Activity discovery | Google Places via [activities.ts](../../src/lib/actions/activities.ts), `ai-picks.ts` | Already filters by city and distance from hotel |
| Hotel and car handoff | [affiliates.ts](../../src/lib/affiliates.ts) | Booking.com via Awin |
| Runtime flags and keys | [config.ts](../../src/lib/config.ts), `/admin/settings` | App-wide only. Per-user entitlement does not exist and must be added (section 6.2) |
| Plan gating | [features.ts](../../src/lib/features.ts), [plans.ts](../../src/lib/plans.ts) | Tier-based only |
| AI tool loop | flights plan §5 | Not built yet. Phase E here |

**Hosting note.** JourneyPerfect moved from DigitalOcean App Platform to Coolify on the `benedict-ventures` droplet on 2026-09-23. That matters here: the browser runner in section 6 deploys as a second Coolify service in the same project rather than a sidecar in the Next.js container.

---

## 3. Architecture: a bounded, staged pipeline

The spec's hardest constraint is "do not blindly search every city, date and property." Everything below follows from treating the search as a **funnel with cost tiers**. Free knowledge prunes first; paid APIs run only on survivors; private, rate-limited sources run last, only on the final shortlist, and only after the user explicitly authorises them.

```
User request ─────────────────────────────────────────────────────────────┐
  dates window · nights · travelers · constraints · origin                 │
                                                                           ▼
STAGE 0  Bound the space                        no external calls
  ├─ candidate destinations  ← NonstopRoute table for origin airport(s)
  └─ candidate date windows  ← DateCandidateGenerator (cap: 6)
                                                                           ▼
STAGE 1  Free factors                            no paid calls
  ├─ trip-length fit         ← DestinationProfile
  ├─ family activity fit     ← DestinationProfile × TravelerProfiles
  ├─ anchor experience       ← DestinationProfile seasonal + Events API (free tier)
  ├─ weather                 ← Open-Meteo forecast (≤16d) or climate (historical, labelled)
  ├─ ground friction         ← DestinationProfile (walkable, car needed, airport distance)
  └─ door-to-door estimate   ← departure-planner + NonstopRoute duration
  → prune to ≤ N destinations × ≤ M dates            (config caps)
                                                                           ▼
STAGE 2  Cheap paid factors                      flights provider layer
  ├─ airfare for whole party, nonstop-only first  ← FlightSearch/FlightOffer (cached 6h)
  └─ airfare outlier vs other date candidates + route history
  → prune to shortlist                                (config cap)
                                                                           ▼
STAGE 3  Private factors                         EXPLICIT USER ACTION REQUIRED
  ├─ Hilton Go private rate                       ← user's own browser session
  └─ comparable public rate, same property/dates  ← same session, no rate code
                                                                           ▼
STAGE 4  Score, detect outliers, explain
  └─ TravelOpportunity rows with opportunityReasons[] and headlineFactor
                                                                           ▼
Shortlist UI  →  "Build This Trip"  →  Trip + Hotel + Flight + Activities
```

Three rules make this safe:

1. **Every stage is idempotent and resumable.** Each `OpportunityCandidate` records its `stage`. A search interrupted at stage 2 resumes at stage 2. Stage 3 never runs unless `OpportunitySearch.privateRatesAuthorizedAt` is set by a user click in that session.
2. **Every cap is a config key**, editable at `/admin/settings` without a deploy: `opportunities.maxDestinations` (12), `maxDateCandidates` (6), `maxAirfareLookups` (24), `maxPrivateRateLookups` (8), `perUserDailySearches` (5).
3. **The user initiates every run.** There is no scheduler, no cron, no "keep looking." The flights plan's cron route is for flight watches and is not reused here.

---

## 4. Factor evaluators

Each factor is a **pure module** under `src/lib/opportunities/factors/`, following the [trip-tasks.ts](../../src/lib/trip-tasks.ts) convention: no Prisma, narrow input types, Vitest-tested. Each returns the same shape:

```ts
interface FactorResult {
  kind: FactorKind               // "hotelValue" | "nonstop" | "airfare" | "doorToDoor" | ...
  available: boolean             // false = we could not evaluate; never fabricate
  score: number | null           // 0..1 for internal ranking only
  source: "RETRIEVED" | "ESTIMATED" | "HISTORICAL" | "UNKNOWN"
  retrievedAt?: string
  facts: Record<string, number | string | boolean>   // what the UI shows
  reasons: OpportunityReason[]   // human-readable, only when notable
}

interface OpportunityReason {
  factor: FactorKind
  headline: string               // "$2,400 hotel savings"
  detail?: string                // "Conrad Orlando, private $79 vs public $925/night"
  magnitude: number              // how far from baseline, drives outlier detection
  polarity: "POSITIVE" | "NEGATIVE"
}
```

The `source` field is how we honour "do not manufacture precision." The UI renders it as a label on every number. A historical weather average never appears without the word *typical*.

### 4.1 Hotel value (stage 3, private)

Inputs: private nightly rate, comparable public rate for the same property and dates, property brand tier, amenities from `DestinationProfile` or the Hilton page.
Baseline: the public rate. Signals: `savingsTotal`, `savingsRatio`, `unlockedTier` (whether private access moves the party from a mid-tier to a luxury property).
The score weights `unlockedTier` above raw savings, which is what makes the $75 Conrad beat the $65 Hampton.

### 4.2 Nonstop access and airfare (stage 2)

Inputs: `FlightOffer` rows for the party size, filtered `stops = 0` first.
Facts: carrier, duration, departure and arrival times, return schedule, weekly frequency from `NonstopRoute`.
Airfare is always **party total**: ticket × travelers, plus known mandatory fees only when the provider returns them. We do not estimate bag fees we did not retrieve.
Baselines for outlier detection: median airfare across this destination's other date candidates in the same search, and the route's own `FlightPricePoint` history where it exists. A fare 35% under either baseline is a reason; under both is a headline.

A destination with one inconvenient weekly nonstop scores lower than one with daily service at useful hours. `NonstopRoute.weeklyFrequency` and departure-time buckets feed this.

### 4.3 Weather (stage 1)

Within 16 days: Open-Meteo forecast via the existing module, `source: RETRIEVED`.
Beyond 16 days: Open-Meteo climate endpoint for the same dates in prior years, `source: HISTORICAL`, and the UI says "typically" not "will be."
Facts: highs, lows, precipitation probability, a `swimmable` flag, an `outdoorSuitability` band. The factor is weighted by how weather-dependent the anchor experience is.

### 4.4 Door-to-door and ground friction (stage 1)

Door-to-door = home → airport (`departure-planner` estimate) + `airportArrivalBufferMins` + flight duration + 35 min arrival buffer (estimate, config) + airport → hotel (haversine estimate from `DestinationProfile.airportToCenterKm`).
Driving alternative computed when the great-circle distance is under a config threshold (default 500 km), so a 55-minute flight is honestly compared with a 4-hour drive once airport overhead is added.
Ground friction reads `DestinationProfile`: `walkable`, `carNeeded`, `parkingTypical`, `activitiesDispersed`, and adds a six-person penalty when `carNeeded` and party > 5 (two rideshares or a minivan).

All of this is `ESTIMATED` and labelled so.

### 4.5 Family fit, trip-length fit, anchor experience (stage 1)

These read `DestinationProfile`, a per-destination knowledge record generated once by the AI layer and cached indefinitely with a manual refresh. It is the piece that lets stage 1 run with zero paid calls.

Family fit matches profile `familyFit` tags against derived traveler ages and `TravelerProfile.preferences.activities` ratings. It is a relevance count, not a raw attraction count: three strong matches beat twenty generic ones.
Trip-length fit compares `nights` against `idealNightsMin/Max`.
Anchor experience checks two sources: the profile's seasonal anchors, and an events lookup for the actual dates. Ticketmaster Discovery has a free tier sufficient for this; PredictHQ is the paid upgrade if we want festivals and school-holiday awareness. One qualifying anchor can carry a destination on its own (section 5).

### 4.6 All-in core trip cost (stage 4 assembly)

`coreTripCost = airfareTotal + hotelTotal + groundTransportEstimate + majorActivityEstimate`. Food is shown separately. Each addend carries its own `source`, and the total is labelled by its *weakest* addend: if any part is `ESTIMATED`, the total is.

---

## 5. Scoring, outliers, and explanation

The user-facing result is never a number. It is a list of reasons. Scoring exists only to rank candidates internally.

**One factor may dominate.** The ranking score is deliberately not an average:

```
score = max(factorScores) + 0.3 × mean(otherAvailableFactorScores) − penalties
headlineFactor = argmax(factorScores)
```

That lets the engine say "worth considering primarily because of the hotel" when everything else is ordinary. Penalties are for hard negatives only: no nonstop when the user required one, a NEGATIVE weather reason on a weather-dependent anchor, door-to-door over the user's ceiling.

**Outlier detection** is rules over baselines, not a model, so every flag has a sentence behind it:

| Outlier | Baseline | Threshold (config) |
|---|---|---|
| Hotel dramatically under public | same property, same dates, public rate | savings ≥ 60% or ≥ $150/night |
| Airfare dramatically under other weekends | median across this search's date candidates | ≥ 35% under |
| Premium destination unexpectedly cheap | `DestinationProfile.tier` = luxury + core cost in bottom third of shortlist | rank-based |
| Poor-logistics destination suddenly convenient | `NonstopRoute` newly observed, or frequency ≥ daily where profile says "usually connecting" | presence |
| Special event + favourable hotel | anchor event on dates ∧ hotelValue reason present | conjunction |

Every fired rule appends an `OpportunityReason`. The card's "Why this surfaced" list is exactly the POSITIVE reasons, ordered by magnitude, followed by any NEGATIVE ones under "Worth knowing." Nothing hidden, no score shown.

**Flexible-date arbitrage** falls out of the design: because date candidates are separate `OpportunityCandidate` rows for the same destination, stage 4 compares them and emits a reason like "Thursday departure saves $640 in airfare versus Friday." The generator is bounded (default 6 windows) and respects the user's stated constraints, weekday preferences and nights range.

---

## 6. Private Rates: how JourneyPerfect actually gets a Hilton Go rate

This section is the reconstruction of the "previous requirements" the spec refers to, made explicit. Each numbered rule is a requirement.

### 6.1 Principles

1. **JourneyPerfect never sees, stores, or transmits the user's Hilton password.** The user types it into Hilton's own page inside an isolated browser we host. We store only the resulting authenticated session state, encrypted.
2. **The user handles all authentication challenges.** Multi-factor prompts, CAPTCHAs, "verify it's you" interstitials, unusual-activity pages. When any of these appear, automation stops and control returns to the user. We never attempt to solve or bypass a challenge.
3. **Searches run only on explicit user action.** A button labelled along the lines of "Check my Hilton Go rates." No polling, no scheduled refresh, no background warm-up, no speculative pre-fetching.
4. **One session, one user.** A stored session is used only for searches initiated by the user who created it. Results are stored per user and never shared, aggregated, cached across users, or displayed to anyone else.
5. **No public exposure.** The feature is behind an app-wide flag *and* a per-user entitlement. It does not appear in navigation, marketing, pricing pages, or the public trip share for anyone not entitled. It is not on the roadmap for general release until this is revisited.
6. **The browser layer is an abstraction.** Nothing in the Hilton provider knows whether the browser is a local Playwright process or a remote container. Moving it later is a config change, not a rewrite.
7. **Fail gracefully and loudly.** Any failure returns a typed status the UI can explain. No silent empty results, no retries that could look like abuse.

### 6.2 Flags, entitlement, and gating

Two independent gates, both required:

- **App-wide kill switch:** `getConfig("privateRates.enabled", "false")`. Off by default. Flipping it off disables every private-rate action immediately, including runs in progress at their next checkpoint.
- **Per-user entitlement:** a new `PrivateRateEntitlement` row, granted and revoked only by an admin at `/admin/users`. This is new: today the app has only tier gating and `User.isAdmin`. Entitlement is not tied to a Stripe plan and is not purchasable.

Plus per-user limits from config: `privateRates.maxChecksPerDay` (default 5) and `privateRates.maxPropertiesPerCheck` (default 8).

### 6.3 Session lifecycle

```
NONE ──connect──▶ AWAITING_LOGIN ──user signs in──▶ ACTIVE
                        │                              │
                        │ timeout 10 min               │ challenge detected / cookies rejected
                        ▼                              ▼
                     EXPIRED                       NEEDS_USER ──user re-authenticates──▶ ACTIVE
                                                        │
                                          user disconnects / admin revokes
                                                        ▼
                                                    REVOKED (state destroyed)
```

**Connect.** The browser runner launches an isolated Chromium **persistent context** in a fresh per-user profile directory and opens Hilton's sign-in page. The user is shown a live view of that page (section 6.5) and signs in themselves, completing MFA on their own phone. The runner watches for the signed-in state only; it never reads form fields. Once signed in, it closes the page, seals the profile (section 6.4), and marks the session ACTIVE.

We use a persistent profile rather than exported cookies because Hilton's "remember this device" MFA trust lives in more than cookies. Preserving the whole profile is what lets the user avoid MFA on every check.

**Check rates.** On the user's click, the runner unseals the profile into an ephemeral directory, launches the context, runs the searches for the shortlist (each property × dates, once with the Team Member rate code and once without for the public comparable), parses the results, writes `HotelRateQuote` rows, closes the context, re-seals the profile, and wipes the ephemeral directory. Elapsed time is bounded by `privateRates.maxRunSeconds` (default 180).

**Challenge detection.** After every navigation, a pure `detectChallenge(pageSignals)` function classifies the page from DOM and URL signals into `NONE | CAPTCHA | MFA | SECURITY_VERIFY | SIGNED_OUT | UNKNOWN_INTERSTITIAL`. Anything other than `NONE` aborts the run at that point, keeps whatever quotes were already retrieved, sets the session to `NEEDS_USER` with `challengeKind`, and the UI tells the user plainly: "Hilton wants you to sign in again. Nothing was retrieved for the remaining properties." The user re-enters the live view to resolve it. There is no automatic retry.

### 6.4 Storage and encryption

- The sealed profile is a tar of the Chromium profile directory, encrypted with **AES-256-GCM**. The key is derived per user via HKDF from a master key in the environment (`PRIVATE_RATES_MASTER_KEY`) and the user id, with a `keyVersion` column to allow rotation.
- Sealed blobs live on the browser runner's disk volume, not in Postgres, because a Chromium profile is tens of megabytes. Postgres holds only the `PrivateRateSession` metadata row.
- Ephemeral unsealed directories live in tmpfs and are deleted in a `finally` block, including on crash paths.
- The master key never reaches the Next.js app. Only the runner has it.
- Disconnect or revoke destroys the sealed blob and the metadata row.
- Screencast frames from the live view are never persisted.

### 6.5 The browser layer and the remote-container path

```
src/lib/private-rates/
  types.ts                  RateProvider, BrowserRunner interfaces, status enums
  challenges.ts             PURE  detectChallenge(signals) → ChallengeKind
  parse-hilton.ts           PURE  parse a results-page snapshot → HotelRateQuote[]
  providers/hilton.ts       RateProvider: drives a BrowserRunner; knows Hilton URLs and selectors
  runner/
    runner.ts               interface BrowserRunner {
                              openInteractive(userId): { sessionId, liveViewUrl }
                              awaitSignedIn(sessionId): Promise<void>
                              run(userId, task): Promise<TaskResult>   // unseal → task → seal
                              destroy(userId): Promise<void>
                            }
    http-runner-client.ts   Next.js-side client that calls the runner service over an internal API
  index.ts                  getBrowserRunner() reads getConfig("privateRates.runner", "local")

services/browser-runner/    separate Coolify service, Node + Playwright + Chromium
  local-playwright.ts       BrowserRunner implementation: persistent contexts, seal/unseal, screencast
  live-view.ts              CDP Page.startScreencast → WebSocket frames; input events forwarded back
  api.ts                    internal HTTP+WS API, shared-secret auth, only reachable from the app
```

The Next.js app **never imports Playwright**. It talks to the runner over an internal API. That single decision is what makes "run it in a remote container later" a non-event: a `RemoteContainerRunner` that speaks the same interface to a hosted browser provider (which supplies its own live-view URL) replaces the local runner behind `getBrowserRunner()`.

The live view for the interactive login is a CDP screencast streamed over a WebSocket to a canvas in the JourneyPerfect UI, with mouse and keyboard events forwarded back. It exists only during `AWAITING_LOGIN` and `NEEDS_USER`. It is the one piece of real engineering in this section, and it is exactly the piece hosted providers sell, which is why the interface exposes `liveViewUrl` rather than frames.

### 6.6 Provider abstraction

`RateProvider` is not Hilton-specific. A second program (a corporate rate code, a Marriott friends-and-family rate) would be a second provider with the same interface. The `HotelRateQuote.rateKind` enum and `PrivateRateSession.provider` column are designed for that. We build one provider.

### 6.7 What this does not do

No continuous polling. No scraping on behalf of any user other than the session owner. No public exposure. No storing of credentials. No solving of security challenges. No retries after a challenge. No aggregation of private rates across users into any shared dataset, ever.

### 6.8 A risk to name

Hilton's Team Member Travel Program terms govern the user's own use of their benefit; automating their own session may sit outside those terms. The user is acting on their own account with their own entitlement, and we never scale it beyond that, but counsel should look at this before the flag is turned on for anyone but the founder.

---

## 7. Data model

New models. Where the spec sketches a `TravelOpportunity` object, this maps it onto existing models rather than duplicating them: airfare lives in `FlightOffer`, the eventual hotel in `Hotel`, the eventual trip in `Trip`.

```prisma
/// One user-initiated discovery run. The unit of bounding, authorisation and audit.
model OpportunitySearch {
  id                        String    @id @default(cuid())
  userId                    String
  originAirports            String[]              // IATA, from home airport(s)
  originLat                 Float
  originLng                 Float
  windowStart               DateTime  @db.Date
  windowEnd                 DateTime  @db.Date
  nightsMin                 Int
  nightsMax                 Int
  weekdayPattern            String?               // "THU-SUN" | "FRI-MON" | null = any
  travelerProfileIds        String[]
  constraints               Json                  // { maxCoreCost?, nonstopOnly?, maxFlightMins?, drivingOk?, warm?, regions?[] }
  status                    String    @default("DRAFT") // DRAFT | STAGE_0..STAGE_4 | DONE | FAILED
  privateRatesAuthorizedAt  DateTime?             // set by explicit click; stage 3 gate
  createdAt                 DateTime  @default(now())
  completedAt               DateTime?
  candidates                OpportunityCandidate[]
  opportunities             TravelOpportunity[]
  @@index([userId, createdAt])
}

/// One destination × one date window inside a search. The working row the pipeline advances.
model OpportunityCandidate {
  id              String   @id @default(cuid())
  searchId        String
  destinationIata String
  destinationName String
  destinationLat  Float
  destinationLng  Float
  checkIn         DateTime @db.Date
  checkOut        DateTime @db.Date
  nights          Int
  stage           Int      @default(0)
  pruned          Boolean  @default(false)
  prunedReason    String?
  factors         Json     @default("{}")          // Record<FactorKind, FactorResult>
  flightSearchId  String?                          // → FlightSearch (flights plan)
  score           Float?
  headlineFactor  String?
  search          OpportunitySearch @relation(fields: [searchId], references: [id], onDelete: Cascade)
  @@index([searchId, stage])
}

/// A surfaced result: the card. Denormalised on purpose so it stays readable after quotes expire.
model TravelOpportunity {
  id                        String   @id @default(cuid())
  searchId                  String
  candidateId               String
  userId                    String
  destinationName           String
  destinationIata           String
  checkIn                   DateTime @db.Date
  checkOut                  DateTime @db.Date
  nights                    Int
  travelerCount             Int
  nonstopAvailable          Boolean
  flightOfferId             String?                // → FlightOffer, chosen option
  transportation            Json                   // { mode, durationMins, doorToDoorMins, carriers[], departs, returns, source }
  airfareTotal              Float?
  airfareSource             String                 // RETRIEVED | ESTIMATED | UNKNOWN
  hotelRateQuoteId          String?                // → HotelRateQuote (private)
  publicRateQuoteId         String?                // → HotelRateQuote (public comparable)
  hotelName                 String?
  privateNightlyRate        Float?
  comparablePublicRate      Float?
  hotelSavingsTotal         Float?
  groundTransportEstimate   Float?
  majorActivityEstimate     Float?
  coreTripCost              Float?
  coreTripCostSource        String                 // weakest addend
  weatherContext            Json                   // { kind: FORECAST | HISTORICAL, highF, lowF, precipPct, swimmable, summary }
  anchorExperience          Json?                  // { title, kind, date?, url?, source }
  familyFitReasons          String[]
  opportunityReasons        Json                   // OpportunityReason[], ordered by magnitude
  headlineFactor            String
  retrievedAt               DateTime
  builtTripId               String?                // set by "Build This Trip"
  createdAt                 DateTime @default(now())
  search                    OpportunitySearch @relation(fields: [searchId], references: [id], onDelete: Cascade)
  @@index([userId, createdAt])
}

/// A hotel rate observation. Private ones are user-scoped and never shared.
model HotelRateQuote {
  id            String   @id @default(cuid())
  userId        String
  provider      String                 // "hilton"
  propertyCode  String
  propertyName  String
  brand         String?
  tier          String?                // from DestinationProfile or brand map
  lat           Float?
  lng           Float?
  checkIn       DateTime @db.Date
  checkOut      DateTime @db.Date
  rateKind      String                 // PRIVATE_HILTON_GO | PUBLIC
  nightlyRate   Float
  totalRate     Float
  currency      String   @default("USD")
  roomType      String?
  available     Boolean
  sessionId     String?                // → PrivateRateSession for private quotes
  retrievedAt   DateTime @default(now())
  expiresAt     DateTime               // default +24h; UI shows staleness
  @@index([userId, propertyCode, checkIn])
}

/// Per-destination knowledge, generated once by the AI layer, cached, refreshed manually.
model DestinationProfile {
  id                 String   @id @default(cuid())
  iata               String   @unique
  name               String
  lat                Float
  lng                Float
  tier               String                 // BUDGET | MID | UPSCALE | LUXURY (dominant hotel stock)
  idealNightsMin     Int
  idealNightsMax     Int
  walkable           Boolean
  carNeeded          Boolean
  airportToCenterKm  Float
  parkingTypical     String                 // FREE | CHEAP | EXPENSIVE
  activitiesDispersed Boolean
  familyFit          Json                   // { tags[], byAgeBand: {...}, indoorRatio }
  anchors            Json                   // [{ title, kind, months[], weatherDependent }]
  climate            Json?                  // monthly typical highs/lows/precip for fast stage-1 checks
  generatedBy        String                 // model id
  refreshedAt        DateTime @default(now())
}

/// Nonstop service between two airports. Seeds stage 0 with zero paid calls.
model NonstopRoute {
  id                 String   @id @default(cuid())
  originIata         String
  destIata           String
  carriers           String[]
  weeklyFrequency    Int?
  typicalDurationMins Int
  departureBuckets   String[]               // "EARLY" | "MORNING" | "MIDDAY" | "EVENING"
  source             String                 // "OPENFLIGHTS_SEED" | "OBSERVED_OFFER" | "SCHEDULE_API"
  lastVerifiedAt     DateTime
  @@unique([originIata, destIata])
}

/// The user's authenticated browser session for a private rate program. No credentials, ever.
model PrivateRateSession {
  id              String   @id @default(cuid())
  userId          String
  provider        String                    // "hilton"
  status          String                    // NONE | AWAITING_LOGIN | ACTIVE | NEEDS_USER | EXPIRED | REVOKED
  challengeKind   String?                   // CAPTCHA | MFA | SECURITY_VERIFY | SIGNED_OUT | UNKNOWN_INTERSTITIAL
  sealedBlobRef   String?                   // path/key on the runner volume; never the blob itself
  keyVersion      Int      @default(1)
  lastValidatedAt DateTime?
  lastUsedAt      DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@unique([userId, provider])
}

/// Admin-granted, per-user. Not a plan tier. Not purchasable.
model PrivateRateEntitlement {
  id         String    @id @default(cuid())
  userId     String
  provider   String
  grantedBy  String                          // admin user id
  grantedAt  DateTime  @default(now())
  revokedAt  DateTime?
  notes      String?
  @@unique([userId, provider])
}

/// Every private-rate action, for audit. Append-only.
model PrivateRateAuditLog {
  id         String   @id @default(cuid())
  userId     String
  provider   String
  action     String                          // CONNECT | CHECK_RATES | CHALLENGE | DISCONNECT | REVOKE | KILL_SWITCH
  searchId   String?
  detail     Json?
  createdAt  DateTime @default(now())
  @@index([userId, createdAt])
}
```

Relations to add: `User.opportunitySearches`, `User.privateRateSessions`, `User.privateRateEntitlements`, `Trip.builtFromOpportunityId String?` (so a trip remembers its rationale).

### Where the NonstopRoute seed comes from

There is no free, current nonstop route dataset. Recommended sequence:

1. Seed from OpenFlights routes data (stale, but a usable first cut for candidate generation), `source: OPENFLIGHTS_SEED`.
2. Every `FlightOffer` with `stops = 0` observed through the flights provider layer upserts the route with `source: OBSERVED_OFFER` and refreshes `lastVerifiedAt`. The table self-corrects with use.
3. If precision matters later, a schedules API such as AeroDataBox is cheap and can refresh an origin's routes on an admin action.

---

## 8. Code layout

```
src/lib/opportunities/
  types.ts                      FactorResult, OpportunityReason, FactorKind, constraints types
  date-candidates.ts            PURE  bounded window generator
  destinations.ts               candidate set from NonstopRoute + constraints
  factors/
    hotel-value.ts              PURE
    nonstop-airfare.ts          PURE
    weather.ts                  PURE  (wraps DayForecast[] or climate rows)
    door-to-door.ts             PURE  (uses departure-planner)
    family-fit.ts               PURE
    trip-length-fit.ts          PURE
    anchor.ts                   PURE
    ground-friction.ts          PURE
  outliers.ts                   PURE  rules over baselines → OpportunityReason[]
  scoring.ts                    PURE  max-dominant ranking, headlineFactor
  pipeline.ts                   stage runner; reads caps from config; writes candidates
  build-trip.ts                 TravelOpportunity → Trip + Hotel + Flight + Activity rows

src/lib/actions/opportunities.ts    "use server": createSearch, runStage, authorizePrivateRates, buildTrip
src/lib/actions/private-rates.ts    "use server": connect, checkRates, disconnect (all entitlement-gated)

src/app/(app)/opportunities/
  page.tsx                      NOT trip-scoped; lives beside /dashboard
  new-search-form.tsx           dates window, nights, travelers, constraints
  search-progress.tsx           stage indicator; the "Check my Hilton Go rates" button appears at stage 3
  opportunity-card.tsx          the card; "Why this surfaced" list; source labels; Build This Trip
  live-view.tsx                 canvas + WebSocket for the interactive Hilton sign-in

src/app/(admin)/admin/private-rates/   entitlement grants, sessions, audit log, kill switch
```

Entry points: a new "Opportunities" item in the top-level nav in [app-shell.tsx](../../src/components/app-shell.tsx) beside Dashboard, gated by a new `opportunityDiscovery` feature. The private-rate controls render only when `privateRates.enabled` is true *and* the user holds an entitlement.

---

## 9. The opportunity card

Adapted to the existing design system rather than the spec's mock. Every number carries its source label.

```
ORLANDO  ·  Thu 12 – Sun 15 Nov  ·  3 nights  ·  6 travelers

Why this surfaced
  ✓ $2,538 hotel savings          Conrad Orlando, private $79 vs public $925/night   retrieved 2h ago
  ✓ Nonstop both ways             DTW→MCO 2h 45m, Spirit + Delta options              retrieved 2h ago
  ✓ $1,260 airfare for six        35% under the other November weekends               retrieved 2h ago
  ✓ 3 strong family matches       ages 7, 9, 12 · theme parks · water · interactive
  ✓ Good weather                  typically 78° / 61°, 15% rain                        historical
  ✓ Fits a 3-night trip

Worth knowing
  – Car needed; six seats means a minivan                                             estimated

Core trip estimate  $2,140 before food                                                estimated
  Flights $1,260 retrieved · Hotel $237 retrieved · Car + parking $340 est · Attractions $300 est

[ Build This Trip ]                                              door-to-door ≈ 6h 10m
```

**Build This Trip** creates the `Trip` (origin, destination, dates, travelers), the `Hotel` with the retrieved rate and its confirmation left blank so it appears in To Do as needing reservation, the `Flight` from the chosen `FlightOffer` via the flights plan's accept path, `Activity` rows as WISHLIST for the matched anchors, and stores the `opportunityReasons` on the trip so the rationale survives. The user lands in the normal Plan view. Nothing is re-entered.

---

## 10. Phasing

Ordered by dependency. Phase A ships something useful with zero paid or private calls.

| Phase | Scope | Depends on | Est. |
|---|---|---|---|
| **A** | Schema migration for all section-7 models. `DestinationProfile` generation for the top ~60 US leisure destinations. `NonstopRoute` seed. Date generator. Stage 0–1 factors. Outliers + scoring. Opportunities page with cards, all `ESTIMATED`/`HISTORICAL`, no airfare or hotel numbers yet. | nothing | 2 weeks |
| **B** | Stage 2: airfare via the flights provider layer, nonstop filter, family totals, airfare outliers, `NonstopRoute` self-correction. | flights plan Phase 1 | 1 week |
| **C** | Private Rates: entitlement + kill switch + audit, browser-runner service on Coolify, Hilton connect with live view, check-rates on the shortlist, challenge handling, stage 3 + hotel-value factor. Founder-only entitlement. | A | 2–3 weeks |
| **D** | Anchor events via Ticketmaster Discovery. Build This Trip. Admin private-rates console. | B, C | 1 week |
| **E** | Natural-language entry ("find me something I wouldn't have thought of") using the flights plan §5 tool loop, with `runOpportunitySearch` as a tool. | flights plan Phase 3 | 1 week |
| **F** | `RemoteContainerRunner` behind the same interface, if the droplet's Chromium proves heavy. | C | 3 days |

Phase C should not be turned on for anyone beyond the founder until section 6.8 has been looked at.

---

## 11. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Hilton changes markup; parser breaks | High, recurring | Parser is a pure module with fixture tests from saved snapshots. Failure is typed `PARSE_FAILED`, surfaced honestly, never guessed. |
| Hilton flags automation on the user's account | Medium | User-triggered only, low volume, real session, no challenge bypass, per-user daily cap. Named in 6.8 for counsel. |
| Chromium on the droplet is heavy | Medium | Separate Coolify service with memory limit; `RemoteContainerRunner` is Phase F behind the same interface. |
| Search space explodes | Low if caps hold | Every cap is config; pipeline refuses to start a stage that would exceed its cap. |
| Estimates read as facts | Medium | `source` on every number, "typically" for historical weather, total labelled by weakest addend. |
| `DestinationProfile` is wrong or dated | Medium | Generated once, reviewed, refreshable; `generatedBy` and `refreshedAt` visible to admins. |
| Stage 2 airfare cost | Medium | Runs only on stage-1 survivors, cached 6h through the flights layer, capped per search and per user per day. |
| Feature leaks publicly | Low | Two gates, nav hidden, not on pricing, share page never renders private data. |

---

## 12. Open questions

1. **Which airports count as home?** Detroit-area users have DTW only; others have two or three. Propose: derive from `User.homeLat/Lng` within 120 km, let the user edit.
2. **Public comparable rate source.** Same Hilton session without the rate code is most accurate. Should we also cross-check Booking.com via the affiliate search for a second opinion on the card?
3. **How many destinations get a `DestinationProfile` at launch?** Sixty covers the obvious US leisure map; Caribbean and Mexico add twenty.
4. **Does the founder want the live-view sign-in built self-hosted first (Phase C as written), or start on a hosted browser provider and skip the WebSocket screencast work?** The interface supports either; the second is faster to ship and costs per session.
