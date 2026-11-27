// src/profile-crypto.js
var MAX = 4 * 1024 * 1024;
var encoder = new TextEncoder();
var decoder = new TextDecoder();

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

// src/cloud-vault.js
var MAX2 = 1024 * 1024;
var enc = new TextEncoder();

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

// src/passkey-check.js
var bytes = (n) => crypto.getRandomValues(new Uint8Array(n));
var errorName = (e) => typeof e?.name === "string" && /^[A-Za-z]{1,40}$/.test(e.name) ? e.name : "Error";
async function checkPasskeyPrf({ container = globalThis.navigator?.credentials, onStep = () => {
} } = {}) {
  const fail = (reason2, detail = "") => ({ supported: false, reason: reason2, detail });
  if (typeof container?.create !== "function" || typeof container?.get !== "function") return fail("unavailable");
  const stopped = (e) => e?.name === "NotAllowedError" ? fail("cancelled") : fail("failed", errorName(e));
  const salt = bytes(32);
  let created;
  onStep("create");
  try {
    created = await container.create({ publicKey: { rp: { name: "QVault" }, user: { id: bytes(16), name: "QVault passkey check", displayName: "QVault passkey check" }, challenge: bytes(32), pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }], authenticatorSelection: { residentKey: "preferred", userVerification: "required" }, timeout: 12e4, extensions: { prf: {} } } });
  } catch (e) {
    return stopped(e);
  }
  if (!created?.rawId) return fail("failed", "NoCredential");
  const enabledAtCreation = created.getClientExtensionResults?.().prf?.enabled === true;
  const use = async () => {
    const assertion = await container.get({ publicKey: { challenge: bytes(32), allowCredentials: [{ type: "public-key", id: created.rawId }], userVerification: "required", timeout: 12e4, extensions: { prf: { eval: { first: salt } } } } });
    const first = assertion?.getClientExtensionResults?.().prf?.results?.first;
    return first ? new Uint8Array(first.buffer ? first.buffer.slice(first.byteOffset, first.byteOffset + first.byteLength) : first.slice(0)) : null;
  };
  let one = null, two = null;
  try {
    onStep("use-1");
    one = await use();
    if (!one || one.length < 32) return fail("no-secret");
    onStep("use-2");
    two = await use();
    if (!two || two.length !== one.length) return fail("no-secret");
    if (!one.every((b, i) => b === two[i])) return fail("unstable");
    return { supported: true, bytes: one.length, enabledAtCreation, authenticator: typeof created.authenticatorAttachment === "string" ? created.authenticatorAttachment.slice(0, 40) : "unknown" };
  } catch (e) {
    return stopped(e);
  } finally {
    one?.fill(0);
    two?.fill(0);
    salt.fill(0);
  }
}
function passkeyCheckMessage(result) {
  if (result?.supported) return "Passed: this browser can unlock QVault with a passkey. It returned the same " + result.bytes + "-byte secret both times (" + (result.authenticator === "platform" ? "built-in authenticator such as Touch ID" : result.authenticator === "cross-platform" ? "external security key or phone" : "authenticator type not reported") + '). You can delete the test passkey "QVault passkey check" in your password manager.';
  switch (result?.reason) {
    case "unavailable":
      return "Not available: this browser does not offer passkeys to the extension.";
    case "cancelled":
      return "The check was cancelled or timed out before finishing. Nothing was changed in QVault.";
    case "no-secret":
      return "Not supported: the passkey was created, but this authenticator does not provide the secret QVault needs (WebAuthn PRF). Try a different passkey provider when prompted. QVault cannot be used with this one.";
    case "unstable":
      return "Not usable: the passkey returned a different secret the second time, so it cannot protect a vault.";
    default:
      return "The passkey check failed (" + (result?.detail || "Error") + "). Nothing was changed in QVault.";
  }
}

