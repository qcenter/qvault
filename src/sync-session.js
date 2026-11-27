import {storageCredentialsFor} from './storage-config.js';
import {sealProfile} from './profile-crypto.js';
import {loadCloudVault,saveCloudVault,validateEntries} from './cloud-vault.js';
import {mergeEntries,sameEntries} from './sync-merge.js';
import {SyncConflict} from './sync-transport.js';
export class SyncSession{
 constructor({transport,cache,store,recordRevision,handle,payload,deviceId,peer,withMpc,check=()=>{},signal,onLost=()=>{},load=loadCloudVault,save=saveCloudVault}){Object.assign(this,{transport,cache,store,recordRevision,handle,payload,deviceId,peer,withMpc,check,signal,onLost,load,save});this.entries=null;this.head=null;this.conflicts=[];}
 args(){return {credentials:storageCredentialsFor(this.payload),profileId:this.handle.profileId,keyId:this.payload.keyId,localKey:this.payload.localKey,cache:this.cache,peer:this.peer,signal:this.signal,check:this.check}}
 floor(head){const old=this.payload.sync;if(old?.generation&&head.state.generation<old.generation)throw Error('Cloud sync rollback detected');if(old?.generation===head.state.generation&&old.revision!==head.state.revision)throw Error('Cloud sync history changed unexpectedly')}
 async readHead(){let head=await this.transport.readHead(this.signal);this.check();if(!head){if(this.payload.sync?.generation)throw Error('Cloud sync head is missing; previous state was not reset');const state={version:1,revision:crypto.randomUUID(),generation:1,reference:this.payload.vault??null,applied:{}};try{head=await this.transport.publish(null,state,this.signal)}catch(e){if(!(e instanceof SyncConflict))throw e;head=await this.transport.readHead(this.signal);if(!head)throw Error('Cloud sync initialization race; retry')}}this.floor(head);return head;}
 async readEntries(head){
  if(this.entries&&this.head?.state.reference?.object===head.state.reference?.object)return this.entries;
  if(!head.state.reference)return [];
  const result=await this.transport.withMpcLease(leaseSignal=>this.withMpc((peer,signal)=>this.load({...this.args(),reference:head.state.reference,peer,signal}),leaseSignal),{signal:this.signal,onLost:this.onLost});this.check();return result;
 }
 async persist(payload){const record=await sealProfile(payload,this.handle);this.check();await this.store.save(record,this.recordRevision);this.check();this.recordRevision=record.revision;this.payload=payload;}
 async adopt(head,entries,clearPending=false){const sync={...this.payload.sync,generation:head.state.generation,revision:head.state.revision};if(clearPending)delete sync.pending;await this.persist({...this.payload,vault:head.state.reference,sync});this.head=head;this.entries=entries;return entries;}
 async init(){await this.transport.verify(this.signal);this.check();if(this.payload.sync?.pending)return this.flush();return this.pull();}
 async pull(){const head=await this.readHead();if(this.head?.etag===head.etag)return this.entries;const entries=await this.readEntries(head);return this.adopt(head,entries);}
 async commit(entries,base=this.entries){
  validateEntries(entries);validateEntries(base);if(this.payload.sync?.pending)await this.flush();
  const counter=Math.max(this.payload.sync?.counter||0,this.head?.state.applied[this.deviceId]||0)+1;
  const pending={device:this.deviceId,sequence:counter,base,entries};
  await this.persist({...this.payload,sync:{...this.payload.sync,counter,pending}});
  return this.flush();
 }
 async flush(){
  const pending=this.payload.sync?.pending;if(!pending)return this.pull();
  if(!/^[a-f0-9-]{36}$/.test(pending.device)||!Number.isSafeInteger(pending.sequence)||pending.sequence<1)throw Error('Invalid pending sync change');validateEntries(pending.base);validateEntries(pending.entries);
  for(let attempt=0;attempt<6;attempt++){
   this.check();const head=await this.readHead();const remote=await this.readEntries(head);
   if((head.state.applied[pending.device]||0)>=pending.sequence){await this.adopt(head,remote,true);return this.entries}
   const merged=await mergeEntries(pending.base,pending.entries,remote);this.check();
   const reference=sameEntries(merged.entries,remote)?head.state.reference:await this.save({...this.args(),entries:merged.entries});this.check();
   const applied={...head.state.applied,[pending.device]:pending.sequence};if(Object.keys(applied).length>128)throw Error('Too many linked device identities for this sync format');
   const next={version:1,revision:crypto.randomUUID(),generation:head.state.generation+1,reference,applied,parent:head.state.revision};
   try{const published=await this.transport.publish(head,next,this.signal);this.check();this.conflicts=merged.conflicts;await this.adopt(published,merged.entries,true);return this.entries}catch(e){if(!(e instanceof SyncConflict))throw e}
  }
  throw Error('Other devices are saving repeatedly. Pending changes remain protected and will retry.');
 }
 async sync(){return this.payload.sync?.pending?this.flush():this.pull()}
 // Best-effort cloud housekeeping after a save; never affects the save itself.
 async prune(){try{if(typeof this.transport?.pruneSnapshots!=='function')return null;return await this.transport.pruneSnapshots({protect:[this.payload?.vault?.object,this.head?.state?.reference?.object],signal:this.signal})}catch{return null}}
 close(){this.entries=null;this.handle=null;this.head=null;this.payload=null}
}
