# Production runner on the home Mac Studio

Since 2026-10-02 the production browser-runner runs on the Mac Studio on the
home network, not in Coolify. The public endpoint is unchanged:
`https://runner.journeyperfect.com` (HTTP API for the app, `wss://…/live/…`
for the user's live view). The goal was a residential IP, because hilton.com
returns 403 to every request from the droplet.

**Status (2026-10-02): this did not unblock Hilton.** From the Mac Studio,
Playwright Chromium, headless and headed, still gets Akamai's
"SOMETHING WENT WRONG / Reference No. 18.…" page on `/en/go-hilton/`, and the
runner correctly ends the session as `CHALLENGE` / `BLOCKED`. A plain `curl`
from the Mac Studio also gets 403 there. The plumbing below works end to end.

```
user's browser ─┐                       droplet 134.122.113.128                       Mac Studio (home)
JourneyPerfect ─┴─ https/wss ─▶ Traefik (coolify-proxy) ─▶ 10.0.1.1:18787 ══ssh -R══▶ 127.0.0.1:8787 node dist/index.js
app container                   dynamic/journeyperfect-runner.yaml      (sshd, runnertunnel)        (launchd agents)
```

No inbound port is opened on the home network: the Mac Studio dials out to the
droplet over SSH and holds a reverse forward.

## Mac Studio (`studio@<LAN IP>`)

The LAN IP is DHCP-assigned. It was 192.168.0.73 and moved to 192.168.0.74
(same SSH host key). Nothing depends on it except operator SSH; a DHCP
reservation on the UniFi gateway would keep it stable.

| Item | Location |
| --- | --- |
| Code (rsync of this directory, no `node_modules`) | `~/journeyperfect-runner` |
| Env file, mode 600 | `~/journeyperfect-runner/.env` |
| Sealed profiles | `~/journeyperfect-runner/data/sealed/` |
| Logs | `~/journeyperfect-runner/logs/{runner.out,runner.err,tunnel}.log` |
| Node | `/usr/local/bin/node` (v22) |
| Chromium | `~/Library/Caches/ms-playwright/` (`npx playwright install chromium`) |
| Runner agent | `~/Library/LaunchAgents/com.journeyperfect.runner.plist` (copy of `home-runner/`) |
| Tunnel agent | `~/Library/LaunchAgents/com.journeyperfect.runner-tunnel.plist` |
| Tunnel key | `~/.ssh/jp_runner_tunnel` (ed25519, no passphrase, used only for the tunnel) |

`.env` holds `BROWSER_RUNNER_SECRET` and `PRIVATE_RATES_MASTER_KEY` (the same
values as the old Coolify app; source of truth `~/.gstack/journeyperfect-runner-secrets`
on the operator laptop), plus `DATA_DIR=/Users/studio/journeyperfect-runner/data`,
`HOST=127.0.0.1`, `PORT=8787`, `LIVE_VIEW_PUBLIC_URL=https://runner.journeyperfect.com`,
`LIVE_VIEW_ALLOWED_ORIGIN=https://journeyperfect.com,https://www.journeyperfect.com`,
`HEADLESS=true`. `home-runner/start.sh` sources it and execs `node dist/index.js`.
The runner listens on loopback only.

Both agents have `RunAtLoad` and `KeepAlive`. They live in the `gui/<uid>`
domain, so they run while `studio` is logged in (it is the console user).
System sleep is `0` in `pmset`. The Mac must stay on and logged in.

The disk was 100% full (about 3 GB free) at install time. Sealed profiles are
tens of MB each, but a full disk will break Chromium.

### Deploy a code change

```sh
cd services/browser-runner
rsync -a --exclude node_modules --exclude dist --exclude data --exclude .env --exclude logs \
  ./ studio@192.168.0.74:journeyperfect-runner/
ssh studio@192.168.0.74 'export PATH=/usr/local/bin:$PATH; cd ~/journeyperfect-runner &&
  npm ci && npx playwright install chromium && npm run build &&
  launchctl kickstart -k gui/$(id -u)/com.journeyperfect.runner'
```

### Restart / inspect

```sh
launchctl kickstart -k gui/$(id -u)/com.journeyperfect.runner          # runner
launchctl kickstart -k gui/$(id -u)/com.journeyperfect.runner-tunnel   # tunnel
launchctl print gui/$(id -u)/com.journeyperfect.runner | grep -E 'state|pid'
curl -s http://127.0.0.1:8787/healthz
# stop entirely:
launchctl bootout gui/$(id -u)/com.journeyperfect.runner-tunnel
launchctl bootout gui/$(id -u)/com.journeyperfect.runner
```

## Droplet side

**Tunnel user `runnertunnel`**: system user, shell `/usr/sbin/nologin`,
password locked. `/home/runnertunnel/.ssh/authorized_keys` has the Mac Studio
key with
`restrict,port-forwarding,permitlisten="10.0.1.1:18787",command="/bin/false"`.
`/etc/ssh/sshd_config.d/70-runnertunnel.conf` has a `Match User runnertunnel`
block: `GatewayPorts clientspecified`, `AllowTcpForwarding remote`, no TTY,
agent or X11 forwarding. Global `GatewayPorts` stays `no`. Verified: a shell or
command is refused, a remote forward on any other address or port fails, and
local forwards are "administratively prohibited".

**Bind address**: `10.0.1.1` is the gateway of the `coolify` Docker network
(`docker network inspect coolify`). Traefik reaches it as a host address. ufw
(default INPUT DROP) has one rule for it:
`ufw allow from 10.0.1.0/24 to 10.0.1.1 port 18787 proto tcp`. Port 18787 is
not reachable from the internet (checked from outside).

**Traefik route**: `/data/coolify/proxy/dynamic/journeyperfect-runner.yaml`
(mounted in `coolify-proxy` at `/traefik/dynamic/`, watched, no reload needed).
It has an `http` router that redirects to HTTPS and an `https` router with
`certResolver: letsencrypt`, both for ``Host(`runner.journeyperfect.com`)`` →
`http://10.0.1.1:18787`. WebSocket upgrades pass through.

Check from the droplet:
`docker exec coolify-proxy wget -qO- http://10.0.1.1:18787/healthz`.

**Old Coolify app** `browser-runner` (`rwtji13ctlsh9ah3xqv1k53o`) is
**stopped**, not deleted, and its auto deploy on push is **off**. Its volume
`rwtji13ctlsh9ah3xqv1k53o-browser-runner-data` still exists. If it is started
again, its container labels claim the same host with a longer rule
(`Host && PathPrefix`) and win over the file route.

## Roll back to the Coolify container

1. Start the app: Coolify UI → browser-runner → Start, or
   `GET /api/v1/applications/rwtji13ctlsh9ah3xqv1k53o/start` with the API token.
   Optionally turn auto deploy back on.
2. `rm /data/coolify/proxy/dynamic/journeyperfect-runner.yaml` on the droplet.
   The container's labels then serve the host, as before.
3. On the Mac Studio, `launchctl bootout` both agents (above).
4. Optional cleanup: `userdel -r runnertunnel`,
   `rm /etc/ssh/sshd_config.d/70-runnertunnel.conf && systemctl reload ssh`,
   and `ufw delete allow from 10.0.1.0/24 to 10.0.1.1 port 18787 proto tcp`.

Sealed profiles do not carry over between the two hosts. Users sign in again
after a switch.

## Smoke test

Run the same checks as COOLIFY.md §6 (from the app container). The result on
2026-10-02 was `201` for POST /sessions, then status `CHALLENGE` / `BLOCKED`
within a few seconds (Hilton's Akamai page), then `204` for the DELETE. The
live-view upgrade through the tunnel returned 401 for a bad token and 403 for
a bad Origin.
