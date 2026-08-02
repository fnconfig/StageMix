const { EventEmitter } = require("events");

/**
 * Drop-in stand-in for RcpClient. Keeps an in-memory table of levels so the
 * whole app (sliders, mute buttons, admin tools) can be exercised end to end
 * without a physical console attached. Swap MIXER_MODE=real (or the Admin
 * settings screen) to talk to a real TF console once you're ready.
 */
class MockRcpClient extends EventEmitter {
  constructor({ host, port }) {
    super();
    this.host = host;
    this.port = port;
    this.connected = false;
    this.levels = new Map(); // `${ch}:${mix}` -> dB
    this.on_ = new Map(); // `${ch}:${mix}` -> bool (true = unmuted, matches console's "On")
    this.names = new Map(); // ch index -> name
    this.mixNames = new Map(); // mix index -> name

    // Seed a few example console names so "Pull names from console" has
    // something realistic to demonstrate in simulated mode.
    ["Kick", "Snare", "Hi-Hat", "Tom 1", "OH L", "OH R", "Bass", "Acoustic Gtr",
      "Elec Gtr", "Keys L", "Keys R", "Lead Vox", "BGV 1", "BGV 2", "Talkback", "Playback"]
      .forEach((name, i) => this.names.set(i, name));
    ["Drummer", "Guitarist", "Keys Player", "Lead Vocal", "BGV Monitor", "IEM Mix 6",
      "IEM Mix 7", "IEM Mix 8", "Stage Wedge 1", "Stage Wedge 2", "Aux 11", "Aux 12",
      "Aux 13", "Aux 14", "Aux 15", "Aux 16"]
      .forEach((name, i) => this.mixNames.set(i, name));
  }

  start() {
    // simulate a short connect delay
    setTimeout(() => {
      this.connected = true;
      this.emit("status", { connected: true, host: this.host, port: this.port, mock: true });
    }, 300);
  }

  stop() {
    this.connected = false;
  }

  _key(ch, mix) {
    return `${ch}:${mix}`;
  }

  async getToMixLevel(chIndex, mixIndex) {
    await this._latency();
    const k = this._key(chIndex, mixIndex);
    if (!this.levels.has(k)) this.levels.set(k, -60);
    return this.levels.get(k);
  }

  async setToMixLevel(chIndex, mixIndex, db) {
    await this._latency();
    this.levels.set(this._key(chIndex, mixIndex), db);
    return db;
  }

  async setToMixOn(chIndex, mixIndex, on) {
    await this._latency();
    this.on_.set(this._key(chIndex, mixIndex), !!on);
  }

  async getToMixOn(chIndex, mixIndex) {
    await this._latency();
    const k = this._key(chIndex, mixIndex);
    if (!this.on_.has(k)) this.on_.set(k, true); // unmuted by default, like a real console
    return this.on_.get(k);
  }

  async getChannelName(chIndex) {
    await this._latency();
    return this.names.get(chIndex) || null;
  }

  async getMixName(mixIndex) {
    await this._latency();
    return this.mixNames.get(mixIndex) || null;
  }

  async raw(cmd) {
    await this._latency();
    return `OK (mock) echo: ${cmd}`;
  }

  async _latency() {
    if (!this.connected) throw new Error("Not connected to mixer (mock)");
    return new Promise((r) => setTimeout(r, 15));
  }
}

module.exports = { MockRcpClient };
