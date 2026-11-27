import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {ProfileStore} from '../src/profile-store.js';
import {openProfile,isPasskeyProfile} from '../src/profile-crypto.js';
import {validateProfilePayload} from '../src/participant-state.js';
// Exact bundled Setup page on a new device: storage + passkey in one submit, then the recovery key is shown once.
class El{constructor(){this.value='';this.children=[];this.hidden=false;this.disabled=false;this.checked=false;this.textContent='';this.className=''}append(...n){this.children.push(...n)}replaceChildren(...n){this.children=n}}
const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,new El());return elements.get(id)},idb=new IDBFactory(),store=new ProfileStore(idb);
const credentials={accessKey:'FICTIONAL_UI_ACCESS',secretKey:'FICTIONAL_UI_SECRET',region:'q-world-1',bucket:'qvault-ui-vault'};
const secret=crypto.getRandomValues(new Uint8Array(32)),rawId=crypto.getRandomValues(new Uint8Array(20));let creates=0,cancel=false,gets=0;
const originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator'),originalFetch=globalThis.fetch;let held=false;const requests=[];
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(_n,_o,fn)=>{if(held)return fn(null);held=true;try{return await fn({})}finally{held=false}}},credentials:{create:async o=>{creates++;if(cancel)throw Object.assign(Error('x'),{name:'NotAllowedError'});assert.equal(o.publicKey.authenticatorSelection.userVerification,'required');return {rawId:rawId.buffer,getClientExtensionResults:()=>({prf:{enabled:true,results:{first:Uint8Array.from(secret).buffer}}})}},get:async()=>{gets++;return {rawId:rawId.buffer,getClientExtensionResults:()=>({prf:{results:{first:Uint8Array.from(secret).buffer}}})}}}}});
globalThis.Worker=class{constructor(){throw Error('Passkey setup must not start participant workers')}};
globalThis.indexedDB=idb;globalThis.document={getElementById:el,createElement:()=>new El()};
globalThis.fetch=async request=>{assert.equal(request.url,'https://qstorage.quilibrium.com/qvault-ui-vault');requests.push(request.method);return new Response(null,{status:200})};
const wait=async fn=>{for(let i=0;i<400;i++){if(await fn())return;await new Promise(r=>setTimeout(r,3))}throw Error('Setup UI timed out: '+el('storage-status').textContent)};
const fill=()=>{el('storage-access').value=credentials.accessKey;el('storage-secret').value=credentials.secretKey;el('storage-region').value=credentials.region;el('storage-bucket').value=credentials.bucket};
try{
 await import('../dist/setup.js');await wait(()=>el('profile-state').textContent==='NO PROFILE YET');
 assert.equal(el('storage-submit-label').textContent,'Set up vault with passkey');el('storage-qkms').checked=false;assert.equal(el('recovery-panel').hidden,true);
 // cancelled passkey prompt: nothing saved, can retry
 cancel=true;fill();await el('storage-form').onsubmit({preventDefault(){}});assert.match(el('storage-status').textContent,/cancelled/);assert.equal(await store.read(),null);assert.equal(el('step-1').className,'step done');assert.equal(el('step-2').className,'step error');assert.equal(el('recovery-panel').hidden,true);assert.equal(el('storage-submit').disabled,false);
 cancel=false;fill();const operation=el('storage-form').onsubmit({preventDefault(){}});for(const id of ['storage-secret','storage-access'])assert.equal(el(id).value,'');assert.equal(el('storage-submit').disabled,true);el('storage-form').onsubmit({preventDefault(){}});await operation;
 assert.equal(creates,2);assert.deepEqual(requests,['HEAD','HEAD']);
 const record=await store.read();assert.ok(isPasskeyProfile(record));assert.ok(!JSON.stringify(record).includes(credentials.secretKey));
 // recovery key shown once, and it really opens the saved profile
 assert.equal(el('recovery-panel').hidden,false);assert.deepEqual([1,2,3,4].map(n=>el('step-'+n).className),['step done','step done','step skipped','step active']);assert.equal(el('setup-steps').hidden,false);const key=el('recovery-key-text').textContent;assert.match(key,/^([A-Z2-7]{4}-){12}[A-Z2-7]{4}$/);
 const payload=validateProfilePayload((await openProfile(record,{recoveryKey:key})).payload);assert.equal(payload.topology,'local');assert.deepEqual(payload.credentials,credentials);
 assert.equal(el('profile-state').textContent,'PROFILE SAVED');assert.equal(el('storage-form').hidden,false);assert.equal(el('storage-submit-label').textContent,'Save cloud storage');assert.equal(el('storage-bucket').required,false);assert.match(el('storage-status').textContent,/Vault created/);
 // cannot be dismissed without confirming; after confirming the key is wiped from the page
 el('recovery-done').onclick();assert.equal(el('recovery-panel').hidden,false);assert.equal(el('recovery-key-text').textContent,key);
 el('recovery-ack').checked=true;el('recovery-done').onclick();assert.equal(el('recovery-panel').hidden,true);assert.equal(el('recovery-key-text').textContent,'');assert.equal(el('step-4').className,'step done');assert.equal(el('finish-panel').hidden,false);assert.equal(el('storage-form').hidden,true);{let removed=null;const had=globalThis.chrome;globalThis.chrome={...(had||{}),tabs:{getCurrent:f=>f({id:7}),remove:id=>{removed=id}}};el('finish-close').onclick();assert.equal(removed,7);globalThis.chrome=had;el('finish-settings').onclick();await new Promise(r=>setTimeout(r,20));assert.equal(el('finish-panel').hidden,true);assert.equal(el('storage-form').hidden,false);}
 // changing storage on the passkey vault asks for the passkey; when the vault cannot be reopened with the new details nothing is replaced
 const saved=await store.read();el('storage-access').value='FICTIONAL_OTHER_ACCESS';el('storage-secret').value='FICTIONAL_OTHER_SECRET';await el('storage-form').onsubmit({preventDefault(){}});
 assert.equal(gets,1);assert.match(el('storage-status').textContent,/could not be reopened/);assert.equal((await store.read()).revision,saved.revision);assert.equal(el('storage-secret').value,'');
 console.log('PASS LOCAL: on a new device the exact Setup page needs no master password, checks storage, creates one passkey, saves only an encrypted passkey profile, starts no participant worker, survives a cancelled prompt, shows a working recovery key once and wipes it after confirmation. Simulated DOM/HTTP, synthetic authenticator, fake IndexedDB, real crypto.');
}finally{globalThis.fetch=originalFetch;delete globalThis.Worker;delete globalThis.document;delete globalThis.indexedDB;if(originalNavigator)Object.defineProperty(globalThis,'navigator',originalNavigator);else delete globalThis.navigator}
