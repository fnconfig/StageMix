# Stage Mix

Self-hosted **band monitor-mix web app** for Yamaha TF-series digital consoles.
Each band member opens a URL on their own phone (no app install), types their
name, picks their monitor (aux) send, and drags their own faders — **Send on
Fader** over Yamaha's **RCP** protocol (TCP port `49280`).

> This is the single source of truth for the project: overview, tech stack,
> architecture, API, deployment, operations and history. The previous
> `AI_*.md`, `tech-stack.md`, `PRODUCTION_READINESS_REPORT.md` and dated status
> reports were consolidated into this file.

---

## 1. What it is

| | |
|---|---|
| **Package** | `monitor-mix-app` v1.0.0 (`package.json`) |
| **Purpose** | Let each musician control their own monitor mix from their phone |
| **Hardware** | Yamaha TF1 / TF3 / TF5 / TF-Rack (RCP over TCP `49280`) |
| **Runtime** | Node.js ≥ 18, Express 4, `ws` 8 |
| **Frontend** | Vanilla HTML/CSS/JS single-page app — **no framework, no build step** |
| **Storage** | Single JSON file (`data/config.json`) |
| **Install** | None for users — they just open a URL on the same Wi-Fi/LAN |

Two user roles:

- **Band member (normal user)** — no login. Enter name → select aux channel →
  drag faders / mute their own monitor sends. Also gets an aux **master** fader.
- **Sound desk operator (admin)** — username + password. Controls which aux
  mixes are visible, which channels appear in each mix and in what order,
  channel/aux naming, console connection, admin accounts, the landing cover,
  active users, and a raw console command box.

---

## 2. Quick start

### Windows (normal case — the sound laptop)

```bat
stagemix start        :: or double-click start.bat
stagemix status
stagemix stop         :: or double-click stop.bat
stagemix restart      :: or double-click restart.bat
```

`stagemix.cmd` is a thin wrapper around `scripts\stagemix.ps1` (Windows
PowerShell 5.1) and accepts:

| Command | Effect |
|---|---|
| `start` | Installs deps on first run, starts Node hidden in the background, writes `logs\stagemix.pid`, and opens the tray indicator |
| `stop` | Stops the server (PID file, else the node process listening on the port) and closes the tray icon |
| `restart` | Stop → 700 ms → start |
| `status` | Reports whether the app is running (PID file, else HTTP `/health` probe) |
| `tray` | Re-open the tray indicator (green = running, red = stopped) |
| `install` | Adds this folder to the **user PATH** so `stagemix` works from any shell |
| `uninstall` | Removes that PATH entry |
| `help` | Usage |

Logs: `logs\stagemix-out.log`, `logs\stagemix-err.log`.
Port override: set `STAGEMIX_PORT` (launcher) or `PORT` (server) — default `3000`.

The tray indicator polls `/health` every 3 s and its right-click menu offers
*Open web UI / Start / Stop / Restart / Exit*.

### Manual / Linux

```bash
npm install
npm start            # node server/index.js
```

Then open `http://localhost:3000` on the sound desk machine and
`http://<this-computer's-LAN-IP>:3000` on the band's phones.

The app starts in **simulated mixer mode** (`mode: "mock"`) so the whole flow —
join, faders, mutes, admin — can be exercised with no console attached.

**Default admin password is `admin123` — change it immediately** (Mixer Link tab
→ admin users, or Channels/Appearance tab → Admin users).

---

## 3. Tech stack

### Frontend (`public/`)
| Technology | Use |
|---|---|
| **HTML5** | SPA shell: landing, name entry, mix picker, fader rack, admin dashboard |
| **CSS3 (vanilla)** | Dark design system, CSS variables, Flexbox/Grid, glassmorphism |
| **Container queries** | `container-type: inline-size` + `clamp(…cqi…)` so channel names and dB readouts autofit narrow fader strips |
| **Fonts** | Google Fonts — Oswald (headings), Inter (UI), JetBrains Mono (dB/technical) |
| **Vanilla JS (ES6+)** | Client routing, pointer/touch fader drag, REST client, WebSocket lifecycle, admin panels. No React/Vue/Angular/TypeScript, ever |

