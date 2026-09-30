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
    this.levels = new Map(); // `${kind}:${ch}:${mix}` -> dB
    this.on_ = new Map(); // `${kind}:${ch}:${mix}` -> bool (true = unmuted)
    this.names = new Map(); // `${kind}:${index}` -> name
    this.mixNames = new Map(); // mix index -> name
    this.dcaLevels = new Map(); // dca index -> dB
    this.dcaOn = new Map(); // dca index -> bool
    this.dcaNames = new Map(); // dca index -> name

    // Seed a few example console names so "Pull names from console" has
    // something realistic to demonstrate in simulated mode.
    ["Kick", "Snare", "Hi-Hat", "Tom 1", "OH L", "OH R", "Bass", "Acoustic Gtr",
      "Elec Gtr", "Keys L", "Keys R", "Lead Vox", "BGV 1", "BGV 2", "Talkback", "Playback"]
      .forEach((name, i) => this.names.set(`in:${i}`, name));
    // 4 stereo returns (stereo pairs, named L/R side of the pair like the console)
    ["Fx1L", "Fx2L", "Fx3L", "Fx4L"].forEach((name, i) => this.names.set(`fx:${i}`, name));
    // 8 DCA groups
    ["DCA 1", "DCA 2", "DCA 3", "DCA 4", "DCA 5", "DCA 6", "DCA 7", "DCA 8"]
      .forEach((name, i) => this.dcaNames.set(i, name));
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

  _key(kind, ch, mix) {
    return `${kind}:${ch}:${mix}`;
  }

  async getToMixLevel(kind, chIndex, mixIndex) {
    await this._latency();
    const k = this._key(kind, chIndex, mixIndex);
    if (!this.levels.has(k)) this.levels.set(k, -60);
    return this.levels.get(k);
  }

  async setToMixLevel(kind, chIndex, mixIndex, db) {
    await this._latency();
    this.levels.set(this._key(kind, chIndex, mixIndex), db);
    return db;
  }

  async setToMixOn(kind, chIndex, mixIndex, on) {
    await this._latency();
    this.on_.set(this._key(kind, chIndex, mixIndex), !!on);
  }

  async getToMixOn(kind, chIndex, mixIndex) {
    await this._latency();
    const k = this._key(kind, chIndex, mixIndex);
    if (!this.on_.has(k)) this.on_.set(k, true); // unmuted by default, like a real console
    return this.on_.get(k);
  }

  async getChannelName(kind, chIndex) {
    await this._latency();
    return this.names.get(`${kind}:${chIndex}`) || null;
  }

  async getDcaLevel(dcaIndex) {
    await this._latency();
    if (!this.dcaLevels.has(dcaIndex)) this.dcaLevels.set(dcaIndex, 0); // unity by default
    return this.dcaLevels.get(dcaIndex);
  }

  async setDcaLevel(dcaIndex, db) {
    await this._latency();
    this.dcaLevels.set(dcaIndex, db);
    return db;
  }

  async setDcaOn(dcaIndex, on) {
    await this._latency();
    this.dcaOn.set(dcaIndex, !!on);
  }

  async getDcaOn(dcaIndex) {
    await this._latency();
    if (!this.dcaOn.has(dcaIndex)) this.dcaOn.set(dcaIndex, true); // on by default
    return this.dcaOn.get(dcaIndex);
  }

  async getDcaName(dcaIndex) {
    await this._latency();
    return this.dcaNames.get(dcaIndex) || null;
  }

  async getMixName(mixIndex) {
    await this._latency();
    return this.mixNames.get(mixIndex) || null;
  }

  async getMixLevel(mixIndex) {
    await this._latency();
    const k = `master:${mixIndex}`;
    if (!this.levels.has(k)) this.levels.set(k, 0); // unity by default
    return this.levels.get(k);
  }

  async setMixLevel(mixIndex, db) {
    await this._latency();
    this.levels.set(`master:${mixIndex}`, db);
    return db;
  }

  async getMixOn(mixIndex) {
    await this._latency();
    const k = `master:${mixIndex}`;
    if (!this.on_.has(k)) this.on_.set(k, true); // on (unmuted) by default
    return this.on_.get(k);
  }

  async setMixOn(mixIndex, on) {
    await this._latency();
    this.on_.set(`master:${mixIndex}`, !!on);
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
