import assert from 'node:assert/strict';
import {createHostedKey} from '../src/setup-vault.js';
// Fictional credentials and synthetic participants only. No network, no real QKMS.
const keyId='fictional-new-vault-key';
const credentials={accessKey:'FICTIONAL_VAULT_ACCESS',secretKey:'FICTIONAL_VAULT_SECRET',region:'q-world-1',bucket:'qvault-fictional'};
const participant=id=>({version:1,keyId,sidecarId:id,entries:[['identity',Buffer.from(JSON.stringify({sidecarId:id,...Object.fromEntries(['identityPrivateX448','identityPublicX448','signedPreKeyPrivateX448','signedPreKeyPublicX448','signingPrivateEd448','signingPublicEd448','preKeySignature'].map(k=>[k,'ab'.repeat(57)]))})).toString('base64')],['keyshare/'+keyId,Buffer.from(JSON.stringify({n:Buffer.alloc(256,0xc3).toString('base64'),e:'AQAB',dShare:'AQ=='})).toString('base64')]]});
function fixture(options={}){
 // Creation order: [0] local participant, [1] observer/API client, [2] the restarted local participant.
 const made=[],order=[];let restarted=false;
 const makePeer=onEvent=>{const index=made.length,id=index===1?'f'.repeat(32):'a'.repeat(32);order.push('make'+index);const peer={id,emit:onEvent,calls:[],stopped:false,stop(){if(!this.stopped)order.push('stop'+index);this.stopped=true},async call(action,args={}){
  if(this.stopped)throw Error('Vault locked');this.calls.push([action,args]);
  if(action==='start'){if(args.restore){restarted=true;if(options.restartChangesIdentity)return {sidecarId:'c'.repeat(32)}}return {sidecarId:id}}
  if(action==='prepare'){onEvent?.({event:'crypto-progress',stage:'synthetic prime search <b>'+'x'.repeat(300)});return {ready:true,keySize:2048}}
  if(action==='prepared')return {ready:true,keySize:2048};
  if(action==='create'){if(options.createFails)throw Error('QKMS HTTP 400 (CreateKey)');onEvent?.({event:'participant-progress',stage:'round-message',task:{round:1,totalRounds:4}});onEvent?.({event:'participant-progress',stage:'round-message',task:{round:1,totalRounds:4}});onEvent?.({event:'participant-error',error:'QKMS HTTP 503 (ListTasksForSidecar)',task:{status:'IN_PROGRESS',round:1,totalRounds:4}});return {keyId,pending:true}}
  if(action==='observe-start')return {observer:true};
  if(action==='pending-tasks')return {ids:['fictional-stale-task']};
  if(action==='ready'){this.probes=(this.probes||0)+1;return options.neverReady||(options.slowReady&&this.probes<3)?{ready:false,task:{status:'IN_PROGRESS',operation:'CreateKey',round:Math.min(this.probes,4),totalRounds:4}}:{ready:true}}
  if(action==='encrypt')return {CiphertextBlob:'wrapped:'+args.value};
  if(action==='decrypt'){if(restarted&&options.reopenFails)throw Error('Service request timed out');return {Plaintext:options.badDecrypt?Buffer.alloc(32,1).toString('base64'):args.value.slice(8)}}
  if(action==='export-state')return participant(id);
  throw Error('Unexpected participant action '+action)}};made.push(peer);return peer};
 return {made,makePeer,order};
}
const actions=peer=>peer.calls.map(c=>c[0]);
const run=(makePeer,extra={})=>createHostedKey({credentials,makePeer,pollMs:1,...extra});

