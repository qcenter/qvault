// src/profile-crypto.js
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
  for (const field of ["identityPrivateX448", "identityPublicX448", "signedPreKeyPrivateX448", "signedPreKeyPublicX448", "signingPrivateEd448", "signingPublicEd448", "preKeySignature"]) if (typeof identity[field] !== "string" || !/^([a-f0-9]{2}){32,128}$/.test(identity[field])) throw Error("Incomplete saved participant identity");
  if (fromBase64(share.n, 512).length !== 256 || fromBase64(share.e, 8).length === 0 || fromBase64(share.dShare, 2048).length === 0) throw Error("Invalid saved RSA share");
  return map;
}
async function exportParticipant(storage2, sidecarId, keyId) {
  const entries = [];
  for (const k of ["identity", "keyshare/" + keyId]) {
    const bytes = await storage2.get(k);
    if (!bytes) throw Error("Participant share is not ready for protected saving");
    entries.push([k, toBase64(bytes)]);
  }
  const state = { version: 1, sidecarId, keyId, entries };
  validateParticipantState(state, keyId);
  return state;
}

// src/engine.js
import initRustPrimes, { generate_safe_prime } from "../vendor/rust-primes/qvault_rust_primes.js";

// src/rust-prepare.js
async function prepareWithRust({ init: init2, generate, api, progress = () => {
}, random = (bytes) => crypto.getRandomValues(bytes) }) {
  if (typeof api.rsa_dkg_prepare_rust !== "function") throw Error("Missing Go validator for Rust preparation");
  await init2();
  const factors = [];
  try {
    for (let i = 0; i < 2; i++) {
      progress("rust-safe-prime-" + (i + 1) + "-started");
      const seed = random(new Uint8Array(32));
      try {
        const factor = generate(seed);
        if (!(factor instanceof Uint8Array) || factor.length !== 128) throw Error("Invalid Rust prime output");
        factors.push(factor);
      } finally {
        seed.fill(0);
      }
      progress("rust-safe-prime-" + (i + 1) + "-finished");
    }
    const encode = (bytes) => btoa(String.fromCharCode(...bytes));
    const result = JSON.parse(api.rsa_dkg_prepare_rust(JSON.stringify({ p: encode(factors[0]), q: encode(factors[1]) })));
    if (result.ready !== true) throw Error("Rust factors rejected by Go validation");
    return { ready: true, keySize: 2048 };
  } finally {
    for (const f of factors) f.fill(0);
  }
}

