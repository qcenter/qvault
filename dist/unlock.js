// src/profile-crypto.js
var FORMAT2 = "qvault-profile-v2";
var MAX = 4 * 1024 * 1024;
var encoder = new TextEncoder();
var decoder = new TextDecoder();
var toBase64 = (b) => {
  let s = "";
  for (const n of b) s += String.fromCharCode(n);
  return btoa(s);
};
function fromBase64(s, max = MAX) {
  if (typeof s !== "string" || s.length > max * 2 || !s.length || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw Error("Invalid encrypted profile");
  const b = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  if (b.length > max) throw Error("Oversized encrypted profile");
  return b;
}
var isPasskeyProfile = (record) => record?.format === FORMAT2;
var sized = (value, size) => {
  try {
    return fromBase64(value, size).length === size;
  } catch {
    return false;
  }
};
function validateSlot(slot) {
  if (!slot || !["passkey", "recovery"].includes(slot.type) || !sized(slot.salt, 16) || !sized(slot.nonce, 12) || !sized(slot.wrapped, 48)) throw Error("Invalid encrypted profile");
  if (slot.type === "passkey") {
    let id;
    try {
      id = fromBase64(slot.credentialId, 1024);
    } catch {
      throw Error("Invalid encrypted profile");
    }
    if (!id.length || !sized(slot.prfSalt, 32)) throw Error("Invalid encrypted profile");
  }
}
function validateEnvelope(record) {
  if (isPasskeyProfile(record)) {
    if (!/^[a-f0-9-]{36}$/.test(record.profileId) || !/^[a-f0-9-]{36}$/.test(record.revision) || !Array.isArray(record.slots) || record.slots.length < 1 || record.slots.length > 8) throw Error("Unsupported encrypted profile");
    for (const slot of record.slots) validateSlot(slot);
    if (!record.slots.some((s) => s.type === "recovery")) throw Error("Invalid encrypted profile");
    if (fromBase64(record.nonce, 12).length !== 12 || fromBase64(record.ciphertext).length < 16) throw Error("Invalid encrypted profile");
    return record;
  }
  throw Error("Unsupported encrypted profile");
}
var ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
var NO_OPEN = "This passkey or recovery key does not open the saved vault";
function parseRecoveryKey(text) {
  if (typeof text !== "string") throw Error("Invalid recovery key");
  const clean = text.toUpperCase().replace(/[\s-]/g, "");
  if (!/^[A-Z2-7]{52}$/.test(clean)) throw Error("Invalid recovery key");
  const out = new Uint8Array(32);
  let bits = 0, value = 0, index = 0;
  for (const c of clean) {
    value = value << 5 | ALPHABET.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      if (index < 32) out[index++] = value >>> bits - 8 & 255;
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  if (index !== 32 || value !== 0) {
    out.fill(0);
    throw Error("Invalid recovery key");
  }
  return out;
}
var slotAad = (profileId, slot) => encoder.encode(JSON.stringify({ format: FORMAT2, purpose: "profile-key", profileId, type: slot.type, credentialId: slot.credentialId ?? null, prfSalt: slot.prfSalt ?? null }));
var aad2 = (record) => encoder.encode(JSON.stringify({ format: FORMAT2, profileId: record.profileId, revision: record.revision }));
async function slotKey(secret, salt, type, usage) {
  const material = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: encoder.encode("qvault-profile-key/" + type) }, material, { name: "AES-GCM", length: 256 }, false, [usage]);
}
async function wrapSlot(slot, secret, raw, profileId) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), nonce = crypto.getRandomValues(new Uint8Array(12)), key = await slotKey(secret, salt, slot.type, "encrypt");
  return { ...slot, salt: toBase64(salt), nonce: toBase64(nonce), wrapped: toBase64(new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: slotAad(profileId, slot) }, key, raw))) };
}
async function unwrapSlot(slot, secret, profileId) {
  const key = await slotKey(secret, fromBase64(slot.salt, 16), slot.type, "decrypt");
  const raw = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(slot.nonce, 12), additionalData: slotAad(profileId, slot) }, key, fromBase64(slot.wrapped, 48)));
  try {
    if (raw.length !== 32) throw Error();
    return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  } finally {
    raw.fill(0);
  }
}
async function addPasskeyToProfile(record, secret, { prf, credentialId, prfSalt }) {
  validateEnvelope(record);
  if (!isPasskeyProfile(record)) throw Error("Only a passkey vault can get another passkey");
  if (!(prf instanceof Uint8Array) || prf.length < 32) throw Error("Invalid passkey secret");
  if (record.slots.length >= 8) throw Error("This vault already has too many passkeys");
  if (record.slots.some((s) => s.type === "passkey" && s.credentialId === credentialId)) throw Error("This passkey is already added to the vault");
  const opened = await openPasskeyProfile(record, secret), raw = await profileKeyBytes(record, secret);
  try {
    const slot = await wrapSlot({ type: "passkey", credentialId, prfSalt }, prf, raw, record.profileId);
    validateSlot(slot);
    return await sealPasskeyProfile(opened.payload, { ...opened.handle, slots: [...record.slots, slot] });
  } finally {
    raw.fill(0);
  }
}
async function profileKeyBytes(record, secret) {
  let bytes2, type;
  if (secret?.prf instanceof Uint8Array && secret.prf.length >= 32) {
    bytes2 = secret.prf;
    type = "passkey";
  } else if (typeof secret?.recoveryKey === "string") {
    try {
      bytes2 = parseRecoveryKey(secret.recoveryKey);
    } catch {
      throw Error(NO_OPEN);
    }
    type = "recovery";
  } else throw Error(NO_OPEN);
  try {
    for (const slot of record.slots.filter((s) => s.type === type)) {
      try {
        const key = await slotKey(bytes2, fromBase64(slot.salt, 16), slot.type, "decrypt");
        const raw = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(slot.nonce, 12), additionalData: slotAad(record.profileId, slot) }, key, fromBase64(slot.wrapped, 48)));
        if (raw.length === 32) return raw;
        raw.fill(0);
      } catch {
      }
    }
  } finally {
    if (type === "recovery") bytes2.fill(0);
  }
  throw Error(NO_OPEN);
}
async function sealPasskeyProfile(payload, handle) {
  const record = { format: FORMAT2, profileId: handle.profileId, revision: crypto.randomUUID(), slots: handle.slots, nonce: toBase64(crypto.getRandomValues(new Uint8Array(12))) };
  const bytes2 = encoder.encode(JSON.stringify(payload));
  if (bytes2.length > MAX - 16) {
    bytes2.fill(0);
    throw Error("Profile is too large");
  }
  try {
    record.ciphertext = toBase64(new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: fromBase64(record.nonce), additionalData: aad2(record) }, handle.key, bytes2)));
    return record;
  } finally {
    bytes2.fill(0);
  }
}
async function openPasskeyProfile(record, secret) {
  let bytes2 = null, type;
  if (secret?.prf instanceof Uint8Array && secret.prf.length >= 32) {
    bytes2 = secret.prf;
    type = "passkey";
  } else if (typeof secret?.recoveryKey === "string") {
    try {
      bytes2 = parseRecoveryKey(secret.recoveryKey);
    } catch {
      throw Error(NO_OPEN);
    }
    type = "recovery";
  } else throw Error(NO_OPEN);
  let key = null;
  try {
    for (const slot of record.slots.filter((s) => s.type === type)) {
      try {
        key = await unwrapSlot(slot, bytes2, record.profileId);
        break;
      } catch {
      }
    }
  } finally {
    if (type === "recovery") bytes2.fill(0);
  }
  if (!key) throw Error(NO_OPEN);
  let plain;
  try {
    plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(record.nonce), additionalData: aad2(record) }, key, fromBase64(record.ciphertext)));
    return { payload: JSON.parse(decoder.decode(plain)), handle: { format: FORMAT2, key, profileId: record.profileId, slots: record.slots } };
  } catch {
    throw Error(NO_OPEN);
  } finally {
    plain?.fill(0);
  }
}
async function openProfile(record, secret) {
  validateEnvelope(record);
  return openPasskeyProfile(record, secret);
}

