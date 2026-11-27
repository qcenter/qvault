// src/storage-config.js
function validateStorageCredentials(value) {
  if (!value || typeof value.accessKey !== "string" || !value.accessKey || typeof value.secretKey !== "string" || !value.secretKey || typeof value.region !== "string" || !/^[-a-z0-9]{1,64}$/.test(value.region) || typeof value.bucket !== "string" || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value.bucket)) throw Error("Invalid saved cloud storage settings");
  return value;
}
var storageCredentialsFor = (payload) => validateStorageCredentials(payload.storageCredentials || payload.credentials);

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
async function sealPasskeyProfile(payload, handle) {
  const record = { format: FORMAT2, profileId: handle.profileId, revision: crypto.randomUUID(), slots: handle.slots, nonce: toBase64(crypto.getRandomValues(new Uint8Array(12))) };
  const bytes = encoder.encode(JSON.stringify(payload));
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
async function sealProfile(payload, handle) {
  if (handle?.format !== FORMAT2) throw Error("Unsupported profile key");
  return sealPasskeyProfile(payload, handle);
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

// src/participant-state.js
function validateParticipantState(state, keyId) {
  if (!state || state.version !== 1 || state.keyId !== keyId || typeof keyId !== "string" || !/^[A-Za-z0-9_:/.-]{1,256}$/.test(keyId) || !/^[a-f0-9]{32}$/.test(state.sidecarId) || !Array.isArray(state.entries) || state.entries.length !== 2) throw Error("Invalid saved participant");
  const map = /* @__PURE__ */ new Map();
  for (const pair of state.entries) {
    if (!Array.isArray(pair) || pair.length !== 2 || !["identity", "keyshare/" + keyId].includes(pair[0]) || map.has(pair[0])) throw Error("Invalid saved participant entries");
    map.set(pair[0], fromBase64(pair[1], 65536));
  }
  const identity = JSON.parse(new TextDecoder().decode(map.get("identity"))), share = JSON.parse(new TextDecoder().decode(map.get("keyshare/" + keyId)));
  if (identity.sidecarId !== state.sidecarId) throw Error("Saved participant identity mismatch");
  for (const field2 of ["identityPrivateX448", "identityPublicX448", "signedPreKeyPrivateX448", "signedPreKeyPublicX448", "signingPrivateEd448", "signingPublicEd448", "preKeySignature"]) if (typeof identity[field2] !== "string" || !/^([a-f0-9]{2}){32,128}$/.test(identity[field2])) throw Error("Incomplete saved participant identity");
  if (fromBase64(share.n, 512).length !== 256 || fromBase64(share.e, 8).length === 0 || fromBase64(share.dShare, 2048).length === 0) throw Error("Invalid saved RSA share");
  return map;
}
function validateProfilePayload(payload) {
  if (!payload || payload.version !== 1 || typeof payload.credentials?.accessKey !== "string" || !payload.credentials.accessKey || typeof payload.credentials?.secretKey !== "string" || !payload.credentials.secretKey || typeof payload.credentials.region !== "string" || !/^[-a-z0-9]{1,64}$/.test(payload.credentials.region) || typeof payload.credentials.bucket !== "string" || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(payload.credentials.bucket) || !Array.isArray(payload.participants)) throw Error("Invalid protected profile payload");
  if (payload.topology !== void 0 && !["hosted", "local"].includes(payload.topology) || payload.participants.length !== ({ hosted: 1, local: 0 }[payload.topology] ?? 2)) throw Error("Invalid protected profile payload");
  if (payload.topology === "local" && (payload.keyId !== "local" || payload.localKey === void 0)) throw Error("Invalid protected profile payload");
  for (const p of payload.participants) validateParticipantState(p, payload.keyId);
  if (new Set(payload.participants.map((p) => p.sidecarId)).size !== payload.participants.length) throw Error("Duplicate participant identity");
  if (payload.storageCredentials) validateStorageCredentials(payload.storageCredentials);
  if (payload.localKey !== void 0) {
    let raw;
    try {
      raw = fromBase64(payload.localKey, 32);
    } catch {
      throw Error("Invalid protected profile payload");
    }
    const size = raw.length;
    raw.fill(0);
    if (size !== 32) throw Error("Invalid protected profile payload");
  }
  return payload;
}

// src/snapshot-discovery.js
function field(xml, name) {
  const matches = [...xml.matchAll(new RegExp("<" + name + ">([\\s\\S]*?)</" + name + ">", "g"))];
  if (matches.length !== 1) throw Error("Invalid cloud snapshot listing");
  return matches[0][1].replace(/&(?:amp|lt|gt|quot|apos);/g, (e) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" })[e]).replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (_, h, d) => String.fromCodePoint(parseInt(h || d, h ? 16 : 10)));
}
function parseSnapshotPage(xml, profileId) {
  if (xml.length > 4 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml) || !/<ListBucketResult(?:\s[^>]*)?>/.test(xml) || !/<\/ListBucketResult>\s*$/.test(xml)) throw Error("Invalid cloud snapshot listing");
  const prefix = "qvault/" + profileId + "/", items = [];
  for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const key = field(match[1], "Key");
    if (!key.startsWith(prefix)) throw Error("Cloud listing returned another vault");
    if (!/^[a-f0-9-]{36}\.json$/.test(key.slice(prefix.length))) continue;
    const modified = Date.parse(field(match[1], "LastModified"));
    if (!Number.isFinite(modified)) throw Error("Invalid cloud snapshot date");
    items.push({ object: key, modified });
  }
  const truncated = field(xml, "IsTruncated");
  if (!["true", "false"].includes(truncated)) throw Error("Invalid cloud snapshot listing");
  return { items, next: truncated === "true" ? field(xml, "NextContinuationToken") : null };
}
async function listSnapshots({ requestPage, profileId, signal }) {
  let token = null;
  const items = [], seen = /* @__PURE__ */ new Set(), tokens = /* @__PURE__ */ new Set();
  do {
    if (signal?.aborted) throw Error("Vault locked");
    const page = parseSnapshotPage(await requestPage(token), profileId);
    for (const item of page.items) {
      if (seen.has(item.object)) continue;
      seen.add(item.object);
      if (items.length >= 1e4) throw Error("Too many cloud snapshots. Recovery needs review.");
      items.push(item);
    }
    token = page.next;
    if (token) {
      if (tokens.has(token) || tokens.size >= 100) throw Error("Invalid cloud snapshot pagination");
      tokens.add(token);
    }
  } while (token);
  return items;
}
async function discoverSnapshot({ requestPage, profileId, reference, signal }) {
  const items = await listSnapshots({ requestPage, profileId, signal });
  let latest = null, tied = false;
  for (const item of items) {
    if (!latest || item.modified > latest.modified) {
      latest = item;
      tied = false;
    } else if (item.modified === latest.modified) tied = true;
  }
  if (tied) throw Error("Several cloud snapshots have the same date. Recovery needs review; no snapshot was selected.");
  if (reference && !items.some((item) => item.object === reference.object)) throw Error("Saved cloud snapshot is missing from the listing. Your profile was not changed.");
  return latest ? { object: latest.object } : null;
}

// node_modules/aws4fetch/dist/aws4fetch.esm.mjs
var encoder2 = new TextEncoder();
var HOST_SERVICES = {
  appstream2: "appstream",
  cloudhsmv2: "cloudhsm",
  email: "ses",
  marketplace: "aws-marketplace",
  mobile: "AWSMobileHubService",
  pinpoint: "mobiletargeting",
  queue: "sqs",
  "git-codecommit": "codecommit",
  "mturk-requester-sandbox": "mturk-requester",
  "personalize-runtime": "personalize"
};
var UNSIGNABLE_HEADERS = /* @__PURE__ */ new Set([
  "authorization",
  "content-type",
  "content-length",
  "user-agent",
  "presigned-expires",
  "expect",
  "x-amzn-trace-id",
  "range",
  "connection"
]);
var AwsClient = class {
  constructor({ accessKeyId, secretAccessKey, sessionToken, service, region, cache, retries, initRetryMs }) {
    if (accessKeyId == null) throw new TypeError("accessKeyId is a required option");
    if (secretAccessKey == null) throw new TypeError("secretAccessKey is a required option");
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.sessionToken = sessionToken;
    this.service = service;
    this.region = region;
    this.cache = cache || /* @__PURE__ */ new Map();
    this.retries = retries != null ? retries : 10;
    this.initRetryMs = initRetryMs || 50;
  }
  async sign(input, init) {
    if (input instanceof Request) {
      const { method, url, headers, body } = input;
      init = Object.assign({ method, url, headers }, init);
      if (init.body == null && headers.has("Content-Type")) {
        init.body = body != null && headers.has("X-Amz-Content-Sha256") ? body : await input.clone().arrayBuffer();
      }
      input = url;
    }
    const signer = new AwsV4Signer(Object.assign({ url: input.toString() }, init, this, init && init.aws));
    const signed = Object.assign({}, init, await signer.sign());
    delete signed.aws;
    try {
      return new Request(signed.url.toString(), signed);
    } catch (e) {
      if (e instanceof TypeError) {
        return new Request(signed.url.toString(), Object.assign({ duplex: "half" }, signed));
      }
      throw e;
    }
  }
  async fetch(input, init) {
    for (let i = 0; i <= this.retries; i++) {
      const fetched = fetch(await this.sign(input, init));
      if (i === this.retries) {
        return fetched;
      }
      const res = await fetched;
      if (res.status < 500 && res.status !== 429) {
        return res;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.random() * this.initRetryMs * Math.pow(2, i)));
    }
    throw new Error("An unknown error occurred, ensure retries is not negative");
  }
};
var AwsV4Signer = class {
  constructor({ method, url, headers, body, accessKeyId, secretAccessKey, sessionToken, service, region, cache, datetime, signQuery, appendSessionToken, allHeaders, singleEncode }) {
    if (url == null) throw new TypeError("url is a required option");
    if (accessKeyId == null) throw new TypeError("accessKeyId is a required option");
    if (secretAccessKey == null) throw new TypeError("secretAccessKey is a required option");
    this.method = method || (body ? "POST" : "GET");
    this.url = new URL(url);
    this.headers = new Headers(headers || {});
    this.body = body;
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.sessionToken = sessionToken;
    let guessedService, guessedRegion;
    if (!service || !region) {
      [guessedService, guessedRegion] = guessServiceRegion(this.url, this.headers);
    }
    this.service = service || guessedService || "";
    this.region = region || guessedRegion || "us-east-1";
    this.cache = cache || /* @__PURE__ */ new Map();
    this.datetime = datetime || (/* @__PURE__ */ new Date()).toISOString().replace(/[:-]|\.\d{3}/g, "");
    this.signQuery = signQuery;
    this.appendSessionToken = appendSessionToken || this.service === "iotdevicegateway";
    this.headers.delete("Host");
    if (this.service === "s3" && !this.signQuery && !this.headers.has("X-Amz-Content-Sha256")) {
      this.headers.set("X-Amz-Content-Sha256", "UNSIGNED-PAYLOAD");
    }
    const params = this.signQuery ? this.url.searchParams : this.headers;
    params.set("X-Amz-Date", this.datetime);
    if (this.sessionToken && !this.appendSessionToken) {
      params.set("X-Amz-Security-Token", this.sessionToken);
    }
    this.signableHeaders = ["host", ...this.headers.keys()].filter((header) => allHeaders || !UNSIGNABLE_HEADERS.has(header)).sort();
    this.signedHeaders = this.signableHeaders.join(";");
    this.canonicalHeaders = this.signableHeaders.map((header) => header + ":" + (header === "host" ? this.url.host : (this.headers.get(header) || "").replace(/\s+/g, " "))).join("\n");
    this.credentialString = [this.datetime.slice(0, 8), this.region, this.service, "aws4_request"].join("/");
    if (this.signQuery) {
      if (this.service === "s3" && !params.has("X-Amz-Expires")) {
        params.set("X-Amz-Expires", "86400");
      }
      params.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
      params.set("X-Amz-Credential", this.accessKeyId + "/" + this.credentialString);
      params.set("X-Amz-SignedHeaders", this.signedHeaders);
    }
    if (this.service === "s3") {
      try {
        this.encodedPath = decodeURIComponent(this.url.pathname.replace(/\+/g, " "));
      } catch (e) {
        this.encodedPath = this.url.pathname;
      }
    } else {
      this.encodedPath = this.url.pathname.replace(/\/+/g, "/");
    }
    if (!singleEncode) {
      this.encodedPath = encodeURIComponent(this.encodedPath).replace(/%2F/g, "/");
    }
    this.encodedPath = encodeRfc3986(this.encodedPath);
    const seenKeys = /* @__PURE__ */ new Set();
    this.encodedSearch = [...this.url.searchParams].filter(([k]) => {
      if (!k) return false;
      if (this.service === "s3") {
        if (seenKeys.has(k)) return false;
        seenKeys.add(k);
      }
      return true;
    }).map((pair) => pair.map((p) => encodeRfc3986(encodeURIComponent(p)))).sort(([k1, v1], [k2, v2]) => k1 < k2 ? -1 : k1 > k2 ? 1 : v1 < v2 ? -1 : v1 > v2 ? 1 : 0).map((pair) => pair.join("=")).join("&");
  }
  async sign() {
    if (this.signQuery) {
      this.url.searchParams.set("X-Amz-Signature", await this.signature());
      if (this.sessionToken && this.appendSessionToken) {
        this.url.searchParams.set("X-Amz-Security-Token", this.sessionToken);
      }
    } else {
      this.headers.set("Authorization", await this.authHeader());
    }
    return {
      method: this.method,
      url: this.url,
      headers: this.headers,
      body: this.body
    };
  }
  async authHeader() {
    return [
      "AWS4-HMAC-SHA256 Credential=" + this.accessKeyId + "/" + this.credentialString,
      "SignedHeaders=" + this.signedHeaders,
      "Signature=" + await this.signature()
    ].join(", ");
  }
  async signature() {
    const date = this.datetime.slice(0, 8);
    const cacheKey = [this.secretAccessKey, date, this.region, this.service].join();
    let kCredentials = this.cache.get(cacheKey);
    if (!kCredentials) {
      const kDate = await hmac("AWS4" + this.secretAccessKey, date);
      const kRegion = await hmac(kDate, this.region);
      const kService = await hmac(kRegion, this.service);
      kCredentials = await hmac(kService, "aws4_request");
      this.cache.set(cacheKey, kCredentials);
    }
    return buf2hex(await hmac(kCredentials, await this.stringToSign()));
  }
  async stringToSign() {
    return [
      "AWS4-HMAC-SHA256",
      this.datetime,
      this.credentialString,
      buf2hex(await hash(await this.canonicalString()))
    ].join("\n");
  }
  async canonicalString() {
    return [
      this.method.toUpperCase(),
      this.encodedPath,
      this.encodedSearch,
      this.canonicalHeaders + "\n",
      this.signedHeaders,
      await this.hexBodyHash()
    ].join("\n");
  }
  async hexBodyHash() {
    let hashHeader = this.headers.get("X-Amz-Content-Sha256") || (this.service === "s3" && this.signQuery ? "UNSIGNED-PAYLOAD" : null);
    if (hashHeader == null) {
      if (this.body && typeof this.body !== "string" && !("byteLength" in this.body)) {
        throw new Error("body must be a string, ArrayBuffer or ArrayBufferView, unless you include the X-Amz-Content-Sha256 header");
      }
      hashHeader = buf2hex(await hash(this.body || ""));
    }
    return hashHeader;
  }
};
async function hmac(key, string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    typeof key === "string" ? encoder2.encode(key) : key,
    { name: "HMAC", hash: { name: "SHA-256" } },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", cryptoKey, encoder2.encode(string));
}
async function hash(content) {
  return crypto.subtle.digest("SHA-256", typeof content === "string" ? encoder2.encode(content) : content);
}
var HEX_CHARS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f"];
function buf2hex(arrayBuffer) {
  const buffer = new Uint8Array(arrayBuffer);
  let out = "";
  for (let idx = 0; idx < buffer.length; idx++) {
    const n = buffer[idx];
    out += HEX_CHARS[n >>> 4 & 15];
    out += HEX_CHARS[n & 15];
  }
  return out;
}
function encodeRfc3986(urlEncodedStr) {
  return urlEncodedStr.replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}
