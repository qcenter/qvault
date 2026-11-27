// tests/snapshot-discovery-source.js
import assert from "node:assert/strict";

// src/snapshot-discovery.js
function field(xml, name) {
  const matches = [...xml.matchAll(new RegExp("<" + name + ">([\\s\\S]*?)</" + name + ">", "g"))];
  if (matches.length !== 1) throw Error("Invalid cloud snapshot listing");
  return matches[0][1].replace(/&(?:amp|lt|gt|quot|apos);/g, (e) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" })[e]).replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (_, h, d) => String.fromCodePoint(parseInt(h || d, h ? 16 : 10)));
}
function parseSnapshotPage(xml, profileId2) {
  if (xml.length > 4 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml) || !/<ListBucketResult(?:\s[^>]*)?>/.test(xml) || !/<\/ListBucketResult>\s*$/.test(xml)) throw Error("Invalid cloud snapshot listing");
  const prefix2 = "qvault/" + profileId2 + "/", items = [];
  for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const key = field(match[1], "Key");
    if (!key.startsWith(prefix2)) throw Error("Cloud listing returned another vault");
    if (!/^[a-f0-9-]{36}\.json$/.test(key.slice(prefix2.length))) continue;
    const modified = Date.parse(field(match[1], "LastModified"));
    if (!Number.isFinite(modified)) throw Error("Invalid cloud snapshot date");
    items.push({ object: key, modified });
  }
  const truncated = field(xml, "IsTruncated");
  if (!["true", "false"].includes(truncated)) throw Error("Invalid cloud snapshot listing");
  return { items, next: truncated === "true" ? field(xml, "NextContinuationToken") : null };
}
async function listSnapshots({ requestPage, profileId: profileId2, signal }) {
  let token = null;
  const items = [], seen = /* @__PURE__ */ new Set(), tokens = /* @__PURE__ */ new Set();
  do {
    if (signal?.aborted) throw Error("Vault locked");
    const page2 = parseSnapshotPage(await requestPage(token), profileId2);
    for (const item2 of page2.items) {
      if (seen.has(item2.object)) continue;
      seen.add(item2.object);
      if (items.length >= 1e4) throw Error("Too many cloud snapshots. Recovery needs review.");
      items.push(item2);
    }
    token = page2.next;
    if (token) {
      if (tokens.has(token) || tokens.size >= 100) throw Error("Invalid cloud snapshot pagination");
      tokens.add(token);
    }
  } while (token);
  return items;
}
async function discoverSnapshot({ requestPage, profileId: profileId2, reference, signal }) {
  const items = await listSnapshots({ requestPage, profileId: profileId2, signal });
  let latest = null, tied = false;
  for (const item2 of items) {
    if (!latest || item2.modified > latest.modified) {
      latest = item2;
      tied = false;
    } else if (item2.modified === latest.modified) tied = true;
  }
  if (tied) throw Error("Several cloud snapshots have the same date. Recovery needs review; no snapshot was selected.");
  if (reference && !items.some((item2) => item2.object === reference.object)) throw Error("Saved cloud snapshot is missing from the listing. Your profile was not changed.");
  return latest ? { object: latest.object } : null;
}

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
      const fetched2 = fetch(await this.sign(input, init));
      if (i === this.retries) {
        return fetched2;
      }
      const res = await fetched2;
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
var toBase64 = (b2) => {
  let s = "";
  for (const n of b2) s += String.fromCharCode(n);
  return btoa(s);
};
function fromBase64(s, max = MAX) {
  if (typeof s !== "string" || s.length > max * 2 || !s.length || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw Error("Invalid encrypted profile");
  const b2 = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  if (b2.length > max) throw Error("Oversized encrypted profile");
  return b2;
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
  constructor({ credentials: credentials2, profileId: profileId2, keyId, handle, fetcher, now = () => Date.now(), leaseWaitMs = 6e4, leaseTtlMs = 3e5, operationMs = 12e4 }) {
    if (!/^[a-f0-9-]{36}$/.test(profileId2)) throw Error("Invalid sync profile");
    Object.assign(this, { credentials: credentials2, profileId: profileId2, keyId, handle, now, leaseWaitMs, leaseTtlMs, operationMs });
    this.prefix = "qvault/" + profileId2 + "/sync/v1/";
    this.fetcher = fetcher || new AwsClient({ accessKeyId: credentials2.accessKey, secretAccessKey: credentials2.secretKey, service: "s3", region: credentials2.region, retries: 0 });
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
    const victims = items.sort((a2, b2) => b2.modified - a2.modified || a2.object.localeCompare(b2.object)).slice(keep).filter((i) => i.modified < cutoff && !safe.has(i.object)).reverse().slice(0, maxDeletes);
    let deleted = 0;
    for (const item2 of victims) {
      let r;
      try {
        r = await this.deleteSnapshot(item2.object, signal);
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

// tests/snapshot-discovery-source.js
var profileId = crypto.randomUUID();
var prefix = "qvault/" + profileId + "/";
var a = prefix + crypto.randomUUID() + ".json";
var b = prefix + crypto.randomUUID() + ".json";
var item = (key, date) => `<Contents><Key>${key}</Key><LastModified>${date}</LastModified></Contents>`;
var page = (items, next) => `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${items}<IsTruncated>${!!next}</IsTruncated>${next ? "<NextContinuationToken>" + next + "</NextContinuationToken>" : ""}</ListBucketResult>`;
var calls = [];
var args = { profileId, reference: { object: a }, requestPage: async (token) => {
  calls.push(token);
  return token ? page(item(b, "2026-01-02T00:00:00Z")) : page(item(a, "2026-01-01T00:00:00Z") + item(prefix + "sync/v1/head.json", "2026-02-01T00:00:00Z"), "next&amp;page");
} };
assert.deepEqual(await discoverSnapshot(args), { object: b });
assert.deepEqual(calls, [null, "next&page"]);
assert.deepEqual(await discoverSnapshot({ ...args, reference: null }), { object: b });
assert.equal(await discoverSnapshot({ profileId, requestPage: async () => page("") }), null);
await assert.rejects(() => discoverSnapshot({ ...args, requestPage: async () => page("") }), /missing/);
await assert.rejects(() => discoverSnapshot({ ...args, requestPage: async () => page(item(a, "2026-01-01T00:00:00Z") + item(b, "2026-01-01T00:00:00Z")) }), /same date/);
await assert.rejects(() => discoverSnapshot({ ...args, requestPage: async () => page(item(a, "2026-01-01T00:00:00Z"), "repeat") }), /pagination/);
assert.throws(() => parseSnapshotPage(page(item("qvault/" + crypto.randomUUID() + "/x.json", "2026-01-01")), profileId), /another vault/);
assert.throws(() => parseSnapshotPage("<!DOCTYPE x>" + page(""), profileId), /Invalid/);
await assert.rejects(() => discoverSnapshot({ ...args, requestPage: async () => {
  throw Error("HTTP 403");
} }), /403/);
console.log("PASS LOCAL: paginated snapshot discovery, old/empty-backup recovery, metadata exclusion, missing-snapshot/tie/pagination/foreign-prefix rejection. Synthetic listings only; no live service.");
var credentials = { bucket: "fictional-bucket", region: "q-world-1", accessKey: "FICTIONAL", secretKey: "FICTIONAL" };
var fetched;
var transport = new SyncTransport({ credentials, profileId, keyId: "fictional-key", fetcher: { fetch: async (url, options) => {
  fetched = { url: new URL(url), options };
  return new Response(page(item(a, "2026-01-01T00:00:00Z")));
} } });
assert.deepEqual(await transport.latestSnapshot(null), { object: a });
assert.equal(fetched.url.searchParams.get("prefix"), prefix);
assert.equal(fetched.url.searchParams.get("list-type"), "2");
assert.equal(fetched.options.cache, "no-store");
transport.fetcher.fetch = async () => new Response("", { status: 403 });
await assert.rejects(() => transport.latestSnapshot(null), /cannot list/);
/*! Bundled license information:

aws4fetch/dist/aws4fetch.esm.mjs:
  (**
   * @license MIT <https://opensource.org/licenses/MIT>
   * @copyright Michael Hart 2024
   *)
*/
