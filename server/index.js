const path = require("path");
const os = require("os");
const crypto = require("crypto");
const express = require("express");
const { WebSocketServer } = require("ws");

const store = require("./store");
const { RcpClient } = require("./rcpClient");
const { MockRcpClient } = require("./mockRcpClient");

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public"), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => res.setHeader("Cache-Control", "no-store"),
}));

let db = store.load();
let mixerStatus = { connected: false };
let rcp = null;

// ---- websocket broadcast plumbing ----
let wss = null;
function broadcast(msg) {
  if (!wss) return;
  const data = JSON.stringify(msg);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(data);
  });
}

function startMixerClient() {
  if (rcp) rcp.stop();
  mixerStatus = { connected: false, host: db.mixer.host, port: db.mixer.port };
  broadcast({ type: "mixerStatus", status: mixerStatus });
  const opts = { host: db.mixer.host, port: db.mixer.port };
  rcp = db.mixer.mode === "real" ? new RcpClient(opts) : new MockRcpClient(opts);
  rcp.on("status", (s) => {
    mixerStatus = s;
    broadcast({ type: "mixerStatus", status: mixerStatus });
  });
  rcp.on("notify", (line) => {
    broadcast({ type: "notify", line });
  });
  rcp.start();
}

// ---- helpers ----
function requireAdmin(req, res, next) {
  const token = req.headers["x-admin-token"];
  if (!token || token !== db._adminToken) {
    return res.status(401).json({ error: "Admin authentication required" });
  }
  next();
}

function findChannel(id) {
  return db.channels.find((c) => c.id === id);
}
function findMix(id) {
  return db.mixes.find((m) => m.id === id);
}

function sanitizeSessions() {
  const out = {};
  for (const [key, s] of Object.entries(db.sessions)) {
    out[key] = { name: s.name, mixId: s.mixId, lastSeen: s.lastSeen };
  }
  return out;
}

// =========================================================================
// Public / normal-user API (no login, matches "Normal User" branch)
// =========================================================================

// list of aux mixes currently visible to normal users
app.get("/api/mixes", (req, res) => {
  const visible = db.mixes
    .filter((m) => m.visible)
    .map((m) => ({ id: m.id, name: m.name }));
  res.json({ mixes: visible, mixerConnected: !!mixerStatus.connected });
});

// "Masukan Nama" + "Select Aux Channel" step: create/refresh a named session
app.post("/api/session", (req, res) => {
  const { name, mixId } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Name is required" });
  const mix = findMix(mixId);
  if (!mix || !mix.visible) return res.status(400).json({ error: "That aux mix isn't available" });

  const key = name.trim().toLowerCase();
  const token = crypto.randomUUID();
  db.sessions[key] = {
    name: name.trim(),
    mixId: mix.id,
    token,
    lastSeen: Date.now(),
    removed: false,
  };
  store.save(db);
  broadcast({ type: "sessionsChanged" });
  res.json({ token, name: name.trim(), mix: { id: mix.id, name: mix.name } });
});

function sessionFromToken(token) {
  return Object.values(db.sessions).find((s) => s.token === token);
}

// middleware for normal-user endpoints: validates the session token
function requireSession(req, res, next) {
  const token = req.headers["x-session-token"];
  const session = token && sessionFromToken(token);
  if (!session) return res.status(401).json({ error: "Session not found, please rejoin" });
  if (session.removed) return res.status(410).json({ error: "removed" });
  session.lastSeen = Date.now();
  req.session = session;
  next();
}

app.get("/api/session/check", requireSession, (req, res) => {
  const mix = findMix(req.session.mixId);
  res.json({ ok: true, name: req.session.name, mix: mix ? { id: mix.id, name: mix.name } : null });
});

