import {storageCredentialsFor} from './storage-config.js';
import {sealProfile} from './profile-crypto.js';
import {validateEntries} from './cloud-vault.js';
// Explicit compatibility mode for a profile that has never joined shared sync.
// Immutable snapshots remain encrypted; only this browser's local pointer moves.
// Other computers are followed by loading the newest snapshot; a save is refused while a newer one exists.
export class SingleDeviceSession{
 constructor(options){Object.assign(this,options);this.entries=null;this.conflicts=[];this.mode='single-device';}
 args(){return {credentials:storageCredentialsFor(this.payload),profileId:this.handle.profileId,keyId:this.payload.keyId,localKey:this.payload.localKey,cache:this.cache,peer:this.peer,signal:this.signal,check:this.check}}
 async init(){
  if(this.payload.sync?.generation||this.payload.sync?.pending)throw Error('This profile has shared sync history or pending changes. Single-computer mode cannot replace that history.');
  return this.refresh();
 }
 // Load the newest cloud copy if it is not the one already open, and remember it in the saved profile.
 async refresh(){
  const reference=await this.transport.latestSnapshot(this.payload.vault,this.signal);this.check();
  if(this.entries&&reference?.object===this.payload.vault?.object)return this.entries;
  const entries=reference?await this.withMpc((peer,signal)=>this.load({...this.args(),reference,peer,signal}),this.signal):[];this.check();
  if(reference?.object!==this.payload.vault?.object){const payload={...this.payload,vault:reference};const record=await sealProfile(payload,this.handle);this.check();await this.store.save(record,this.recordRevision);this.check();this.payload=payload;this.recordRevision=record.revision;}
  this.entries=entries;return this.entries;
 }
 async commit(entries){
  validateEntries(entries);const latest=await this.transport.latestSnapshot(this.payload.vault,this.signal);this.check();if(latest?.object!==this.payload.vault?.object)throw Error('Another computer just saved changes. They load within a few seconds; then make your change again. This change was not uploaded.');const reference=await this.save({...this.args(),entries});this.check();
  const payload={...this.payload,vault:reference};const record=await sealProfile(payload,this.handle);this.check();
  await this.store.save(record,this.recordRevision);this.check();this.payload=payload;this.recordRevision=record.revision;this.entries=entries;return entries;
 }
 async sync(){return this.refresh()}
 // Best-effort cloud housekeeping after a save; never affects the save itself.
 async prune(){try{if(typeof this.transport?.pruneSnapshots!=='function')return null;return await this.transport.pruneSnapshots({protect:[this.payload?.vault?.object],signal:this.signal})}catch{return null}}
 close(){this.entries=null;this.payload=null;this.handle=null}
}
