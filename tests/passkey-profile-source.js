import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {createPasskeyProfile,sealProfile,openProfile,validateEnvelope,generateRecoveryKey,parseRecoveryKey,isPasskeyProfile,addPasskeyToProfile} from '../src/profile-crypto.js';
import {createPasskey,passkeySecret,PasskeyError} from '../src/passkey.js';
import {restoredMessage,backupMessage} from '../src/recovery-messages.js';
{assert.match(restoredMessage(),/Unlock with passkey/);assert.match(restoredMessage(),/recovery key/);assert.match(backupMessage(),/passkey or your recovery key/);for(const text of [restoredMessage(),backupMessage()])assert.doesNotMatch(text,/master password/);}
import {SetupPasskeyVault} from '../src/setup-passkey.js';
import {LocalKeyPeer} from '../src/local-peer.js';
import {validateProfilePayload} from '../src/participant-state.js';
import {ProfileStore} from '../src/profile-store.js';
import {VaultRuntime} from '../src/vault-runtime.js';
import {saveCloudVault,loadCloudVault} from '../src/cloud-vault.js';
import {SetupProfile} from '../src/setup-profile.js';
// Passkey-protected profiles with a local vault key. Synthetic authenticator, fake IndexedDB, real crypto.
function authenticator({prfAtCreate=false,prf=true,cancel=false}={}){
 const secrets=new Map(),calls=[];const out=(id,salt)=>{const base=secrets.get(id);return Uint8Array.from(base,(b,i)=>b^salt[i%salt.length]).buffer};
 return {calls,secrets,create:async o=>{calls.push(['create',o]);if(cancel)throw Object.assign(Error('x'),{name:'NotAllowedError'});const raw=crypto.getRandomValues(new Uint8Array(20)),id=Buffer.from(raw).toString('base64');secrets.set(id,crypto.getRandomValues(new Uint8Array(32)));const salt=o.publicKey.extensions.prf.eval.first;return {rawId:raw.buffer,getClientExtensionResults:()=>prf?{prf:{enabled:true,...(prfAtCreate?{results:{first:out(id,salt)}}:{})}}:{}}},
  get:async o=>{calls.push(['get',o]);if(cancel)throw Object.assign(Error('x'),{name:'NotAllowedError'});const allowed=o.publicKey.allowCredentials.map(c=>Buffer.from(new Uint8Array(c.id)).toString('base64')).find(id=>secrets.has(id));if(!allowed)throw Object.assign(Error('x'),{name:'NotAllowedError'});const url=allowed.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');const salt=o.publicKey.extensions.prf.evalByCredential[url].first;return {rawId:Uint8Array.from(Buffer.from(allowed,'base64')).buffer,getClientExtensionResults:()=>prf?{prf:{results:{first:out(allowed,salt)}}}:{}}}};
}
// --- recovery key format
const rk=generateRecoveryKey();assert.match(rk,/^([A-Z2-7]{4}-){12}[A-Z2-7]{4}$/);assert.equal(parseRecoveryKey(rk).length,32);assert.deepEqual(parseRecoveryKey(rk.toLowerCase().replace(/-/g,' ')),parseRecoveryKey(rk));assert.notEqual(generateRecoveryKey(),rk);
for(const bad of ['',rk.slice(0,-1),rk+'A',rk.replace(/[A-Z2-7]/,'1'),null,42])assert.throws(()=>parseRecoveryKey(bad),/recovery key/);
// --- passkey helper: one prompt when the authenticator answers at creation, two otherwise; user verification always required
{const a=authenticator(),made=await createPasskey({container:a}),abort=new AbortController();await passkeySecret({container:a,signal:abort.signal,slots:[{type:'passkey',credentialId:made.credentialId,prfSalt:made.prfSalt}]});assert.equal(a.calls.at(-1)[1].signal,abort.signal)}
for(const prfAtCreate of [true,false]){const a=authenticator({prfAtCreate}),made=await createPasskey({container:a});assert.equal(made.prf.length,32);assert.equal(Buffer.from(made.prfSalt,'base64').length,32);assert.equal(a.calls.length,prfAtCreate?1:2);assert.equal(a.calls[0][1].publicKey.authenticatorSelection.userVerification,'required');assert.equal(a.calls[0][1].publicKey.rp.id,undefined);
 const again=await passkeySecret({container:a,slots:[{type:'passkey',credentialId:made.credentialId,prfSalt:made.prfSalt}]});assert.deepEqual(Array.from(again.prf),Array.from(made.prf));assert.equal(again.credentialId,made.credentialId)}
await assert.rejects(()=>createPasskey({container:authenticator({prf:false})}),e=>e instanceof PasskeyError&&e.code==='no-secret');
await assert.rejects(()=>createPasskey({container:authenticator({cancel:true})}),e=>e instanceof PasskeyError&&e.code==='cancelled');
await assert.rejects(()=>createPasskey({container:{}}),e=>e instanceof PasskeyError&&e.code==='unavailable');
await assert.rejects(()=>passkeySecret({container:authenticator(),slots:[]}),e=>e instanceof PasskeyError);
// --- envelope: opens with the passkey secret or the recovery key, nothing else
const auth=authenticator(),pk=await createPasskey({container:auth}),{handle,recoveryKey}=await createPasskeyProfile(pk);
const payload={hello:'FICTIONAL_PROFILE_SECRET'},record=await sealProfile(payload,handle);
assert.ok(isPasskeyProfile(record));assert.ok(validateEnvelope(record));const raw=JSON.stringify(record);for(const secret of ['FICTIONAL_PROFILE_SECRET',recoveryKey,Buffer.from(pk.prf).toString('base64')])assert.ok(!raw.includes(secret));
assert.deepEqual((await openProfile(record,{prf:pk.prf})).payload,payload);assert.deepEqual((await openProfile(record,{recoveryKey})).payload,payload);
const reopened=await openProfile(record,{recoveryKey});const second=await sealProfile({hello:'again'},reopened.handle);assert.notEqual(second.revision,record.revision);assert.deepEqual((await openProfile(second,{prf:pk.prf})).payload,{hello:'again'});
for(const wrong of [{prf:crypto.getRandomValues(new Uint8Array(32))},{recoveryKey:generateRecoveryKey()},{recoveryKey:'nonsense'},'a typed password',{},null])await assert.rejects(()=>openProfile(record,wrong),/does not open|Invalid/);
const tampered=structuredClone(record);tampered.profileId=crypto.randomUUID();await assert.rejects(()=>openProfile(tampered,{recoveryKey}));
const swapped=structuredClone(record);swapped.slots[0].credentialId=Buffer.from('other').toString('base64');await assert.rejects(()=>openProfile(swapped,{prf:pk.prf}));
for(const mutate of [r=>r.slots=[],r=>r.slots.push({type:'other'}),r=>delete r.slots[1].wrapped,r=>r.slots=r.slots.filter(s=>s.type!=='recovery')])  {const bad=structuredClone(record);mutate(bad);assert.throws(()=>validateEnvelope(bad))}
// --- a second passkey (another computer): added with the recovery key or an existing passkey, old ways in keep working
{
 const other=authenticator(),pk2=await createPasskey({container:other}),added=await addPasskeyToProfile(record,{recoveryKey},pk2);
 assert.notEqual(added.revision,record.revision);assert.equal(added.profileId,record.profileId);assert.equal(added.slots.filter(s=>s.type==='passkey').length,2);assert.ok(validateEnvelope(added));
 for(const secret of [{prf:pk.prf},{prf:pk2.prf},{recoveryKey}])assert.deepEqual((await openProfile(added,secret)).payload,payload);
 const third=await createPasskey({container:authenticator()});const viaPasskey=await addPasskeyToProfile(added,{prf:pk2.prf},third);assert.equal(viaPasskey.slots.length,4);assert.deepEqual((await openProfile(viaPasskey,{prf:third.prf})).payload,payload);
 await assert.rejects(()=>addPasskeyToProfile(record,{recoveryKey:generateRecoveryKey()},pk2),/does not open/);await assert.rejects(()=>addPasskeyToProfile(record,{recoveryKey},{...pk2,prf:new Uint8Array(8)}),/Invalid passkey secret/);
 await assert.rejects(()=>addPasskeyToProfile(added,{recoveryKey},pk2),/already/);
 let full=record;for(let i=0;i<6;i++)full=await addPasskeyToProfile(full,{recoveryKey},await createPasskey({container:authenticator()}));assert.equal(full.slots.length,8);await assert.rejects(async()=>addPasskeyToProfile(full,{recoveryKey},await createPasskey({container:authenticator()})),/too many/i);
}
// the older master-password profile format is no longer understood: it is refused before any secret is tried
{const old={format:'qvault-profile-v1',profileId:crypto.randomUUID(),revision:crypto.randomUUID(),kdf:{name:'PBKDF2-SHA256',iterations:600000,salt:'AAAAAAAAAAAAAAAAAAAAAA=='},nonce:'AAAAAAAAAAAAAAAA',ciphertext:'A'.repeat(64)};assert.equal(isPasskeyProfile(old),false);assert.throws(()=>validateEnvelope(old),/Unsupported encrypted profile/);await assert.rejects(()=>openProfile(old,'fictional master password'),/Unsupported encrypted profile/);await assert.rejects(()=>sealProfile({a:1},{key:null,profileId:old.profileId,kdf:old.kdf}),/Unsupported profile key/);}
// --- local topology payload + local key peer
const credentials={accessKey:'FICTIONAL_LOCAL_ACCESS',secretKey:'FICTIONAL_LOCAL_SECRET',region:'q-world-1',bucket:'qvault-local'},localKey=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
const local={version:1,topology:'local',keyId:'local',credentials,participants:[],localKey,vault:null};
assert.ok(validateProfilePayload(structuredClone(local)));
for(const bad of [{...local,localKey:undefined},{...local,keyId:'other'},{...local,participants:[{}]}])assert.throws(()=>validateProfilePayload(bad),/Invalid protected profile/);
const peer=new LocalKeyPeer(),blob=Buffer.alloc(60,5).toString('base64');assert.deepEqual(await peer.call('encrypt',{value:blob}),{CiphertextBlob:blob});assert.deepEqual(await peer.call('decrypt',{value:blob}),{Plaintext:blob});
await assert.rejects(()=>peer.call('encrypt',{value:Buffer.alloc(32,5).toString('base64')}),/unwrapped/);await assert.rejects(()=>peer.call('create',{}),/Unsupported/);peer.stop();await assert.rejects(()=>peer.call('encrypt',{value:blob}),/locked/);
// a snapshot written through the local peer is unreadable without the local vault key even though no key service is involved
const originalFetch=globalThis.fetch,objects=new Map();globalThis.fetch=async input=>{const request=input instanceof Request?input:new Request(input),path=new URL(request.url).pathname;if(request.method==='PUT'){objects.set(path,await request.text());return new Response('')}return objects.has(path)?new Response(objects.get(path)):new Response('',{status:404})};
try{
 const profileId=crypto.randomUUID(),args={credentials,profileId,keyId:'local',peer:new LocalKeyPeer(),signal:new AbortController().signal},entries=[{id:crypto.randomUUID(),title:'T',url:'https://example.test',username:'u',password:'FICTIONAL_ENTRY_PASSWORD'}];
 const reference=await saveCloudVault({...args,localKey,entries});assert.deepEqual(await loadCloudVault({...args,localKey,reference}),entries);assert.ok(![...objects.values()].join('').includes('FICTIONAL_ENTRY_PASSWORD'));
 await assert.rejects(()=>loadCloudVault({...args,localKey:Buffer.alloc(32,1).toString('base64'),reference}),/local vault key/);await assert.rejects(()=>saveCloudVault({...args,entries}),/unwrapped/);
}finally{globalThis.fetch=originalFetch}
// --- Setup: storage check + passkey -> saved profile; then the runtime unlocks it with the passkey secret or the recovery key
{
 const store=new ProfileStore(new IDBFactory()),a=authenticator(),phases=[];let checked=0,held=false;
 const setup=new SetupPasskeyVault({store,lease:async()=>{assert.equal(held,false);held=true;return()=>{held=false}},ensure:async({credentials:c,bucket})=>{checked++;assert.equal(c.bucket,bucket);return {ready:true}},passkey:()=>createPasskey({container:a})});
 const result=await setup.create({credentials:{accessKey:credentials.accessKey,secretKey:credentials.secretKey,region:credentials.region},bucket:credentials.bucket,onProgress:p=>phases.push(p)});
 assert.equal(checked,1);assert.equal(held,false);assert.match(result.recoveryKey,/^([A-Z2-7]{4}-){12}[A-Z2-7]{4}$/);assert.ok(phases.indexOf('passkey')>phases.indexOf('checking'));assert.equal(phases.at(-1),'vault-created');
 const saved=await store.read();assert.ok(isPasskeyProfile(saved));const text=JSON.stringify(saved);for(const secret of [credentials.secretKey,credentials.accessKey,result.recoveryKey])assert.ok(!text.includes(secret));
 const opened=validateProfilePayload((await openProfile(saved,{recoveryKey:result.recoveryKey})).payload);assert.equal(opened.topology,'local');assert.deepEqual(opened.credentials,credentials);assert.equal(Buffer.from(opened.localKey,'base64').length,32);assert.deepEqual(opened.participants,[]);
 await assert.rejects(()=>setup.create({credentials,bucket:credentials.bucket}),/already exists/);assert.equal(checked,1);
 // failure paths save nothing: storage refused, passkey cancelled, authenticator without the secret
 for(const [options,pattern]of [[{ensure:async()=>{throw Error('FICTIONAL_BUCKET_DENIED')}},/FICTIONAL_BUCKET_DENIED/],[{passkey:()=>createPasskey({container:authenticator({cancel:true})})},e=>e.code==='cancelled'],[{passkey:()=>createPasskey({container:authenticator({prf:false})})},e=>e.code==='no-secret']]){const empty=new ProfileStore(new IDBFactory());await assert.rejects(()=>new SetupPasskeyVault({store:empty,lease:async()=>()=>{},ensure:async()=>({ready:true}),passkey:()=>createPasskey({container:a}),...options}).create({credentials,bucket:credentials.bucket}),pattern);assert.equal(await empty.read(),null)}
 await assert.rejects(()=>new SetupPasskeyVault({store:new ProfileStore(new IDBFactory()),lease:async()=>()=>{},ensure:async()=>{throw Error('must not be reached')},passkey:async()=>{throw Error('must not be reached')}}).create({credentials:{...credentials,accessKey:''},bucket:credentials.bucket}),/Invalid|Enter/);
 // --- optional QKMS layer: the same setup with a hosted key (service + this browser) on top of the local vault key
 {
  const keyId='fictional-hosted-layer-key',share=id=>({version:1,keyId,sidecarId:id,entries:[['identity',Buffer.from(JSON.stringify({sidecarId:id,...Object.fromEntries(['identityPrivateX448','identityPublicX448','signedPreKeyPrivateX448','signedPreKeyPublicX448','signingPrivateEd448','signingPublicEd448','preKeySignature'].map(k=>[k,'ab'.repeat(57)]))})).toString('base64')],['keyshare/'+keyId,Buffer.from(JSON.stringify({n:Buffer.alloc(256,0xc3).toString('base64'),e:'AQAB',dShare:'AQ=='})).toString('base64')]]});
  const hostedStore=new ProfileStore(new IDBFactory()),order=[];let seen=null;
  const hosted=new SetupPasskeyVault({store:hostedStore,lease:async()=>()=>{},ensure:async()=>{order.push('bucket');return {ready:true}},passkey:async()=>{order.push('passkey');return createPasskey({container:a})},hostedKey:async o=>{order.push('qkms');seen=o;o.onLog('synthetic key step');return {keyId,participant:share('c'.repeat(32))}}});
  const logs=[],made=await hosted.create({credentials,bucket:credentials.bucket,qkms:true,onLog:l=>logs.push(l)});
  assert.deepEqual(order,['bucket','passkey','qkms']);assert.deepEqual(seen.credentials,credentials);assert.deepEqual(logs,['synthetic key step']);
  const hostedRecord=await hostedStore.read();assert.ok(isPasskeyProfile(hostedRecord));const text2=JSON.stringify(hostedRecord);for(const secret of [credentials.secretKey,keyId,'identityPrivateX448',made.recoveryKey])assert.ok(!text2.includes(secret));
  const hp=validateProfilePayload((await openProfile(hostedRecord,{recoveryKey:made.recoveryKey})).payload);assert.equal(hp.topology,'hosted');assert.equal(hp.keyId,keyId);assert.equal(hp.participants.length,1);assert.equal(hp.participants[0].sidecarId,'c'.repeat(32));assert.equal(Buffer.from(hp.localKey,'base64').length,32);assert.deepEqual(hp.credentials,credentials);
  // key creation fails after the passkey: nothing saved, and the message says the new passkey is unused
  const failing=new ProfileStore(new IDBFactory());await assert.rejects(()=>new SetupPasskeyVault({store:failing,lease:async()=>()=>{},ensure:async()=>({ready:true}),passkey:()=>createPasskey({container:a}),hostedKey:async()=>{throw Error('FICTIONAL_KEY_FAILURE')}}).create({credentials,bucket:credentials.bucket,qkms:true}),/FICTIONAL_KEY_FAILURE[\s\S]*passkey created for this attempt/);assert.equal(await failing.read(),null);
  // asked for the QKMS layer but it is not available: refuse before the passkey prompt
  let prompted=0;await assert.rejects(()=>new SetupPasskeyVault({store:new ProfileStore(new IDBFactory()),lease:async()=>()=>{},ensure:async()=>({ready:true}),passkey:async()=>{prompted++;return createPasskey({container:a})}}).create({credentials,bucket:credentials.bucket,qkms:true}),/not available/);assert.equal(prompted,0);
 }
 // --- changing the storage details of a passkey vault: passkey first, bucket check, reopen check, then replace
 {
  const s2=new ProfileStore(new IDBFactory()),auth2=authenticator();let checks=0,verified=0,failVerify=false;
  const make=()=>new SetupPasskeyVault({store:s2,lease:async()=>()=>{},ensure:async({credentials:c,bucket})=>{checks++;assert.equal(c.bucket,bucket);return {ready:true}},passkey:()=>createPasskey({container:auth2}),secret:slots=>passkeySecret({container:auth2,slots}),verify:async({record,secret})=>{verified++;assert.equal(secret.prf.length,32);if(failVerify)throw Error('FICTIONAL_REOPEN_FAILURE');return record}});
  const first=await make().create({credentials,bucket:credentials.bucket});const original=await s2.read();
  const phases=[];assert.deepEqual(await make().updateStorage({credentials:{accessKey:'FICTIONAL_NEW_ACCESS',secretKey:'FICTIONAL_NEW_SECRET',region:''},bucket:'',onProgress:p=>phases.push(p)}),{profileSaved:true});
  assert.ok(phases.indexOf('passkey-confirm')<phases.indexOf('checking')&&phases.indexOf('checking')<phases.indexOf('reopening'));assert.equal(verified,1);
  const changed=await s2.read();assert.notEqual(changed.revision,original.revision);assert.equal(changed.profileId,original.profileId);assert.ok(!JSON.stringify(changed).includes('FICTIONAL_NEW_SECRET'));
  const p2=validateProfilePayload((await openProfile(changed,{recoveryKey:first.recoveryKey})).payload);assert.deepEqual(p2.credentials,{accessKey:'FICTIONAL_NEW_ACCESS',secretKey:'FICTIONAL_NEW_SECRET',region:credentials.region,bucket:credentials.bucket});assert.equal(p2.storageCredentials,undefined);assert.equal(p2.topology,'local');
  // an empty vault may move to another bucket; a vault with cloud data may not
  await make().updateStorage({credentials:{accessKey:'',secretKey:'',region:'q-world-1'},bucket:'qvault-moved'});assert.equal((await openProfile(await s2.read(),{recoveryKey:first.recoveryKey})).payload.credentials.bucket,'qvault-moved');
  const withData=await openProfile(await s2.read(),{recoveryKey:first.recoveryKey});await s2.save(await sealProfile({...withData.payload,vault:{object:'qvault/x/y.json'}},withData.handle),(await s2.read()).revision);
  const frozen=await s2.read();await assert.rejects(()=>make().updateStorage({credentials:{accessKey:'',secretKey:'',region:'q-world-1'},bucket:'qvault-elsewhere'}),/already has cloud data/);
  await assert.rejects(()=>make().updateStorage({credentials:{accessKey:'ONLY_ONE',secretKey:'',region:'q-world-1'},bucket:''}),/both/);
  failVerify=true;await assert.rejects(()=>make().updateStorage({credentials:{accessKey:'FICTIONAL_BAD_ACCESS',secretKey:'FICTIONAL_BAD_SECRET',region:'q-world-1'},bucket:''}),/could not be reopened/);assert.equal((await s2.read()).revision,frozen.revision);
  // a different passkey cannot change anything
  const stranger=authenticator();const sp=await createPasskey({container:stranger});const before=checks;await assert.rejects(()=>new SetupPasskeyVault({store:s2,lease:async()=>()=>{},ensure:async()=>{checks++},secret:async()=>({prf:sp.prf}),verify:async o=>o.record}).updateStorage({credentials:{accessKey:'X',secretKey:'Y',region:'q-world-1'},bucket:''}),/does not open/);assert.equal(checks,before);assert.equal((await s2.read()).revision,frozen.revision);
 }
 // runtime: no participant workers, no key service; entries survive lock/unlock with either secret
 const cloud=new Map(),peers=[];let head=null;const transport={verify:async()=>{},readHead:async()=>head,publish:async(e,next)=>{head={etag:'f-'+next.revision,state:next};return head},withMpcLease:async fn=>fn(new AbortController().signal)};
 const runtime=new VaultRuntime({store,lease:async()=>()=>{},makeTransport:()=>transport,makePeer:()=>{peers.push(1);throw Error('A local vault must not start participant workers')},load:async o=>{assert.equal(o.localKey,opened.localKey);assert.ok(o.peer instanceof LocalKeyPeer);return structuredClone(cloud.get(o.reference.object))},save:async o=>{assert.equal(o.localKey,opened.localKey);assert.ok(o.peer instanceof LocalKeyPeer);const object='o/'+crypto.randomUUID();cloud.set(object,structuredClone(o.entries));return {object}}});
 assert.equal((await runtime.command({action:'status'})).auth,'passkey');
 await assert.rejects(()=>runtime.command({action:'unlock',password:'typed password'}),/does not open|Invalid/);
 const secret=await passkeySecret({container:a,slots:saved.slots});
 await runtime.command({action:'unlock',prf:Buffer.from(secret.prf).toString('base64')});assert.equal((await runtime.command({action:'status'})).unlocked,true);
 const id=crypto.randomUUID();await runtime.command({action:'put',origin:'https://example.test',id,create:true,entry:{title:'Fixture',username:'fixture',password:'FICTIONAL_LOCAL_PASSWORD'}});
 await runtime.command({action:'lock'});await runtime.command({action:'unlock',recoveryKey:result.recoveryKey});assert.equal((await runtime.command({action:'get',origin:'https://example.test',id})).password,'FICTIONAL_LOCAL_PASSWORD');assert.equal(peers.length,0);
 {// Showing a saved password in the editor needs the passkey again, unless the person turned that off.
  const where={origin:'https://example.test',id},good=Buffer.from(secret.prf).toString('base64'),bad=Buffer.from(new Uint8Array(32).fill(7)).toString('base64');
  assert.equal((await runtime.command({action:'status'})).confirmReveal,true,'on by default');
  const hidden=await runtime.command({action:'get',...where,forEdit:true});assert.equal(hidden.password,'');assert.equal(hidden.passwordHidden,true);assert.equal(hidden.username,'fixture');
  assert.equal((await runtime.command({action:'get',...where})).password,'FICTIONAL_LOCAL_PASSWORD','filling still gets the password');
  await assert.rejects(()=>runtime.command({action:'reveal',...where,prf:bad}),/does not open/);await assert.rejects(()=>runtime.command({action:'reveal',...where}),/does not open|passkey/i);
  assert.deepEqual(await runtime.command({action:'reveal',...where,prf:good}),{title:'Fixture',username:'fixture',password:'FICTIONAL_LOCAL_PASSWORD'});assert.equal((await runtime.command({action:'reveal',...where,recoveryKey:result.recoveryKey})).password,'FICTIONAL_LOCAL_PASSWORD');
  // Editing without seeing it: an empty password field keeps the saved one, a typed one replaces it.
  await runtime.command({action:'put',...where,hiddenPassword:true,base:{...hidden,url:'https://example.test'},entry:{title:'Renamed',username:'fixture',password:''}});let now=await runtime.command({action:'get',...where});assert.equal(now.title,'Renamed');assert.equal(now.password,'FICTIONAL_LOCAL_PASSWORD');
  await runtime.command({action:'put',...where,hiddenPassword:true,base:{...now,password:'',url:'https://example.test'},entry:{title:'Renamed',username:'fixture',password:'FICTIONAL_NEW_ONE'}});assert.equal((await runtime.command({action:'get',...where})).password,'FICTIONAL_NEW_ONE');
  await runtime.command({action:'put',...where,hiddenPassword:true,base:{...now,password:'',url:'https://example.test'},entry:{title:'Renamed',username:'fixture',password:'FICTIONAL_LOCAL_PASSWORD'}});
  // Turning the check off locks the vault, so it cannot be switched off by someone who only found the vault open.
  assert.equal((await runtime.command({action:'set-confirm-reveal',value:false})).unlocked,false);await runtime.command({action:'unlock',prf:good});assert.equal((await runtime.command({action:'status'})).confirmReveal,false);
  assert.equal((await runtime.command({action:'get',...where,forEdit:true})).password,'FICTIONAL_LOCAL_PASSWORD');assert.equal((await runtime.command({action:'set-confirm-reveal',value:true})).unlocked,true,'turning it on needs nothing');assert.equal((await runtime.command({action:'get',...where,forEdit:true})).password,'');
  // Saving from a web form: a generated password is stored first, the username joins it later, a changed password updates the same entry.
  const site='https://signup.test',listed=async()=>runtime.command({action:'list',origin:site});let r=await runtime.command({action:'save-login',origin:site,username:'',password:'FICTIONAL_GENERATED'});assert.equal(r.updated,false);assert.equal((await listed()).length,1);
  r=await runtime.command({action:'save-login',origin:site,username:'new-user',password:'FICTIONAL_GENERATED'});assert.equal(r.updated,true);assert.equal((await listed()).length,1);assert.equal((await listed())[0].username,'new-user');assert.equal((await listed())[0].title,'signup.test');
  r=await runtime.command({action:'save-login',origin:site,username:'new-user',password:'FICTIONAL_CHANGED'});assert.equal(r.updated,true);assert.equal((await runtime.command({action:'get',origin:site,id:(await listed())[0].id})).password,'FICTIONAL_CHANGED');
  assert.equal((await runtime.command({action:'save-login',origin:site,username:'new-user',password:'FICTIONAL_CHANGED'})).unchanged,true);await runtime.command({action:'save-login',origin:site,username:'second-user',password:'FICTIONAL_OTHER'});assert.equal((await listed()).length,2);
  const check=async(username,password)=>(await runtime.command({action:'check-login',origin:site,username,password})).state;assert.equal(await check('new-user','FICTIONAL_CHANGED'),'saved');assert.equal(await check('new-user','something else'),'changed');assert.equal(await check('nobody','nothing'),'new');assert.equal((await listed()).length,2,'checking saves nothing');
  // When a password is replaced, the one before is kept with the entry, so a change the website refused can be undone by hand.
  {const row=(await listed()).find(e=>e.username==='new-user'),at={origin:site,id:row.id},shown=await runtime.command({action:'reveal',...at,prf:good});assert.equal(shown.password,'FICTIONAL_CHANGED');assert.equal(shown.previous.password,'FICTIONAL_GENERATED');assert.ok(!Number.isNaN(Date.parse(shown.previous.at)));
   assert.equal((await runtime.command({action:'get',...at})).previous,undefined,'the previous password is only shown after the passkey check');
   await runtime.command({action:'put',...at,entry:{title:'Renamed site',username:'new-user',password:'FICTIONAL_CHANGED'}});assert.equal((await runtime.command({action:'reveal',...at,prf:good})).previous.password,'FICTIONAL_GENERATED','an edit that keeps the password keeps the previous one');
   await runtime.command({action:'put',...at,entry:{title:'Renamed site',username:'new-user',password:'FICTIONAL_EDITED'}});assert.equal((await runtime.command({action:'reveal',...at,prf:good})).previous.password,'FICTIONAL_CHANGED','changing it in the editor keeps the replaced one too');
   await runtime.command({action:'lock'});await runtime.command({action:'unlock',prf:good});assert.equal((await runtime.command({action:'reveal',...at,prf:good})).previous.password,'FICTIONAL_CHANGED','it survives lock and unlock');await runtime.command({action:'put',...at,entry:{title:'signup.test',username:'new-user',password:'FICTIONAL_CHANGED'}});}
  // A change-password page has no username field: with exactly one saved login for the website that one is updated; with several, a separate entry is kept rather than guessing.
  {const solo='https://solo.test';await runtime.command({action:'save-login',origin:solo,username:'only-user',password:'FICTIONAL_OLD'});const r2=await runtime.command({action:'save-login',origin:solo,username:'',password:'FICTIONAL_NEW'});assert.equal(r2.updated,true);const rows=await runtime.command({action:'list',origin:solo});assert.equal(rows.length,1);assert.equal(rows[0].username,'only-user');assert.equal((await runtime.command({action:'get',origin:solo,id:rows[0].id})).password,'FICTIONAL_NEW');
   assert.equal((await runtime.command({action:'save-login',origin:site,username:'',password:'FICTIONAL_AMBIGUOUS'})).updated,false);assert.equal((await listed()).length,3);}
  await assert.rejects(()=>runtime.command({action:'save-login',origin:site,username:'x',password:''}),/password/i);await assert.rejects(()=>runtime.command({action:'save-login',origin:'http://signup.test',username:'x',password:'y'}),/HTTPS/);}
 await runtime.command({action:'lock'});
 // Reset this device accepts the recovery key for a passkey vault, and nothing else.
 const manage=new SetupProfile({store,lease:async()=>()=>{}}),current=await store.read();
 await assert.rejects(()=>manage.reset({revision:current.revision,recoveryKey:'a typed password',confirmation:'RESET',acknowledged:true}),/does not open/);assert.ok(await store.read());
 // ...or the passkey itself, so a lost recovery key does not trap the profile on this computer
 await assert.rejects(()=>manage.reset({revision:current.revision,secret:{prf:crypto.getRandomValues(new Uint8Array(32))},confirmation:'RESET',acknowledged:true}),/does not open/);assert.ok(await store.read());
 const again=await passkeySecret({container:a,slots:current.slots});await manage.reset({revision:current.revision,secret:{prf:again.prf},confirmation:'RESET',acknowledged:true});assert.equal(await store.read(),null);
}
console.log('PASS LOCAL: passkey profiles open only with the passkey secret or the recovery key; tampering, wrong secrets and malformed envelopes are rejected; the older master-password format is refused; a local-topology vault needs no key service or participant worker, its snapshots need the local vault key, and the local peer refuses unwrapped keys; Setup checks storage, creates the passkey, saves only ciphertext and saves nothing on any failure; the runtime unlocks with either secret. Synthetic authenticator, fake IndexedDB/HTTP, real crypto.');