// src/notify-check.js
var NOTIFY_HOSTS = { sns: "https://qping.quilibrium.com/", sqs: "https://qq.quilibrium.com/" };
var tag = (xml, name) => {
  const m = new RegExp("<" + name + ">([^<]*)</" + name + ">").exec(xml);
  return m ? m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"') : null;
};
var reason = (status, text) => {
  let code = tag(text, "Code"), message = tag(text, "Message");
  if (!code) {
    try {
      const j = JSON.parse(text);
      code = String(j.__type || j.code || j.Code || "").split("#").pop();
      message = j.message || j.Message || null;
    } catch {
    }
  }
  return "HTTP " + status + (code ? " " + code.slice(0, 80) : "") + (message ? ": " + String(message).slice(0, 200) : "");
};
var StepError = class extends Error {
};
async function runNotifyCheck({ credentials, log = () => {
}, fetchImpl = (...a) => fetch(...a), name = "qvault-check-" + crypto.randomUUID().slice(0, 8), waitSeconds = 10, attempts = 3, now = () => Date.now() } = {}) {
  const { accessKey, secretKey, region = "q-world-1" } = credentials || {};
  if (!accessKey || !secretKey) throw Error("Enter the access key ID and the secret access key");
  const clients = /* @__PURE__ */ new Map(), clientFor = (service, r) => {
    const k = service + "/" + r;
    if (!clients.has(k)) clients.set(k, new AwsClient({ accessKeyId: accessKey, secretAccessKey: secretKey, service, region: r, retries: 0 }));
    return clients.get(k);
  };
  const variants = [.../* @__PURE__ */ new Set([region, "us-east-1"])].flatMap((r) => [{ region: r, contentType: false }, { region: r, contentType: true }]), chosen = { sns: null, sqs: null };
  async function send(service, url, headers, body, variant) {
    const v = variant || chosen[service] || variants[0];
    const request = await clientFor(service, v.region).sign(url, { method: "POST", headers, body, aws: { allHeaders: v.contentType } });
    const r = await fetchImpl(request);
    return { ok: r.ok, status: r.status, text: await r.text() };
  }
  const sns = async (action, params, variant) => {
    const r = await send("sns", NOTIFY_HOSTS.sns, { "Content-Type": "application/x-www-form-urlencoded" }, new URLSearchParams({ Action: action, Version: "2010-03-31", ...params }).toString(), variant);
    if (!r.ok) throw new StepError(reason(r.status, r.text));
    return r.text;
  };
  let protocol = null;
  const sqsJson = async (action, input, variant) => {
    const r = await send("sqs", NOTIFY_HOSTS.sqs, { "Content-Type": "application/x-amz-json-1.0", "X-Amz-Target": "AmazonSQS." + action }, JSON.stringify(input), variant);
    if (!r.ok) throw new StepError(reason(r.status, r.text));
    try {
      return r.text ? JSON.parse(r.text) : {};
    } catch {
      throw new StepError("unexpected answer");
    }
  };
  const sqsQuery = async (action, params, variant) => {
    const r = await send("sqs", NOTIFY_HOSTS.sqs, { "Content-Type": "application/x-www-form-urlencoded" }, new URLSearchParams({ Action: action, Version: "2012-11-05", ...params }).toString(), variant);
    if (!r.ok) throw new StepError(reason(r.status, r.text));
    return r.text;
  };
  const describe = (v) => "for region " + v.region + (v.contentType ? ", content type included" : ", content type left out");
  async function settle(service, label, attempt) {
    let last = null;
    for (const v of variants) {
      try {
        await attempt(v);
        chosen[service] = v;
        log(label + " accepts requests signed " + describe(v));
        return;
      } catch (e) {
        if (!(e instanceof StepError)) throw e;
        last = e;
      }
    }
    throw new StepError("tried " + variants.length + " ways of signing, the last answer was " + last.message);
  }
  const queue = {
    async create(queueName) {
      if (protocol === "query") {
        const url = tag(await sqsQuery("CreateQueue", { QueueName: queueName }), "QueueUrl");
        if (!url) throw new StepError("no queue address");
        return url;
      }
      try {
        const j = await sqsJson("CreateQueue", { QueueName: queueName });
        if (!j.QueueUrl) throw new StepError("no queue address");
        protocol = "json";
        return j.QueueUrl;
      } catch (first) {
        try {
          const url = tag(await sqsQuery("CreateQueue", { QueueName: queueName }), "QueueUrl");
          if (!url) throw new StepError("no queue address");
          protocol = "query";
          return url;
        } catch (second) {
          throw new StepError("JSON format: " + first.message + "; form format: " + second.message);
        }
      }
    },
    async arn(url) {
      if (protocol === "json") return (await sqsJson("GetQueueAttributes", { QueueUrl: url, AttributeNames: ["QueueArn"] })).Attributes?.QueueArn;
      return tag(await sqsQuery("GetQueueAttributes", { QueueUrl: url, "AttributeName.1": "QueueArn" }), "Value");
    },
    async allow(url, policy) {
      if (protocol === "json") return sqsJson("SetQueueAttributes", { QueueUrl: url, Attributes: { Policy: policy } });
      return sqsQuery("SetQueueAttributes", { QueueUrl: url, "Attribute.1.Name": "Policy", "Attribute.1.Value": policy });
    },
    async receive(url) {
      if (protocol === "json") return ((await sqsJson("ReceiveMessage", { QueueUrl: url, WaitTimeSeconds: waitSeconds, MaxNumberOfMessages: 10 })).Messages || []).map((m) => ({ body: m.Body, handle: m.ReceiptHandle }));
      const xml = await sqsQuery("ReceiveMessage", { QueueUrl: url, WaitTimeSeconds: String(waitSeconds), MaxNumberOfMessages: "10" });
      return [...xml.matchAll(/<Message>([\s\S]*?)<\/Message>/g)].map((m) => ({ body: tag(m[1], "Body"), handle: tag(m[1], "ReceiptHandle") }));
    },
    async remove(url) {
      if (protocol === "json") return sqsJson("DeleteQueue", { QueueUrl: url });
      return sqsQuery("DeleteQueue", { QueueUrl: url });
    }
  };
  const result = { ok: false, protocol: null, delivered: false, delayMs: null, failedAt: null, signing: chosen };
  let topicArn = null, queueUrl = null, subscriptionArn = null;
  const step = async (label, fn, { optional = false } = {}) => {
    try {
      const value = await fn();
      log(label + ": ok");
      return value;
    } catch (e) {
      const why = e instanceof StepError ? e.message : "no answer (" + (e?.message || "network error").slice(0, 80) + ")";
      log(label + ": " + (optional ? "skipped, " : "failed, ") + why);
      if (optional) return null;
      result.failedAt ??= label;
      throw e;
    }
  };
  try {
    await step("Ask QPing for its topic list", () => settle("sns", "QPing", (v) => sns("ListTopics", {}, v)), { optional: true });
    await step("Ask QQ for its queue list", () => settle("sqs", "QQ", async (v) => {
      try {
        await sqsJson("ListQueues", {}, v);
        protocol = "json";
      } catch (first) {
        if (!(first instanceof StepError)) throw first;
        try {
          await sqsQuery("ListQueues", {}, v);
          protocol = "query";
        } catch (second) {
          if (!(second instanceof StepError)) throw second;
          throw new StepError("JSON format: " + first.message + "; form format: " + second.message);
        }
      }
    }), { optional: true });
    topicArn = await step("Create a temporary topic in QPing", async () => {
      const arn = tag(await sns("CreateTopic", { Name: name }), "TopicArn");
      if (!arn) throw new StepError("no topic address");
      return arn;
    });
    queueUrl = await step("Create a temporary queue in QQ", () => queue.create(name));
    result.protocol = protocol;
    log("QQ answers in the " + (protocol === "json" ? "JSON" : "form") + " format");
    const queueArn = await step("Read the queue address", async () => {
      const arn = await queue.arn(queueUrl);
      if (!arn) throw new StepError("no queue address");
      return arn;
    });
    await step("Allow the topic to write to the queue", () => queue.allow(queueUrl, JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: "sns.amazonaws.com" }, Action: "sqs:SendMessage", Resource: queueArn, Condition: { ArnEquals: { "aws:SourceArn": topicArn } } }] })), { optional: true });
    subscriptionArn = await step("Subscribe the queue to the topic", async () => tag(await sns("Subscribe", { TopicArn: topicArn, Protocol: "sqs", Endpoint: queueArn, ReturnSubscriptionArn: "true" }), "SubscriptionArn"));
    const token = "qvault-check-" + crypto.randomUUID(), sent = now();
    await step("Publish a test message", () => sns("Publish", { TopicArn: topicArn, Message: token }));
    await step("Receive it through the queue", async () => {
      for (let i = 0; i < attempts; i++) {
        const messages = await queue.receive(queueUrl);
        if (messages.some((m) => String(m.body || "").includes(token))) {
          result.delivered = true;
          result.delayMs = now() - sent;
          return;
        }
      }
      throw new StepError("nothing arrived within " + attempts * waitSeconds + " seconds");
    });
    result.ok = true;
  } catch {
  } finally {
    if (subscriptionArn && subscriptionArn.startsWith("arn:")) await step("Remove the subscription", () => sns("Unsubscribe", { SubscriptionArn: subscriptionArn }), { optional: true });
    if (queueUrl) await step("Remove the temporary queue", () => queue.remove(queueUrl), { optional: true });
    if (topicArn) await step("Remove the temporary topic", () => sns("DeleteTopic", { TopicArn: topicArn }), { optional: true });
  }
  return result;
}
function notifyCheckMessage(r) {
  if (r.ok) return "Passed: a message published to QPing arrived through QQ in about " + Math.max(1, Math.round(r.delayMs / 1e3)) + " s. Instant sync between computers is possible with this account. The temporary topic and queue were removed.";
  return "Not passed. Stopped at: " + (r.failedAt || "start") + ". See the steps below; copy them if you report this. Anything that was created has been removed where possible.";
}

