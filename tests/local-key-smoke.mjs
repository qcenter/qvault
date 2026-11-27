// tests/local-key-source.js
import assert from "node:assert/strict";

// node_modules/aws4fetch/dist/aws4fetch.esm.mjs
var encoder = new TextEncoder();
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
    }).map((pair2) => pair2.map((p) => encodeRfc3986(encodeURIComponent(p)))).sort(([k1, v1], [k2, v2]) => k1 < k2 ? -1 : k1 > k2 ? 1 : v1 < v2 ? -1 : v1 > v2 ? 1 : 0).map((pair2) => pair2.join("=")).join("&");
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
async function hmac(key2, string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    typeof key2 === "string" ? encoder.encode(key2) : key2,
    { name: "HMAC", hash: { name: "SHA-256" } },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(string));
}
async function hash(content) {
  return crypto.subtle.digest("SHA-256", typeof content === "string" ? encoder.encode(content) : content);
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

// src/profile-crypto.js
var FORMAT2 = "qvault-profile-v2";
var MAX = 4 * 1024 * 1024;
var encoder2 = new TextEncoder();
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
var ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
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
var slotAad = (profileId2, slot) => encoder2.encode(JSON.stringify({ format: FORMAT2, purpose: "profile-key", profileId: profileId2, type: slot.type, credentialId: slot.credentialId ?? null, prfSalt: slot.prfSalt ?? null }));
var aad2 = (record) => encoder2.encode(JSON.stringify({ format: FORMAT2, profileId: record.profileId, revision: record.revision }));
async function slotKey(secret, salt, type, usage) {
  const material = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: encoder2.encode("qvault-profile-key/" + type) }, material, { name: "AES-GCM", length: 256 }, false, [usage]);
}
async function wrapSlot(slot, secret, raw, profileId2) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), nonce = crypto.getRandomValues(new Uint8Array(12)), key2 = await slotKey(secret, salt, slot.type, "encrypt");
  return { ...slot, salt: toBase64(salt), nonce: toBase64(nonce), wrapped: toBase64(new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: slotAad(profileId2, slot) }, key2, raw))) };
}
async function createPasskeyProfile({ prf, credentialId, prfSalt, profileId: profileId2 = crypto.randomUUID() }) {
  if (!(prf instanceof Uint8Array) || prf.length < 32) throw Error("Invalid passkey secret");
  if (!/^[a-f0-9-]{36}$/.test(profileId2)) throw Error("Invalid profile identifier");
  const raw = crypto.getRandomValues(new Uint8Array(32)), recoveryKey = generateRecoveryKey(), recoveryBytes = parseRecoveryKey(recoveryKey);
  try {
    const slots = [await wrapSlot({ type: "passkey", credentialId, prfSalt }, prf, raw, profileId2), await wrapSlot({ type: "recovery" }, recoveryBytes, raw, profileId2)];
    for (const slot of slots) validateSlot(slot);
    return { handle: { format: FORMAT2, key: await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]), profileId: profileId2, slots }, recoveryKey };
  } finally {
    raw.fill(0);
    recoveryBytes.fill(0);
  }
}
async function sealPasskeyProfile(payload, handle) {
  const record = { format: FORMAT2, profileId: handle.profileId, revision: crypto.randomUUID(), slots: handle.slots, nonce: toBase64(crypto.getRandomValues(new Uint8Array(12))) };
  const bytes = encoder2.encode(JSON.stringify(payload));
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
async function sealProfile(payload, handle) {
  if (handle?.format !== FORMAT2) throw Error("Unsupported profile key");
  return sealPasskeyProfile(payload, handle);
}

// src/cloud-vault.js
var FORMAT = "qvault-passwords-v1";
var FORMAT22 = "qvault-passwords-v2";
var MAX2 = 1024 * 1024;
var enc = new TextEncoder();
function location(credentials2, profileId2, object) {
  if (!/^[a-f0-9-]{36}$/.test(profileId2) || typeof object !== "string" || !object.startsWith("qvault/" + profileId2 + "/") || !/^[a-zA-Z0-9/._-]+$/.test(object) || object.split("/").some((s) => s === "" || s === "." || s === "..")) throw Error("Invalid cloud vault reference");
  return "https://qstorage.quilibrium.com/" + credentials2.bucket + "/" + object;
}
function client(c) {
  return new AwsClient({ accessKeyId: c.accessKey, secretAccessKey: c.secretKey, service: "s3", region: c.region, retries: 0 });
}
function aad(profileId2, keyId2, object, format = FORMAT) {
  return enc.encode(JSON.stringify({ format, profileId: profileId2, keyId: keyId2, object }));
}
var wrapAad = (profileId2, keyId2, object) => enc.encode(JSON.stringify({ format: FORMAT22, purpose: "key-wrap", profileId: profileId2, keyId: keyId2, object }));
async function importLocalKey(localKey2, usage) {
  let raw;
  try {
    raw = fromBase64(localKey2, 32);
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
function validateEntries(entries2) {
  if (!Array.isArray(entries2) || entries2.length > 1e3) throw Error("Invalid password collection");
  const ids = /* @__PURE__ */ new Set();
  for (const e of entries2) {
    if (!e || typeof e.id !== "string" || !/^[a-f0-9-]{36}$/.test(e.id) || ids.has(e.id)) throw Error("Invalid password entry");
    ids.add(e.id);
    for (const f of ["title", "url", "username", "password"]) if (typeof e[f] !== "string" || e[f].length > 4096) throw Error("Invalid password entry");
    if (e.url) {
      const u = new URL(e.url);
      if (u.protocol !== "https:") throw Error("Use an HTTPS website URL");
    }
    if (e.previous !== void 0 && (!e.previous || typeof e.previous.password !== "string" || e.previous.password.length > 4096 || typeof e.previous.at !== "string" || e.previous.at.length > 40)) throw Error("Invalid password entry");
  }
  return entries2;
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
async function saveCloudVault({ credentials: credentials2, profileId: profileId2, keyId: keyId2, entries: entries2, peer: peer2, signal, localKey: localKey2, cache, check = () => {
} }) {
  validateEntries(entries2);
  const object = "qvault/" + profileId2 + "/" + crypto.randomUUID() + ".json";
  const bytes = enc.encode(JSON.stringify({ version: 1, entries: entries2 }));
  if (bytes.length > MAX2) throw Error("Password collection is too large");
  const keyBytes = crypto.getRandomValues(new Uint8Array(32)), nonce = crypto.getRandomValues(new Uint8Array(12));
  const format = localKey2 === void 0 ? FORMAT : FORMAT22;
  let inner = null;
  try {
    check();
    if (format === FORMAT22) {
      const local = await importLocalKey(localKey2, "encrypt"), wrapNonce = crypto.getRandomValues(new Uint8Array(12));
      inner = new Uint8Array(60);
      inner.set(wrapNonce);
      inner.set(new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: wrapNonce, additionalData: wrapAad(profileId2, keyId2, object) }, local, keyBytes)), 12);
      check();
    }
    const wrapped = await peer2.call("encrypt", { keyId: keyId2, value: toBase64(inner || keyBytes) });
    check();
    if (typeof wrapped.CiphertextBlob !== "string") throw Error("QKMS returned no wrapped key");
    const key2 = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad(profileId2, keyId2, object, format) }, key2, bytes));
    check();
    const body = JSON.stringify({ format, profileId: profileId2, keyId: keyId2, wrappedKey: wrapped.CiphertextBlob, nonce: toBase64(nonce), ciphertext: toBase64(cipher) });
    const response = await client(credentials2).fetch(location(credentials2, profileId2, object), { method: "PUT", body, headers: { "Content-Type": "application/json", "If-None-Match": "*" }, redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(6e4)]) });
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
async function loadCloudVault({ credentials: credentials2, profileId: profileId2, keyId: keyId2, reference, peer: peer2, signal, localKey: localKey2, cache, check = () => {
} }) {
  if (!reference) return [];
  check();
  location(credentials2, profileId2, reference.object);
  const download = async () => {
    const response = await client(credentials2).fetch(location(credentials2, profileId2, reference.object), { method: "GET", redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(6e4)]) });
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
      return await openSnapshot(local, { profileId: profileId2, keyId: keyId2, reference, peer: peer2, localKey: localKey2, check });
    } catch {
      check();
    }
  }
  const text = await download(), entries2 = await openSnapshot(text, { profileId: profileId2, keyId: keyId2, reference, peer: peer2, localKey: localKey2, check });
  await remember(cache, reference.object, text);
  return entries2;
}
async function openSnapshot(text, { profileId: profileId2, keyId: keyId2, reference, peer: peer2, localKey: localKey2, check }) {
  const record = JSON.parse(text);
  const v2 = record.format === FORMAT22;
  if (localKey2 !== void 0 && record.format === FORMAT) throw Error("This cloud snapshot is not protected by the local vault key. It was rejected.");
  if (v2 && localKey2 === void 0) throw Error("This cloud snapshot needs the local vault key from its profile.");
  if (!v2 && record.format !== FORMAT || record.profileId !== profileId2 || record.keyId !== keyId2 || typeof record.wrappedKey !== "string" || record.wrappedKey.length > 16384) throw Error("Unexpected cloud vault");
  const nonce = fromBase64(record.nonce, 12);
  if (nonce.length !== 12) throw Error("Invalid cloud vault nonce");
  const local = v2 ? await importLocalKey(localKey2, "decrypt") : null;
  const unwrapped = await peer2.call("decrypt", { keyId: keyId2, value: record.wrappedKey });
  check();
  let keyBytes;
  if (v2) {
    const blob = fromBase64(unwrapped.Plaintext, 60);
    try {
      if (blob.length !== 60) throw Error();
      keyBytes = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: blob.subarray(0, 12), additionalData: wrapAad(profileId2, keyId2, reference.object) }, local, blob.subarray(12)));
    } catch {
      throw Error("The local vault key does not open this cloud snapshot.");
    } finally {
      blob.fill(0);
    }
  } else keyBytes = fromBase64(unwrapped.Plaintext, 32);
  if (keyBytes.length !== 32) throw Error("Invalid recovered vault key");
  let bytes;
  try {
    const key2 = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
    bytes = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: aad(profileId2, keyId2, reference.object, record.format) }, key2, fromBase64(record.ciphertext, MAX2 + 16)));
    check();
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    if (payload.version !== 1) throw Error("Unsupported password collection");
    return validateEntries(payload.entries);
  } finally {
    keyBytes.fill(0);
    bytes?.fill(0);
  }
}

