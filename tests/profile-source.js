import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {sealProfile,openProfile,validateEnvelope} from '../src/profile-crypto.js';
import {fixtureKey,fixtureSecret,fixtureUnlock,fixtureProfile} from './fixture-profile.js';
import {ProfileStore,acquireProfileLease} from '../src/profile-store.js';
const password='fictional passkey label for local tests only';
const payload={version:1,credentials:{accessKey:'FICTIONAL_ACCESS',secretKey:'FICTIONAL_SECRET'},participants:[{fixtureSecret:'FICTIONAL_SHARE'}]};
const handle=await fixtureKey(password);assert.equal(handle.key.extractable,false);
const first=await sealProfile(payload,handle),second=await sealProfile(payload,handle);
assert.notEqual(first.nonce,second.nonce);assert.notEqual(first.ciphertext,second.ciphertext);
for(const secret of ['FICTIONAL_ACCESS','FICTIONAL_SECRET','FICTIONAL_SHARE',password])assert.ok(!JSON.stringify(first).includes(secret));
assert.deepEqual((await openProfile(first,fixtureSecret(password))).payload,payload);
await assert.rejects(()=>openProfile(first,fixtureSecret('wrong fictional master')),/does not open/);await assert.rejects(()=>openProfile(first,'a typed password'),/does not open/);
for(const alter of [r=>r.revision=crypto.randomUUID(),r=>r.profileId=crypto.randomUUID(),r=>r.nonce='AAAAAAAAAAAAAAAA',r=>r.ciphertext='AAAA'+r.ciphertext.slice(4),r=>r.slots[0].salt='AAAAAAAAAAAAAAAAAAAAAA==']){
 const changed=structuredClone(first);alter(changed);await assert.rejects(()=>openProfile(changed,fixtureSecret(password)));
}
assert.throws(()=>validateEnvelope({...first,format:'qvault-profile-v1'}),/Unsupported/);assert.throws(()=>validateEnvelope({...first,slots:first.slots.filter(s=>s.type!=='recovery')}),/Invalid/);
const store=new ProfileStore(indexedDB);assert.equal(await store.read(),null);await store.save(first);assert.deepEqual(await new ProfileStore(indexedDB).read(),first);
await assert.rejects(()=>store.save(second,null),/another tab/);assert.deepEqual(await store.read(),first);
await store.save(second,first.revision);assert.deepEqual(await store.read(),second);
const stale=await sealProfile(payload,handle);await assert.rejects(()=>store.save(stale,first.revision),/another tab/);
const a=await sealProfile(payload,handle),b=await sealProfile(payload,handle);const writes=await Promise.allSettled([store.save(a,second.revision),new ProfileStore(indexedDB).save(b,second.revision)]);assert.equal(writes.filter(r=>r.status==='fulfilled').length,1);
let held=false;
const locks={request:async(_name,_opts,callback)=>{if(held)return callback(null);held=true;try{return await callback({name:'fixture'})}finally{held=false}}};
const release=await acquireProfileLease(locks);await assert.rejects(()=>acquireProfileLease(locks),/another tab/);release();await new Promise(r=>setTimeout(r,0));const again=await acquireProfileLease(locks);again();
await assert.rejects(()=>acquireProfileLease({}),/does not support/);
console.log('PASS LOCAL: actual WebCrypto profile encryption, non-extractable key, fresh nonces, wrong-secret/tamper rejection, durable reopen with fake IndexedDB, CAS/concurrent-save conflict safety, exclusive-session lease. Synthetic secrets only; not a real browser UI test.');