// src/profile-store.js
var DB = "qvault-protected";
var STORE = "profiles";
var KEY = "active";
var LOCK_MINUTES = [1, 5, 15, 30];
var ProfileStore = class {
  constructor(idb = globalThis.indexedDB) {
    this.idb = idb;
  }
  async db() {
    if (!this.idb) throw Error("Protected browser storage is unavailable");
    return new Promise((resolve, reject) => {
      const r = this.idb.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onerror = () => reject(Error("Could not open protected browser storage"));
      r.onblocked = () => reject(Error("Close other QVault tabs before opening storage"));
      r.onsuccess = () => resolve(r.result);
    });
  }
  async getDeviceId() {
    const db = await this.db();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite"), store2 = tx.objectStore(STORE), r = store2.get("device-id");
        let value;
        r.onsuccess = () => {
          value = r.result;
          if (!value) {
            value = crypto.randomUUID();
            store2.put(value, "device-id");
          }
        };
        tx.oncomplete = () => resolve(value);
        tx.onerror = () => reject(Error("Could not read device identity"));
        tx.onabort = () => reject(Error("Device identity read aborted"));
      });
    } finally {
      db.close();
    }
  }
  async read() {
    const db = await this.db();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly"), r = tx.objectStore(STORE).get(KEY);
        let value = null;
        r.onsuccess = () => {
          value = r.result ?? null;
        };
        tx.oncomplete = () => resolve(value);
        tx.onerror = () => reject(Error("Could not read protected profile"));
        tx.onabort = () => reject(Error("Profile read aborted"));
      });
    } finally {
      db.close();
    }
  }
  async save(record, expectedRevision = null) {
    validateEnvelope(record);
    const db = await this.db();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite"), store2 = tx.objectStore(STORE), r = store2.get(KEY);
        let conflict = false;
        r.onsuccess = () => {
          const current = r.result;
          if ((current?.revision ?? null) !== expectedRevision) {
            conflict = true;
            tx.abort();
            return;
          }
          store2.put(record, KEY);
          store2.delete("setup-storage");
        };
        tx.oncomplete = resolve;
        tx.onabort = () => reject(Error(conflict ? "Profile changed in another tab; lock and unlock before saving" : "Profile save aborted"));
        tx.onerror = () => reject(Error("Could not save protected profile"));
      });
    } finally {
      db.close();
    }
  }
  // Small device-local helpers. The snapshot copy is the same ciphertext as the cloud object; the capability record holds no secret.
  async value(key) {
    const db = await this.db();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly"), r = tx.objectStore(STORE).get(key);
        let result = null;
        r.onsuccess = () => result = r.result ?? null;
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(Error("Could not read local data"));
        tx.onabort = () => reject(Error("Local data read aborted"));
      });
    } finally {
      db.close();
    }
  }
  async put(key, value) {
    const db = await this.db();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(Error("Could not save local data"));
        tx.onabort = () => reject(Error("Local data save aborted"));
      });
    } finally {
      db.close();
    }
  }
  async readSnapshotCache(object) {
    const entry = await this.value("snapshot-cache");
    return entry && entry.object === object && typeof entry.text === "string" ? entry.text : null;
  }
  async writeSnapshotCache(object, text) {
    if (typeof object !== "string" || !/^qvault\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.json$/.test(object) || typeof text !== "string") throw Error("Invalid snapshot copy");
    if (text.length > 2 * 1024 * 1024 + 65536) throw Error("Snapshot copy is too large");
    await this.put("snapshot-cache", { object, text });
  }
  // How long an unlocked vault may sit unused before it locks itself. Not a secret; kept beside the profile.
  async readLockMinutes() {
    const v = await this.value("lock-minutes");
    return LOCK_MINUTES.includes(v) ? v : null;
  }
  async writeLockMinutes(v) {
    if (!LOCK_MINUTES.includes(v)) throw Error("Invalid lock time");
    await this.put("lock-minutes", v);
  }
  // Whether showing a saved password in the editor needs the passkey again. On unless the person turned it off.
  async readConfirmReveal() {
    return await this.value("confirm-reveal") !== false;
  }
  async writeConfirmReveal(v) {
    if (typeof v !== "boolean") throw Error("Invalid setting");
    await this.put("confirm-reveal", v);
  }
  async readCapability() {
    const c = await this.value("sync-capability");
    return c && typeof c.profileId === "string" && typeof c.bucket === "string" && typeof c.region === "string" && ["shared", "single"].includes(c.mode) && Number.isFinite(c.checkedAt) ? c : null;
  }
  async writeCapability({ profileId, bucket, region, mode, checkedAt }) {
    if (typeof profileId !== "string" || typeof bucket !== "string" || typeof region !== "string" || !["shared", "single"].includes(mode) || !Number.isFinite(checkedAt)) throw Error("Invalid capability record");
    await this.put("sync-capability", { profileId, bucket, region, mode, checkedAt });
  }
  async reset(expectedRevision, kind = "profile") {
    if (typeof expectedRevision !== "string" || !/^[a-f0-9-]{36}$/.test(expectedRevision)) throw Error("Refresh Setup before resetting this device");
    const db = await this.db();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite"), store2 = tx.objectStore(STORE), r = store2.get(kind === "settings" ? "setup-storage" : KEY);
        let conflict = false;
        r.onsuccess = () => {
          if (r.result?.revision !== expectedRevision) {
            conflict = true;
            tx.abort();
            return;
          }
          const active = store2.get(KEY);
          active.onsuccess = () => {
            if (kind === "settings" && active.result) {
              conflict = true;
              tx.abort();
              return;
            }
            store2.delete(KEY);
            store2.delete("device-id");
            store2.delete("setup-storage");
            store2.delete("snapshot-cache");
            store2.delete("sync-capability");
          };
        };
        tx.oncomplete = resolve;
        tx.onabort = () => reject(Error(conflict ? "Profile changed. Open Reset this device again and review it." : "Local reset aborted"));
        tx.onerror = () => reject(Error("Could not reset this device"));
      });
    } finally {
      db.close();
    }
  }
};
async function acquireProfileLease(locks = globalThis.navigator?.locks) {
  if (!locks?.request) throw Error("This browser does not support exclusive QVault sessions");
  let release;
  const done = new Promise((r) => {
    release = r;
  });
  let resolveReady, rejectReady;
  const ready = new Promise((r, j) => {
    resolveReady = r;
    rejectReady = j;
  });
  const request = locks.request("qvault-profile-session", { mode: "exclusive", ifAvailable: true }, async (lock) => {
    if (!lock) {
      rejectReady(Error("QVault is already unlocked in another tab"));
      return;
    }
    resolveReady(release);
    await done;
  });
  request.catch(rejectReady);
  return ready;
}

