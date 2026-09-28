# Scheduled jobs (cron)

JourneyPerfect has no in-process scheduler. Background work is exposed as
HTTP routes under `src/app/api/cron/*`, each guarded by a bearer token, and an
external scheduler calls them. This keeps the Docker image stateless and lets
the schedule live wherever is cheapest to operate.

Plan reference: `docs/plans/flights-search-tracking-and-booking.md` §4.3.

## Routes

| Route | Purpose | Cadence |
|---|---|---|
| `POST /api/cron/flight-prices` | Re-price tracked `FlightSearch` rows, write `FlightPricePoint`, send `flight_alert` notifications + email | Daily (09:00 UTC) |

Every cron route:

- exports `dynamic = "force-dynamic"` so Next.js never caches it;
- requires `Authorization: Bearer $CRON_SECRET`; returns **503** when the
  `CRON_SECRET` environment variable is unset (fail closed), **401** on a bad
  token;
- accepts `GET` or `POST`; `?dryRun=1` verifies auth and provider selection
  without doing any work;
- returns a JSON summary, e.g.

```json
{
  "ok": true,
  "provider": "serpapi",
  "startedAt": "2026-09-27T09:00:01.000Z",
  "finishedAt": "2026-09-27T09:00:14.000Z",
  "scanned": 12, "checked": 9, "skipped": 0, "expired": 1,
  "alerted": 2, "failed": 2,
  "errors": [{ "watchId": "clx...", "error": "Flight provider \"serpapi\" request failed (429): ..." }]
}
```

`ok: false` (HTTP 503) means the run aborted early because the active
provider has no API key configured; fix it at `/admin/settings`.

## Behaviour of `flight-prices`

Implemented in `src/lib/flights/watch-runner.ts` (pure loop, unit-tested with
fakes) + `src/lib/flights/watch-store.ts` (Prisma). Per run:

1. Load `FlightSearch` rows with `isTracking = true` in batches of 20, skipping
   any checked within `flights.checkIntervalHours` (default 24; tunable at
   `/admin/settings`). Watches whose departure date has passed are marked
   `isTracking = false`.
2. Call the active provider (`flights.provider`) once per watch, with a 250 ms
   pause between calls.
3. Replace the watch's `FlightOffer` rows, append one `FlightPricePoint`
   (lowest price + Google price insight when available), roll
   `lastPrice` / `lowestPrice` / `lastCheckedAt` forward.
4. If `shouldAlert()` (`src/lib/flights/pricing.ts`) fires — target price hit,
   new all-time low, or a >=10 % drop since the last check — create a
   `Notification` of type `flight_alert` and email the user via
   `src/lib/email.ts`.

Cost model: one provider call per tracked route per day. The plan caps
(`maxFlightWatches`, 0/3/10/50 by plan, overridable per plan in config) are
the primary spend control; the SerpApi $25/month tier covers ~30 routes daily.

## Environment

| Variable | Where | Notes |
|---|---|---|
| `CRON_SECRET` | App container (Coolify env) | Long random string, e.g. `openssl rand -hex 32`. Rotate by changing it in both places. |
| `SMTP_*` | App container | Already required for other email; alerts reuse `sendEmail`. |

Provider API keys are **not** environment variables: they live in `AppConfig`
(`api.serpapi.key`, `api.duffel.token`, `api.travelpayouts.token`) and are
edited at `/admin/settings` so rotation never needs a deploy.

## Option A: GitHub Actions (default)

`.github/workflows/flight-prices.yml` runs daily at 09:00 UTC and on manual
dispatch. It POSTs to the route with curl and fails the job on any non-2xx.

Setup (once):

1. Repo → Settings → Secrets and variables → Actions → New repository secret:
   - `CRON_URL` = `https://journeyperfect.com/api/cron/flight-prices`
   - `CRON_SECRET` = the app's `CRON_SECRET`
2. Actions tab → "Flight price watch" → Run workflow to verify. The job log
   prints the JSON summary.

Notes: GitHub may delay scheduled workflows by several minutes under load and
disables schedules on repos with no activity for 60 days (re-enable from the
Actions tab). Neither matters for a daily price check.

## Option B: Coolify scheduled task

The app runs on Coolify on the `benedict-ventures` droplet. Coolify can run a
command on a schedule inside (or next to) the app container, which keeps the
trigger on the same box and off GitHub.

1. Coolify → the JourneyPerfect application → **Scheduled Tasks** → Add.
2. Name: `flight-prices`. Frequency: `0 9 * * *` (Coolify also accepts
   presets such as `daily`).
3. Command (runs inside the app container, which has `curl`; `CRON_SECRET` is
   already in its environment):

   ```sh
   curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/flight-prices
   ```

   Use the public URL instead of `localhost:3000` if the task runs in a
   separate container.
4. Save, then use **Run now** and check the task's execution log for the JSON
   summary.

If both A and B are enabled the second run of the day is a no-op: every watch
was checked within `flights.checkIntervalHours`, so `checked` is 0.

## Option C: droplet crontab (fallback)

```
0 9 * * * curl -fsS -X POST -H "Authorization: Bearer <secret>" https://journeyperfect.com/api/cron/flight-prices >> /var/log/jp-flight-prices.log 2>&1
```

Only if Coolify is unavailable; secrets in a crontab are harder to rotate.

## Manual run / debugging

```sh
# auth + provider check only
curl -s -H "Authorization: Bearer $CRON_SECRET" "https://journeyperfect.com/api/cron/flight-prices?dryRun=1"
# full run
curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" https://journeyperfect.com/api/cron/flight-prices | jq
```

Application logs (`docker logs <app container>` or the Coolify log view) carry
`[cron/flight-prices]` lines for failures and `[email]` lines for SMTP errors.

## Adding another cron route

1. Put the loop in `src/lib/<feature>/…-runner.ts` against an injected store
   so it is unit-testable; put Prisma in a sibling `…-store.ts`.
2. Add `src/app/api/cron/<name>/route.ts` copying the auth block from
   `flight-prices/route.ts` (`force-dynamic`, bearer check, 503 when unset).
3. Add a workflow under `.github/workflows/` or a Coolify scheduled task, and a
   row in the table above.
