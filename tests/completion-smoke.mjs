// tests/completion-source.js
import assert from "node:assert/strict";

// upstream/sdk-core/sidecar/sessions/rsa.ts
import { loadMpcWasm } from "../vendor/mpc/loader.js";
function bytesToBase64(bytes) {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function base64ToBytes(b64) {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function decodeWireBytes(value) {
  if (value == null) return new Uint8Array();
  if (typeof value === "string") return base64ToBytes(value);
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
  async process(task2, ctx2) {
    const operation = (task2.Operation ?? "").toLowerCase();
    if (operation === "createkey") {
      await this.processDKG(task2, ctx2);
    } else if (operation === "sign" || operation === "decrypt") {
      await this.processSignOrDecrypt(task2, ctx2, operation === "decrypt");
    } else {
      throw new Error(`RSASession: unsupported operation ${task2.Operation}`);
    }
  }
  // ----- Sign / Decrypt ---------------------------------------------------
  async processSignOrDecrypt(task2, ctx2, isDecrypt) {
    const api = await this.getApi();
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
    const myPartyId = originalMap[ctx2.sidecarId];
    const totalParties = serverData.thresholdConfig?.totalParties ?? Object.keys(originalMap).length;
    const currentPartyId = partyIdMap[ctx2.sidecarId];
    if (!Number.isInteger(myPartyId) || myPartyId < 1 || !Number.isInteger(totalParties) || totalParties < 2 || myPartyId > totalParties || !Number.isInteger(currentPartyId) || currentPartyId < 1) throw new Error("RSA operation missing valid party configuration");
    const inputBytes = decodeWireBytes(isDecrypt ? serverData.ciphertext : serverData.message);
    if (inputBytes.length === 0) throw new Error("RSA operation missing input");
    let state = this.rsaOperationState.get(task2.TaskId);
    if (!state) {
      const partial = parseWasmResponse(api.rsa_shoup_partial(JSON.stringify({ input: bytesToBase64(inputBytes), n: nB64, dShare: keyShare.dShare, totalParties })), "rsa_shoup_partial");
      state = { own: partial.partial, others: {}, sent: /* @__PURE__ */ new Set() };
      this.rsaOperationState.set(task2.TaskId, state);
    }
    const protocol = isDecrypt ? "rsa-n-decrypt" : "rsa-n-sign";
    const partialPayload = { protocol, partyId: myPartyId, partialResult: state.own };
    if (ctx2.peerChannel) {
      for (const [peerId, peerParty] of Object.entries(partyIdMap)) {
        if (peerId === ctx2.sidecarId || state.sent.has(peerId)) continue;
        await ctx2.peerChannel.sendMessage(ctx2.client, task2.TaskId, ctx2.sidecarId, currentPartyId, peerId, peerParty, 0, new TextEncoder().encode(JSON.stringify(partialPayload)));
        state.sent.add(peerId);
      }
    }
    const accept = (raw, expected) => {
      const c = unwrapRsaOperationContribution(raw);
      if (!c || !Number.isInteger(c.partyId) || c.partyId === myPartyId || c.partyId < 1 || c.partyId > totalParties || c.partialResult == null) return;
      if (expected != null && c.partyId !== expected) throw new Error("RSA peer contribution has wrong original party id");
      const bytes = decodeWireBytes(c.partialResult);
      if (bytes.length === 0 || bytes.length > decodeWireBytes(nB64).length) throw new Error("RSA peer partial has invalid size");
      const encoded = bytesToBase64(bytes), previous = state.others[String(c.partyId)];
      if (previous && previous !== encoded) throw new Error("RSA peer partial changed");
      state.others[String(c.partyId)] = encoded;
    };
    for (const [sid, raw] of Object.entries(serverData.partyContributions ?? {})) {
      if (sid !== ctx2.sidecarId && originalMap[sid] != null) accept(raw, originalMap[sid]);
    }
    if (ctx2.peerChannel) {
      const messages = await ctx2.peerChannel.collectMessages(ctx2.client, task2.TaskId, ctx2.sidecarId, currentPartyId, 0, partyIdMap);
      for (const [from, bytes] of messages) {
        const peerId = Object.entries(partyIdMap).find(([, id]) => id === from)?.[0];
        if (peerId && peerId !== ctx2.sidecarId) accept(JSON.parse(new TextDecoder().decode(bytes)), originalMap[peerId]);
      }
    }
    if (!state.complete && Object.keys(state.others).length > 0) {
      const threshold = serverData.thresholdConfig?.threshold ?? totalParties;
      if (!Number.isInteger(threshold) || threshold < 2 || threshold > totalParties) throw new Error("RSA operation missing valid threshold");
      if (Object.keys(state.others).length + 1 >= threshold) {
        const args = { input: bytesToBase64(inputBytes), n: nB64, e: eB64, totalParties, partials: { ...state.others, [String(myPartyId)]: state.own } };
        if (isDecrypt) args.unpadOaep = serverData.encryptionAlgorithm ?? "RSAES_OAEP_SHA_256";
        const combined = parseWasmResponse(api.rsa_shoup_combine(JSON.stringify(args)), "rsa_shoup_combine");
        state.complete = { protocol, partyId: myPartyId, complete: true, ...isDecrypt ? { plaintext: combined.result } : { signature: combined.result } };
      }
    }
    await ctx2.client.updateTask({ TaskId: task2.TaskId, ClientData: { sidecarId: ctx2.sidecarId, round: task2.Round, data: state.complete ?? partialPayload } });
  }
  // ----- DKG --------------------------------------------------------------
  async processDKG(task2, ctx2) {
    const api = await this.getApi();
    const serverData = parseServerData(task2);
    const partyIdMap = serverData.partyIDMap ?? {};
    const myPartyId = partyIdMap[ctx2.sidecarId];
    if (myPartyId == null) {
      throw new Error(`RSA DKG: sidecar id ${ctx2.sidecarId} not in partyIDMap`);
    }
    const completed = this.completedKeyShares.get(task2.TaskId);
    if (completed) {
      await ctx2.client.updateTask({
        TaskId: task2.TaskId,
        ClientData: {
          sidecarId: ctx2.sidecarId,
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
        await ctx2.client.updateTask({
          TaskId: task2.TaskId,
          ClientData: {
            sidecarId: ctx2.sidecarId,
            partyId: myPartyId,
            round: task2.Round
          }
        });
        return;
      }
      const initJson = api.rsa_dkg_init(
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
      await ctx2.client.updateTask({
        TaskId: task2.TaskId,
        ClientData: {
          sidecarId: ctx2.sidecarId,
          partyId: myPartyId,
          round: task2.Round,
          // The Go sidecar wraps the DKG message in a `data` field — preserve
          // that shape so server-side relay code can unwrap it the same way.
          data: JSON.parse(new TextDecoder().decode(base64ToBytes(initRes.data)))
        }
      });
      return;
    }
    let lastOutput = null;
    let completedKeyShare = null;
    for (const [sidecarKey, rawContrib] of Object.entries(serverData.partyContributions ?? {})) {
      if (sidecarKey === ctx2.sidecarId) continue;
      const contrib = this.unwrapContribution(rawContrib);
      if (!contrib || contrib.data == null) continue;
      const messages = Array.isArray(contrib.data) ? contrib.data : [contrib.data];
      for (const msg of messages) {
        const toParty = msg.toParty ?? 0;
        if (toParty !== 0 && toParty !== myPartyId) continue;
        const incomingB64 = bytesToBase64(new TextEncoder().encode(JSON.stringify(msg)));
        const roundJson = api.rsa_dkg_round(
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
      await ctx2.client.updateTask({
        TaskId: task2.TaskId,
        ClientData: {
          sidecarId: ctx2.sidecarId,
          partyId: myPartyId,
          round: task2.Round,
          ...rsaCompletionMetadata(completedKeyShare, this.exportPrivateShareForTest)
        }
      });
      return;
    }
    if (lastOutput == null) {
      await ctx2.client.updateTask({
        TaskId: task2.TaskId,
        ClientData: {
          sidecarId: ctx2.sidecarId,
          partyId: myPartyId,
          round: task2.Round
        }
      });
      return;
    }
    await ctx2.client.updateTask({
      TaskId: task2.TaskId,
      ClientData: {
        sidecarId: ctx2.sidecarId,
        partyId: myPartyId,
        round: task2.Round,
        data: JSON.parse(new TextDecoder().decode(base64ToBytes(lastOutput)))
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
  const n2 = base64ToBytes(share.n), e2 = base64ToBytes(share.e);
  if (![256, 384, 512].includes(n2.length) || e2.length === 0 || e2.length > 8) throw new Error("Invalid RSA public key at completion");
  const result = { complete: true, publicKey: bytesToBase64(new TextEncoder().encode(JSON.stringify({ n: share.n, e: share.e }))) };
  if (exportPrivateShareForTest) {
    if (typeof share.dShare !== "string" || !share.dShare.length || share.dShare.length > 4096) throw new Error("Missing or oversized test private share");
    base64ToBytes(share.dShare);
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
          value = JSON.parse(new TextDecoder().decode(base64ToBytes(value)));
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

// tests/completion-source.js
var n = Buffer.alloc(256, 1).toString("base64");
var e = Buffer.from([1, 0, 1]).toString("base64");
var secret = Buffer.from("SYNTHETIC_PRIVATE_SHARE_NEVER_SEND").toString("base64");
var complete = rsaCompletionMetadata({ n, e, dShare: secret });
assert.equal(complete.complete, true);
assert.deepEqual(JSON.parse(Buffer.from(complete.publicKey, "base64").toString()), { n, e });
assert.ok(!JSON.stringify(complete).includes(secret));
assert.equal(complete.privateKey, void 0);
assert.throws(() => rsaCompletionMetadata({ n: "AQ==", e }), /Invalid/);
var session = new RSASession();
var stored = false;
var wasmCalls = 0;
var submissions = [];
session.apiPromise = Promise.resolve({ rsa_dkg_round: () => {
  wasmCalls++;
  return JSON.stringify({ complete: true, publicKeyN: n, publicKeyE: e, privShare: secret });
} });
session.onKeyShareReady = async (_id, json) => {
  assert.equal(JSON.parse(json).dShare, secret);
  stored = true;
};
var task = { TaskId: "fictional-task", KeyId: "fictional-key", Operation: "CreateKey", KeySpec: "RSA_2048", Round: 9, ServerData: { partyIDMap: { a: 1, b: 2 }, partyContributions: { b: { data: { phase: 8, toParty: 0 } } } } };
var ctx = { sidecarId: "a", client: { updateTask: async (m) => submissions.push(m) } };
await session.process(task, ctx);
assert.equal(stored, true);
assert.equal(submissions.length, 1);
assert.equal(submissions[0].ClientData.publicKey, complete.publicKey);
assert.ok(!JSON.stringify(submissions).includes(secret));
assert.equal(submissions[0].ClientData.privateKey, void 0);
await session.process(task, ctx);
assert.equal(wasmCalls, 1);
assert.equal(submissions[1].ClientData.publicKey, complete.publicKey);
var firstRound = new RSASession();
firstRound.requirePrepared = true;
var initRequest;
firstRound.apiPromise = Promise.resolve({ rsa_dkg_init: (json) => {
  initRequest = JSON.parse(json);
  return JSON.stringify({ data: Buffer.from(JSON.stringify({ phase: 1, fromParty: 1, toParty: 0 })).toString("base64") });
} });
await firstRound.process({ ...task, Round: 0 }, ctx);
assert.equal(initRequest.requirePrepared, true);
assert.equal(initRequest.partyId, 1);
console.log("PASS: fresh/cached DKG completion includes public n/e metadata; private share only reaches local storage callback, never UpdateTask. Mocked protocol output; live server acceptance unverified.");
var exported = rsaCompletionMetadata({ n, e, dShare: secret }, true);
assert.deepEqual(JSON.parse(Buffer.from(exported.privateKey, "base64").toString()), { dShare: secret, n, e });
assert.throws(() => rsaCompletionMetadata({ n, e }, true), /Missing/);
var opted = new RSASession();
opted.exportPrivateShareForTest = true;
opted.apiPromise = Promise.resolve({ rsa_dkg_round: () => JSON.stringify({ complete: true, publicKeyN: n, publicKeyE: e, privShare: secret }) });
var sent = [];
var optCtx = { sidecarId: "a", client: { updateTask: async (m) => sent.push(m) } };
await opted.process(task, optCtx);
await opted.process(task, optCtx);
assert.equal(sent.length, 2);
for (const m of sent) assert.deepEqual(JSON.parse(Buffer.from(m.ClientData.privateKey, "base64").toString()), { dShare: secret, n, e });
console.log("PASS: explicit synthetic-test opt-in sends base64 JSON n/e/dShare in fresh and cached completion; default remains public-only. Mocked network only.");
