import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {qkmsErrorText} from '../src/qkms-error.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
// The service's own reason is shown, as plain text of limited length.
const body=JSON.stringify({__type:'NotAuthorizedException',message:'FICTIONAL reason <b>from</b> the service '+'x'.repeat(400)});const t=qkmsErrorText({status:400,method:'RegisterSidecar',body});
assert.match(t,/^QKMS HTTP 400 \(RegisterSidecar\) NotAuthorizedException: FICTIONAL reason bfrom\/b the service x+$/);assert.ok(t.length<280);
assert.equal(qkmsErrorText({status:400,method:'RegisterSidecar',body:'{"__type":"NotAuthorizedException"}'}),'QKMS HTTP 400 (RegisterSidecar) NotAuthorizedException');
assert.equal(qkmsErrorText({status:502,method:'GetTask',body:'<html>'}),'QKMS HTTP 502 (GetTask)');
// The one-off SDK change check is gone: hosted participants always run with the SDK change, and nothing can switch it off.
assert.ok(read('src/engine.js').includes('operationsWithoutPeerSession:hosted,'));
for(const f of ['src/engine.js','src/setup-vault.js','src/diagnostics.js','lab.html','dist/engine.js','dist/diagnostics.js','build-tests.mjs'])assert.ok(!/requirePeerSession|sdk-check|sdk-form|SDK change check/.test(read(f)),f);
for(const f of ['src/sdk-check.js','tests/sdk-check-source.js','tests/sdk-check-smoke.mjs','tests/sdk-switch-smoke.mjs'])assert.ok(!existsSync(new URL('../'+f,import.meta.url)),f+' is removed');
console.log('PASS LOCAL: QKMS errors carry the service reason as limited plain text; the SDK change check is removed and the change cannot be switched off.');