// 1. Happy path: a hosted key (service + this browser), verified and restart-checked. What comes back is the key id and this browser's participant state.
{
 const {made,makePeer,order}=fixture(),phases=[];
 const result=await run(makePeer,{onProgress:p=>phases.push(p)});
 assert.equal(result.keyId,keyId);assert.deepEqual(result.participant,participant('a'.repeat(32)));
 assert.equal(made.length,3);assert.ok(made.every(p=>p.stopped));
 // Only one share-holding participant runs locally; the other party is the hosted service. Private shares are never exported to it.
 const first=made[0].calls.find(c=>c[0]==='start')[1];assert.equal(first.hosted,true);assert.equal(first.exportPrivateShareForTest,false);assert.equal(first.hostedTest,undefined);assert.equal(first.restore,undefined);assert.deepEqual(first.credentials,credentials);
 const creates=made.flatMap(p=>p.calls.filter(c=>c[0]==='create'));assert.equal(creates.length,1);assert.deepEqual(creates[0][1].participants,['service','a'.repeat(32)]);
 assert.ok(!made[1].calls.some(c=>c[0]==='start'||c[0]==='export-state'));
 // Restart check: the first worker is stopped before a new one restores the exported state and a second decrypt succeeds.
 assert.ok(order.indexOf('stop0')<order.indexOf('make2'));
 const again=made[2].calls.find(c=>c[0]==='start')[1];assert.equal(again.hosted,true);assert.equal(again.syncSession,true);assert.equal(again.exportPrivateShareForTest,false);assert.deepEqual(again.restore,participant('a'.repeat(32)));assert.deepEqual(again.ignoreTaskIds,['fictional-stale-task']);
 assert.equal(made[1].calls.filter(c=>c[0]==='decrypt').length,2);assert.equal(made[1].calls.filter(c=>c[0]==='encrypt').length,1);
 assert.deepEqual(phases.filter((p,i)=>phases.indexOf(p)===i),['vault-starting','vault-preparing','vault-creating','vault-waiting','vault-verifying','vault-reopening']);
}
// 1b. Activity log: plain progress lines for the page, with task rounds, bounded, de-duplicated and free of secrets.
{
 const {makePeer}=fixture({slowReady:true}),logs=[],waits=[];
 await run(makePeer,{onLog:t=>logs.push(t),onProgress:(phase,seconds,task)=>{if(phase==='vault-waiting'&&task)waits.push(task.round+'/'+task.totalRounds)}});
 const text=logs.join('\n');
 for(const expected of [/Local participant started \(aaaaaaaa/,/Local participant: synthetic prime search/,/Local participant: round-message, round 1\/4/,/Local participant reported: QKMS HTTP 503/,new RegExp('Key requested: '+keyId),/QKMS task: CreateKey IN_PROGRESS, round 1\/4/,/QKMS task: CreateKey IN_PROGRESS, round 2\/4/,/Key is ready/,/Encryption check passed/,/Restarting the local participant/,/Restart check passed/])assert.match(text,expected);
 assert.ok(logs.every(line=>typeof line==='string'&&line.length<=200&&!/[<>]/.test(line)));
 for(const secret of [credentials.secretKey,credentials.accessKey])assert.ok(!text.includes(secret));
 assert.equal(logs.filter(l=>/round 1\/4/.test(l)&&/QKMS task/.test(l)).length,1);assert.equal(logs.filter(l=>/Local participant: round-message, round 1\/4/.test(l)).length,1);assert.ok(waits.includes('2/4'));
}
// 2. Any failure after starting: nothing is returned, every participant is stopped, and the message says the key was not deleted.
for(const [options,pattern,extra]of [[{createFails:true},/CreateKey/,{}],[{badDecrypt:true},/did not pass its encryption check[\s\S]*was not deleted/,{}],[{neverReady:true},/did not become ready[\s\S]*was not deleted/,{readyTimeoutMs:40}],[{reopenFails:true},/after the local participant was restarted[\s\S]*was not deleted/,{}],[{restartChangesIdentity:true},/changed identity[\s\S]*was not deleted/,{}]]){
 const {made,makePeer}=fixture(options);
 await assert.rejects(()=>run(makePeer,extra),pattern);
 assert.ok(made.length>=1&&made.every(p=>p.stopped));
}
// 3. Cancelling (page closed) while waiting stops every worker.
{
 const {made,makePeer}=fixture({neverReady:true}),abort=new AbortController();setTimeout(()=>abort.abort(),30);
 await assert.rejects(()=>run(makePeer,{signal:abort.signal}),/cancelled/);assert.ok(made.every(p=>p.stopped));
}
console.log('PASS LOCAL: the hosted key for the second lock is created with the service plus one local participant, never enables private-share export, requires a verified encrypt/decrypt roundtrip and a successful decrypt after restarting the local participant, logs plain progress without secrets, and on failure or cancellation stops every participant. Synthetic participants; no live QKMS.');
