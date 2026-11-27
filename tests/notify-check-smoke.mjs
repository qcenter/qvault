// tests/notify-check-source.js
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
  constructor({ accessKeyId, secretAccessKey, sessionToken, service: service2, region, cache, retries, initRetryMs }) {
    if (accessKeyId == null) throw new TypeError("accessKeyId is a required option");
    if (secretAccessKey == null) throw new TypeError("secretAccessKey is a required option");
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.sessionToken = sessionToken;
    this.service = service2;
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
  constructor({ method, url, headers, body, accessKeyId, secretAccessKey, sessionToken, service: service2, region, cache, datetime, signQuery, appendSessionToken, allHeaders, singleEncode }) {
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
    if (!service2 || !region) {
      [guessedService, guessedRegion] = guessServiceRegion(this.url, this.headers);
    }
    this.service = service2 || guessedService || "";
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
  let service2 = match && match[1] || "";
  let region = match && match[2];
  if (region === "us-gov") {
    region = "us-gov-west-1";
  } else if (region === "s3" || region === "s3-accelerate") {
    region = "us-east-1";
    service2 = "s3";
  } else if (service2 === "iot") {
    if (hostname.startsWith("iot.")) {
      service2 = "execute-api";
    } else if (hostname.startsWith("data.jobs.iot.")) {
      service2 = "iot-jobs-data";
    } else {
      service2 = pathname === "/mqtt" ? "iotdevicegateway" : "iotdata";
    }
  } else if (service2 === "autoscaling") {
    const targetPrefix = (headers.get("X-Amz-Target") || "").split(".")[0];
    if (targetPrefix === "AnyScaleFrontendService") {
      service2 = "application-autoscaling";
    } else if (targetPrefix === "AnyScaleScalingPlannerFrontendService") {
      service2 = "autoscaling-plans";
    }
  } else if (region == null && service2.startsWith("s3-")) {
    region = service2.slice(3).replace(/^fips-|^external-1/, "");
    service2 = "s3";
  } else if (service2.endsWith("-fips")) {
    service2 = service2.slice(0, -5);
  } else if (region && /-\d$/.test(service2) && !/-\d$/.test(region)) {
    [service2, region] = [region, service2];
  }
  return [HOST_SERVICES[service2] || service2, region || ""];
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
async function runNotifyCheck({ credentials: credentials2, log = () => {
}, fetchImpl = (...a) => fetch(...a), name = "qvault-check-" + crypto.randomUUID().slice(0, 8), waitSeconds = 10, attempts = 3, now = () => Date.now() } = {}) {
  const { accessKey, secretKey, region = "q-world-1" } = credentials2 || {};
  if (!accessKey || !secretKey) throw Error("Enter the access key ID and the secret access key");
  const clients = /* @__PURE__ */ new Map(), clientFor = (service2, r) => {
    const k = service2 + "/" + r;
    if (!clients.has(k)) clients.set(k, new AwsClient({ accessKeyId: accessKey, secretAccessKey: secretKey, service: service2, region: r, retries: 0 }));
    return clients.get(k);
  };
  const variants = [.../* @__PURE__ */ new Set([region, "us-east-1"])].flatMap((r) => [{ region: r, contentType: false }, { region: r, contentType: true }]), chosen = { sns: null, sqs: null };
  async function send(service2, url, headers, body, variant) {
    const v = variant || chosen[service2] || variants[0];
    const request = await clientFor(service2, v.region).sign(url, { method: "POST", headers, body, aws: { allHeaders: v.contentType } });
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
  async function settle(service2, label, attempt) {
    let last = null;
    for (const v of variants) {
      try {
        await attempt(v);
        chosen[service2] = v;
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

// tests/notify-check-source.js
var credentials = { accessKey: "FICTIONAL_ACCESS", secretKey: "FICTIONAL_SECRET_KEY", region: "q-world-1" };
function service({ sqsFormat = "json", deny = null, deliver = true, strict = null } = {}) {
  const calls = [], topics = /* @__PURE__ */ new Map(), queues = /* @__PURE__ */ new Map();
  let subscriptions = /* @__PURE__ */ new Map();
  const xml = (name, inner) => new Response("<" + name + "Response><" + name + "Result>" + inner + "</" + name + "Result></" + name + "Response>", { status: 200 });
  const fetchImpl = async (request) => {
    const url = request.url, body = await request.text(), target = request.headers.get("x-amz-target"), type = request.headers.get("content-type");
    assert.ok(url === NOTIFY_HOSTS.sns || url === NOTIFY_HOSTS.sqs, "requests go only to the two service hosts: " + url);
    assert.match(request.headers.get("authorization") || "", /^AWS4-HMAC-SHA256 /);
    assert.ok(!body.includes(credentials.secretKey));
    if (strict) {
      const auth = request.headers.get("authorization");
      if (!auth.includes("/" + strict.region + "/") || auth.includes("SignedHeaders=content-type;") !== strict.contentType) {
        calls.push("refused");
        return new Response("<ErrorResponse><Error><Code>SignatureDoesNotMatch</Code><Message>Signature verification failed</Message></Error></ErrorResponse>", { status: 403 });
      }
    }
    if (url === NOTIFY_HOSTS.sns) {
      const p = new URLSearchParams(body), action2 = p.get("Action");
      calls.push("sns:" + action2);
      if (deny === action2) return new Response("<ErrorResponse><Error><Code>AuthorizationError</Code></Error></ErrorResponse>", { status: 403 });
      if (action2 === "ListTopics") return xml(action2, "<Topics></Topics>");
      if (action2 === "CreateTopic") {
        const arn = "arn:aws:sns:q-world-1:000000000000:" + p.get("Name");
        topics.set(arn, true);
        return xml(action2, "<TopicArn>" + arn + "</TopicArn>");
      }
      if (action2 === "Subscribe") {
        const arn = p.get("TopicArn") + ":sub";
        subscriptions.set(arn, p.get("Endpoint"));
        return xml(action2, "<SubscriptionArn>" + arn + "</SubscriptionArn>");
      }
      if (action2 === "Publish") {
        if (deliver) {
          for (const endpoint of subscriptions.values()) for (const q2 of queues.values()) if (q2.arn === endpoint) q2.messages.push({ Body: JSON.stringify({ Type: "Notification", Message: p.get("Message") }), ReceiptHandle: "h" });
        }
        return xml(action2, "<MessageId>m</MessageId>");
      }
      if (action2 === "Unsubscribe") {
        subscriptions.delete(p.get("SubscriptionArn"));
        return xml(action2, "");
      }
      if (action2 === "DeleteTopic") {
        topics.delete(p.get("TopicArn"));
        return xml(action2, "");
      }
      return new Response("", { status: 400 });
    }
    const json = type === "application/x-amz-json-1.0";
    if (json !== (sqsFormat === "json")) {
      calls.push("sqs:wrong-format");
      return new Response(json ? "<ErrorResponse><Error><Code>InvalidAction</Code></Error></ErrorResponse>" : '{"__type":"com.amazonaws.sqs#InvalidAction"}', { status: 400 });
    }
    const input = json ? JSON.parse(body) : Object.fromEntries(new URLSearchParams(body)), action = json ? target.split(".").pop() : input.Action;
    calls.push("sqs:" + action);
    if (deny === action) return new Response(json ? '{"__type":"com.amazonaws.sqs#AccessDenied"}' : "<ErrorResponse><Error><Code>AccessDenied</Code></Error></ErrorResponse>", { status: 403 });
    const answer = (o, x) => json ? new Response(JSON.stringify(o), { status: 200 }) : xml(action, x);
    if (action === "ListQueues") return answer({ QueueUrls: [] }, "");
    if (action === "CreateQueue") {
      const u = "https://qq.quilibrium.com/000000000000/" + input.QueueName;
      queues.set(u, { arn: "arn:aws:sqs:q-world-1:000000000000:" + input.QueueName, messages: [] });
      return answer({ QueueUrl: u }, "<QueueUrl>" + u + "</QueueUrl>");
    }
    const q = queues.get(input.QueueUrl);
    if (!q) return new Response("", { status: 400 });
    if (action === "GetQueueAttributes") return answer({ Attributes: { QueueArn: q.arn } }, "<Attribute><Name>QueueArn</Name><Value>" + q.arn + "</Value></Attribute>");
    if (action === "SetQueueAttributes") return answer({}, "");
    if (action === "ReceiveMessage") {
      const m = q.messages.splice(0);
      return answer({ Messages: m }, m.map((x) => "<Message><Body>" + x.Body.replace(/&/g, "&amp;").replace(/"/g, "&quot;") + "</Body><ReceiptHandle>" + x.ReceiptHandle + "</ReceiptHandle></Message>").join(""));
    }
    if (action === "DeleteQueue") {
      queues.delete(input.QueueUrl);
      return answer({}, "");
    }
    return new Response("", { status: 400 });
  };
  return { fetchImpl, calls, left: () => topics.size + queues.size + subscriptions.size };
}
for (const sqsFormat of ["json", "query"]) {
  const s = service({ sqsFormat }), lines = [];
  const r = await runNotifyCheck({ credentials, fetchImpl: s.fetchImpl, log: (l) => lines.push(l), waitSeconds: 1 });
  assert.equal(r.ok, true, lines.join("\n"));
  assert.equal(r.delivered, true);
  assert.equal(r.protocol, sqsFormat);
  assert.equal(s.left(), 0, "topic, queue and subscription are removed again");
  assert.match(notifyCheckMessage(r), /^Passed/);
  assert.ok(lines.every((l) => !l.includes(credentials.secretKey) && !l.includes(credentials.accessKey)), "the log never shows credentials");
}
{
  const s = service({ deliver: false }), lines = [];
  const r = await runNotifyCheck({ credentials, fetchImpl: s.fetchImpl, log: (l) => lines.push(l), waitSeconds: 1, attempts: 2 });
  assert.equal(r.ok, false);
  assert.equal(r.failedAt, "Receive it through the queue");
  assert.equal(s.left(), 0, "cleanup runs after a failure too");
  assert.match(notifyCheckMessage(r), /Not passed/);
  assert.ok(lines.some((l) => /nothing arrived/.test(l)));
}
{
  const s = service({ deny: "CreateQueue" }), lines = [];
  const r = await runNotifyCheck({ credentials, fetchImpl: s.fetchImpl, log: (l) => lines.push(l), waitSeconds: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.failedAt, "Create a temporary queue in QQ");
  assert.ok(lines.some((l) => /AccessDenied/.test(l)));
  assert.equal(s.left(), 0);
  assert.ok(!s.calls.includes("sns:Publish"));
}
{
  const s = service({ deny: "CreateTopic" });
  const r = await runNotifyCheck({ credentials, fetchImpl: s.fetchImpl, waitSeconds: 1 });
  assert.equal(r.failedAt, "Create a temporary topic in QPing");
  assert.deepEqual(s.calls.filter((c) => c !== "sqs:wrong-format"), ["sns:ListTopics", "sqs:ListQueues", "sns:CreateTopic"], "only the two read-only questions come first; nothing needs removing");
}
{
  const lines = [];
  await runNotifyCheck({ credentials, waitSeconds: 1, log: (l) => lines.push(l), fetchImpl: async () => new Response("<ErrorResponse><Error><Code>AuthorizationError</Code><Message>FICTIONAL reason from the service</Message></Error></ErrorResponse>", { status: 403 }) });
  assert.ok(lines.some((l) => /Ask QPing for its topic list: skipped, .*HTTP 403 AuthorizationError: FICTIONAL reason from the service/.test(l)), lines.join("|"));
  assert.ok(lines.some((l) => /4 ways of signing/.test(l)), lines.join("|"));
  assert.ok(lines.some((l) => /Ask QQ for its queue list: skipped/.test(l)));
}
for (const strict of [{ region: "us-east-1", contentType: true }, { region: "q-world-1", contentType: true }, { region: "us-east-1", contentType: false }]) {
  const s = service({ strict }), lines = [];
  const r = await runNotifyCheck({ credentials, fetchImpl: s.fetchImpl, log: (l) => lines.push(l), waitSeconds: 1 });
  assert.equal(r.ok, true, lines.join("\n"));
  assert.deepEqual(r.signing.sns, { region: strict.region, contentType: strict.contentType });
  assert.deepEqual(r.signing.sqs, { region: strict.region, contentType: strict.contentType });
  assert.ok(lines.some((l) => l.includes("QPing accepts requests signed for region " + strict.region)), lines.join("|"));
  assert.equal(s.left(), 0);
}
await assert.rejects(() => runNotifyCheck({ credentials: { accessKey: "", secretKey: "" } }), /Enter the access key/);
console.log("PASS LOCAL: the experimental QPing + QQ check creates a temporary topic and queue, sends one message through them, works with either SQS wire format, reports where it stopped, always removes what it created, contacts only the two service hosts and never logs credentials. Stand-in services only; the real QPing and QQ are not tested here.");
/*! Bundled license information:

aws4fetch/dist/aws4fetch.esm.mjs:
  (**
   * @license MIT <https://opensource.org/licenses/MIT>
   * @copyright Michael Hart 2024
   *)
*/
