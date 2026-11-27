// tests/rsa-operation-source.js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// upstream/sdk-core/sidecar/peer-channel.ts
import * as channelwasm from "../vendor/channel/channelwasm.js";
var E2EE_ROUND_HELLO = 0;
var E2EE_ROUND_ACK = 1;
var E2EE_ROUND_PROTOCOL_START = 2;
function base64ToBytes(b64) {
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
      const result = channelwasm.js_sender_x3dh(JSON.stringify({
        sending_identity_private_key: Array.from(this.identityPrivateX448),
        sending_ephemeral_private_key: Array.from(this.signedPreKeyPrivateX448),
        receiving_identity_key: Array.from(peerIdentityKey),
        receiving_signed_pre_key: Array.from(peerSignedPreKey),
        session_key_length: 96
      }));
      sessionKeyB64 = JSON.parse(result);
    } else {
      const result = channelwasm.js_receiver_x3dh(JSON.stringify({
        sending_identity_private_key: Array.from(this.identityPrivateX448),
        sending_signed_private_key: Array.from(this.signedPreKeyPrivateX448),
        receiving_identity_key: Array.from(peerIdentityKey),
        receiving_ephemeral_key: Array.from(peerSignedPreKey),
        session_key_length: 96
      }));
      sessionKeyB64 = JSON.parse(result);
    }
    const sessionKey = base64ToBytes(sessionKeyB64);
    const state = channelwasm.js_new_double_ratchet(JSON.stringify({
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
    const result = JSON.parse(channelwasm.js_double_ratchet_encrypt(JSON.stringify({
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
    const result = JSON.parse(channelwasm.js_double_ratchet_decrypt(JSON.stringify({
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
  async performHandshake(client, taskId, mySidecarId, myPartyId, peerId, peerPartyId, peerIdentity) {
    const taskSessionKey = this.scope(peerId, taskId);
    if (this.sessionReady.has(taskSessionKey)) return true;
    const isSender = mySidecarId < peerId;
    if (isSender) {
      return this.performSenderHandshake(client, taskId, mySidecarId, myPartyId, peerId, peerPartyId, peerIdentity);
    } else {
      return this.performReceiverHandshake(client, taskId, mySidecarId, myPartyId, peerId, peerPartyId, peerIdentity);
    }
  }
  /**
   * Sender side of the handshake. Idempotently sends `hello` (once per task)
   * and consults a pre-fetched ack pool for the matching peer's response.
   * Receives `helloByParty`/`ackByParty` from the orchestrator so each round's
   * `GetPartyMessages` is consumed only once per tick (server deletes on read).
   */
  async performSenderHandshake(client, taskId, mySidecarId, myPartyId, peerId, peerPartyId, peerIdentity, ackMessages) {
    const helloKey = `${this.scope(peerId, taskId)}:hello`;
    if (!this.helloSent.has(helloKey)) {
      this.sessions.delete(this.scope(peerId, taskId));
      this.sessionReady.delete(this.scope(peerId, taskId));
      this.establishSession(peerId, true, peerIdentity.identityKey, peerIdentity.signedPreKey, taskId);
      const envelope = this.encrypt(peerId, new TextEncoder().encode("hello"), taskId);
      await client.call("SendPartyMessage", {
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
  async performReceiverHandshake(client, taskId, mySidecarId, myPartyId, peerId, peerPartyId, peerIdentity, helloMessages) {
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
          await client.call("SendPartyMessage", {
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
  async performHandshakeWithMessages(client, taskId, mySidecarId, myPartyId, peerId, peerPartyId, peerIdentity, helloMessages, ackMessages) {
    const taskSessionKey = this.scope(peerId, taskId);
    if (this.sessionReady.has(taskSessionKey)) return true;
    const isSender = mySidecarId < peerId;
    if (isSender) {
      return this.performSenderHandshake(client, taskId, mySidecarId, myPartyId, peerId, peerPartyId, peerIdentity, ackMessages);
    } else {
      return this.performReceiverHandshake(client, taskId, mySidecarId, myPartyId, peerId, peerPartyId, peerIdentity, helloMessages);
    }
  }
  // ---- Protocol messaging ----
  /**
   * Send an encrypted protocol message to a peer via SendPartyMessage.
   * The round is offset by E2EE_ROUND_PROTOCOL_START to avoid collision
   * with handshake rounds.
   */
  async sendMessage(client, taskId, mySidecarId, myPartyId, peerId, peerPartyId, protocolRound, plaintext) {
    const envelope = this.encrypt(peerId, plaintext, taskId);
    await client.call("SendPartyMessage", {
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
  async collectMessages(client, taskId, mySidecarId, myPartyId, protocolRound, partyIdMap) {
    const resp = await client.call(
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
  static async fetchPeerIdentity(client, peerId) {
    const resp = await client.call("GetSidecar", { SidecarId: peerId });
    return {
      identityKey: base64ToBytes(resp.SidecarIdentity?.IdentityKey ?? resp.IdentityKey),
      signedPreKey: base64ToBytes(resp.SidecarIdentity?.SignedPreKey ?? resp.SignedPreKey)
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
        const task2 = normalizeTask(raw);
        if (this.cfg.acceptTask && !this.cfg.acceptTask(task2)) continue;
        if (task2.Status !== "AWAITING_CLIENT") continue;
        this.cfg.onProgress?.("task-found", task2);
        const hasOthers = this.hasOtherSidecars(task2);
        let peerChannel = this.cfg.peerChannel;
        if (this.cfg.peerChannel && hasOthers) {
          this.cfg.onProgress?.("checking-peer-handshake", task2);
          const ready = await this.ensureE2EESessions(task2);
          if (!ready) {
            const operation = String(task2.Operation ?? "").toLowerCase();
            if (this.cfg.operationsWithoutPeerSession === true && (operation === "sign" || operation === "decrypt")) {
              this.cfg.onProgress?.("operation-without-peer-session", task2);
              peerChannel = void 0;
            } else {
              this.cfg.onProgress?.("waiting-for-peer-handshake", task2);
              continue;
            }
          }
        }
        try {
          this.cfg.onProgress?.("protocol-computation-started", task2);
          const dispatched = await this.cfg.dispatcher.dispatch(task2, {
            client: this.cfg.client,
            identity: this.cfg.identity,
            sidecarId: this.cfg.identity.sidecarId,
            peerChannel
          });
          if (dispatched !== false) this.cfg.onProgress?.("protocol-contribution-submitted", task2);
          else this.cfg.onProgress?.("protocol-dispatch-skipped", task2);
        } catch (err) {
          console.error("[qkms-sdk] dispatch error:", task2.TaskId, err);
          this.cfg.onError?.(err, task2);
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
  hasOtherSidecars(task2) {
    const participants = task2.Participants?.length ? task2.Participants : Object.keys(task2.PartyIdMap || {});
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
  async ensureE2EESessions(task2) {
    const pc = this.cfg.peerChannel;
    const partyIdMap = task2.PartyIdMap ?? {};
    const myPartyId = partyIdMap[this.cfg.identity.sidecarId];
    if (!Number.isInteger(myPartyId) || myPartyId < 1) {
      this.cfg.onProgress?.("missing-party-map", task2);
      throw new Error("Missing own party mapping");
    }
    const peers = [];
    for (const [peerId, peerPartyId] of Object.entries(partyIdMap)) {
      if (peerId === this.cfg.identity.sidecarId) continue;
      if (peerId === "service") continue;
      peers.push({ sidecarId: peerId, partyId: peerPartyId });
    }
    const pending = peers.filter((peer) => !pc.isReady?.(peer.sidecarId, task2.TaskId));
    if (!pending.length) {
      this.cfg.onProgress?.("peer-session-already-ready", task2);
      return true;
    }
    for (const peer of pending) {
      try {
        this.cfg.onProgress?.("fetching-peer-identity", task2);
        peer.identity = await PeerChannel.fetchPeerIdentity(this.cfg.client, peer.sidecarId);
      } catch (err) {
        this.cfg.onProgress?.("peer-identity-failed", task2);
        this.cfg.onError?.(err, task2);
        return false;
      }
    }
    const helloByParty = /* @__PURE__ */ new Map();
    const ackByParty = /* @__PURE__ */ new Map();
    try {
      const helloResp = await this.cfg.client.call(
        "GetPartyMessages",
        { TaskId: task2.TaskId, SidecarId: this.cfg.identity.sidecarId, ForParty: myPartyId, Round: 0 }
      );
      for (const msg of helloResp.Messages ?? []) {
        const list = helloByParty.get(msg.fromParty) ?? [];
        list.push(msg);
        helloByParty.set(msg.fromParty, list);
      }
    } catch (err) {
      this.cfg.onProgress?.("hello-message-request-failed", task2);
      this.cfg.onError?.(err, task2);
      return false;
    }
    try {
      const ackResp = await this.cfg.client.call(
        "GetPartyMessages",
        { TaskId: task2.TaskId, SidecarId: this.cfg.identity.sidecarId, ForParty: myPartyId, Round: 1 }
      );
      for (const msg of ackResp.Messages ?? []) {
        const list = ackByParty.get(msg.fromParty) ?? [];
        list.push(msg);
        ackByParty.set(msg.fromParty, list);
      }
    } catch (err) {
      this.cfg.onProgress?.("ack-message-request-failed", task2);
      this.cfg.onError?.(err, task2);
      return false;
    }
    let allReady = true;
    for (const peer of pending) {
      if (!peer.identity) {
        allReady = false;
        continue;
      }
      try {
        this.cfg.onProgress?.("exchanging-peer-handshake", task2);
        const ready = await pc.performHandshakeWithMessages(
          this.cfg.client,
          task2.TaskId,
          this.cfg.identity.sidecarId,
          myPartyId,
          peer.sidecarId,
          peer.partyId,
          peer.identity,
          helloByParty.get(peer.partyId) ?? [],
          ackByParty.get(peer.partyId) ?? []
        );
        if (!ready) allReady = false;
      } catch (err) {
        this.cfg.onProgress?.("peer-handshake-failed", task2);
        this.cfg.onError?.(err, task2);
        allReady = false;
      }
    }
    return allReady;
  }
};
function normalizeTask(task2) {
  let sd = task2.ServerData || {};
  if (typeof sd === "string") {
    try {
      sd = JSON.parse(sd);
    } catch {
      sd = {};
    }
  }
  const candidates = [task2.PartyIdMap, task2.PartyIDMap, sd.partyIDMap, sd.PartyIDMap, sd.partyIdMap];
  const mapping = candidates.find((m) => m && typeof m === "object" && !Array.isArray(m) && Object.keys(m).length > 0);
  if (!mapping) return task2;
  const ids = Object.values(mapping);
  if (ids.some((x) => !Number.isInteger(x) || x < 1) || new Set(ids).size !== ids.length) throw new Error("Invalid party mapping");
  return { ...task2, PartyIdMap: mapping, Participants: task2.Participants?.length ? task2.Participants : Object.keys(mapping) };
}

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
  async dispatch(task2, ctx) {
    const cacheKey = `${task2.TaskId}:${task2.Round}`;
    if (this.submittedRounds.has(cacheKey) && !this.sessions.some((s) => s.canHandle(task2) && s.canRevisitSameRound?.(task2) === true)) {
      return false;
    }
    for (const session of this.sessions) {
      if (session.canHandle(task2)) {
        await session.process(task2, ctx);
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

// upstream/sdk-core/sidecar/sessions/rsa.ts
import { loadMpcWasm } from "../vendor/mpc/loader.js";
function bytesToBase64(bytes) {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function base64ToBytes2(b64) {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function decodeWireBytes(value) {
  if (value == null) return new Uint8Array();
  if (typeof value === "string") return base64ToBytes2(value);
  if (Array.isArray(value)) return Uint8Array.from(value);
  throw new Error(`unexpected wire bytes: ${typeof value}`);
}
function parseServerData(task2) {
  if (!task2.ServerData) return {};
  if (typeof task2.ServerData === "string") {
    try {
      return JSON.parse(task2.ServerData);
    } catch {
      return {};
    }
  }
  return task2.ServerData;
}
function extractPubKeyFromServerData(sd) {
  if (!sd.rsaPublicKey) return null;
  const n2 = sd.rsaPublicKey.n;
  const e2 = sd.rsaPublicKey.e;
  if (n2 == null || e2 == null) return null;
  return {
    nB64: bytesToBase64(decodeWireBytes(n2)),
    eB64: bytesToBase64(decodeWireBytes(e2))
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
  canHandle(task2) {
    const sd = parseServerData(task2);
    const spec = task2.KeySpec ?? sd.keySpec;
    if (["RSA_2048", "RSA_3072", "RSA_4096"].includes(spec ?? "")) return true;
    const proto = task2.Protocol ?? sd.protocol;
    return typeof proto === "string" && ["rsa-n", "rsa-n-sign", "rsa-n-decrypt"].includes(proto.toLowerCase());
  }
  canRevisitSameRound(task2) {
    return ["sign", "decrypt"].includes((task2.Operation ?? "").toLowerCase());
  }
  async process(task2, ctx) {
    const operation = (task2.Operation ?? "").toLowerCase();
    if (operation === "createkey") {
      await this.processDKG(task2, ctx);
    } else if (operation === "sign" || operation === "decrypt") {
      await this.processSignOrDecrypt(task2, ctx, operation === "decrypt");
    } else {
      throw new Error(`RSASession: unsupported operation ${task2.Operation}`);
    }
  }
  // ----- Sign / Decrypt ---------------------------------------------------
  async processSignOrDecrypt(task2, ctx, isDecrypt) {
    const api2 = await this.getApi();
    const serverData = parseServerData(task2);
    if (!task2.KeyId) throw new Error("RSA sign: task missing KeyId");
    if (!this.loadKeyShare) {
      throw new Error("RSA sign: loadKeyShare resolver not set on session");
    }
    const keyShareJson = await this.loadKeyShare(task2.KeyId);
    if (!keyShareJson) {
      throw new Error(`RSA sign: no key share for key ${task2.KeyId}`);
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
    const partyIdMap = serverData.partyIDMap ?? task2.PartyIdMap ?? {};
    const originalMap = Object.keys(serverData.dkgPartyIDMap ?? {}).length ? serverData.dkgPartyIDMap : partyIdMap;
    const myPartyId = originalMap[ctx.sidecarId];
    const totalParties = serverData.thresholdConfig?.totalParties ?? Object.keys(originalMap).length;
    const currentPartyId = partyIdMap[ctx.sidecarId];
    if (!Number.isInteger(myPartyId) || myPartyId < 1 || !Number.isInteger(totalParties) || totalParties < 2 || myPartyId > totalParties || !Number.isInteger(currentPartyId) || currentPartyId < 1) throw new Error("RSA operation missing valid party configuration");
    const inputBytes = decodeWireBytes(isDecrypt ? serverData.ciphertext : serverData.message);
    if (inputBytes.length === 0) throw new Error("RSA operation missing input");
    let state = this.rsaOperationState.get(task2.TaskId);
    if (!state) {
      const partial = parseWasmResponse(api2.rsa_shoup_partial(JSON.stringify({ input: bytesToBase64(inputBytes), n: nB64, dShare: keyShare.dShare, totalParties })), "rsa_shoup_partial");
      state = { own: partial.partial, others: {}, sent: /* @__PURE__ */ new Set() };
      this.rsaOperationState.set(task2.TaskId, state);
    }
    const protocol = isDecrypt ? "rsa-n-decrypt" : "rsa-n-sign";
    const partialPayload = { protocol, partyId: myPartyId, partialResult: state.own };
    if (ctx.peerChannel) {
      for (const [peerId, peerParty] of Object.entries(partyIdMap)) {
        if (peerId === ctx.sidecarId || state.sent.has(peerId)) continue;
        await ctx.peerChannel.sendMessage(ctx.client, task2.TaskId, ctx.sidecarId, currentPartyId, peerId, peerParty, 0, new TextEncoder().encode(JSON.stringify(partialPayload)));
        state.sent.add(peerId);
      }
    }
    const accept = (raw, expected) => {
      const c2 = unwrapRsaOperationContribution(raw);
      if (!c2 || !Number.isInteger(c2.partyId) || c2.partyId === myPartyId || c2.partyId < 1 || c2.partyId > totalParties || c2.partialResult == null) return;
      if (expected != null && c2.partyId !== expected) throw new Error("RSA peer contribution has wrong original party id");
      const bytes = decodeWireBytes(c2.partialResult);
      if (bytes.length === 0 || bytes.length > decodeWireBytes(nB64).length) throw new Error("RSA peer partial has invalid size");
      const encoded = bytesToBase64(bytes), previous = state.others[String(c2.partyId)];
      if (previous && previous !== encoded) throw new Error("RSA peer partial changed");
      state.others[String(c2.partyId)] = encoded;
    };
    for (const [sid, raw] of Object.entries(serverData.partyContributions ?? {})) {
      if (sid !== ctx.sidecarId && originalMap[sid] != null) accept(raw, originalMap[sid]);
    }
    if (ctx.peerChannel) {
      const messages = await ctx.peerChannel.collectMessages(ctx.client, task2.TaskId, ctx.sidecarId, currentPartyId, 0, partyIdMap);
      for (const [from, bytes] of messages) {
        const peerId = Object.entries(partyIdMap).find(([, id]) => id === from)?.[0];
        if (peerId && peerId !== ctx.sidecarId) accept(JSON.parse(new TextDecoder().decode(bytes)), originalMap[peerId]);
      }
    }
    if (!state.complete && Object.keys(state.others).length > 0) {
      const threshold = serverData.thresholdConfig?.threshold ?? totalParties;
      if (!Number.isInteger(threshold) || threshold < 2 || threshold > totalParties) throw new Error("RSA operation missing valid threshold");
      if (Object.keys(state.others).length + 1 >= threshold) {
        const args = { input: bytesToBase64(inputBytes), n: nB64, e: eB64, totalParties, partials: { ...state.others, [String(myPartyId)]: state.own } };
        if (isDecrypt) args.unpadOaep = serverData.encryptionAlgorithm ?? "RSAES_OAEP_SHA_256";
        const combined = parseWasmResponse(api2.rsa_shoup_combine(JSON.stringify(args)), "rsa_shoup_combine");
        state.complete = { protocol, partyId: myPartyId, complete: true, ...isDecrypt ? { plaintext: combined.result } : { signature: combined.result } };
      }
    }
    await ctx.client.updateTask({ TaskId: task2.TaskId, ClientData: { sidecarId: ctx.sidecarId, round: task2.Round, data: state.complete ?? partialPayload } });
  }
  // ----- DKG --------------------------------------------------------------
  async processDKG(task2, ctx) {
    const api2 = await this.getApi();
    const serverData = parseServerData(task2);
    const partyIdMap = serverData.partyIDMap ?? {};
    const myPartyId = partyIdMap[ctx.sidecarId];
    if (myPartyId == null) {
      throw new Error(`RSA DKG: sidecar id ${ctx.sidecarId} not in partyIDMap`);
    }
    const completed = this.completedKeyShares.get(task2.TaskId);
    if (completed) {
      await ctx.client.updateTask({
        TaskId: task2.TaskId,
        ClientData: {
          sidecarId: ctx.sidecarId,
          partyId: myPartyId,
          round: task2.Round,
          ...rsaCompletionMetadata(completed, this.exportPrivateShareForTest)
        }
      });
      return;
    }
    const threshold = serverData.thresholdConfig?.threshold ?? 2;
    const totalParties = serverData.thresholdConfig?.totalParties ?? 2;
    const keySize = this.keySizeFromSpec(task2.KeySpec, serverData.keySize);
    if (task2.Round === 0) {
      if (this.initializedDkgTasks.has(task2.TaskId)) {
        await ctx.client.updateTask({
          TaskId: task2.TaskId,
          ClientData: {
            sidecarId: ctx.sidecarId,
            partyId: myPartyId,
            round: task2.Round
          }
        });
        return;
      }
      const initJson = api2.rsa_dkg_init(
        JSON.stringify({
          taskId: task2.TaskId,
          requirePrepared: this.requirePrepared,
          keySize,
          threshold,
          totalParties,
          partyId: myPartyId
        })
      );
      const initRes = parseWasmResponse(initJson, "rsa_dkg_init");
      this.initializedDkgTasks.add(task2.TaskId);
      await ctx.client.updateTask({
        TaskId: task2.TaskId,
        ClientData: {
          sidecarId: ctx.sidecarId,
          partyId: myPartyId,
          round: task2.Round,
          // The Go sidecar wraps the DKG message in a `data` field — preserve
          // that shape so server-side relay code can unwrap it the same way.
          data: JSON.parse(new TextDecoder().decode(base64ToBytes2(initRes.data)))
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
        const incomingB64 = bytesToBase64(new TextEncoder().encode(JSON.stringify(msg)));
        const roundJson = api2.rsa_dkg_round(
          JSON.stringify({ taskId: task2.TaskId, incoming: incomingB64 })
        );
        const roundRes = parseWasmResponse(roundJson, "rsa_dkg_round");
        if (roundRes.output) {
          lastOutput = roundRes.output;
        }
        if (roundRes.complete && roundRes.publicKeyN && roundRes.privShare) {
          completedKeyShare = {
            n: roundRes.publicKeyN,
            e: roundRes.publicKeyE ?? bytesToBase64(new Uint8Array([1, 0, 1])),
            // 65537 default
            dShare: roundRes.privShare
          };
        }
      }
    }
    if (completedKeyShare) {
      this.completedKeyShares.set(task2.TaskId, completedKeyShare);
      this.initializedDkgTasks.delete(task2.TaskId);
      if (this.onKeyShareReady && task2.KeyId) {
        await this.onKeyShareReady(
          task2.KeyId,
          JSON.stringify(completedKeyShare),
          completedKeyShare.n
          // publicKeyHex placeholder — RSA pk is N+E, not a hex point
        );
      }
      await ctx.client.updateTask({
        TaskId: task2.TaskId,
        ClientData: {
          sidecarId: ctx.sidecarId,
          partyId: myPartyId,
          round: task2.Round,
          ...rsaCompletionMetadata(completedKeyShare, this.exportPrivateShareForTest)
        }
      });
      return;
    }
    if (lastOutput == null) {
      await ctx.client.updateTask({
        TaskId: task2.TaskId,
        ClientData: {
          sidecarId: ctx.sidecarId,
          partyId: myPartyId,
          round: task2.Round
        }
      });
      return;
    }
    await ctx.client.updateTask({
      TaskId: task2.TaskId,
      ClientData: {
        sidecarId: ctx.sidecarId,
        partyId: myPartyId,
        round: task2.Round,
        data: JSON.parse(new TextDecoder().decode(base64ToBytes2(lastOutput)))
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
  const n2 = base64ToBytes2(share.n), e2 = base64ToBytes2(share.e);
  if (![256, 384, 512].includes(n2.length) || e2.length === 0 || e2.length > 8) throw new Error("Invalid RSA public key at completion");
  const result = { complete: true, publicKey: bytesToBase64(new TextEncoder().encode(JSON.stringify({ n: share.n, e: share.e }))) };
  if (exportPrivateShareForTest) {
    if (typeof share.dShare !== "string" || !share.dShare.length || share.dShare.length > 4096) throw new Error("Missing or oversized test private share");
    base64ToBytes2(share.dShare);
    result.privateKey = bytesToBase64(new TextEncoder().encode(JSON.stringify({ dShare: share.dShare, n: share.n, e: share.e })));
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
          value = JSON.parse(new TextDecoder().decode(base64ToBytes2(value)));
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

// vendor/mpc/wasm_exec.js
(() => {
  const enosys = () => {
    const err = new Error("not implemented");
    err.code = "ENOSYS";
    return err;
  };
  if (!globalThis.fs) {
    let outputBuf = "";
    globalThis.fs = {
      constants: { O_WRONLY: -1, O_RDWR: -1, O_CREAT: -1, O_TRUNC: -1, O_APPEND: -1, O_EXCL: -1, O_DIRECTORY: -1 },
      // unused
      writeSync(fd, buf) {
        outputBuf += decoder.decode(buf);
        const nl = outputBuf.lastIndexOf("\n");
        if (nl != -1) {
          console.log(outputBuf.substring(0, nl));
          outputBuf = outputBuf.substring(nl + 1);
        }
        return buf.length;
      },
      write(fd, buf, offset, length, position, callback) {
        if (offset !== 0 || length !== buf.length || position !== null) {
          callback(enosys());
          return;
        }
        const n2 = this.writeSync(fd, buf);
        callback(null, n2);
      },
      chmod(path, mode, callback) {
        callback(enosys());
      },
      chown(path, uid, gid, callback) {
        callback(enosys());
      },
      close(fd, callback) {
        callback(enosys());
      },
      fchmod(fd, mode, callback) {
        callback(enosys());
      },
      fchown(fd, uid, gid, callback) {
        callback(enosys());
      },
      fstat(fd, callback) {
        callback(enosys());
      },
      fsync(fd, callback) {
        callback(null);
      },
      ftruncate(fd, length, callback) {
        callback(enosys());
      },
      lchown(path, uid, gid, callback) {
        callback(enosys());
      },
      link(path, link, callback) {
        callback(enosys());
      },
      lstat(path, callback) {
        callback(enosys());
      },
      mkdir(path, perm, callback) {
        callback(enosys());
      },
      open(path, flags, mode, callback) {
        callback(enosys());
      },
      read(fd, buffer, offset, length, position, callback) {
        callback(enosys());
      },
      readdir(path, callback) {
        callback(enosys());
      },
      readlink(path, callback) {
        callback(enosys());
      },
      rename(from, to, callback) {
        callback(enosys());
      },
      rmdir(path, callback) {
        callback(enosys());
      },
      stat(path, callback) {
        callback(enosys());
      },
      symlink(path, link, callback) {
        callback(enosys());
      },
      truncate(path, length, callback) {
        callback(enosys());
      },
      unlink(path, callback) {
        callback(enosys());
      },
      utimes(path, atime, mtime, callback) {
        callback(enosys());
      }
    };
  }
  if (!globalThis.process) {
    globalThis.process = {
      getuid() {
        return -1;
      },
      getgid() {
        return -1;
      },
      geteuid() {
        return -1;
      },
      getegid() {
        return -1;
      },
      getgroups() {
        throw enosys();
      },
      pid: -1,
      ppid: -1,
      umask() {
        throw enosys();
      },
      cwd() {
        throw enosys();
      },
      chdir() {
        throw enosys();
      }
    };
  }
  if (!globalThis.path) {
    globalThis.path = {
      resolve(...pathSegments) {
        return pathSegments.join("/");
      }
    };
  }
  if (!globalThis.crypto) {
    throw new Error("globalThis.crypto is not available, polyfill required (crypto.getRandomValues only)");
  }
  if (!globalThis.performance) {
    throw new Error("globalThis.performance is not available, polyfill required (performance.now only)");
  }
  if (!globalThis.TextEncoder) {
    throw new Error("globalThis.TextEncoder is not available, polyfill required");
  }
  if (!globalThis.TextDecoder) {
    throw new Error("globalThis.TextDecoder is not available, polyfill required");
  }
  const encoder = new TextEncoder("utf-8");
  const decoder = new TextDecoder("utf-8");
  globalThis.Go = class {
    constructor() {
      this.argv = ["js"];
      this.env = {};
      this.exit = (code) => {
        if (code !== 0) {
          console.warn("exit code:", code);
        }
      };
      this._exitPromise = new Promise((resolve) => {
        this._resolveExitPromise = resolve;
      });
      this._pendingEvent = null;
      this._scheduledTimeouts = /* @__PURE__ */ new Map();
      this._nextCallbackTimeoutID = 1;
      const setInt64 = (addr, v) => {
        this.mem.setUint32(addr + 0, v, true);
        this.mem.setUint32(addr + 4, Math.floor(v / 4294967296), true);
      };
      const setInt32 = (addr, v) => {
        this.mem.setUint32(addr + 0, v, true);
      };
      const getInt64 = (addr) => {
        const low = this.mem.getUint32(addr + 0, true);
        const high = this.mem.getInt32(addr + 4, true);
        return low + high * 4294967296;
      };
      const loadValue = (addr) => {
        const f2 = this.mem.getFloat64(addr, true);
        if (f2 === 0) {
          return void 0;
        }
        if (!isNaN(f2)) {
          return f2;
        }
        const id = this.mem.getUint32(addr, true);
        return this._values[id];
      };
      const storeValue = (addr, v) => {
        const nanHead = 2146959360;
        if (typeof v === "number" && v !== 0) {
          if (isNaN(v)) {
            this.mem.setUint32(addr + 4, nanHead, true);
            this.mem.setUint32(addr, 0, true);
            return;
          }
          this.mem.setFloat64(addr, v, true);
          return;
        }
        if (v === void 0) {
          this.mem.setFloat64(addr, 0, true);
          return;
        }
        let id = this._ids.get(v);
        if (id === void 0) {
          id = this._idPool.pop();
          if (id === void 0) {
            id = this._values.length;
          }
          this._values[id] = v;
          this._goRefCounts[id] = 0;
          this._ids.set(v, id);
        }
        this._goRefCounts[id]++;
        let typeFlag = 0;
        switch (typeof v) {
          case "object":
            if (v !== null) {
              typeFlag = 1;
            }
            break;
          case "string":
            typeFlag = 2;
            break;
          case "symbol":
            typeFlag = 3;
            break;
          case "function":
            typeFlag = 4;
            break;
        }
        this.mem.setUint32(addr + 4, nanHead | typeFlag, true);
        this.mem.setUint32(addr, id, true);
      };
      const loadSlice = (addr) => {
        const array = getInt64(addr + 0);
        const len = getInt64(addr + 8);
        return new Uint8Array(this._inst.exports.mem.buffer, array, len);
      };
      const loadSliceOfValues = (addr) => {
        const array = getInt64(addr + 0);
        const len = getInt64(addr + 8);
        const a2 = new Array(len);
        for (let i = 0; i < len; i++) {
          a2[i] = loadValue(array + i * 8);
        }
        return a2;
      };
      const loadString = (addr) => {
        const saddr = getInt64(addr + 0);
        const len = getInt64(addr + 8);
        return decoder.decode(new DataView(this._inst.exports.mem.buffer, saddr, len));
      };
      const testCallExport = (a2, b2) => {
        this._inst.exports.testExport0();
        return this._inst.exports.testExport(a2, b2);
      };
      const timeOrigin = Date.now() - performance.now();
      this.importObject = {
        _gotest: {
          add: (a2, b2) => a2 + b2,
          callExport: testCallExport
        },
        gojs: {
          // Go's SP does not change as long as no Go code is running. Some operations (e.g. calls, getters and setters)
          // may synchronously trigger a Go event handler. This makes Go code get executed in the middle of the imported
          // function. A goroutine can switch to a new stack if the current stack is too small (see morestack function).
          // This changes the SP, thus we have to update the SP used by the imported function.
          // func wasmExit(code int32)
          "runtime.wasmExit": (sp) => {
            sp >>>= 0;
            const code = this.mem.getInt32(sp + 8, true);
            this.exited = true;
            delete this._inst;
            delete this._values;
            delete this._goRefCounts;
            delete this._ids;
            delete this._idPool;
            this.exit(code);
          },
          // func wasmWrite(fd uintptr, p unsafe.Pointer, n int32)
          "runtime.wasmWrite": (sp) => {
            sp >>>= 0;
            const fd = getInt64(sp + 8);
            const p = getInt64(sp + 16);
            const n2 = this.mem.getInt32(sp + 24, true);
            fs.writeSync(fd, new Uint8Array(this._inst.exports.mem.buffer, p, n2));
          },
          // func resetMemoryDataView()
          "runtime.resetMemoryDataView": (sp) => {
            sp >>>= 0;
            this.mem = new DataView(this._inst.exports.mem.buffer);
          },
          // func nanotime1() int64
          "runtime.nanotime1": (sp) => {
            sp >>>= 0;
            setInt64(sp + 8, (timeOrigin + performance.now()) * 1e6);
          },
          // func walltime() (sec int64, nsec int32)
          "runtime.walltime": (sp) => {
            sp >>>= 0;
            const msec = (/* @__PURE__ */ new Date()).getTime();
            setInt64(sp + 8, msec / 1e3);
            this.mem.setInt32(sp + 16, msec % 1e3 * 1e6, true);
          },
          // func scheduleTimeoutEvent(delay int64) int32
          "runtime.scheduleTimeoutEvent": (sp) => {
            sp >>>= 0;
            const id = this._nextCallbackTimeoutID;
            this._nextCallbackTimeoutID++;
            this._scheduledTimeouts.set(id, setTimeout(
              () => {
                this._resume();
                while (this._scheduledTimeouts.has(id)) {
                  console.warn("scheduleTimeoutEvent: missed timeout event");
                  this._resume();
                }
              },
              getInt64(sp + 8)
            ));
            this.mem.setInt32(sp + 16, id, true);
          },
          // func clearTimeoutEvent(id int32)
          "runtime.clearTimeoutEvent": (sp) => {
            sp >>>= 0;
            const id = this.mem.getInt32(sp + 8, true);
            clearTimeout(this._scheduledTimeouts.get(id));
            this._scheduledTimeouts.delete(id);
          },
          // func getRandomData(r []byte)
          "runtime.getRandomData": (sp) => {
            sp >>>= 0;
            crypto.getRandomValues(loadSlice(sp + 8));
          },
          // func finalizeRef(v ref)
          "syscall/js.finalizeRef": (sp) => {
            sp >>>= 0;
            const id = this.mem.getUint32(sp + 8, true);
            this._goRefCounts[id]--;
            if (this._goRefCounts[id] === 0) {
              const v = this._values[id];
              this._values[id] = null;
              this._ids.delete(v);
              this._idPool.push(id);
            }
          },
          // func stringVal(value string) ref
          "syscall/js.stringVal": (sp) => {
            sp >>>= 0;
            storeValue(sp + 24, loadString(sp + 8));
          },
          // func valueGet(v ref, p string) ref
          "syscall/js.valueGet": (sp) => {
            sp >>>= 0;
            const result = Reflect.get(loadValue(sp + 8), loadString(sp + 16));
            sp = this._inst.exports.getsp() >>> 0;
            storeValue(sp + 32, result);
          },
          // func valueSet(v ref, p string, x ref)
          "syscall/js.valueSet": (sp) => {
            sp >>>= 0;
            Reflect.set(loadValue(sp + 8), loadString(sp + 16), loadValue(sp + 32));
          },
          // func valueDelete(v ref, p string)
          "syscall/js.valueDelete": (sp) => {
            sp >>>= 0;
            Reflect.deleteProperty(loadValue(sp + 8), loadString(sp + 16));
          },
          // func valueIndex(v ref, i int) ref
          "syscall/js.valueIndex": (sp) => {
            sp >>>= 0;
            storeValue(sp + 24, Reflect.get(loadValue(sp + 8), getInt64(sp + 16)));
          },
          // valueSetIndex(v ref, i int, x ref)
          "syscall/js.valueSetIndex": (sp) => {
            sp >>>= 0;
            Reflect.set(loadValue(sp + 8), getInt64(sp + 16), loadValue(sp + 24));
          },
          // func valueCall(v ref, m string, args []ref) (ref, bool)
          "syscall/js.valueCall": (sp) => {
            sp >>>= 0;
            try {
              const v = loadValue(sp + 8);
              const m = Reflect.get(v, loadString(sp + 16));
              const args = loadSliceOfValues(sp + 32);
              const result = Reflect.apply(m, v, args);
              sp = this._inst.exports.getsp() >>> 0;
              storeValue(sp + 56, result);
              this.mem.setUint8(sp + 64, 1);
            } catch (err) {
              sp = this._inst.exports.getsp() >>> 0;
              storeValue(sp + 56, err);
              this.mem.setUint8(sp + 64, 0);
            }
          },
          // func valueInvoke(v ref, args []ref) (ref, bool)
          "syscall/js.valueInvoke": (sp) => {
            sp >>>= 0;
            try {
              const v = loadValue(sp + 8);
              const args = loadSliceOfValues(sp + 16);
              const result = Reflect.apply(v, void 0, args);
              sp = this._inst.exports.getsp() >>> 0;
              storeValue(sp + 40, result);
              this.mem.setUint8(sp + 48, 1);
            } catch (err) {
              sp = this._inst.exports.getsp() >>> 0;
              storeValue(sp + 40, err);
              this.mem.setUint8(sp + 48, 0);
            }
          },
          // func valueNew(v ref, args []ref) (ref, bool)
          "syscall/js.valueNew": (sp) => {
            sp >>>= 0;
            try {
              const v = loadValue(sp + 8);
              const args = loadSliceOfValues(sp + 16);
              const result = Reflect.construct(v, args);
              sp = this._inst.exports.getsp() >>> 0;
              storeValue(sp + 40, result);
              this.mem.setUint8(sp + 48, 1);
            } catch (err) {
              sp = this._inst.exports.getsp() >>> 0;
              storeValue(sp + 40, err);
              this.mem.setUint8(sp + 48, 0);
            }
          },
          // func valueLength(v ref) int
          "syscall/js.valueLength": (sp) => {
            sp >>>= 0;
            setInt64(sp + 16, parseInt(loadValue(sp + 8).length));
          },
          // valuePrepareString(v ref) (ref, int)
          "syscall/js.valuePrepareString": (sp) => {
            sp >>>= 0;
            const str = encoder.encode(String(loadValue(sp + 8)));
            storeValue(sp + 16, str);
            setInt64(sp + 24, str.length);
          },
          // valueLoadString(v ref, b []byte)
          "syscall/js.valueLoadString": (sp) => {
            sp >>>= 0;
            const str = loadValue(sp + 8);
            loadSlice(sp + 16).set(str);
          },
          // func valueInstanceOf(v ref, t ref) bool
          "syscall/js.valueInstanceOf": (sp) => {
            sp >>>= 0;
            this.mem.setUint8(sp + 24, loadValue(sp + 8) instanceof loadValue(sp + 16) ? 1 : 0);
          },
          // func copyBytesToGo(dst []byte, src ref) (int, bool)
          "syscall/js.copyBytesToGo": (sp) => {
            sp >>>= 0;
            const dst = loadSlice(sp + 8);
            const src = loadValue(sp + 32);
            if (!(src instanceof Uint8Array || src instanceof Uint8ClampedArray)) {
              this.mem.setUint8(sp + 48, 0);
              return;
            }
            const toCopy = src.subarray(0, dst.length);
            dst.set(toCopy);
            setInt64(sp + 40, toCopy.length);
            this.mem.setUint8(sp + 48, 1);
          },
          // func copyBytesToJS(dst ref, src []byte) (int, bool)
          "syscall/js.copyBytesToJS": (sp) => {
            sp >>>= 0;
            const dst = loadValue(sp + 8);
            const src = loadSlice(sp + 16);
            if (!(dst instanceof Uint8Array || dst instanceof Uint8ClampedArray)) {
              this.mem.setUint8(sp + 48, 0);
              return;
            }
            const toCopy = src.subarray(0, dst.length);
            dst.set(toCopy);
            setInt64(sp + 40, toCopy.length);
            this.mem.setUint8(sp + 48, 1);
          },
          "debug": (value) => {
            console.log(value);
          }
        }
      };
    }
    async run(instance) {
      if (!(instance instanceof WebAssembly.Instance)) {
        throw new Error("Go.run: WebAssembly.Instance expected");
      }
      this._inst = instance;
      this.mem = new DataView(this._inst.exports.mem.buffer);
      this._values = [
        // JS values that Go currently has references to, indexed by reference id
        NaN,
        0,
        null,
        true,
        false,
        globalThis,
        this
      ];
      this._goRefCounts = new Array(this._values.length).fill(Infinity);
      this._ids = /* @__PURE__ */ new Map([
        // mapping from JS values to reference ids
        [0, 1],
        [null, 2],
        [true, 3],
        [false, 4],
        [globalThis, 5],
        [this, 6]
      ]);
      this._idPool = [];
      this.exited = false;
      let offset = 4096;
      const strPtr = (str) => {
        const ptr = offset;
        const bytes = encoder.encode(str + "\0");
        new Uint8Array(this.mem.buffer, offset, bytes.length).set(bytes);
        offset += bytes.length;
        if (offset % 8 !== 0) {
          offset += 8 - offset % 8;
        }
        return ptr;
      };
      const argc = this.argv.length;
      const argvPtrs = [];
      this.argv.forEach((arg) => {
        argvPtrs.push(strPtr(arg));
      });
      argvPtrs.push(0);
      const keys = Object.keys(this.env).sort();
      keys.forEach((key) => {
        argvPtrs.push(strPtr(`${key}=${this.env[key]}`));
      });
      argvPtrs.push(0);
      const argv = offset;
      argvPtrs.forEach((ptr) => {
        this.mem.setUint32(offset, ptr, true);
        this.mem.setUint32(offset + 4, 0, true);
        offset += 8;
      });
      const wasmMinDataAddr = 4096 + 8192;
      if (offset >= wasmMinDataAddr) {
        throw new Error("total length of command line and environment variables exceeds limit");
      }
      this._inst.exports.run(argc, argv);
      if (this.exited) {
        this._resolveExitPromise();
      }
      await this._exitPromise;
    }
    _resume() {
      if (this.exited) {
        throw new Error("Go program has already exited");
      }
      this._inst.exports.resume();
      if (this.exited) {
        this._resolveExitPromise();
      }
    }
    _makeFuncWrapper(id) {
      const go = this;
      return function() {
        const event = { id, this: this, args: arguments };
        go._pendingEvent = event;
        go._resume();
        return event.result;
      };
    }
  };
})();

// vendor/mpc/loader.js
var promise;
function loadMpcWasm2(options = {}) {
  if (!promise) promise = (async () => {
    const bytes = options.wasmBytes || await (await fetch(new URL("./mpc.wasm", import.meta.url))).arrayBuffer();
    const go = new globalThis.Go();
    const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
    go.run(instance).catch(() => {
    });
    for (let i = 0; i < 100; i++) {
      if (globalThis.mpcWasm) return globalThis.mpcWasm;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw Error("MPC WebAssembly did not initialize.");
  })();
  return promise;
}

// tests/rsa-operation-source.js
var api = await loadMpcWasm2({ wasmBytes: await readFile(new URL("../vendor/mpc/mpc.wasm", import.meta.url)) });
var pair = await crypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["encrypt", "decrypt"]);
var jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
var decode = (s) => Buffer.from(s, "base64url");
var n = decode(jwk.n).toString("base64");
var e = decode(jwk.e).toString("base64");
var d = BigInt("0x" + decode(jwk.d).toString("hex"));
var b64int = (i) => {
  let h = i.toString(16);
  if (h.length % 2) h = "0" + h;
  return Buffer.from(h, "hex").toString("base64");
};
var coefficient = BigInt("0x" + crypto.getRandomValues(new Uint8Array(32)).reduce((s, b2) => s + b2.toString(16).padStart(2, "0"), ""));
var data = crypto.getRandomValues(new Uint8Array(32));
var cipher = Buffer.from(await crypto.subtle.encrypt({ name: "RSA-OAEP" }, pair.publicKey, data)).toString("base64");
var collectEnabled = false;
var queues = { a: [], b: [] };
var submitted = { a: [], b: [] };
var broadcasts = [];
var current = { a: 2, b: 1 };
var original = { a: 1, b: 2 };
var make = (sid) => {
  const session = new RSASession();
  session.apiPromise = Promise.resolve(api);
  session.loadKeyShare = async () => JSON.stringify({ n, e, dShare: b64int(d + coefficient * BigInt(original[sid])) });
  const ctx = { sidecarId: sid, client: { updateTask: async (m) => submitted[sid].push(m) }, peerChannel: {
    sendMessage: async (_client, taskId, fromSidecar, from, peer, to, round, bytes) => {
      assert.equal(from, current[sid]);
      assert.equal(to, current[peer]);
      assert.equal(round, 0);
      assert.equal(taskId, "fictional-decrypt");
      broadcasts.push(sid);
      queues[peer].push([from, bytes]);
    },
    collectMessages: async () => {
      if (!collectEnabled) return /* @__PURE__ */ new Map();
      const result = new Map(queues[sid]);
      queues[sid] = [];
      return result;
    }
  } };
  const dispatcher = new TaskDispatcher();
  dispatcher.register(session);
  return { session, ctx, dispatcher };
};
var a = make("a");
var b = make("b");
assert.equal(a.session.canHandle({ Operation: "Decrypt", ServerData: JSON.stringify({ protocol: "rsa-n-decrypt" }) }), true);
assert.equal(a.session.canHandle({ Operation: "Sign", ServerData: { protocol: "rsa-n-sign" } }), true);
assert.equal(a.session.canHandle({ Operation: "Decrypt", ServerData: { protocol: "unrelated" } }), false);
var task = { TaskId: "fictional-decrypt", KeyId: "fictional-key", Operation: "Decrypt", Round: 0, PartyIdMap: current, ServerData: { protocol: "rsa-n-decrypt", partyIDMap: current, dkgPartyIDMap: original, ciphertext: cipher, encryptionAlgorithm: "RSAES_OAEP_SHA_256" } };
await a.dispatcher.dispatch(task, a.ctx);
var first = submitted.a[0].ClientData;
assert.deepEqual(Object.keys(first).sort(), ["data", "round", "sidecarId"]);
assert.equal(first.round, 0);
assert.equal(first.data.partyId, 1);
assert.equal(first.data.protocol, "rsa-n-decrypt");
assert.ok(first.data.partialResult);
assert.equal(first.partialResult, void 0);
await b.dispatcher.dispatch(task, b.ctx);
assert.equal(submitted.a[0].ClientData.data.complete, void 0);
assert.equal(submitted.b[0].ClientData.data.complete, void 0);
collectEnabled = true;
await a.dispatcher.dispatch(task, a.ctx);
await b.dispatcher.dispatch(task, b.ctx);
for (const sid of ["a", "b"]) {
  const last = submitted[sid].at(-1).ClientData.data;
  assert.equal(last.complete, true);
  assert.deepEqual(Buffer.from(last.plaintext, "base64"), Buffer.from(data));
  assert.ok(!JSON.stringify(submitted[sid]).includes("dShare"));
}
await a.dispatcher.dispatch(task, a.ctx);
assert.equal(broadcasts.length, 2);
assert.deepEqual(unwrapRsaOperationContribution({ data: first.data }), first.data);
assert.deepEqual(unwrapRsaOperationContribution({ data: Buffer.from(JSON.stringify(first.data)).toString("base64") }), first.data);
var bad = new RSASession();
bad.apiPromise = Promise.resolve(api);
bad.loadKeyShare = a.session.loadKeyShare;
await assert.rejects(() => bad.process({ ...task, PartyIdMap: {}, ServerData: { ciphertext: cipher } }, a.ctx), /valid party configuration/);
var ordinary = new TaskDispatcher();
var ordinaryCalls = 0;
ordinary.register({ canHandle: () => true, process: async () => {
  ordinaryCalls++;
} });
assert.equal(await ordinary.dispatch({ ...task, Operation: "CreateKey" }, a.ctx), true);
assert.equal(await ordinary.dispatch({ ...task, Operation: "CreateKey" }, a.ctx), false);
assert.equal(ordinaryCalls, 1);
collectEnabled = false;
queues.a = [];
queues.b = [];
submitted.a = [];
submitted.b = [];
var c = make("a");
var f = make("b");
var errors = [];
var progress = [];
async function poll(peer, sid) {
  const wire = { ...task, Status: "AWAITING_CLIENT", PartyIdMap: void 0, ServerData: JSON.stringify(task.ServerData) };
  peer.ctx.client.listTasksForSidecar = async () => ({ Tasks: [wire] });
  peer.ctx.client.call = async (method) => method === "GetSidecar" ? { IdentityKey: Buffer.alloc(57, 1).toString("base64"), SignedPreKey: Buffer.alloc(57, 2).toString("base64") } : { Messages: [] };
  peer.ctx.peerChannel.performHandshakeWithMessages = async () => true;
  const loop = new PollLoop({ client: peer.ctx.client, dispatcher: peer.dispatcher, identity: { sidecarId: sid }, peerChannel: peer.ctx.peerChannel, pollIntervalMs: 500, useTofN: true, onError: (e2) => errors.push(e2), onProgress: (s) => progress.push(s) });
  loop.running = true;
  try {
    await loop.tick();
  } finally {
    loop.stop();
  }
}
await poll(c, "a");
await poll(f, "b");
collectEnabled = true;
await poll(c, "a");
await poll(f, "b");
assert.equal(errors.length, 0);
assert.equal(progress.filter((s) => s === "protocol-contribution-submitted").length, 4);
for (const sid of ["a", "b"]) {
  const final = submitted[sid].at(-1).ClientData.data;
  assert.equal(final.complete, true);
  assert.deepEqual(Buffer.from(final.plaintext, "base64"), Buffer.from(data));
}
console.log("PASS LOCAL: two synthetic RSA shares recover random 32-byte OAEP key through actual Go WASM; native round/data envelope, peer broadcast, original vs current party mapping, cached completion, same-round late peer delivery through real TaskDispatcher, and fail-closed missing mapping. Full PollLoop/normalizer/dispatcher/session exercised with native-style nested-only protocol metadata and delayed peer delivery. Mocked task server and relay; no live QKMS.");
process.exit(0);
