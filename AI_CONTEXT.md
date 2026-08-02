# AI_CONTEXT.md — Stage Mix

## Project overview
**Stage Mix** is a self-hosted web app that lets church band members control their personal monitor (aux) send on a Yamaha TF-series console from any phone browser. No app install — just a URL. It speaks Yamaha's RCP protocol (TCP port 49280) for Send on Fader.

## Goals
- Give each band member independent control of their own monitor mix via phone
- Keep operation dead simple: enter name → pick aux → drag faders
- Protect the console: one TCP connection shared by all users, admin-gated config
- Work on any phone browser, no install, no framework bloat

## Target users
- **Band members** (normal users): join a mix, drag faders, mute sends in their own monitor
- **Sound desk operator** (admin): configure visible mixes, set channel count, manage sessions, connect/disconnect the mixer

## Architecture

```
Browser (Vanilla JS) ──REST/WS──▶ Express server (Node.js) ──TCP──▶ Yamaha TF (RCP)
                                       │
                                  data/config.json
```

- **Frontend**: Vanilla HTML/CSS/JS SPA. No framework, no build step.
- **Backend**: Express + `ws` WebSocket server. Single `rcpClient.js` TCP socket to the mixer. All mixer commands serialize through that one connection.
- **Storage**: JSON file (`data/config.json`) via `store.js`.
- **Mock mode**: `mockRcpClient.js` — same interface, in-memory state. For dev/testing without hardware.

## Folder responsibilities

| Path | Role |
|---|---|
| `public/index.html` | SPA structure: landing, user flow, admin dashboard |
| `public/app.js` | Client-side routing, fader mechanics, REST/WS client |
| `public/styles.css` | Dark theme, fader rack, responsive layout |
| `server/index.js` | Express routes + WebSocket broadcast |
| `server/rcpClient.js` | Real TCP RCP client for Yamaha TF |
| `server/mockRcpClient.js` | Simulated mixer, same interface |
| `server/store.js` | JSON file persistence + password hashing |
| `data/config.json` | Persisted config, sessions, hashed admin password |

## REST flow
- `GET /api/mixes` — list visible aux mixes
- `POST /api/session` — create/rejoin a named session bound to a mix
- `GET /api/channels` — list channels + current levels for user's mix
- `POST /api/fader` — set send level for a channel in user's mix
- `POST /api/mute` — mute/unmute a channel send in user's mix
- Admin endpoints under `/api/admin/*` — all require `x-admin-token` header

## WebSocket flow
- `GET /ws` — single WS endpoint
- Server broadcasts: `mixerStatus` (connect/disconnect), `sessionRemoved` (admin boot), `mixesChanged` (config change), `sessionsChanged` (user join/leave)
- On connect, server immediately sends current `mixerStatus`

## Yamaha RCP flow
- Single persistent TCP socket to mixer on port 49280
- Commands serialized (protocol has no correlation ID, so one-at-a-time)
- `get/set MIXER:Current/InCh/ToMix/Level <ch> <mix>` — send level (dB×100)
- `get/set MIXER:Current/InCh/ToMix/On <ch> <mix>` — send mute (0/1)
- `get MIXER:Current/InCh/Label/Name <ch> 0` — channel name
- `get MIXER:Current/Mix/Label/Name <mix> 0` — aux name
- `NOTIFY` lines surfaced to clients as they arrive
- Auto-reconnect on disconnect with delay multiplier (1s→15s max)

## State management
- **Server**: config.json loaded at startup into `db` object, written on every mutation. Sessions stored as `{lowercase_name: {name, mixId, token, lastSeen, removed}}`.
- **Client**: `sessionToken` in localStorage (persists across tabs), `adminToken` in sessionStorage (clears on tab close). Fader state fetched from server on view open.

## Design philosophy
- Zero frontend dependencies. No React/Vue/Angular/TypeScript.
- One TCP connection to the mixer, full stop.
- Browser never touches the mixer directly — all commands relayed through Express.
- Smallest safe change wins. Preserve, extend, stabilize.
