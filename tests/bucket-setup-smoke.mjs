// tests/bucket-setup-source.js
import assert from "node:assert/strict";

// src/bucket-help.js
var help = {
  "create-denied": { title: "Bucket creation is not allowed", steps: ["Give this access key permission to create buckets in QConsole, then try again.", "Alternatively, create a private bucket manually in QConsole \u2192 Services \u2192 QStorage \u2192 Create Bucket. Enter the same bucket name here afterwards."] },
  "inspect-denied": { title: "QVault cannot check this bucket", steps: ["Check the access key and secret, and make sure they belong to the intended QConsole account.", "Allow this key to inspect the bucket. No creation request was sent. You can also check the bucket manually in QConsole."] },
  "authentication": { title: "QStorage could not verify your access details", steps: ["Check that the access key ID and secret key were copied correctly and are still active.", "Use a QConsole access key and its secret, not a browser Client API Key. Changing bucket permissions will not fix incorrect credentials."] },
  "clock": { title: "The device time could not be verified", steps: ["Enable automatic date and time on this device, then try again."] },
  "name-taken": { title: "This bucket name is already taken", steps: ["Choose a different, unique name, for example a name beginning with your own project name.", "No existing bucket or its settings were changed."] },
  "unconfirmed": { title: "Bucket creation could not be confirmed", steps: ["Check the same bucket in QConsole before starting again. It may already have been created.", "No automatic creation retry was made. Check your connection, then try the same name again."] },
  "verify-denied": { title: "The bucket was accepted, but access is not confirmed", steps: ["Check the same bucket in QConsole. Do not create another name just to retry.", "Allow this access key to inspect the bucket, then check it again here."] },
  "invalid-name": { title: "Check the bucket name", steps: ["Enter only the name: 3\u201363 lowercase letters, numbers, dots or hyphens. Do not enter a URL or folder path.", "The name must not look like an IP address or contain consecutive dots."] },
  "credentials": { title: "Access details are missing", steps: ["Enter the access key, secret key and region from QConsole."] },
  "quota": { title: "The account cannot create more buckets", steps: ["Check the account\u2019s bucket limit in QConsole, or ask the account administrator. An existing private bucket can be used instead."] },
  "check-failed": { title: "QStorage could not be checked", steps: ["Check your connection and the region setting, then try again.", "No bucket creation request was sent. If the service is unavailable, try later."] },
  "create-failed": { title: "The bucket could not be created", steps: ["Check the bucket name, region and access permissions in QConsole.", "You can create a private bucket manually in QConsole and then check it here."] }
};
var BucketSetupError = class extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "BucketSetupError";
    this.code = code;
    this.status = status;
  }
};
function bucketHelp(error) {
  const known = error instanceof BucketSetupError ? help[error.code] : null;
  if (known) return { ...known, reference: error.status ? "Service response: HTTP " + error.status : "" };
  return { title: /Abort|Timeout/.test(error?.name || "") ? "QStorage did not respond in time" : "Cloud storage could not be prepared", steps: ["Check your connection and try again.", "If creation had already started, check the same bucket in QConsole first; its outcome may be unknown."], reference: "" };
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

// src/bucket-setup.js
function validateBucketName(bucket2) {
  if (typeof bucket2 !== "string" || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket2) || /\.\.|\.-|-\./.test(bucket2) || /^\d+\.\d+\.\d+\.\d+$/.test(bucket2)) throw new BucketSetupError("invalid-name", "Enter a bucket name, 3\u201363 lowercase letters/numbers, dots or hyphens. Do not enter a URL or path.");
  return bucket2;
}
async function errorCode(response) {
  const text = await response.text();
  if (text.length > 8192) return "";
  const xml = text.match(/<Code>\s*([A-Za-z0-9]{1,80})\s*<\/Code>/);
  if (xml) return xml[1];
  try {
    const json = JSON.parse(text);
    const value = json.Code || json.code;
    return typeof value === "string" && /^[A-Za-z0-9]{1,80}$/.test(value) ? value : "";
  } catch {
    return "";
  }
}
async function ensurePrivateBucket({ credentials: credentials2, bucket: bucket2, signal, onProgress = () => {
}, client }) {
  validateBucketName(bucket2);
  if (!credentials2?.accessKey || !credentials2.secretKey || !/^[-a-z0-9]{1,64}$/.test(credentials2.region || "")) throw new BucketSetupError("credentials", "Enter your access key, secret key and region");
  const api = client || new AwsClient({ accessKeyId: credentials2.accessKey, secretAccessKey: credentials2.secretKey, service: "s3", region: credentials2.region, retries: 0 });
  const url = "https://qstorage.quilibrium.com/" + bucket2;
  const request = (method, options = {}) => api.fetch(url, { method, redirect: "error", cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(2e4)]) : AbortSignal.timeout(2e4), ...options });
  const accessError = (status) => new BucketSetupError("inspect-denied", "QStorage access denied (HTTP " + status + "). Check the access key and bucket permissions. No bucket was created.", status);
  onProgress("checking");
  let head2 = await request("HEAD");
  if (head2.status === 200) {
    onProgress("existing");
    return { bucket: bucket2, created: false, ready: true };
  }
  if ([401, 403].includes(head2.status)) throw accessError(head2.status);
  if (head2.status !== 404) throw new BucketSetupError("check-failed", "Could not check QStorage bucket (HTTP " + head2.status + "). No bucket was created.", head2.status);
  onProgress("creating");
  let response;
  try {
    response = await request("PUT", { headers: { "Content-Type": "application/xml", "x-amz-acl": "private" }, body: '<CreateBucketConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"></CreateBucketConfiguration>' });
  } catch (e) {
    if (signal?.aborted) throw e;
    try {
      head2 = await request("HEAD");
      if (head2.status === 200) {
        onProgress("available");
        return { bucket: bucket2, created: false, ready: true, creationOutcome: "unconfirmed" };
      }
    } catch {
    }
    throw new BucketSetupError("unconfirmed", "The bucket creation response was lost or timed out. Creation is not confirmed. Check the same bucket again; no automatic creation retry was made.");
  }
  let created = response.ok;
  if (!created) {
    const code = await errorCode(response);
    if (response.status === 401 || ["SignatureDoesNotMatch", "InvalidAccessKeyId", "InvalidToken", "ExpiredToken", "AuthorizationHeaderMalformed"].includes(code)) throw new BucketSetupError("authentication", "QStorage could not authenticate the access key.", response.status);
    if (code === "RequestTimeTooSkewed") throw new BucketSetupError("clock", "Device clock check failed.", response.status);
    if (response.status === 403) throw new BucketSetupError("create-denied", "QStorage denied bucket creation. The access key needs bucket creation permission.", response.status);
    if (code === "TooManyBuckets") throw new BucketSetupError("quota", "Account bucket limit reached.", response.status);
    if (response.status === 409 && code === "BucketAlreadyOwnedByYou") {
      created = false;
    } else if (response.status === 409 && code === "BucketAlreadyExists") throw new BucketSetupError("name-taken", "This bucket name is already taken. Choose another name; the existing bucket was not changed.");
    else throw new BucketSetupError("create-failed", "Could not create QStorage bucket (HTTP " + response.status + "). No existing bucket settings were changed.", response.status);
  }
  onProgress("verifying");
  head2 = await request("HEAD");
  if (head2.status !== 200) throw new BucketSetupError("verify-denied", "Bucket creation was accepted, but access could not be verified (HTTP " + head2.status + "). Check the same bucket again.", head2.status);
  onProgress(created ? "created" : "existing");
  return { bucket: bucket2, created, ready: true };
}