// src/passkey.js
var PasskeyError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};
var bytes = (n) => crypto.getRandomValues(new Uint8Array(n));
var failure = (e) => e instanceof PasskeyError ? e : e?.name === "AbortError" ? new PasskeyError("withdrawn", "The passkey request was withdrawn.") : e?.name === "NotAllowedError" ? new PasskeyError("cancelled", "The passkey request was cancelled or timed out.") : new PasskeyError("failed", "The passkey request failed (" + (typeof e?.name === "string" && /^[A-Za-z]{1,40}$/.test(e.name) ? e.name : "Error") + ").");
var copy = (value) => value ? new Uint8Array(value.buffer ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) : value.slice(0)) : null;
var base64url = (b64) => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
var usable = (container) => {
  if (typeof container?.create !== "function" || typeof container?.get !== "function") throw new PasskeyError("unavailable", "This browser does not offer passkeys to the extension.");
};
var NO_SECRET = "This passkey provider does not return the secret QVault needs. Choose a different provider, such as iCloud Keychain or the browser profile.";
async function passkeySecret({ container = globalThis.navigator?.credentials, slots, signal }) {
  usable(container);
  const usableSlots = (slots || []).filter((s) => s?.type === "passkey");
  if (!usableSlots.length) throw new PasskeyError("no-passkey", "This vault has no passkey. Use the recovery key.");
  let assertion;
  try {
    assertion = await container.get({ ...signal ? { signal } : {}, publicKey: { challenge: bytes(32), allowCredentials: usableSlots.map((s) => ({ type: "public-key", id: fromBase64(s.credentialId, 1024) })), userVerification: "required", timeout: 12e4, extensions: { prf: { evalByCredential: Object.fromEntries(usableSlots.map((s) => [base64url(s.credentialId), { first: fromBase64(s.prfSalt, 32) }])) } } } });
  } catch (e) {
    throw failure(e);
  }
  const prf = copy(assertion?.getClientExtensionResults?.().prf?.results?.first);
  if (!prf || prf.length < 32) throw new PasskeyError("no-secret", NO_SECRET);
  return { prf, credentialId: assertion.rawId ? toBase64(new Uint8Array(assertion.rawId)) : null };
}
async function createPasskey({ container = globalThis.navigator?.credentials, label = "QVault vault" } = {}) {
  usable(container);
  const salt = bytes(32);
  let created;
  try {
    created = await container.create({ publicKey: { rp: { name: "QVault" }, user: { id: bytes(16), name: label, displayName: label }, challenge: bytes(32), pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }], authenticatorSelection: { residentKey: "preferred", userVerification: "required" }, timeout: 12e4, extensions: { prf: { eval: { first: salt } } } } });
  } catch (e) {
    throw failure(e);
  }
  if (!created?.rawId) throw new PasskeyError("failed", "The passkey was not created.");
  const credentialId = toBase64(new Uint8Array(created.rawId)), prfSalt = toBase64(salt), results = created.getClientExtensionResults?.().prf;
  let prf = copy(results?.results?.first);
  if (prf && prf.length < 32) prf = null;
  if (!prf) {
    if (!results) throw new PasskeyError("no-secret", NO_SECRET);
    prf = (await passkeySecret({ container, slots: [{ type: "passkey", credentialId, prfSalt }] })).prf;
  }
  return { credentialId, prfSalt, prf };
}

