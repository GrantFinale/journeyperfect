# Deploying browser-runner on Coolify

> **Production currently runs on the home Mac Studio, not on Coolify (since
> 2026-10-02).** `runner.journeyperfect.com` is routed by a Traefik dynamic file
> through an SSH reverse tunnel. The Coolify app below is **stopped**, and auto
> deploy is off. See [HOME-RUNNER.md](./HOME-RUNNER.md), including how to roll
> back to this container.

The runner is a **separate Coolify application** next to the Next.js app on the
`benedict-ventures` droplet. Do not fold it into the Next.js app's container:
the app must never have Playwright, Chromium, or the master key.

Production was deployed on 2026-09-28. This file records the settings that
deployment used.

## Current production resource

| Setting | Value |
| --- | --- |
| Coolify application | `browser-runner`, uuid `rwtji13ctlsh9ah3xqv1k53o` |
| Project / environment | `My first project` / `production` (the same ones as the `journeyperfect` app, `h7ayr5f0enc6c2b2osy1wtil`) |
| Server / destination | `localhost` (`e1jajmf445jz5jqbwxxifhy6`) / default docker network (`urrrmn2k3mo9x7r57ghx0cbc`) |
| Source | Public GitHub source, `https://github.com/GrantFinale/journeyperfect`, branch `main` (the same source as the main app) |
| Build pack | Dockerfile |
| Base directory | `/services/browser-runner` |
| Dockerfile location | `/Dockerfile` (relative to the base directory) |
| Ports exposes | `8787` |
| Domain | `https://runner.journeyperfect.com` (Traefik terminates TLS with Let's Encrypt; HTTP redirects to HTTPS) |
| Health check | enabled, `GET /healthz` on port `8787`, start period 30s |
| Custom docker run options | `--shm-size=1g` |
| Persistent storage | named volume `rwtji13ctlsh9ah3xqv1k53o-browser-runner-data` mounted at `/data` |
| Auto deploy on push | on (same as the main app) |

Recreating it from scratch with the API (`POST /api/v1/applications/public`) is
possible with these fields: `project_uuid`, `environment_uuid`, `server_uuid`,
`destination_uuid`, `git_repository`, `git_branch`, `build_pack: "dockerfile"`,
`base_directory`, `dockerfile_location`, `ports_exposes`, `domains`,
`health_check_enabled`, `health_check_path`, `health_check_port`,
`custom_docker_run_options`, `is_auto_deploy_enabled`, `instant_deploy: false`.
The UI works too: **+ New Resource → Public Repository → Dockerfile**.

## 1. Persistent storage

Sealed Chromium profiles (`/data/sealed/<userId>.bin`, tens of MB each) live on
the `/data` volume. Losing it only forces users to sign in again; it holds no
credentials. The Dockerfile's `VOLUME ["/data"]` alone is **not** enough: Coolify
recreates the container on every deploy, and an anonymous volume would be
replaced each time.

Coolify v4 beta.468's API has no endpoint for adding storage to an application,
so the volume was added with Coolify's own model, which creates the same row as
**Storages → + Add → Volume** in the UI:

```sh
ssh root@134.122.113.128 'docker exec coolify php artisan tinker --execute="
\$a=App\Models\Application::where(\"uuid\",\"rwtji13ctlsh9ah3xqv1k53o\")->first();
App\Models\LocalPersistentVolume::create([\"name\"=>\$a->uuid.\"-browser-runner-data\",\"mount_path\"=>\"/data\",\"host_path\"=>null,\"resource_id\"=>\$a->id,\"resource_type\"=>get_class(\$a)]);"'
```

Using the UI is simpler if you are recreating the resource by hand.

Chromium and the unsealed profiles use tmpfs. Docker's default `/dev/shm` is
64 MB, which is too small, so the resource sets `--shm-size=1g` in
**Custom Docker Run Options**. Coolify translates that to `shm_size` in the
compose file it generates. Check it with
`docker inspect <container> --format '{{.HostConfig.ShmSize}}'`, which should print 1073741824.
Without it the service falls back to `/tmp` and Chromium runs with
`--disable-dev-shm-usage`, so it still works, just not in RAM.

## 2. Environment variables

| Variable | Value |
| --- | --- |
| `BROWSER_RUNNER_SECRET` | `openssl rand -hex 32`. Set the **same** value on the Next.js app. |
| `PRIVATE_RATES_MASTER_KEY` | `openssl rand -base64 32`. **Only on this service.** Rotating it invalidates every sealed profile, so users have to sign in again. |
| `LIVE_VIEW_PUBLIC_URL` | `https://runner.journeyperfect.com` |
| `LIVE_VIEW_ALLOWED_ORIGIN` | `https://journeyperfect.com,https://www.journeyperfect.com`. The live-view WebSocket refuses upgrades whose `Origin` is not the app, so a hostile page cannot spend a user's one-time live-view token. Unset, any origin is accepted and the service logs a warning at boot. |

All four are runtime-only: *Available at Buildtime* is off, so the secrets are
never passed as build args. The production values are kept in
`~/.gstack/journeyperfect-runner-secrets` on the operator's laptop (mode 600).

Optional: `SESSION_LOGIN_TIMEOUT_MS`, `MAX_RUN_MS`, `HILTON_RATE_CODE_PARAM`
(see README). Leave `DATA_DIR` and `PORT` at their defaults.

## 3. How the app finds the runner

The Next.js app does **not** read a `BROWSER_RUNNER_URL` environment variable.
It reads:

- the runner's base URL from the **DB config key `privateRates.runnerUrl`**
  (AppConfig table, edited at **/admin/settings**, cached for 60s). In
  production it is `https://runner.journeyperfect.com`.
- the bearer secret from the app's **`BROWSER_RUNNER_SECRET`** env var.

Use the public HTTPS URL. The config key's built-in default,
`http://browser-runner:8787`, does not resolve on Coolify. Containers are
named after the resource uuid plus a deploy suffix (for example
`rwtji13ctlsh9ah3xqv1k53o-133255528912`), not after the resource name, and that
name changes on every deploy.

## 4. Networking: public API and live view

Two callers talk to this container, both through
`https://runner.journeyperfect.com`:

1. **The Next.js app** calls the HTTP API (`/sessions`, `/run`, …). Every route
   except `/healthz` requires the bearer secret.
2. **The user's browser** opens the WebSocket at
   `wss://runner.journeyperfect.com/live/<sessionId>?token=…` to see and drive
   the Hilton sign-in page. It must be HTTPS/WSS because the app is HTTPS, and a
   `ws://` URL would be blocked as mixed content. Traefik passes WebSocket
   upgrades through by default.

DNS: an A record `runner.journeyperfect.com → 134.122.113.128` in the
DigitalOcean-managed `journeyperfect.com` zone.

**Never expose port 8787 directly** on the droplet firewall. Traefik is the only
way in.

## 5. Health check

`GET /healthz` (unauthenticated) on port 8787 returns `{"ok":true}`. It is
configured as the Coolify health check, and the Dockerfile also declares a
`HEALTHCHECK`.

## 6. Smoke test (run from inside the app container)

The app image has no `curl`, so use `node`:

```sh
ssh root@134.122.113.128
c=$(docker ps --filter name=h7ayr5f0enc6c2b2osy1wtil- --format '{{.Names}}' | head -1)
docker exec $c node -e '
const H={Authorization:"Bearer "+process.env.BROWSER_RUNNER_SECRET,"content-type":"application/json"};
fetch("https://runner.journeyperfect.com/sessions",{method:"POST",headers:H,body:JSON.stringify({userId:"smoke-test"})})
  .then(r=>r.json()).then(j=>console.log(j.sessionId, j.liveViewUrl.replace(/token=.*/,"token=***")))'
# poll GET /sessions/<id>/status, then clean up. Send DELETE without a
# content-type header: Fastify rejects an empty JSON body with 400.
docker exec $c node -e 'fetch("https://runner.journeyperfect.com/users/smoke-test",{method:"DELETE",headers:{Authorization:"Bearer "+process.env.BROWSER_RUNNER_SECRET}}).then(r=>console.log(r.status))'
```

Expected: `201` with a `wss://runner.journeyperfect.com/live/…` URL, status
`AWAITING_LOGIN`, a live-view upgrade that returns 101 with `Origin:
https://journeyperfect.com` and 403 for any other or missing origin, and `204`
from the DELETE.

## 7. Checklist before flipping `privateRates.enabled`

- [x] `/healthz` returns `{ok:true}` through the public domain over HTTPS.
- [x] `POST /sessions` from inside the app container returns a session and a `wss://runner.journeyperfect.com/live/…` URL.
- [ ] Open the live view from the JourneyPerfect UI and confirm the Hilton sign-in page renders. **2026-09-28: it did not.** hilton.com served its Akamai "SOMETHING WENT WRONG / Reference No. 18.…" error page to headless Chromium on the droplet, and the runner still reported `AWAITING_LOGIN` rather than `CHALLENGE`.
- [x] `DELETE /users/smoke-test` afterwards.
- [x] Volume at `/data` is a named Coolify volume (persistent across redeploys).
- [ ] Counsel has looked at §6.8 of the plan.
