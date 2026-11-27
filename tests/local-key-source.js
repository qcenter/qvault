import assert from 'node:assert/strict';
import {saveCloudVault,loadCloudVault} from '../src/cloud-vault.js';
import {SyncSession} from '../src/sync-session.js';
import {SingleDeviceSession} from '../src/single-device-session.js';
import {fixtureKey,fixtureSecret,fixtureUnlock,fixtureProfile} from './fixture-profile.js';
import {validateProfilePayload} from '../src/participant-state.js';
// Local vault key layer: the key service only ever handles a locally wrapped blob.
// Real RSA-OAEP + AES-GCM, mocked QKMS/HTTP, fictional data.
const originalFetch=globalThis.fetch,objects=new Map();
const profileId=crypto.randomUUID(),keyId='fictional-local-layer-key',credentials={accessKey:'FICTIONAL_ACCESS',secretKey:'FICTIONAL_SECRET',region:'q-world-1',bucket:'fictional-bucket'};
const pair=await crypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},false,['encrypt','decrypt']);
const seen=[];
const peer={call:async(action,m)=>{if(action==='encrypt'){seen.push(Buffer.from(m.value,'base64'));return {CiphertextBlob:Buffer.from(await crypto.subtle.encrypt({name:'RSA-OAEP'},pair.publicKey,Buffer.from(m.value,'base64'))).toString('base64')}}if(action==='decrypt')return {Plaintext:Buffer.from(await crypto.subtle.decrypt({name:'RSA-OAEP'},pair.privateKey,Buffer.from(m.value,'base64'))).toString('base64')};throw Error('Unexpected RPC')}};
globalThis.fetch=async input=>{const request=input instanceof Request?input:new Request(input),path=new URL(request.url).pathname;if(request.method==='PUT'){objects.set(path,await request.text());return new Response('')}return objects.has(path)?new Response(objects.get(path)):new Response('',{status:404})};
const key=()=>Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
const localKey=key(),args={credentials,profileId,keyId,peer,signal:new AbortController().signal};
const entries=[{id:crypto.randomUUID(),title:'FICTIONAL_TITLE',url:'https://example.test',username:'FICTIONAL_USERNAME',password:'FICTIONAL_PASSWORD'}];
try{
 // New-format snapshot roundtrip with the local key.
 const reference=await saveCloudVault({...args,localKey,entries}),path='/fictional-bucket/'+reference.object,record=JSON.parse(objects.get(path));
 assert.equal(record.format,'qvault-passwords-v2');assert.deepEqual(await loadCloudVault({...args,localKey,reference}),entries);
 // What the key service sees is not the data key: holding the whole RSA private key is not enough.
 const blob=seen.at(-1);assert.equal(blob.length,60);
 const cipher=Buffer.from(record.ciphertext,'base64'),nonce=Buffer.from(record.nonce,'base64');
 for(const offset of [0,12,28]){const guess=await crypto.subtle.importKey('raw',blob.subarray(offset,offset+32),'AES-GCM',false,['decrypt']);for(const format of ['qvault-passwords-v1','qvault-passwords-v2'])await assert.rejects(()=>crypto.subtle.decrypt({name:'AES-GCM',iv:nonce,additionalData:new TextEncoder().encode(JSON.stringify({format,profileId,keyId,object:reference.object}))},guess,cipher))}
 // Missing or wrong local key never opens it, and nothing falls back to the service-only path.
 await assert.rejects(()=>loadCloudVault({...args,reference}),/local vault key/);
 await assert.rejects(()=>loadCloudVault({...args,localKey:key(),reference}),/local vault key/);
 await assert.rejects(()=>loadCloudVault({...args,localKey:'not-base64!',reference}),/local vault key/);
 await assert.rejects(()=>saveCloudVault({...args,localKey:Buffer.alloc(16).toString('base64'),entries}),/local vault key/);
 // A wrapped key moved to another object name is rejected.
 const moved='qvault/'+profileId+'/'+crypto.randomUUID()+'.json';objects.set('/fictional-bucket/'+moved,objects.get(path));await assert.rejects(()=>loadCloudVault({...args,localKey,reference:{object:moved}}));
 // Downgrade: a profile with a local key refuses an old-format snapshot (which anyone with the public key could forge).
 const legacy=await saveCloudVault({...args,entries});assert.equal(JSON.parse(objects.get('/fictional-bucket/'+legacy.object)).format,'qvault-passwords-v1');
 assert.deepEqual(await loadCloudVault({...args,reference:legacy}),entries);
 await assert.rejects(()=>loadCloudVault({...args,localKey,reference:legacy}),/not protected by the local vault key/);
 // Sessions hand the profile's local key to every cloud read and write.
 const payload={keyId,credentials,localKey},handle={profileId};
 for(const session of [new SyncSession({payload,handle,peer}),new SingleDeviceSession({payload,handle,peer})])assert.equal(session.args().localKey,localKey);
 {// Without conditional writes a second computer still gets changes while unlocked: sync() loads a newer cloud copy and moves the saved pointer.
  const one='qvault/fixture/one.json',two='qvault/fixture/two.json';let latest={object:one};const loaded=[],stored=[],realHandle=await fixtureKey('FICTIONAL-MASTER-PASSWORD');
  const s=new SingleDeviceSession({payload:{...payload,sync:undefined,vault:{object:one}},handle:realHandle,peer,transport:{latestSnapshot:async()=>latest},load:async o=>{loaded.push(o.reference.object);return [{id:o.reference.object}]},store:{save:async(record,revision)=>stored.push(revision)},recordRevision:'fixture-revision',withMpc:(fn,signal)=>fn(peer,signal),check(){}});
  await s.init();assert.deepEqual(loaded,[one]);assert.equal(stored.length,0);await s.sync();assert.deepEqual(loaded,[one],'nothing is downloaded again while the cloud copy is unchanged');
  latest={object:two};const entries=await s.sync();assert.deepEqual(loaded,[one,two]);assert.equal(entries[0].id,two);assert.equal(s.payload.vault.object,two);assert.deepEqual(stored,['fixture-revision']);}
 assert.equal(new SyncSession({payload:{keyId,credentials},handle,peer}).args().localKey,undefined);
 // Profile validation accepts only a 32-byte local key.
 const participant=id=>({version:1,keyId,sidecarId:id,entries:[['identity',Buffer.from(JSON.stringify({sidecarId:id,...Object.fromEntries(['identityPrivateX448','identityPublicX448','signedPreKeyPrivateX448','signedPreKeyPublicX448','signingPrivateEd448','signingPublicEd448','preKeySignature'].map(k=>[k,'ab'.repeat(57)]))})).toString('base64')],['keyshare/'+keyId,Buffer.from(JSON.stringify({n:Buffer.alloc(256,0xc3).toString('base64'),e:'AQAB',dShare:'AQ=='})).toString('base64')]]});
 const base={version:1,credentials,keyId,participants:[participant('a'.repeat(32)),participant('b'.repeat(32))]};
 assert.ok(validateProfilePayload({...base}));assert.ok(validateProfilePayload({...base,localKey}));
 for(const bad of ['',Buffer.alloc(16).toString('base64'),Buffer.alloc(33).toString('base64'),'%%%',42,null])assert.throws(()=>validateProfilePayload({...base,localKey:bad}),/Invalid protected profile/);
 console.log('PASS LOCAL: snapshots of a profile with a local vault key use the v2 format; the key service receives only a locally wrapped 60-byte blob that cannot open the snapshot; a missing, wrong or malformed local key, a moved object and an old-format downgrade are all rejected; old profiles without a local key keep working; sessions pass the key through; profile validation enforces 32 bytes. Real RSA-OAEP/AES-GCM, mocked QKMS/HTTP.');
}finally{globalThis.fetch=originalFetch}