// src/storage-config.js
function validateStorageCredentials(value) {
  if (!value || typeof value.accessKey !== "string" || !value.accessKey || typeof value.secretKey !== "string" || !value.secretKey || typeof value.region !== "string" || !/^[-a-z0-9]{1,64}$/.test(value.region) || typeof value.bucket !== "string" || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value.bucket)) throw Error("Invalid saved cloud storage settings");
  return value;
}
var storageCredentialsFor = (payload) => validateStorageCredentials(payload.storageCredentials || payload.credentials);

// src/sync-merge.js
var fields = ["title", "url", "username", "password"];
var canonical = (e) => e ? JSON.stringify([e.id, ...fields.map((k) => e[k])]) : "null";
function sameEntries(a, b) {
  return JSON.stringify([...a].sort((x, y) => x.id.localeCompare(y.id)).map(canonical)) === JSON.stringify([...b].sort((x, y) => x.id.localeCompare(y.id)).map(canonical));
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
  const entries2 = [...result.values()].sort((a, b) => a.id.localeCompare(b.id));
  validateEntries(entries2);
  return { entries: entries2, conflicts };
}

// src/sync-transport.js
var SyncConflict = class extends Error {
  constructor() {
    super("Cloud state changed. Retrying the merge.");
    this.name = "SyncConflict";
  }
};