### Backend (`server/`)
| Technology | Use |
|---|---|
| **Node.js ≥ 18** | CommonJS (`"type": "commonjs"`), entry `server/index.js` |
| **Express 4** | REST API, static assets, JSON body parsing (`12mb` limit for base64 cover uploads), request logging, session/admin middleware |
| **`ws` 8** | WebSocket server on `/ws` — live status, live fader mirroring, admin boot events |
| **`net.Socket`** | One persistent TCP socket to the console (RCP, port `49280`) |
| **`crypto`** | `scryptSync` password hashing (salt + `timingSafeEqual` verify), `randomUUID` tokens |
| **JSON file store** | `server/store.js` → `data/config.json` (config, sessions, password hashes) |
| **`os` / `fs`** | LAN IP auto-detection for the Share tab; cover image streaming |

### Operational layer
- **Windows launchers** — `stagemix.cmd` + `scripts/*.ps1` (background start, PID file, tray indicator)
- **PM2 or systemd** — for the Ubuntu server deployment (PM2 recommended: log rotation, restart-on-boot, no root unit file)
- **Cloudflare Tunnel** — public HTTPS ingress
- **Tailscale** — private mesh VPN carrying RCP traffic to the church LAN
- **`/health`** — unauthenticated JSON endpoint for supervisors/tunnel health checks

---

## 4. Architecture

```
        Phones / tablets / sound-desk browser
                     │  HTTP REST (faders, mutes, admin)
                     │  WebSocket /ws (live status + mirroring)
                     ▼
        ┌───────────────────────────────────────────┐
        │        Node.js + Express (port 3000)      │
        │  session & admin middleware · JSON store  │
        │  WebSocket broadcast · NOTIFY parser      │
        └───────────────────┬───────────────────────┘
                            │  ONE persistent TCP socket (RCP, 49280)
                    ┌───────┴────────┐
                    ▼                ▼
           Real Yamaha TF       Mock RCP emulator
           (mode: "real")       (mode: "mock")
```

Design rules the code holds to:

1. **Exactly one TCP connection** to the console. RCP has no correlation IDs, so
   commands are serialized through a FIFO queue on that single socket.
2. **The browser never talks to the mixer.** Every request is relayed by Express.
3. **Server owns validation.** Fader/mute/DCA requests are checked against the
   user's own assigned mix before anything reaches the console.
4. **Never crash on disconnect** — reconnect with backoff, keep serving, and tell
   every client via a `mixerStatus` broadcast.
5. **Zero frontend dependencies.** No build step, no framework, no TypeScript.

---

## 5. Project structure

```
Stagemix/
├── public/                       frontend, served statically (no-store)
│   ├── index.html                SPA shell + all views
│   ├── app.js                    routing, fader mechanics, WS client, admin UI
│   ├── styles.css                dark design system, fader rack, landing cover
│   └── cover-default.jpg         bundled default landing photo
├── server/                       backend
│   ├── index.js                  Express routes, WS broadcast, NOTIFY parser
│   ├── rcpClient.js              real RCP TCP client for Yamaha TF
│   ├── mockRcpClient.js          drop-in simulator, same interface
│   └── store.js                  config persistence, scrypt hashing, migrations
├── scripts/                      Windows operational layer
│   ├── stagemix.ps1              start/stop/restart/status/tray/install
│   ├── stagemix-common.ps1       shared paths, PID/health helpers
│   └── stagemix-tray.ps1         system-tray status indicator
├── data/config.json              runtime config + sessions (git-ignored)
├── logs/                         stdout/stderr, PID files (git-ignored)
├── stagemix.cmd                  CLI launcher
├── start.bat / stop.bat / restart.bat   double-click wrappers
├── package.json                  deps: express, ws — Node ≥ 18
└── README.md                     this file
```