// src/qkms-error.js
function qkmsErrorText(e) {
  let type = "", reason = "";
  try {
    const body = JSON.parse(e.body || "{}"), candidate = body.__type, message = body.message ?? body.Message;
    if (typeof candidate === "string" && /^[A-Za-z0-9_#:.]{1,80}$/.test(candidate)) type = " " + candidate;
    if (typeof message === "string") {
      const plain = message.replace(/[^\w .,:;()\/#'-]/g, "").trim().slice(0, 200);
      if (plain) reason = ": " + plain;
    }
  } catch {
  }
  return "QKMS HTTP " + e.status + (typeof e.method === "string" ? " (" + e.method + ")" : "") + type + reason;
}

// upstream/sdk-core/sigv4.ts
var ALGORITHM = "AWS4-HMAC-SHA256";
var SERVICE_NAME = "kms";
var SIGNED_HEADERS = "content-type;host;x-amz-date;x-amz-target";
var TERMINATION_KEY = "aws4_request";
function getSubtle() {
  const c = globalThis.crypto;
  if (!c?.subtle) {
    throw new Error("Web Crypto API (crypto.subtle) is not available in this environment");
  }
  return c.subtle;
}
var textEncoder = new TextEncoder();
function toHex(bytes) {
  const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  let s = "";
  for (let i = 0; i < view.length; i++) {
    s += view[i].toString(16).padStart(2, "0");
  }
  return s;
}
async function sha256Hex(data2) {
  const subtle = getSubtle();
  const buf = typeof data2 === "string" ? textEncoder.encode(data2) : data2;
  const digest = await subtle.digest("SHA-256", buf);
  return toHex(digest);
}
async function hmacSha256(key, data2) {
  const subtle = getSubtle();
  const cryptoKey = await subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const buf = typeof data2 === "string" ? textEncoder.encode(data2) : data2;
  const sig = await subtle.sign("HMAC", cryptoKey, buf);
  return new Uint8Array(sig);
}
function formatAmzDate(d) {
  const yyyy = d.getUTCFullYear().toString().padStart(4, "0");
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = d.getUTCDate().toString().padStart(2, "0");
  const hh = d.getUTCHours().toString().padStart(2, "0");
  const mi = d.getUTCMinutes().toString().padStart(2, "0");
  const ss = d.getUTCSeconds().toString().padStart(2, "0");
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z`;
}
function formatDateStamp(d) {
  const yyyy = d.getUTCFullYear().toString().padStart(4, "0");
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = d.getUTCDate().toString().padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}
function awsUrlEncode(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()).replace(/\+/g, "%20");
}
function buildCanonicalQueryString(searchParams) {
  const names = [];
  searchParams.forEach((_v, name) => {
    if (!names.includes(name)) names.push(name);
  });
  names.sort();
  const parts = [];
  for (const name of names) {
    const values = searchParams.getAll(name).slice().sort();
    for (const v of values) {
      parts.push(`${awsUrlEncode(name)}=${awsUrlEncode(v)}`);
    }
  }
  return parts.join("&");
}
async function createCanonicalRequest(method, path, searchParams, headers, body) {
  const canonicalUri = path === "" ? "/" : path;
  const canonicalQueryString = buildCanonicalQueryString(searchParams);
  const headerOrder = SIGNED_HEADERS.split(";");
  let canonicalHeaders = "";
  for (const h of headerOrder) {
    const value = (headers.get(h) ?? "").trim();
    canonicalHeaders += `${h}:${value}
`;
  }
  const payloadHash = await sha256Hex(body);
  return [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    SIGNED_HEADERS,
    payloadHash
  ].join("\n");
}
async function createStringToSign(amzDate, credentialScope, canonicalRequest) {
  const hashedRequest = await sha256Hex(canonicalRequest);
  return [ALGORITHM, amzDate, credentialScope, hashedRequest].join("\n");
}
async function calculateSignature(secretAccessKey, dateStamp, region, stringToSign) {
  const kDate = await hmacSha256(textEncoder.encode(`AWS4${secretAccessKey}`), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, SERVICE_NAME);
  const kSigning = await hmacSha256(kService, TERMINATION_KEY);
  const sig = await hmacSha256(kSigning, stringToSign);
  return toHex(sig);
}
var SigV4Signer = class {
  accessKeyId;
  secretAccessKey;
  region;
  constructor(cfg) {
    if (!cfg.accessKeyId) throw new Error("accessKeyId is required");
    if (!cfg.secretAccessKey) throw new Error("secretAccessKey is required");
    this.accessKeyId = cfg.accessKeyId;
    this.secretAccessKey = cfg.secretAccessKey;
    this.region = cfg.region ?? "us-east-1";
  }
  /**
   * Adds AWS Signature Version 4 authentication headers to the given request.
   * Mutates the supplied Headers object in place. Mirrors SignRequest in sigv4.go:45.
   *
   * The caller must ensure that:
   * - `headers` already has `x-amz-target` set to e.g. `TrentService.Sign`
   * - `body` is the exact byte sequence that will be sent on the wire
   * - `url` is the absolute request URL
   */
  async signRequest(method, url, headers, body) {
    const t = /* @__PURE__ */ new Date();
    const amzDate = formatAmzDate(t);
    const dateStamp = formatDateStamp(t);
    const parsed = new URL(url);
    headers.set("x-amz-date", amzDate);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    if (!headers.has("host")) {
      headers.set("host", parsed.host);
    }
    const canonicalRequest = await createCanonicalRequest(
      method.toUpperCase(),
      parsed.pathname || "/",
      parsed.searchParams,
      headers,
      body
    );
    const credentialScope = `${dateStamp}/${this.region}/${SERVICE_NAME}/${TERMINATION_KEY}`;
    const stringToSign = await createStringToSign(amzDate, credentialScope, canonicalRequest);
    const signature = await calculateSignature(
      this.secretAccessKey,
      dateStamp,
      this.region,
      stringToSign
    );
    const authHeader = `${ALGORITHM} Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${SIGNED_HEADERS}, Signature=${signature}`;
    headers.set("authorization", authHeader);
  }
};

// upstream/sdk-core/client.ts
var QkmsRpcClient = class {
  server;
  signer;
  endpoint;
  constructor(config) {
    if (!config.server) throw new Error("server is required");
    this.server = config.server.replace(/\/+$/, "");
    this.endpoint = `${this.server}/`;
    this.signer = new SigV4Signer({
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
      region: config.region
    });
  }
  /**
   * Generic typed RPC dispatch. Most callers should use the typed wrappers below.
   * `query` lets callers append signed query parameters (e.g. `?async=1` for
   * non-blocking CreateKey). The signer includes the canonical query string
   * in the SigV4 hash so they're authenticated.
   */
  async call(method, request, query) {
    const body = new TextEncoder().encode(JSON.stringify(request));
    const headers = new Headers({
      // Match the Go sidecar exactly (qkms/cmd/mpc-sidecar/main.go:4794) so
      // canonical request hashes line up with the QNZM validator.
      "content-type": "application/json",
      "x-amz-target": `TrentService.${method}`
    });
    let url = this.endpoint;
    if (query && Object.keys(query).length > 0) {
      const sp = new URLSearchParams(query);
      url = `${this.endpoint}?${sp.toString()}`;
    }
    await this.signer.signRequest("POST", url, headers, body);
    const res = await fetch(url, {
      method: "POST",
      headers,
      body
    });
    if (!res.ok) {
      let errBody;
      try {
        errBody = await res.text();
      } catch {
        errBody = "<unreadable>";
      }
      throw new QkmsRpcError(method, res.status, errBody);
    }
    const text = await res.text();
    if (!text) return {};
    return JSON.parse(text);
  }
  // ---------------------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------------------
  registerSidecar(req) {
    return this.call("RegisterSidecar", req);
  }
  getSidecar(sidecarId) {
    return this.call("GetSidecar", { SidecarId: sidecarId });
  }
  // ---------------------------------------------------------------------------
  // Tasks
  // ---------------------------------------------------------------------------
  listTasks(req = {}) {
    return this.call("ListTasks", req);
  }
  listTasksForSidecar(req) {
    return this.call("ListTasksForSidecar", req);
  }
  claimTask(req) {
    return this.call("ClaimTask", req);
  }
  updateTask(req) {
    return this.call("UpdateTask", req);
  }
  sendPartyMessage(req) {
    return this.call("SendPartyMessage", req);
  }
  getPartyMessages(req) {
    return this.call("GetPartyMessages", req);
  }
  // ---------------------------------------------------------------------------
  // Keys
  // ---------------------------------------------------------------------------
  /**
   * Create an MPC-backed key. By default this blocks until DKG completes.
   * Pass `async: true` to make the server return immediately after the task
   * is created — the response carries the new `KeyId` and the caller polls
   * `getPublicKey` (or watches local storage) to detect completion.
   *
   * Async mode is the right shape for browser callers behind CDNs/WAFs
   * whose proxy timeouts would otherwise kill the long-held HTTP socket.
   */
  createKey(req, opts) {
    const query = opts?.async ? { async: "1" } : void 0;
    return this.call("CreateKey", req, query);
  }
  sign(req) {
    return this.call("Sign", req);
  }
  getPublicKey(req) {
    return this.call("GetPublicKey", req);
  }
};
var QkmsRpcError = class extends Error {
  constructor(method, status, body) {
    super(`QKMS RPC ${method} failed: ${status} ${body}`);
    this.method = method;
    this.status = status;
    this.body = body;
    this.name = "QkmsRpcError";
  }
};

// upstream/sdk-core/sidecar/dispatch.ts
var TaskDispatcher = class {
  sessions = [];
  /** Cache: `${taskId}:${round}` → submitted, prevents reprocessing on re-poll. */
  submittedRounds = /* @__PURE__ */ new Set();
  /** Tasks we've already claimed (2-of-2 mode). */
  claimedTasks = /* @__PURE__ */ new Set();
  register(session) {
    this.sessions.push(session);
  }
  /** Dispatch one task. Returns true if a session handled it. */
  async dispatch(task, ctx) {
    const cacheKey = `${task.TaskId}:${task.Round}`;
    if (this.submittedRounds.has(cacheKey) && !this.sessions.some((s) => s.canHandle(task) && s.canRevisitSameRound?.(task) === true)) {
      return false;
    }
    for (const session of this.sessions) {
      if (session.canHandle(task)) {
        await session.process(task, ctx);
        this.submittedRounds.add(cacheKey);
        return true;
      }
    }
    return false;
  }
  /** Drop cache entries for a completed task to bound memory growth. */
  forgetTask(taskId) {
    for (const k of this.submittedRounds) {
      if (k.startsWith(`${taskId}:`)) this.submittedRounds.delete(k);
    }
  }
};

// upstream/sdk-core/sidecar/identity.ts
import * as channelwasm from "../vendor/channel/channelwasm.js";
var IDENTITY_KEY = "identity";
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
async function loadOrCreateIdentity(storage2) {
  const existing = await storage2.get(IDENTITY_KEY);
  if (existing) {
    const text = new TextDecoder().decode(existing);
    return JSON.parse(text);
  }
  const identity = await generateIdentity();
  await storage2.put(IDENTITY_KEY, new TextEncoder().encode(JSON.stringify(identity)));
  return identity;
}

// upstream/sdk-core/sidecar/peer-channel.ts
import * as channelwasm2 from "../vendor/channel/channelwasm.js";
var E2EE_ROUND_HELLO = 0;
var E2EE_ROUND_ACK = 1;
var E2EE_ROUND_PROTOCOL_START = 2;
function base64ToBytes2(b64) {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
var PeerChannel = class {
  // taskId:peerId:hello
  constructor(identity, options = {}) {
    this.options = options;
    this.identityPrivateX448 = hexToBytes(identity.identityPrivateX448);
    this.signedPreKeyPrivateX448 = hexToBytes(identity.signedPreKeyPrivateX448);
  }
  identityPrivateX448;
  signedPreKeyPrivateX448;
  sessions = /* @__PURE__ */ new Map();
  // peerId → ratchet state
  sessionReady = /* @__PURE__ */ new Set();
  helloSent = /* @__PURE__ */ new Set();
  // Task isolation is the default. The hosted compatibility probe explicitly
  // uses a live peer-scoped ratchet like the native sidecar; never persisted.
  scope(peerId, taskId) {
    return this.options.reuseAcrossTasks || !taskId ? peerId : `${taskId}:${peerId}`;
  }
  get sidecarId() {
    return "";
  }
  isReady(peerId, taskId) {
    return this.sessionReady.has(this.scope(peerId, taskId));
  }
  hasSession(peerId, taskId) {
    return this.sessions.has(this.scope(peerId, taskId));
  }
  // ---- Session establishment (X3DH) ----
  establishSession(peerId, isSender, peerIdentityKey, peerSignedPreKey, taskId) {
    const scope = this.scope(peerId, taskId);
    if (this.sessions.has(scope)) return;
    let sessionKeyB64;
    if (isSender) {
      const result = channelwasm2.js_sender_x3dh(JSON.stringify({
        sending_identity_private_key: Array.from(this.identityPrivateX448),
        sending_ephemeral_private_key: Array.from(this.signedPreKeyPrivateX448),
        receiving_identity_key: Array.from(peerIdentityKey),
        receiving_signed_pre_key: Array.from(peerSignedPreKey),
        session_key_length: 96
      }));
      sessionKeyB64 = JSON.parse(result);
    } else {
      const result = channelwasm2.js_receiver_x3dh(JSON.stringify({
        sending_identity_private_key: Array.from(this.identityPrivateX448),
        sending_signed_private_key: Array.from(this.signedPreKeyPrivateX448),
        receiving_identity_key: Array.from(peerIdentityKey),
        receiving_ephemeral_key: Array.from(peerSignedPreKey),
        session_key_length: 96
      }));
      sessionKeyB64 = JSON.parse(result);
    }
    const sessionKey = base64ToBytes2(sessionKeyB64);
    const state = channelwasm2.js_new_double_ratchet(JSON.stringify({
      session_key: Array.from(sessionKey.subarray(0, 32)),
      sending_header_key: Array.from(sessionKey.subarray(32, 64)),
      next_receiving_header_key: Array.from(sessionKey.subarray(64, 96)),
      is_sender: isSender,
      sending_ephemeral_private_key: Array.from(this.signedPreKeyPrivateX448),
      receiving_ephemeral_key: Array.from(peerSignedPreKey)
    }));
    this.sessions.set(scope, state);
  }
  // ---- Encrypt / Decrypt ----
  encrypt(peerId, plaintext, taskId) {
    const scope = this.scope(peerId, taskId);
    const state = this.sessions.get(scope);
    if (!state) throw new Error(`No E2EE session with ${peerId}`);
    const result = JSON.parse(channelwasm2.js_double_ratchet_encrypt(JSON.stringify({
      ratchet_state: state,
      message: Array.from(plaintext)
    })));
    this.sessions.set(scope, result.ratchet_state);
    return result.envelope;
  }
  decrypt(peerId, envelopeJson, taskId) {
    const scope = this.scope(peerId, taskId);
    const state = this.sessions.get(scope);
    if (!state) throw new Error(`No E2EE session with ${peerId}`);
    const result = JSON.parse(channelwasm2.js_double_ratchet_decrypt(JSON.stringify({
      ratchet_state: state,
      envelope: envelopeJson
    })));
    this.sessions.set(scope, result.ratchet_state);
    return Uint8Array.from(result.message);
  }
  // ---- Handshake protocol ----
  /**
   * Perform the E2EE handshake with a peer sidecar. This mirrors
   * ensureE2EESession in the Go sidecar.
   *
   * - The sender (lexicographically lower sidecar ID) initiates X3DH,
   *   sends an encrypted "hello" via SendPartyMessage (round 0).
   * - The receiver waits for the hello, establishes its side of X3DH,
   *   sends an encrypted "ack" via SendPartyMessage (round 1).
   * - Both sides mark the session as ready once the ack is exchanged.
   *
   * Returns true when the session is ready. May need multiple calls
   * (polling) to complete the handshake.
   */
  async performHandshake(client2, taskId, mySidecarId, myPartyId, peerId, peerPartyId, peerIdentity) {
    const taskSessionKey = this.scope(peerId, taskId);
    if (this.sessionReady.has(taskSessionKey)) return true;
    const isSender = mySidecarId < peerId;
    if (isSender) {
      return this.performSenderHandshake(client2, taskId, mySidecarId, myPartyId, peerId, peerPartyId, peerIdentity);
    } else {
      return this.performReceiverHandshake(client2, taskId, mySidecarId, myPartyId, peerId, peerPartyId, peerIdentity);
    }
  }
  /**
   * Sender side of the handshake. Idempotently sends `hello` (once per task)
   * and consults a pre-fetched ack pool for the matching peer's response.
   * Receives `helloByParty`/`ackByParty` from the orchestrator so each round's
   * `GetPartyMessages` is consumed only once per tick (server deletes on read).
   */
  async performSenderHandshake(client2, taskId, mySidecarId, myPartyId, peerId, peerPartyId, peerIdentity, ackMessages) {
    const helloKey = `${this.scope(peerId, taskId)}:hello`;
    if (!this.helloSent.has(helloKey)) {
      this.sessions.delete(this.scope(peerId, taskId));
      this.sessionReady.delete(this.scope(peerId, taskId));
      this.establishSession(peerId, true, peerIdentity.identityKey, peerIdentity.signedPreKey, taskId);
      const envelope = this.encrypt(peerId, new TextEncoder().encode("hello"), taskId);
      await client2.call("SendPartyMessage", {
        TaskId: taskId,
        SidecarId: mySidecarId,
        FromParty: myPartyId,
        ToParty: peerPartyId,
        Round: E2EE_ROUND_HELLO,
        Encrypted: true,
        Envelope: JSON.parse(envelope)
      });
      this.helloSent.add(helloKey);
    }
    if (ackMessages) {
      for (const msg of ackMessages) {
        if (msg.round !== E2EE_ROUND_ACK || !msg.encrypted) continue;
        try {
          const plaintext = this.decrypt(peerId, JSON.stringify(msg.envelope), taskId);
          if (new TextDecoder().decode(plaintext) === "ack") {
            this.sessionReady.add(this.scope(peerId, taskId));
            return true;
          }
        } catch (err) {
          console.warn(`[peer-channel] ack decrypt from party ${msg.fromParty} failed:`, err);
        }
      }
    }
    return false;
  }
  async performReceiverHandshake(client2, taskId, mySidecarId, myPartyId, peerId, peerPartyId, peerIdentity, helloMessages) {
    if (!helloMessages) return false;
    for (const msg of helloMessages) {
      if (msg.round !== E2EE_ROUND_HELLO || !msg.encrypted) continue;
      if (!this.hasSession(peerId, taskId)) {
        this.establishSession(peerId, false, peerIdentity.identityKey, peerIdentity.signedPreKey, taskId);
      }
      try {
        const plaintext = this.decrypt(peerId, JSON.stringify(msg.envelope), taskId);
        if (new TextDecoder().decode(plaintext) === "hello") {
          const ackEnvelope = this.encrypt(peerId, new TextEncoder().encode("ack"), taskId);
          await client2.call("SendPartyMessage", {
            TaskId: taskId,
            SidecarId: mySidecarId,
            FromParty: myPartyId,
            ToParty: peerPartyId,
            Round: E2EE_ROUND_ACK,
            Encrypted: true,
            Envelope: JSON.parse(ackEnvelope)
          });
          this.sessionReady.add(this.scope(peerId, taskId));
          return true;
        }
      } catch (err) {
        console.warn(`[peer-channel] hello decrypt from party ${msg.fromParty} failed:`, err);
      }
    }
    return false;
  }
  /**
   * Orchestrator-friendly variant: caller pre-fetches the round's messages
   * once per tick and passes the per-peer slice to avoid the consume-on-read
   * problem.
   */
  async performHandshakeWithMessages(client2, taskId, mySidecarId, myPartyId, peerId, peerPartyId, peerIdentity, helloMessages, ackMessages) {
    const taskSessionKey = this.scope(peerId, taskId);
    if (this.sessionReady.has(taskSessionKey)) return true;
    const isSender = mySidecarId < peerId;
    if (isSender) {
      return this.performSenderHandshake(client2, taskId, mySidecarId, myPartyId, peerId, peerPartyId, peerIdentity, ackMessages);
    } else {
      return this.performReceiverHandshake(client2, taskId, mySidecarId, myPartyId, peerId, peerPartyId, peerIdentity, helloMessages);
    }
  }
  // ---- Protocol messaging ----
  /**
   * Send an encrypted protocol message to a peer via SendPartyMessage.
   * The round is offset by E2EE_ROUND_PROTOCOL_START to avoid collision
   * with handshake rounds.
   */
  async sendMessage(client2, taskId, mySidecarId, myPartyId, peerId, peerPartyId, protocolRound, plaintext) {
    const envelope = this.encrypt(peerId, plaintext, taskId);
    await client2.call("SendPartyMessage", {
      TaskId: taskId,
      SidecarId: mySidecarId,
      FromParty: myPartyId,
      ToParty: peerPartyId,
      Round: protocolRound + E2EE_ROUND_PROTOCOL_START,
      Encrypted: true,
      Envelope: JSON.parse(envelope)
    });
  }
  /**
   * Collect and decrypt protocol messages from peers for a given round.
   * Returns a map of fromPartyId → decrypted plaintext.
   */
  async collectMessages(client2, taskId, mySidecarId, myPartyId, protocolRound, partyIdMap) {
    const resp = await client2.call(
      "GetPartyMessages",
      {
        TaskId: taskId,
        SidecarId: mySidecarId,
        ForParty: myPartyId,
        Round: protocolRound + E2EE_ROUND_PROTOCOL_START
      }
    );
    const partyToSidecar = /* @__PURE__ */ new Map();
    for (const [sid, pid] of Object.entries(partyIdMap)) {
      partyToSidecar.set(pid, sid);
    }
    const result = /* @__PURE__ */ new Map();
    for (const msg of resp.Messages ?? []) {
      const senderSidecarId = partyToSidecar.get(msg.fromParty);
      if (!senderSidecarId) continue;
      try {
        const plaintext = this.decrypt(senderSidecarId, JSON.stringify(msg.envelope), taskId);
        result.set(msg.fromParty, plaintext);
      } catch (err) {
        console.warn(`[peer-channel] decrypt failed from party ${msg.fromParty}:`, err);
      }
    }
    return result;
  }
  // ---- Peer identity fetching ----
  /**
   * Fetch a peer sidecar's identity keys from QKMS.
   */
  static async fetchPeerIdentity(client2, peerId) {
    const resp = await client2.call("GetSidecar", { SidecarId: peerId });
    return {
      identityKey: base64ToBytes2(resp.SidecarIdentity?.IdentityKey ?? resp.IdentityKey),
      signedPreKey: base64ToBytes2(resp.SidecarIdentity?.SignedPreKey ?? resp.SignedPreKey)
    };
  }
};

// upstream/sdk-core/sidecar/poll.ts
var PollLoop = class {
  running = false;
  timer = null;
  cfg;
  constructor(cfg) {
    this.cfg = cfg;
  }
  start() {
    if (this.running) return;
    this.running = true;
    this.scheduleNext(0);
  }
  stop() {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
  scheduleNext(delayMs) {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      void this.tick();
    }, delayMs);
  }
  async tick() {
    if (!this.running) return;
    try {
      const { Tasks } = this.cfg.useTofN ? await this.cfg.client.listTasksForSidecar({ SidecarId: this.cfg.identity.sidecarId }) : await this.cfg.client.listTasks({});
      if (!Array.isArray(Tasks)) throw new Error("Task list is missing Tasks");
      for (const raw of Tasks) {
        const task = normalizeTask(raw);
        if (this.cfg.acceptTask && !this.cfg.acceptTask(task)) continue;
        if (task.Status !== "AWAITING_CLIENT") continue;
        this.cfg.onProgress?.("task-found", task);
        const hasOthers = this.hasOtherSidecars(task);
        let peerChannel = this.cfg.peerChannel;
        if (this.cfg.peerChannel && hasOthers) {
          this.cfg.onProgress?.("checking-peer-handshake", task);
          const ready2 = await this.ensureE2EESessions(task);
          if (!ready2) {
            const operation = String(task.Operation ?? "").toLowerCase();
            if (this.cfg.operationsWithoutPeerSession === true && (operation === "sign" || operation === "decrypt")) {
              this.cfg.onProgress?.("operation-without-peer-session", task);
              peerChannel = void 0;
            } else {
              this.cfg.onProgress?.("waiting-for-peer-handshake", task);
              continue;
            }
          }
        }
        try {
          this.cfg.onProgress?.("protocol-computation-started", task);
          const dispatched = await this.cfg.dispatcher.dispatch(task, {
            client: this.cfg.client,
            identity: this.cfg.identity,
            sidecarId: this.cfg.identity.sidecarId,
            peerChannel
          });
          if (dispatched !== false) this.cfg.onProgress?.("protocol-contribution-submitted", task);
          else this.cfg.onProgress?.("protocol-dispatch-skipped", task);
        } catch (err) {
          console.error("[qkms-sdk] dispatch error:", task.TaskId, err);
          this.cfg.onError?.(err, task);
        }
      }
    } catch (err) {
      console.error("[qkms-sdk] poll error:", err);
      this.cfg.onError?.(err);
    } finally {
      this.scheduleNext(this.cfg.pollIntervalMs);
    }
  }
  /** Check if a task has other sidecars we need E2EE sessions with. */
  hasOtherSidecars(task) {
    const participants = task.Participants?.length ? task.Participants : Object.keys(task.PartyIdMap || {});
    if (!participants || participants.length <= 1) return false;
    for (const p of participants) {
      if (p !== this.cfg.identity.sidecarId && p !== "service") {
        return true;
      }
    }
    return false;
  }
  /**
   * Ensure E2EE sessions are established with all peer sidecars in the task.
   * Returns true when *every* peer session is ready.
   *
   * Two crucial constraints from how QKMS GetPartyMessages works:
   *   1. It DELETES messages on read (consume-on-retrieval). So we can't call
   *      it once per peer — that would consume messages destined for other
   *      peers and silently throw them away.
   *   2. Each peer's session has its own ratchet state; decrypting a msg from
   *      peer X with peer Y's key both throws AND corrupts Y's ratchet.
   *
   * Strategy: pre-fetch ALL hellos and ALL acks for this round once per tick,
   * partition by `fromParty`, then hand each peer its own slice via
   * `performHandshakeWithMessages`. Never bail on the first non-ready peer —
   * that causes a circular deadlock in t-of-n with n>2.
   */
  async ensureE2EESessions(task) {
    const pc = this.cfg.peerChannel;
    const partyIdMap = task.PartyIdMap ?? {};
    const myPartyId = partyIdMap[this.cfg.identity.sidecarId];
    if (!Number.isInteger(myPartyId) || myPartyId < 1) {
      this.cfg.onProgress?.("missing-party-map", task);
      throw new Error("Missing own party mapping");
    }
    const peers = [];
    for (const [peerId, peerPartyId] of Object.entries(partyIdMap)) {
      if (peerId === this.cfg.identity.sidecarId) continue;
      if (peerId === "service") continue;
      peers.push({ sidecarId: peerId, partyId: peerPartyId });
    }
    const pending = peers.filter((peer) => !pc.isReady?.(peer.sidecarId, task.TaskId));
    if (!pending.length) {
      this.cfg.onProgress?.("peer-session-already-ready", task);
      return true;
    }
    for (const peer of pending) {
      try {
        this.cfg.onProgress?.("fetching-peer-identity", task);
        peer.identity = await PeerChannel.fetchPeerIdentity(this.cfg.client, peer.sidecarId);
      } catch (err) {
        this.cfg.onProgress?.("peer-identity-failed", task);
        this.cfg.onError?.(err, task);
        return false;
      }
    }
    const helloByParty = /* @__PURE__ */ new Map();
    const ackByParty = /* @__PURE__ */ new Map();
    try {
      const helloResp = await this.cfg.client.call(
        "GetPartyMessages",
        { TaskId: task.TaskId, SidecarId: this.cfg.identity.sidecarId, ForParty: myPartyId, Round: 0 }
      );
      for (const msg of helloResp.Messages ?? []) {
        const list = helloByParty.get(msg.fromParty) ?? [];
        list.push(msg);
        helloByParty.set(msg.fromParty, list);
      }
    } catch (err) {
      this.cfg.onProgress?.("hello-message-request-failed", task);
      this.cfg.onError?.(err, task);
      return false;
    }
    try {
      const ackResp = await this.cfg.client.call(
        "GetPartyMessages",
        { TaskId: task.TaskId, SidecarId: this.cfg.identity.sidecarId, ForParty: myPartyId, Round: 1 }
      );
      for (const msg of ackResp.Messages ?? []) {
        const list = ackByParty.get(msg.fromParty) ?? [];
        list.push(msg);
        ackByParty.set(msg.fromParty, list);
      }
    } catch (err) {
      this.cfg.onProgress?.("ack-message-request-failed", task);
      this.cfg.onError?.(err, task);
      return false;
    }
    let allReady = true;
    for (const peer of pending) {
      if (!peer.identity) {
        allReady = false;
        continue;
      }
      try {
        this.cfg.onProgress?.("exchanging-peer-handshake", task);
        const ready2 = await pc.performHandshakeWithMessages(
          this.cfg.client,
          task.TaskId,
          this.cfg.identity.sidecarId,
          myPartyId,
          peer.sidecarId,
          peer.partyId,
          peer.identity,
          helloByParty.get(peer.partyId) ?? [],
          ackByParty.get(peer.partyId) ?? []
        );
        if (!ready2) allReady = false;
      } catch (err) {
        this.cfg.onProgress?.("peer-handshake-failed", task);
        this.cfg.onError?.(err, task);
        allReady = false;
      }
    }
    return allReady;
  }
};
function normalizeTask(task) {
  let sd = task.ServerData || {};
  if (typeof sd === "string") {
    try {
      sd = JSON.parse(sd);
    } catch {
      sd = {};
    }
  }
  const candidates = [task.PartyIdMap, task.PartyIDMap, sd.partyIDMap, sd.PartyIDMap, sd.partyIdMap];
  const mapping = candidates.find((m) => m && typeof m === "object" && !Array.isArray(m) && Object.keys(m).length > 0);
  if (!mapping) return task;
  const ids = Object.values(mapping);
  if (ids.some((x) => !Number.isInteger(x) || x < 1) || new Set(ids).size !== ids.length) throw new Error("Invalid party mapping");
  return { ...task, PartyIdMap: mapping, Participants: task.Participants?.length ? task.Participants : Object.keys(mapping) };
}

// upstream/sdk-core/sidecar/wasm-init.ts
import init from "../vendor/channel/channelwasm.js";
var ready;
function initAllWasm() {
  return ready || (ready = init());
}

// upstream/sdk-core/sidecar/index.ts
function hexToBase64(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
var DEFAULT_POLL_INTERVAL_MS = 250;
var Sidecar = class {
  client;
  storage;
  dispatcher;
  peerChannel = null;
  opts;
  identity = null;
  pollLoop = null;
  started = false;
  constructor(opts) {
    this.client = opts.client;
    this.storage = opts.storage;
    this.opts = opts;
    this.dispatcher = new TaskDispatcher();
    for (const s of opts.sessions ?? []) {
      this.dispatcher.register(s);
    }
  }
  /** Add a protocol session after construction. */
  registerSession(session) {
    this.dispatcher.register(session);
  }
  /** Returns the identity, loading or generating it on first call. */
  async getIdentity() {
    if (!this.identity) {
      this.identity = await loadOrCreateIdentity(this.storage);
    }
    return this.identity;
  }
  /** Sidecar id (X448 public key SHA-256 prefix, hex). */
  async getSidecarId() {
    const id = await this.getIdentity();
    return id.sidecarId;
  }
  /** Register the sidecar identity with the QKMS server. */
  async register() {
    const id = await this.getIdentity();
    await this.client.registerSidecar({
      SidecarId: id.sidecarId,
      IdentityKey: hexToBase64(id.identityPublicX448),
      SignedPreKey: hexToBase64(id.signedPreKeyPublicX448),
      PreKeySignature: hexToBase64(id.preKeySignature),
      SigningKey: hexToBase64(id.signingPublicEd448)
    });
  }
  /** Start polling. Loads identity, optionally registers, then begins poll loop. */
  async start() {
    if (this.started) return;
    await initAllWasm();
    const id = await this.getIdentity();
    this.peerChannel = new PeerChannel(id, { reuseAcrossTasks: this.opts.reusePeerSession === true });
    if (this.opts.autoRegister !== false) {
      try {
        await this.register();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/already registered|exists/i.test(msg)) {
          throw err;
        }
      }
    }
    this.pollLoop = new PollLoop({
      client: this.client,
      dispatcher: this.dispatcher,
      identity: id,
      peerChannel: this.peerChannel ?? void 0,
      pollIntervalMs: this.opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      onError: this.opts.onError,
      onProgress: this.opts.onProgress,
      acceptTask: this.opts.acceptTask,
      operationsWithoutPeerSession: this.opts.operationsWithoutPeerSession === true,
      useTofN: this.opts.useTofN ?? false
    });
    this.pollLoop.start();
    this.started = true;
  }
  stop() {
    if (!this.started) return;
    this.pollLoop?.stop();
    this.pollLoop = null;
    this.started = false;
  }
};

// upstream/sdk-core/sidecar/sessions/rsa.ts
import { loadMpcWasm } from "../vendor/mpc/loader.js";
function bytesToBase642(bytes) {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function base64ToBytes3(b64) {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function decodeWireBytes(value) {
  if (value == null) return new Uint8Array();
  if (typeof value === "string") return base64ToBytes3(value);
  if (Array.isArray(value)) return Uint8Array.from(value);
  throw new Error(`unexpected wire bytes: ${typeof value}`);
}
function parseServerData(task) {
  if (!task.ServerData) return {};
  if (typeof task.ServerData === "string") {
    try {
      return JSON.parse(task.ServerData);
    } catch {
      return {};
    }
  }
  return task.ServerData;
}
function extractPubKeyFromServerData(sd) {
  if (!sd.rsaPublicKey) return null;
  const n = sd.rsaPublicKey.n;
  const e = sd.rsaPublicKey.e;
  if (n == null || e == null) return null;
  return {
    nB64: bytesToBase642(decodeWireBytes(n)),
    eB64: bytesToBase642(decodeWireBytes(e))
  };
}
var RSASession = class {
  requirePrepared = false;
  /** Explicit synthetic-test opt-in: send secret share to hosted QKMS. */
  exportPrivateShareForTest = false;
  apiPromise = null;
  /** Cache completed DKG key shares so re-poll after completion is idempotent. */
  completedKeyShares = /* @__PURE__ */ new Map();
  /** Track which tasks we've initialized so DKG init isn't re-run on re-poll. */
  initializedDkgTasks = /* @__PURE__ */ new Set();
  /** Track sign tasks that have already emitted their partial (for idempotent re-poll). */
  initializedSignTasks = /* @__PURE__ */ new Set();
  rsaOperationState = /* @__PURE__ */ new Map();
  onKeyShareReady;
  loadKeyShare;
  async getApi() {
    if (!this.apiPromise) {
      this.apiPromise = loadMpcWasm();
    }
    return this.apiPromise;
  }
  canHandle(task) {
    const sd = parseServerData(task);
    const spec = task.KeySpec ?? sd.keySpec;
    if (["RSA_2048", "RSA_3072", "RSA_4096"].includes(spec ?? "")) return true;
    const proto = task.Protocol ?? sd.protocol;
    return typeof proto === "string" && ["rsa-n", "rsa-n-sign", "rsa-n-decrypt"].includes(proto.toLowerCase());
  }
  canRevisitSameRound(task) {
    return ["sign", "decrypt"].includes((task.Operation ?? "").toLowerCase());
  }
  async process(task, ctx) {
    const operation = (task.Operation ?? "").toLowerCase();
    if (operation === "createkey") {
      await this.processDKG(task, ctx);
    } else if (operation === "sign" || operation === "decrypt") {
      await this.processSignOrDecrypt(task, ctx, operation === "decrypt");
    } else {
      throw new Error(`RSASession: unsupported operation ${task.Operation}`);
    }
  }
  // ----- Sign / Decrypt ---------------------------------------------------
  async processSignOrDecrypt(task, ctx, isDecrypt) {
    const api = await this.getApi();
    const serverData = parseServerData(task);
    if (!task.KeyId) throw new Error("RSA sign: task missing KeyId");
    if (!this.loadKeyShare) {
      throw new Error("RSA sign: loadKeyShare resolver not set on session");
    }
    const keyShareJson = await this.loadKeyShare(task.KeyId);
    if (!keyShareJson) {
      throw new Error(`RSA sign: no key share for key ${task.KeyId}`);
    }
    const keyShare = JSON.parse(keyShareJson);
    let nB64 = keyShare.n;
    let eB64 = keyShare.e;
    if (!nB64 || !eB64) {
      const pub = extractPubKeyFromServerData(serverData);
      if (!pub) {
        throw new Error("RSA sign: key share missing N/E and serverData has no rsaPublicKey");
      }
      nB64 = pub.nB64;
      eB64 = pub.eB64;
    }
    const partyIdMap = serverData.partyIDMap ?? task.PartyIdMap ?? {};
    const originalMap = Object.keys(serverData.dkgPartyIDMap ?? {}).length ? serverData.dkgPartyIDMap : partyIdMap;
    const myPartyId = originalMap[ctx.sidecarId];
    const totalParties = serverData.thresholdConfig?.totalParties ?? Object.keys(originalMap).length;
    const currentPartyId = partyIdMap[ctx.sidecarId];
    if (!Number.isInteger(myPartyId) || myPartyId < 1 || !Number.isInteger(totalParties) || totalParties < 2 || myPartyId > totalParties || !Number.isInteger(currentPartyId) || currentPartyId < 1) throw new Error("RSA operation missing valid party configuration");
    const inputBytes = decodeWireBytes(isDecrypt ? serverData.ciphertext : serverData.message);
    if (inputBytes.length === 0) throw new Error("RSA operation missing input");
    let state = this.rsaOperationState.get(task.TaskId);
    if (!state) {
      const partial = parseWasmResponse(api.rsa_shoup_partial(JSON.stringify({ input: bytesToBase642(inputBytes), n: nB64, dShare: keyShare.dShare, totalParties })), "rsa_shoup_partial");
      state = { own: partial.partial, others: {}, sent: /* @__PURE__ */ new Set() };
      this.rsaOperationState.set(task.TaskId, state);
    }
    const protocol = isDecrypt ? "rsa-n-decrypt" : "rsa-n-sign";
    const partialPayload = { protocol, partyId: myPartyId, partialResult: state.own };
    if (ctx.peerChannel) {
      for (const [peerId, peerParty] of Object.entries(partyIdMap)) {
        if (peerId === ctx.sidecarId || state.sent.has(peerId)) continue;
        await ctx.peerChannel.sendMessage(ctx.client, task.TaskId, ctx.sidecarId, currentPartyId, peerId, peerParty, 0, new TextEncoder().encode(JSON.stringify(partialPayload)));
        state.sent.add(peerId);
      }
    }
    const accept = (raw, expected) => {
      const c = unwrapRsaOperationContribution(raw);
      if (!c || !Number.isInteger(c.partyId) || c.partyId === myPartyId || c.partyId < 1 || c.partyId > totalParties || c.partialResult == null) return;
      if (expected != null && c.partyId !== expected) throw new Error("RSA peer contribution has wrong original party id");
      const bytes = decodeWireBytes(c.partialResult);
      if (bytes.length === 0 || bytes.length > decodeWireBytes(nB64).length) throw new Error("RSA peer partial has invalid size");
      const encoded = bytesToBase642(bytes), previous = state.others[String(c.partyId)];
      if (previous && previous !== encoded) throw new Error("RSA peer partial changed");
      state.others[String(c.partyId)] = encoded;
    };
    for (const [sid, raw] of Object.entries(serverData.partyContributions ?? {})) {
      if (sid !== ctx.sidecarId && originalMap[sid] != null) accept(raw, originalMap[sid]);
    }
    if (ctx.peerChannel) {
      const messages = await ctx.peerChannel.collectMessages(ctx.client, task.TaskId, ctx.sidecarId, currentPartyId, 0, partyIdMap);
      for (const [from, bytes] of messages) {
        const peerId = Object.entries(partyIdMap).find(([, id]) => id === from)?.[0];
        if (peerId && peerId !== ctx.sidecarId) accept(JSON.parse(new TextDecoder().decode(bytes)), originalMap[peerId]);
      }
    }
    if (!state.complete && Object.keys(state.others).length > 0) {
      const threshold = serverData.thresholdConfig?.threshold ?? totalParties;
      if (!Number.isInteger(threshold) || threshold < 2 || threshold > totalParties) throw new Error("RSA operation missing valid threshold");
      if (Object.keys(state.others).length + 1 >= threshold) {
        const args = { input: bytesToBase642(inputBytes), n: nB64, e: eB64, totalParties, partials: { ...state.others, [String(myPartyId)]: state.own } };
        if (isDecrypt) args.unpadOaep = serverData.encryptionAlgorithm ?? "RSAES_OAEP_SHA_256";
        const combined = parseWasmResponse(api.rsa_shoup_combine(JSON.stringify(args)), "rsa_shoup_combine");
        state.complete = { protocol, partyId: myPartyId, complete: true, ...isDecrypt ? { plaintext: combined.result } : { signature: combined.result } };
      }
    }
    await ctx.client.updateTask({ TaskId: task.TaskId, ClientData: { sidecarId: ctx.sidecarId, round: task.Round, data: state.complete ?? partialPayload } });
  }
  // ----- DKG --------------------------------------------------------------
  async processDKG(task, ctx) {
    const api = await this.getApi();
    const serverData = parseServerData(task);
    const partyIdMap = serverData.partyIDMap ?? {};
    const myPartyId = partyIdMap[ctx.sidecarId];
    if (myPartyId == null) {
      throw new Error(`RSA DKG: sidecar id ${ctx.sidecarId} not in partyIDMap`);
    }
    const completed = this.completedKeyShares.get(task.TaskId);
    if (completed) {
      await ctx.client.updateTask({
        TaskId: task.TaskId,
        ClientData: {
          sidecarId: ctx.sidecarId,
          partyId: myPartyId,
          round: task.Round,
          ...rsaCompletionMetadata(completed, this.exportPrivateShareForTest)
        }
      });
      return;
    }
    const threshold = serverData.thresholdConfig?.threshold ?? 2;
    const totalParties = serverData.thresholdConfig?.totalParties ?? 2;
    const keySize = this.keySizeFromSpec(task.KeySpec, serverData.keySize);
    if (task.Round === 0) {
      if (this.initializedDkgTasks.has(task.TaskId)) {
        await ctx.client.updateTask({
          TaskId: task.TaskId,
          ClientData: {
            sidecarId: ctx.sidecarId,
            partyId: myPartyId,
            round: task.Round
          }
        });
        return;
      }
      const initJson = api.rsa_dkg_init(
        JSON.stringify({
          taskId: task.TaskId,
          requirePrepared: this.requirePrepared,
          keySize,
          threshold,
          totalParties,
          partyId: myPartyId
        })
      );
      const initRes = parseWasmResponse(initJson, "rsa_dkg_init");
      this.initializedDkgTasks.add(task.TaskId);
      await ctx.client.updateTask({
        TaskId: task.TaskId,
        ClientData: {
          sidecarId: ctx.sidecarId,
          partyId: myPartyId,
          round: task.Round,
          // The Go sidecar wraps the DKG message in a `data` field — preserve
          // that shape so server-side relay code can unwrap it the same way.
          data: JSON.parse(new TextDecoder().decode(base64ToBytes3(initRes.data)))
        }
      });
      return;
    }
    let lastOutput = null;
    let completedKeyShare = null;
    for (const [sidecarKey, rawContrib] of Object.entries(serverData.partyContributions ?? {})) {
      if (sidecarKey === ctx.sidecarId) continue;
      const contrib = this.unwrapContribution(rawContrib);
      if (!contrib || contrib.data == null) continue;
      const messages = Array.isArray(contrib.data) ? contrib.data : [contrib.data];
      for (const msg of messages) {
        const toParty = msg.toParty ?? 0;
        if (toParty !== 0 && toParty !== myPartyId) continue;
        const incomingB64 = bytesToBase642(new TextEncoder().encode(JSON.stringify(msg)));
        const roundJson = api.rsa_dkg_round(
          JSON.stringify({ taskId: task.TaskId, incoming: incomingB64 })
        );
        const roundRes = parseWasmResponse(roundJson, "rsa_dkg_round");
        if (roundRes.output) {
          lastOutput = roundRes.output;
        }
        if (roundRes.complete && roundRes.publicKeyN && roundRes.privShare) {
          completedKeyShare = {
            n: roundRes.publicKeyN,
            e: roundRes.publicKeyE ?? bytesToBase642(new Uint8Array([1, 0, 1])),
            // 65537 default
            dShare: roundRes.privShare
          };
        }
      }
    }
    if (completedKeyShare) {
      this.completedKeyShares.set(task.TaskId, completedKeyShare);
      this.initializedDkgTasks.delete(task.TaskId);
      if (this.onKeyShareReady && task.KeyId) {
        await this.onKeyShareReady(
          task.KeyId,
          JSON.stringify(completedKeyShare),
          completedKeyShare.n
          // publicKeyHex placeholder — RSA pk is N+E, not a hex point
        );
      }
      await ctx.client.updateTask({
        TaskId: task.TaskId,
        ClientData: {
          sidecarId: ctx.sidecarId,
          partyId: myPartyId,
          round: task.Round,
          ...rsaCompletionMetadata(completedKeyShare, this.exportPrivateShareForTest)
        }
      });
      return;
    }
    if (lastOutput == null) {
      await ctx.client.updateTask({
        TaskId: task.TaskId,
        ClientData: {
          sidecarId: ctx.sidecarId,
          partyId: myPartyId,
          round: task.Round
        }
      });
      return;
    }
    await ctx.client.updateTask({
      TaskId: task.TaskId,
      ClientData: {
        sidecarId: ctx.sidecarId,
        partyId: myPartyId,
        round: task.Round,
        data: JSON.parse(new TextDecoder().decode(base64ToBytes3(lastOutput)))
      }
    });
  }
  // ----- Helpers ----------------------------------------------------------
  keySizeFromSpec(keySpec, explicit) {
    if (explicit && explicit > 0) return explicit;
    switch (keySpec) {
      case "RSA_2048":
        return 2048;
      case "RSA_3072":
        return 3072;
      case "RSA_4096":
        return 4096;
      default:
        return 2048;
    }
  }
  /**
   * Unwrap a raw `partyContributions[id]` value. The Go server relays
   * contributions as-is, so we may see either the inner payload directly
   * or wrapped in `{ data: {...} }` depending on who submitted it.
   */
  unwrapContribution(raw) {
    if (!raw || typeof raw !== "object") return null;
    return raw;
  }
};
function parseWasmResponse(json, fnName) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`mpc-wasm ${fnName}: invalid JSON: ${json}`);
  }
  if (parsed.error) {
    throw new Error(`mpc-wasm ${fnName}: ${parsed.error}`);
  }
  return parsed;
}
function rsaCompletionMetadata(share, exportPrivateShareForTest = false) {
  const n = base64ToBytes3(share.n), e = base64ToBytes3(share.e);
  if (![256, 384, 512].includes(n.length) || e.length === 0 || e.length > 8) throw new Error("Invalid RSA public key at completion");
  const result = { complete: true, publicKey: bytesToBase642(new TextEncoder().encode(JSON.stringify({ n: share.n, e: share.e }))) };
  if (exportPrivateShareForTest) {
    if (typeof share.dShare !== "string" || !share.dShare.length || share.dShare.length > 4096) throw new Error("Missing or oversized test private share");
    base64ToBytes3(share.dShare);
    result.privateKey = bytesToBase642(new TextEncoder().encode(JSON.stringify({ dShare: share.dShare, n: share.n, e: share.e })));
  }
  return result;
}
function unwrapRsaOperationContribution(raw) {
  let value = raw;
  for (let depth = 0; depth < 4; depth++) {
    if (typeof value === "string") {
      if (value.length > 16384) throw new Error("Oversized RSA contribution");
      try {
        value = JSON.parse(value);
      } catch {
        try {
          value = JSON.parse(new TextDecoder().decode(base64ToBytes3(value)));
        } catch {
          return null;
        }
      }
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (value.partialResult != null || value.complete === true) return value;
    if (value.data == null) return null;
    value = value.data;
  }
  return null;
}

// src/engine.js
import { loadMpcWasm as loadMpcWasm2 } from "../vendor/mpc/loader.js";
import * as channel from "../vendor/channel/channelwasm.js";
var realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, options = {}) => realFetch(input, { ...options, redirect: "error", signal: options.signal || AbortSignal.timeout(/GetPublicKey|ListTasksForSidecar/.test(new Headers(options.headers).get("x-amz-target") || "") ? 12e3 : 55e3) });
globalThis.__qvaultCryptoProgress = (stage) => self.postMessage({ event: "crypto-progress", stage });
var preparationBackend = "go";
var hostedTest = false;
var hosted = false;
var client;
var sidecar;
var data = /* @__PURE__ */ new Map();
var ownKey = null;
var createAttempted = false;
var storage = { async get(k) {
  return data.get(k) || null;
}, async put(k, v) {
  data.set(k, new Uint8Array(v));
}, async delete(k) {
  data.delete(k);
}, async list(prefix) {
  return [...data.keys()].filter((x) => x.startsWith(prefix));
} };
function safeError(e) {
  if (e?.status) return qkmsErrorText(e);
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return "Service request timed out.";
  return ["TypeError", "RangeError", "RuntimeError"].includes(e?.name) ? e.name + ": local participant protocol/runtime error." : "Local participant operation failed. No secret diagnostic payload is displayed.";
}
var lastError = "";
var lastErrorAt = 0;
function participantError(error, task) {
  const safe = safeError(error);
  if (safe === lastError && Date.now() - lastErrorAt < 15e3) return;
  lastError = safe;
  lastErrorAt = Date.now();
  self.postMessage({ event: "participant-error", error: safe, task: task ? { status: String(task.Status).slice(0, 60), round: Number(task.Round), totalRounds: Number(task.TotalRounds) } : null });
}
var progressAt = /* @__PURE__ */ new Map();
function participantProgress(stage, task) {
  const key = stage + ":" + (task?.TaskId || "") + ":" + task?.Round;
  const now = Date.now();
  if (now - (progressAt.get(key) || 0) < 15e3) return;
  progressAt.set(key, now);
  self.postMessage({ event: "participant-progress", stage, task: task ? { round: Number(task.Round), totalRounds: Number(task.TotalRounds) } : null });
}
async function initialize() {
  await channel.default({ module_or_path: new URL("../vendor/channel/channelwasm_bg.wasm", import.meta.url) });
  return loadMpcWasm2();
}
async function action(m) {
  if (m.action === "local") {
    const api = await initialize();
    const identity = await generateIdentity();
    if (!identity.sidecarId) throw Error("Identity failed");
    if (typeof api.rsa_shoup_partial !== "function" || typeof api.rsa_dkg_init !== "function" || typeof api.rsa_dkg_prepare !== "function" || typeof api.rsa_dkg_prepared !== "function") throw Error("Missing RSA exports");
    const pair = await crypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["encrypt", "decrypt"]);
    const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const encoded = (b) => btoa(String.fromCharCode(...b));
    const asBase64 = (s) => s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4);
    try {
      const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "RSA-OAEP" }, pair.publicKey, bytes));
      const partial = JSON.parse(api.rsa_shoup_partial(JSON.stringify({ input: encoded(cipher), n: asBase64(jwk.n), dShare: asBase64(jwk.d), totalParties: 1 })));
      const combined = JSON.parse(api.rsa_shoup_combine(JSON.stringify({ input: encoded(cipher), n: asBase64(jwk.n), e: asBase64(jwk.e), partials: { "1": partial.partial }, totalParties: 1, unpadOaep: "RSAES_OAEP_SHA_256" })));
      const recovered = Uint8Array.from(atob(combined.result), (c) => c.charCodeAt(0));
      if (recovered.length !== 32 || !bytes.every((b, i) => b === recovered[i])) throw Error("RSA local roundtrip mismatch");
      recovered.fill(0);
    } finally {
      bytes.fill(0);
    }
    return { ready: true, sidecarId: identity.sidecarId };
  }
  if (m.action === "start") {
    hostedTest = m.hostedTest === true;
    if (hostedTest && (m.exportPrivateShareForTest === true || m.restore)) throw Error("Hosted isolation probe forbids private-share export and saved-profile restore");
    hosted = m.hosted === true;
    if (hosted && (hostedTest || m.exportPrivateShareForTest === true)) throw Error("A hosted vault participant never exports its private share");
    preparationBackend = m.preparationBackend === "rust" ? "rust" : "go";
    if (sidecar) throw Error("Participant already started");
    if (m.restore) {
      const restored = validateParticipantState(m.restore, m.restore.keyId);
      for (const [k, v] of restored) data.set(k, v);
      ownKey = m.restore.keyId;
      createAttempted = true;
    }
    await initialize();
    client = new QkmsRpcClient({ server: "https://qkms.quilibrium.com", accessKey: m.credentials.accessKey, secretKey: m.credentials.secretKey, region: m.credentials.region });
    const rsa = new RSASession();
    rsa.requirePrepared = true;
    rsa.exportPrivateShareForTest = m.exportPrivateShareForTest === true;
    rsa.onKeyShareReady = async (id, json) => {
      await storage.put("keyshare/" + id, new TextEncoder().encode(json));
    };
    rsa.loadKeyShare = async (id) => {
      const b = await storage.get("keyshare/" + id);
      return b ? new TextDecoder().decode(b) : null;
    };
    const ignored = new Set(Array.isArray(m.ignoreTaskIds) ? m.ignoreTaskIds : []);
    const acceptTask = m.syncSession === true ? ((task) => task.KeyId === ownKey && ["decrypt", "sign"].includes(String(task.Operation).toLowerCase()) && !ignored.has(task.TaskId)) : void 0;
    sidecar = new Sidecar({ client, storage, acceptTask, reusePeerSession: hostedTest || hosted, operationsWithoutPeerSession: hosted, sessions: [rsa], useTofN: true, pollIntervalMs: 500, autoRegister: true, onError: participantError, onProgress: participantProgress });
    await sidecar.start();
    const sidecarId = await sidecar.getSidecarId();
    if (m.restore && sidecarId !== m.restore.sidecarId) {
      sidecar.stop();
      throw Error("Restored sidecar identity mismatch");
    }
    return { sidecarId };
  }
  if (m.action === "observe-start") {
    client = new QkmsRpcClient({ server: "https://qkms.quilibrium.com", accessKey: m.credentials.accessKey, secretKey: m.credentials.secretKey, region: m.credentials.region });
    ownKey = m.keyId;
    return { observer: true };
  }
  if (!client) throw Error("Connect first");
  if (m.action === "pending-tasks") {
    if (!Array.isArray(m.sidecarIds) || m.sidecarIds.length < 1 || m.sidecarIds.length > 2 || m.sidecarIds.some((id) => !/^[a-f0-9]{32}$/.test(id))) throw Error("Invalid participant list");
    const ids = /* @__PURE__ */ new Set();
    for (const id of m.sidecarIds) {
      const r = await client.listTasksForSidecar({ SidecarId: id, Limit: 100, IncludeTerminal: false });
      if (!Array.isArray(r.Tasks) || r.Tasks.length >= 100) throw Error("Cannot safely establish pending-task baseline");
      for (const t of r.Tasks) if (t.Status === "AWAITING_CLIENT") {
        if (typeof t.TaskId !== "string" || !t.TaskId || t.TaskId.length > 128) throw Error("Invalid pending-task identifier");
        ids.add(t.TaskId);
      }
    }
    return { ids: [...ids] };
  }
  if (m.action === "export-state") {
    if (hostedTest) throw Error("Hosted isolation probe cannot export participant state");
    if (!sidecar) throw Error("Participant not started");
    return exportParticipant(storage, await sidecar.getSidecarId(), m.keyId);
  }
  if (m.action === "prepare") {
    if (createAttempted) throw Error("A remote creation was already attempted; start a fresh session.");
    const api = await loadMpcWasm2();
    if (JSON.parse(api.rsa_dkg_prepared("{}")).ready === true) return { ready: true, keySize: 2048 };
    if (preparationBackend === "rust") return prepareWithRust({ init: () => initRustPrimes({ module_or_path: new URL("../vendor/rust-primes/qvault_rust_primes_bg.wasm", import.meta.url) }), generate: generate_safe_prime, api, progress: (stage) => self.postMessage({ event: "crypto-progress", stage }) });
    const r = JSON.parse(api.rsa_dkg_prepare(JSON.stringify({ keySize: 2048 })));
    if (r.ready !== true) throw Error("Offline RSA preparation failed");
    return { ready: true, keySize: 2048 };
  }
  if (m.action === "prepared") {
    const api = await loadMpcWasm2();
    return JSON.parse(api.rsa_dkg_prepared("{}"));
  }
  if (m.action === "create") {
    if (hostedTest || hosted) {
      const id = await sidecar.getSidecarId();
      if (!Array.isArray(m.participants) || m.participants.length !== 2 || !m.participants.includes("service") || !m.participants.includes(id)) throw Error(hosted ? "A hosted vault key requires service plus this browser only" : "Hosted isolation probe requires service plus this browser only");
    }
    if (createAttempted) throw Error("This session already attempted CreateKey. No automatic retry is permitted.");
    const api = await loadMpcWasm2();
    if (JSON.parse(api.rsa_dkg_prepared("{}")).ready !== true) throw Error("Offline RSA preparation required before CreateKey.");
    createAttempted = true;
    const r = await client.createKey({ KeySpec: "RSA_2048", KeyUsage: "ENCRYPT_DECRYPT", Description: m.vault === true && !hostedTest ? "QVault vault key" : "QVault synthetic test; ephemeral shares", Participants: m.participants, Threshold: 2, TotalParties: 2 }, { async: true });
    ownKey = r.KeyMetadata.KeyId;
    return { keyId: ownKey, pending: true };
  }
  if (m.action === "ready") {
    if (m.keyId !== ownKey) throw Error("Only this session test key is allowed");
    let ready2 = false, readError = null;
    try {
      const r = await client.getPublicKey({ KeyId: ownKey });
      ready2 = typeof r.PublicKey === "string" && r.PublicKey.length > 0;
    } catch (e) {
      let type = "";
      try {
        type = JSON.parse(e.body || "{}").__type || "";
      } catch {
      }
      ;
      if (/NotFound|KMSInvalidState/.test(type)) readError = "key pending";
      else if (e?.name === "TimeoutError" || e?.name === "AbortError") readError = "GetPublicKey request timed out";
      else throw e;
    }
    let task = null, taskError = null;
    try {
      const r = await client.listTasksForSidecar({ SidecarId: m.sidecarId, Limit: 100, IncludeTerminal: true });
      if (!Array.isArray(r.Tasks)) taskError = "Task response has no Tasks array";
      else {
        const tasks = r.Tasks.filter((t2) => t2.KeyId === ownKey);
        const t = tasks.find((t2) => t2.Operation === "CreateKey") || tasks[0];
        if (t) task = { status: String(t.Status).slice(0, 60), operation: String(t.Operation).slice(0, 40), round: Number(t.Round), totalRounds: Number(t.TotalRounds) };
        else taskError = "Task absent from returned list; this does not prove deletion";
      }
    } catch (e) {
      taskError = safeError(e);
    }
    return { ready: ready2, readError, task, taskError };
  }
  if (m.action === "encrypt" || m.action === "decrypt") {
    if (m.keyId !== ownKey) throw Error("Only this session test key is allowed");
    return client.call(m.action === "encrypt" ? "Encrypt" : "Decrypt", { KeyId: ownKey, EncryptionAlgorithm: "RSAES_OAEP_SHA_256", ...m.action === "encrypt" ? { Plaintext: m.value } : { CiphertextBlob: m.value } });
  }
  throw Error("Unknown action");
}
console.log = () => {
};
console.warn = () => {
};
console.error = () => {
};
self.onmessage = async ({ data: m }) => {
  try {
    const result = await action(m);
    self.postMessage({ id: m.id, data: result });
  } catch (e) {
    self.postMessage({ id: m.id, error: safeError(e) });
  }
};
//# sourceMappingURL=engine.js.map
