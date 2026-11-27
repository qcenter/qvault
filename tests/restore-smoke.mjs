// tests/restore-source.js
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import init from "../vendor/channel/channelwasm.js";

// upstream/sdk-core/sidecar/identity.ts
import * as channelwasm from "../vendor/channel/channelwasm.js";
function jsonBytesToUint8(arr) {
  return Uint8Array.from(arr);
}
function bytesToHex(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}
function bytesToBase64(bytes) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function base64ToBytes(b64) {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function unwrapJsonString(s) {
  const t = s.trim();
  if (t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1);
  }
  return t;
}
function parseKeyPair(json) {
  const obj = JSON.parse(json);
  if (!obj.public_key || !obj.private_key) {
    throw new Error(`channel-wasm returned unexpected key pair shape: ${json}`);
  }
  return {
    publicKey: jsonBytesToUint8(obj.public_key),
    privateKey: jsonBytesToUint8(obj.private_key)
  };
}
function signEd448(privateKey, message) {
  const result = channelwasm.js_sign_ed448(bytesToBase64(privateKey), bytesToBase64(message));
  const trimmed = result.trim();
  if (trimmed.startsWith("{")) {
    throw new Error(`channel-wasm js_sign_ed448 error: ${trimmed}`);
  }
  return base64ToBytes(unwrapJsonString(trimmed));
}
async function sidecarIdFromX448PublicKey(pub) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("Web Crypto API (crypto.subtle) is not available");
  }
  const digest = await subtle.digest("SHA-256", pub);
  return bytesToHex(new Uint8Array(digest).slice(0, 16));
}
async function generateIdentity() {
  const x448Identity = parseKeyPair(channelwasm.js_generate_x448());
  const x448SignedPreKey = parseKeyPair(channelwasm.js_generate_x448());
  const ed448Signing = parseKeyPair(channelwasm.js_generate_ed448());
  const preKeySignature = signEd448(ed448Signing.privateKey, x448SignedPreKey.publicKey);
  const sidecarId = await sidecarIdFromX448PublicKey(x448Identity.publicKey);
  return {
    sidecarId,
    identityPrivateX448: bytesToHex(x448Identity.privateKey),
    identityPublicX448: bytesToHex(x448Identity.publicKey),
    signedPreKeyPrivateX448: bytesToHex(x448SignedPreKey.privateKey),
    signedPreKeyPublicX448: bytesToHex(x448SignedPreKey.publicKey),
    signingPrivateEd448: bytesToHex(ed448Signing.privateKey),
    signingPublicEd448: bytesToHex(ed448Signing.publicKey),
    preKeySignature: bytesToHex(preKeySignature)
  };
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
function generateRecoveryKey() {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  let bits = 0, value = 0, out = "";
  for (const b of raw) {
    value = value << 8 | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[value >>> bits - 5 & 31];
      bits -= 5;
    }
  }
  if (bits) out += ALPHABET[value << 5 - bits & 31];
  raw.fill(0);
  return out.match(/.{4}/g).join("-");
}
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
async function createPasskeyProfile({ prf, credentialId, prfSalt, profileId = crypto.randomUUID() }) {
  if (!(prf instanceof Uint8Array) || prf.length < 32) throw Error("Invalid passkey secret");
  if (!/^[a-f0-9-]{36}$/.test(profileId)) throw Error("Invalid profile identifier");
  const raw = crypto.getRandomValues(new Uint8Array(32)), recoveryKey = generateRecoveryKey(), recoveryBytes = parseRecoveryKey(recoveryKey);
  try {
    const slots = [await wrapSlot({ type: "passkey", credentialId, prfSalt }, prf, raw, profileId), await wrapSlot({ type: "recovery" }, recoveryBytes, raw, profileId)];
    for (const slot of slots) validateSlot(slot);
    return { handle: { format: FORMAT2, key: await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]), profileId, slots }, recoveryKey };
  } finally {
    raw.fill(0);
    recoveryBytes.fill(0);
  }
}
async function sealPasskeyProfile(payload2, handle) {
  const record = { format: FORMAT2, profileId: handle.profileId, revision: crypto.randomUUID(), slots: handle.slots, nonce: toBase64(crypto.getRandomValues(new Uint8Array(12))) };
  const bytes = encoder.encode(JSON.stringify(payload2));
  if (bytes.length > MAX - 16) {
    bytes.fill(0);
    throw Error("Profile is too large");
  }
  try {
    record.ciphertext = toBase64(new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: fromBase64(record.nonce), additionalData: aad2(record) }, handle.key, bytes)));
    return record;
  } finally {
    bytes.fill(0);
  }
}
async function openPasskeyProfile(record, secret) {
  let bytes = null, type;
  if (secret?.prf instanceof Uint8Array && secret.prf.length >= 32) {
    bytes = secret.prf;
    type = "passkey";
  } else if (typeof secret?.recoveryKey === "string") {
    try {
      bytes = parseRecoveryKey(secret.recoveryKey);
    } catch {
      throw Error(NO_OPEN);
    }
    type = "recovery";
  } else throw Error(NO_OPEN);
  let key = null;
  try {
    for (const slot of record.slots.filter((s) => s.type === type)) {
      try {
        key = await unwrapSlot(slot, bytes, record.profileId);
        break;
      } catch {
      }
    }
  } finally {
    if (type === "recovery") bytes.fill(0);
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
async function sealProfile(payload2, handle) {
  if (handle?.format !== FORMAT2) throw Error("Unsupported profile key");
  return sealPasskeyProfile(payload2, handle);
}
async function openProfile(record, secret) {
  validateEnvelope(record);
  return openPasskeyProfile(record, secret);
}

// tests/fixture-profile.js
function fixtureSecret(label) {
  const out = new Uint8Array(32);
  let h = 2166136261;
  for (let round = 0; round < 4; round++) for (const c of String(label)) {
    h ^= c.charCodeAt(0) + round;
    h = Math.imul(h, 16777619) >>> 0;
    out[(h >>> 8) % 32] ^= h & 255;
    out[(h >>> 16) % 32] ^= h >>> 24 & 255;
  }
  for (let i = 0; i < 32; i++) {
    h ^= out[i] + i;
    h = Math.imul(h, 16777619) >>> 0;
    out[i] ^= h & 255;
  }
  return { prf: out };
}
async function fixtureProfile(label) {
  return createPasskeyProfile({ prf: fixtureSecret(label).prf, credentialId: toBase64(crypto.getRandomValues(new Uint8Array(20))), prfSalt: toBase64(crypto.getRandomValues(new Uint8Array(32))) });
}
async function fixtureKey(label) {
  return (await fixtureProfile(label)).handle;
}

// src/storage-config.js
function validateStorageCredentials(value) {
  if (!value || typeof value.accessKey !== "string" || !value.accessKey || typeof value.secretKey !== "string" || !value.secretKey || typeof value.region !== "string" || !/^[-a-z0-9]{1,64}$/.test(value.region) || typeof value.bucket !== "string" || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value.bucket)) throw Error("Invalid saved cloud storage settings");
  return value;
}

// src/participant-state.js
function validateParticipantState(state, keyId2) {
  if (!state || state.version !== 1 || state.keyId !== keyId2 || typeof keyId2 !== "string" || !/^[A-Za-z0-9_:/.-]{1,256}$/.test(keyId2) || !/^[a-f0-9]{32}$/.test(state.sidecarId) || !Array.isArray(state.entries) || state.entries.length !== 2) throw Error("Invalid saved participant");
  const map = /* @__PURE__ */ new Map();
  for (const pair of state.entries) {
    if (!Array.isArray(pair) || pair.length !== 2 || !["identity", "keyshare/" + keyId2].includes(pair[0]) || map.has(pair[0])) throw Error("Invalid saved participant entries");
    map.set(pair[0], fromBase64(pair[1], 65536));
  }
  const identity = JSON.parse(new TextDecoder().decode(map.get("identity"))), share = JSON.parse(new TextDecoder().decode(map.get("keyshare/" + keyId2)));
  if (identity.sidecarId !== state.sidecarId) throw Error("Saved participant identity mismatch");
  for (const field of ["identityPrivateX448", "identityPublicX448", "signedPreKeyPrivateX448", "signedPreKeyPublicX448", "signingPrivateEd448", "signingPublicEd448", "preKeySignature"]) if (typeof identity[field] !== "string" || !/^([a-f0-9]{2}){32,128}$/.test(identity[field])) throw Error("Incomplete saved participant identity");
  if (fromBase64(share.n, 512).length !== 256 || fromBase64(share.e, 8).length === 0 || fromBase64(share.dShare, 2048).length === 0) throw Error("Invalid saved RSA share");
  return map;
}
function validateProfilePayload(payload2) {
  if (!payload2 || payload2.version !== 1 || typeof payload2.credentials?.accessKey !== "string" || !payload2.credentials.accessKey || typeof payload2.credentials?.secretKey !== "string" || !payload2.credentials.secretKey || typeof payload2.credentials.region !== "string" || !/^[-a-z0-9]{1,64}$/.test(payload2.credentials.region) || typeof payload2.credentials.bucket !== "string" || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(payload2.credentials.bucket) || !Array.isArray(payload2.participants)) throw Error("Invalid protected profile payload");
  if (payload2.topology !== void 0 && !["hosted", "local"].includes(payload2.topology) || payload2.participants.length !== ({ hosted: 1, local: 0 }[payload2.topology] ?? 2)) throw Error("Invalid protected profile payload");
  if (payload2.topology === "local" && (payload2.keyId !== "local" || payload2.localKey === void 0)) throw Error("Invalid protected profile payload");
  for (const p2 of payload2.participants) validateParticipantState(p2, payload2.keyId);
  if (new Set(payload2.participants.map((p2) => p2.sidecarId)).size !== payload2.participants.length) throw Error("Duplicate participant identity");
  if (payload2.storageCredentials) validateStorageCredentials(payload2.storageCredentials);
  if (payload2.localKey !== void 0) {
    let raw;
    try {
      raw = fromBase64(payload2.localKey, 32);
    } catch {
      throw Error("Invalid protected profile payload");
    }
    const size = raw.length;
    raw.fill(0);
    if (size !== 32) throw Error("Invalid protected profile payload");
  }
  return payload2;
}

// tests/restore-source.js
await init({ module_or_path: await readFile(new URL("../vendor/channel/channelwasm_bg.wasm", import.meta.url)) });
var keyId = "fictional-saved-key";
var participants = [];
for (let i = 0; i < 2; i++) {
  const identity = await generateIdentity();
  const share = { n: Buffer.alloc(256, 195).toString("base64"), e: "AQAB", dShare: "AQ==" };
  participants.push({ version: 1, keyId, sidecarId: identity.sidecarId, entries: [["identity", Buffer.from(JSON.stringify(identity)).toString("base64")], ["keyshare/" + keyId, Buffer.from(JSON.stringify(share)).toString("base64")]] });
}
var credentials = { accessKey: "FICTIONAL_ACCESS", secretKey: "FICTIONAL_SECRET", region: "q-world-1", bucket: "fictional-bucket" };
var payload = validateProfilePayload({ version: 1, keyId, credentials, participants, vault: null });
var sealed = await sealProfile(payload, await fixtureKey("fictional passkey label only"));
var reopened = validateProfilePayload((await openProfile(JSON.parse(JSON.stringify(sealed)), fixtureSecret("fictional passkey label only"))).payload);
var count = 0;
var methods = [];
async function workerClient() {
  const w = new Worker(new URL("./restore-worker-shim.mjs", import.meta.url));
  const pending = /* @__PURE__ */ new Map();
  let next = 1;
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(Error("Worker init timed out")), 1e4);
    w.on("message", (m) => {
      if (m.rpc) {
        methods.push(m.rpc);
        return;
      }
      if (m.harnessReady) {
        clearTimeout(t);
        resolve();
        return;
      }
      const p2 = pending.get(m.id);
      if (p2) {
        pending.delete(m.id);
        clearTimeout(p2.t);
        m.error ? p2.reject(Error(m.error)) : p2.resolve(m.data);
      }
    });
    w.on("error", reject);
  });
  return { w, call: (action, args = {}) => new Promise((resolve, reject) => {
    const id = next++, t = setTimeout(() => reject(Error("Worker call timed out")), 1e4);
    pending.set(id, { resolve, reject, t });
    w.postMessage({ id, action, ...args });
  }) };
}
for (const state of reopened.participants) {
  const p2 = await workerClient();
  try {
    const started = await p2.call("start", { credentials, restore: state });
    assert.equal(started.sidecarId, state.sidecarId);
    assert.deepEqual(await p2.call("export-state", { keyId }), state);
    await assert.rejects(() => p2.call("create", { participants: [] }));
    count++;
  } finally {
    await p2.w.terminate();
  }
}
var broken = structuredClone(reopened.participants[0]);
broken.entries = broken.entries.filter(([k]) => k !== "identity");
var p = await workerClient();
var before = methods.length;
try {
  await assert.rejects(() => p.call("start", { credentials, restore: broken }));
  assert.equal(methods.length, before);
} finally {
  await p.w.terminate();
}
assert.equal(count, 2);
assert.ok(!methods.includes("CreateKey"));
assert.equal(methods.filter((m) => m === "RegisterSidecar").length, 2);
console.log("PASS LOCAL: encrypted profile reopened into two fresh actual bundled workers, same participant identities and share bytes restored, no CreateKey/preparation, missing identity rejected before registration. Real WASM/channel identity; mocked QKMS only, no real credentials.");