Views: `view-landing`, `view-user-name`, `view-user-mix`, `view-user-fader`,
`view-admin-login`, `view-admin-dash`.
Admin tabs: **Aux Mixes · Active Users · Channels · Mixer Link · Appearance ·
Share · Raw Console**.

---

## 6. Connecting to a real Yamaha TF console

1. On the console: **Setup → Network** → enable RCP / external control.
   Note its IP. RCP listens on **TCP 49280**.
2. In the app: **Sound desk → Mixer Link** → set **Mode** to *Real TF console*,
   enter host + port `49280`, press **Connect**. *Retry connection* re-attempts
   without changing settings.
3. If the console is offline, **every** client (band members included) sees a red
   banner saying fader/mute changes won't reach the desk; it clears automatically
   when the link returns. A status dot in the top bar (grey/red = offline,
   teal = connected) is always visible.

### RCP commands used

| Path | Indices | Range | Meaning |
|---|---|---|---|
| `MIXER:Current/InCh/ToMix/Level` | `<ch 0-39> <mix 0-19>` | -32768..1000 | send level, dB × 100 (`-32768` = -∞) |
| `MIXER:Current/InCh/ToMix/On` | `<ch 0-39> <mix 0-19>` | 0/1 | send mute (1 = unmuted) |
| `MIXER:Current/InCh/Label/Name` | `<ch 0-39> 0` | string | channel name |
| `MIXER:Current/Mix/Label/Name` | `<mix 0-19> 0` | string | aux name |
| `MIXER:Current/Mix/Fader/Level` | `<mix 0-19> 0` | -32768..1000 | aux master level |
| `MIXER:Current/Mix/Fader/On` | `<mix 0-19> 0` | 0/1 | aux master on/off |
| `MIXER:Current/FxRtnCh/ToMix/Level\|On` | `<fx 0-3> <mix 0-19>` | as above | stereo return send |
| `MIXER:Current/DCA/Fader/Level\|On` | `<dca 0-7> 0` | as above | DCA group fader |
| `MIXER:Current/DCA/Label/Name` | `<dca 0-7> 0` | string | DCA name |

