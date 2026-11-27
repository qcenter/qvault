// tests/setup-vault-source.js
import assert from "node:assert/strict";

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

// src/prepare.js
async function prepareThenCreate({ peers, create, onProgress = () => {
}, isCancelled = () => false, timeoutMs = 12e5 }) {
  if (!peers.length) throw Error("No browser participant connected.");
  await Promise.all(peers.map(async (p, index) => {
    const r = await p.call("prepare", {}, timeoutMs);
    if (isCancelled()) throw Error("Session stopped.");
    if (r.ready !== true || r.keySize !== 2048) throw Error("Participant preparation did not succeed.");
    onProgress(index + 1);
  }));
  if (isCancelled()) throw Error("Session stopped.");
  const checks = await Promise.all(peers.map((p) => p.call("prepared", {}, 15e3)));
  if (isCancelled()) throw Error("Session stopped.");
  if (checks.some((r) => r.ready !== true || r.keySize !== 2048)) throw Error("Local preparation expired or is unavailable. No remote key was created.");
  return create();
}

// src/monitor.js
async function monitorKey({ probe, onProgress = () => {
}, isCancelled = () => false, signal, timeoutMs = 18e4, intervalMs = 2e3 }) {
  if (signal?.aborted) return null;
  let stopped = false, timer, heartbeat, sleepTimer, onAbort;
  const start = Date.now();
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => {
      stopped = true;
      reject(Error("Key did not become ready within the monitoring deadline. Participant/finalization status is NOT VERIFIED. No automatic retry or new key was created."));
    }, timeoutMs);
  });
  heartbeat = setInterval(() => {
    if (!stopped && !isCancelled()) onProgress({ waiting: true, elapsedSeconds: Math.floor((Date.now() - start) / 1e3) });
  }, 1e4);
  const cancelled = new Promise((resolve) => {
    onAbort = () => {
      stopped = true;
      resolve(null);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  const run2 = (async () => {
    while (!stopped && !isCancelled()) {
      const result = await probe();
      if (stopped || isCancelled()) return null;
      onProgress(result);
      if (result.ready) return result;
      if (["TIMED_OUT", "FAILED", "CANCELLED"].includes(result.task?.status)) throw Error("QKMS task ended: " + result.task.status + " at round " + result.task.round + "/" + result.task.totalRounds + ". No usable key is confirmed.");
      await new Promise((resolve) => sleepTimer = setTimeout(resolve, intervalMs));
    }
    return null;
  })();
  try {
    return await Promise.race([run2, expired, cancelled]);
  } finally {
    stopped = true;
    clearTimeout(timer);
    clearInterval(heartbeat);
    clearTimeout(sleepTimer);
    signal?.removeEventListener("abort", onAbort);
  }
}

// src/setup-vault.js
var SetupVaultError = class extends Error {
};
var clean = (t) => String(t ?? "").replace(/[^\w .,:;()\/#-]/g, "").slice(0, 120);
var REMOTE_NOTE = " A QKMS key may have been created for this attempt; it was not deleted, and no vault profile was saved.";
var CHECK_FAILED = "The new key did not pass its encryption check.";
async function createHostedKey({ credentials: credentials2, makePeer, signal, onProgress = () => {
}, onLog = () => {
}, readyTimeoutMs = 6e5, pollMs = 2e3 }) {
  const self = { makePeer, readyTimeoutMs, pollMs };
  let open = true, requested = false, logged = /* @__PURE__ */ new Set();
  const log = (text) => {
    if (open) try {
      onLog(String(text).slice(0, 200));
    } catch {
    }
  };
  const once = (line) => {
    if (logged.has(line)) return;
    if (logged.size < 2e3) logged.add(line);
    log(line);
  };
  const event = (e) => {
    if (!e || typeof e !== "object") return;
    const who = "Local participant", round = Number.isFinite(e.task?.round) && Number.isFinite(e.task?.totalRounds) ? ", round " + e.task.round + "/" + e.task.totalRounds : "";
    if (e.event === "crypto-progress") once(who + ": " + clean(e.stage));
    else if (e.event === "participant-progress") once(who + ": " + clean(e.stage) + round);
    else if (e.event === "participant-error") once(who + " reported: " + clean(e.error) + round);
  };
  const cancelled = () => new SetupVaultError("Vault creation was cancelled." + (requested ? REMOTE_NOTE : " No vault profile was saved."));
  const peers = [], stopAll = () => {
    for (const p of peers) try {
      p?.stop();
    } catch {
    }
  }, live = () => {
    if (signal?.aborted) throw cancelled();
  };
  live();
  signal?.addEventListener("abort", stopAll, { once: true });
  try {
    onProgress("vault-starting");
    log("Starting the local participant.");
    const first = self.makePeer(event);
    peers.push(first);
    const started = await first.call("start", { credentials: credentials2, hosted: true, exportPrivateShareForTest: false, preparationBackend: "rust" }, 6e4);
    live();
    const sidecarId = started?.sidecarId;
    if (typeof sidecarId !== "string" || !/^[a-f0-9]{32}$/.test(sidecarId)) throw Error("The local participant did not start.");
    log("Local participant started (" + sidecarId.slice(0, 8) + "\u2026). The second participant is the hosted QKMS service.");
    onProgress("vault-preparing");
    log("Preparing key material on this device. No key has been requested yet.");
    const made = await prepareThenCreate({ peers: [first], isCancelled: () => !!signal?.aborted, onProgress: () => log("Local preparation finished."), create: () => {
      live();
      onProgress("vault-creating");
      log("Asking QKMS to create the key with the hosted service and this browser.");
      requested = true;
      return first.call("create", { participants: ["service", sidecarId], vault: true }, 9e4);
    } });
    live();
    const keyId2 = made?.keyId;
    if (typeof keyId2 !== "string" || !/^[A-Za-z0-9_:/.-]{1,256}$/.test(keyId2)) throw Error("QKMS returned no usable key identifier.");
    onProgress("vault-waiting");
    log("Key requested: " + keyId2 + ". Waiting for it to become ready.");
    const observer = self.makePeer();
    peers.push(observer);
    let previous = "", task = null, seconds = 0, lastWaitLog = 0;
    await observer.call("observe-start", { credentials: credentials2, keyId: keyId2 }, 15e3);
    live();
    const ready = await monitorKey({ signal, timeoutMs: self.readyTimeoutMs, intervalMs: self.pollMs, isCancelled: () => !!signal?.aborted, probe: () => observer.call("ready", { keyId: keyId2, sidecarId }, 3e4), onProgress: (s) => {
      if (s.waiting) {
        seconds = s.elapsedSeconds;
        if (seconds - lastWaitLog >= 60) {
          lastWaitLog = seconds;
          log("Still waiting for the key (" + seconds + "s).");
        }
        onProgress("vault-waiting", seconds, task);
        return;
      }
      const t = s.task, valid = t && Number.isFinite(t.round) && Number.isFinite(t.totalRounds);
      const line = valid ? "QKMS task: " + clean(t.operation) + " " + clean(t.status) + ", round " + t.round + "/" + t.totalRounds : s.taskError ? "QKMS task: " + clean(s.taskError) : "";
      if (line && line !== previous) {
        previous = line;
        log(line);
      }
      if (valid) {
        task = { round: t.round, totalRounds: t.totalRounds };
        onProgress("vault-waiting", seconds, task);
      }
    } });
    live();
    if (ready?.ready !== true) throw Error("The new key did not become ready.");
    onProgress("vault-verifying");
    log("Key is ready. Checking that it can encrypt and decrypt.");
    const sample = crypto.getRandomValues(new Uint8Array(32));
    let participant2;
    const decrypts = async (ciphertext, failure) => {
      let unwrapped;
      try {
        unwrapped = await observer.call("decrypt", { keyId: keyId2, value: ciphertext }, 12e4);
      } catch (e) {
        live();
        throw Error(failure + " (" + clean(e.message) + ")");
      }
      live();
      let recovered;
      try {
        recovered = fromBase64(unwrapped?.Plaintext, 32);
      } catch {
        throw Error(failure);
      }
      try {
        if (recovered.length !== 32 || !sample.every((b, i) => b === recovered[i])) throw Error(failure);
      } finally {
        recovered.fill(0);
      }
    };
    try {
      const wrapped = await observer.call("encrypt", { keyId: keyId2, value: toBase64(sample) }, 6e4);
      live();
      if (typeof wrapped?.CiphertextBlob !== "string" || !wrapped.CiphertextBlob) throw Error(CHECK_FAILED);
      await decrypts(wrapped.CiphertextBlob, CHECK_FAILED);
      log("Encryption check passed.");
      participant2 = await first.call("export-state", { keyId: keyId2 }, 15e3);
      live();
      if (participant2?.sidecarId !== sidecarId) throw Error("The local participant changed identity.");
      onProgress("vault-reopening");
      log("Restarting the local participant to check that the vault can be reopened later.");
      first.stop();
      logged = /* @__PURE__ */ new Set();
      const baseline = await observer.call("pending-tasks", { sidecarIds: [sidecarId] }, 3e4);
      live();
      if (!Array.isArray(baseline?.ids)) throw Error("Could not list pending key tasks.");
      const second = self.makePeer(event);
      peers.push(second);
      const again = await second.call("start", { credentials: credentials2, hosted: true, restore: participant2, syncSession: true, ignoreTaskIds: baseline.ids, exportPrivateShareForTest: false, preparationBackend: "rust" }, 6e4);
      live();
      if (again?.sidecarId !== sidecarId) throw Error("The restarted local participant changed identity.");
      await decrypts(wrapped.CiphertextBlob, "The hosted service did not complete a decrypt after the local participant was restarted, so this vault could not be reopened later.");
      log("Restart check passed.");
    } finally {
      sample.fill(0);
    }
    return { keyId: keyId2, participant: participant2 };
  } catch (e) {
    if (signal?.aborted) throw cancelled();
    if (requested && !(e instanceof SetupVaultError)) throw new SetupVaultError((e.message || "Vault creation failed.") + REMOTE_NOTE);
    throw e;
  } finally {
    open = false;
    signal?.removeEventListener("abort", stopAll);
    stopAll();
  }
}

// tests/setup-vault-source.js
var keyId = "fictional-new-vault-key";
var credentials = { accessKey: "FICTIONAL_VAULT_ACCESS", secretKey: "FICTIONAL_VAULT_SECRET", region: "q-world-1", bucket: "qvault-fictional" };
var participant = (id) => ({ version: 1, keyId, sidecarId: id, entries: [["identity", Buffer.from(JSON.stringify({ sidecarId: id, ...Object.fromEntries(["identityPrivateX448", "identityPublicX448", "signedPreKeyPrivateX448", "signedPreKeyPublicX448", "signingPrivateEd448", "signingPublicEd448", "preKeySignature"].map((k) => [k, "ab".repeat(57)])) })).toString("base64")], ["keyshare/" + keyId, Buffer.from(JSON.stringify({ n: Buffer.alloc(256, 195).toString("base64"), e: "AQAB", dShare: "AQ==" })).toString("base64")]] });
function fixture(options = {}) {
  const made = [], order = [];
  let restarted = false;
  const makePeer = (onEvent) => {
    const index = made.length, id = index === 1 ? "f".repeat(32) : "a".repeat(32);
    order.push("make" + index);
    const peer = { id, emit: onEvent, calls: [], stopped: false, stop() {
      if (!this.stopped) order.push("stop" + index);
      this.stopped = true;
    }, async call(action, args = {}) {
      if (this.stopped) throw Error("Vault locked");
      this.calls.push([action, args]);
      if (action === "start") {
        if (args.restore) {
          restarted = true;
          if (options.restartChangesIdentity) return { sidecarId: "c".repeat(32) };
        }
        return { sidecarId: id };
      }
      if (action === "prepare") {
        onEvent?.({ event: "crypto-progress", stage: "synthetic prime search <b>" + "x".repeat(300) });
        return { ready: true, keySize: 2048 };
      }
      if (action === "prepared") return { ready: true, keySize: 2048 };
      if (action === "create") {
        if (options.createFails) throw Error("QKMS HTTP 400 (CreateKey)");
        onEvent?.({ event: "participant-progress", stage: "round-message", task: { round: 1, totalRounds: 4 } });
        onEvent?.({ event: "participant-progress", stage: "round-message", task: { round: 1, totalRounds: 4 } });
        onEvent?.({ event: "participant-error", error: "QKMS HTTP 503 (ListTasksForSidecar)", task: { status: "IN_PROGRESS", round: 1, totalRounds: 4 } });
        return { keyId, pending: true };
      }
      if (action === "observe-start") return { observer: true };
      if (action === "pending-tasks") return { ids: ["fictional-stale-task"] };
      if (action === "ready") {
        this.probes = (this.probes || 0) + 1;
        return options.neverReady || options.slowReady && this.probes < 3 ? { ready: false, task: { status: "IN_PROGRESS", operation: "CreateKey", round: Math.min(this.probes, 4), totalRounds: 4 } } : { ready: true };
      }
      if (action === "encrypt") return { CiphertextBlob: "wrapped:" + args.value };
      if (action === "decrypt") {
        if (restarted && options.reopenFails) throw Error("Service request timed out");
        return { Plaintext: options.badDecrypt ? Buffer.alloc(32, 1).toString("base64") : args.value.slice(8) };
      }
      if (action === "export-state") return participant(id);
      throw Error("Unexpected participant action " + action);
    } };
    made.push(peer);
    return peer;
  };
  return { made, makePeer, order };
}
var run = (makePeer, extra = {}) => createHostedKey({ credentials, makePeer, pollMs: 1, ...extra });
{
  const { made, makePeer, order } = fixture(), phases = [];
  const result = await run(makePeer, { onProgress: (p) => phases.push(p) });
  assert.equal(result.keyId, keyId);
  assert.deepEqual(result.participant, participant("a".repeat(32)));
  assert.equal(made.length, 3);
  assert.ok(made.every((p) => p.stopped));
  const first = made[0].calls.find((c) => c[0] === "start")[1];
  assert.equal(first.hosted, true);
  assert.equal(first.exportPrivateShareForTest, false);
  assert.equal(first.hostedTest, void 0);
  assert.equal(first.restore, void 0);
  assert.deepEqual(first.credentials, credentials);
  const creates = made.flatMap((p) => p.calls.filter((c) => c[0] === "create"));
  assert.equal(creates.length, 1);
  assert.deepEqual(creates[0][1].participants, ["service", "a".repeat(32)]);
  assert.ok(!made[1].calls.some((c) => c[0] === "start" || c[0] === "export-state"));
  assert.ok(order.indexOf("stop0") < order.indexOf("make2"));
  const again = made[2].calls.find((c) => c[0] === "start")[1];
  assert.equal(again.hosted, true);
  assert.equal(again.syncSession, true);
  assert.equal(again.exportPrivateShareForTest, false);
  assert.deepEqual(again.restore, participant("a".repeat(32)));
  assert.deepEqual(again.ignoreTaskIds, ["fictional-stale-task"]);
  assert.equal(made[1].calls.filter((c) => c[0] === "decrypt").length, 2);
  assert.equal(made[1].calls.filter((c) => c[0] === "encrypt").length, 1);
  assert.deepEqual(phases.filter((p, i) => phases.indexOf(p) === i), ["vault-starting", "vault-preparing", "vault-creating", "vault-waiting", "vault-verifying", "vault-reopening"]);
}
{
  const { makePeer } = fixture({ slowReady: true }), logs = [], waits = [];
  await run(makePeer, { onLog: (t) => logs.push(t), onProgress: (phase, seconds, task) => {
    if (phase === "vault-waiting" && task) waits.push(task.round + "/" + task.totalRounds);
  } });
  const text = logs.join("\n");
  for (const expected of [/Local participant started \(aaaaaaaa/, /Local participant: synthetic prime search/, /Local participant: round-message, round 1\/4/, /Local participant reported: QKMS HTTP 503/, new RegExp("Key requested: " + keyId), /QKMS task: CreateKey IN_PROGRESS, round 1\/4/, /QKMS task: CreateKey IN_PROGRESS, round 2\/4/, /Key is ready/, /Encryption check passed/, /Restarting the local participant/, /Restart check passed/]) assert.match(text, expected);
  assert.ok(logs.every((line) => typeof line === "string" && line.length <= 200 && !/[<>]/.test(line)));
  for (const secret of [credentials.secretKey, credentials.accessKey]) assert.ok(!text.includes(secret));
  assert.equal(logs.filter((l) => /round 1\/4/.test(l) && /QKMS task/.test(l)).length, 1);
  assert.equal(logs.filter((l) => /Local participant: round-message, round 1\/4/.test(l)).length, 1);
  assert.ok(waits.includes("2/4"));
}
for (const [options, pattern, extra] of [[{ createFails: true }, /CreateKey/, {}], [{ badDecrypt: true }, /did not pass its encryption check[\s\S]*was not deleted/, {}], [{ neverReady: true }, /did not become ready[\s\S]*was not deleted/, { readyTimeoutMs: 40 }], [{ reopenFails: true }, /after the local participant was restarted[\s\S]*was not deleted/, {}], [{ restartChangesIdentity: true }, /changed identity[\s\S]*was not deleted/, {}]]) {
  const { made, makePeer } = fixture(options);
  await assert.rejects(() => run(makePeer, extra), pattern);
  assert.ok(made.length >= 1 && made.every((p) => p.stopped));
}
{
  const { made, makePeer } = fixture({ neverReady: true }), abort = new AbortController();
  setTimeout(() => abort.abort(), 30);
  await assert.rejects(() => run(makePeer, { signal: abort.signal }), /cancelled/);
  assert.ok(made.every((p) => p.stopped));
}
console.log("PASS LOCAL: the hosted key for the second lock is created with the service plus one local participant, never enables private-share export, requires a verified encrypt/decrypt roundtrip and a successful decrypt after restarting the local participant, logs plain progress without secrets, and on failure or cancellation stops every participant. Synthetic participants; no live QKMS.");
