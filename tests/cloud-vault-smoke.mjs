// tests/cloud-vault-source.js
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
async function hmac(key, string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    typeof key === "string" ? encoder.encode(key) : key,
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

// src/cloud-vault.js
var FORMAT = "qvault-passwords-v1";
var FORMAT2 = "qvault-passwords-v2";
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
var wrapAad = (profileId2, keyId2, object) => enc.encode(JSON.stringify({ format: FORMAT2, purpose: "key-wrap", profileId: profileId2, keyId: keyId2, object }));
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
async function saveCloudVault({ credentials: credentials2, profileId: profileId2, keyId: keyId2, entries: entries2, peer: peer2, signal, localKey, cache, check = () => {
} }) {
  validateEntries(entries2);
  const object = "qvault/" + profileId2 + "/" + crypto.randomUUID() + ".json";
  const bytes = enc.encode(JSON.stringify({ version: 1, entries: entries2 }));
  if (bytes.length > MAX2) throw Error("Password collection is too large");
  const keyBytes = crypto.getRandomValues(new Uint8Array(32)), nonce = crypto.getRandomValues(new Uint8Array(12));
  const format = localKey === void 0 ? FORMAT : FORMAT2;
  let inner = null;
  try {
    check();
    if (format === FORMAT2) {
      const local = await importLocalKey(localKey, "encrypt"), wrapNonce = crypto.getRandomValues(new Uint8Array(12));
      inner = new Uint8Array(60);
      inner.set(wrapNonce);
      inner.set(new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: wrapNonce, additionalData: wrapAad(profileId2, keyId2, object) }, local, keyBytes)), 12);
      check();
    }
    const wrapped = await peer2.call("encrypt", { keyId: keyId2, value: toBase64(inner || keyBytes) });
    check();
    if (typeof wrapped.CiphertextBlob !== "string") throw Error("QKMS returned no wrapped key");
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad(profileId2, keyId2, object, format) }, key, bytes));
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
async function loadCloudVault({ credentials: credentials2, profileId: profileId2, keyId: keyId2, reference, peer: peer2, signal, localKey, cache, check = () => {
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
      return await openSnapshot(local, { profileId: profileId2, keyId: keyId2, reference, peer: peer2, localKey, check });
    } catch {
      check();
    }
  }
  const text = await download(), entries2 = await openSnapshot(text, { profileId: profileId2, keyId: keyId2, reference, peer: peer2, localKey, check });
  await remember(cache, reference.object, text);
  return entries2;
}
async function openSnapshot(text, { profileId: profileId2, keyId: keyId2, reference, peer: peer2, localKey, check }) {
  const record = JSON.parse(text);
  const v2 = record.format === FORMAT2;
  if (localKey !== void 0 && record.format === FORMAT) throw Error("This cloud snapshot is not protected by the local vault key. It was rejected.");
  if (v2 && localKey === void 0) throw Error("This cloud snapshot needs the local vault key from its profile.");
  if (!v2 && record.format !== FORMAT || record.profileId !== profileId2 || record.keyId !== keyId2 || typeof record.wrappedKey !== "string" || record.wrappedKey.length > 16384) throw Error("Unexpected cloud vault");
  const nonce = fromBase64(record.nonce, 12);
  if (nonce.length !== 12) throw Error("Invalid cloud vault nonce");
  const local = v2 ? await importLocalKey(localKey, "decrypt") : null;
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
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
    bytes = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: aad(profileId2, keyId2, reference.object, record.format) }, key, fromBase64(record.ciphertext, MAX2 + 16)));
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

