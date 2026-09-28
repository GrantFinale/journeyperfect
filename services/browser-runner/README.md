# browser-runner

The isolated browser service behind JourneyPerfect's **Private Rates** feature
(design: `docs/plans/opportunity-discovery-engine.md` §6). It is the only
process that ever runs Playwright. The Next.js app talks to it over a small
bearer-authenticated HTTP API through `src/lib/private-rates/runner/http-runner-client.ts`.

What it does, and only this:

1. **Interactive sign-in.** Launches a persistent Chromium context in a fresh
   per-user profile, opens Hilton's own sign-in page, and streams it to the
   user over a WebSocket live view. The user types their credentials and
   completes MFA themselves. We watch only for the signed-in state.
2. **Sealed profiles.** When sign-in is detected the browser is closed, the
   profile directory is tar'd and encrypted (AES-256-GCM, per-user HKDF key)
   to `${DATA_DIR}/sealed/<userId>.bin`, and the scratch directory is wiped.
3. **Rate checks.** On `POST /run` the profile is unsealed into tmpfs, the
   browser launched, sign-in verified, the requested Hilton searches run
   sequentially under one hard deadline, results parsed, the profile
   re-sealed and the scratch directory wiped in `finally`.

## Hard rules

These are encoded in code comments at the relevant sites and must survive refactors:

- **No scheduler.** Nothing runs unless the app calls an endpoint, and the app
  only calls on explicit user action.
- **No retries after a challenge.** The first CAPTCHA / MFA / security
  interstitial / sign-out aborts the run and returns whatever was already
  retrieved. The user resolves it in the live view. We never solve or bypass one.
- **One user's profile is never used for another user's request.** Sealed blobs
  are keyed by userId and encrypted with a userId-derived key; sessions record
  their owner; `/run` and `/users/:userId` act only on the given user; the
  per-user lock prevents a run and a sign-in from overlapping.
- **Nothing about credentials is ever logged.** Request logging is off, the
  `Authorization` header is redacted, live-view URLs (they carry the one-time
  token) are never logged, key/text input from the live view is never logged,
  screencast frames are never persisted.
- **Temp dirs are wiped in `finally`**, including on crash paths. The master
  key exists only in this service's environment.

## API

All routes except `GET /healthz` require `Authorization: Bearer $BROWSER_RUNNER_SECRET`.

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| `POST` | `/sessions` | `{userId}` | `201 {sessionId, liveViewUrl}`; `409` if a run is in progress for the user |
| `GET` | `/sessions/:id/status` | | `{status: AWAITING_LOGIN\|SIGNED_IN\|CHALLENGE\|TIMEOUT, challengeKind?, liveViewUrl?}` |
| `POST` | `/run` | `{userId, task}` | `RunnerResult<RateObservation[]>`; `409` if the user has a session or run open |
| `DELETE` | `/users/:userId` | | `204`; ends any session and destroys the sealed blob |
| `GET` | `/healthz` | | `{ok:true}` (unauthenticated) |
| `WS` | `/live/:sessionId?token=…` | | screencast + input (see `src/live-view.ts` header) |

`task` is either

```jsonc
{ "kind": "HILTON_RATES", "properties": [{ "propertyCode": "CHIPDHH", "checkIn": "2026-10-10", "checkOut": "2026-10-12" }], "rateCode": "TMTP" }
// or
{ "kind": "HILTON_CITY_RATES", "location": "Chicago, IL", "lat": 41.88, "lng": -87.63, "checkIn": "2026-10-10", "checkOut": "2026-10-12", "rateCode": "TMTP", "maxProperties": 8 }
```

`rateCode` present → observations are `PRIVATE_HILTON_GO`; absent → `PUBLIC`.
The app requests both variants itself when it wants a comparable.

### Status semantics

- `AWAITING_LOGIN` may carry an informational `challengeKind` (`CAPTCHA` /
  `MFA` / `SECURITY_VERIFY`) describing what Hilton is currently showing the
  user in the live view. It is not terminal; the user handles it.
- `SIGNED_IN` is terminal: the profile has been sealed.
- `TIMEOUT`: the `SESSION_LOGIN_TIMEOUT_MS` window elapsed, or the session was
  superseded / ended by `DELETE`. Nothing was sealed.