function guessServiceRegion(url, headers) {
  const { hostname, pathname } = url;
  if (hostname.endsWith(".on.aws")) {
    const match2 = hostname.match(/^[^.]{1,63}\.lambda-url\.([^.]{1,63})\.on\.aws$/);
    return match2 != null ? ["lambda", match2[1] || ""] : ["", ""];
  }
  if (hostname.endsWith(".r2.cloudflarestorage.com")) {
    return ["s3", "auto"];
  }
  if (hostname.endsWith(".backblazeb2.com")) {
    const match2 = hostname.match(/^(?:[^.]{1,63}\.)?s3\.([^.]{1,63})\.backblazeb2\.com$/);
    return match2 != null ? ["s3", match2[1] || ""] : ["", ""];
  }
  const match = hostname.replace("dualstack.", "").match(/([^.]{1,63})\.(?:([^.]{0,63})\.)?amazonaws\.com(?:\.cn)?$/);
  let service = match && match[1] || "";
  let region = match && match[2];
  if (region === "us-gov") {
    region = "us-gov-west-1";
  } else if (region === "s3" || region === "s3-accelerate") {
    region = "us-east-1";
    service = "s3";
  } else if (service === "iot") {
    if (hostname.startsWith("iot.")) {
      service = "execute-api";
    } else if (hostname.startsWith("data.jobs.iot.")) {
      service = "iot-jobs-data";
    } else {
      service = pathname === "/mqtt" ? "iotdevicegateway" : "iotdata";
    }
  } else if (service === "autoscaling") {
    const targetPrefix = (headers.get("X-Amz-Target") || "").split(".")[0];
    if (targetPrefix === "AnyScaleFrontendService") {
      service = "application-autoscaling";
    } else if (targetPrefix === "AnyScaleScalingPlannerFrontendService") {
      service = "autoscaling-plans";
    }
  } else if (region == null && service.startsWith("s3-")) {
    region = service.slice(3).replace(/^fips-|^external-1/, "");
    service = "s3";
  } else if (service.endsWith("-fips")) {
    service = service.slice(0, -5);
  } else if (region && /-\d$/.test(service) && !/-\d$/.test(region)) {
    [service, region] = [region, service];
  }
  return [HOST_SERVICES[service] || service, region || ""];
}

