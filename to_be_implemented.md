# to_be_implemented.md

# Stage Mix – Targeted Improvement Specification

## Important
This application is **already working correctly** and is considered feature-complete for its current scope.

**Do NOT:**
- Rewrite the application.
- Replace the technology stack.
- Introduce frontend frameworks (React/Vue/Angular).
- Replace Express, WebSocket, or the Yamaha RCP implementation.
- Change REST endpoints, WebSocket message formats, configuration structure, or project layout unless explicitly required.

The goal is to implement only the improvements listed below while preserving existing functionality.

## Existing Architecture (Preserve)
- Vanilla HTML/CSS/JavaScript frontend.
- Node.js + Express backend.
- `ws` WebSocket server.
- Single `rcpClient.js` TCP connection to Yamaha TF (port 49280).
- JSON configuration storage.
- Mock RCP mode.
- REST + WebSocket architecture.

## Requested Improvements

### 1. Connection State
Implement three connection states:
- Green: Server + TF connected
- Yellow: Server reachable, TF unavailable
- Red: Server unavailable

### 2. Smarter Reconnect
Replace constant reconnect attempts with exponential backoff:
1s → 2s → 5s → 10s → 20s → 30s (max).

### 3. Server-side Permission Validation
Do not trust the browser.
Every control request must be validated against the user's assigned aux mix.

### 4. Robust Error Handling
- Never crash on TF disconnect.
- Automatically reconnect.
- Notify all clients of connection status.

### 5. Preserve Single TCP Session
Maintain one TCP session to the mixer and multiplex requests from all browsers.

## Future (Not for current implementation)
- Health monitoring
- Config synchronization
- Automatic failover
- Dedicated Linux appliance deployment