// tests/cloud-vault-source.js
var originalFetch = globalThis.fetch;
var objects = /* @__PURE__ */ new Map();
var requests = [];
var profileId = crypto.randomUUID();
var keyId = "fictional-key";
var credentials = { accessKey: "FICTIONAL_ACCESS", secretKey: "FICTIONAL_SECRET", region: "q-world-1", bucket: "fictional-bucket" };
var pair = await crypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, false, ["encrypt", "decrypt"]);
var peer = { call: async (action, m) => {
  assert.equal(m.keyId, keyId);
  if (action === "encrypt") return { CiphertextBlob: Buffer.from(await crypto.subtle.encrypt({ name: "RSA-OAEP" }, pair.publicKey, Buffer.from(m.value, "base64"))).toString("base64") };
  if (action === "decrypt") return { Plaintext: Buffer.from(await crypto.subtle.decrypt({ name: "RSA-OAEP" }, pair.privateKey, Buffer.from(m.value, "base64"))).toString("base64") };
  throw Error("Unexpected RPC");
} };
globalThis.fetch = async (input) => {
  const request = input instanceof Request ? input : new Request(input);
  requests.push(request.method);
  assert.equal(new URL(request.url).host, "qstorage.quilibrium.com");
  assert.ok(request.headers.has("authorization"));
  const path = new URL(request.url).pathname;
  if (request.method === "PUT") {
    assert.equal(request.headers.get("if-none-match"), "*");
    assert.ok(!objects.has(path));
    objects.set(path, await request.text());
    return new Response("");
  }
  if (request.method === "GET") return objects.has(path) ? new Response(objects.get(path)) : new Response("", { status: 404 });
  throw Error("Unexpected storage request");
};
var args = { credentials, profileId, keyId, peer, signal: new AbortController().signal };
var entries = [{ id: crypto.randomUUID(), title: "FICTIONAL_TITLE", url: "https://example.test", username: "FICTIONAL_USERNAME", password: "FICTIONAL_PASSWORD" }];
try {
  const first = await saveCloudVault({ ...args, entries });
  assert.deepEqual(await loadCloudVault({ ...args, reference: first }), entries);
  for (const raw of objects.values()) for (const secret of ["FICTIONAL_TITLE", "FICTIONAL_USERNAME", "FICTIONAL_PASSWORD", "FICTIONAL_SECRET"]) assert.ok(!raw.includes(secret));
  const second = await saveCloudVault({ ...args, entries: [] });
  assert.notEqual(first.object, second.object);
  assert.deepEqual(await loadCloudVault({ ...args, reference: second }), []);
  assert.deepEqual(await loadCloudVault({ ...args, reference: first }), entries);
  const path = "/fictional-bucket/" + first.object, original = objects.get(path), damaged = JSON.parse(original);
  damaged.ciphertext = "AAAA" + damaged.ciphertext.slice(4);
  objects.set(path, JSON.stringify(damaged));
  await assert.rejects(() => loadCloudVault({ ...args, reference: first }));
  objects.set(path, original);
  await assert.rejects(() => loadCloudVault({ ...args, reference: { object: "qvault-main/snapshots/fictional.json" } }), /reference/);
  const traversal = requests.length;
  for (const object of ["qvault/" + profileId + "/../" + profileId + "/x.json", "qvault/" + profileId + "/../../other-bucket/x.json", "qvault/" + profileId + "//x.json", "qvault/" + profileId + "/./x.json"]) await assert.rejects(() => loadCloudVault({ ...args, reference: { object } }), /reference/);
  assert.equal(requests.length, traversal);
  const before = requests.length;
  await assert.rejects(() => saveCloudVault({ ...args, entries, check: () => {
    throw Error("Session stopped.");
  } }), /stopped/);
  assert.equal(requests.length, before);
  assert.throws(() => validateEntries([{ ...entries[0], url: "javascript:alert(1)" }]), /HTTPS/);
  assert.throws(() => validateEntries([entries[0], entries[0]]), /Invalid/);
  const passwords = new Set(Array.from({ length: 50 }, () => generatePassword()));
  assert.equal(passwords.size, 50);
  for (const p of passwords) {
    assert.equal(p.length, 24);
    assert.match(p, /^[A-Za-z0-9!@#$%*_-]+$/);
  }
  console.log("PASS LOCAL: actual RSA-OAEP + AES-GCM encrypted save/read, signed immutable QStorage requests, old-snapshot preservation, plaintext absence, tamper/path rejection, cancellation before writes and generator validation. Mocked QKMS/HTTP only; no live service or real credentials.");
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
