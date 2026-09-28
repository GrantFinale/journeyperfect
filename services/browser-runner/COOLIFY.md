# Deploying browser-runner on Coolify

Deploy this as a **separate service inside the existing `journeyperfect`
Coolify project** on the `benedict-ventures` droplet. Do not fold it into the
Next.js app's container: the app must never have Playwright, Chromium, or the
master key.

## 1. Create the resource

- Project: `journeyperfect` → **+ New Resource → Docker (Dockerfile)** from the
  same Git repository.
- **Base directory:** `services/browser-runner`
- **Dockerfile:** `Dockerfile` (relative to the base directory)
- **Port:** `8787`
- Name it `browser-runner`.

## 2. Persistent storage

Add a **volume** mounted at **`/data`**. Sealed Chromium profiles
(`/data/sealed/<userId>.bin`, tens of MB each) live here. Losing this volume
only forces users to sign in again; it holds no credentials.

Chromium and the unsealed profiles use tmpfs. Docker's default `/dev/shm` is
64 MB, which is too small. In the resource's advanced/compose settings set
`shm_size: 1gb` (Coolify exposes this in the generated compose; if you cannot,
the service falls back to `/tmp` automatically and Chromium runs with
`--disable-dev-shm-usage`, so it still works, just not in RAM).

## 3. Environment variables (exactly three are required)

| Variable | Value |
| --- | --- |
| `BROWSER_RUNNER_SECRET` | `openssl rand -hex 32`. Set the **same** value on the Next.js app. |
| `PRIVATE_RATES_MASTER_KEY` | `openssl rand -base64 32`. **Only on this service.** Rotating it invalidates every sealed profile (users re-sign-in). |
| `LIVE_VIEW_PUBLIC_URL` | The public HTTPS URL of this service, e.g. `https://runner.journeyperfect.com`. See below. |

Strongly recommended: `LIVE_VIEW_ALLOWED_ORIGIN=https://journeyperfect.com,https://www.journeyperfect.com`
— the live-view WebSocket then refuses upgrades whose `Origin` header is not
the app, so a hostile page cannot spend a user's one-time live-view token.
Unset, any origin is accepted and the service logs a warning at boot.

Optional: `SESSION_LOGIN_TIMEOUT_MS`, `MAX_RUN_MS`, `HILTON_RATE_CODE_PARAM`
(see README). Leave `DATA_DIR` and `PORT` at their defaults.

Mark the two secrets as *build-time excluded* / runtime-only in Coolify.

## 4. Networking: internal API, public live view

Two different callers talk to this container:

1. **The Next.js app** calls the HTTP API (`/sessions`, `/run`, …). This should
   stay **inside the Coolify Docker network**. In the app's environment set
   `BROWSER_RUNNER_URL=http://browser-runner:8787` (Coolify resources in the
   same project share a network and resolve by service name; check the
   generated container name in the resource's settings). The app's
   `privateRates.runnerUrl` config should point at this.

2. **The user's browser** must open the WebSocket at
   `LIVE_VIEW_PUBLIC_URL/live/<sessionId>?token=…` to see and drive the Hilton
   sign-in page. That path therefore has to be reachable from the public
   internet, over **HTTPS/WSS** (the app is HTTPS, so a `ws://` URL would be
   blocked as mixed content).

   Recommended setup:
   - Add a DNS record `runner.journeyperfect.com → 134.122.113.128`
     (`doctl compute domain records create journeyperfect.com --record-type A --record-name runner --record-data 134.122.113.128`).
   - In Coolify, give the resource the domain `https://runner.journeyperfect.com`
     so Traefik terminates TLS and proxies port 8787. Traefik passes WebSocket
     upgrades through by default.
   - Set `LIVE_VIEW_PUBLIC_URL=https://runner.journeyperfect.com`.
   - Set `LIVE_VIEW_ALLOWED_ORIGIN` to the app's origin(s) (see §3).

   Exposing the domain also exposes the HTTP API on it. That is acceptable
   because every route except `/healthz` requires the bearer secret and the
   live-view route requires a one-time per-session token, but if you want the
   API to be strictly internal, add a Traefik rule on the resource that only
   routes `PathPrefix(/live/)` and `Path(/healthz)` on the public domain, and
   keep the app pointed at the internal `http://browser-runner:8787` address.
   Either way, **never expose port 8787 directly** on the droplet firewall.

## 5. Health check

Coolify can use `GET /healthz` (unauthenticated) on port 8787; the Dockerfile
also declares a `HEALTHCHECK`.

## 6. Checklist before flipping `privateRates.enabled`

- [ ] `/healthz` returns `{ok:true}` through the public domain over HTTPS.
- [ ] `curl -H "Authorization: Bearer $BROWSER_RUNNER_SECRET" http://browser-runner:8787/sessions -d '{"userId":"smoke"}' -H 'content-type: application/json'`
      from inside the app container returns a session and a `wss://runner.journeyperfect.com/live/…` URL.
- [ ] Open that URL from the JourneyPerfect live-view UI and confirm the Hilton sign-in page renders.
- [ ] `DELETE /users/smoke` afterwards.
- [ ] Volume at `/data` is persistent across redeploys.
- [ ] Counsel has looked at §6.8 of the plan.