// "Control Send on Fader Channel Volume" step: list channels + current levels
app.get("/api/channels", requireSession, async (req, res) => {
  const mix = findMix(req.session.mixId);
  if (!mix) return res.status(400).json({ error: "Assigned mix no longer exists" });
  const channels = db.channels.filter((c) => mix.channelIds.includes(c.id));

  // Fetch every channel's level + mute state in parallel rather than one at
  // a time - on real hardware, 64 sequential round-trips (2 per channel x 32
  // channels) could take long enough to feel like the app had frozen, and
  // would also hold up the user's own fader/mute commands queued behind it
  // on the same connection.
  const results = await Promise.all(
    channels.map(async (ch) => {
      let level = -60;
      let on = true;
      try {
        level = await rcp.getToMixLevel(ch.index, mix.index);
      } catch (e) {
        /* leave default if mixer unreachable */
      }
      try {
        on = await rcp.getToMixOn(ch.index, mix.index);
      } catch (e) {
        /* leave default (unmuted) if mixer unreachable */
      }
      return { id: ch.id, name: ch.name, index: ch.index, level, on };
    })
  );
  res.json({ mix: { id: mix.id, name: mix.name, index: mix.index }, channels: results, mixerConnected: !!mixerStatus.connected });
});

app.post("/api/fader", requireSession, async (req, res) => {
  const { channelId, level } = req.body || {};
  const mix = findMix(req.session.mixId);
  const channel = findChannel(channelId);
  if (!mix || !channel) return res.status(400).json({ error: "Unknown channel or mix" });
  if (!mix.channelIds.includes(channel.id)) return res.status(403).json({ error: "Channel not available in your mix" });
  const clamped = Math.max(db.mixer.faderMinDb, Math.min(db.mixer.faderMaxDb, Number(level)));
  try {
    await rcp.setToMixLevel(channel.index, mix.index, clamped);
    res.json({ ok: true, level: clamped });
  } catch (e) {
    res.status(502).json({ error: "Could not reach mixer: " + e.message });
  }
});

// mute/unmute a channel's send to the user's own mix
app.post("/api/mute", requireSession, async (req, res) => {
  const { channelId, muted } = req.body || {};
  const mix = findMix(req.session.mixId);
  const channel = findChannel(channelId);
  if (!mix || !channel) return res.status(400).json({ error: "Unknown channel or mix" });
  if (!mix.channelIds.includes(channel.id)) return res.status(403).json({ error: "Channel not available in your mix" });
  try {
    await rcp.setToMixOn(channel.index, mix.index, !muted); // console's "On" == unmuted
    res.json({ ok: true, muted: !!muted });
  } catch (e) {
    res.status(502).json({ error: "Could not reach mixer: " + e.message });
  }
});

// =========================================================================
// Admin API (password protected, matches "Admiin" branch)
// =========================================================================

app.post("/api/admin/login", (req, res) => {
  const { password } = req.body || {};
  if (!password || !store.verifyPassword(password, db.admin.passwordHash)) {
    return res.status(401).json({ error: "Wrong password" });
  }
  db._adminToken = crypto.randomUUID();
  store.save(db);
  res.json({ token: db._adminToken });
});

app.post("/api/admin/logout", requireAdmin, (req, res) => {
  db._adminToken = null;
  res.json({ ok: true });
});

app.post("/api/admin/password", requireAdmin, (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: "Password must be at least 4 characters" });
  }
  db.admin.passwordHash = store.hashPassword(newPassword);
  store.save(db);
  res.json({ ok: true });
});

app.get("/api/admin/network-info", requireAdmin, (req, res) => {
  const addresses = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === "IPv4" && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  res.json({ addresses, port: PORT });
});

app.get("/api/admin/config", requireAdmin, (req, res) => {
  res.json({
    mixer: db.mixer,
    mixerStatus,
    channels: db.channels,
    mixes: db.mixes,
    sessions: sanitizeSessions(),
  });
});

app.post("/api/admin/mixer", requireAdmin, (req, res) => {
  const { host, port, mode, faderMinDb, faderMaxDb } = req.body || {};
  if (host !== undefined) db.mixer.host = host;
  if (port !== undefined) db.mixer.port = Number(port);
  if (mode !== undefined) db.mixer.mode = mode === "real" ? "real" : "mock";
  if (faderMinDb !== undefined) db.mixer.faderMinDb = Number(faderMinDb);
  if (faderMaxDb !== undefined) db.mixer.faderMaxDb = Number(faderMaxDb);
  store.save(db);
  startMixerClient();
  res.json({ ok: true, mixer: db.mixer });
});

