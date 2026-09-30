const net = require("net");
const { EventEmitter } = require("events");

/**
 * RcpClient talks to a Yamaha TF-series mixer over the RCP protocol.
 *
 * Protocol reference: https://github.com/BrenekH/yamaha-rcp-docs
 *  - Plain-text TCP, one message per line (\n terminated)
 *  - "get MIXER:<path> <a> <b>"          -> mixer replies "OK MIXER:<path> <a> <b> <value>\n"
 *  - "set MIXER:<path> <a> <b> <value>"  -> mixer replies "OK MIXER:<path> <a> <b> <value>\n"
 *  - "NOTIFY ..." is pushed unsolicited whenever something changes (incl. from
 *    the console's own panel), we surface these via the 'notify' event.
 *  - dB values are integers = dB * 100 (e.g. 10.00 dB -> 1000). -32768 = -inf.
 *
 * Parameter shapes below (index counts, ranges, dB scale) are confirmed
 * against the console's own self-description (`prminfo`), as captured in
 * bitfocus/companion-module-yamaha-rcp's "TF Parameters-1.txt":
 *   InCh/Label/Name   40ch x 1   string          get/set "<ch> 0"
 *   InCh/Fader/Level  40ch x 1   -32768..1000    dB x100
 *   InCh/ToMix/Level  40ch x 20mix  -32768..1000 dB x100    get/set "<ch> <mix>"
 *   InCh/ToMix/On     40ch x 20mix  0..1         bool       get/set "<ch> <mix>"
 *   Mix/Label/Name    20mix x 1  string          get/set "<mix> 0"   (same 1-dim shape as InCh, same "<idx> 0" convention)
 *   Mix/Fader/Level   20mix x 1  -32768..1000    dB x100    get/set "<mix> 0"
 * A TF console only exposes as many of those 40 channels / 20 mixes as it
 * physically has (TF1=16ch, TF3=24ch, TF5=32ch; aux count is configurable),
 * so requests for channels/mixes beyond what's patched will error out - the
 * app treats that as "not available" rather than crashing.
 */


const NEG_INF = -32768;

function dbToUnit(db) {
  if (db <= -1000000) return NEG_INF;
  return Math.round(db * 100);
}

function unitToDb(unit) {
  if (unit === NEG_INF) return -Infinity;
  return unit / 100;
}

class RcpClient extends EventEmitter {
  constructor({ host, port = 49280 }) {
    super();
    this.host = host;
    this.port = port;
    this.socket = null;
    this.buffer = "";
    this.queue = []; // pending { resolve, reject, timer }
    this.connected = false;
    this.shouldRun = true;
    this._reconnectDelay = 1000;
  }

  start() {
    this.shouldRun = true;
    this._connect();
  }

  stop() {
    this.shouldRun = false;
    if (this.socket) this.socket.destroy();
  }

  _connect() {
    if (!this.shouldRun) return;
    console.log(`[RCP] connecting to ${this.host}:${this.port}`);
    this.socket = new net.Socket();
    this.socket.setTimeout(5000);

    this.socket.on("connect", () => {
      this.connected = true;
      this._reconnectDelay = 1000;
      this.socket.setTimeout(0); // no timeout once actually connected
      console.log(`[RCP] connected to ${this.host}:${this.port}`);
      this.emit("status", { connected: true, host: this.host, port: this.port });
    });

    this.socket.on("timeout", () => {
      // Connection attempt (or an unresponsive link) took too long - treat
      // as a failure so the UI doesn't sit on stale/unknown status.
      console.log(`[RCP] connection attempt to ${this.host}:${this.port} timed out`);
      this.socket.destroy(new Error("Connection to mixer timed out"));
    });

    this.socket.on("data", (chunk) => this._onData(chunk));

    this.socket.on("error", (err) => {
      console.log(`[RCP] socket error: ${err.message}`);
      this.emit("status", { connected: false, error: err.message, host: this.host, port: this.port });
    });

    this.socket.on("close", () => {
      this.connected = false;
      console.log(`[RCP] connection lost${this.shouldRun ? `, reconnecting in ${this._reconnectDelay}ms` : ""}`);
      this.emit("status", { connected: false, host: this.host, port: this.port });
      // fail any pending requests
      while (this.queue.length) {
        const p = this.queue.shift();
        clearTimeout(p.timer);
        p.reject(new Error("Connection closed"));
      }
      if (this.shouldRun) {
        setTimeout(() => this._connect(), this._reconnectDelay);
        this._reconnectDelay = Math.min(this._reconnectDelay * 1.5, 15000);
      }
    });

    this.socket.connect(this.port, this.host);
  }

