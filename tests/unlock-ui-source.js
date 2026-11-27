import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {ProfileStore} from '../src/profile-store.js';
import {createPasskeyProfile,sealProfile,openProfile} from '../src/profile-crypto.js';
// Exact bundled unlock window with a simulated DOM, a synthetic authenticator and a mocked background.
class El{constructor(){this.value='';this.hidden=false;this.disabled=false;this.checked=false;this.textContent='';this.className=''}}
const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,new El());return elements.get(id)},idb=new IDBFactory(),store=new ProfileStore(idb);
const secret=crypto.getRandomValues(new Uint8Array(32)),rawId=crypto.getRandomValues(new Uint8Array(20)),credentialId=Buffer.from(rawId).toString('base64'),prfSalt=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
const {handle,recoveryKey}=await createPasskeyProfile({prf:secret,credentialId,prfSalt});await store.save(await sealProfile({fictional:true},handle),null);
const newId=crypto.getRandomValues(new Uint8Array(20)),newSecret=crypto.getRandomValues(new Uint8Array(32));let allowCreate=false,created=0,held=false;
let hang=false,hung=null;let cancel=false,prompts=0,reply={data:{unlocked:true}},closed=0;const sent=[];
const originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(_n,_o,fn)=>{if(held)return fn(null);held=true;try{return await fn({})}finally{held=false}}},credentials:{create:async o=>{if(!allowCreate)throw Error('unlock must not create passkeys unless asked');created++;assert.equal(o.publicKey.authenticatorSelection.userVerification,'required');return {rawId:newId.buffer,getClientExtensionResults:()=>({prf:{enabled:true,results:{first:Uint8Array.from(newSecret).buffer}}})}},get:async o=>{prompts++;if(hang)return new Promise((_,reject)=>{hung=o;o.signal?.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'})))});if(cancel)throw Object.assign(Error('x'),{name:'NotAllowedError'});assert.equal(o.publicKey.userVerification,'required');assert.deepEqual(Array.from(new Uint8Array(o.publicKey.allowCredentials[0].id)),Array.from(rawId));return {rawId:rawId.buffer,getClientExtensionResults:()=>({prf:{results:{first:Uint8Array.from(secret).buffer}}})}}}}});
globalThis.indexedDB=idb;globalThis.document={getElementById:el};globalThis.chrome={runtime:{sendMessage:async m=>{sent.push(m);return reply}}};globalThis.close=()=>{closed++};const timers=[];const realTimeout=globalThis.setTimeout;
const wait=async fn=>{for(let i=0;i<300;i++){if(fn())return;await new Promise(r=>realTimeout(r,3))}throw Error('Unlock UI timed out: '+el('unlock-status').textContent)};
try{
 cancel=true;await import('../dist/unlock.js');await wait(()=>/cancelled/.test(el('unlock-status').textContent));assert.equal(sent.length,0);assert.equal(el('passkey-go').disabled,false);assert.match(el('unlock-status').textContent,/recovery key/);
 // passkey path: one prompt, the secret goes only to the background as an unlock request
 cancel=false;await el('passkey-go').onclick();await wait(()=>/Unlocked/.test(el('unlock-status').textContent));
 assert.equal(sent.length,1);assert.deepEqual(Object.keys(sent[0]).sort(),['action','prf']);assert.equal(sent[0].action,'unlock');assert.deepEqual(Array.from(Buffer.from(sent[0].prf,'base64')),Array.from(secret));await wait(()=>closed===1);
 // background refuses: the message is shown and the window stays
 reply={error:'This passkey or recovery key does not open the saved vault'};await el('passkey-go').onclick();await wait(()=>/does not open/.test(el('unlock-status').textContent));assert.equal(closed,1);
 // recovery key path: field cleared immediately, key sent once
 reply={data:{unlocked:true}};el('recovery-key').value=recoveryKey;const pending=el('recovery-form').onsubmit({preventDefault(){}});assert.equal(el('recovery-key').value,'');await pending;
 assert.deepEqual(sent.at(-1),{action:'unlock',recoveryKey});await wait(()=>closed===2);assert.equal(prompts,3);
 // a passkey prompt that is still open must not block the recovery key: submitting it withdraws the prompt
 hang=true;const waiting=el('passkey-go').onclick();await wait(()=>hung!==null);assert.ok(hung.signal,'the prompt must be cancellable');
 const sentHang=sent.length;el('recovery-key').value=recoveryKey;await el('recovery-form').onsubmit({preventDefault(){}});await waiting;hang=false;
 assert.equal(hung.signal.aborted,true);assert.deepEqual(sent.at(-1),{action:'unlock',recoveryKey});assert.equal(sent.length,sentHang+1);assert.match(el('unlock-status').textContent,/^Unlocked/);assert.equal(el('passkey-go').disabled,false);
 // recovery key + "create a passkey for this computer": a second passkey slot is saved before unlocking, and it opens the profile
 const before=await store.read();allowCreate=true;el('recovery-add-passkey').checked=true;el('recovery-key').value=recoveryKey;await el('recovery-form').onsubmit({preventDefault(){}});
 assert.equal(created,1);const after=await store.read();assert.notEqual(after.revision,before.revision);assert.equal(after.slots.filter(s=>s.type==='passkey').length,2);
 assert.deepEqual((await openProfile(after,{prf:newSecret})).payload,{fictional:true});assert.deepEqual((await openProfile(after,{prf:secret})).payload,{fictional:true});assert.deepEqual(sent.at(-1),{action:'unlock',recoveryKey});await wait(()=>closed===4);
 // wrong recovery key with the option on: no passkey is created and nothing changes
 el('recovery-add-passkey').checked=true;el('recovery-key').value='AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA';const sentBefore=sent.length;await el('recovery-form').onsubmit({preventDefault(){}});assert.equal(created,1);assert.equal((await store.read()).revision,after.revision);assert.equal(sent.length,sentBefore);assert.match(el('unlock-status').textContent,/does not open/);
 console.log('PASS LOCAL: the exact unlock window asks the passkey once per attempt, never creates passkeys, sends only an unlock request with the secret, reports cancellation and refusal, keeps the window open on failure, clears the recovery key field immediately, closes after success, and on request adds a passkey for this computer only after the recovery key was proven correct. Simulated DOM, synthetic authenticator, fake IndexedDB, mocked background.');
}finally{delete globalThis.document;delete globalThis.indexedDB;delete globalThis.chrome;delete globalThis.close;if(originalNavigator)Object.defineProperty(globalThis,'navigator',originalNavigator);else delete globalThis.navigator}
