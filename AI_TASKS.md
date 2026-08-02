# AI_TASKS.md — Stage Mix

## Current priorities (from to_be_implemented.md)

### 1. Connection State (3-tier)
Implement three connection states:
- **Green**: Server + TF connected
- **Yellow**: Server reachable, TF unavailable
- **Red**: Server unavailable
Risk: Low. Affects status-bar UI and WebSocket broadcast. No API change.

### 2. Smarter Reconnect (exponential backoff)
Replace constant reconnect with: 1s → 2s → 5s → 10s → 20s → 30s (max).
Risk: Low. Affects `rcpClient.js` `_connect()` close handler only. Current behavior: `_reconnectDelay * 1.5` capped at 15s. Change cap to 30s.

### 3. Server-side Permission Validation ✅ (Phase A — 2026-08-02)
Validated fader/mute requests against user's assigned mix. Implemented in `server/index.js`:
- `POST /api/fader`: rejects 403 if channel not in user's mix
- `POST /api/mute`: rejects 403 if channel not in user's mix

### 4. Robust Error Handling
- Never crash on TF disconnect
- Auto-reconnect
- Notify all clients of connection status
Risk: Low. Current behavior already handles this partially — review edge cases.

### 5. Preserve Single TCP Session
Maintain one TCP session to mixer, multiplex all browser requests.
Risk: None. Already the current architecture. Must not regress.

## Completed tasks
- Fixed: channel count change silently failed above 16 (now works up to 40)
- Fixed: aux/mix names pulled with wrong command shape (single index → two indices)
- Fixed: fader screen didn't update when admin changed channel visibility
- Fixed: sequential channel fetches bottlenecked fader view (now parallel via `Promise.all`)
- Fixed: "Pull names from console" now warns in simulated mode

- Fixed: server-side channel-in-mix validation on fader/mute endpoints (2026-08-02)

## Deferred tasks
- Per-user admin accounts (currently one shared password)
- Multi-console support (mixer config as list)
- Continuous name sync from console (currently one-shot button)

## Known issues
- Reconnect delay cap is 15s — should be 30s per spec (Item 2 above)
- Status bar only shows connected/not-connected; no yellow state for "server up, TF down" (Item 1 above)
- `mockRcpClient` `_latency()` throws if `connected === false`, but `start()` sets it async after 300ms — race condition possible

## Future ideas (not for current implementation)
- Health monitoring (Node.js process, TF connection, Tailscale, disk/CPU/RAM)
- Config synchronization (Syncthing/rsync/Git)
- Automatic failover (switch Cloudflare Tunnel to standby Church PC)
- Dedicated Linux appliance deployment