dB × 100 encoding: `10.00 dB = 1000`, `-60.00 dB = -6000`, `-∞ = -32768`.
Command shapes were pinned against the console's own `prminfo` self-description
(see bitfocus/companion-module-yamaha-rcp's `TF Parameters-1.txt`).

A TF only answers for channels/mixes it actually has (TF1 = 16 ch, TF3 = 24,
TF5 = 32; up to 20 mixes). Requests beyond that are treated as "not available"
rather than fatal.

### If it won't connect
RCP has **no password** on TF consoles (the only password-like setting belongs to
Yamaha's separate "MonitorMix" phone app). Usual causes, in order:

1. RCP/external control not enabled on the console.
2. Wrong IP, or the console has separate Dante and Network ports — RCP only works
   on the **NETWORK** port's IP.
3. App host and console not on the same subnet/VLAN.
4. Something else already holds the single RCP client slot (Companion, QLab,
   another instance of this app).
5. Windows Firewall blocking the outbound connection (rare).

Test the path outside the app:

```powershell
Test-NetConnection -ComputerName 192.168.18.89 -Port 49280   # TcpTestSucceeded must be True
```

Reconnect behaviour: delay starts at 1 s, multiplies ×1.5, capped at **15 s**
(spec asks for 30 s — see roadmap), reset to 1 s on a successful connect. Every
pending command is rejected cleanly when the socket drops. Per-command timeout is
**5 s** while connecting and disabled once connected; a mid-queue timeout destroys
the socket to force a clean reconnect rather than mismatching FIFO replies.

---

## 7. Running the desk (admin dashboard)

- **Aux Mixes** — the console's 16 aux sends are listed; flip the switch on the
  ones band members may pick. Each mix row has a **Channels** picker: an *ordered*
  list (▲▼ reorder, ✕ remove, "add" chips for channels not in the mix), plus
  select all/none. `mix.channelIds` order is the **single source of truth** for
  the order users see — there is no per-device override.
- **Pull names from console** (Aux Mixes tab) — one-shot fetch of real
  `InCh/Label/Name`, `FxRtnCh` and `Mix/Label/Name` values; overwrites only names
  the console actually answers for. Only touches the console when connected, and
  warns if you're still in **Simulated** mode (where it would fill in placeholders).
- **Channels** — rename inputs by hand and set how many are in use (up to 40;
  TF5 = 32, TF3 = 24, TF1/TF-Rack = 16). Set the count to match the desk *before*
  pulling names, since only existing channels are queried.
- **Stereo returns** — Fx 1–4 (`fx1…fx4`) can be assigned into mixes alongside
  mono inputs.
- **Active Users** — who is connected, which mix, and when they logged in
  (local date/time). Remove a user by name; their phone is kicked via a
  `sessionRemoved` broadcast.
- **Mixer Link** — host, port, mode (mock/real), fader dB range, reconnect,
  admin users.
- **Appearance** — upload a custom landing cover (PNG/JPEG/WebP/GIF, ≤ 8 MB,
  stored as `data/cover.jpg`, served through `/cover`) or reset to the bundled
  default photo.
- **Share** — auto-detected LAN address(es) to hand out to the band.
- **Raw Console** — send an arbitrary RCP line and read the reply. Useful for
  verifying values, e.g. `get MIXER:Current/InCh/ToMix/Level 0 0`, then moving that
  send on the physical desk and getting it again.

---

## 8. API reference

### REST — public
| Method | Path | Notes |
|---|---|---|
| GET | `/health` | `{ status, uptime, mixer }` — no auth, never touches the mixer |
| GET | `/api/landing` | `{ coverUrl }` active landing cover |
| GET | `/cover` | streams `data/cover.jpg` (404 if none uploaded) |
| GET | `/api/mixes` | `{ mixes: [{id,name}], mixerConnected }` — visible mixes only |
| POST | `/api/session` | `{ name, mixId }` → `{ token, name, mix }`; 400 if name missing or mix hidden |

### REST — normal user (`x-session-token`)
| Method | Path | Notes |
|---|---|---|
| GET | `/api/session/check` | `{ ok, name, mix }`; 401 unknown token, 410 removed by admin |
| GET | `/api/channels` | `{ mix:{id,name,index,masterLevel,masterOn}, channels[], dca[], mixerConnected }` — fetched **sequentially** (level then mute per channel) to keep the RCP queue short |
| POST | `/api/fader` | `{ channelId, level }` → clamped to the fader range; 400 unknown, 403 channel not in your mix, 502 console unreachable |
| POST | `/api/mute` | `{ channelId, muted }` — send mute for the user's mix only |
| POST | `/api/mix-master` | `{ level }` — aux master level for the user's mix |
| POST | `/api/mix-master-mute` | `{ muted }` — aux master on/off |
| POST | `/api/dca` | `{ dcaId, level }` — DCA group fader (scales the group on the main mix) |
| POST | `/api/dca-mute` | `{ dcaId, muted }` — DCA group on/off |

### REST — admin (`x-admin-token`)
| Method | Path | Notes |
|---|---|---|
| POST | `/api/admin/login` | `{ username?, password }` → `{ token, username }`; omitting `username` signs in as built-in `admin` |
| POST | `/api/admin/logout` | invalidates the calling token |
| GET | `/api/admin/users` | `{ users: [{username}], current }` — hashes never leave the server |
| POST | `/api/admin/users` | create account (username 1–40 chars, no `/` or `\`, password ≥ 4); 409 if taken |
| POST | `/api/admin/users/:username/password` | change a user's password |
| POST | `/api/admin/users/:username/remove` | delete account + kill its sessions; built-in `admin` and yourself are protected |
| POST | `/api/admin/password` | legacy change of the built-in `admin` password |
| GET | `/api/admin/config` | `{ mixer, mixerStatus, channels[], returns[], dca[], mixes[], sessions{}, users[], currentUser, coverUrl }` |
| POST | `/api/admin/cover` · `/api/admin/cover/reset` | upload base64 data URL / revert to default |
| GET | `/api/admin/network-info` | `{ addresses[], port }` |
| POST | `/api/admin/mixer` | `{ host?, port?, mode?, faderMinDb?, faderMaxDb? }` — triggers reconnect |
| POST | `/api/admin/mixer/reconnect` | reconnect without changing settings |
| POST | `/api/admin/mixes/:id` | `{ name?, visible?, channelIds? }` |
| POST | `/api/admin/channels/count` | set channel count (1–40), re-syncs every mix's `channelIds` |
| POST | `/api/admin/channels/:id` | rename a channel |
| POST | `/api/admin/sync-names` | pull names from the console (one-shot); 409 if not connected |
| POST | `/api/admin/sessions/remove` | `{ name }` — boot a user |
| POST | `/api/admin/raw` | `{ command }` → `{ ok, reply }` raw RCP |

### WebSocket — `GET /ws`
Clients send `{ type: "subscribe", mixId }` to receive mix-scoped messages.

| Message | Direction | Meaning |
|---|---|---|
| `mixerStatus` | → clients | `{ connected, host?, port?, error?, mock? }`; sent immediately on connect, then on every change |
| `sessionsChanged` | → clients | a user joined/left |
| `sessionRemoved` | → clients | `{ name }` — admin booted that user |
| `mixesChanged` | → clients | mix visibility/name changes |
| `mixConfigUpdated` | → mix subscribers | `{ mixId, name, visible, channels[] }` |
| `mixLevelUpdated` / `mixMuteUpdated` | → mix subscribers | another user (or the desk) moved a channel send |
| `mixMasterUpdated` / `mixMasterMuteUpdated` | → mix subscribers | aux master changed |
| `dcaLevelUpdated` / `dcaMuteUpdated` | → mix subscribers | DCA group changed |
| `notify` | → clients | raw console `NOTIFY` line, forwarded verbatim |

**Live mirroring.** Several people can share one aux mix: every successful write
is broadcast back to that mix's subscribers, and the desk's own `NOTIFY` lines
are parsed (`parseNotify()`) into the same messages — so a physical fader move or
a scene recall updates every phone without a reload. Clients skip a strip they are
actively dragging, and the desk never NOTIFYs the originating connection, so
there is no echo loop. Fader sends are throttled to ~10/s with a trailing send and
an immediate flush on release.

### `data/config.json` schema
```json
{
  "admin": {
    "users": [{ "username": "admin", "passwordHash": "salt:scrypt-hash" }],
    "passwordHash": "salt:scrypt-hash"
  },
  "mixer": { "host": "192.168.18.89", "port": 49280, "mode": "real", "faderMinDb": -60, "faderMaxDb": 10 },
  "channels": [{ "id": "ch1", "index": 0, "name": "Kick" }],
  "returns": [{ "id": "fx1", "kind": "fx", "index": 0, "name": "Fx 1" }],
  "dca": [{ "id": "dca1", "index": 0, "name": "DCA 1" }],
  "mixes": [{ "id": "mix1", "index": 0, "name": "PARKIR", "visible": true, "channelIds": ["ch1", "ch2"] }],
  "sessions": {
    "lowercase-name": { "name": "Original Case", "mixId": "mix1", "token": "uuid",
                        "joinedAt": 1234567890, "lastSeen": 1234567890, "removed": false }
  }
}
```

`store.js` is the only reader/writer. It migrates old files on load (single-admin
→ `users[]`, missing `dca`/`returns` arrays) and resets to `defaultConfig()` if the
file is missing or corrupt. Defaults: 16 channels, 16 mixes (only mix1 visible),
fader range −60…+10 dB, admin password `admin123`.

---

## 9. Security model

- **Admin** — username + password, scrypt (`scryptSync`) with a random per-hash
  salt, verified with `timingSafeEqual`. Multiple admin accounts are supported;
  the built-in `admin` account cannot be deleted and you cannot delete the account
  you are signed in with. Removing a user kills their live admin sessions.
  Tokens are stored in `sessionStorage`, so they clear when the tab closes.
- **Band member** — no password by design. A display name maps to a
  `crypto.randomUUID()` token kept in that phone's `localStorage` (survives
  reloads, not shared between devices). Sessions are soft: the admin can boot one
  by name.
- **Server-side authorisation** — `POST /api/fader`, `/api/mute`, `/api/dca` reject
  with **403** if the channel/DCA is not part of the caller's assigned mix. The
  browser is never trusted.
- **Input handling** — `express.json({ limit: "12mb" })` (cover uploads), numeric
  clamping of levels to the configured fader range, non-finite levels clamped on
  the way out so `JSON.stringify` can't emit `null`, channel counts clamped to
  1–40, admin username/password length checks.
- **Network** — the console is never exposed to the internet; Cloudflare exposes
  only HTTP/HTTPS, RCP rides Tailscale. `data/config.json` (password hashes,
  tokens) and `data/cover.jpg` are git-ignored.
- **Static assets** are served with `Cache-Control: no-store` plus a global
  `{ cache: "no-store" }` on the client fetch helper, so admin changes are never
  served stale.

---

## 10. Operations

- **Health** — `GET /health` → `{ status: "ok", uptime, mixer: { connected, … } }`.
  Used by the tray indicator and suitable for PM2/tunnel health checks.
- **Logging** — one line per HTTP request (method, path, status, duration — no
  tokens or bodies) plus `[RCP]` connect/disconnect/error lines, all to stdout;
  the Windows launcher redirects to `logs\stagemix-out.log` / `-err.log`.
- **Graceful shutdown** — `SIGTERM`/`SIGINT` are handled: the RCP socket is
  closed, the HTTP server and WebSocket server are shut down.
- **Crash safety** — `uncaughtException` / `unhandledRejection` handlers log and
  exit cleanly instead of dying silently.
- **Verification habit** — before a real rehearsal, use **Raw Console** to `get`
  a send level, move that send on the desk, and `get` it again to confirm the
  numbers line up.

---

## 11. Troubleshooting

| Symptom | Check |
|---|---|
| Phones can't open the page | Same Wi-Fi/LAN? Windows Firewall → allow Node.js on **Private** networks (the prompt appears on first `npm start`). Use the address from the **Share** tab |
| Faders move but nothing changes on the desk | Red banner visible? Mixer Link status dot. Confirm mode is *Real TF console*, host/port correct, RCP enabled |
| "Pull names" gives placeholder names | Still in **Simulated** mode — switch Mixer Link to *Real TF console* first |
| Aux/channel names wrong | Channel count must match the desk before pulling names; a mix only receives names for channels the app knows exist |
| Console link keeps dropping | Only one RCP client is allowed — close Companion/QLab/duplicate app instances; check the 5 s command timeout against console slowness |
| Fader screen shows a channel at minimum | `-∞` dB is clamped to the configured `faderMinDb`; that's expected |
| Fader view feels frozen on load | It fetches level+mute per channel **sequentially** by design (serial RCP). A genuinely unresponsive channel now triggers a clean reconnect instead of mis-mapping replies |
| Need to see real console values | **Raw Console** tab, e.g. `get MIXER:Current/InCh/ToMix/Level 0 0` |

---

## 12. Credits

- RCP protocol documentation: <https://github.com/BrenekH/yamaha-rcp-docs>
- Parameter shapes cross-checked with bitfocus/companion-module-yamaha-rcp
  (`TF Parameters-1.txt`, captured from the console's `prminfo`).

Built for a church band's in-ear/monitor workflow — keep it small, keep it
boring, keep it working on a Sunday morning.
