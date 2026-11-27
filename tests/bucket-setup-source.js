import assert from 'node:assert/strict';
import {bucketHelp} from '../src/bucket-help.js';
import {ensurePrivateBucket} from '../src/bucket-setup.js';
const credentials={accessKey:'FICTIONAL_BUCKET_ACCESS',secretKey:'FICTIONAL_BUCKET_SECRET',region:'q-world-1'},bucket='qvault-fixture-bucket';
let responses=[],calls=[];const originalFetch=globalThis.fetch;
globalThis.fetch=async request=>{assert.ok(request instanceof Request);if(request.signal.aborted)throw new DOMException('Aborted','AbortError');assert.equal(request.url,'https://qstorage.quilibrium.com/'+bucket);assert.match(request.headers.get('authorization'),/^AWS4-HMAC-SHA256 /);calls.push(request.method);const next=responses.shift();assert.ok(next,'Unexpected bucket request');assert.equal(request.method,next.method);if(request.method==='PUT'){assert.equal(request.headers.get('x-amz-acl'),'private');assert.match(await request.text(),/CreateBucketConfiguration/);assert.ok(!request.url.includes('?acl'))}if(next.lost)throw TypeError('FICTIONAL_SECRET_IN_NETWORK_ERROR');return new Response(request.method==='HEAD'?null:next.body||'',{status:next.status})};
async function run(sequence){responses=[...sequence];calls=[];return ensurePrivateBucket({credentials,bucket})}
const head=status=>({method:'HEAD',status}),put=(status,code)=>({method:'PUT',status,body:code?'<Error><Code>'+code+'</Code><Message>DO_NOT_ECHO_SECRET</Message></Error>':''});
try{
 assert.deepEqual(await run([head(200)]),{bucket,created:false,ready:true});assert.deepEqual(calls,['HEAD']);
 assert.deepEqual(await run([head(404),put(200),head(200)]),{bucket,created:true,ready:true});assert.deepEqual(calls,['HEAD','PUT','HEAD']);
 await assert.rejects(()=>run([head(403)]),/access denied/);assert.deepEqual(calls,['HEAD']);await assert.rejects(()=>run([head(500)]),/No bucket was created/);assert.deepEqual(calls,['HEAD']);
 await assert.rejects(()=>run([head(404),put(403)]),/bucket creation permission/);assert.deepEqual(calls,['HEAD','PUT']);
 await assert.rejects(()=>run([head(404),put(409,'BucketAlreadyExists')]),e=>/already taken/.test(e.message)&&!e.message.includes('DO_NOT_ECHO_SECRET'));assert.equal(calls.length,2);
 assert.equal((await run([head(404),put(409,'BucketAlreadyOwnedByYou'),head(200)])).created,false);
 await assert.rejects(()=>run([head(404),put(200),head(403)]),/access could not be verified/);
 await assert.rejects(()=>run([head(404),put(403,'AccessDenied')]),error=>{const help=bucketHelp(error);assert.equal(help.title,'Bucket creation is not allowed');assert.ok(help.steps.some(s=>s.includes('manually')));assert.ok(!help.steps.join(' ').includes('s3:'));return true});
 await assert.rejects(()=>run([head(404),put(403,'SignatureDoesNotMatch')]),error=>{assert.equal(bucketHelp(error).title,'QStorage could not verify your access details');return true});
 assert.ok(!JSON.stringify(bucketHelp(TypeError('FICTIONAL_SECRET_ERROR_BODY'))).includes('FICTIONAL_SECRET_ERROR_BODY'));
 const recovered=await run([head(404),{method:'PUT',lost:true},head(200)]);assert.equal(recovered.creationOutcome,'unconfirmed');assert.deepEqual(calls,['HEAD','PUT','HEAD']);
 for(const invalid of ['https://qstorage.quilibrium.com/a','ab','192.168.1.2','a..bad','Bad-Name']){calls=[];await assert.rejects(()=>ensurePrivateBucket({credentials,bucket:invalid}),/bucket name/);assert.equal(calls.length,0)}
 const abort=new AbortController();abort.abort();calls=[];await assert.rejects(()=>ensurePrivateBucket({credentials,bucket,signal:abort.signal}),/Abort/);assert.equal(calls.length,0);
 console.log('PASS LOCAL: signed S3 HEAD/restricted private CreateBucket/readback; existing buckets unchanged, 403/500 never treated as absence, create permission denial, global name collision, own-create race, lost ACK readback, failed verification, cancellation and invalid names. Fictional credentials and mocked HTTP only; no live QStorage.');
}finally{globalThis.fetch=originalFetch}
