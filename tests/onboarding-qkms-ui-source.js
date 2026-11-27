import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {ProfileStore} from '../src/profile-store.js';
import {openProfile,isPasskeyProfile} from '../src/profile-crypto.js';
import {validateProfilePayload} from '../src/participant-state.js';
// Exact bundled Setup page with the QKMS layer switched on: storage, passkey, hosted key, restart check, profile.
class El{constructor(){this.value='';this.children=[];this.hidden=false;this.disabled=false;this.checked=false;this.textContent='';this.className=''}append(...n){this.children.push(...n)}replaceChildren(...n){this.children=n}}
const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,new El());return elements.get(id)},idb=new IDBFactory(),store=new ProfileStore(idb),keyId='fictional-ui-hosted-key';
const credentials={accessKey:'FICTIONAL_UI_ACCESS',secretKey:'FICTIONAL_UI_SECRET',region:'q-world-1',bucket:'qvault-ui-vault'};
const participant=id=>({version:1,keyId,sidecarId:id,entries:[['identity',Buffer.from(JSON.stringify({sidecarId:id,...Object.fromEntries(['identityPrivateX448','identityPublicX448','signedPreKeyPrivateX448','signedPreKeyPublicX448','signingPrivateEd448','signingPublicEd448','preKeySignature'].map(k=>[k,'ab'.repeat(57)]))})).toString('base64')],['keyshare/'+keyId,Buffer.from(JSON.stringify({n:Buffer.alloc(256,0xc3).toString('base64'),e:'AQAB',dShare:'AQ=='})).toString('base64')]]});
const workers=[];
class FakeWorker{constructor(){this.id=(workers.length===1?'f':'a').repeat(32);this.messages=[];this.terminated=false;workers.push(this)}terminate(){this.terminated=true}
 postMessage(m){this.messages.push(m);const a=m.action;if(a==='prepare')queueMicrotask(()=>this.onmessage?.({data:{event:'crypto-progress',stage:'synthetic prime search'}}));const data=a==='start'?{sidecarId:this.id}:['prepare','prepared'].includes(a)?{ready:true,keySize:2048}:a==='create'?{keyId,pending:true}:a==='ready'?{ready:true}:a==='encrypt'?{CiphertextBlob:'wrapped:'+m.value}:a==='decrypt'?{Plaintext:m.value.slice(8)}:a==='export-state'?participant(this.id):a==='pending-tasks'?{ids:[]}:{observer:true};queueMicrotask(()=>{if(!this.terminated)this.onmessage?.({data:{id:m.id,data}})})}}
const secret=crypto.getRandomValues(new Uint8Array(32)),rawId=crypto.getRandomValues(new Uint8Array(20));
const originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator'),originalFetch=globalThis.fetch;let held=false;
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(_n,_o,fn)=>{if(held)return fn(null);held=true;try{return await fn({})}finally{held=false}}},credentials:{create:async()=>({rawId:rawId.buffer,getClientExtensionResults:()=>({prf:{enabled:true,results:{first:Uint8Array.from(secret).buffer}}})}),get:async()=>{throw Error('not needed')}}}});
globalThis.Worker=FakeWorker;globalThis.indexedDB=idb;globalThis.document={getElementById:el,createElement:()=>new El()};globalThis.fetch=async()=>new Response(null,{status:200});
const wait=async fn=>{for(let i=0;i<400;i++){if(await fn())return;await new Promise(r=>setTimeout(r,3))}throw Error('Setup UI timed out: '+el('storage-status').textContent)};
try{
 await import('../dist/setup.js');await wait(()=>el('profile-state').textContent==='NO PROFILE YET');assert.equal(el('storage-qkms-label').hidden,false);
 el('storage-qkms').checked=true;el('storage-access').value=credentials.accessKey;el('storage-secret').value=credentials.secretKey;el('storage-region').value=credentials.region;el('storage-bucket').value=credentials.bucket;
 await el('storage-form').onsubmit({preventDefault(){}});
 assert.match(el('storage-status').textContent,/Vault created/);assert.equal(el('recovery-panel').hidden,false);assert.deepEqual([1,2,3,4].map(n=>el('step-'+n).className),['step done','step done','step done','step active']);
 const record=await store.read();assert.ok(isPasskeyProfile(record));assert.ok(!JSON.stringify(record).includes(credentials.secretKey));
 const payload=validateProfilePayload((await openProfile(record,{recoveryKey:el('recovery-key-text').textContent})).payload);assert.equal(payload.topology,'hosted');assert.equal(payload.keyId,keyId);assert.equal(payload.participants.length,1);assert.equal(Buffer.from(payload.localKey,'base64').length,32);
 assert.equal(workers.length,3);assert.ok(workers.every(w=>w.terminated));const starts=workers.flatMap(w=>w.messages.filter(m=>m.action==='start'));assert.equal(starts.length,2);assert.ok(starts.every(m=>m.hosted===true&&m.exportPrivateShareForTest===false));
 assert.deepEqual(workers.flatMap(w=>w.messages.filter(m=>m.action==='create'))[0].participants,['service','a'.repeat(32)]);
 const lines=el('storage-log').children.map(li=>li.children[1].textContent);assert.ok(lines.some(t=>/synthetic prime search/.test(t)));assert.ok(lines.some(t=>/Restart check passed/.test(t)));assert.ok(!lines.join(' ').includes(credentials.secretKey));
 assert.equal(el('storage-qkms-label').hidden,true);
 console.log('PASS LOCAL: with the QKMS layer on, the exact Setup page checks storage, creates the passkey, creates a hosted key (service plus this browser, no share export), passes the restart check, saves an encrypted passkey profile with the hosted topology and a local vault key, shows the recovery key, logs progress without secrets and terminates every worker. Simulated DOM/workers/HTTP, synthetic authenticator, fake IndexedDB, real crypto.');
}finally{globalThis.fetch=originalFetch;delete globalThis.Worker;delete globalThis.document;delete globalThis.indexedDB;if(originalNavigator)Object.defineProperty(globalThis,'navigator',originalNavigator);else delete globalThis.navigator}