// src/sync-transport.js
var FORMAT = "qvault-sync-head-v1";
var SyncUnavailable = class extends Error {
  constructor(message) {
    super(message);
    this.name = "SyncUnavailable";
    this.code = "SYNC_UNAVAILABLE";
  }
};
var SyncConflict = class extends Error {
  constructor() {
    super("Cloud state changed. Retrying the merge.");
    this.name = "SyncConflict";
  }
};
var sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(Error("Vault locked"));
  const abort = () => {
    clearTimeout(timer);
    reject(Error("Vault locked"));
  };
  const timer = setTimeout(() => {
    signal?.removeEventListener("abort", abort);
    resolve();
  }, ms);
  signal?.addEventListener("abort", abort, { once: true });
});
var SyncTransport = class {
  constructor({ credentials, profileId, keyId, handle, fetcher, now = () => Date.now(), leaseWaitMs = 6e4, leaseTtlMs = 3e5, operationMs = 12e4 }) {
    if (!/^[a-f0-9-]{36}$/.test(profileId)) throw Error("Invalid sync profile");
    Object.assign(this, { credentials, profileId, keyId, handle, now, leaseWaitMs, leaseTtlMs, operationMs });
    this.prefix = "qvault/" + profileId + "/sync/v1/";
    this.fetcher = fetcher || new AwsClient({ accessKeyId: credentials.accessKey, secretAccessKey: credentials.secretKey, service: "s3", region: credentials.region, retries: 0 });
  }
  page(signal) {
    return async (token) => {
      const url = new URL("https://qstorage.quilibrium.com/" + this.credentials.bucket);
      url.searchParams.set("list-type", "2");
      url.searchParams.set("prefix", "qvault/" + this.profileId + "/");
      url.searchParams.set("max-keys", "1000");
      if (token) url.searchParams.set("continuation-token", token);
      const r = await this.fetcher.fetch(url.toString(), { method: "GET", redirect: "error", cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15e3)]) : AbortSignal.timeout(15e3) });
      if (!r.ok) throw Object.assign(Error(r.status === 403 ? "QVault cannot list cloud backups. Allow this account to list the vault\u2019s storage, then unlock again. No saved data was changed." : "Cloud backup discovery HTTP " + r.status), { status: r.status });
      return r.text();
    };
  }
  async latestSnapshot(reference, signal) {
    return discoverSnapshot({ profileId: this.profileId, reference, signal, requestPage: this.page(signal) });
  }
  async listSnapshotItems(signal) {
    return listSnapshots({ profileId: this.profileId, signal, requestPage: this.page(signal) });
  }
  // Only this profile's own immutable snapshots (<uuid>.json directly under its prefix) can be deleted.
  async deleteSnapshot(object, signal) {
    const base = "qvault/" + this.profileId + "/";
    if (typeof object !== "string" || !object.startsWith(base) || !/^[a-f0-9-]{36}\.json$/.test(object.slice(base.length))) throw Error("Invalid cloud snapshot name");
    return this.fetcher.fetch("https://qstorage.quilibrium.com/" + this.credentials.bucket + "/" + object, { method: "DELETE", redirect: "error", cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15e3)]) : AbortSignal.timeout(15e3) });
  }
  // Housekeeping after a save. Keeps the newest snapshots and anything recent, never the ones in `protect`; quiet when not permitted.
  async pruneSnapshots({ keep = 20, minAgeMs = 30 * 864e5, maxDeletes = 50, protect = [], signal } = {}) {
    let items;
    try {
      items = await this.listSnapshotItems(signal);
    } catch {
      return { deleted: 0, denied: true };
    }
    const safe = new Set(protect.filter(Boolean)), cutoff = this.now() - minAgeMs;
    const victims = items.sort((a, b) => b.modified - a.modified || a.object.localeCompare(b.object)).slice(keep).filter((i) => i.modified < cutoff && !safe.has(i.object)).reverse().slice(0, maxDeletes);
    let deleted = 0;
    for (const item of victims) {
      let r;
      try {
        r = await this.deleteSnapshot(item.object, signal);
      } catch {
        return { deleted, denied: true };
      }
      if (r.ok || r.status === 404) deleted++;
      else return { deleted, denied: true };
    }
    return { deleted, denied: false };
  }
  async request(name, { method = "GET", body, etag, create = false, signal } = {}) {
    if (!/^[a-z0-9/._-]+$/.test(name)) throw Error("Invalid sync object");
    const headers = {};
    if (body !== void 0) headers["Content-Type"] = "application/json";
    if (etag) headers["If-Match"] = etag;
    if (create) headers["If-None-Match"] = "*";
    return this.fetcher.fetch("https://qstorage.quilibrium.com/" + this.credentials.bucket + "/" + this.prefix + name, { method, body: body === void 0 ? void 0 : JSON.stringify(body), headers, redirect: "error", cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15e3)]) : AbortSignal.timeout(15e3) });
  }
  etag(response) {
    const value = response.headers.get("etag");
    if (!value || !/^"[^"\r\n]{1,200}"$/.test(value)) throw Error("QStorage must return a strong ETag for safe sync");
    return value;
  }
  async json(response, max = 131072) {
    const text = await response.text();
    if (text.length > max) throw Error("Oversized sync metadata");
    try {
      return JSON.parse(text);
    } catch {
      throw Error("Invalid sync metadata");
    }
  }
  async verify(signal) {
    if (this.verified) return;
    const name = "probes/" + crypto.randomUUID() + ".json";
    try {
      await this.probe(name, signal);
    } finally {
      try {
        await this.request(name, { method: "DELETE", signal });
      } catch {
      }
    }
  }
  async probe(name, signal) {
    let r = await this.request(name, { method: "PUT", body: { probe: 1 }, create: true, signal });
    if (!r.ok) throw Error("QStorage sync check HTTP " + r.status);
    let tag = this.etag(r);
    r = await this.request(name, { method: "PUT", body: { probe: 2 }, create: true, signal });
    if (r.status !== 412) {
      if (r.ok || [405, 501].includes(r.status)) throw new SyncUnavailable("QStorage does not enforce conditional create; automatic sync is unavailable");
      throw Error("QStorage conditional create check HTTP " + r.status);
    }
    r = await this.request(name, { method: "PUT", body: { probe: 3 }, etag: '"qvault-stale-etag"', signal });
    if (r.status !== 412) {
      if (r.ok || [405, 501].includes(r.status)) throw new SyncUnavailable("QStorage does not enforce conditional update; automatic sync is unavailable");
      throw Error("QStorage conditional update check HTTP " + r.status);
    }
    r = await this.request(name, { method: "PUT", body: { probe: 4 }, etag: tag, signal });
    if (!r.ok) throw Error("QStorage conditional update check failed");
    const current = this.etag(r);
    r = await this.request(name, { method: "PUT", body: { probe: 5 }, etag: tag, signal });
    if (r.status !== 412) {
      if (r.ok) throw new SyncUnavailable("QStorage accepts stale updates; automatic sync is unavailable");
      throw Error("QStorage stale update check HTTP " + r.status);
    }
    r = await this.request(name, { signal });
    if (!r.ok || this.etag(r) !== current || (await this.json(r)).probe !== 4) throw Error("QStorage sync readback check failed");
    this.verified = true;
  }
  aad() {
    return new TextEncoder().encode(JSON.stringify({ format: FORMAT, profileId: this.profileId, keyId: this.keyId }));
  }
  async encode(state) {
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const bytes = new TextEncoder().encode(JSON.stringify(state));
    try {
      return { format: FORMAT, profileId: this.profileId, keyId: this.keyId, nonce: toBase64(nonce), ciphertext: toBase64(new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: this.aad() }, this.handle.key, bytes))) };
    } finally {
      bytes.fill(0);
    }
  }
  async decode(record) {
    if (record.format !== FORMAT || record.profileId !== this.profileId || record.keyId !== this.keyId || fromBase64(record.nonce, 12).length !== 12) throw Error("Unexpected cloud sync head");
    let bytes;
    try {
      bytes = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(record.nonce), additionalData: this.aad() }, this.handle.key, fromBase64(record.ciphertext, 65536)));
      const s = JSON.parse(new TextDecoder().decode(bytes));
      if (s.version !== 1 || !/^[a-f0-9-]{36}$/.test(s.revision) || !Number.isSafeInteger(s.generation) || s.generation < 1 || !s.applied || typeof s.applied !== "object" || Array.isArray(s.applied) || Object.keys(s.applied).length > 128) throw Error();
      for (const [id, n] of Object.entries(s.applied)) if (!/^[a-f0-9-]{36}$/.test(id) || !Number.isSafeInteger(n) || n < 1) throw Error();
      if (s.reference && (!s.reference.object?.startsWith("qvault/" + this.profileId + "/") || !/^[-a-zA-Z0-9/._]+$/.test(s.reference.object))) throw Error();
      return s;
    } catch {
      throw Error("Cloud sync head authentication/format check failed");
    } finally {
      bytes?.fill(0);
    }
  }
  async readHead(signal) {
    const r = await this.request("head.json", { signal });
    if (r.status === 404) return null;
    if (!r.ok) throw Error("QStorage sync read HTTP " + r.status);
    return { etag: this.etag(r), state: await this.decode(await this.json(r)) };
  }
  async publish(expected, state, signal) {
    const body = await this.encode(state);
    let r;
    try {
      r = await this.request("head.json", { method: "PUT", body, etag: expected?.etag, create: !expected, signal });
    } catch (e) {
      if (signal?.aborted) throw e;
      const found = await this.readHead(signal);
      if (found?.state.revision === state.revision) return found;
      throw Error("Cloud save outcome is unknown. Pending changes are retained for retry.");
    }
    if (r.status === 412) throw new SyncConflict();
    if (!r.ok) throw Error("QStorage sync publish HTTP " + r.status);
    return { etag: this.etag(r), state };
  }
  async withMpcLease(fn, { signal, onLost = () => {
  } } = {}) {
    await this.verify(signal);
    const owner = crypto.randomUUID(), started = this.now();
    let owned = null;
    while (!owned) {
      if (signal?.aborted) throw Error("Vault locked");
      if (this.now() - started > this.leaseWaitMs) throw Error("Another device is using the QKMS key. Sync will retry.");
      const r = await this.request("mpc-lease.json", { signal });
      let previous = null, serverTime;
      if (r.status === 404) {
        serverTime = Date.parse(r.headers.get("date"));
      } else {
        if (!r.ok) throw Error("QStorage key lease HTTP " + r.status);
        previous = { etag: this.etag(r), body: await this.json(r, 4096) };
        serverTime = Date.parse(r.headers.get("date"));
        if (typeof previous.body.owner !== "string" || !Number.isFinite(previous.body.expiresAt)) throw Error("Invalid key-operation lease");
      }
      if (!Number.isFinite(serverTime)) throw Error("QStorage server time is required for safe key-operation leases");
      if (previous && previous.body.expiresAt > serverTime) {
        await sleep(400 + Math.random() * 400, signal);
        continue;
      }
      const body = { owner, expiresAt: serverTime + this.leaseTtlMs };
      const put = await this.request("mpc-lease.json", { method: "PUT", body, etag: previous?.etag, create: !previous, signal });
      if (put.status === 412) continue;
      if (!put.ok) throw Error("QStorage lease acquire HTTP " + put.status);
      owned = { etag: this.etag(put), body };
    }
    const guard = new AbortController();
    let lost = false;
    const timer = setTimeout(() => {
      lost = true;
      guard.abort();
      onLost();
    }, this.operationMs);
    try {
      return await fn(AbortSignal.any([guard.signal, ...signal ? [signal] : []]));
    } finally {
      clearTimeout(timer);
      if (!lost) try {
        const r = await this.request("mpc-lease.json");
        if (r.ok) {
          const current = await this.json(r, 4096);
          if (current.owner === owner) await this.request("mpc-lease.json", { method: "PUT", etag: this.etag(r), body: { owner, expiresAt: 0 } });
        }
      } catch {
      }
    }
  }
};

