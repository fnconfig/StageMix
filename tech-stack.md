# Stage Mix — Tech Stack & Architecture Overview

**Stage Mix** is a lightweight, high-performance web application designed for live music environments. It allows band members to control their individual monitor mix (Send on Fader) on Yamaha TF-series digital mixing consoles directly from any smartphone or tablet browser without requiring an app installation.

---

## 1. Overview & Core Philosophy

- **Zero-Dependency Frontend**: Pure Vanilla HTML5, CSS3, and JavaScript (ES6+). No heavy client-side frameworks (React/Vue/Angular) to guarantee zero build steps, instant load times, and low memory overhead on legacy mobile devices.
- **Node.js & Express Backend**: Lightweight API server handling session authentication, configuration storage, static asset delivery, and console RCP orchestration.
- **Dual-Mode Protocol Engine**: Native TCP socket client interfacing with Yamaha's RCP (Remote Control Protocol) on port `49280`, backed by a mock hardware emulator for offline development and testing.
- **Real-Time Synchronisation**: WebSocket broadcast layer paired with parallelized REST endpoints to maintain low-latency bidirectional state updates across multiple connected devices.

---

## 2. Tech Stack Breakdown

### Frontend (Client-side)
| Technology | Description / Usage |
| :--- | :--- |
| **HTML5** | Semantic structure for landing pages, mix selector, fader rack, and admin dashboard. |
| **CSS3 (Vanilla)** | Dynamic dark mode design system, custom CSS variables (`--bg`, `--accent`, `--teal`), Flexbox, CSS Grid layouts, and glassmorphism visual aesthetics. |
| **Container Queries (`cq*`)** | `container-type: inline-size` combined with `clamp()` font scaling (`clamp(7px, 3cqi, 11px)`) to automatically autofit channel names and dB readouts within dynamic fader strip dimensions. |
| **Typography** | Google Fonts: **Oswald** (Display/Headings), **Inter** (UI Body text), and **JetBrains Mono** (Technical readouts & dB values). |
| **Vanilla JS (ES6+)** | Modular event-driven architecture, custom pointer/touch drag event management for fader caps, REST API client, and WebSocket lifecycle handler. |

### Backend (Server-side)
| Technology | Description / Usage |
| :--- | :--- |
| **Runtime** | **Node.js** (`>=18`) running CommonJS modules (`type: "commonjs"`). |
| **Web Server** | **Express.js** (`^4.19.2`) providing RESTful routing, static file middleware, and custom security/session middleware. |
| **WebSockets** | **`ws`** (`^8.18.0`) server for real-time status broadcasts (`mixerStatus`, `sessionRemoved`, `mixesChanged`). |
| **TCP Socket Client** | Node's native `net.Socket` used in `rcpClient.js` for low-level byte-oriented communication with Yamaha TF consoles on port `49280`. |
| **Security & Crypto** | Node.js native `crypto` module utilizing `scryptSync` with random salt generation for admin password hashing, `timingSafeEqual` for verification, and `randomUUID` for token creation. |
| **Data Storage** | Local JSON file persistence (`store.js` / `data/config.json`) for admin credentials, channel mappings, aux mix definitions, and active user sessions. |

---

## 3. Architecture & System Flow

```
 ┌─────────────────────────────────────────────────────────────┐
 │                Mobile Browsers / Web Clients                │
 └───────────────┬─────────────────────────────▲───────────────┘
                 │ HTTP REST API               │ WebSocket Broadcast
                 │ (Fader/Mute/Session)        │ (Status/Sync)
                 ▼                             │
 ┌─────────────────────────────────────────────┴───────────────┐
 │                     Node.js / Express App                   │
 │                                                             │
 │  ┌─────────────────┐  ┌────────────────┐  ┌──────────────┐  │
 │  │ Session & Auth  │  │ JSON Store     │  │  WebSocket   │  │
 │  │ Middleware      │  │ (config.json)  │  │  Server      │  │
 │  └─────────────────┘  └────────────────┘  └──────────────┘  │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                    TCP Socket (RCP Protocol)
                                │
                 ┌──────────────┴──────────────┐
                 │ Mode Switch                 │
                 ├──────────────┬──────────────┤
                 │              │              │
                 ▼              ▼              ▼
           ┌───────────┐  ┌───────────┐  ┌───────────┐
           │ Yamaha TF │  │ Yamaha TF │  │  Mock RCP │
           │ Console   │  │ Console   │  │ Emulator  │
           │ (Aux 1)   │  │ (Aux 2..) │  │ (Testing) │
           └───────────┘  └───────────┘  └───────────┘
```

---

## 4. Key Application Features

1. **Send on Fader Control**:
   - Band members choose their designated Aux Mix (e.g. Aux 1, Aux 2).
   - Real-time control of individual channel levels (dB) and channel mute states.
   - Non-blocking parallelized channel level fetching (`Promise.all`) prevents hardware latency bottlenecks.

2. **Responsive Fader Rack UI**:
   - Touch & mouse-enabled fader track with percentage-to-dB conversion logic (`-60 dB` to `+10 dB`).
   - Container-query based responsive text sizing ensuring channel names and dB indicators never overflow narrow fader strips.
   - Smooth horizontal scrolling for multi-channel racks.

3. **Console Integration & Synchronization**:
   - Pull channel names and aux mix labels directly from Yamaha TF console via RCP command execution (`get MIXER:Current/InCh/Fader/Name`).
   - Auto-reconnect handling and status notification via top bar status indicators.

4. **Sound Desk / Admin Dashboard**:
   - Access control via password protection (`x-admin-token`).
   - Configure active aux channels, channel counts (16 to 40 channels), mixer host IP/port settings, and custom fader minimum/maximum dB bounds.
   - Active user session management (remove connected users by name).
   - Console command test bench (`raw` RCP command interface).

---

## 5. Directory Structure

```
monitor-mix-app/
├── data/
│   └── config.json          # Persisted app configuration, user sessions, & hashes
├── public/
│   ├── index.html           # Single-page application HTML structure
│   ├── styles.css           # Custom design system, CSS variables, fader layouts
│   └── app.js               # Client-side routing, fader mechanics, WS client
├── server/
│   ├── index.js             # Express web server & WebSocket broadcast manager
│   ├── rcpClient.js         # Real Yamaha TF RCP TCP socket communication client
│   ├── mockRcpClient.js     # Simulated Yamaha console hardware emulator
│   └── store.js             # Data layer, JSON persistence, & password hashing
├── package.json             # Node.js project manifest and dependencies
└── tech-stack.md            # Technical documentation
```