// src/diagnostics.js
var $ = (id) => document.getElementById(id);
var peer = null;
var epoch = 0;
function stop() {
  epoch++;
  peer?.stop();
  peer = null;
  $("local-check").disabled = false;
  $("local-stop").disabled = true;
  $("local-stop").hidden = true;
  $("local-status").textContent = "Local check cancelled. No cloud operation was performed.";
}
$("local-stop").onclick = stop;
$("local-check").onclick = async () => {
  if (peer) return;
  const current = ++epoch, p = new BrowserParticipant();
  peer = p;
  $("local-check").disabled = true;
  $("local-stop").disabled = false;
  $("local-stop").hidden = false;
  $("local-status").textContent = "Checking local encryption components and a random-data recovery\u2026";
  try {
    const result = await p.call("local", {}, 24e4);
    if (current !== epoch) return;
    if (result.ready !== true) throw Error("Local components did not confirm readiness");
    $("local-status").textContent = "Local checks passed. Encryption components initialized and the random data was recovered correctly. No cloud service was tested.";
  } catch (e) {
    if (current === epoch) $("local-status").textContent = "Local check did not pass. " + e.message;
  } finally {
    p.stop();
    if (current === epoch) {
      peer = null;
      $("local-check").disabled = false;
      $("local-stop").disabled = true;
      $("local-stop").hidden = true;
    }
  }
};
var passkeySteps = { create: "Step 1 of 3: confirm creating the test passkey\u2026", "use-1": "Step 2 of 3: confirm using the test passkey\u2026", "use-2": "Step 3 of 3: confirm using it once more\u2026" };
var passkeyBusy = false;
$("passkey-check").onclick = async () => {
  if (passkeyBusy) return;
  passkeyBusy = true;
  $("passkey-check").disabled = true;
  $("passkey-status").textContent = "Starting the passkey check\u2026";
  try {
    $("passkey-status").textContent = passkeyCheckMessage(await checkPasskeyPrf({ onStep: (step) => {
      $("passkey-status").textContent = passkeySteps[step] || "Waiting for your confirmation\u2026";
    } }));
  } catch {
    $("passkey-status").textContent = "The passkey check failed. Nothing was changed in QVault.";
  } finally {
    passkeyBusy = false;
    $("passkey-check").disabled = false;
  }
};
window.addEventListener("pagehide", () => {
  epoch++;
  peer?.stop();
  peer = null;
});
var NOTIFY_ORIGINS = { origins: ["https://qping.quilibrium.com/*", "https://qq.quilibrium.com/*"] };
var notifyBusy = false;
$("notify-form").onsubmit = (event) => {
  event.preventDefault();
  if (notifyBusy) return;
  const credentials = { accessKey: $("notify-access").value.trim(), secretKey: $("notify-secret").value, region: "q-world-1" };
  $("notify-access").value = "";
  $("notify-secret").value = "";
  const allowed = globalThis.chrome?.permissions?.request ? chrome.permissions.request(NOTIFY_ORIGINS) : Promise.resolve(true);
  notifyBusy = true;
  $("notify-run").disabled = true;
  $("notify-log").replaceChildren();
  $("notify-status").textContent = "Running the instant sync check\u2026";
  (async () => {
    try {
      if (await allowed !== true) {
        $("notify-status").textContent = "Not run: the browser was not allowed to contact QPing and QQ.";
        return;
      }
      const result = await runNotifyCheck({ credentials, log: (line) => {
        const item = document.createElement("li");
        item.textContent = line;
        $("notify-log").append(item);
      } });
      $("notify-status").textContent = notifyCheckMessage(result);
    } catch (e) {
      $("notify-status").textContent = "The check could not run. " + (e?.message || "Unknown error");
    } finally {
      credentials.accessKey = "";
      credentials.secretKey = "";
      try {
        await globalThis.chrome?.permissions?.remove?.(NOTIFY_ORIGINS);
      } catch {
      }
      notifyBusy = false;
      $("notify-run").disabled = false;
    }
  })();
};
/*! Bundled license information:

aws4fetch/dist/aws4fetch.esm.mjs:
  (**
   * @license MIT <https://opensource.org/licenses/MIT>
   * @copyright Michael Hart 2024
   *)
*/
//# sourceMappingURL=diagnostics.js.map