// src/cloud-vault.js
var FORMAT3 = "qvault-passwords-v1";
var FORMAT22 = "qvault-passwords-v2";
var MAX2 = 1024 * 1024;
var enc = new TextEncoder();
function location(credentials, profileId, object) {
  if (!/^[a-f0-9-]{36}$/.test(profileId) || typeof object !== "string" || !object.startsWith("qvault/" + profileId + "/") || !/^[a-zA-Z0-9/._-]+$/.test(object) || object.split("/").some((s) => s === "" || s === "." || s === "..")) throw Error("Invalid cloud vault reference");
  return "https://qstorage.quilibrium.com/" + credentials.bucket + "/" + object;
}
function client(c) {
  return new AwsClient({ accessKeyId: c.accessKey, secretAccessKey: c.secretKey, service: "s3", region: c.region, retries: 0 });
}
function aad(profileId, keyId, object, format = FORMAT3) {
  return enc.encode(JSON.stringify({ format, profileId, keyId, object }));
}
var wrapAad = (profileId, keyId, object) => enc.encode(JSON.stringify({ format: FORMAT22, purpose: "key-wrap", profileId, keyId, object }));
async function importLocalKey(localKey, usage) {
  let raw;
  try {
    raw = fromBase64(localKey, 32);
  } catch {
    throw Error("Invalid local vault key");
  }
  try {
    if (raw.length !== 32) throw Error("Invalid local vault key");
    return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, [usage]);
  } finally {
    raw.fill(0);
  }
}
function validateEntries(entries) {
  if (!Array.isArray(entries) || entries.length > 1e3) throw Error("Invalid password collection");
  const ids = /* @__PURE__ */ new Set();
  for (const e of entries) {
    if (!e || typeof e.id !== "string" || !/^[a-f0-9-]{36}$/.test(e.id) || ids.has(e.id)) throw Error("Invalid password entry");
    ids.add(e.id);
    for (const f of ["title", "url", "username", "password"]) if (typeof e[f] !== "string" || e[f].length > 4096) throw Error("Invalid password entry");
    if (e.url) {
      const u = new URL(e.url);
      if (u.protocol !== "https:") throw Error("Use an HTTPS website URL");
    }
    if (e.previous !== void 0 && (!e.previous || typeof e.previous.password !== "string" || e.previous.password.length > 4096 || typeof e.previous.at !== "string" || e.previous.at.length > 40)) throw Error("Invalid password entry");
  }
  return entries;
}
var cached = async (cache, object) => {
  try {
    const text = await cache?.get?.(object);
    return typeof text === "string" && text.length <= MAX2 * 2 ? text : null;
  } catch {
    return null;
  }
};
var remember = async (cache, object, text) => {
  try {
    await cache?.put?.(object, text);
  } catch {
  }
};
async function saveCloudVault({ credentials, profileId, keyId, entries, peer, signal, localKey, cache, check = () => {
} }) {
  validateEntries(entries);
  const object = "qvault/" + profileId + "/" + crypto.randomUUID() + ".json";
  const bytes = enc.encode(JSON.stringify({ version: 1, entries }));
  if (bytes.length > MAX2) throw Error("Password collection is too large");
  const keyBytes = crypto.getRandomValues(new Uint8Array(32)), nonce = crypto.getRandomValues(new Uint8Array(12));
  const format = localKey === void 0 ? FORMAT3 : FORMAT22;
  let inner = null;
  try {
    check();
    if (format === FORMAT22) {
      const local = await importLocalKey(localKey, "encrypt"), wrapNonce = crypto.getRandomValues(new Uint8Array(12));
      inner = new Uint8Array(60);
      inner.set(wrapNonce);
      inner.set(new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: wrapNonce, additionalData: wrapAad(profileId, keyId, object) }, local, keyBytes)), 12);
      check();
    }
    const wrapped = await peer.call("encrypt", { keyId, value: toBase64(inner || keyBytes) });
    check();
    if (typeof wrapped.CiphertextBlob !== "string") throw Error("QKMS returned no wrapped key");
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad(profileId, keyId, object, format) }, key, bytes));
    check();
    const body = JSON.stringify({ format, profileId, keyId, wrappedKey: wrapped.CiphertextBlob, nonce: toBase64(nonce), ciphertext: toBase64(cipher) });
    const response = await client(credentials).fetch(location(credentials, profileId, object), { method: "PUT", body, headers: { "Content-Type": "application/json", "If-None-Match": "*" }, redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(6e4)]) });
    check();
    if (!response.ok) throw Error("QStorage save HTTP " + response.status);
    await remember(cache, object, body);
    return { object };
  } finally {
    keyBytes.fill(0);
    bytes.fill(0);
    inner?.fill(0);
  }
}
async function loadCloudVault({ credentials, profileId, keyId, reference, peer, signal, localKey, cache, check = () => {
} }) {
  if (!reference) return [];
  check();
  location(credentials, profileId, reference.object);
  const download = async () => {
    const response = await client(credentials).fetch(location(credentials, profileId, reference.object), { method: "GET", redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(6e4)]) });
    check();
    if (!response.ok) throw Error("QStorage read HTTP " + response.status);
    const text2 = await response.text();
    check();
    if (text2.length > MAX2 * 2) throw Error("Cloud vault is too large");
    return text2;
  };
  const local = await cached(cache, reference.object);
  check();
  if (local !== null) {
    try {
      return await openSnapshot(local, { profileId, keyId, reference, peer, localKey, check });
    } catch {
      check();
    }
  }
  const text = await download(), entries = await openSnapshot(text, { profileId, keyId, reference, peer, localKey, check });
  await remember(cache, reference.object, text);
  return entries;
}
async function openSnapshot(text, { profileId, keyId, reference, peer, localKey, check }) {
  const record = JSON.parse(text);
  const v2 = record.format === FORMAT22;
  if (localKey !== void 0 && record.format === FORMAT3) throw Error("This cloud snapshot is not protected by the local vault key. It was rejected.");
  if (v2 && localKey === void 0) throw Error("This cloud snapshot needs the local vault key from its profile.");
  if (!v2 && record.format !== FORMAT3 || record.profileId !== profileId || record.keyId !== keyId || typeof record.wrappedKey !== "string" || record.wrappedKey.length > 16384) throw Error("Unexpected cloud vault");
  const nonce = fromBase64(record.nonce, 12);
  if (nonce.length !== 12) throw Error("Invalid cloud vault nonce");
  const local = v2 ? await importLocalKey(localKey, "decrypt") : null;
  const unwrapped = await peer.call("decrypt", { keyId, value: record.wrappedKey });
  check();
  let keyBytes;
  if (v2) {
    const blob = fromBase64(unwrapped.Plaintext, 60);
    try {
      if (blob.length !== 60) throw Error();
      keyBytes = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: blob.subarray(0, 12), additionalData: wrapAad(profileId, keyId, reference.object) }, local, blob.subarray(12)));
    } catch {
      throw Error("The local vault key does not open this cloud snapshot.");
    } finally {
      blob.fill(0);
    }
  } else keyBytes = fromBase64(unwrapped.Plaintext, 32);
  if (keyBytes.length !== 32) throw Error("Invalid recovered vault key");
  let bytes;
  try {
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
    bytes = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: aad(profileId, keyId, reference.object, record.format) }, key, fromBase64(record.ciphertext, MAX2 + 16)));
    check();
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    if (payload.version !== 1) throw Error("Unsupported password collection");
    return validateEntries(payload.entries);
  } finally {
    keyBytes.fill(0);
    bytes?.fill(0);
  }
}
function generatePassword(length = 24) {
  if (!Number.isInteger(length) || length < 16 || length > 128) throw Error("Invalid password length");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%*-_";
  let password = "";
  const limit = 256 - 256 % alphabet.length;
  while (password.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(64));
    for (const b of bytes) {
      if (b < limit) password += alphabet[b % alphabet.length];
      if (password.length === length) break;
    }
    bytes.fill(0);
  }
  return password;
}

