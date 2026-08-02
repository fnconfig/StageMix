(() => {
  "use strict";

  // ---------------- state ----------------
  const state = {
    sessionToken: localStorage.getItem("sm_session_token") || null,
    sessionName: localStorage.getItem("sm_session_name") || "",
    adminToken: sessionStorage.getItem("sm_admin_token") || null,
    mixes: [],
    currentMix: null,
    faderMin: -60,
    faderMax: 10,
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function showView(name) {
    $$(".view").forEach((v) => v.classList.add("hidden"));
    const el = document.getElementById(`view-${name}`);
    if (el) el.classList.remove("hidden");
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
    const res = await fetch(path, Object.assign({}, opts, { headers }));
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
    showView(name);
  }

  // ---------------- websocket status ----------------
  function connectWs() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
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
      if (msg.type === "sessionsChanged" && state.adminToken) {
        refreshAdminUsers().catch(() => {});
      }
    };
    ws.onclose = () => setTimeout(connectWs, 2000);
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
      btn.innerHTML = `<span>${escapeHtml(m.name)}</span><span class="arrow">Join &rarr;</span>`;
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

  function renderFaderRack(channels) {
    const rack = $("#faderRack");
    rack.innerHTML = "";
    channels.forEach((ch) => {
      const strip = document.createElement("div");
      strip.className = "fader-strip";
      strip.innerHTML = `
        <div class="fader-strip__name">${escapeHtml(ch.name)}</div>
        <div class="fader-strip__db" data-db></div>
        <div class="fader-track" data-min="${state.faderMin}" data-max="${state.faderMax}">
          <div class="fader-cap" data-cap></div>
        </div>
        <button class="mute-btn" data-mute type="button">Mute</button>
      `;
      rack.appendChild(strip);
      const track = strip.querySelector(".fader-track");
      const cap = strip.querySelector("[data-cap]");
      const dbLabel = strip.querySelector("[data-db]");
      const muteBtn = strip.querySelector("[data-mute]");
      setupFader(track, cap, dbLabel, ch, strip);
      setupMute(muteBtn, strip, ch);
    });
  }

  function setupFader(track, cap, dbLabel, channel, strip) {
    const min = state.faderMin, max = state.faderMax;
    let dragging = false;
    let sendTimer = null;

    function place(db) {
      const pct = dbToPercent(db, min, max);
      const trackH = track.clientHeight;
      const capH = cap.clientHeight;
      const top = (1 - pct / 100) * (trackH - capH);
      cap.style.top = `${top}px`;
      dbLabel.textContent = db <= min ? "-\u221e" : `${db.toFixed(1)} dB`;
    }

    place(channel.level);

    function pctFromClientY(clientY) {
      const rect = track.getBoundingClientRect();
      const capH = cap.offsetHeight;
      const usable = rect.height - capH;
      const y = clientY - rect.top - capH / 2;
      const pct = 100 - (y / usable) * 100;
      return Math.max(0, Math.min(100, pct));
    }

    function onMove(clientY) {
      const pct = pctFromClientY(clientY);
      const db = Math.round(percentToDb(pct, min, max) * 10) / 10;
      place(db);
      clearTimeout(sendTimer);
      sendTimer = setTimeout(() => sendLevel(channel.id, db), 60);
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
      dragging = true;
      cap.classList.add("dragging");
      onMove(clientY);
    }
    function end() {
      dragging = false;
      cap.classList.remove("dragging");
    }

    cap.addEventListener("pointerdown", (e) => {
      cap.setPointerCapture(e.pointerId);
      start(e.clientY);
    });
    cap.addEventListener("pointermove", (e) => { if (dragging) onMove(e.clientY); });
    cap.addEventListener("pointerup", end);
    cap.addEventListener("pointercancel", end);

    track.addEventListener("pointerdown", (e) => {
      if (e.target === cap) return;
      start(e.clientY);
      cap.setPointerCapture(e.pointerId);
      dragging = true;
    });
  }

  function setupMute(muteBtn, strip, channel) {
    let muted = channel.on === false; // console's "On"=false means muted
    function render() {
      muteBtn.textContent = muted ? "Muted" : "Mute";
      muteBtn.classList.toggle("muted", muted);
      strip.classList.toggle("is-muted", muted);
    }
    render();

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
    const password = $("#inputAdminPassword").value;
    try {
      const data = await api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      state.adminToken = data.token;
      sessionStorage.setItem("sm_admin_token", data.token);
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
    sessionStorage.removeItem("sm_admin_token");
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
      fillMixerForm();
    } catch (e) {
      toast(e.message);
    }
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

    const selected = new Set(mix.channelIds);

    const controls = document.createElement("div");
    controls.className = "inline-form";
    controls.style.margin = "0 0 10px";
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

    const chipRow = document.createElement("div");
    chipRow.className = "chip-row";

    adminConfig.channels.forEach((ch) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip" + (selected.has(ch.id) ? " on" : "");
      chip.textContent = ch.name;
      chip.addEventListener("click", () => {
        if (selected.has(ch.id)) selected.delete(ch.id); else selected.add(ch.id);
        chip.classList.toggle("on", selected.has(ch.id));
      });
      chipRow.appendChild(chip);
    });

    btnAll.addEventListener("click", () => {
      adminConfig.channels.forEach((ch) => selected.add(ch.id));
      Array.from(chipRow.children).forEach((c) => c.classList.add("on"));
    });
    btnNone.addEventListener("click", () => {
      selected.clear();
      Array.from(chipRow.children).forEach((c) => c.classList.remove("on"));
    });
    btnSave.addEventListener("click", () => updateMix(mix.id, { channelIds: Array.from(selected) }));

    const hint = document.createElement("p");
    hint.className = "pane-hint";
    hint.style.margin = "10px 0 0";
    hint.textContent = `Only these channels will show up in "${mix.name}" for whoever picks it \u2014 handy for hiding a click track from everyone but the drummer, for example.`;

    panel.append(controls, chipRow, hint);
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
        </div>
        <button class="btn btn--danger btn--sm" data-remove="${escapeHtml(s.name)}">Remove</button>
      `;
      row.querySelector("[data-remove]").addEventListener("click", () => removeSession(s.name));
      wrap.appendChild(row);
    });
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

  $("#formPassword").addEventListener("submit", async (e) => {
    e.preventDefault();
    const newPassword = $("#inputNewPassword").value;
    if (!newPassword) return;
    try {
      await api("/api/admin/password", { method: "POST", body: JSON.stringify({ newPassword }) });
      $("#inputNewPassword").value = "";
      toast("Password updated");
    } catch (e) { toast(e.message); }
  });

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

  // ---------------- boot ----------------
  connectWs();
  if (state.sessionToken) {
    api("/api/session/check")
      .then((data) => {
        state.sessionName = data.name;
        state.currentMix = data.mix;
        openFaderView();
      })
      .catch(() => { clearSession(); showView("landing"); });
  } else {
    showView("landing");
  }
})();
