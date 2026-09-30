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
  const defaultAdminHash = hashPassword("admin123"); // CHANGE THIS after first login
  return {
    admin: {
      // `users[]` is the source of truth for admin accounts (multi-user).
      // `passwordHash` is kept in sync with the legacy built-in "admin" user
      // so old config.json files and old readers keep working.
      users: [{ username: "admin", passwordHash: defaultAdminHash }],
      passwordHash: defaultAdminHash,
    },
    mixer: {
      host: "192.168.1.50",
      port: 49280,
      mode: "mock", // "mock" | "real"
      faderMinDb: -60,
      faderMaxDb: 10,
    },
    channels,
    // Stereo returns (FxRtnCh) — fixed set of 4, always present, can be sent
    // to a mix. `id` prefix "fx" keeps them separate from the mono "ch" ids.
    returns: [
      { id: "fx1", kind: "fx", index: 0, name: "Fx 1" },
      { id: "fx2", kind: "fx", index: 1, name: "Fx 2" },
      { id: "fx3", kind: "fx", index: 2, name: "Fx 3" },
      { id: "fx4", kind: "fx", index: 3, name: "Fx 4" },
    ],
    // DCA group faders — fixed set of 8, not sent to mixes; each band member
    // can move a DCA fader, which scales its group on the main mix.
    dca: Array.from({ length: 8 }, (_, i) => ({ id: `dca${i + 1}`, index: i, name: `DCA ${i + 1}` })),
    mixes,
    sessions: {}, // key: lowercased name -> { name, mixId, token, lastSeen, removed }
  };
}

// Keep `admin.passwordHash` mirrored to the built-in "admin" user's hash.
// Older code paths / docs read `passwordHash` directly; the users array is the
// source of truth. The built-in "admin" account can never be deleted.
function syncLegacyAdminHash(data) {
  const adminUser = data.admin.users.find((u) => u.username === "admin");
  data.admin.passwordHash = adminUser ? adminUser.passwordHash : "";
}

// One-way, backward-compatible upgrade of old config.json files:
//   old: { admin: { passwordHash } }               single admin, no username
//   new: { admin: { users: [{username, passwordHash}], passwordHash } }
// The old hash becomes the built-in "admin" user's hash — the existing admin
// password keeps working, only the login form gains a username field.
function migrateAdmin(data) {
  if (!data.admin || typeof data.admin !== "object") data.admin = {};
  if (!Array.isArray(data.admin.users)) {
    data.admin.users = data.admin.passwordHash
      ? [{ username: "admin", passwordHash: data.admin.passwordHash }]
      : [];
  }
  if (!data.admin.users.length) {
    data.admin.users.push({ username: "admin", passwordHash: data.admin.passwordHash || hashPassword("admin123") });
  }
  if (!data.admin.users.some((u) => u.username === "admin")) {
    // security net: never allow all admin accounts to be removed
    data.admin.users.unshift({ username: "admin", passwordHash: hashPassword("admin123") });
  }
  syncLegacyAdminHash(data);
  // Old single-token model -> token-to-username map (one token per browser
  // login, so multiple admins can stay signed in at the same time).
  if (!data._adminTokens) {
    data._adminTokens = {};
    if (typeof data._adminToken === "string" && data._adminToken) {
      data._adminTokens[data._adminToken] = "admin";
    }
    delete data._adminToken;
  }
  // Migrate newer optional collections: stereo returns and DCA groups. These
  // are fixed on the console; old configs simply get them on next load/save.
  if (!Array.isArray(data.returns)) {
    data.returns = [
      { id: "fx1", kind: "fx", index: 0, name: "Fx 1" },
      { id: "fx2", kind: "fx", index: 1, name: "Fx 2" },
      { id: "fx3", kind: "fx", index: 2, name: "Fx 3" },
      { id: "fx4", kind: "fx", index: 3, name: "Fx 4" },
    ];
  }
  if (!Array.isArray(data.dca)) {
    data.dca = Array.from({ length: 8 }, (_, i) => ({ id: `dca${i + 1}`, index: i, name: `DCA ${i + 1}` }));
  }
  return data;
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
  migrateAdmin(cache);
  return cache;
}

function save(data) {
  cache = data;
  migrateAdmin(data);
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), "utf8");
}

module.exports = { load, save, hashPassword, verifyPassword, defaultConfig };
