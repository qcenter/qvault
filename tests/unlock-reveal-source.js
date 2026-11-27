import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {ProfileStore} from '../src/profile-store.js';
import {createPasskeyProfile,sealProfile} from '../src/profile-crypto.js';
// The unlock window opened to show one password: it asks for the passkey, sends a reveal request (never an unlock),
// shows the password, hides it again after 30 seconds and when the window closes. Simulated DOM and authenticator.
class El{constructor(){this.value='';this.hidden=false;this.disabled=false;this.checked=false;this.textContent='';this.className=''}}
const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,new El());return elements.get(id)},idb=new IDBFactory(),store=new ProfileStore(idb);
const secret=crypto.getRandomValues(new Uint8Array(32)),rawId=crypto.getRandomValues(new Uint8Array(20)),credentialId=Buffer.from(rawId).toString('base64'),prfSalt=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
const {handle,recoveryKey}=await createPasskeyProfile({prf:secret,credentialId,prfSalt});await store.save(await sealProfile({fictional:true},handle),null);
const sent=[],copied=[],listeners={};let closed=0,cancel=false,reply={data:{title:'Fixture',username:'fixture-user',password:'FICTIONAL_SHOWN_PASSWORD'}};
const originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async t=>{copied.push(t)}},locks:{request:async(_n,_o,fn)=>fn({})},credentials:{create:async()=>{throw Error('showing a password must never create a passkey')},get:async()=>{if(cancel)throw Object.assign(Error('x'),{name:'NotAllowedError'});return {rawId:rawId.buffer,getClientExtensionResults:()=>({prf:{results:{first:Uint8Array.from(secret).buffer}}})}}}}});
globalThis.indexedDB=idb;globalThis.document={getElementById:el};globalThis.chrome={runtime:{sendMessage:async m=>{sent.push(m);return reply}}};globalThis.close=()=>{closed++};
globalThis.location={search:'?reveal=entry-1&origin='+encodeURIComponent('https://example.test')};globalThis.addEventListener=(e,f)=>(listeners[e]??=[]).push(f);
const timers=[],realTimeout=globalThis.setTimeout,realInterval=globalThis.setInterval;globalThis.setInterval=(f,ms)=>{if(ms===1000){timers.push(f);return 0}return realInterval(f,ms)};
const wait=async fn=>{for(let i=0;i<300;i++){if(fn())return;await new Promise(r=>realTimeout(r,3))}throw Error('Reveal UI timed out: '+el('unlock-status').textContent)};
try{
 await import('../dist/unlock.js');await wait(()=>el('reveal-box').hidden===false&&el('reveal-password').textContent==='FICTIONAL_SHOWN_PASSWORD');
 assert.equal(el('unlock-heading').textContent,'Show password');assert.equal(el('recovery-details').hidden,true,'no recovery key option in this window');
 assert.equal(sent.length,1);assert.deepEqual(Object.keys(sent[0]).sort(),['action','id','origin','prf']);assert.equal(sent[0].action,'reveal');assert.equal(sent[0].id,'entry-1');assert.equal(sent[0].origin,'https://example.test');assert.equal(closed,0,'the window stays open to show it');
 assert.equal(el('reveal-user').textContent,'fixture-user');assert.equal(el('reveal-previous').hidden,true,'no previous password, no line for it');for(const id of ['passkey-actions','recovery-details','unlock-intro'])assert.equal(el(id).hidden,true,'while the password is shown nothing else takes room, so the window does not scroll');assert.equal(el('unlock-main').className,'unlock-window revealing');await el('reveal-copy').onclick();assert.deepEqual(copied,['FICTIONAL_SHOWN_PASSWORD']);
 assert.equal(timers.length,1);assert.match(el('unlock-status').textContent,/Copied\. Hidden in 30 s/);timers[0]();assert.match(el('unlock-status').textContent,/Hidden in 29 s/,'it counts down');assert.equal(el('reveal-box').hidden,false);for(let i=0;i<29;i++)timers[0]();assert.equal(el('reveal-password').textContent,'');assert.equal(el('reveal-box').hidden,true,'hidden again after 30 seconds');assert.equal(el('passkey-actions').hidden,false);assert.equal(el('recovery-details').hidden,true);
 // showing a password is passkey only: the recovery key is not offered here
 assert.equal(el('recovery-details').hidden,true);await el('passkey-go').onclick();await wait(()=>el('reveal-box').hidden===false);assert.ok(sent.every(m=>m.recoveryKey===undefined));
 for(const f of listeners.pagehide??[])f();assert.equal(el('reveal-password').textContent,'','cleared when the window closes');
 reply={error:'This passkey or recovery key does not open the saved vault'};await el('passkey-go').onclick();await wait(()=>/does not open/.test(el('unlock-status').textContent));assert.equal(el('reveal-box').hidden,true);
 reply={data:{title:'Fixture',username:'fixture-user',password:'FICTIONAL_SHOWN_PASSWORD',previous:{password:'FICTIONAL_OLDER_PASSWORD',at:'2026-11-20T10:00:00.000Z'}}};await el('passkey-go').onclick();await wait(()=>el('reveal-previous').hidden===false);assert.match(el('reveal-previous').textContent,/Previous password/);assert.match(el('reveal-previous').textContent,/FICTIONAL_OLDER_PASSWORD/);for(const f of listeners.pagehide??[])f();assert.equal(el('reveal-previous').textContent,'');
 // Only when the passkey could not be used here does the recovery key appear as a way to see the password.
 reply={data:{title:'Fixture',username:'fixture-user',password:'FICTIONAL_SHOWN_PASSWORD'}};cancel=true;await el('passkey-go').onclick();await wait(()=>el('recovery-details').hidden===false);assert.equal(el('reveal-box').hidden,true);assert.equal(el('recovery-add-label').hidden,true,'no passkey is created from this window');
 el('recovery-key').value=recoveryKey;await el('recovery-form').onsubmit({preventDefault(){}});await wait(()=>el('reveal-box').hidden===false);assert.equal(sent.at(-1).action,'reveal');assert.equal(sent.at(-1).recoveryKey,recoveryKey);assert.equal(el('recovery-key').value,'');cancel=false;
 assert.ok(!sent.some(m=>m.action==='unlock'),'this mode never unlocks');
 {const before=closed;el('unlock-cancel').onclick();assert.equal(closed,before+1,'Cancel closes the window without doing anything');}
 console.log('PASS LOCAL: opened to show one password, the exact unlock window asks for the passkey, sends only a reveal request, shows and copies the password, counts down 30 seconds and then hides it, hides it on close, offers the recovery key only after the passkey could not be used, has a Cancel button, and shows a refusal. Simulated DOM, authenticator and background.');
}finally{globalThis.setInterval=realInterval;if(originalNavigator)Object.defineProperty(globalThis,'navigator',originalNavigator);delete globalThis.chrome;delete globalThis.document;delete globalThis.indexedDB;delete globalThis.close;delete globalThis.location;delete globalThis.addEventListener}