// src/single-device-session.js
var SingleDeviceSession = class {
  constructor(options) {
    Object.assign(this, options);
    this.entries = null;
    this.conflicts = [];
    this.mode = "single-device";
  }
  args() {
    return { credentials: storageCredentialsFor(this.payload), profileId: this.handle.profileId, keyId: this.payload.keyId, localKey: this.payload.localKey, cache: this.cache, peer: this.peer, signal: this.signal, check: this.check };
  }
  async init() {
    if (this.payload.sync?.generation || this.payload.sync?.pending) throw Error("This profile has shared sync history or pending changes. Single-computer mode cannot replace that history.");
    return this.refresh();
  }
  // Load the newest cloud copy if it is not the one already open, and remember it in the saved profile.
  async refresh() {
    const reference = await this.transport.latestSnapshot(this.payload.vault, this.signal);
    this.check();
    if (this.entries && reference?.object === this.payload.vault?.object) return this.entries;
    const entries = reference ? await this.withMpc((peer, signal) => this.load({ ...this.args(), reference, peer, signal }), this.signal) : [];
    this.check();
    if (reference?.object !== this.payload.vault?.object) {
      const payload = { ...this.payload, vault: reference };
      const record = await sealProfile(payload, this.handle);
      this.check();
      await this.store.save(record, this.recordRevision);
      this.check();
      this.payload = payload;
      this.recordRevision = record.revision;
    }
    this.entries = entries;
    return this.entries;
  }
  async commit(entries) {
    validateEntries(entries);
    const latest = await this.transport.latestSnapshot(this.payload.vault, this.signal);
    this.check();
    if (latest?.object !== this.payload.vault?.object) throw Error("Another computer just saved changes. They load within a few seconds; then make your change again. This change was not uploaded.");
    const reference = await this.save({ ...this.args(), entries });
    this.check();
    const payload = { ...this.payload, vault: reference };
    const record = await sealProfile(payload, this.handle);
    this.check();
    await this.store.save(record, this.recordRevision);
    this.check();
    this.payload = payload;
    this.recordRevision = record.revision;
    this.entries = entries;
    return entries;
  }
  async sync() {
    return this.refresh();
  }
  // Best-effort cloud housekeeping after a save; never affects the save itself.
  async prune() {
    try {
      if (typeof this.transport?.pruneSnapshots !== "function") return null;
      return await this.transport.pruneSnapshots({ protect: [this.payload?.vault?.object], signal: this.signal });
    } catch {
      return null;
    }
  }
  close() {
    this.entries = null;
    this.payload = null;
    this.handle = null;
  }
};

