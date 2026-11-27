import {toBase64,fromBase64} from './profile-crypto.js';
import {prepareThenCreate} from './prepare.js';
import {monitorKey} from './monitor.js';
export class SetupVaultError extends Error{}
// Progress text comes from workers and the service: keep it short and free of markup before it reaches the page.
const clean=t=>String(t??'').replace(/[^\w .,:;()\/#-]/g,'').slice(0,120);
const REMOTE_NOTE=' A QKMS key may have been created for this attempt; it was not deleted, and no vault profile was saved.';
const CHECK_FAILED='The new key did not pass its encryption check.';
// Creates one RSA-2048 2-of-2 key shared between the hosted QKMS participant ("service") and one
// participant in this browser, and returns the key id plus the local participant's state.
// Private-share export is never enabled. It returns only after the key passed an encrypt/decrypt check
// AND a second decrypt with a freshly restarted local participant, which is what every later unlock does.
export async function createHostedKey({credentials,makePeer,signal,onProgress=()=>{},onLog=()=>{},readyTimeoutMs=600000,pollMs=2000}){
 const self={makePeer,readyTimeoutMs,pollMs};
 let open=true,requested=false,logged=new Set();
 const log=text=>{if(open)try{onLog(String(text).slice(0,200))}catch{}};
 const once=line=>{if(logged.has(line))return;if(logged.size<2000)logged.add(line);log(line)};
 const event=e=>{if(!e||typeof e!=='object')return;const who='Local participant',round=Number.isFinite(e.task?.round)&&Number.isFinite(e.task?.totalRounds)?', round '+e.task.round+'/'+e.task.totalRounds:'';if(e.event==='crypto-progress')once(who+': '+clean(e.stage));else if(e.event==='participant-progress')once(who+': '+clean(e.stage)+round);else if(e.event==='participant-error')once(who+' reported: '+clean(e.error)+round)};
 const cancelled=()=>new SetupVaultError('Vault creation was cancelled.'+(requested?REMOTE_NOTE:' No vault profile was saved.'));
 const peers=[],stopAll=()=>{for(const p of peers)try{p?.stop()}catch{}},live=()=>{if(signal?.aborted)throw cancelled()};
 live();signal?.addEventListener('abort',stopAll,{once:true});
 try{
    onProgress('vault-starting');log('Starting the local participant.');
    const first=self.makePeer(event);peers.push(first);
    const started=await first.call('start',{credentials,hosted:true,exportPrivateShareForTest:false,preparationBackend:'rust'},60000);live();
    const sidecarId=started?.sidecarId;if(typeof sidecarId!=='string'||!/^[a-f0-9]{32}$/.test(sidecarId))throw Error('The local participant did not start.');
    log('Local participant started ('+sidecarId.slice(0,8)+'…). The second participant is the hosted QKMS service.');
    onProgress('vault-preparing');log('Preparing key material on this device. No key has been requested yet.');
    const made=await prepareThenCreate({peers:[first],isCancelled:()=>!!signal?.aborted,onProgress:()=>log('Local preparation finished.'),create:()=>{live();onProgress('vault-creating');log('Asking QKMS to create the key with the hosted service and this browser.');requested=true;return first.call('create',{participants:['service',sidecarId],vault:true},90000)}});live();
    const keyId=made?.keyId;if(typeof keyId!=='string'||!/^[A-Za-z0-9_:/.-]{1,256}$/.test(keyId))throw Error('QKMS returned no usable key identifier.');
    onProgress('vault-waiting');log('Key requested: '+keyId+'. Waiting for it to become ready.');
    const observer=self.makePeer();peers.push(observer);let previous='',task=null,seconds=0,lastWaitLog=0;
    await observer.call('observe-start',{credentials,keyId},15000);live();
    const ready=await monitorKey({signal,timeoutMs:self.readyTimeoutMs,intervalMs:self.pollMs,isCancelled:()=>!!signal?.aborted,probe:()=>observer.call('ready',{keyId,sidecarId},30000),onProgress:s=>{
     if(s.waiting){seconds=s.elapsedSeconds;if(seconds-lastWaitLog>=60){lastWaitLog=seconds;log('Still waiting for the key ('+seconds+'s).')}onProgress('vault-waiting',seconds,task);return}
     const t=s.task,valid=t&&Number.isFinite(t.round)&&Number.isFinite(t.totalRounds);const line=valid?'QKMS task: '+clean(t.operation)+' '+clean(t.status)+', round '+t.round+'/'+t.totalRounds:s.taskError?'QKMS task: '+clean(s.taskError):'';
     if(line&&line!==previous){previous=line;log(line)}if(valid){task={round:t.round,totalRounds:t.totalRounds};onProgress('vault-waiting',seconds,task)}
    }});live();
    if(ready?.ready!==true)throw Error('The new key did not become ready.');
    onProgress('vault-verifying');log('Key is ready. Checking that it can encrypt and decrypt.');
    const sample=crypto.getRandomValues(new Uint8Array(32));let participant;
    const decrypts=async(ciphertext,failure)=>{let unwrapped;try{unwrapped=await observer.call('decrypt',{keyId,value:ciphertext},120000)}catch(e){live();throw Error(failure+' ('+clean(e.message)+')')}live();let recovered;try{recovered=fromBase64(unwrapped?.Plaintext,32)}catch{throw Error(failure)}try{if(recovered.length!==32||!sample.every((b,i)=>b===recovered[i]))throw Error(failure)}finally{recovered.fill(0)}};
    try{
     const wrapped=await observer.call('encrypt',{keyId,value:toBase64(sample)},60000);live();if(typeof wrapped?.CiphertextBlob!=='string'||!wrapped.CiphertextBlob)throw Error(CHECK_FAILED);
     await decrypts(wrapped.CiphertextBlob,CHECK_FAILED);log('Encryption check passed.');
     participant=await first.call('export-state',{keyId},15000);live();if(participant?.sidecarId!==sidecarId)throw Error('The local participant changed identity.');
     // Every later unlock starts a new worker from the saved state. Prove that works before saving anything.
     onProgress('vault-reopening');log('Restarting the local participant to check that the vault can be reopened later.');
     first.stop();logged=new Set();
     const baseline=await observer.call('pending-tasks',{sidecarIds:[sidecarId]},30000);live();if(!Array.isArray(baseline?.ids))throw Error('Could not list pending key tasks.');
     const second=self.makePeer(event);peers.push(second);
     const again=await second.call('start',{credentials,hosted:true,restore:participant,syncSession:true,ignoreTaskIds:baseline.ids,exportPrivateShareForTest:false,preparationBackend:'rust'},60000);live();
     if(again?.sidecarId!==sidecarId)throw Error('The restarted local participant changed identity.');
     await decrypts(wrapped.CiphertextBlob,'The hosted service did not complete a decrypt after the local participant was restarted, so this vault could not be reopened later.');
     log('Restart check passed.');
    }finally{sample.fill(0)}
    return {keyId,participant};
 }catch(e){
  if(signal?.aborted)throw cancelled();
  if(requested&&!(e instanceof SetupVaultError))throw new SetupVaultError((e.message||'Vault creation failed.')+REMOTE_NOTE);
  throw e;
 }finally{open=false;signal?.removeEventListener('abort',stopAll);stopAll()}
}
