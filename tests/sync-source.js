import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {ProfileStore} from '../src/profile-store.js';
import {sealProfile,openProfile} from '../src/profile-crypto.js';
import {SyncTransport} from '../src/sync-transport.js';
import {SyncSession} from '../src/sync-session.js';
import {fixtureKey,fixtureSecret,fixtureUnlock,fixtureProfile} from './fixture-profile.js';
import {mergeEntries,sameEntries} from '../src/sync-merge.js';
const savedFetch=globalThis.fetch,objects=new Map();let sequence=0,ignoreConditions=false,lostAck=false,mpcActive=0,maxMpc=0;
globalThis.fetch=async request=>{
 assert.ok(request instanceof Request);assert.equal(new URL(request.url).origin,'https://qstorage.quilibrium.com');assert.ok(request.headers.has('authorization'));
 const path=new URL(request.url).pathname,current=objects.get(path),headers={'Date':new Date().toUTCString()};
 if(request.method==='GET')return current?new Response(current.body,{headers:{...headers,ETag:current.etag}}):new Response('',{status:404,headers});
 assert.equal(request.method,'PUT');const body=await request.text();
 if(!ignoreConditions&&((request.headers.get('if-none-match')==='*'&&current)||(request.headers.has('if-match')&&request.headers.get('if-match')!==current?.etag)))return new Response('',{status:412,headers});
 const etag='"fixture-'+(++sequence)+'"';objects.set(path,{body,etag});if(lostAck&&path.endsWith('/head.json')){lostAck=false;throw Error('Synthetic lost acknowledgement')}
 return new Response('',{headers:{...headers,ETag:etag}});
};
const handle=await fixtureKey('fictional sync passkey label');const credentials={accessKey:'FICTIONAL_SYNC_ACCESS',secretKey:'FICTIONAL_SYNC_SECRET',region:'q-world-1',bucket:'fictional-bucket'},keyId='fictional-sync-key';
const pair=await crypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},false,['encrypt','decrypt']);
const peer={call:async(action,m)=>{assert.equal(m.keyId,keyId);if(action==='encrypt')return {CiphertextBlob:Buffer.from(await crypto.subtle.encrypt({name:'RSA-OAEP'},pair.publicKey,Buffer.from(m.value,'base64'))).toString('base64')};if(action==='decrypt')return {Plaintext:Buffer.from(await crypto.subtle.decrypt({name:'RSA-OAEP'},pair.privateKey,Buffer.from(m.value,'base64'))).toString('base64')};throw Error('Unexpected RPC')}};
const initial={version:1,credentials,keyId,vault:null};const backup=await sealProfile(initial,handle);
const stores=[];let savedLocal=0;
async function device(record=backup,store){
 store??=new ProfileStore(new IDBFactory());if(!await store.read())await store.save(record);const current=await store.read(),opened=await openProfile(current,fixtureSecret('fictional sync passkey label'));const deviceId=await store.getDeviceId();stores.push(store);
 const transport=new SyncTransport({credentials,profileId:handle.profileId,keyId,handle:opened.handle,leaseWaitMs:3000});
 const session=new SyncSession({transport,store,recordRevision:current.revision,handle:opened.handle,payload:opened.payload,deviceId,peer,signal:new AbortController().signal,withMpc:async(fn,signal)=>{mpcActive++;maxMpc=Math.max(maxMpc,mpcActive);try{await new Promise(r=>setTimeout(r,10));return await fn(peer,signal)}finally{mpcActive--}}});
 await session.init();return session;
}
const entry=(title)=>({id:crypto.randomUUID(),title,url:'https://example.test',username:'FICTIONAL_USER_'+title,password:'FICTIONAL_PASS_'+title});
try{
 const a=await device(),b=await device();assert.notEqual(a.deviceId,b.deviceId);const one=entry('one'),two=entry('two');
 await Promise.all([a.commit([one]),b.commit([two])]);await Promise.all([a.sync(),b.sync()]);assert.equal(a.entries.length,2);assert.ok(sameEntries(a.entries,b.entries));
 const edit=(s,patch)=>s.entries.map(e=>e.id===one.id?{...e,...patch}:e);
 await Promise.all([a.commit(edit(a,{username:'left-user'})),b.commit(edit(b,{password:'right-password'}))]);await Promise.all([a.sync(),b.sync()]);assert.deepEqual(a.entries.find(e=>e.id===one.id),{...one,username:'left-user',password:'right-password'});
 await Promise.all([a.commit(edit(a,{password:'left-conflict'})),b.commit(edit(b,{password:'right-conflict'}))]);await Promise.all([a.sync(),b.sync()]);assert.ok(a.entries.some(e=>e.password==='left-conflict'));assert.ok(a.entries.some(e=>e.password==='right-conflict'));assert.equal(a.entries.length,3);assert.ok(sameEntries(a.entries,b.entries));
 const fromOldBackup=await device(backup);assert.ok(sameEntries(fromOldBackup.entries,a.entries));
 await Promise.all([a.commit(a.entries.filter(e=>e.id!==one.id)),b.commit(edit(b,{username:'edited-during-delete'}))]);await Promise.all([a.sync(),b.sync()]);assert.ok(a.entries.some(e=>e.username==='edited-during-delete'));assert.ok(sameEntries(a.entries,b.entries));
 lostAck=true;await a.commit([...a.entries,entry('lost-ack')]);assert.equal(a.payload.sync.pending,undefined);
 // A cloud commit succeeds but its local acknowledgement write fails. The
 // durable outbox is replayed only once, even after another device edits it.
 const originalSave=a.store.save.bind(a.store);let writes=0;
 a.store.save=async(...args)=>{writes++;if(writes===2)throw Error('Synthetic local commit failure');return originalSave(...args)};
 const pendingEntry=entry('outbox');await assert.rejects(()=>a.commit([...a.entries,pendingEntry]),/local commit/);a.store.save=originalSave;assert.ok((await openProfile(await a.store.read(),fixtureSecret('fictional sync passkey label'))).payload.sync.pending);
 await b.sync();await b.commit(b.entries.map(e=>e.id===pendingEntry.id?{...e,password:'later-password'}:e));const recovered=await device(await a.store.read(),a.store);assert.equal(recovered.entries.find(e=>e.id===pendingEntry.id).password,'later-password');assert.equal(recovered.entries.filter(e=>e.title.startsWith('outbox')).length,1);assert.equal(recovered.payload.sync.pending,undefined);
 const tag=(await recovered.transport.readHead()).etag;const headPath='/fictional-bucket/qvault/'+handle.profileId+'/sync/v1/head.json';const raw=objects.get(headPath),damaged=JSON.parse(raw.body);damaged.ciphertext='AAAA'+damaged.ciphertext.slice(4);objects.set(headPath,{...raw,body:JSON.stringify(damaged)});await assert.rejects(()=>recovered.transport.readHead(),/authentication/);objects.set(headPath,raw);
 assert.equal(maxMpc,1);for(const obj of objects.values())assert.ok(!obj.body.includes('FICTIONAL_PASS_'));
 ignoreConditions=true;const unsafe=new SyncTransport({credentials,profileId:crypto.randomUUID(),keyId,handle});await assert.rejects(()=>unsafe.verify(),/conditional create/);ignoreConditions=false;
 const merge=await mergeEntries([one],[{...one,password:'L'}],[{...one,password:'R'}]);const again=await mergeEntries([one],[{...one,password:'L'}],[{...one,password:'R'}]);assert.ok(sameEntries(merge.entries,again.entries));
 console.log('PASS LOCAL: two-device automatic latest-head discovery, atomic concurrent saves, disjoint-field merge, preserved conflicting edits/delete-vs-edit, old-backup latest restore, lost ACK recovery, durable outbox exactly-once replay after local failure, authenticated head tamper rejection, MPC lease mutual exclusion and conditional-write-unsupported fail-closed. Real crypto/signed HTTP and fake IndexedDB/S3/QKMS only.');
}finally{globalThis.fetch=savedFetch}
