# AI_RULES.md — Stage Mix

## Hard constraints

### One TCP connection to Yamaha TF
- Exactly one `RcpClient` instance exists at any time.
- All browser requests multiplex through this single socket.
- Commands are serialized (protocol has no correlation ID).

### Backend owns mixer communication
- `server/rcpClient.js` is the sole gateway to the console.
- Browser never communicates directly with the TF.

### Preserve REST API
- All existing endpoints, their paths, methods, request/response shapes.
- No breaking changes to `/api/*` routes.

### Preserve WebSocket protocol
- All existing message types: `mixerStatus`, `sessionRemoved`, `mixesChanged`, `sessionsChanged`.
- No breaking changes to event names or payload shapes.

### Preserve config.json
- Structure: `{admin, mixer, channels[], mixes[], sessions{}}`.
- `store.js` is the only reader/writer.
- Migrations must be backward-compatible.

### Preserve project layout
- `public/`, `server/`, `data/` — don't reorganize.
- `server/index.js` is the entry point.

## Technology prohibitions
Do **not** introduce:
- React, Vue, Angular, Svelte, Next.js
- TypeScript
- SQL, MongoDB, Redis
- Docker (the app itself — deployment infrastructure is separate)
- Microservices

## Engineering rules
- Prefer small, incremental, backward-compatible changes.
- Every change must include: problem, risk, recommendation, files affected, expected impact, regression risk.
- Never crash on TF disconnect — reconnect with backoff, notify all clients.
- Server-side validation: never trust the browser. Validate every fader/mute request against the user's assigned mix.
- Ponytail (lazy) principles: shortest working diff, stdlib first, no unrequested abstractions, deletion over addition.
