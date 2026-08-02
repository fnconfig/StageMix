# Stage Mix — Production Readiness Report
## 2026-08-02

---

# 1. Production Readiness

## Configuration
**OK.** `data/config.json` via `store.js` — simple, single-file, readable. No secrets in code. Default password (`admin123`) with scrypt hash. Mixer settings (host/port/mode/fader bounds) all configurable via admin UI and persisted. Reset to defaults on missing/corrupt config file.

**Gap**: No config validation on load. A malformed JSON silently replaces with `defaultConfig()` — good for recovery, but drops all user data without warning. Low risk in practice (only corrupted by manual editing).

## Startup
**OK.** `server/index.js` is clean: `store.load()`, `app.listen()`, `startMixerClient()`, `wss = new WebSocketServer(...)`. Sequential, no async races. Mock mode simulates a 300ms connect delay.

**Gap**: No startup health signal — `console.log` only. PM2/systemd can't probe readiness without a health endpoint.

## Shutdown
**MISSING.** No `SIGTERM`/`SIGINT` handler. Process killed mid-request will drop TCP socket uncleanly. No graceful close of Express server, WebSocket server, or RCP socket. PM2/systemd will force-kill after timeout.

## Logging
**MINIMAL.** Only `console.log` on startup. No request logging, no error logging, no RCP connection logging. Production needs at minimum: request method/url/status/duration, RCP connect/disconnect/error, and uncaught exceptions.

## Error Handling
**OK for the happy path, fragile on edges.**
- `rcpClient.js`: `_send()` rejects if not connected. 3s timeout per command. Timeout destroys socket (forces reconnect). Close handler fails all pending queue items. OK.
- `rcpClient.js`: Reconnect delay: `Math.min(delay * 1.5, 15000)`. Good backoff but cap is 15s, spec says 30s.
- `server/index.js`: Fader/mute endpoints catch RCP errors and return 502. OK.
- `server/index.js`: Channel fetch uses `Promise.all` with per-channel try/catch — one bad channel doesn't kill the batch. Good.
- **Gap**: No global `uncaughtException`/`unhandledRejection` handler. A thrown error in a non-async path (e.g., `JSON.stringify` on circular ref) will crash the process.

## Reconnect Logic
**OK with caveats.**
- `rcpClient.js` close handler: `setTimeout(() => this._connect(), delay)`. Delay multiplies `* 1.5` capped at 15s. Resets to 1s on successful connect.
- `server/index.js` `startMixerClient()`: calls `rcp.stop()` then creates new client. Socket cleanup happens in `stop()` → `socket.destroy()`.
- Broadcasts `mixerStatus` on every connect/disconnect/error. Frontend updates status bar immediately.
- **Gap**: No max retries — will retry forever. Usually desirable for this use case but could fill logs on permanent failure.

---

# 2. Security

## REST Endpoints
**Mix of OK and concerning.**

