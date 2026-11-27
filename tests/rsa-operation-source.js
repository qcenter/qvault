import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PollLoop} from '../upstream/sdk-core/sidecar/poll.ts';
import {TaskDispatcher} from '../upstream/sdk-core/sidecar/dispatch.ts';
import {RSASession,unwrapRsaOperationContribution} from '../upstream/sdk-core/sidecar/sessions/rsa.ts';
import {loadMpcWasm} from '../vendor/mpc/loader.js';
const api=await loadMpcWasm({wasmBytes:await readFile(new URL('../vendor/mpc/mpc.wasm',import.meta.url))});
const pair=await crypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['encrypt','decrypt']);
const jwk=await crypto.subtle.exportKey('jwk',pair.privateKey);
const decode=s=>Buffer.from(s,'base64url');const n=decode(jwk.n).toString('base64'),e=decode(jwk.e).toString('base64');
const d=BigInt('0x'+decode(jwk.d).toString('hex'));
const b64int=i=>{let h=i.toString(16);if(h.length%2)h='0'+h;return Buffer.from(h,'hex').toString('base64')};
// Synthetic degree-one test polynomial over integers, with f(0)=d. No production key.
const coefficient=BigInt('0x'+crypto.getRandomValues(new Uint8Array(32)).reduce((s,b)=>s+b.toString(16).padStart(2,'0'),''));
const data=crypto.getRandomValues(new Uint8Array(32));
const cipher=Buffer.from(await crypto.subtle.encrypt({name:'RSA-OAEP'},pair.publicKey,data)).toString('base64');
let collectEnabled=false;
const queues={a:[],b:[]},submitted={a:[],b:[]},broadcasts=[];
const current={a:2,b:1},original={a:1,b:2};
const make=(sid)=>{
 const session=new RSASession();session.apiPromise=Promise.resolve(api);
 session.loadKeyShare=async()=>JSON.stringify({n,e,dShare:b64int(d+coefficient*BigInt(original[sid]))});
 const ctx={sidecarId:sid,client:{updateTask:async m=>submitted[sid].push(m)},peerChannel:{
  sendMessage:async(_client,taskId,fromSidecar,from,peer,to,round,bytes)=>{assert.equal(from,current[sid]);assert.equal(to,current[peer]);assert.equal(round,0);assert.equal(taskId,'fictional-decrypt');broadcasts.push(sid);queues[peer].push([from,bytes]);},
  collectMessages:async()=>{if(!collectEnabled)return new Map();const result=new Map(queues[sid]);queues[sid]=[];return result;}
 }};
 const dispatcher=new TaskDispatcher();dispatcher.register(session);return {session,ctx,dispatcher};
};
const a=make('a'),b=make('b');
assert.equal(a.session.canHandle({Operation:'Decrypt',ServerData:JSON.stringify({protocol:'rsa-n-decrypt'})}),true);
assert.equal(a.session.canHandle({Operation:'Sign',ServerData:{protocol:'rsa-n-sign'}}),true);
assert.equal(a.session.canHandle({Operation:'Decrypt',ServerData:{protocol:'unrelated'}}),false);
const task={TaskId:'fictional-decrypt',KeyId:'fictional-key',Operation:'Decrypt',Round:0,PartyIdMap:current,ServerData:{protocol:'rsa-n-decrypt',partyIDMap:current,dkgPartyIDMap:original,ciphertext:cipher,encryptionAlgorithm:'RSAES_OAEP_SHA_256'}};
await a.dispatcher.dispatch(task,a.ctx);const first=submitted.a[0].ClientData;
assert.deepEqual(Object.keys(first).sort(),['data','round','sidecarId']);assert.equal(first.round,0);assert.equal(first.data.partyId,1);assert.equal(first.data.protocol,'rsa-n-decrypt');assert.ok(first.data.partialResult);assert.equal(first.partialResult,undefined);
await b.dispatcher.dispatch(task,b.ctx);
// Both first attempts saw no peer message. Late messages arrive without a round change.
assert.equal(submitted.a[0].ClientData.data.complete,undefined);
assert.equal(submitted.b[0].ClientData.data.complete,undefined);
collectEnabled=true;
await a.dispatcher.dispatch(task,a.ctx);
await b.dispatcher.dispatch(task,b.ctx);
for(const sid of ['a','b']){
 const last=submitted[sid].at(-1).ClientData.data;
 assert.equal(last.complete,true);assert.deepEqual(Buffer.from(last.plaintext,'base64'),Buffer.from(data));
 assert.ok(!JSON.stringify(submitted[sid]).includes('dShare'));
}
await a.dispatcher.dispatch(task,a.ctx);assert.equal(broadcasts.length,2);
assert.deepEqual(unwrapRsaOperationContribution({data:first.data}),first.data);
assert.deepEqual(unwrapRsaOperationContribution({data:Buffer.from(JSON.stringify(first.data)).toString('base64')}),first.data);
const bad=new RSASession();bad.apiPromise=Promise.resolve(api);bad.loadKeyShare=a.session.loadKeyShare;
await assert.rejects(()=>bad.process({...task,PartyIdMap:{},ServerData:{ciphertext:cipher}},a.ctx),/valid party configuration/);
const ordinary=new TaskDispatcher();let ordinaryCalls=0;ordinary.register({canHandle:()=>true,process:async()=>{ordinaryCalls++}});
assert.equal(await ordinary.dispatch({...task,Operation:'CreateKey'},a.ctx),true);assert.equal(await ordinary.dispatch({...task,Operation:'CreateKey'},a.ctx),false);assert.equal(ordinaryCalls,1);
// Full poll -> normalize -> dispatcher -> RSA path, native-style metadata only.
collectEnabled=false;queues.a=[];queues.b=[];submitted.a=[];submitted.b=[];
const c=make('a'),f=make('b');
const errors=[],progress=[];
async function poll(peer,sid){
 const wire={...task,Status:'AWAITING_CLIENT',PartyIdMap:undefined,ServerData:JSON.stringify(task.ServerData)};
 peer.ctx.client.listTasksForSidecar=async()=>({Tasks:[wire]});
 peer.ctx.client.call=async(method)=>method==='GetSidecar'?{IdentityKey:Buffer.alloc(57,1).toString('base64'),SignedPreKey:Buffer.alloc(57,2).toString('base64')}:{Messages:[]};
 peer.ctx.peerChannel.performHandshakeWithMessages=async()=>true;
 const loop=new PollLoop({client:peer.ctx.client,dispatcher:peer.dispatcher,identity:{sidecarId:sid},peerChannel:peer.ctx.peerChannel,pollIntervalMs:500,useTofN:true,onError:e=>errors.push(e),onProgress:s=>progress.push(s)});
 loop.running=true;try{await loop.tick()}finally{loop.stop()}
}
await poll(c,'a');await poll(f,'b');collectEnabled=true;await poll(c,'a');await poll(f,'b');
assert.equal(errors.length,0);assert.equal(progress.filter(s=>s==='protocol-contribution-submitted').length,4);
for(const sid of ['a','b']){const final=submitted[sid].at(-1).ClientData.data;assert.equal(final.complete,true);assert.deepEqual(Buffer.from(final.plaintext,'base64'),Buffer.from(data));}
console.log('PASS LOCAL: two synthetic RSA shares recover random 32-byte OAEP key through actual Go WASM; native round/data envelope, peer broadcast, original vs current party mapping, cached completion, same-round late peer delivery through real TaskDispatcher, and fail-closed missing mapping. Full PollLoop/normalizer/dispatcher/session exercised with native-style nested-only protocol metadata and delayed peer delivery. Mocked task server and relay; no live QKMS.');
process.exit(0);