  _onData(chunk) {
    this.buffer += chunk.toString("utf8");
    let idx;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, "");
      this.buffer = this.buffer.slice(idx + 1);
      if (line.length) this._onLine(line);
    }
  }

  _onLine(line) {
    if (line.startsWith("NOTIFY")) {
      this.emit("notify", line);
      return;
    }
    // OK / OKm / ERROR responses go to the oldest pending request (protocol
    // has no correlation id, so we serialize requests one-at-a-time).
    const pending = this.queue.shift();
    if (pending) {
      clearTimeout(pending.timer);
      if (line.startsWith("ERROR")) pending.reject(new Error(line));
      else pending.resolve(line);
    } else {
      this.emit("unsolicited", line);
    }
  }

  _send(cmd) {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.socket) {
        reject(new Error("Not connected to mixer"));
        return;
      }
      const timer = setTimeout(() => {
        // A response with no correlation id can still arrive late after we've
        // given up on it - if we just dropped our own wait here, that stray
        // reply would land on whatever request is next in line and hand it
        // the wrong value. Safer to treat a timeout as "this connection is in
        // an unknown state" and reconnect cleanly (this also rejects every
        // other pending request via the socket's 'close' handler).
        console.log(`[RCP] command timed out: ${cmd}`);
        reject(new Error("Mixer did not respond in time"));
        if (this.socket) this.socket.destroy(new Error("Command timed out"));
      }, 5000);
      this.queue.push({ resolve, reject, timer });
      this.socket.write(cmd + "\n");
    });
  }

  // ---- high level helpers ----
  // Channel "kind" selects the RCP element: "in" = mono InCh, "fx" = stereo
  // return FxRtnCh. Both share the identical ToMix/Level|On and Label/Name
  // shapes (N x 20 and N x 0), so only the path segment differs.
  static _chPath(kind, sub) {
    const seg = kind === "fx" ? "FxRtnCh" : "InCh";
    return `MIXER:Current/${seg}/${sub}`;
  }

  async getToMixLevel(kind, chIndex, mixIndex) {
    const line = await this._send(`get ${RcpClient._chPath(kind, "ToMix/Level")} ${chIndex} ${mixIndex}`);
    return unitToDb(this._extractValue(line));
  }

  async setToMixLevel(kind, chIndex, mixIndex, db) {
    const unit = dbToUnit(db);
    await this._send(`set ${RcpClient._chPath(kind, "ToMix/Level")} ${chIndex} ${mixIndex} ${unit}`);
    return db;
  }

  async setToMixOn(kind, chIndex, mixIndex, on) {
    await this._send(`set ${RcpClient._chPath(kind, "ToMix/On")} ${chIndex} ${mixIndex} ${on ? 1 : 0}`);
  }

  async getToMixOn(kind, chIndex, mixIndex) {
    const line = await this._send(`get ${RcpClient._chPath(kind, "ToMix/On")} ${chIndex} ${mixIndex}`);
    return this._extractValue(line) === 1;
  }

  async getChannelName(kind, chIndex) {
    const line = await this._send(`get ${RcpClient._chPath(kind, "Label/Name")} ${chIndex} 0`);
    const m = line.match(/"([^"]*)"/);
    return m ? m[1] : null;
  }

  // ---- DCA (group) faders ----
  // DCA has no ToMix send; a DCA fader scales the level of its assigned group
  // on the main mix. Paths confirmed via prminfo 48/50/58 (DCA/Fader/Level,
  // DCA/Fader/On, DCA/Label/Name: all 8 x 0).
  async getDcaLevel(dcaIndex) {
    const line = await this._send(`get MIXER:Current/DCA/Fader/Level ${dcaIndex} 0`);
    return unitToDb(this._extractValue(line));
  }

  async setDcaLevel(dcaIndex, db) {
    const unit = dbToUnit(db);
    await this._send(`set MIXER:Current/DCA/Fader/Level ${dcaIndex} 0 ${unit}`);
    return db;
  }

  async setDcaOn(dcaIndex, on) {
    await this._send(`set MIXER:Current/DCA/Fader/On ${dcaIndex} 0 ${on ? 1 : 0}`);
  }

  async getDcaOn(dcaIndex) {
    const line = await this._send(`get MIXER:Current/DCA/Fader/On ${dcaIndex} 0`);
    return this._extractValue(line) === 1;
  }

  async getDcaName(dcaIndex) {
    const line = await this._send(`get MIXER:Current/DCA/Label/Name ${dcaIndex} 0`);
    const m = line.match(/"([^"]*)"/);
    return m ? m[1] : null;
  }

  // Mix (aux) label shares the exact same "N x 0" dims shape as InCh/Label/Name
  // (confirmed via prminfo), so it takes the same two index args (index, 0)
  // rather than a single one - this was the bug behind wrong aux names.
  async getMixName(mixIndex) {
    const line = await this._send(`get MIXER:Current/Mix/Label/Name ${mixIndex} 0`);
    const m = line.match(/"([^"]*)"/);
    return m ? m[1] : null;
  }

  // Master fader level for an aux mix (Mix/Fader/Level uses same N×0 shape)
  async getMixLevel(mixIndex) {
    const line = await this._send(`get MIXER:Current/Mix/Fader/Level ${mixIndex} 0`);
    return unitToDb(this._extractValue(line));
  }

  async setMixLevel(mixIndex, db) {
    const unit = dbToUnit(db);
    await this._send(`set MIXER:Current/Mix/Fader/Level ${mixIndex} 0 ${unit}`);
    return db;
  }

  // Mix master on/off ("On" == unmuted, same convention as InCh/ToMix/On).
  // Path confirmed via prminfo 61: MIXER:Current/Mix/Fader/On (20 mix x 0, 0..1, default 1).
  async getMixOn(mixIndex) {
    const line = await this._send(`get MIXER:Current/Mix/Fader/On ${mixIndex} 0`);
    return this._extractValue(line) === 1;
  }

  async setMixOn(mixIndex, on) {
    await this._send(`set MIXER:Current/Mix/Fader/On ${mixIndex} 0 ${on ? 1 : 0}`);
  }

  async raw(cmd) {
    return this._send(cmd);
  }

  _extractValue(line) {
    const parts = line.trim().split(/\s+/);
    const last = parts[parts.length - 1];
    return parseInt(last, 10);
  }
}

module.exports = { RcpClient, dbToUnit, unitToDb };