| Endpoint | Auth | Issue |
|---|---|---|
| GET /api/mixes | None | Returns visible mixes only — OK |
| POST /api/session | None | Accepts any name+mixId. Mix must be visible — OK |
| GET /api/channels | x-session-token | **No channel-in-mix validation** — user gets all channels, but only sees those mix.channelIds includes. Server-side pre-filtered by `mix.channelIds` — OK |
| POST /api/fader | x-session-token | **CRITICAL**: Validates channel exists but NOT that it belongs to user's mix. Any user can set level on any channel in any mix. |
| POST /api/mute | x-session-token | **CRITICAL**: Same flaw. Any user can mute any channel in any mix. |
| POST /api/admin/* | x-admin-token | Token checked per-request. OK. |

## Authentication
- **Admin**: Password → scrypt hash → UUID token in sessionStorage. Token stored in `db._adminToken` (in-memory, survives server restart via config.json but not validated across restarts — actually `_adminToken` is persisted in config.json so it survives). Token cleared on logout. OK.
- **User**: Name → UUID token in localStorage. No password. Sessions are soft — removed by admin broadcasts `sessionRemoved`. Token checked on every request. OK for the use case (church band, LAN-adjacent).

## Input Validation
**WEAK.**
- `name` in `/api/session`: trimmed, `!name.trim()` check. No length/sanitization beyond that. Max 40 chars in HTML but server doesn't enforce.
- `channelId`, `mixId`: matched against in-memory arrays. No type checking (string expected, no coercion guard).
- `level` in `/api/fader`: `Number(level)`, clamped to faderMin/faderMax. Fails open if `level` is `NaN` (clamped to min). OK.
- `password` in `/api/admin/password`: min 4 chars. OK.
- `count` in `/api/admin/channels/count`: `Math.max(1, Math.min(40, Number(count) || 16))`. OK.
- **Gap**: No request body size limit. No rate limiting. Express `express.json()` has default 100kb limit — adequate but implicit.

## WebSocket Validation
**OK.** `GET /ws` has no auth — only broadcasts server-side events. Client verifies `sessionRemoved` against its own session name. No client-to-server WS messages (read-only broadcast). Low risk.

## JSON Validation
**Implicit.** `express.json()` rejects malformed JSON with 400. Body fields accessed without schema validation — missing fields become `undefined`, which most handlers treat gracefully (or clamp to defaults).

---

# 3. Reliability

## Reconnect Behaviour
**OK.** `rcpClient.js` has solid reconnect loop: backoff multiplier, queue drain on close, fresh socket per attempt. `mockRcpClient.start()` has a race: `connected` set after 300ms, but `_latency()` checks it synchronously — if a request arrives in that 300ms window, it throws.

## Uncaught Exceptions
**MISSING.** No `process.on('uncaughtException')` or `unhandledRejection` handler. Process crashes on unhandled throws.

## Resource Leaks
**OK.** `rcpClient.stop()` destroys socket. `startMixerClient()` calls `stop()` before creating new client. Queue timers cleared on close. No file handles left open (config read via `readFileSync`, write via `writeFileSync`). WebSocket server uses same HTTP server — closed when Express closes.

**Gap**: No cleanup on `SIGTERM`.

## TCP Lifecycle
**OK.** Single socket, serialized commands, 3s per-command timeout that destroys socket on expiry (forces clean reconnect). `NOTIFY` lines handled outside queue (emitted immediately).

## WebSocket Lifecycle
**OK.** Client reconnects on close with 2s delay (`ws.onclose → setTimeout(connectWs, 2000)`). Server sends current `mixerStatus` on each new WS connection. No heartbeat/ping — idle connections could time out behind proxies (Cloudflare Tunnel has 100s default timeout).

## Graceful Shutdown
**MISSING.** No signal handlers. Process receives `SIGTERM` from PM2/systemd → immediate death. Active TCP/WS connections dropped without close frames.

---

# 4. Deployment

## PM2 vs systemd

**Recommend: PM2.**

Reasons:
- Node.js-native process manager. Built-in log rotation, watch mode, cluster mode (if ever needed), `pm2 save` for startup persistence.
- Simpler config: `pm2 start server/index.js --name stage-mix` vs writing a systemd unit file with `User=`, `WorkingDirectory=`, `ExecStart=`, `Restart=`, environment, etc.
- PM2 handles `SIGINT` gracefully (sends to child, waits, then `SIGKILL`) — but the app still needs a signal handler for clean shutdown.
- systemd would work fine but adds a unit file that needs root to install. PM2 runs as the app user.
- `pm2 startup` + `pm2 save` survives host reboots.

If the server already uses systemd for everything else, systemd is fine — the difference is minor for a single-process Node app.

---

# 5. Environment Configuration (.env)

**Recommend: NO.**

The app uses `data/config.json` for all settings including mixer host/port/mode. This is already a flat file, already read at startup, already persisted. Moving to `.env` would:
- Split config across two files (`.env` for secrets, `config.json` for app state)
- Break the admin UI's ability to change mixer settings (writes go to config.json, not `.env`)
- Add a dependency (`dotenv`) for one `process.env.PORT || 3000` that already works

The only env var currently used: `process.env.PORT || 3000`. That's already a standard 12-factor pattern. No change needed.

**Exception**: if the admin password should survive config.json resets or not be visible in the admin UI's config dump, move only `passwordHash` to `.env`. But this is low priority — the config dump is admin-only anyway.

---

# 6. Logging

**Current state:** One `console.log` on startup. That's it.

**Recommendation**: Add minimal structured logging to stdout (PM2 captures it). No frameworks needed.

What to log:
- Request: method, url, status, duration (Express middleware, 3 lines)
- RCP: connect, disconnect (with reason), command errors
- Admin actions: login, logout, session removal

**Do NOT add**: Winston, pino, log levels, log files, rotation. PM2 handles file rotation. stdout is sufficient.

---

# 7. Health Endpoint

**Recommend: YES.** `/health` — no auth, returns JSON. Implement when approved.

```json
{
  "status": "ok",
  "uptime": 12345.6,
  "version": "1.0.0",
  "mixer": { "mode": "real", "connected": true },
  "timestamp": "2026-08-02T16:45:00Z"
}
```

Use case: PM2 `pm2-health` or Cloudflare Tunnel health checks can hit this. Lightweight — no mixer command, just reads `mixerStatus.connected`.

---

# 8. Cloudflare Deployment

**Already deployed and working** (verified: tunnel healthy, 4 connections, SIN colos).

Considerations:
- **HTTPS**: Cloudflare terminates TLS. App runs HTTP on localhost. Express doesn't know it's behind a proxy. `req.ip` will show Cloudflare's IP, not the user's. `req.protocol` will be `http`. Not a problem — the app doesn't use either.
- **WebSocket**: Cloudflare supports WS on all plans. Current WS path `/ws` — no special config needed. Cloudflare's 100s idle timeout applies — if no messages for 100s, connection drops. Frontend reconnects automatically (2s delay), so this is handled.
- **Headers**: Cloudflare adds `CF-Connecting-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`. Not used by the app — no change needed.
- **Timeouts**: Cloudflare Tunnel has no hard timeout on long-lived connections. RCP TCP goes through Tailscale, not Cloudflare — unaffected.

**No adjustments needed.**

---

# 9. Tailscale

RCP traffic flows: `Node.js → Tailscale → Church PC (subnet router) → Church LAN → TF5`.

Considerations:
- **Reconnect**: `rcpClient.js` reconnects on any TCP error/close. Tailscale outages look like TCP disconnects → auto-reconnect loop until VPN restores. App survives.
- **Latency**: Tailscale adds ~5-20ms over direct LAN. TF RCP is plain-text TCP with no real-time constraints (poll-based, not streaming). Negligible impact.
- **Temporary VPN interruption**: TCP socket drops. `rcpClient` close handler fires → backoff reconnect. All pending commands rejected. Frontend shows "reconnecting". Band members see stale fader positions until next fetch. Acceptable for this use case.
- **DNS**: If TF5 is addressed by hostname (not IP), Tailscale MagicDNS or church LAN DNS must resolve it. Currently config uses IP (`192.168.1.50`) — no DNS dependency. OK.

**No adjustments needed.** The single-TCP + auto-reconnect design handles Tailscale interruptions correctly.

---

# 10. Failure Recovery

| Scenario | What happens | Recovery | OK? |
|---|---|---|---|
| **TF5 restarts** | RCP socket closes. `rcpClient` emits `status: false`. Reconnect loop starts (1s→15s backoff). Frontend shows red banner. | Auto-reconnects when TF5 back. Band members see stale faders until then. | OK |
| **Ubuntu restarts** | Everything dies. PM2/systemd starts Node on boot. Cloudflare Tunnel reconnects. Tailscale reconnects. | App starts in mock mode unless mixer config persists. Real mode: RCP connects when TF5 reachable. | OK (with PM2/systemd autostart) |
| **Church PC restarts** | Tailscale subnet route drops. RCP socket closes (TCP to TF5 unreachable). Reconnect loop starts. | Auto-reconnects when PC back + Tailscale re-establishes. | OK |
| **Internet lost** | Cloudflare Tunnel disconnects. App still running locally. RCP still connected (Tailscale is local network, internet independent unless ISP link shared). | External users can't reach app. Local users on same LAN could use direct IP. Tunnel auto-reconnects when net returns. | Partial — external unreachable |
| **Cloudflare Tunnel disconnects** | External access lost. App still running. RCP unaffected. | Tunnel auto-reconnects (cloudflared handles this). | OK |
| **Tailscale disconnects** | RCP socket drops. Reconnect loop starts. | Auto-reconnects when Tailscale back. | OK |

**No single point of failure that breaks everything permanently.** Worst case: TF5 unreachable → app runs in degraded mode (faders don't reach console, red banner shown). Recovers automatically when path restores.

---

# Summary — Recommended Changes

## Critical
1. **Fix authorization bypass in `/api/fader` and `/api/mute`** — validate channel belongs to user's assigned mix. Currently any user can control any channel in any mix.
2. **Add graceful shutdown** — handle `SIGTERM`/`SIGINT`, close RCP socket, close HTTP server, drain WS connections.
3. **Add uncaught exception handler** — log and exit cleanly instead of silent crash.

## Important
4. **Add request logging** — Express middleware: method, url, status, ms. stdout.
5. **Add health endpoint** — `GET /health`, no auth, JSON status.
6. **Increase reconnect cap** — `rcpClient.js`: 15000 → 30000 per spec.
7. **Add server-side input validation** — name length (40), trim. Already done in HTML but not enforced server-side.

## Optional
8. **Rate limiting** — 100 req/min per IP on `/api/fader` and `/api/mute` (prevent accidental spamming, not a security boundary).
9. **Config backup on load** — if config.json is corrupted, save old file as `config.json.bak` before resetting to defaults.
10. **WS ping/pong** — keep connections alive through Cloudflare's 100s idle timeout (currently handled by reconnect, but ping is cleaner).
