import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
import init from '../vendor/channel/channelwasm.js';
import {generateIdentity} from '../upstream/sdk-core/sidecar/identity.ts';
import {sealProfile,openProfile} from '../src/profile-crypto.js';
import {fixtureKey,fixtureSecret,fixtureUnlock,fixtureProfile} from './fixture-profile.js';
import {validateProfilePayload} from '../src/participant-state.js';
await init({module_or_path:await readFile(new URL('../vendor/channel/channelwasm_bg.wasm',import.meta.url))});
const keyId='fictional-saved-key';const participants=[];
for(let i=0;i<2;i++){const identity=await generateIdentity();const share={n:Buffer.alloc(256,0xc3).toString('base64'),e:'AQAB',dShare:'AQ=='};participants.push({version:1,keyId,sidecarId:identity.sidecarId,entries:[['identity',Buffer.from(JSON.stringify(identity)).toString('base64')],['keyshare/'+keyId,Buffer.from(JSON.stringify(share)).toString('base64')]]})}
const credentials={accessKey:'FICTIONAL_ACCESS',secretKey:'FICTIONAL_SECRET',region:'q-world-1',bucket:'fictional-bucket'};
const payload=validateProfilePayload({version:1,keyId,credentials,participants,vault:null});const sealed=await sealProfile(payload,await fixtureKey('fictional passkey label only'));
const reopened=validateProfilePayload((await openProfile(JSON.parse(JSON.stringify(sealed)),fixtureSecret('fictional passkey label only'))).payload);
let count=0;const methods=[];
async function workerClient(){const w=new Worker(new URL('./restore-worker-shim.mjs',import.meta.url));const pending=new Map();let next=1;
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Worker init timed out')),10000);w.on('message',m=>{if(m.rpc){methods.push(m.rpc);return}if(m.harnessReady){clearTimeout(t);resolve();return}const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.t);m.error?p.reject(Error(m.error)):p.resolve(m.data)}});w.on('error',reject)});
 return {w,call:(action,args={})=>new Promise((resolve,reject)=>{const id=next++,t=setTimeout(()=>reject(Error('Worker call timed out')),10000);pending.set(id,{resolve,reject,t});w.postMessage({id,action,...args})})};
}
for(const state of reopened.participants){const p=await workerClient();try{const started=await p.call('start',{credentials,restore:state});assert.equal(started.sidecarId,state.sidecarId);assert.deepEqual(await p.call('export-state',{keyId}),state);await assert.rejects(()=>p.call('create',{participants:[]}));count++}finally{await p.w.terminate()}}
const broken=structuredClone(reopened.participants[0]);broken.entries=broken.entries.filter(([k])=>k!=='identity');const p=await workerClient();const before=methods.length;try{await assert.rejects(()=>p.call('start',{credentials,restore:broken}));assert.equal(methods.length,before)}finally{await p.w.terminate()}
assert.equal(count,2);assert.ok(!methods.includes('CreateKey'));assert.equal(methods.filter(m=>m==='RegisterSidecar').length,2);
console.log('PASS LOCAL: encrypted profile reopened into two fresh actual bundled workers, same participant identities and share bytes restored, no CreateKey/preparation, missing identity rejected before registration. Real WASM/channel identity; mocked QKMS only, no real credentials.');
