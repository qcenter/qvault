import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {saveCloudVault,loadCloudVault} from '../src/cloud-vault.js';
import {ProfileStore} from '../src/profile-store.js';
import {VaultRuntime} from '../src/vault-runtime.js';
import {SyncUnavailable} from '../src/sync-transport.js';
import {createPasskeyProfile,sealProfile} from '../src/profile-crypto.js';
import {SetupProfile} from '../src/setup-profile.js';
// Local copy of the latest encrypted snapshot: saves the download, never the key-service step.
const originalFetch=globalThis.fetch,objects=new Map(),requests=[];
const profileId=crypto.randomUUID(),keyId='fictional-cache-key',credentials={accessKey:'FICTIONAL_ACCESS',secretKey:'FICTIONAL_SECRET',region:'q-world-1',bucket:'fictional-bucket'};
const pair=await crypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},false,['encrypt','decrypt']);let decrypts=0;
const peer={call:async(action,m)=>{if(action==='encrypt')return {CiphertextBlob:Buffer.from(await crypto.subtle.encrypt({name:'RSA-OAEP'},pair.publicKey,Buffer.from(m.value,'base64'))).toString('base64')};decrypts++;return {Plaintext:Buffer.from(await crypto.subtle.decrypt({name:'RSA-OAEP'},pair.privateKey,Buffer.from(m.value,'base64'))).toString('base64')}}};
globalThis.fetch=async input=>{const request=input instanceof Request?input:new Request(input),path=new URL(request.url).pathname;requests.push(request.method);if(request.method==='PUT'){objects.set(path,await request.text());return new Response('')}return objects.has(path)?new Response(objects.get(path)):new Response('',{status:404})};
const localKey=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),args={credentials,profileId,keyId,peer,localKey,signal:new AbortController().signal};
const entries=[{id:crypto.randomUUID(),title:'T',url:'https://example.test',username:'u',password:'FICTIONAL_CACHED_PASSWORD'}];
try{
 const store=new ProfileStore(new IDBFactory()),cache={get:o=>store.readSnapshotCache(o),put:(o,t)=>store.writeSnapshotCache(o,t)};
 // saving stores the encrypted body locally; reading it back needs no download but still needs the key service
 const reference=await saveCloudVault({...args,entries,cache});const saved=await store.readSnapshotCache(reference.object);assert.equal(saved,objects.get('/fictional-bucket/'+reference.object));assert.ok(!saved.includes('FICTIONAL_CACHED_PASSWORD'));
 let gets=requests.filter(m=>m==='GET').length;decrypts=0;assert.deepEqual(await loadCloudVault({...args,reference,cache}),entries);assert.equal(requests.filter(m=>m==='GET').length,gets);assert.equal(decrypts,1);
 // without the local key or with another one the copy is as useless as the cloud object
 await assert.rejects(()=>loadCloudVault({...args,localKey:Buffer.alloc(32,9).toString('base64'),reference,cache}),/local vault key/);
 // a different snapshot is downloaded once, then cached (only the newest is kept)
 const second=await saveCloudVault({...args,entries:[]});assert.equal(await store.readSnapshotCache(second.object),null);gets=requests.filter(m=>m==='GET').length;
 assert.deepEqual(await loadCloudVault({...args,reference:second,cache}),[]);assert.equal(requests.filter(m=>m==='GET').length,gets+1);assert.deepEqual(await loadCloudVault({...args,reference:second,cache}),[]);assert.equal(requests.filter(m=>m==='GET').length,gets+1);assert.equal(await store.readSnapshotCache(reference.object),null);
 // a damaged copy is discarded and the cloud object is used instead
 await store.writeSnapshotCache(second.object,'{"damaged":true}');gets=requests.filter(m=>m==='GET').length;assert.deepEqual(await loadCloudVault({...args,reference:second,cache}),[]);assert.equal(requests.filter(m=>m==='GET').length,gets+1);assert.equal(await store.readSnapshotCache(second.object),objects.get('/fictional-bucket/'+second.object));
 const tampered=JSON.parse(await store.readSnapshotCache(second.object));tampered.ciphertext='AAAA'+tampered.ciphertext.slice(4);await store.writeSnapshotCache(second.object,JSON.stringify(tampered));assert.deepEqual(await loadCloudVault({...args,reference:second,cache}),[]);
 // a local copy in the old format, or one that needs another key, is not trusted and not fatal: the cloud object decides
 const legacyRef=await saveCloudVault({credentials,profileId,keyId,peer,signal:args.signal,entries});await store.writeSnapshotCache(second.object,objects.get('/fictional-bucket/'+legacyRef.object));assert.deepEqual(await loadCloudVault({...args,reference:second,cache}),[]);assert.equal(await store.readSnapshotCache(second.object),objects.get('/fictional-bucket/'+second.object));
 // a broken cache never breaks reading or saving
 const broken={get:async()=>{throw Error('cache down')},put:async()=>{throw Error('cache down')}};assert.deepEqual(await loadCloudVault({...args,reference:second,cache:broken}),[]);assert.ok((await saveCloudVault({...args,entries,cache:broken})).object);
 await assert.rejects(()=>store.writeSnapshotCache('other/x.json','{}'),/Invalid/);await assert.rejects(()=>store.writeSnapshotCache(second.object,'x'.repeat(3*1024*1024)),/too large/i);
 // capability record: what the storage check found, reused for a limited time; both are cleared by Reset this device
 await store.writeCapability({profileId,bucket:'b',region:'r',mode:'shared',checkedAt:5});assert.deepEqual(await store.readCapability(),{profileId,bucket:'b',region:'r',mode:'shared',checkedAt:5});await assert.rejects(()=>store.writeCapability({profileId,bucket:'b',region:'r',mode:'weird',checkedAt:5}),/Invalid/);
 const {handle,recoveryKey}=await createPasskeyProfile({prf:crypto.getRandomValues(new Uint8Array(32)),credentialId:Buffer.from('id').toString('base64'),prfSalt:Buffer.alloc(32,1).toString('base64')});
 const payload={version:1,topology:'local',keyId:'local',credentials,participants:[],localKey,vault:null};await store.save(await sealProfile(payload,handle),null);
 // runtime: the storage check runs on the first unlock and is reused until it expires; a cached single-computer result skips it for a day
 let now=1000,verifies=0,unavailable=false,head=null;const cloud=new Map();
 const transport=()=>({verify:async function(){if(this.verified)return;verifies++;if(unavailable)throw new SyncUnavailable('no conditional writes');this.verified=true},readHead:async()=>head,publish:async(e,next)=>{head={etag:'f-'+next.revision,state:next};return head},withMpcLease:async fn=>fn(new AbortController().signal),latestSnapshot:async()=>null});
 const runtime=new VaultRuntime({store,lease:async()=>()=>{},now:()=>now,makeTransport:transport,load:async o=>structuredClone(cloud.get(o.reference.object)),save:async o=>{assert.equal(typeof o.cache?.get,'function');const object='qvault/'+profileId+'/'+crypto.randomUUID()+'.json';cloud.set(object,structuredClone(o.entries));return {object}}});
 const cycle=async()=>{await runtime.command({action:'unlock',recoveryKey});await runtime.command({action:'lock'})};
 await cycle();assert.equal(verifies,1);assert.equal((await store.readCapability()).mode,'shared');
 now+=30*60000;await cycle();assert.equal(verifies,1,'reused within the hour');
 now+=31*60000;await cycle();assert.equal(verifies,2,'checked again after an hour');
 // a device whose storage has no conditional writes: single-computer result reused for a day
 {
  const other=await createPasskeyProfile({prf:crypto.getRandomValues(new Uint8Array(32)),credentialId:Buffer.from('id2').toString('base64'),prfSalt:Buffer.alloc(32,2).toString('base64')}),store2=new ProfileStore(new IDBFactory());await store2.save(await sealProfile(payload,other.handle),null);
  let probes=0;const single=new VaultRuntime({store:store2,lease:async()=>()=>{},now:()=>now,makeTransport:()=>({verify:async()=>{probes++;throw new SyncUnavailable('no conditional writes')},latestSnapshot:async reference=>reference||null}),load:async()=>[],save:async()=>({object:'x'})});
  const again=async()=>{await single.command({action:'unlock',recoveryKey:other.recoveryKey});assert.equal((await single.command({action:'status'})).mode,'single-device');await single.command({action:'lock'})};
  await again();assert.equal(probes,1);assert.equal((await store2.readCapability()).mode,'single');now+=23*3600000;await again();assert.equal(probes,1,'single-computer result reused for a day');now+=2*3600000;await again();assert.equal(probes,2);
 }
 // a record for another bucket or profile is ignored
 const beforeOther=verifies;await store.writeCapability({profileId,bucket:'another-bucket',region:credentials.region,mode:'shared',checkedAt:now});await cycle();assert.equal(verifies,beforeOther+1);
 const manage=new SetupProfile({store,lease:async()=>()=>{}}),record=await store.read();await store.writeSnapshotCache('qvault/'+profileId+'/'+crypto.randomUUID()+'.json','{}');
 await manage.reset({revision:record.revision,recoveryKey,confirmation:'RESET',acknowledged:true});assert.equal(await store.readCapability(),null);assert.equal(await store.readSnapshotCache(reference.object),null);assert.equal(await store.readSnapshotCache(second.object),null);
 console.log('PASS LOCAL: the newest encrypted snapshot is kept on the device and reused without a download, while every open still goes through the key service and the local vault key; a wrong key, a damaged or tampered copy and a failing cache are all handled; the storage capability check is reused for at most an hour (shared) or a day (single computer) and only for the same profile and bucket; Reset this device clears both. Real RSA-OAEP/AES-GCM, fake IndexedDB/HTTP.');
}finally{globalThis.fetch=originalFetch}
