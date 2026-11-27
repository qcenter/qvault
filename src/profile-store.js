import {validateEnvelope} from './profile-crypto.js';
const DB='qvault-protected',STORE='profiles',KEY='active';
export const LOCK_MINUTES=[1,5,15,30];
export class ProfileStore{
 constructor(idb=globalThis.indexedDB){this.idb=idb}
 async db(){if(!this.idb)throw Error('Protected browser storage is unavailable');return new Promise((resolve,reject)=>{const r=this.idb.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE);r.onerror=()=>reject(Error('Could not open protected browser storage'));r.onblocked=()=>reject(Error('Close other QVault tabs before opening storage'));r.onsuccess=()=>resolve(r.result)})}
 async getDeviceId(){const db=await this.db();try{return await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),r=store.get('device-id');let value;r.onsuccess=()=>{value=r.result;if(!value){value=crypto.randomUUID();store.put(value,'device-id')}};tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(Error('Could not read device identity'));tx.onabort=()=>reject(Error('Device identity read aborted'))})}finally{db.close()}}

 async read(){const db=await this.db();try{return await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly'),r=tx.objectStore(STORE).get(KEY);let value=null;r.onsuccess=()=>{value=r.result??null};tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(Error('Could not read protected profile'));tx.onabort=()=>reject(Error('Profile read aborted'))})}finally{db.close()}}
 async save(record,expectedRevision=null){validateEnvelope(record);const db=await this.db();try{await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),r=store.get(KEY);let conflict=false;r.onsuccess=()=>{const current=r.result;if((current?.revision??null)!==expectedRevision){conflict=true;tx.abort();return}store.put(record,KEY);store.delete('setup-storage')};tx.oncomplete=resolve;tx.onabort=()=>reject(Error(conflict?'Profile changed in another tab; lock and unlock before saving':'Profile save aborted'));tx.onerror=()=>reject(Error('Could not save protected profile'))})}finally{db.close()}}

 // Small device-local helpers. The snapshot copy is the same ciphertext as the cloud object; the capability record holds no secret.
 async value(key){const db=await this.db();try{return await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly'),r=tx.objectStore(STORE).get(key);let result=null;r.onsuccess=()=>result=r.result??null;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(Error('Could not read local data'));tx.onabort=()=>reject(Error('Local data read aborted'))})}finally{db.close()}}
 async put(key,value){const db=await this.db();try{await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(value,key);tx.oncomplete=resolve;tx.onerror=()=>reject(Error('Could not save local data'));tx.onabort=()=>reject(Error('Local data save aborted'))})}finally{db.close()}}
 async readSnapshotCache(object){const entry=await this.value('snapshot-cache');return entry&&entry.object===object&&typeof entry.text==='string'?entry.text:null}
 async writeSnapshotCache(object,text){if(typeof object!=='string'||!/^qvault\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.json$/.test(object)||typeof text!=='string')throw Error('Invalid snapshot copy');if(text.length>2*1024*1024+65536)throw Error('Snapshot copy is too large');await this.put('snapshot-cache',{object,text})}
 // How long an unlocked vault may sit unused before it locks itself. Not a secret; kept beside the profile.
 async readLockMinutes(){const v=await this.value('lock-minutes');return LOCK_MINUTES.includes(v)?v:null}
 async writeLockMinutes(v){if(!LOCK_MINUTES.includes(v))throw Error('Invalid lock time');await this.put('lock-minutes',v)}
 // Whether showing a saved password in the editor needs the passkey again. On unless the person turned it off.
 async readConfirmReveal(){return (await this.value('confirm-reveal'))!==false}
 async writeConfirmReveal(v){if(typeof v!=='boolean')throw Error('Invalid setting');await this.put('confirm-reveal',v)}
 async readCapability(){const c=await this.value('sync-capability');return c&&typeof c.profileId==='string'&&typeof c.bucket==='string'&&typeof c.region==='string'&&['shared','single'].includes(c.mode)&&Number.isFinite(c.checkedAt)?c:null}
 async writeCapability({profileId,bucket,region,mode,checkedAt}){if(typeof profileId!=='string'||typeof bucket!=='string'||typeof region!=='string'||!['shared','single'].includes(mode)||!Number.isFinite(checkedAt))throw Error('Invalid capability record');await this.put('sync-capability',{profileId,bucket,region,mode,checkedAt})}

 async reset(expectedRevision,kind='profile'){
  if(typeof expectedRevision!=='string'||!/^[a-f0-9-]{36}$/.test(expectedRevision))throw Error('Refresh Setup before resetting this device');
  const db=await this.db();try{await new Promise((resolve,reject)=>{
   const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),r=store.get(kind==='settings'?'setup-storage':KEY);let conflict=false;
   r.onsuccess=()=>{if(r.result?.revision!==expectedRevision){conflict=true;tx.abort();return}const active=store.get(KEY);active.onsuccess=()=>{if(kind==='settings'&&active.result){conflict=true;tx.abort();return}store.delete(KEY);store.delete('device-id');store.delete('setup-storage');store.delete('snapshot-cache');store.delete('sync-capability')}};
   tx.oncomplete=resolve;tx.onabort=()=>reject(Error(conflict?'Profile changed. Open Reset this device again and review it.':'Local reset aborted'));tx.onerror=()=>reject(Error('Could not reset this device'));
  })}finally{db.close()}
 }

}
// A lease prevents two unlocked tabs from using the same sidecar identities and
// consuming each other's protocol messages. It is released on lock or tab close.
export async function acquireProfileLease(locks=globalThis.navigator?.locks){
 if(!locks?.request)throw Error('This browser does not support exclusive QVault sessions');
 let release;const done=new Promise(r=>{release=r});let resolveReady,rejectReady;const ready=new Promise((r,j)=>{resolveReady=r;rejectReady=j});
 const request=locks.request('qvault-profile-session',{mode:'exclusive',ifAvailable:true},async lock=>{if(!lock){rejectReady(Error('QVault is already unlocked in another tab'));return}resolveReady(release);await done});request.catch(rejectReady);
 return ready;
}