// tests/bucket-setup-source.js
var credentials = { accessKey: "FICTIONAL_BUCKET_ACCESS", secretKey: "FICTIONAL_BUCKET_SECRET", region: "q-world-1" };
var bucket = "qvault-fixture-bucket";
var responses = [];
var calls = [];
var originalFetch = globalThis.fetch;
globalThis.fetch = async (request) => {
  assert.ok(request instanceof Request);
  if (request.signal.aborted) throw new DOMException("Aborted", "AbortError");
  assert.equal(request.url, "https://qstorage.quilibrium.com/" + bucket);
  assert.match(request.headers.get("authorization"), /^AWS4-HMAC-SHA256 /);
  calls.push(request.method);
  const next = responses.shift();
  assert.ok(next, "Unexpected bucket request");
  assert.equal(request.method, next.method);
  if (request.method === "PUT") {
    assert.equal(request.headers.get("x-amz-acl"), "private");
    assert.match(await request.text(), /CreateBucketConfiguration/);
    assert.ok(!request.url.includes("?acl"));
  }
  if (next.lost) throw TypeError("FICTIONAL_SECRET_IN_NETWORK_ERROR");
  return new Response(request.method === "HEAD" ? null : next.body || "", { status: next.status });
};
async function run(sequence) {
  responses = [...sequence];
  calls = [];
  return ensurePrivateBucket({ credentials, bucket });
}
var head = (status) => ({ method: "HEAD", status });
var put = (status, code) => ({ method: "PUT", status, body: code ? "<Error><Code>" + code + "</Code><Message>DO_NOT_ECHO_SECRET</Message></Error>" : "" });
try {
  assert.deepEqual(await run([head(200)]), { bucket, created: false, ready: true });
  assert.deepEqual(calls, ["HEAD"]);
  assert.deepEqual(await run([head(404), put(200), head(200)]), { bucket, created: true, ready: true });
  assert.deepEqual(calls, ["HEAD", "PUT", "HEAD"]);
  await assert.rejects(() => run([head(403)]), /access denied/);
  assert.deepEqual(calls, ["HEAD"]);
  await assert.rejects(() => run([head(500)]), /No bucket was created/);
  assert.deepEqual(calls, ["HEAD"]);
  await assert.rejects(() => run([head(404), put(403)]), /bucket creation permission/);
  assert.deepEqual(calls, ["HEAD", "PUT"]);
  await assert.rejects(() => run([head(404), put(409, "BucketAlreadyExists")]), (e) => /already taken/.test(e.message) && !e.message.includes("DO_NOT_ECHO_SECRET"));
  assert.equal(calls.length, 2);
  assert.equal((await run([head(404), put(409, "BucketAlreadyOwnedByYou"), head(200)])).created, false);
  await assert.rejects(() => run([head(404), put(200), head(403)]), /access could not be verified/);
  await assert.rejects(() => run([head(404), put(403, "AccessDenied")]), (error) => {
    const help2 = bucketHelp(error);
    assert.equal(help2.title, "Bucket creation is not allowed");
    assert.ok(help2.steps.some((s) => s.includes("manually")));
    assert.ok(!help2.steps.join(" ").includes("s3:"));
    return true;
  });
  await assert.rejects(() => run([head(404), put(403, "SignatureDoesNotMatch")]), (error) => {
    assert.equal(bucketHelp(error).title, "QStorage could not verify your access details");
    return true;
  });
  assert.ok(!JSON.stringify(bucketHelp(TypeError("FICTIONAL_SECRET_ERROR_BODY"))).includes("FICTIONAL_SECRET_ERROR_BODY"));
  const recovered = await run([head(404), { method: "PUT", lost: true }, head(200)]);
  assert.equal(recovered.creationOutcome, "unconfirmed");
  assert.deepEqual(calls, ["HEAD", "PUT", "HEAD"]);
  for (const invalid of ["https://qstorage.quilibrium.com/a", "ab", "192.168.1.2", "a..bad", "Bad-Name"]) {
    calls = [];
    await assert.rejects(() => ensurePrivateBucket({ credentials, bucket: invalid }), /bucket name/);
    assert.equal(calls.length, 0);
  }
  const abort = new AbortController();
  abort.abort();
  calls = [];
  await assert.rejects(() => ensurePrivateBucket({ credentials, bucket, signal: abort.signal }), /Abort/);
  assert.equal(calls.length, 0);
  console.log("PASS LOCAL: signed S3 HEAD/restricted private CreateBucket/readback; existing buckets unchanged, 403/500 never treated as absence, create permission denial, global name collision, own-create race, lost ACK readback, failed verification, cancellation and invalid names. Fictional credentials and mocked HTTP only; no live QStorage.");
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