- `CHALLENGE`: the browser died or sealing failed (`challengeKind: UNKNOWN_INTERSTITIAL`).
- `liveViewUrl` is returned again by the status route whenever no viewer is
  attached, with a fresh one-time token, so a reloaded UI can reconnect.

### Live view

The `liveViewUrl` embeds a **one-time** token; the WebSocket accepts it once,
while the session is `AWAITING_LOGIN`, for a single viewer. Frames are
CDP `Page.startScreencast` JPEGs (quality 60, max 1280 px), sent as binary
messages; input is JSON. Protocol details are at the top of `src/live-view.ts`.
The UI needs the runner's public URL to be reachable from the **user's browser**
— that is what `LIVE_VIEW_PUBLIC_URL` is for (see COOLIFY.md).

## Configuration

| Env | Default | Notes |
| --- | --- | --- |
| `BROWSER_RUNNER_SECRET` | required | ≥16 chars; same value in the Next.js app |
| `PRIVATE_RATES_MASTER_KEY` | required | base64 of ≥32 random bytes; **only this service has it** |
| `DATA_DIR` | `/data` | sealed blobs in `${DATA_DIR}/sealed/`; mount a volume |
| `PORT` / `HOST` | `8787` / `0.0.0.0` | |
| `LIVE_VIEW_PUBLIC_URL` | `http://localhost:PORT` | public base URL for the WS live view; converted to `ws(s)://` |
| `LIVE_VIEW_ALLOWED_ORIGIN` | unset (any) | comma-separated browser origins allowed to open the live view, e.g. `https://journeyperfect.com`; unset accepts any `Origin` and logs a warning at boot |
| `SESSION_LOGIN_TIMEOUT_MS` | `600000` | |
| `MAX_RUN_MS` | `180000` | hard deadline per `/run` |
| `HEADLESS` | `true` | |
| `HILTON_RATE_CODE_PARAM` | `corporateCode` | query param used to send `rateCode` (unverified assumption) |

## Source map

```
src/
  index.ts        wiring + graceful shutdown
  config.ts       env parsing
  api.ts          Fastify routes, bearer auth, body validation
  sessions.ts     interactive session registry/lifecycle, per-user locks
  live-view.ts    WebSocket screencast + input forwarding
  run.ts          POST /run orchestration (unseal → verify → task → seal → wipe)
  hilton.ts       Hilton URLs, selectors (HILTON const), sign-in detection, extraction, task runners
  seal.ts         tar + AES-256-GCM seal/unseal, scratch dirs, wipe
  challenges.ts   COPY of src/lib/private-rates/challenges.ts (pure)
  parse-hilton.ts COPY of src/lib/private-rates/parse-hilton.ts (pure)
  types.ts        hand-synced copy of the wire types
```

`challenges.ts` and `parse-hilton.ts` are byte-identical to the app's copies
except for the `./types.js` import specifier (ESM needs the extension here).
`test/challenges-sync.test.ts` fails if the challenge classifier drifts; when
you change one copy, change the other.

## Hilton selector assumptions

Everything we assume about hilton.com's DOM is in the `HILTON` constant at the
top of `src/hilton.ts`, with a comment per entry. In short: the sign-in URL is
`/en/hilton-honors/login/`; signed-in is detected by landing under
`/hilton-honors/guest/` or by an account-menu widget; the rooms page is
`/en/book/reservation/rooms/?ctyhocn=…&arrivalDate=…&departureDate=…`; a rate
code is appended as `corporateCode=` (override with `HILTON_RATE_CODE_PARAM`);
the location search is `/en/search/?query=…`. Room and property cards are
found by a list of `data-testid`/class selectors and fall back to scanning
card text for a money pattern. Expect to tune these against the live site.

## Development

```bash
cd services/browser-runner
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install   # tests do not need a browser
npm run typecheck
npm test
# to actually drive Chromium locally:
npx playwright install chromium
BROWSER_RUNNER_SECRET=dev-secret-dev-secret PRIVATE_RATES_MASTER_KEY=$(openssl rand -base64 32) \
DATA_DIR=./data LIVE_VIEW_PUBLIC_URL=http://localhost:8787 npm run dev
```

Tests cover seal/unseal round-trips (including cross-user and tampering
failures), config parsing, URL builders, the API's auth/validation/locking, and
the session state machine with a fake browser. Anything that touches hilton.com
is not covered by tests and must be checked by hand in the live view.
