(() => {
  "use strict";

  // ---------------- state ----------------
  const state = {
    sessionToken: localStorage.getItem("sm_session_token") || null,
    sessionName: localStorage.getItem("sm_session_name") || "",
    adminToken: sessionStorage.getItem("sm_admin_token") || null,
    adminUsername: sessionStorage.getItem("sm_admin_username") || "",
    mixes: [],
    currentMix: null,
    faderMin: -60,
    faderMax: 10,
    ws: null,
    subscribedMixId: null,
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function showView(name) {
    $$(".view").forEach((v) => v.classList.add("hidden"));
    const el = document.getElementById(`view-${name}`);
    if (el) el.classList.remove("hidden");
    // The top status bar (Stage Mix + console connection) is admin-only;
    // band members don't need it (and it clutters the user screens).
    const bar = document.getElementById("statusBar");
    if (bar) {
      bar.classList.toggle("status-bar--hidden", name !== "admin-login" && name !== "admin-dash");
    }
  }

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add("hidden"), 2600);
  }

  async function api(path, opts = {}) {
    const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    if (state.sessionToken) headers["x-session-token"] = state.sessionToken;
    if (state.adminToken) headers["x-admin-token"] = state.adminToken;
    const res = await fetch(path, Object.assign({ cache: "no-store" }, opts, { headers }));
    let body = null;
    try { body = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const err = new Error((body && body.error) || `Request failed (${res.status})`);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  }

  // ---------------- navigation ----------------
  document.addEventListener("click", (e) => {
    const nav = e.target.closest("[data-nav]");
    if (!nav) return;
    goTo(nav.dataset.nav);
  });

  function goTo(name) {
    if (name === "user-mix") loadMixes();
    if (name === "user-name" && state.sessionToken) {
      // if already joined, skip straight to picking a mix
      loadMixes();
      showView("user-mix");
      return;
    }
    if (name === "user-mix-back") {
      // The back arrow always returns to the name screen, even when already
      // signed in (so the user can re-enter or change their name).
      showView("user-name");
      return;
    }
    showView(name);
  }

  // ---------------- websocket status ----------------
  function connectWs() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    state.ws = ws;
    ws.onopen = () => {
      // Re-announce which aux mix this client is watching on every (re)connect
      // so mixConfigUpdated broadcasts keep flowing after a dropped socket.
      if (state.subscribedMixId) {
        ws.send(JSON.stringify({ type: "subscribe", mixId: state.subscribedMixId }));
      }
    };
    ws.onmessage = (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch (e) { return; }
      if (msg.type === "mixerStatus") setMixerStatus(msg.status);
      if (msg.type === "sessionRemoved" && msg.name && msg.name.toLowerCase() === state.sessionName.toLowerCase()) {
        clearSession();
        toast(`Your connection was ended by the sound desk.`);
        showView("landing");
      }
      if (msg.type === "mixesChanged") {
        if (!document.getElementById("view-user-mix").classList.contains("hidden")) {
          loadMixes();
        }
        if (!document.getElementById("view-user-fader").classList.contains("hidden") && state.sessionToken) {
          loadChannels();
        }
      }
      if (msg.type === "mixConfigUpdated") applyMixConfig(msg);
      if (msg.type === "mixLevelUpdated") applyRemoteLevel(msg);
      if (msg.type === "mixMuteUpdated") applyRemoteMute(msg);
      if (msg.type === "mixMasterUpdated") applyRemoteMasterLevel(msg);
      if (msg.type === "mixMasterMuteUpdated") applyRemoteMasterMute(msg);
      if (msg.type === "sessionsChanged" && state.adminToken) {
        refreshAdminUsers().catch(() => {});
      }
    };
    ws.onclose = () => setTimeout(connectWs, 2000);
  }

  // Tell the server which aux mix this client is viewing; the server then
  // filters mixConfigUpdated broadcasts to matching sockets only.
  function subscribeMix(mixId) {
    state.subscribedMixId = mixId;
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ type: "subscribe", mixId }));
    }
  }

  function setMixerStatus(status) {
    const dot = $("#mixerDot");
    const text = $("#mixerStatusText");
    const banner = $("#disconnectBanner");
    const connected = !!(status && status.connected);

    dot.classList.toggle("connected", connected);
    // Deliberately generic - band members don't need (and shouldn't see) the
    // console's actual network address, just whether it's live.
    text.textContent = connected ? "Console: connected" : "Console: reconnecting\u2026";
    banner.classList.toggle("hidden", connected);

    const adminDot = $("#adminMixerDot");
    const adminText = $("#adminMixerStatusText");
    if (adminDot && adminText) {
      adminDot.classList.toggle("connected", connected);
      adminText.textContent = connected
        ? (status.mock
            ? "Connected \u2014 simulated mixer"
            : `Connected to ${status.host}:${status.port}`)
        : `Not connected${status && status.host ? ` \u2014 trying ${status.host}:${status.port}` : ""}`;
    }
  }

  // ---------------- normal user flow ----------------
  function clearSession() {
    state.sessionToken = null;
    state.sessionName = "";
    state.subscribedMixId = null;
    localStorage.removeItem("sm_session_token");
    localStorage.removeItem("sm_session_name");
  }

  $("#formName").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#inputName").value.trim();
    if (!name) return;
    state.pendingName = name;
    loadMixes(true);
  });

  async function loadMixes(afterName) {
    try {
      const data = await api("/api/mixes");
      state.mixes = data.mixes;
      renderMixList();
      if (afterName) showView("user-mix");
    } catch (e) {
      toast(e.message);
    }
  }

  function renderMixList() {
    const list = $("#mixList");
    list.innerHTML = "";
    if (!state.mixes.length) {
      list.innerHTML = `<p class="pane-hint">No aux mixes are available yet — ask the sound desk to enable one.</p>`;
      return;
    }
    state.mixes.forEach((m) => {
      const btn = document.createElement("button");
      btn.className = "mix-option";
      btn.innerHTML = `<span>${escapeHtml(m.name)}</span>`;
      btn.addEventListener("click", () => joinMix(m));
      list.appendChild(btn);
    });
    $("#mixSubtitle").textContent = `Hey ${state.pendingName || state.sessionName || ""}, which mix is yours?`;
  }

  async function joinMix(mix) {
    const name = state.pendingName || state.sessionName;
    if (!name) { showView("user-name"); return; }
    try {
      const data = await api("/api/session", {
        method: "POST",
        body: JSON.stringify({ name, mixId: mix.id }),
      });
      state.sessionToken = data.token;
      state.sessionName = data.name;
      localStorage.setItem("sm_session_token", data.token);
      localStorage.setItem("sm_session_name", data.name);
      state.currentMix = data.mix;
      subscribeMix(data.mix.id);
      await openFaderView();
    } catch (e) {
      toast(e.message);
    }
  }

  async function openFaderView() {
    $("#faderUserName").textContent = state.sessionName;
    $("#faderMixName").textContent = state.currentMix ? state.currentMix.name : "";
    showView("user-fader");
    await loadChannels();
  }

  $("#btnUserLogout").addEventListener("click", () => {
    clearSession();
    state.pendingName = "";
    showView("landing");
  });

  async function loadChannels() {
    try {
      const data = await api("/api/channels");
      state.faderMin = window.__faderMin || state.faderMin;
      renderFaderRack(data.channels);
      renderMasterFader(data.mix);
      $("#faderMixName").textContent = data.mix.name;
    } catch (e) {
      if (e.status === 401 || e.status === 410) {
        clearSession();
        toast("Please rejoin your mix.");
        showView("landing");
        return;
      }
      toast(e.message);
    }
  }

  function dbToPercent(db, min, max) {
    return Math.max(0, Math.min(100, ((db - min) / (max - min)) * 100));
  }
  function percentToDb(pct, min, max) {
    return min + (max - min) * (pct / 100);
  }

  function createStrip(ch) {
    const strip = document.createElement("div");
    strip.className = "fader-strip";
    strip.dataset.channelId = ch.id; // used by mergeFaderRack to match strips
    strip.innerHTML = `
      <div class="fader-strip__name">${escapeHtml(ch.name)}</div>
      <div class="fader-strip__db" data-db></div>
      <div class="fader-track" data-min="${state.faderMin}" data-max="${state.faderMax}">
        <div class="fader-cap" data-cap></div>
      </div>
      <button class="mute-btn" data-mute type="button">Mute</button>
    `;
    return strip;
  }

  function renderFaderRack(channels) {
    const rack = $("#faderRack");
    rack.innerHTML = "";
    channels.forEach((ch) => {
      const strip = createStrip(ch);
      rack.appendChild(strip);
      const track = strip.querySelector(".fader-track");
      const cap = strip.querySelector("[data-cap]");
      const dbLabel = strip.querySelector("[data-db]");
      const muteBtn = strip.querySelector("[data-mute]");
      setupFader(track, cap, dbLabel, ch, strip);
      setupMute(muteBtn, strip, ch);
    });
  }

  // ---- real-time mix config updates (admin changed channel assignments) ----
  async function applyMixConfig(msg) {
    if (!state.currentMix || msg.mixId !== state.currentMix.id) return; // not our aux mix
    if (document.getElementById("view-user-fader").classList.contains("hidden")) return; // not on the fader screen
    // Mix name may have changed with the assignment.
    state.currentMix = { id: msg.mixId, name: msg.name };
    $("#faderMixName").textContent = msg.name;
    const masterLabel = document.querySelector("#masterFaderStrip .fader-strip__name--mix-label");
    if (masterLabel) masterLabel.textContent = msg.name;
    // Fetch authoritative levels/mute state — needed for channels that are new
    // to this mix. Kept channels keep their current fader position untouched
    // below (their strips are never rebuilt).
    let data;
    try {
      data = await api("/api/channels");
    } catch (e) {
      if (e.status === 401 || e.status === 410) {
        clearSession();
        toast("Please rejoin your mix.");
        showView("landing");
        return;
      }
      toast(e.message);
      return;
    }
    mergeFaderRack(data.channels);
  }

  // Update the channel rack in place: remove strips for channels that are no
  // longer in the aux mix, keep every still-assigned strip exactly as-is
  // (fader position, mute state, and any in-progress drag are preserved),
  // and append fresh strips only for newly assigned channels.
  function mergeFaderRack(channels) {
    const rack = $("#faderRack");
    const existing = new Map();
    rack.querySelectorAll(".fader-strip").forEach((strip) => {
      if (strip.dataset.channelId) existing.set(strip.dataset.channelId, strip);
    });

    // Channels that left this aux mix: remove their control strip gracefully —
    // the DOM node just disappears, no errors, no reload.
    const keep = new Set(channels.map((c) => c.id));
    existing.forEach((strip, id) => {
      if (!keep.has(id)) {
        strip.remove();
        existing.delete(id);
      }
    });

    channels.forEach((ch) => {
      let strip = existing.get(ch.id);
      if (strip) {
        // Still assigned: only refresh the name label if the admin renamed it.
        const nameEl = strip.querySelector(".fader-strip__name");
        if (nameEl && nameEl.textContent !== ch.name) nameEl.textContent = ch.name;
        return;
      }
      // Newly assigned channel: create a fresh strip with the fetched level.
      strip = createStrip(ch);
      rack.appendChild(strip);
      const track = strip.querySelector(".fader-track");
      const cap = strip.querySelector("[data-cap]");
      const dbLabel = strip.querySelector("[data-db]");
      const muteBtn = strip.querySelector("[data-mute]");
      setupFader(track, cap, dbLabel, ch, strip);
      setupMute(muteBtn, strip, ch);
    });

    // Reorder the rack to match the admin's mix.channelIds order. This is what
    // keeps every viewer's screen in the same order even after a live change.
    orderRack(rack, channels);
  }

  // Move existing strips into the DOM order given by `channels` (which the
  // server returns in mix.channelIds order). Cheap reorder-only, no rebuilds.
  function orderRack(rack, channels) {
    const byId = new Map();
    rack.querySelectorAll(".fader-strip").forEach((s) => {
      if (s.dataset.channelId) byId.set(s.dataset.channelId, s);
    });
    channels.forEach((ch) => {
      const s = byId.get(ch.id);
      if (s) rack.appendChild(s); // appending moves it to the end, in order
    });
  }

  // ---- live mirroring (another user changed something on this same mix) ----
  // These fire from WebSocket messages and move the local strip directly,
  // without writing to the console — so they can never echo back and loop.

  function findStrip(channelId) {
    return document.querySelector(`.fader-strip[data-channel-id="${channelId}"]`);
  }

  // Move a cap to a value that came from the console. The desk reports a moving
  // fader in coarse, uneven steps (~7-15/sec), so without this the cap visibly
  // jumps. A short transition lets it glide between updates instead. The class
  // is removed straight after, so a local drag stays instant (response matters
  // more than smoothness when the user is the one moving it).
  function glideTo(strip, level) {
    const cap = strip.querySelector(".fader-cap");
    if (cap) {
      cap.classList.add("fader-cap--glide");
      clearTimeout(cap._glideTimer);
      cap._glideTimer = setTimeout(() => cap.classList.remove("fader-cap--glide"), 260);
    }
    strip._applyLevel(level);
  }

  function applyRemoteLevel(msg) {
    if (!state.currentMix || msg.mixId !== state.currentMix.id) return; // not our mix
    if (document.getElementById("view-user-fader").classList.contains("hidden")) return;
    const strip = findStrip(msg.channelId);
    if (!strip || !strip._applyLevel) return;
    if (strip._isDragging && strip._isDragging()) return; // never fight a live drag
    glideTo(strip, msg.level);
  }

  function applyRemoteMute(msg) {
    if (!state.currentMix || msg.mixId !== state.currentMix.id) return;
    if (document.getElementById("view-user-fader").classList.contains("hidden")) return;
    const strip = findStrip(msg.channelId);
    if (strip && strip._applyMute) strip._applyMute(msg.muted);
  }

  function applyRemoteMasterLevel(msg) {
    if (!state.currentMix || msg.mixId !== state.currentMix.id) return;
    if (document.getElementById("view-user-fader").classList.contains("hidden")) return;
    const strip = document.getElementById("masterFaderStrip");
    if (!strip || !strip._applyLevel) return;
    if (strip._isDragging && strip._isDragging()) return;
    glideTo(strip, msg.level);
  }

  function applyRemoteMasterMute(msg) {
    if (!state.currentMix || msg.mixId !== state.currentMix.id) return;
    if (document.getElementById("view-user-fader").classList.contains("hidden")) return;
    const strip = document.getElementById("masterFaderStrip");
    if (strip && strip._applyMute) strip._applyMute(msg.muted);
  }

  function renderMasterFader(mix) {
    const pinnedWrap = $("#faderPinnedMaster");
    if (!pinnedWrap) return;
    pinnedWrap.innerHTML = "";

    // divider
    const div = document.createElement("div");
    div.className = "master-divider";
    pinnedWrap.appendChild(div);

    const strip = document.createElement("div");
    strip.id = "masterFaderStrip";
    strip.className = "fader-strip fader-strip--master";
    strip.innerHTML = `
      <div class="fader-strip__name fader-strip__name--master">MASTER</div>
      <div class="fader-strip__name fader-strip__name--mix-label">${escapeHtml(mix.name)}</div>
      <div class="fader-strip__db" data-db></div>
      <div class="fader-track fader-track--master" data-min="${state.faderMin}" data-max="${state.faderMax}">
        <div class="fader-cap fader-cap--master" data-cap></div>
      </div>
      <button class="mute-btn" data-mute-master type="button">Mute</button>
    `;
    pinnedWrap.appendChild(strip);

    const track = strip.querySelector(".fader-track");
    const cap = strip.querySelector("[data-cap]");
    const dbLabel = strip.querySelector("[data-db]");
    const masterChannel = { id: "__master__", index: mix.index, level: mix.masterLevel ?? 0 };
    setupFader(track, cap, dbLabel, masterChannel, strip, true);
    setupMasterMute(strip, mix);
  }

  async function setupMasterMute(strip, mix) {
    const muteBtn = strip.querySelector("[data-mute-master]");
    if (!muteBtn) return;
    let muted = mix.masterOn === false; // console's "On" == unmuted
    function render() {
      muteBtn.textContent = muted ? "Muted" : "Mute";
      muteBtn.classList.toggle("muted", muted);
      strip.classList.toggle("is-muted", muted);
    }
    render();
    // Expose for live-mirror broadcasts (no console write, no feedback loop).
    strip._applyMute = (m) => { muted = m; render(); };

    muteBtn.addEventListener("click", async () => {
      const next = !muted;
      muted = next; // optimistic
      render();
      try {
        await api("/api/mix-master-mute", {
          method: "POST",
          body: JSON.stringify({ muted: next }),
        });
      } catch (e) {
        muted = !next; // revert on failure
        render();
        if (e.status === 401 || e.status === 410) {
          clearSession();
          toast("Your connection ended.");
          showView("landing");
        } else {
          toast(e.message);
        }
      }
    });
  }

  async function sendMasterLevel(db) {
    try {
      await api("/api/mix-master", {
        method: "POST",
        body: JSON.stringify({ level: db }),
      });
    } catch (e) {
      if (e.status === 401 || e.status === 410) {
        clearSession();
        toast("Your connection ended.");
        showView("landing");
      }
    }
  }

  function setupFader(track, cap, dbLabel, channel, strip, isMaster = false) {
    const min = state.faderMin, max = state.faderMax;
    let dragging = false;
    // Offset between the grab point and the cap's centre, captured on
    // pointerdown. Honouring it means a grab near the cap's edge (or inside its
    // tolerance band) does not snap the cap under the pointer, so merely
    // touching the fader never nudges the level.
    let grabOffsetPx = 0;
    let sendTimer = null;   // trailing-send timer (throttle)
    let lastSendAt = 0;     // ms timestamp of the last send (throttle window)
    let lastDb = null;      // most recent dB value to send
    const SEND_THROTTLE_MS = 100; // max ~10 sends/sec while dragging

    let currentDb = typeof channel.level === "number" && isFinite(channel.level) ? channel.level : min;

    function place(db) {
      currentDb = db;
      const pct = dbToPercent(db, min, max);
      const trackH = track.clientHeight;
      const capH = cap.clientHeight;
      const top = (1 - pct / 100) * (trackH - capH);
      cap.style.top = `${top}px`;
      dbLabel.textContent = db <= min ? "-\u221e" : `${db.toFixed(1)} dB`;
    }

    // Expose this strip so live-mirror broadcasts can move its fader directly
    // (no console write, no feedback loop).
    strip._applyLevel = place;
    strip._isDragging = () => dragging;

    place(currentDb);
    requestAnimationFrame(() => place(currentDb));
    window.addEventListener("resize", () => place(currentDb), { passive: true });

    function pctFromClientY(clientY) {
      const rect = track.getBoundingClientRect();
      const capH = cap.offsetHeight;
      const usable = rect.height - capH;
      const y = clientY - grabOffsetPx - rect.top - capH / 2;
      const pct = 100 - (y / usable) * 100;
      return Math.max(0, Math.min(100, pct));
    }

    function sendNow(db) {
      lastSendAt = Date.now();
      lastDb = null;
      clearTimeout(sendTimer);
      if (isMaster) sendMasterLevel(db);
      else sendLevel(channel.id, db);
    }

    function onMove(clientY) {
      const pct = pctFromClientY(clientY);
      const db = Math.round(percentToDb(pct, min, max) * 10) / 10;
      place(db);
      lastDb = db;
      const since = Date.now() - lastSendAt;
      clearTimeout(sendTimer);
      if (since >= SEND_THROTTLE_MS) {
        sendNow(db);
      } else {
        // Schedule a trailing send so the final resting value always lands,
        // even if the user stops dragging before the next throttle slot.
        sendTimer = setTimeout(() => sendNow(db), SEND_THROTTLE_MS - since);
      }
    }

    async function sendLevel(channelId, db) {
      try {
        await api("/api/fader", {
          method: "POST",
          body: JSON.stringify({ channelId, level: db }),
        });
      } catch (e) {
        if (e.status === 401 || e.status === 410) {
          clearSession();
          toast("Your connection ended.");
          showView("landing");
        }
      }
    }

    function start(clientY) {
      // Anchor the drag to wherever the cap already is. No onMove() here: a grab
      // on its own changes nothing and sends nothing — only dragging does.
      const capRect = cap.getBoundingClientRect();
      grabOffsetPx = clientY - (capRect.top + capRect.height / 2);
      dragging = true;
      cap.classList.add("dragging");
    }
    function end() {
      dragging = false;
      cap.classList.remove("dragging");
      // Flush the final value immediately on release (no waiting for a timer).
      if (lastDb !== null) {
        const db = lastDb;
        sendNow(db);
      }
    }

    cap.addEventListener("pointerdown", (e) => {
      cap.setPointerCapture(e.pointerId);
      start(e.clientY);
    });
    cap.addEventListener("pointermove", (e) => { if (dragging) onMove(e.clientY); });
    cap.addEventListener("pointerup", end);
    cap.addEventListener("pointercancel", end);

    // NOTE: the rail (.fader-track) intentionally has NO handler. Clicking it
    // must never move the fader — only the cap can start a drag.
  }

  function setupMute(muteBtn, strip, channel) {
    let muted = channel.on === false; // console's "On"=false means muted
    function render() {
      muteBtn.textContent = muted ? "Muted" : "Mute";
      muteBtn.classList.toggle("muted", muted);
      strip.classList.toggle("is-muted", muted);
    }
    render();
    // Expose for live-mirror broadcasts (no console write, no feedback loop).
    strip._applyMute = (m) => { muted = m; render(); };

    muteBtn.addEventListener("click", async () => {
      const next = !muted;
      muted = next; // optimistic
      render();
      try {
        await api("/api/mute", {
          method: "POST",
          body: JSON.stringify({ channelId: channel.id, muted: next }),
        });
      } catch (e) {
        muted = !next; // revert on failure
        render();
        if (e.status === 401 || e.status === 410) {
          clearSession();
          toast("Your connection ended.");
          showView("landing");
        } else {
          toast(e.message);
        }
      }
    });
  }

  // ---------------- admin flow ----------------
  $("#formAdminLogin").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = $("#inputAdminUsername").value.trim();
    const password = $("#inputAdminPassword").value;
    if (!username || !password) return;
    try {
      const data = await api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      state.adminToken = data.token;
      state.adminUsername = data.username;
      sessionStorage.setItem("sm_admin_token", data.token);
      sessionStorage.setItem("sm_admin_username", data.username);
      $("#adminLoginError").classList.add("hidden");
      $("#inputAdminPassword").value = "";
      showView("admin-dash");
      await loadAdminConfig();
    } catch (e) {
      $("#adminLoginError").textContent = e.message;
      $("#adminLoginError").classList.remove("hidden");
    }
  });

  $("#btnAdminLogout").addEventListener("click", async () => {
    try { await api("/api/admin/logout", { method: "POST" }); } catch (e) {}
    state.adminToken = null;
    state.adminUsername = "";
    sessionStorage.removeItem("sm_admin_token");
    sessionStorage.removeItem("sm_admin_username");
    showView("landing");
  });

  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".tab").forEach((t) => t.classList.remove("active"));
      $$(".tabpane").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(`pane-${tab.dataset.tab}`).classList.add("active");
      if (tab.dataset.tab === "share") loadShareUrl();
    });
  });

  async function loadShareUrl() {
    const input = $("#shareUrl");
    const hint = $("#shareUrlHint");
    input.value = "Looking up this computer's network address\u2026";
    hint.textContent = "";
    try {
      const data = await api("/api/admin/network-info");
      if (data.addresses.length) {
        const url = `http://${data.addresses[0]}:${data.port}`;
        input.value = url;
        if (data.addresses.length > 1) {
          hint.textContent = `This computer has more than one network address: ${data.addresses.join(", ")}. Use whichever one matches the Wi-Fi network your phones are on.`;
        } else {
          hint.textContent = "Make sure band members' phones are on this same Wi-Fi network.";
        }
      } else {
        input.value = `http://${location.hostname}:${data.port}`;
        hint.textContent = "Couldn't detect a network address automatically \u2014 run \"ipconfig\" (Windows) or \"ifconfig\" (Mac/Linux) on this computer and use its Wi-Fi IPv4 address instead of localhost.";
      }
    } catch (e) {
      input.value = "";
      hint.textContent = e.message;
    }
  }

  $("#btnCopyShareUrl").addEventListener("click", async () => {
    const input = $("#shareUrl");
    input.select();
    try {
      await navigator.clipboard.writeText(input.value);
      toast("Copied");
    } catch (e) {
      toast("Select the text and copy it manually");
    }
  });

  let adminConfig = null;

  async function loadAdminConfig() {
    try {
      adminConfig = await api("/api/admin/config");
      renderMixesTable();
      renderUsersTable();
      renderChannelsTable();
      renderAdminUsersTable();
      fillMixerForm();
      updateAdminSignedInAs();
      updateCoverPreview();
      applyLandingCover();
    } catch (e) {
      toast(e.message);
    }
  }

  function updateCoverPreview() {
    const el = $("#coverPreview");
    if (!el) return;
    const url = (adminConfig && adminConfig.coverUrl) || "/cover-default.jpg";
    el.style.backgroundImage = `url('${url}')`;
    const hint = $("#coverHint");
    if (hint) {
      hint.textContent = url === "/cover-default.jpg"
        ? "Using the default photo. Upload a new one to replace it on the login screen."
        : "Using a custom photo. This is what band members see before they log in.";
    }
  }

  // admin cover upload (read the file as a base64 data URL, send to server)
  $("#formCover").addEventListener("submit", async (e) => {
    e.preventDefault();
    const file = $("#inputCover").files[0];
    if (!file) { toast("Choose an image first"); return; }
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error("Couldn't read that file"));
      r.readAsDataURL(file);
    });
    try {
      const data = await api("/api/admin/cover", {
        method: "POST",
        body: JSON.stringify({ dataUrl }),
      });
      adminConfig.coverUrl = data.coverUrl;
      updateCoverPreview();
      applyLandingCover();
      toast("Landing cover updated");
      $("#inputCover").value = "";
    } catch (err) {
      toast(err.message);
    }
  });

  $("#btnResetCover").addEventListener("click", async () => {
    try {
      const data = await api("/api/admin/cover/reset", { method: "POST" });
      adminConfig.coverUrl = data.coverUrl;
      updateCoverPreview();
      applyLandingCover();
      toast("Cover reset to default");
    } catch (e) {
      toast(e.message);
    }
  });

  function updateAdminSignedInAs() {
    const el = $("#adminSignedInAs");
    if (!el) return;
    const current = (adminConfig && adminConfig.currentUser) || state.adminUsername || "";
    el.textContent = current ? `Signed in as ${current}` : "";
  }

  let expandedMixId = null;

  function renderMixesTable() {
    const wrap = $("#mixesTable");
    wrap.innerHTML = "";
    adminConfig.mixes.forEach((mix) => {
      const row = document.createElement("div");
      row.className = "row-card";
      row.innerHTML = `
        <div class="row-card__main">
          <input type="text" value="${escapeHtml(mix.name)}" data-field="name" />
        </div>
        <button class="btn btn--ghost btn--sm" data-field="expand">Channels (${mix.channelIds.length}/${adminConfig.channels.length})</button>
        <div class="switch ${mix.visible ? "on" : ""}" data-field="visible" title="Visible to normal users"></div>
      `;
      const nameInput = row.querySelector('[data-field="name"]');
      const sw = row.querySelector('[data-field="visible"]');
      const expandBtn = row.querySelector('[data-field="expand"]');
      nameInput.addEventListener("change", () => updateMix(mix.id, { name: nameInput.value }));
      sw.addEventListener("click", () => {
        const nowOn = !sw.classList.contains("on");
        sw.classList.toggle("on", nowOn);
        updateMix(mix.id, { visible: nowOn });
      });
      wrap.appendChild(row);

      if (expandedMixId === mix.id) {
        wrap.appendChild(renderChannelPicker(mix));
        expandBtn.textContent = "Close";
        expandBtn.addEventListener("click", () => { expandedMixId = null; renderMixesTable(); });
      } else {
        expandBtn.addEventListener("click", () => { expandedMixId = mix.id; renderMixesTable(); });
      }
    });
  }

  function renderChannelPicker(mix) {
    const panel = document.createElement("div");
    panel.className = "row-card channel-picker-panel";
    panel.style.flexDirection = "column";
    panel.style.alignItems = "stretch";

    // `order` is the single source of truth while editing this picker:
    // an ordered array of channel ids. Its array order is the order band
    // members will see on the user page.
    const order = mix.channelIds.slice();
    const findCh = (id) => adminConfig.channels.find((c) => c.id === id);

    // ---- controls -------------------------------------------------------
    const controls = document.createElement("div");
    controls.className = "inline-form";
    controls.style.margin = "0 0 14px";
    const btnAll = document.createElement("button");
    btnAll.className = "btn btn--secondary btn--sm";
    btnAll.type = "button";
    btnAll.textContent = "Select all";
    const btnNone = document.createElement("button");
    btnNone.className = "btn btn--secondary btn--sm";
    btnNone.type = "button";
    btnNone.textContent = "Select none";
    const btnSave = document.createElement("button");
    btnSave.className = "btn btn--primary btn--sm";
    btnSave.type = "button";
    btnSave.textContent = "Save channels";
    controls.append(btnAll, btnNone, btnSave);

    // ---- ordered list of the channels currently in this mix -------------
    const list = document.createElement("div");
    list.className = "channel-order-list";

    // ---- add-more chips (channels not yet in this mix) ------------------
    const addRow = document.createElement("div");
    addRow.className = "chip-row";
    addRow.style.marginTop = "12px";

    const help = document.createElement("p");
    help.className = "pane-hint";
    help.style.margin = "0 0 8px";
    help.innerHTML = `Channels shown to users, top to bottom. Use <strong>▲</strong>/<strong>▼</strong> to reorder.`;

    function render() {
      list.innerHTML = "";
      if (!order.length) {
        const empty = document.createElement("div");
        empty.className = "pane-hint";
        empty.style.margin = "2px 0 0";
        empty.textContent = "No channels in this mix yet \u2014 add some below.";
        list.appendChild(empty);
      } else {
        order.forEach((id, idx) => {
          const ch = findCh(id);
          const row = document.createElement("div");
          row.className = "channel-order-item";
          row.innerHTML = `
            <span class="channel-order-item__pos">${idx + 1}</span>
            <span class="channel-order-item__name">${escapeHtml(ch ? ch.name : id)}</span>
            <span class="channel-order-item__actions">
              <button class="btn btn--ghost btn--sm" type="button" data-move="-1" ${idx === 0 ? "disabled" : ""} title="Move up">&#9650;</button>
              <button class="btn btn--ghost btn--sm" type="button" data-move="1" ${idx === order.length - 1 ? "disabled" : ""} title="Move down">&#9660;</button>
              <button class="btn btn--danger btn--sm" type="button" data-remove title="Remove from mix">&#10005;</button>
            </span>
          `;
          const up = row.querySelector('[data-move="-1"]');
          const down = row.querySelector('[data-move="1"]');
          const rm = row.querySelector("[data-remove]");
          up.addEventListener("click", () => { swap(idx, idx - 1); });
          down.addEventListener("click", () => { swap(idx, idx + 1); });
          rm.addEventListener("click", () => { order.splice(idx, 1); render(); });
          list.appendChild(row);
        });
      }

      // Rebuild "add" chips = every channel not currently in the mix.
      const inMix = new Set(order);
      addRow.innerHTML = "";
      adminConfig.channels.forEach((ch) => {
        if (inMix.has(ch.id)) return;
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "chip";
        chip.textContent = ch.name;
        chip.addEventListener("click", () => { order.push(ch.id); render(); });
        addRow.appendChild(chip);
      });
    }

    function swap(i, j) {
      if (j < 0 || j >= order.length) return;
      const tmp = order[i];
      order[i] = order[j];
      order[j] = tmp;
      render();
    }

    btnAll.addEventListener("click", () => {
      order.length = 0;
      adminConfig.channels.forEach((ch) => order.push(ch.id));
      render();
    });
    btnNone.addEventListener("click", () => { order.length = 0; render(); });
    btnSave.addEventListener("click", () => updateMix(mix.id, { channelIds: order.slice() }));

    render();

    const hint = document.createElement("p");
    hint.className = "pane-hint";
    hint.style.margin = "10px 0 0";
    hint.textContent = `These channels appear in "${mix.name}" in the order above \u2014 handy for hiding a click track from everyone but the drummer, or putting the important channels first.`;

    panel.append(controls, help, list, addRow, hint);
    return panel;
  }

  $("#btnSyncNames").addEventListener("click", async () => {
    const btn = $("#btnSyncNames");
    btn.disabled = true;
    btn.textContent = "Pulling\u2026";
    try {
      const data = await api("/api/admin/sync-names", { method: "POST" });
      if (data.mode === "mock") {
        toast(`Pulled ${data.updated.channels} channel / ${data.updated.mixes} aux name(s) \u2014 but you're in Simulated mode, so these are placeholder names, not your real console's.`);
      } else {
        toast(`Pulled ${data.updated.channels} channel name(s), ${data.updated.mixes} aux name(s) from the console`);
      }
      await loadAdminConfig();
    } catch (e) {
      toast(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Pull names from console";
    }
  });

  async function updateMix(id, patch) {
    try {
      await api(`/api/admin/mixes/${id}`, { method: "POST", body: JSON.stringify(patch) });
      toast("Saved");
      await loadAdminConfig();
    } catch (e) {
      toast(e.message);
    }
  }

  function renderUsersTable() {
    const wrap = $("#usersTable");
    wrap.innerHTML = "";
    const entries = Object.values(adminConfig.sessions);
    if (!entries.length) {
      wrap.innerHTML = `<p class="pane-hint">No one is connected right now.</p>`;
      return;
    }
    entries.forEach((s) => {
      const mix = adminConfig.mixes.find((m) => m.id === s.mixId);
      const row = document.createElement("div");
      row.className = "row-card";
      row.innerHTML = `
        <div class="row-card__main">
          <strong>${escapeHtml(s.name)}</strong>
          <span class="pane-hint" style="margin:0">${mix ? escapeHtml(mix.name) : "unknown mix"}</span>
          <span class="pane-hint" style="margin:0">Logged in ${formatJoinedAt(s.joinedAt)}</span>
        </div>
        <button class="btn btn--danger btn--sm" data-remove="${escapeHtml(s.name)}">Remove</button>
      `;
      row.querySelector("[data-remove]").addEventListener("click", () => removeSession(s.name));
      wrap.appendChild(row);
    });
  }

  function formatJoinedAt(ts) {
    if (!ts) return "\u2014";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "\u2014";
    try {
      return d.toLocaleString(undefined, {
        year: "numeric", month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit",
      });
    } catch (e) {
      return "\u2014";
    }
  }

  async function refreshAdminUsers() {
    adminConfig.sessions = (await api("/api/admin/config")).sessions;
    renderUsersTable();
  }

  async function removeSession(name) {
    try {
      await api("/api/admin/sessions/remove", { method: "POST", body: JSON.stringify({ name }) });
      toast(`Removed ${name}`);
      await refreshAdminUsers();
    } catch (e) {
      toast(e.message);
    }
  }

  $("#formRemoveByName").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#inputRemoveName").value.trim();
    if (!name) return;
    await removeSession(name);
    $("#inputRemoveName").value = "";
  });

  function renderChannelsTable() {
    $("#inputChannelCount").value = adminConfig.channels.length;
    const wrap = $("#channelsTable");
    wrap.innerHTML = "";
    adminConfig.channels.forEach((ch) => {
      const row = document.createElement("div");
      row.className = "row-card";
      row.innerHTML = `
        <div class="row-card__main">
          <input type="text" value="${escapeHtml(ch.name)}" data-field="name" />
        </div>
        <span class="pane-hint" style="margin:0">Input ${ch.index + 1}</span>
      `;
      const input = row.querySelector('[data-field="name"]');
      input.addEventListener("change", async () => {
        try {
          await api(`/api/admin/channels/${ch.id}`, { method: "POST", body: JSON.stringify({ name: input.value }) });
          toast("Saved");
        } catch (e) { toast(e.message); }
      });
      wrap.appendChild(row);
    });
  }

  $("#btnSaveChannelCount").addEventListener("click", async () => {
    const count = Number($("#inputChannelCount").value);
    try {
      await api("/api/admin/channels/count", { method: "POST", body: JSON.stringify({ count }) });
      toast("Channel count updated");
      await loadAdminConfig();
    } catch (e) { toast(e.message); }
  });

  function fillMixerForm() {
    const m = adminConfig.mixer;
    $("#selMixerMode").value = m.mode;
    $("#inputMixerHost").value = m.host;
    $("#inputMixerPort").value = m.port;
    $("#inputFaderMin").value = m.faderMinDb;
    $("#inputFaderMax").value = m.faderMaxDb;
    if (adminConfig.mixerStatus) setMixerStatus(adminConfig.mixerStatus);
  }

  $("#btnReconnect").addEventListener("click", async () => {
    const btn = $("#btnReconnect");
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "Retrying\u2026";
    try {
      await api("/api/admin/mixer/reconnect", { method: "POST" });
      toast("Reconnecting to the mixer\u2026");
    } catch (e) {
      toast(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });

  $("#formMixer").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/api/admin/mixer", {
        method: "POST",
        body: JSON.stringify({
          host: $("#inputMixerHost").value.trim(),
          port: Number($("#inputMixerPort").value),
          mode: $("#selMixerMode").value,
          faderMinDb: Number($("#inputFaderMin").value),
          faderMaxDb: Number($("#inputFaderMax").value),
        }),
      });
      toast("Mixer settings saved, reconnecting\u2026");
      await loadAdminConfig();
    } catch (e) {
      toast(e.message);
    }
  });

  $("#formAddAdminUser").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = $("#inputNewAdminUsername").value.trim();
    const password = $("#inputNewAdminPassword").value;
    if (!username || !password) return;
    try {
      await api("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      $("#inputNewAdminUsername").value = "";
      $("#inputNewAdminPassword").value = "";
      toast("User added");
      await loadAdminConfig();
    } catch (e) { toast(e.message); }
  });

  function renderAdminUsersTable() {
    const wrap = $("#adminUsersTable");
    wrap.innerHTML = "";
    const users = (adminConfig && adminConfig.users) || [];
    if (!users.length) {
      wrap.innerHTML = `<p class="pane-hint">No admin users yet.</p>`;
      return;
    }
    const me = state.adminUsername || (adminConfig && adminConfig.currentUser) || "";
    users.forEach((u) => {
      const isMe = u.username.toLowerCase() === String(me).toLowerCase();
      const row = document.createElement("div");
      row.className = "row-card";
      row.innerHTML = `
        <div class="row-card__main">
          <strong>${escapeHtml(u.username)}</strong>
          ${u.username === "admin" ? '<span class="pane-hint" style="margin:0">built-in</span>' : ""}
          ${isMe ? '<span class="pane-hint" style="margin:0">you</span>' : ""}
        </div>
        <button class="btn btn--secondary btn--sm" data-change-password="${escapeHtml(u.username)}">Change password</button>
        <button class="btn btn--danger btn--sm" data-remove="${escapeHtml(u.username)}" ${u.username === "admin" || isMe ? "disabled" : ""}>Remove</button>
      `;
      wrap.appendChild(row);

      const changeBtn = row.querySelector("[data-change-password]");
      changeBtn.addEventListener("click", async () => {
        const newPassword = window.prompt(`New password for ${u.username} (min 4 characters):`);
        if (newPassword === null) return;
        if (newPassword.length < 4) { toast("Password must be at least 4 characters"); return; }
        try {
          await api(`/api/admin/users/${encodeURIComponent(u.username)}/password`, {
            method: "POST",
            body: JSON.stringify({ password: newPassword }),
          });
          toast("Password updated");
        } catch (e) { toast(e.message); }
      });

      const removeBtn = row.querySelector("[data-remove]");
      if (!removeBtn.disabled) {
        removeBtn.addEventListener("click", async () => {
          if (!window.confirm(`Remove admin user "${u.username}"?`)) return;
          try {
            await api(`/api/admin/users/${encodeURIComponent(u.username)}/remove`, { method: "POST" });
            toast("User removed");
            await loadAdminConfig();
          } catch (e) { toast(e.message); }
        });
      }
    });
  }

  $("#formRaw").addEventListener("submit", async (e) => {
    e.preventDefault();
    const command = $("#inputRawCommand").value.trim();
    if (!command) return;
    try {
      const data = await api("/api/admin/raw", { method: "POST", body: JSON.stringify({ command }) });
      $("#rawOutput").textContent += `> ${command}\n${data.reply}\n\n`;
    } catch (e) {
      $("#rawOutput").textContent += `> ${command}\nERROR: ${e.message}\n\n`;
    }
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // Apply the (possibly custom) landing cover photo. Public — no auth, so it
  // runs whether or not the user is logged in.
  async function applyLandingCover() {
    try {
      const data = await api("/api/landing");
      const el = document.querySelector("#view-landing .landing__scale");
      if (el && data.coverUrl) el.style.backgroundImage = `url('${data.coverUrl}')`;
    } catch (e) { /* keep the bundled default cover */ }
  }

  // ---------------- boot ----------------
  connectWs();
  applyLandingCover();
  if (state.sessionToken) {
    api("/api/session/check")
      .then((data) => {
        state.sessionName = data.name;
        state.currentMix = data.mix;
        subscribeMix(data.mix.id);
        openFaderView();
      })
      .catch(() => { clearSession(); showView("landing"); });
  } else {
    showView("landing");
  }
})();