// src/sync-merge.js
var fields = ["title", "url", "username", "password"];
var canonical = (e) => e ? JSON.stringify([e.id, ...fields.map((k) => e[k])]) : "null";
function sameEntries(a, b) {
  return JSON.stringify([...a].sort((x, y) => x.id.localeCompare(y.id)).map(canonical)) === JSON.stringify([...b].sort((x, y) => x.id.localeCompare(y.id)).map(canonical));
}
async function entryVersion(e) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(e))));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
async function copy(local, remote) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("qvault-conflict-v1|" + canonical(local) + "|" + canonical(remote))));
  bytes[6] = bytes[6] & 15 | 80;
  bytes[8] = bytes[8] & 63 | 128;
  const h = Array.from(bytes.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
  return { ...local, id: [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20)].join("-"), title: local.title.slice(0, 4e3) + " (conflict copy)" };
}
async function mergeEntries(base, local, remote) {
  for (const list of [base, local, remote]) validateEntries(list);
  const maps = [base, local, remote].map((a) => new Map(a.map((e) => [e.id, e]))), result = /* @__PURE__ */ new Map(), conflicts = [];
  for (const id of /* @__PURE__ */ new Set([...maps[0].keys(), ...maps[1].keys(), ...maps[2].keys()])) {
    const [b, l, r] = maps.map((m) => m.get(id) || null);
    const put = (e) => {
      if (e) result.set(e.id, { ...e });
    };
    if (canonical(l) === canonical(b)) {
      put(r);
      continue;
    }
    if (canonical(r) === canonical(b) || canonical(l) === canonical(r)) {
      put(l);
      continue;
    }
    if (!l) {
      put(r);
      conflicts.push({ entryId: id, type: "delete-versus-edit" });
      continue;
    }
    if (!r) {
      put(await copy(l, null));
      conflicts.push({ entryId: id, type: "edit-versus-delete" });
      continue;
    }
    if (b) {
      const merged = { ...r };
      let collision = false;
      for (const f of fields) {
        if (l[f] === b[f]) continue;
        if (r[f] === b[f] || l[f] === r[f]) merged[f] = l[f];
        else collision = true;
      }
      if (!collision) {
        put(merged);
        continue;
      }
    }
    put(r);
    put(await copy(l, r));
    conflicts.push({ entryId: id, type: "conflicting-edit" });
  }
  const entries = [...result.values()].sort((a, b) => a.id.localeCompare(b.id));
  validateEntries(entries);
  return { entries, conflicts };
}

// src/sync-session.js
var SyncSession = class {
  constructor({ transport, cache, store, recordRevision, handle, payload, deviceId, peer, withMpc, check = () => {
  }, signal, onLost = () => {
  }, load = loadCloudVault, save = saveCloudVault }) {
    Object.assign(this, { transport, cache, store, recordRevision, handle, payload, deviceId, peer, withMpc, check, signal, onLost, load, save });
    this.entries = null;
    this.head = null;
    this.conflicts = [];
  }
  args() {
    return { credentials: storageCredentialsFor(this.payload), profileId: this.handle.profileId, keyId: this.payload.keyId, localKey: this.payload.localKey, cache: this.cache, peer: this.peer, signal: this.signal, check: this.check };
  }
  floor(head) {
    const old = this.payload.sync;
    if (old?.generation && head.state.generation < old.generation) throw Error("Cloud sync rollback detected");
    if (old?.generation === head.state.generation && old.revision !== head.state.revision) throw Error("Cloud sync history changed unexpectedly");
  }
  async readHead() {
    let head = await this.transport.readHead(this.signal);
    this.check();
    if (!head) {
      if (this.payload.sync?.generation) throw Error("Cloud sync head is missing; previous state was not reset");
      const state = { version: 1, revision: crypto.randomUUID(), generation: 1, reference: this.payload.vault ?? null, applied: {} };
      try {
        head = await this.transport.publish(null, state, this.signal);
      } catch (e) {
        if (!(e instanceof SyncConflict)) throw e;
        head = await this.transport.readHead(this.signal);
        if (!head) throw Error("Cloud sync initialization race; retry");
      }
    }
    this.floor(head);
    return head;
  }
  async readEntries(head) {
    if (this.entries && this.head?.state.reference?.object === head.state.reference?.object) return this.entries;
    if (!head.state.reference) return [];
    const result = await this.transport.withMpcLease((leaseSignal) => this.withMpc((peer, signal) => this.load({ ...this.args(), reference: head.state.reference, peer, signal }), leaseSignal), { signal: this.signal, onLost: this.onLost });
    this.check();
    return result;
  }
  async persist(payload) {
    const record = await sealProfile(payload, this.handle);
    this.check();
    await this.store.save(record, this.recordRevision);
    this.check();
    this.recordRevision = record.revision;
    this.payload = payload;
  }
  async adopt(head, entries, clearPending = false) {
    const sync = { ...this.payload.sync, generation: head.state.generation, revision: head.state.revision };
    if (clearPending) delete sync.pending;
    await this.persist({ ...this.payload, vault: head.state.reference, sync });
    this.head = head;
    this.entries = entries;
    return entries;
  }
  async init() {
    await this.transport.verify(this.signal);
    this.check();
    if (this.payload.sync?.pending) return this.flush();
    return this.pull();
  }
  async pull() {
    const head = await this.readHead();
    if (this.head?.etag === head.etag) return this.entries;
    const entries = await this.readEntries(head);
    return this.adopt(head, entries);
  }
  async commit(entries, base = this.entries) {
    validateEntries(entries);
    validateEntries(base);
    if (this.payload.sync?.pending) await this.flush();
    const counter = Math.max(this.payload.sync?.counter || 0, this.head?.state.applied[this.deviceId] || 0) + 1;
    const pending = { device: this.deviceId, sequence: counter, base, entries };
    await this.persist({ ...this.payload, sync: { ...this.payload.sync, counter, pending } });
    return this.flush();
  }
  async flush() {
    const pending = this.payload.sync?.pending;
    if (!pending) return this.pull();
    if (!/^[a-f0-9-]{36}$/.test(pending.device) || !Number.isSafeInteger(pending.sequence) || pending.sequence < 1) throw Error("Invalid pending sync change");
    validateEntries(pending.base);
    validateEntries(pending.entries);
    for (let attempt = 0; attempt < 6; attempt++) {
      this.check();
      const head = await this.readHead();
      const remote = await this.readEntries(head);
      if ((head.state.applied[pending.device] || 0) >= pending.sequence) {
        await this.adopt(head, remote, true);
        return this.entries;
      }
      const merged = await mergeEntries(pending.base, pending.entries, remote);
      this.check();
      const reference = sameEntries(merged.entries, remote) ? head.state.reference : await this.save({ ...this.args(), entries: merged.entries });
      this.check();
      const applied = { ...head.state.applied, [pending.device]: pending.sequence };
      if (Object.keys(applied).length > 128) throw Error("Too many linked device identities for this sync format");
      const next = { version: 1, revision: crypto.randomUUID(), generation: head.state.generation + 1, reference, applied, parent: head.state.revision };
      try {
        const published = await this.transport.publish(head, next, this.signal);
        this.check();
        this.conflicts = merged.conflicts;
        await this.adopt(published, merged.entries, true);
        return this.entries;
      } catch (e) {
        if (!(e instanceof SyncConflict)) throw e;
      }
    }
    throw Error("Other devices are saving repeatedly. Pending changes remain protected and will retry.");
  }
  async sync() {
    return this.payload.sync?.pending ? this.flush() : this.pull();
  }
  // Best-effort cloud housekeeping after a save; never affects the save itself.
  async prune() {
    try {
      if (typeof this.transport?.pruneSnapshots !== "function") return null;
      return await this.transport.pruneSnapshots({ protect: [this.payload?.vault?.object, this.head?.state?.reference?.object], signal: this.signal });
    } catch {
      return null;
    }
  }
  close() {
    this.entries = null;
    this.handle = null;
    this.head = null;
    this.payload = null;
  }
};

// src/local-peer.js
var LocalKeyPeer = class {
  constructor() {
    this.closed = false;
  }
  async call(action, { value } = {}) {
    if (this.closed) throw Error("Vault locked");
    if (action !== "encrypt" && action !== "decrypt") throw Error("Unsupported local key operation");
    let raw;
    try {
      raw = fromBase64(value, 60);
    } catch {
      throw Error("Refusing to store an unwrapped key");
    }
    const size = raw.length;
    raw.fill(0);
    if (size !== 60) throw Error("Refusing to store an unwrapped key");
    return action === "encrypt" ? { CiphertextBlob: value } : { Plaintext: value };
  }
  stop() {
    this.closed = true;
  }
};