// src/unlock.js
var $ = (id) => document.getElementById(id);
var store = new ProfileStore();
var busy = false;
var prompt = null;
function note(text, error = false) {
  $("unlock-status").textContent = text;
  $("unlock-status").className = error ? "storage-error" : "";
}
async function send(message) {
  const r = await chrome.runtime.sendMessage(message);
  if (!r) throw Error("QVault is unavailable. Reopen this window from the QVault toolbar icon.");
  if (r.error) throw Error(r.error);
  return r.data;
}
var params = new URLSearchParams(globalThis.location?.search || "");
var reveal = params.get("reveal") ? { id: params.get("reveal"), origin: params.get("origin") } : null;
var hideTimer = null;
var shown = "";
var fallback = false;
var left = 0;
var copied = false;
function roomFor(password) {
  for (const id of ["passkey-actions", "unlock-intro"]) $(id).hidden = password;
  $("recovery-details").hidden = password || !!reveal && !fallback;
  $("unlock-main").className = "unlock-window" + (password ? " revealing" : "");
}
function hidePassword() {
  shown = "";
  $("reveal-password").textContent = "";
  $("reveal-previous").textContent = "";
  $("reveal-previous").hidden = true;
  $("reveal-box").hidden = true;
  roomFor(false);
  clearInterval(hideTimer);
}
function showPassword(entry) {
  shown = entry.password;
  $("reveal-title").textContent = entry.title;
  $("reveal-user").textContent = entry.username;
  $("reveal-password").textContent = entry.password || "(no password saved)";
  if (entry.previous) {
    let when = "";
    try {
      when = " (replaced " + new Date(entry.previous.at).toLocaleString() + ")";
    } catch {
    }
    $("reveal-previous").textContent = "Previous password" + when + ": " + entry.previous.password;
    $("reveal-previous").hidden = false;
  }
  $("reveal-box").hidden = false;
  roomFor(true);
  left = 30;
  copied = false;
  countdown();
  clearInterval(hideTimer);
  hideTimer = setInterval(() => {
    left--;
    if (left <= 0) {
      hidePassword();
      note("Hidden again. You can close this window.");
    } else countdown();
  }, 1e3);
}
function countdown() {
  note((copied ? "Copied. " : "") + "Hidden in " + left + " s.");
}
if (reveal) {
  $("unlock-heading").textContent = "Show password";
  $("unlock-intro").textContent = "Confirm with your passkey to see the saved password.";
  $("passkey-go-label").textContent = "Confirm with passkey";
  $("recovery-details").hidden = true;
  $("recovery-add-label").hidden = true;
  $("recovery-submit").textContent = "Show with recovery key";
}
$("reveal-copy").onclick = async () => {
  try {
    await navigator.clipboard.writeText(shown);
    copied = true;
    countdown();
  } catch {
    note("Could not copy. Select the password and copy it yourself.", true);
  }
};
$("reveal-close").onclick = () => {
  hidePassword();
  globalThis.close?.();
};
function finish() {
  note("Unlocked. You can close this window and use QVault.");
  setTimeout(() => globalThis.close?.(), 900);
}
async function withPasskey() {
  if (busy || prompt) return;
  const mine = prompt = new AbortController();
  $("passkey-go").disabled = true;
  let secret = null;
  try {
    const record = await store.read();
    if (!record) {
      note("There is no vault on this device yet. Open Setup from the QVault toolbar icon.", true);
      return;
    }
    if (!isPasskeyProfile(record)) {
      note("This vault was made by an older version without passkeys, which is no longer supported. Reset this device on the Backup & restore page.", true);
      return;
    }
    note("Confirm with your passkey\u2026");
    secret = await passkeySecret({ slots: record.slots, signal: mine.signal });
    if (mine.signal.aborted) return;
    busy = true;
    if (reveal) {
      hidePassword();
      note("Checking\u2026");
      showPassword(await send({ action: "reveal", ...reveal, prf: toBase64(secret.prf) }));
      return;
    }
    note("Unlocking and reading your saved vault\u2026");
    await send({ action: "unlock", prf: toBase64(secret.prf) });
    finish();
  } catch (e) {
    if (!mine.signal.aborted) {
      if (reveal && e instanceof PasskeyError) {
        fallback = true;
        $("recovery-details").hidden = false;
      }
      note(e.message + (e instanceof PasskeyError ? " Try again, or use your recovery key below." : ""), true);
    }
  } finally {
    secret?.prf?.fill(0);
    if (prompt === mine) {
      prompt = null;
      busy = false;
    }
    $("passkey-go").disabled = false;
  }
}
$("passkey-go").onclick = withPasskey;
$("unlock-cancel").onclick = () => {
  prompt?.abort();
  prompt = null;
  hidePassword();
  globalThis.close?.();
};
async function addPasskey(recoveryKey) {
  const release = await acquireProfileLease();
  let made = null;
  try {
    const record = await store.read();
    if (!record || !isPasskeyProfile(record)) throw Error("This vault cannot get a passkey here.");
    await openProfile(record, { recoveryKey });
    note("Confirm creating a passkey for this computer\u2026");
    made = await createPasskey();
    const next = await addPasskeyToProfile(record, { recoveryKey }, made);
    await store.save(next, record.revision);
  } finally {
    made?.prf?.fill(0);
    release();
  }
}
$("recovery-form").onsubmit = async (e) => {
  e.preventDefault();
  if (busy) return;
  prompt?.abort();
  prompt = null;
  busy = true;
  const recoveryKey = $("recovery-key").value, add = $("recovery-add-passkey").checked === true;
  $("recovery-key").value = "";
  try {
    if (reveal) {
      hidePassword();
      note("Checking\u2026");
      showPassword(await send({ action: "reveal", ...reveal, recoveryKey }));
      return;
    }
    if (add) {
      await addPasskey(recoveryKey);
      $("recovery-add-passkey").checked = false;
    }
    note("Unlocking with your recovery key\u2026");
    await send({ action: "unlock", recoveryKey });
    finish();
  } catch (e2) {
    note(e2.message + (e2 instanceof PasskeyError ? " No passkey was added." : ""), true);
  } finally {
    busy = false;
  }
};
globalThis.addEventListener?.("pagehide", () => {
  $("recovery-key").value = "";
  hidePassword();
});
withPasskey();
//# sourceMappingURL=unlock.js.map