app.post("/api/admin/mixer/reconnect", requireAdmin, (req, res) => {
  startMixerClient();
  res.json({ ok: true, mixer: db.mixer });
});

// Determine which aux mixes are available/shown to normal users
app.post("/api/admin/mixes/:id", requireAdmin, (req, res) => {
  const mix = findMix(req.params.id);
  if (!mix) return res.status(404).json({ error: "Mix not found" });
  const { name, visible, channelIds } = req.body || {};
  if (name !== undefined) mix.name = name;
  if (visible !== undefined) mix.visible = !!visible;
  if (Array.isArray(channelIds)) mix.channelIds = channelIds;
  store.save(db);
  broadcast({ type: "mixesChanged" });
  res.json({ ok: true, mix });
});

app.post("/api/admin/channels/count", requireAdmin, (req, res) => {
  const { count } = req.body || {};
  const n = Math.max(1, Math.min(40, Number(count) || 16)); // TF consoles expose at most 40 input channels
  const current = db.channels.length;
  if (n > current) {
    for (let i = current; i < n; i++) {
      const ch = { id: `ch${i + 1}`, index: i, name: `Channel ${i + 1}` };
      db.channels.push(ch);
      db.mixes.forEach((m) => m.channelIds.push(ch.id));
    }
  } else if (n < current) {
    const removed = db.channels.slice(n).map((c) => c.id);
    db.channels = db.channels.slice(0, n);
    db.mixes.forEach((m) => (m.channelIds = m.channelIds.filter((id) => !removed.includes(id))));
  }
  store.save(db);
  broadcast({ type: "mixesChanged" });
  res.json({ ok: true, channels: db.channels });
});

app.post("/api/admin/channels/:id", requireAdmin, (req, res) => {
  const ch = findChannel(req.params.id);
  if (!ch) return res.status(404).json({ error: "Channel not found" });
  const { name } = req.body || {};
  if (name !== undefined) ch.name = name;
  store.save(db);
  broadcast({ type: "mixesChanged" });
  res.json({ ok: true, channel: ch });
});

// Pull channel and aux (mix) names straight off the console, overwriting the
// locally-typed names. Skips anything the mixer doesn't answer for (e.g. a
// channel/mix that isn't patched) so partial consoles don't error out.
app.post("/api/admin/sync-names", requireAdmin, async (req, res) => {
  if (!mixerStatus.connected) {
    return res.status(409).json({ error: "Not connected to the console right now" });
  }
  const updated = { channels: 0, mixes: 0, skipped: 0 };
  for (const ch of db.channels) {
    try {
      const name = await rcp.getChannelName(ch.index);
      if (name && name.trim()) {
        ch.name = name.trim();
        updated.channels++;
      } else {
        updated.skipped++;
      }
    } catch (e) {
      updated.skipped++;
    }
  }
  for (const mix of db.mixes) {
    try {
      const name = await rcp.getMixName(mix.index);
      if (name && name.trim()) {
        mix.name = name.trim();
        updated.mixes++;
      } else {
        updated.skipped++;
      }
    } catch (e) {
      updated.skipped++;
    }
  }
  store.save(db);
  broadcast({ type: "mixesChanged" });
  res.json({ ok: true, updated, mode: db.mixer.mode, channels: db.channels, mixes: db.mixes });
});

// "Ability to Remove connection based on name input"
app.post("/api/admin/sessions/remove", requireAdmin, (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: "Name is required" });
  const key = name.trim().toLowerCase();
  const session = db.sessions[key];
  if (!session) return res.status(404).json({ error: "No active user with that name" });
  delete db.sessions[key];
  store.save(db);
  broadcast({ type: "sessionRemoved", name: session.name });
  res.json({ ok: true });
});

// raw console for calibrating against real hardware (see rcpClient.js notes)
app.post("/api/admin/raw", requireAdmin, async (req, res) => {
  const { command } = req.body || {};
  if (!command) return res.status(400).json({ error: "Command is required" });
  try {
    const reply = await rcp.raw(command);
    res.json({ ok: true, reply });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// =========================================================================

const server = app.listen(PORT, () => {
  console.log(`Monitor mix app listening on http://localhost:${PORT}`);
  startMixerClient();
});

wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "mixerStatus", status: mixerStatus }));
});
