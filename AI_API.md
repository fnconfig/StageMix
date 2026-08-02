# AI_API.md — Stage Mix

## REST Endpoints

### Public (no auth)

**GET /api/mixes**
Returns visible aux mixes.
```
Response: { mixes: [{id, name}], mixerConnected: bool }
```

**POST /api/session**
Create/rejoin named session bound to a mix.
```
Request:  { name: string, mixId: string }
Response: { token: uuid, name: string, mix: {id, name} }
Errors:   400 (missing name / mix not visible)
```

### Normal user (x-session-token)

**GET /api/session/check**
Verify session token is valid.
```
Headers:  x-session-token: uuid
Response: { ok: true, name: string, mix: {id, name} }
Errors:   401 (not found), 410 (removed by admin)
```

**GET /api/channels**
List channels + levels for user's mix. Fetches level+mute from mixer in parallel.
```
Response: { mix: {id, name, index}, channels: [{id, name, index, level: dB, on: bool}], mixerConnected: bool }
```

**POST /api/fader**
Set send level for a channel in user's mix.
```
Request:  { channelId: string, level: dB }
Response: { ok: true, level: dB }
Errors:   400 (unknown channel/mix), 502 (mixer unreachable)
```

**POST /api/mute**
Mute/unmute a channel send in user's mix.
```
Request:  { channelId: string, muted: bool }
Response: { ok: true, muted: bool }
Errors:   400, 502
```

### Admin (x-admin-token)

**POST /api/admin/login**
```
Request:  { password: string }
Response: { token: uuid }
Errors:   401 (wrong password)
```

**POST /api/admin/logout**
Invalidates admin token.
```
Response: { ok: true }
```

**POST /api/admin/password**
Change admin password (min 4 chars).
```
Request:  { newPassword: string }
Response: { ok: true }
```

**GET /api/admin/config**
Full app config dump.
```
Response: { mixer, mixerStatus, channels[], mixes[], sessions{} }
```

**GET /api/admin/network-info**
Auto-detect LAN IPs for sharing.
```
Response: { addresses: string[], port: number }
```

**POST /api/admin/mixer**
Update mixer connection settings. Triggers reconnect.
```
Request:  { host?, port?, mode?("real"|"mock"), faderMinDb?, faderMaxDb? }
Response: { ok: true, mixer }
```

**POST /api/admin/mixer/reconnect**
Force reconnection without changing settings.

**POST /api/admin/mixes/:id**
Update a mix (name, visibility, channelIds).
```
Request:  { name?, visible?, channelIds? }
Response: { ok: true, mix }
Broadcasts: mixesChanged
```

**POST /api/admin/channels/count**
Set channel count (1–40). Adds/removes channels and updates all mix channelIds.
```
Request:  { count: number }
Response: { ok: true, channels[] }
```

**POST /api/admin/channels/:id**
Rename a channel.
```
Request:  { name: string }
Response: { ok: true, channel }
```

**POST /api/admin/sync-names**
Pull channel + aux names from console. One-shot, not continuous.
```
Response: { ok: true, updated: {channels, mixes, skipped}, channels[], mixes[] }
Errors:   409 (not connected)
```

**POST /api/admin/sessions/remove**
Boot a user by name.
```
Request:  { name: string }
Response: { ok: true }
Broadcasts: sessionRemoved
```

**POST /api/admin/raw**
Send raw RCP command to console.
```
Request:  { command: string }
Response: { ok: true, reply: string }
```

## WebSocket (GET /ws)

### Server → Client messages

**mixerStatus**
```
{ type: "mixerStatus", status: { connected: bool, host?, port?, error?, mock? } }
```
Sent on connect, disconnect, reconnect.

**sessionRemoved**
```
{ type: "sessionRemoved", name: string }
```
Sent when admin removes a user. Client checks if it matches their session name.

**mixesChanged**
```
{ type: "mixesChanged" }
```
Sent when mix visibility, channel assignments, or channel/aux names change.

**sessionsChanged**
```
{ type: "sessionsChanged" }
```
Sent when a user creates a session.

**notify**
```
{ type: "notify", line: string }
```
Raw NOTIFY lines from console, forwarded verbatim.

## Yamaha RCP Commands

| Command | Shape | Range |
|---|---|---|
| `get/set MIXER:Current/InCh/ToMix/Level` | `<ch 0-39> <mix 0-19>` | -32768..1000 (dB×100) |
| `get/set MIXER:Current/InCh/ToMix/On` | `<ch 0-39> <mix 0-19>` | 0/1 |
| `get/set MIXER:Current/InCh/Label/Name` | `<ch 0-39> 0` | string |
| `get/set MIXER:Current/Mix/Label/Name` | `<mix 0-19> 0` | string |

dB×100 encoding: 10.00 dB = 1000, -60.00 dB = -6000, -∞ = -32768.

## Configuration schema (config.json)

```json
{
  "admin": { "passwordHash": "salt:scrypt-hash" },
  "mixer": {
    "host": "192.168.1.50",
    "port": 49280,
    "mode": "mock|real",
    "faderMinDb": -60,
    "faderMaxDb": 10
  },
  "channels": [{ "id": "ch1", "index": 0, "name": "Kick" }],
  "mixes": [{
    "id": "mix1", "index": 0, "name": "Drummer",
    "visible": true,
    "channelIds": ["ch1", "ch2"]
  }],
  "sessions": {
    "lowercase-name": {
      "name": "Original Case",
      "mixId": "mix1",
      "token": "uuid",
      "lastSeen": 1234567890,
      "removed": false
    }
  }
}
```
