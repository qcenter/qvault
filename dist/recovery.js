// src/recovery-messages.js
function restoredMessage() {
  return "Vault restored. Click the QVault icon and choose Unlock with passkey. If your passkey is not on this computer, use your recovery key in that window.";
}
function backupMessage() {
  return "Backup downloaded. Store it safely. To restore it you need your passkey or your recovery key.";
}

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
        const tx = db.transaction(STORE, "readwrite"), store = tx.objectStore(STORE), r = store.get("device-id");
        let value;
        r.onsuccess = () => {
          value = r.result;
          if (!value) {
            value = crypto.randomUUID();
            store.put(value, "device-id");
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
        const tx = db.transaction(STORE, "readwrite"), store = tx.objectStore(STORE), r = store.get(KEY);
        let conflict = false;
        r.onsuccess = () => {
          const current = r.result;
          if ((current?.revision ?? null) !== expectedRevision) {
            conflict = true;
            tx.abort();
            return;
          }
          store.put(record, KEY);
          store.delete("setup-storage");
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
        const tx = db.transaction(STORE, "readwrite"), store = tx.objectStore(STORE), r = store.get(kind === "settings" ? "setup-storage" : KEY);
        let conflict = false;
        r.onsuccess = () => {
          if (r.result?.revision !== expectedRevision) {
            conflict = true;
            tx.abort();
            return;
          }
          const active = store.get(KEY);
          active.onsuccess = () => {
            if (kind === "settings" && active.result) {
              conflict = true;
              tx.abort();
              return;
            }
            store.delete(KEY);
            store.delete("device-id");
            store.delete("setup-storage");
            store.delete("snapshot-cache");
            store.delete("sync-capability");
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

// src/setup-profile.js
var SetupProfile = class {
  constructor({ store = new ProfileStore(), lease = acquireProfileLease } = {}) {
    this.store = store;
    this.lease = lease;
  }
  async read() {
    const record = await this.store.read();
    return record ? validateEnvelope(record) : null;
  }
  async backup() {
    const record = await this.read();
    if (!record) throw Error("No saved profile to back up");
    return JSON.stringify(record);
  }
  async restore(file) {
    if (!file || file.size > 8 * 1024 * 1024) throw Error("Choose an encrypted QVault backup smaller than 8 MB");
    const record = validateEnvelope(JSON.parse(await file.text()));
    const release = await this.lease();
    try {
      await this.store.save(record, null);
      return record.profileId;
    } finally {
      release();
    }
  }
  async resetTarget() {
    return this.read();
  }
  // Proven with the recovery key, or with secret {prf} from a passkey when no recovery key is typed.
  async reset({ revision, recoveryKey, confirmation, acknowledged, secret }) {
    if (confirmation !== "RESET" || acknowledged !== true) throw Error("Type RESET and confirm that you understand the local data removal");
    const release = await this.lease();
    try {
      const record = await this.read();
      if (!record || record.revision !== revision) throw Error("Profile changed. Open Reset this device again and review it.");
      await openProfile(record, secret?.prf ? { prf: secret.prf } : { recoveryKey });
      await this.store.reset(revision, "profile");
    } finally {
      release();
    }
  }
};

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

// src/recovery.js
var $ = (id) => document.getElementById(id);
var profile = new SetupProfile();
var busy = false;
var resetRevision = null;
function note(message) {
  $("profile-message").textContent = message;
}
function clearReset() {
  resetRevision = null;
  $("reset-form").hidden = true;
  for (const id of ["reset-password", "reset-confirm"]) $(id).value = "";
  $("reset-ack").checked = false;
  $("reset-message").textContent = "";
}
async function refresh() {
  const record = await profile.read(), target = record;
  $("reset-open").disabled = !target || busy;
  $("reset-secret-label").textContent = "Recovery key (leave empty to confirm with your passkey instead)";
  $("reset-password").required = false;
  if (!target) clearReset();
  $("profile-title").textContent = record ? "Your vault profile is saved" : "Set up QVault on this device";
  $("profile-description").textContent = record ? "Unlock QVault from the toolbar to use your saved accounts. Keep an encrypted backup before moving to another device." : "Restore a backup file to open your existing vault on this computer.";
  $("profile-state").textContent = record ? "PROFILE SAVED" : "NO PROFILE YET";
  $("backup").disabled = !record;
  $("restore-profile").disabled = !!record;
  $("restore-help").textContent = record ? "A profile already exists. Restore cannot overwrite it." : "Choose your QVault backup file. Unlock it afterwards with the same passkey or recovery key as before. QVault then loads your latest saved entries from the cloud.";
  return record;
}
async function work(fn) {
  if (busy) return;
  busy = true;
  for (const id of ["reset-open", "reset-submit", "reset-cancel", "reset-password", "reset-confirm", "reset-ack"]) $(id).disabled = true;
  $("backup").disabled = true;
  $("restore-profile").disabled = true;
  try {
    await fn();
  } catch (e) {
    note(e instanceof SyntaxError ? "This file is not a valid encrypted QVault backup." : e.message);
  } finally {
    busy = false;
    for (const id of ["reset-submit", "reset-cancel", "reset-password", "reset-confirm", "reset-ack"]) $(id).disabled = false;
    try {
      await refresh();
    } catch (e) {
      note(e.message);
    }
  }
}
$("backup").onclick = () => work(async () => {
  const text = await profile.backup(), url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = "qvault-encrypted-profile-" + JSON.parse(text).profileId + ".json";
    a.click();
    note(backupMessage(JSON.parse(text)));
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1e3);
  }
});
$("restore-profile").onchange = () => {
  const file = $("restore-profile").files?.[0];
  if (!file) return;
  work(async () => {
    await profile.restore(file);
    note(restoredMessage(await profile.read()));
    $("restore-profile").value = "";
  });
};
refresh().catch((e) => note(e.message));
$("reset-open").onclick = () => work(async () => {
  const record = await profile.resetTarget();
  if (!record) throw Error("No local profile to reset");
  clearReset();
  resetRevision = record.revision;
  $("reset-form").hidden = false;
});
$("reset-cancel").onclick = () => {
  if (!busy) clearReset();
};
$("reset-form").onsubmit = (e) => {
  e.preventDefault();
  if (busy) return;
  const request = { revision: resetRevision, recoveryKey: $("reset-password").value, confirmation: $("reset-confirm").value, acknowledged: $("reset-ack").checked };
  $("reset-password").value = "";
  work(async () => {
    let secret = null;
    try {
      const target = await profile.resetTarget();
      if (target && !request.recoveryKey) {
        $("reset-message").textContent = "Confirm with your passkey\u2026";
        secret = await passkeySecret({ slots: target.slots });
        request.secret = { prf: secret.prf };
      }
      await profile.reset(request);
      clearReset();
      $("reset-details").open = false;
      note("Local profile removed. Open QVault to see the setup screen. QKMS keys and cloud backups were not deleted.");
    } catch (e2) {
      $("reset-message").textContent = e2.message;
      throw e2;
    } finally {
      secret?.prf?.fill(0);
    }
  });
};
//# sourceMappingURL=recovery.js.map
