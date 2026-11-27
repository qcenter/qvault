// tests/poll-source.js
import assert from "node:assert/strict";

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

// tests/poll-source.js
var task = { TaskId: "fictional-task", KeyId: "fictional-key", Status: "AWAITING_CLIENT", Operation: "CreateKey", Round: 0, TotalRounds: 10, Participants: ["a", "b"], ServerData: JSON.stringify({ partyIDMap: { a: 1, b: 2 } }) };
assert.deepEqual(normalizeTask(task).PartyIdMap, { a: 1, b: 2 });
assert.throws(() => normalizeTask({ ...task, PartyIdMap: { a: 1, b: 1 } }), /Invalid/);
var publicBytes = Buffer.alloc(57, 1).toString("base64");
for (const response of [{ IdentityKey: publicBytes, SignedPreKey: publicBytes }, { SidecarIdentity: { IdentityKey: publicBytes, SignedPreKey: publicBytes } }]) {
  const result = await PeerChannel.fetchPeerIdentity({ call: async () => response }, "b");
  assert.equal(result.identityKey.length, 57);
  assert.equal(result.signedPreKey.length, 57);
}
async function tick({ identityFails = false, missingMap = false } = {}) {
  let dispatched = 0;
  const progress = [], errors = [];
  const client = { listTasksForSidecar: async () => ({ Tasks: [missingMap ? { ...task, ServerData: "{}" } : task] }), call: async (method) => {
    if (method === "GetSidecar") {
      if (identityFails) throw new TypeError("synthetic identity failure");
      return { SidecarIdentity: { IdentityKey: publicBytes, SignedPreKey: publicBytes } };
    }
    return { Messages: [] };
  } };
  const loop = new PollLoop({ client, identity: { sidecarId: "a" }, dispatcher: { dispatch: async (t) => {
    assert.equal(t.PartyIdMap.a, 1);
    dispatched++;
  } }, peerChannel: { performHandshakeWithMessages: async () => true }, pollIntervalMs: 500, useTofN: true, onProgress: (s) => progress.push(s), onError: (e) => errors.push(e) });
  loop.running = true;
  await loop.tick();
  loop.stop();
  return { dispatched, progress, errors };
}
var r = await tick();
assert.equal(r.dispatched, 1);
assert.ok(r.progress.includes("protocol-contribution-submitted"));
r = await tick({ identityFails: true });
assert.equal(r.dispatched, 0);
assert.ok(r.progress.includes("peer-identity-failed"));
assert.equal(r.errors.length, 1);
r = await tick({ missingMap: true });
assert.equal(r.dispatched, 0);
assert.ok(r.progress.includes("missing-party-map"));
assert.equal(r.errors.length, 1);
var filtered = 0;
var filteredLoop = new PollLoop({ client: { listTasksForSidecar: async () => ({ Tasks: [task, { ...task, TaskId: "new-task", Operation: "Decrypt" }] }) }, identity: { sidecarId: "a" }, dispatcher: { dispatch: async (t) => {
  assert.equal(t.TaskId, "new-task");
  filtered++;
} }, acceptTask: (t) => t.TaskId !== "fictional-task", pollIntervalMs: 500, useTofN: true });
filteredLoop.running = true;
await filteredLoop.tick();
filteredLoop.stop();
assert.equal(filtered, 1);
async function relaxed({ operation, ready = false, option = true }) {
  const seen = [], progress = [];
  const loop = new PollLoop({ client: { listTasksForSidecar: async () => ({ Tasks: [{ ...task, Operation: operation }] }), call: async (method) => method === "GetSidecar" ? { SidecarIdentity: { IdentityKey: publicBytes, SignedPreKey: publicBytes } } : { Messages: [] } }, identity: { sidecarId: "a" }, dispatcher: { dispatch: async (t, ctx) => {
    seen.push(ctx.peerChannel);
  } }, peerChannel: { performHandshakeWithMessages: async () => ready }, pollIntervalMs: 500, useTofN: true, operationsWithoutPeerSession: option, onProgress: (s) => progress.push(s) });
  loop.running = true;
  await loop.tick();
  loop.stop();
  return { seen, progress };
}
var o = await relaxed({ operation: "Decrypt" });
assert.equal(o.seen.length, 1);
assert.equal(o.seen[0], void 0);
assert.ok(o.progress.includes("operation-without-peer-session"));
o = await relaxed({ operation: "Sign" });
assert.equal(o.seen.length, 1);
assert.equal(o.seen[0], void 0);
o = await relaxed({ operation: "CreateKey" });
assert.equal(o.seen.length, 0);
assert.ok(o.progress.includes("waiting-for-peer-handshake"));
o = await relaxed({ operation: "Decrypt", option: false });
assert.equal(o.seen.length, 0);
assert.ok(o.progress.includes("waiting-for-peer-handshake"));
o = await relaxed({ operation: "Decrypt", ready: true });
assert.equal(o.seen.length, 1);
assert.ok(o.seen[0]);
assert.ok(!o.progress.includes("operation-without-peer-session"));
console.log("PASS: known metadata maps normalized, duplicate party IDs rejected, flat/wrapped peer identities supported; handshake errors surfaced and missing maps cannot dispatch with guessed IDs; with the hosted option sign/decrypt proceed without a ready peer channel while key creation still waits. Mocked RPC only.");
