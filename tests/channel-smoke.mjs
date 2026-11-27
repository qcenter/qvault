// tests/channel-source.js
import init from "../vendor/channel/channelwasm.js";

// upstream/sdk-core/sidecar/identity.ts
import * as channelwasm from "../vendor/channel/channelwasm.js";
function jsonBytesToUint8(arr) {
  return Uint8Array.from(arr);
}
function bytesToHex(bytes2) {
  let s = "";
  for (let i = 0; i < bytes2.length; i++) s += bytes2[i].toString(16).padStart(2, "0");
  return s;
}
function bytesToBase64(bytes2) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes2).toString("base64");
  }
  let s = "";
  for (let i = 0; i < bytes2.length; i++) s += String.fromCharCode(bytes2[i]);
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
      identityKey: base64ToBytes2(resp.SidecarIdentity?.IdentityKey ?? resp.IdentityKey),
      signedPreKey: base64ToBytes2(resp.SidecarIdentity?.SignedPreKey ?? resp.SignedPreKey)
    };
  }
};

// tests/channel-source.js
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
await init({ module_or_path: await readFile(new URL("../vendor/channel/channelwasm_bg.wasm", import.meta.url)) });
var a = await generateIdentity();
var b = await generateIdentity();
assert.notEqual(a.sidecarId, b.sidecarId);
var bytes = (hex) => Uint8Array.from(Buffer.from(hex, "hex"));
var ca = new PeerChannel(a);
var cb = new PeerChannel(b);
ca.establishSession(b.sidecarId, true, bytes(b.identityPublicX448), bytes(b.signedPreKeyPublicX448));
cb.establishSession(a.sidecarId, false, bytes(a.identityPublicX448), bytes(a.signedPreKeyPublicX448));
var plain = new TextEncoder().encode("fictional browser-only channel test");
var ciphertext = ca.encrypt(b.sidecarId, plain);
assert.deepEqual(cb.decrypt(a.sidecarId, ciphertext), plain);
var reply = cb.encrypt(a.sidecarId, plain);
assert.deepEqual(ca.decrypt(b.sidecarId, reply), plain);
console.log("PASS LOCAL: actual channel WASM identity, X3DH and bidirectional double-ratchet roundtrip. No network or real credentials.");
var identities = [a, b].sort((x, y) => x.sidecarId.localeCompare(y.sidecarId));
var sender = new PeerChannel(identities[0]);
var receiver = new PeerChannel(identities[1]);
var peer = (i) => ({ identityKey: bytes(i.identityPublicX448), signedPreKey: bytes(i.signedPreKeyPublicX448) });
for (const task of ["synthetic-create", "synthetic-decrypt"]) {
  const messages = [];
  const client = { call: async (method, m) => {
    assert.equal(method, "SendPartyMessage");
    messages.push({ fromParty: m.FromParty, round: m.Round, encrypted: m.Encrypted, envelope: m.Envelope });
  } };
  assert.equal(await sender.performHandshakeWithMessages(client, task, identities[0].sidecarId, 1, identities[1].sidecarId, 2, peer(identities[1]), [], []), false);
  assert.equal(await receiver.performHandshakeWithMessages(client, task, identities[1].sidecarId, 2, identities[0].sidecarId, 1, peer(identities[0]), messages.filter((m) => m.round === 0), []), true);
  assert.equal(await sender.performHandshakeWithMessages(client, task, identities[0].sidecarId, 1, identities[1].sidecarId, 2, peer(identities[1]), [], messages.filter((m) => m.round === 1)), true);
  assert.deepEqual(receiver.decrypt(identities[0].sidecarId, sender.encrypt(identities[1].sidecarId, plain, task), task), plain);
}
console.log("PASS LOCAL: consecutive CreateKey/Decrypt task handshakes with real channel WASM and mocked relay.");
for (const task of ["synthetic-create", "synthetic-decrypt", "synthetic-create"]) {
  assert.deepEqual(receiver.decrypt(identities[0].sidecarId, sender.encrypt(identities[1].sidecarId, plain, task), task), plain);
  assert.deepEqual(sender.decrypt(identities[1].sidecarId, receiver.encrypt(identities[0].sidecarId, plain, task), task), plain);
}
console.log("PASS LOCAL: interleaved task-scoped ratchets remain independent.");
async function hostedPair(reuse) {
  const clientChannel = new PeerChannel(a, { reuseAcrossTasks: reuse });
  const serverId = "server-sidecar-001", service = new PeerChannel(b, { reuseAcrossTasks: true });
  const relay = [];
  const rpc = { call: async (method, m) => {
    assert.equal(method, "SendPartyMessage");
    relay.push({ fromParty: m.FromParty, round: m.Round, encrypted: m.Encrypted, envelope: m.Envelope, task: m.TaskId });
  } };
  async function handshake(task) {
    const first = await clientChannel.performHandshakeWithMessages(rpc, task, a.sidecarId, 2, serverId, 1, peer(b), [], []);
    if (first) return true;
    await service.performHandshakeWithMessages(rpc, task, serverId, 1, a.sidecarId, 2, peer(a), relay.filter((m) => m.task === task && m.round === 0), []);
    return clientChannel.performHandshakeWithMessages(rpc, task, a.sidecarId, 2, serverId, 1, peer(b), [], relay.filter((m) => m.task === task && m.round === 1));
  }
  assert.equal(await handshake("fixture-hosted-create"), true);
  const count = relay.length;
  const ready = await handshake("fixture-hosted-decrypt");
  if (!reuse) {
    assert.equal(ready, false);
    assert.equal(relay.length, count + 1);
    return;
  }
  assert.equal(ready, true);
  assert.equal(relay.length, count, "No second hello/ACK when native peer session is already ready");
  for (const task of ["fixture-hosted-create", "fixture-hosted-decrypt", "fixture-hosted-decrypt-2"]) {
    assert.deepEqual(service.decrypt(a.sidecarId, clientChannel.encrypt(serverId, plain, task), task), plain);
    assert.deepEqual(clientChannel.decrypt(serverId, service.encrypt(a.sidecarId, plain, task), task), plain);
  }
}
await hostedPair(false);
await hostedPair(true);
console.log("PASS LOCAL: old task-scoped browser reproduces waiting-for-ACK against a native-style persistent peer; explicit hosted compatibility reuses readiness and real ratchet through CreateKey and two Decrypt tasks. Mocked relay/native model, no hosted service tested.");
