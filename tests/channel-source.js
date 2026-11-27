import init from '../vendor/channel/channelwasm.js';
import {generateIdentity} from '../upstream/sdk-core/sidecar/identity.ts';
import {PeerChannel} from '../upstream/sdk-core/sidecar/peer-channel.ts';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
await init({module_or_path:await readFile(new URL('../vendor/channel/channelwasm_bg.wasm',import.meta.url))});
const a=await generateIdentity(),b=await generateIdentity();assert.notEqual(a.sidecarId,b.sidecarId);
const bytes=hex=>Uint8Array.from(Buffer.from(hex,'hex'));
const ca=new PeerChannel(a),cb=new PeerChannel(b);
ca.establishSession(b.sidecarId,true,bytes(b.identityPublicX448),bytes(b.signedPreKeyPublicX448));
cb.establishSession(a.sidecarId,false,bytes(a.identityPublicX448),bytes(a.signedPreKeyPublicX448));
const plain=new TextEncoder().encode('fictional browser-only channel test');
const ciphertext=ca.encrypt(b.sidecarId,plain);assert.deepEqual(cb.decrypt(a.sidecarId,ciphertext),plain);
const reply=cb.encrypt(a.sidecarId,plain);assert.deepEqual(ca.decrypt(b.sidecarId,reply),plain);
console.log('PASS LOCAL: actual channel WASM identity, X3DH and bidirectional double-ratchet roundtrip. No network or real credentials.');

// Two sequential tasks between the same participants must use fresh ratchets.
const identities=[a,b].sort((x,y)=>x.sidecarId.localeCompare(y.sidecarId));
const sender=new PeerChannel(identities[0]),receiver=new PeerChannel(identities[1]);
const peer=i=>({identityKey:bytes(i.identityPublicX448),signedPreKey:bytes(i.signedPreKeyPublicX448)});
for(const task of ['synthetic-create','synthetic-decrypt']){
 const messages=[];const client={call:async(method,m)=>{assert.equal(method,'SendPartyMessage');messages.push({fromParty:m.FromParty,round:m.Round,encrypted:m.Encrypted,envelope:m.Envelope});}};
 assert.equal(await sender.performHandshakeWithMessages(client,task,identities[0].sidecarId,1,identities[1].sidecarId,2,peer(identities[1]),[],[]),false);
 assert.equal(await receiver.performHandshakeWithMessages(client,task,identities[1].sidecarId,2,identities[0].sidecarId,1,peer(identities[0]),messages.filter(m=>m.round===0),[]),true);
 assert.equal(await sender.performHandshakeWithMessages(client,task,identities[0].sidecarId,1,identities[1].sidecarId,2,peer(identities[1]),[],messages.filter(m=>m.round===1)),true);
 assert.deepEqual(receiver.decrypt(identities[0].sidecarId,sender.encrypt(identities[1].sidecarId,plain,task),task),plain);
}
console.log('PASS LOCAL: consecutive CreateKey/Decrypt task handshakes with real channel WASM and mocked relay.');

// Revisit the first task after the second task's handshake: no ratchet collision.
for(const task of ['synthetic-create','synthetic-decrypt','synthetic-create']){
 assert.deepEqual(receiver.decrypt(identities[0].sidecarId,sender.encrypt(identities[1].sidecarId,plain,task),task),plain);
 assert.deepEqual(sender.decrypt(identities[1].sidecarId,receiver.encrypt(identities[0].sidecarId,plain,task),task),plain);
}
console.log('PASS LOCAL: interleaved task-scoped ratchets remain independent.');

// Model native peer-scoped readiness: after CreateKey it does not ACK a new
// per-task hello. Reproduce the old client deadlock, then verify continuous
// ratchet state on CreateKey -> Decrypt with actual channel WASM.
async function hostedPair(reuse){
 const clientChannel=new PeerChannel(a,{reuseAcrossTasks:reuse});
 const serverId='server-sidecar-001',service=new PeerChannel(b,{reuseAcrossTasks:true});
 const relay=[];const rpc={call:async(method,m)=>{assert.equal(method,'SendPartyMessage');relay.push({fromParty:m.FromParty,round:m.Round,encrypted:m.Encrypted,envelope:m.Envelope,task:m.TaskId});}};
 async function handshake(task){
  const first=await clientChannel.performHandshakeWithMessages(rpc,task,a.sidecarId,2,serverId,1,peer(b),[],[]);
  if(first)return true;
  await service.performHandshakeWithMessages(rpc,task,serverId,1,a.sidecarId,2,peer(a),relay.filter(m=>m.task===task&&m.round===0),[]);
  return clientChannel.performHandshakeWithMessages(rpc,task,a.sidecarId,2,serverId,1,peer(b),[],relay.filter(m=>m.task===task&&m.round===1));
 }
 assert.equal(await handshake('fixture-hosted-create'),true);
 const count=relay.length;const ready=await handshake('fixture-hosted-decrypt');
 if(!reuse){assert.equal(ready,false);assert.equal(relay.length,count+1);return}
 assert.equal(ready,true);assert.equal(relay.length,count,'No second hello/ACK when native peer session is already ready');
 for(const task of ['fixture-hosted-create','fixture-hosted-decrypt','fixture-hosted-decrypt-2']){
  assert.deepEqual(service.decrypt(a.sidecarId,clientChannel.encrypt(serverId,plain,task),task),plain);
  assert.deepEqual(clientChannel.decrypt(serverId,service.encrypt(a.sidecarId,plain,task),task),plain);
 }
}
await hostedPair(false);await hostedPair(true);
console.log('PASS LOCAL: old task-scoped browser reproduces waiting-for-ACK against a native-style persistent peer; explicit hosted compatibility reuses readiness and real ratchet through CreateKey and two Decrypt tasks. Mocked relay/native model, no hosted service tested.');
