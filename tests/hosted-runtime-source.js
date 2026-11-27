import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {VaultRuntime} from '../src/vault-runtime.js';
import {ProfileStore} from '../src/profile-store.js';
import {sealProfile} from '../src/profile-crypto.js';
import {fixtureKey,fixtureSecret,fixtureUnlock,fixtureProfile} from './fixture-profile.js';
import {validateProfilePayload} from '../src/participant-state.js';
// A hosted-topology profile: the service holds one key share, this browser the other.
const keyId='fictional-hosted-key',origin='https://example.test',password='fictional hosted passkey label';
const credentials={accessKey:'FICTIONAL_HOSTED_ACCESS',secretKey:'FICTIONAL_HOSTED_SECRET',region:'q-world-1',bucket:'fictional-bucket'};
const state=id=>({version:1,keyId,sidecarId:id,entries:[['identity',Buffer.from(JSON.stringify({sidecarId:id,...Object.fromEntries(['identityPrivateX448','identityPublicX448','signedPreKeyPrivateX448','signedPreKeyPublicX448','signingPrivateEd448','signingPublicEd448','preKeySignature'].map(k=>[k,'ab'.repeat(57)]))})).toString('base64')],['keyshare/'+keyId,Buffer.from(JSON.stringify({n:Buffer.alloc(256,0xc3).toString('base64'),e:'AQAB',dShare:'AQ=='})).toString('base64')]]});
const localKey=Buffer.alloc(32,7).toString('base64'),id='a'.repeat(32);
const payload={version:1,topology:'hosted',keyId,credentials,participants:[state(id)],localKey,vault:null};
// Validation: hosted means exactly one local participant; the classic layout still means exactly two.
assert.ok(validateProfilePayload(structuredClone(payload)));
assert.throws(()=>validateProfilePayload({...payload,participants:[state(id),state('b'.repeat(32))]}),/Invalid protected profile/);
assert.throws(()=>validateProfilePayload({...payload,topology:undefined}),/Invalid protected profile/);
assert.throws(()=>validateProfilePayload({...payload,topology:'other'}),/Invalid protected profile/);
const store=new ProfileStore(new IDBFactory());await store.save(await sealProfile(payload,await fixtureKey(password)),null);
const objects=new Map(),peers=[],saves=[],loads=[];let now=1;
const transport={verify:async()=>{},readHead:async()=>head,publish:async(expected,next)=>{head={etag:'fixture-'+next.revision,state:next};return head},withMpcLease:async fn=>fn(new AbortController().signal)};let head=null;
const runtime=new VaultRuntime({store,makeTransport:()=>transport,now:()=>now,lease:async()=>()=>{},makePeer:()=>{const p={actions:[],stop(){p.closed=true},call:async(action,m)=>{assert.equal(p.closed,undefined);p.actions.push([action,m]);if(action==='observe-start')return {};if(action==='ready')return {ready:true};if(action==='pending-tasks'){assert.deepEqual(m.sidecarIds,[id]);return {ids:['fictional-stale-task']}}if(action==='start'){p.participant=true;return {sidecarId:m.restore.sidecarId}}throw Error('Unexpected action '+action)}};peers.push(p);return p},
 load:async o=>{loads.push(o);return structuredClone(objects.get(o.reference.object))},save:async o=>{saves.push(o);const object='qvault/x/'+crypto.randomUUID()+'.json';objects.set(object,structuredClone(o.entries));return {object}}});
await runtime.command({action:'unlock',...fixtureUnlock(password)});
// One API client plus exactly one long-lived local participant, restored in hosted mode and never exporting its share.
assert.equal(peers.length,2);const participant=peers.find(p=>p.participant),api=peers.find(p=>!p.participant);
const start=participant.actions.find(a=>a[0]==='start')[1];assert.equal(start.hosted,true);assert.equal(start.syncSession,true);assert.deepEqual(start.restore,state(id));assert.deepEqual(start.ignoreTaskIds,['fictional-stale-task']);assert.notEqual(start.exportPrivateShareForTest,true);assert.equal(start.hostedTest,undefined);
// Saving and reading go through the API client while the same participant stays alive (one ratchet session per unlock).
const entryId=crypto.randomUUID();await runtime.command({action:'put',origin,id:entryId,create:true,entry:{title:'Fixture',username:'fixture-user',password:'FICTIONAL_PASSWORD'}});
assert.equal(saves.length,1);assert.equal(saves[0].peer,api);assert.equal(saves[0].localKey,localKey);assert.equal(peers.length,2);assert.equal(participant.closed,undefined);
assert.equal((await runtime.command({action:'get',origin,id:entryId})).password,'FICTIONAL_PASSWORD');
await runtime.command({action:'put',origin,id:entryId,entry:{title:'Fixture',username:'fixture-user',password:'FICTIONAL_CHANGED'}});assert.equal(peers.length,2);assert.equal(participant.actions.filter(a=>a[0]==='start').length,1);
// Lock stops the participant; the next unlock restores it again and reads the saved snapshot.
await runtime.command({action:'lock'});assert.ok(peers.every(p=>p.closed));
await runtime.command({action:'unlock',...fixtureUnlock(password)});assert.equal(peers.length,4);assert.equal(peers.filter(p=>p.participant).length,2);assert.ok(loads.length>=1&&loads.every(o=>o.localKey===localKey));
assert.equal((await runtime.command({action:'get',origin,id:entryId})).password,'FICTIONAL_CHANGED');
await runtime.command({action:'lock'});
console.log('PASS LOCAL: a hosted-topology profile validates with exactly one local participant, unlocks with one long-lived restored participant in hosted mode (stale tasks ignored, no share export), keeps it alive across saves and reads, passes the local vault key to cloud operations, stops it on lock and restores it on the next unlock. Mocked participant, transport and cloud; fake IndexedDB; real profile crypto.');
