const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_PATH = path.join(__dirname, "..", "data", "config.json");

// ---- password hashing (scrypt, built into Node - no native deps) ----
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const check = crypto.scryptSync(password, salt, 64).toString("hex");
  // timing-safe compare
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(check, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function defaultConfig() {
  const channels = [];
  for (let i = 0; i < 16; i++) {
    channels.push({ id: `ch${i + 1}`, index: i, name: `Channel ${i + 1}` });
  }
  const mixes = [];
  for (let i = 0; i < 16; i++) {
    mixes.push({
      id: `mix${i + 1}`,
      index: i,
      name: `Aux ${i + 1}`,
      visible: i === 0, // only the first one enabled out of the box
      channelIds: channels.map((c) => c.id), // all channels visible in every mix by default
    });
  }
  return {
    admin: {
      passwordHash: hashPassword("admin123"), // CHANGE THIS after first login
    },
    mixer: {
      host: "192.168.1.50",
      port: 49280,
      mode: "mock", // "mock" | "real"
      faderMinDb: -60,
      faderMaxDb: 10,
    },
    channels,
    mixes,
    sessions: {}, // key: lowercased name -> { name, mixId, token, lastSeen, removed }
  };
}

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    cache = JSON.parse(raw);
  } catch (e) {
    cache = defaultConfig();
    save(cache);
  }
  return cache;
}

function save(data) {
  cache = data;
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), "utf8");
}

module.exports = { load, save, hashPassword, verifyPassword, defaultConfig };