// src/sync-session.js
var SyncSession = class {
  constructor({ transport, cache, store, recordRevision, handle, payload, deviceId, peer: peer2, withMpc, check = () => {
  }, signal, onLost = () => {
  }, load = loadCloudVault, save = saveCloudVault }) {
    Object.assign(this, { transport, cache, store, recordRevision, handle, payload, deviceId, peer: peer2, withMpc, check, signal, onLost, load, save });
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
    const result = await this.transport.withMpcLease((leaseSignal) => this.withMpc((peer2, signal) => this.load({ ...this.args(), reference: head.state.reference, peer: peer2, signal }), leaseSignal), { signal: this.signal, onLost: this.onLost });
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
  async adopt(head, entries2, clearPending = false) {
    const sync = { ...this.payload.sync, generation: head.state.generation, revision: head.state.revision };
    if (clearPending) delete sync.pending;
    await this.persist({ ...this.payload, vault: head.state.reference, sync });
    this.head = head;
    this.entries = entries2;
    return entries2;
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
    const entries2 = await this.readEntries(head);
    return this.adopt(head, entries2);
  }
  async commit(entries2, base = this.entries) {
    validateEntries(entries2);
    validateEntries(base);
    if (this.payload.sync?.pending) await this.flush();
    const counter = Math.max(this.payload.sync?.counter || 0, this.head?.state.applied[this.deviceId] || 0) + 1;
    const pending = { device: this.deviceId, sequence: counter, base, entries: entries2 };
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
    const entries2 = reference ? await this.withMpc((peer2, signal) => this.load({ ...this.args(), reference, peer: peer2, signal }), this.signal) : [];
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
    this.entries = entries2;
    return this.entries;
  }
  async commit(entries2) {
    validateEntries(entries2);
    const latest = await this.transport.latestSnapshot(this.payload.vault, this.signal);
    this.check();
    if (latest?.object !== this.payload.vault?.object) throw Error("Another computer just saved changes. They load within a few seconds; then make your change again. This change was not uploaded.");
    const reference = await this.save({ ...this.args(), entries: entries2 });
    this.check();
    const payload = { ...this.payload, vault: reference };
    const record = await sealProfile(payload, this.handle);
    this.check();
    await this.store.save(record, this.recordRevision);
    this.check();
    this.payload = payload;
    this.recordRevision = record.revision;
    this.entries = entries2;
    return entries2;
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

// src/participant-state.js
function validateParticipantState(state, keyId2) {
  if (!state || state.version !== 1 || state.keyId !== keyId2 || typeof keyId2 !== "string" || !/^[A-Za-z0-9_:/.-]{1,256}$/.test(keyId2) || !/^[a-f0-9]{32}$/.test(state.sidecarId) || !Array.isArray(state.entries) || state.entries.length !== 2) throw Error("Invalid saved participant");
  const map = /* @__PURE__ */ new Map();
  for (const pair2 of state.entries) {
    if (!Array.isArray(pair2) || pair2.length !== 2 || !["identity", "keyshare/" + keyId2].includes(pair2[0]) || map.has(pair2[0])) throw Error("Invalid saved participant entries");
    map.set(pair2[0], fromBase64(pair2[1], 65536));
  }
  const identity = JSON.parse(new TextDecoder().decode(map.get("identity"))), share = JSON.parse(new TextDecoder().decode(map.get("keyshare/" + keyId2)));
  if (identity.sidecarId !== state.sidecarId) throw Error("Saved participant identity mismatch");
  for (const field of ["identityPrivateX448", "identityPublicX448", "signedPreKeyPrivateX448", "signedPreKeyPublicX448", "signingPrivateEd448", "signingPublicEd448", "preKeySignature"]) if (typeof identity[field] !== "string" || !/^([a-f0-9]{2}){32,128}$/.test(identity[field])) throw Error("Incomplete saved participant identity");
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

// tests/local-key-source.js
var originalFetch = globalThis.fetch;
var objects = /* @__PURE__ */ new Map();
var profileId = crypto.randomUUID();
var keyId = "fictional-local-layer-key";
var credentials = { accessKey: "FICTIONAL_ACCESS", secretKey: "FICTIONAL_SECRET", region: "q-world-1", bucket: "fictional-bucket" };
var pair = await crypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, false, ["encrypt", "decrypt"]);
var seen = [];
var peer = { call: async (action, m) => {
  if (action === "encrypt") {
    seen.push(Buffer.from(m.value, "base64"));
    return { CiphertextBlob: Buffer.from(await crypto.subtle.encrypt({ name: "RSA-OAEP" }, pair.publicKey, Buffer.from(m.value, "base64"))).toString("base64") };
  }
  if (action === "decrypt") return { Plaintext: Buffer.from(await crypto.subtle.decrypt({ name: "RSA-OAEP" }, pair.privateKey, Buffer.from(m.value, "base64"))).toString("base64") };
  throw Error("Unexpected RPC");
} };
globalThis.fetch = async (input) => {
  const request = input instanceof Request ? input : new Request(input), path = new URL(request.url).pathname;
  if (request.method === "PUT") {
    objects.set(path, await request.text());
    return new Response("");
  }
  return objects.has(path) ? new Response(objects.get(path)) : new Response("", { status: 404 });
};
var key = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
var localKey = key();
var args = { credentials, profileId, keyId, peer, signal: new AbortController().signal };
var entries = [{ id: crypto.randomUUID(), title: "FICTIONAL_TITLE", url: "https://example.test", username: "FICTIONAL_USERNAME", password: "FICTIONAL_PASSWORD" }];
try {
  const reference = await saveCloudVault({ ...args, localKey, entries }), path = "/fictional-bucket/" + reference.object, record = JSON.parse(objects.get(path));
  assert.equal(record.format, "qvault-passwords-v2");
  assert.deepEqual(await loadCloudVault({ ...args, localKey, reference }), entries);
  const blob = seen.at(-1);
  assert.equal(blob.length, 60);
  const cipher = Buffer.from(record.ciphertext, "base64"), nonce = Buffer.from(record.nonce, "base64");
  for (const offset of [0, 12, 28]) {
    const guess = await crypto.subtle.importKey("raw", blob.subarray(offset, offset + 32), "AES-GCM", false, ["decrypt"]);
    for (const format of ["qvault-passwords-v1", "qvault-passwords-v2"]) await assert.rejects(() => crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: new TextEncoder().encode(JSON.stringify({ format, profileId, keyId, object: reference.object })) }, guess, cipher));
  }
  await assert.rejects(() => loadCloudVault({ ...args, reference }), /local vault key/);
  await assert.rejects(() => loadCloudVault({ ...args, localKey: key(), reference }), /local vault key/);
  await assert.rejects(() => loadCloudVault({ ...args, localKey: "not-base64!", reference }), /local vault key/);
  await assert.rejects(() => saveCloudVault({ ...args, localKey: Buffer.alloc(16).toString("base64"), entries }), /local vault key/);
  const moved = "qvault/" + profileId + "/" + crypto.randomUUID() + ".json";
  objects.set("/fictional-bucket/" + moved, objects.get(path));
  await assert.rejects(() => loadCloudVault({ ...args, localKey, reference: { object: moved } }));
  const legacy = await saveCloudVault({ ...args, entries });
  assert.equal(JSON.parse(objects.get("/fictional-bucket/" + legacy.object)).format, "qvault-passwords-v1");
  assert.deepEqual(await loadCloudVault({ ...args, reference: legacy }), entries);
  await assert.rejects(() => loadCloudVault({ ...args, localKey, reference: legacy }), /not protected by the local vault key/);
  const payload = { keyId, credentials, localKey }, handle = { profileId };
  for (const session of [new SyncSession({ payload, handle, peer }), new SingleDeviceSession({ payload, handle, peer })]) assert.equal(session.args().localKey, localKey);
  {
    const one = "qvault/fixture/one.json", two = "qvault/fixture/two.json";
    let latest = { object: one };
    const loaded = [], stored = [], realHandle = await fixtureKey("FICTIONAL-MASTER-PASSWORD");
    const s = new SingleDeviceSession({ payload: { ...payload, sync: void 0, vault: { object: one } }, handle: realHandle, peer, transport: { latestSnapshot: async () => latest }, load: async (o) => {
      loaded.push(o.reference.object);
      return [{ id: o.reference.object }];
    }, store: { save: async (record2, revision) => stored.push(revision) }, recordRevision: "fixture-revision", withMpc: (fn, signal) => fn(peer, signal), check() {
    } });
    await s.init();
    assert.deepEqual(loaded, [one]);
    assert.equal(stored.length, 0);
    await s.sync();
    assert.deepEqual(loaded, [one], "nothing is downloaded again while the cloud copy is unchanged");
    latest = { object: two };
    const entries2 = await s.sync();
    assert.deepEqual(loaded, [one, two]);
    assert.equal(entries2[0].id, two);
    assert.equal(s.payload.vault.object, two);
    assert.deepEqual(stored, ["fixture-revision"]);
  }
  assert.equal(new SyncSession({ payload: { keyId, credentials }, handle, peer }).args().localKey, void 0);
  const participant = (id) => ({ version: 1, keyId, sidecarId: id, entries: [["identity", Buffer.from(JSON.stringify({ sidecarId: id, ...Object.fromEntries(["identityPrivateX448", "identityPublicX448", "signedPreKeyPrivateX448", "signedPreKeyPublicX448", "signingPrivateEd448", "signingPublicEd448", "preKeySignature"].map((k) => [k, "ab".repeat(57)])) })).toString("base64")], ["keyshare/" + keyId, Buffer.from(JSON.stringify({ n: Buffer.alloc(256, 195).toString("base64"), e: "AQAB", dShare: "AQ==" })).toString("base64")]] });
  const base = { version: 1, credentials, keyId, participants: [participant("a".repeat(32)), participant("b".repeat(32))] };
  assert.ok(validateProfilePayload({ ...base }));
  assert.ok(validateProfilePayload({ ...base, localKey }));
  for (const bad of ["", Buffer.alloc(16).toString("base64"), Buffer.alloc(33).toString("base64"), "%%%", 42, null]) assert.throws(() => validateProfilePayload({ ...base, localKey: bad }), /Invalid protected profile/);
  console.log("PASS LOCAL: snapshots of a profile with a local vault key use the v2 format; the key service receives only a locally wrapped 60-byte blob that cannot open the snapshot; a missing, wrong or malformed local key, a moved object and an old-format downgrade are all rejected; old profiles without a local key keep working; sessions pass the key through; profile validation enforces 32 bytes. Real RSA-OAEP/AES-GCM, mocked QKMS/HTTP.");
} finally {
  globalThis.fetch = originalFetch;
}
/*! Bundled license information:

aws4fetch/dist/aws4fetch.esm.mjs:
  (**
   * @license MIT <https://opensource.org/licenses/MIT>
   * @copyright Michael Hart 2024
   *)
*/