// src/vault-runtime.js
var BrowserParticipant = class {
  constructor() {
    this.worker = new Worker(new URL("./engine.js", import.meta.url), { type: "module" });
    this.pending = /* @__PURE__ */ new Map();
    this.next = 1;
    this.closed = false;
    this.worker.onmessage = ({ data: r }) => {
      if (r?.event) {
        try {
          this.onEvent?.(r);
        } catch {
        }
        return;
      }
      const p = this.pending.get(r.id);
      if (!p) return;
      this.pending.delete(r.id);
      clearTimeout(p.timer);
      r.error ? p.reject(Error(r.error)) : p.resolve(r.data);
    };
    this.worker.onerror = () => this.stop();
  }
  call(action, args = {}, timeout = 9e4) {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(Error("Vault locked"));
      const id = this.next++, timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error("Service request timed out"));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, action, ...args });
    });
  }
  stop() {
    this.closed = true;
    this.worker.terminate();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(Error("Vault locked"));
    }
    this.pending.clear();
  }
};
function sameOrigin(entry, origin) {
  try {
    return new URL(entry.url).origin === origin && new URL(origin).protocol === "https:";
  } catch {
    return false;
  }
}
var VaultRuntime = class {
  constructor({ store = new ProfileStore(), lease = acquireProfileLease, makePeer = () => new BrowserParticipant(), load = loadCloudVault, save = saveCloudVault, makeTransport = (o) => new SyncTransport(o), makeSync = (o) => new SyncSession(o), now = () => Date.now(), idleMs = 3e5, syncIntervalMs = 2e4, onState = null } = {}) {
    Object.assign(this, { store, lease, makePeer, load, save, makeTransport, makeSync, now, idleMs, syncIntervalMs, onState });
    this.reported = false;
    this.peers = [];
    this.entries = [];
    this.epoch = 0;
    this.busy = false;
    this.handle = null;
    this.release = null;
    this.abort = new AbortController();
    this.deadline = 0;
    this.syncState = "locked";
    this.lastSync = 0;
  }
  expire() {
    if (this.handle && this.now() >= this.deadline) this.lock();
  }
  touch() {
    this.deadline = this.now() + this.idleMs;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.expire(), this.idleMs);
  }
  lock() {
    this.epoch++;
    this.abort.abort();
    this.abort = new AbortController();
    for (const p of this.peers) p.stop();
    this.peers = [];
    this.apiPeer?.stop();
    this.apiPeer = null;
    this.sync?.close();
    this.sync = null;
    this.entries = [];
    this.handle = null;
    this.payload = null;
    this.revision = null;
    this.busy = false;
    this.syncJob = null;
    this.syncState = "locked";
    clearInterval(this.poller);
    clearTimeout(this.timer);
    this.release?.();
    this.release = null;
    this.report(false);
    return { unlocked: false };
  }
  report(unlocked) {
    if (unlocked === this.reported) return;
    this.reported = unlocked;
    try {
      this.onState?.(unlocked);
    } catch {
    }
  }
  check(epoch) {
    if (epoch !== this.epoch) throw Error("Vault locked");
  }
  async status() {
    const record = await this.store.read(), saved = !!record;
    this.expire();
    return { unlocked: !!this.handle, saved, confirmReveal: await this.store.readConfirmReveal?.() ?? true, lockMinutes: await this.store.readLockMinutes?.() ?? Math.round(this.idleMs / 6e4), auth: "passkey", busy: this.busy && !this.syncJob, syncing: !!this.syncJob, syncState: this.syncState, lastSync: this.lastSync, revision: this.sync?.head?.state.revision ?? this.sync?.payload?.vault?.object ?? null, pending: !!this.sync?.payload?.sync?.pending, conflicts: this.sync?.conflicts?.length || 0, mode: this.sync?.mode || "shared-sync" };
  }
  async mpc(payload, fn, signal, epoch) {
    if (payload.topology === "hosted" || payload.topology === "local") {
      this.check(epoch);
      return fn(this.apiPeer, AbortSignal.any([signal, this.abort.signal]));
    }
    const api = this.apiPeer;
    const active = [];
    try {
      const baseline = await api.call("pending-tasks", { sidecarIds: payload.participants.map((p) => p.sidecarId) }, 3e4);
      this.check(epoch);
      await Promise.all(payload.participants.map(async (state) => {
        const p = this.makePeer();
        this.peers.push(p);
        active.push(p);
        const r = await p.call("start", { credentials: payload.credentials, restore: state, syncSession: true, ignoreTaskIds: baseline.ids, preparationBackend: "rust" });
        this.check(epoch);
        if (r.sidecarId !== state.sidecarId) throw Error("Restored participant changed identity");
      }));
      this.check(epoch);
      return await fn(api, AbortSignal.any([signal, this.abort.signal]));
    } finally {
      for (const p of active) p.stop();
      this.peers = this.peers.filter((p) => !active.includes(p));
    }
  }
  async unlock(secret) {
    if (this.handle) {
      this.touch();
      return { unlocked: true };
    }
    const epoch = this.epoch;
    try {
      const release = await this.lease();
      if (epoch !== this.epoch) {
        release();
        throw Error("Vault locked");
      }
      this.release = release;
      const record = await this.store.read();
      this.check(epoch);
      if (!record) throw Error("No protected profile. Open setup to create and save one.");
      const opened = await openProfile(record, secret);
      this.check(epoch);
      const payload = validateProfilePayload(opened.payload);
      if (payload.topology === "local") this.apiPeer = new LocalKeyPeer();
      else {
        this.apiPeer = this.makePeer();
        await this.apiPeer.call("observe-start", { credentials: payload.credentials, keyId: payload.keyId }, 15e3);
        this.check(epoch);
        const ready = await this.apiPeer.call("ready", { keyId: payload.keyId, sidecarId: payload.participants[0].sidecarId }, 3e4);
        this.check(epoch);
        if (!ready.ready) throw Error("Saved QKMS key is not ready");
      }
      if (payload.topology === "hosted") {
        const saved = payload.participants[0], baseline = await this.apiPeer.call("pending-tasks", { sidecarIds: [saved.sidecarId] }, 3e4);
        this.check(epoch);
        if (!Array.isArray(baseline?.ids)) throw Error("Could not list pending key tasks");
        const local = this.makePeer();
        this.peers.push(local);
        const started = await local.call("start", { credentials: payload.credentials, restore: saved, hosted: true, syncSession: true, ignoreTaskIds: baseline.ids, preparationBackend: "rust" });
        this.check(epoch);
        if (started.sidecarId !== saved.sidecarId) throw Error("Restored participant changed identity");
      }
      const deviceId = await this.store.getDeviceId();
      this.check(epoch);
      const transport = this.makeTransport({ credentials: storageCredentialsFor(payload), profileId: opened.handle.profileId, keyId: payload.keyId, handle: opened.handle });
      let singleDevice = false;
      const storageInfo = storageCredentialsFor(payload), linked = !!(payload.sync?.generation || payload.sync?.pending);
      let known = null;
      try {
        known = await this.store.readCapability?.();
      } catch {
      }
      this.check(epoch);
      const age = known ? this.now() - known.checkedAt : -1, fresh = known && known.profileId === opened.handle.profileId && known.bucket === storageInfo.bucket && known.region === storageInfo.region && age >= 0 && age < (known.mode === "single" ? 864e5 : 36e5);
      if (fresh && known.mode === "shared") transport.verified = true;
      else if (fresh && known.mode === "single" && !linked) singleDevice = true;
      else {
        try {
          await transport.verify(this.abort.signal);
          this.check(epoch);
        } catch (e) {
          this.check(epoch);
          if (!(e instanceof SyncUnavailable)) throw e;
          if (linked) throw Error("Cloud sync is unavailable. This linked profile cannot safely switch to local snapshots. Your saved profile and pending changes are retained.");
          singleDevice = true;
        }
        try {
          await this.store.writeCapability?.({ profileId: opened.handle.profileId, bucket: storageInfo.bucket, region: storageInfo.region, mode: singleDevice ? "single" : "shared", checkedAt: this.now() });
        } catch {
        }
        this.check(epoch);
      }
      const cache = typeof this.store.readSnapshotCache === "function" ? { get: (object) => this.store.readSnapshotCache(object), put: (object, text) => this.store.writeSnapshotCache(object, text) } : void 0;
      this.sync = (singleDevice ? (o) => new SingleDeviceSession(o) : this.makeSync)({ transport, cache, store: this.store, recordRevision: record.revision, handle: opened.handle, payload, deviceId, peer: this.apiPeer, load: this.load, save: this.save, signal: this.abort.signal, check: () => this.check(epoch), onLost: () => {
        if (epoch === this.epoch) this.lock();
      }, withMpc: (fn, signal) => this.mpc(payload, fn, signal, epoch) });
      this.syncState = "checking";
      await this.sync.init();
      this.check(epoch);
      const minutes = await this.store.readLockMinutes?.();
      this.check(epoch);
      if (minutes) this.idleMs = minutes * 6e4;
      this.handle = opened.handle;
      this.adoptSync();
      this.touch();
      this.poller = setInterval(() => this.background(), this.syncIntervalMs);
      this.report(true);
      return { unlocked: true };
    } catch (e) {
      if (epoch === this.epoch) this.lock();
      throw e;
    }
  }
  adoptSync() {
    this.entries = this.sync.entries;
    this.payload = this.sync.payload;
    this.revision = this.sync.recordRevision;
    this.lastSync = this.now();
    this.syncState = this.sync.mode === "single-device" ? "Single-computer mode \xB7 cloud snapshots saved \xB7 automatic sync unavailable" : this.sync.conflicts?.length ? "conflict-copies-preserved" : "synced";
  }
  async performSync() {
    this.syncState = "checking";
    await this.sync.sync();
    this.adoptSync();
  }
  background() {
    this.expire();
    if (!this.handle || this.busy) return;
    const epoch = this.epoch;
    this.busy = true;
    const job = this.performSync().catch((e) => {
      if (epoch === this.epoch) this.syncState = e.message;
    }).finally(() => {
      if (epoch === this.epoch) {
        this.busy = false;
        if (this.syncJob === job) this.syncJob = null;
      }
    });
    this.syncJob = job;
  }
  async commit(entries, base = this.entries) {
    try {
      await this.sync.commit(entries, base);
      this.adoptSync();
      this.touch();
      this.sync.prune?.();
      return { saved: true, conflicts: this.sync.conflicts.length, mode: this.sync.mode || "shared-sync" };
    } catch (e) {
      this.syncState = e.message;
      throw Error(e.message + (this.sync?.payload?.sync?.pending ? " Pending changes remain encrypted locally and will retry." : ""));
    }
  }
  // A replaced password is kept with its entry (one step back), so a change that the website refused is not lost.
  kept(before, password) {
    if (!before) return {};
    if (before.password && before.password !== password) return { previous: { password: before.password, at: new Date(this.now()).toISOString() } };
    return before.previous ? { previous: before.previous } : {};
  }
  async command(m) {
    this.expire();
    if (m.action === "lock") return this.lock();
    if (m.action === "status") return this.status();
    if (m.action === "set-lock-minutes") {
      await this.store.writeLockMinutes(m.minutes);
      this.idleMs = m.minutes * 6e4;
      if (this.handle) this.touch();
      return this.status();
    }
    if (m.action === "set-confirm-reveal") {
      if (typeof m.value !== "boolean") throw Error("Invalid setting");
      await this.store.writeConfirmReveal(m.value);
      if (!m.value) this.lock();
      return this.status();
    }
    if (this.syncJob) await this.syncJob;
    if (this.busy) throw Error("A vault operation is still running");
    this.busy = true;
    const epoch = this.epoch;
    try {
      if (m.action === "unlock") {
        let prf = null;
        try {
          if (typeof m.prf === "string") prf = fromBase64(m.prf, 64);
          return await this.unlock(prf ? { prf } : { recoveryKey: typeof m.recoveryKey === "string" ? m.recoveryKey : "" });
        } finally {
          prf?.fill(0);
        }
      }
      if (!this.handle) throw Error("Vault locked. Open QVault and unlock it.");
      if (!m.passive) this.touch();
      if (m.action === "sync") {
        await this.performSync();
        return this.status();
      }
      if (m.action === "generate") return { password: generatePassword() };
      if (["list", "get", "all-entries"].includes(m.action) && this.now() - this.lastSync >= 15e3) await this.performSync();
      if (m.action === "all-entries") return Promise.all(this.entries.map(async (e) => ({ id: e.id, title: e.title, username: e.username, url: e.url, version: await entryVersion(e) })));
      const origin = new URL(m.origin);
      if (origin.protocol !== "https:" || origin.origin !== m.origin) throw Error("An exact HTTPS website is required");
      const find = () => {
        const entry = this.entries.find((e) => e.id === m.id && sameOrigin(e, m.origin));
        if (!entry) throw Error("Entry not found for this website");
        return entry;
      };
      if (m.action === "list") return Promise.all(this.entries.filter((e) => sameOrigin(e, m.origin)).slice(0, 100).map(async (e) => ({ id: e.id, title: e.title, username: e.username, version: await entryVersion(e) })));
      if (m.action === "get") {
        const { previous, ...entry } = find();
        return m.forEdit === true && (await this.store.readConfirmReveal?.() ?? true) ? { ...entry, password: "", passwordHidden: true } : entry;
      }
      if (m.action === "reveal") {
        const entry = find();
        let prf = null;
        try {
          if (typeof m.prf === "string") prf = fromBase64(m.prf, 64);
          const secret = prf ? { prf } : typeof m.recoveryKey === "string" ? { recoveryKey: m.recoveryKey } : null;
          if (!secret) throw Error("Confirm with your passkey or recovery key");
          await openProfile(await this.store.read(), secret);
        } finally {
          prf?.fill(0);
        }
        return { title: entry.title, username: entry.username, password: entry.password, ...entry.previous ? { previous: { password: entry.previous.password, at: entry.previous.at } } : {} };
      }
      if (m.action === "delete") {
        const entry = find();
        if (m.expectedVersion && m.expectedVersion !== await entryVersion(entry)) throw Error("This entry changed on another device. Refresh and review it before deleting.");
        return await this.commit(this.entries.filter((e) => e.id !== m.id));
      }
      if (m.action === "save-login" || m.action === "check-login") {
        if (typeof m.username !== "string" || typeof m.password !== "string" || !m.password) throw Error("A password is needed to save a login");
        const mine = this.entries.filter((e) => sameOrigin(e, m.origin)), match = m.username && mine.find((e) => e.username === m.username) || mine.find((e) => e.password === m.password) || (!m.username && mine.length === 1 ? mine[0] : null);
        if (m.action === "check-login") return { state: !match ? "new" : match.password === m.password && (!m.username || match.username === m.username) ? "saved" : "changed" };
        const next = { id: match?.id || crypto.randomUUID(), title: match?.title || origin.hostname, url: m.origin, username: m.username || match?.username || "", password: m.password, ...this.kept(match, m.password) };
        if (match && match.username === next.username && match.password === next.password) return { saved: true, unchanged: true, updated: false };
        return { ...await this.commit([...this.entries.filter((e) => e.id !== next.id), next]), updated: !!match };
      }
      if (m.action === "put") {
        const entry = m.entry;
        if (!entry || typeof entry.title !== "string" || !entry.title.trim() || typeof entry.username !== "string" || typeof entry.password !== "string") throw Error("Enter title, username and password");
        if (m.create && (!m.id || !/^[a-f0-9-]{36}$/.test(m.id))) throw Error("Invalid new entry ID");
        const before = m.id ? this.entries.find((e) => e.id === m.id) : null;
        if (before && !sameOrigin(before, m.origin)) throw Error("Entry belongs to another website");
        if (m.id && !m.create) find();
        let password = entry.password;
        if (m.hiddenPassword === true) {
          if (!before) throw Error("Entry not found for this website");
          if (password === "") password = before.password;
          if (m.base) m = { ...m, base: { ...m.base, password: before.password } };
        }
        let base = this.entries.map((e) => ({ ...e }));
        if (m.base) {
          if (m.base.id !== m.id || !sameOrigin(m.base, m.origin)) throw Error("Invalid edited entry baseline");
          base = base.filter((e) => e.id !== m.id);
          base.push({ id: m.base.id, ...Object.fromEntries(["title", "url", "username", "password"].map((k) => [k, m.base[k]])) });
        }
        const next = { id: m.id || crypto.randomUUID(), title: entry.title.trim(), url: m.origin, username: entry.username, password, ...this.kept(before, password) };
        if (m.create) base = base.filter((e) => e.id !== next.id);
        return await this.commit([...this.entries.filter((e) => e.id !== next.id), next], base);
      }
      throw Error("Unsupported vault request");
    } finally {
      if (epoch === this.epoch) this.busy = false;
    }
  }
};

// src/offscreen.js
var report = (unlocked) => {
  try {
    Promise.resolve(chrome.runtime.sendMessage({ target: "qvault-background", event: "lock-state", unlocked })).catch(() => {
    });
  } catch {
  }
};
var vault = new VaultRuntime({ onState: report });
chrome.runtime.onMessage.addListener((m, s, reply) => {
  if (m?.target !== "qvault-offscreen") return;
  if (s.id !== chrome.runtime.id || s.tab) {
    reply({ error: "Unauthorized vault request" });
    return;
  }
  vault.command(m.command).then((data) => reply({ data }), (e) => reply({ error: e instanceof SyntaxError ? "Invalid protected data" : e.message }));
  return true;
});
window.addEventListener("pagehide", () => vault.lock());
/*! Bundled license information:

aws4fetch/dist/aws4fetch.esm.mjs:
  (**
   * @license MIT <https://opensource.org/licenses/MIT>
   * @copyright Michael Hart 2024
   *)
*/
//# sourceMappingURL=offscreen.js.map
