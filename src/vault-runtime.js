import {storageCredentialsFor} from './storage-config.js';
import {ProfileStore,acquireProfileLease} from './profile-store.js';
import {openProfile,sealProfile} from './profile-crypto.js';
import {validateProfilePayload} from './participant-state.js';
import {SyncTransport,SyncUnavailable} from './sync-transport.js';
import {SingleDeviceSession} from './single-device-session.js';
import {SyncSession} from './sync-session.js';
import {entryVersion} from './sync-merge.js';
import {loadCloudVault,saveCloudVault,generatePassword} from './cloud-vault.js';
import {LocalKeyPeer} from './local-peer.js';
import {fromBase64} from './profile-crypto.js';
export class BrowserParticipant{
 constructor(){this.worker=new Worker(new URL('./engine.js',import.meta.url),{type:'module'});this.pending=new Map();this.next=1;this.closed=false;
  this.worker.onmessage=({data:r})=>{if(r?.event){try{this.onEvent?.(r)}catch{}return}const p=this.pending.get(r.id);if(!p)return;this.pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(Error(r.error)):p.resolve(r.data)};
  this.worker.onerror=()=>this.stop();
 }
 call(action,args={},timeout=90000){return new Promise((resolve,reject)=>{if(this.closed)return reject(Error('Vault locked'));const id=this.next++,timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Service request timed out'))},timeout);this.pending.set(id,{resolve,reject,timer});this.worker.postMessage({id,action,...args})})}
 stop(){this.closed=true;this.worker.terminate();for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('Vault locked'))}this.pending.clear()}
}
function sameOrigin(entry,origin){try{return new URL(entry.url).origin===origin&&new URL(origin).protocol==='https:'}catch{return false}}
export class VaultRuntime{
 constructor({store=new ProfileStore(),lease=acquireProfileLease,makePeer=()=>new BrowserParticipant(),load=loadCloudVault,save=saveCloudVault,makeTransport=o=>new SyncTransport(o),makeSync=o=>new SyncSession(o),now=()=>Date.now(),idleMs=300000,syncIntervalMs=20000,onState=null}={}){Object.assign(this,{store,lease,makePeer,load,save,makeTransport,makeSync,now,idleMs,syncIntervalMs,onState});this.reported=false;this.peers=[];this.entries=[];this.epoch=0;this.busy=false;this.handle=null;this.release=null;this.abort=new AbortController();this.deadline=0;this.syncState='locked';this.lastSync=0;}
 expire(){if(this.handle&&this.now()>=this.deadline)this.lock()}
 touch(){this.deadline=this.now()+this.idleMs;clearTimeout(this.timer);this.timer=setTimeout(()=>this.expire(),this.idleMs)}
 lock(){this.epoch++;this.abort.abort();this.abort=new AbortController();for(const p of this.peers)p.stop();this.peers=[];this.apiPeer?.stop();this.apiPeer=null;this.sync?.close();this.sync=null;this.entries=[];this.handle=null;this.payload=null;this.revision=null;this.busy=false;this.syncJob=null;this.syncState='locked';clearInterval(this.poller);clearTimeout(this.timer);this.release?.();this.release=null;this.report(false);return {unlocked:false}}
 report(unlocked){if(unlocked===this.reported)return;this.reported=unlocked;try{this.onState?.(unlocked)}catch{}}
 check(epoch){if(epoch!==this.epoch)throw Error('Vault locked')}
 async status(){const record=await this.store.read(),saved=!!record;this.expire();return {unlocked:!!this.handle,saved,confirmReveal:(await this.store.readConfirmReveal?.())??true,lockMinutes:(await this.store.readLockMinutes?.())??Math.round(this.idleMs/60000),auth:'passkey',busy:this.busy&&!this.syncJob,syncing:!!this.syncJob,syncState:this.syncState,lastSync:this.lastSync,revision:this.sync?.head?.state.revision??this.sync?.payload?.vault?.object??null,pending:!!this.sync?.payload?.sync?.pending,conflicts:this.sync?.conflicts?.length||0,mode:this.sync?.mode||'shared-sync'}}
 async mpc(payload,fn,signal,epoch){
  // Hosted topology: the one local participant started at unlock stays alive until lock, so every key operation of a session uses the same peer channel.
  if(payload.topology==='hosted'||payload.topology==='local'){this.check(epoch);return fn(this.apiPeer,AbortSignal.any([signal,this.abort.signal]))}
  const api=this.apiPeer;const active=[];
  try{
   const baseline=await api.call('pending-tasks',{sidecarIds:payload.participants.map(p=>p.sidecarId)},30000);this.check(epoch);
   await Promise.all(payload.participants.map(async state=>{const p=this.makePeer();this.peers.push(p);active.push(p);const r=await p.call('start',{credentials:payload.credentials,restore:state,syncSession:true,ignoreTaskIds:baseline.ids,preparationBackend:'rust'});this.check(epoch);if(r.sidecarId!==state.sidecarId)throw Error('Restored participant changed identity')}));
   this.check(epoch);return await fn(api,AbortSignal.any([signal,this.abort.signal]));
  }finally{for(const p of active)p.stop();this.peers=this.peers.filter(p=>!active.includes(p))}
 }
 async unlock(secret){
  if(this.handle){this.touch();return {unlocked:true}}
  const epoch=this.epoch;
  try{
   const release=await this.lease();if(epoch!==this.epoch){release();throw Error('Vault locked')}this.release=release;
   const record=await this.store.read();this.check(epoch);if(!record)throw Error('No protected profile. Open setup to create and save one.');
   const opened=await openProfile(record,secret);this.check(epoch);const payload=validateProfilePayload(opened.payload);
   if(payload.topology==='local')this.apiPeer=new LocalKeyPeer();
   else{this.apiPeer=this.makePeer();await this.apiPeer.call('observe-start',{credentials:payload.credentials,keyId:payload.keyId},15000);this.check(epoch);
   const ready=await this.apiPeer.call('ready',{keyId:payload.keyId,sidecarId:payload.participants[0].sidecarId},30000);this.check(epoch);if(!ready.ready)throw Error('Saved QKMS key is not ready');}
   if(payload.topology==='hosted'){const saved=payload.participants[0],baseline=await this.apiPeer.call('pending-tasks',{sidecarIds:[saved.sidecarId]},30000);this.check(epoch);if(!Array.isArray(baseline?.ids))throw Error('Could not list pending key tasks');const local=this.makePeer();this.peers.push(local);const started=await local.call('start',{credentials:payload.credentials,restore:saved,hosted:true,syncSession:true,ignoreTaskIds:baseline.ids,preparationBackend:'rust'});this.check(epoch);if(started.sidecarId!==saved.sidecarId)throw Error('Restored participant changed identity')}
   const deviceId=await this.store.getDeviceId();this.check(epoch);
   const transport=this.makeTransport({credentials:storageCredentialsFor(payload),profileId:opened.handle.profileId,keyId:payload.keyId,handle:opened.handle});
   let singleDevice=false;
   // The storage capability check costs several requests. Its result is reused briefly, and only for the same profile and bucket.
   const storageInfo=storageCredentialsFor(payload),linked=!!(payload.sync?.generation||payload.sync?.pending);let known=null;try{known=await this.store.readCapability?.()}catch{}this.check(epoch);
   const age=known?this.now()-known.checkedAt:-1,fresh=known&&known.profileId===opened.handle.profileId&&known.bucket===storageInfo.bucket&&known.region===storageInfo.region&&age>=0&&age<(known.mode==='single'?86400000:3600000);
   if(fresh&&known.mode==='shared')transport.verified=true;
   else if(fresh&&known.mode==='single'&&!linked)singleDevice=true;
   else{
    try{await transport.verify(this.abort.signal);this.check(epoch)}catch(e){this.check(epoch);if(!(e instanceof SyncUnavailable))throw e;if(linked)throw Error('Cloud sync is unavailable. This linked profile cannot safely switch to local snapshots. Your saved profile and pending changes are retained.');singleDevice=true;}
    try{await this.store.writeCapability?.({profileId:opened.handle.profileId,bucket:storageInfo.bucket,region:storageInfo.region,mode:singleDevice?'single':'shared',checkedAt:this.now()})}catch{}this.check(epoch);
   }
   const cache=typeof this.store.readSnapshotCache==='function'?{get:object=>this.store.readSnapshotCache(object),put:(object,text)=>this.store.writeSnapshotCache(object,text)}:undefined;
   this.sync=(singleDevice?o=>new SingleDeviceSession(o):this.makeSync)({transport,cache,store:this.store,recordRevision:record.revision,handle:opened.handle,payload,deviceId,peer:this.apiPeer,load:this.load,save:this.save,signal:this.abort.signal,check:()=>this.check(epoch),onLost:()=>{if(epoch===this.epoch)this.lock()},withMpc:(fn,signal)=>this.mpc(payload,fn,signal,epoch)});
   this.syncState='checking';await this.sync.init();this.check(epoch);const minutes=await this.store.readLockMinutes?.();this.check(epoch);if(minutes)this.idleMs=minutes*60000;this.handle=opened.handle;this.adoptSync();this.touch();this.poller=setInterval(()=>this.background(),this.syncIntervalMs);this.report(true);return {unlocked:true};
  }catch(e){if(epoch===this.epoch)this.lock();throw e}
 }
 adoptSync(){this.entries=this.sync.entries;this.payload=this.sync.payload;this.revision=this.sync.recordRevision;this.lastSync=this.now();this.syncState=this.sync.mode==='single-device'?'Single-computer mode · cloud snapshots saved · automatic sync unavailable':this.sync.conflicts?.length?'conflict-copies-preserved':'synced'}
 async performSync(){this.syncState='checking';await this.sync.sync();this.adoptSync()}
 background(){this.expire();if(!this.handle||this.busy)return;const epoch=this.epoch;this.busy=true;const job=this.performSync().catch(e=>{if(epoch===this.epoch)this.syncState=e.message}).finally(()=>{if(epoch===this.epoch){this.busy=false;if(this.syncJob===job)this.syncJob=null}});this.syncJob=job;}
 async commit(entries,base=this.entries){try{await this.sync.commit(entries,base);this.adoptSync();this.touch();this.sync.prune?.();return {saved:true,conflicts:this.sync.conflicts.length,mode:this.sync.mode||'shared-sync'}}catch(e){this.syncState=e.message;throw Error(e.message+(this.sync?.payload?.sync?.pending?' Pending changes remain encrypted locally and will retry.':''))}}
 // A replaced password is kept with its entry (one step back), so a change that the website refused is not lost.
 kept(before,password){if(!before)return {};if(before.password&&before.password!==password)return {previous:{password:before.password,at:new Date(this.now()).toISOString()}};return before.previous?{previous:before.previous}:{}}
 async command(m){
  this.expire();if(m.action==='lock')return this.lock();if(m.action==='status')return this.status();if(m.action==='set-lock-minutes'){await this.store.writeLockMinutes(m.minutes);this.idleMs=m.minutes*60000;if(this.handle)this.touch();return this.status()}// Turning the passkey check off locks the vault, so finding it open is not enough to switch the check off.
  if(m.action==='set-confirm-reveal'){if(typeof m.value!=='boolean')throw Error('Invalid setting');await this.store.writeConfirmReveal(m.value);if(!m.value)this.lock();return this.status()}
  if(this.syncJob)await this.syncJob;if(this.busy)throw Error('A vault operation is still running');
  this.busy=true;const epoch=this.epoch;
  try{
   if(m.action==='unlock'){let prf=null;try{if(typeof m.prf==='string')prf=fromBase64(m.prf,64);return await this.unlock(prf?{prf}:{recoveryKey:typeof m.recoveryKey==='string'?m.recoveryKey:''})}finally{prf?.fill(0)}}
   if(!this.handle)throw Error('Vault locked. Open QVault and unlock it.');if(!m.passive)this.touch();
   if(m.action==='sync'){await this.performSync();return this.status()}
   if(m.action==='generate')return {password:generatePassword()};
   if(['list','get','all-entries'].includes(m.action)&&this.now()-this.lastSync>=15000)await this.performSync();
   if(m.action==='all-entries')return Promise.all(this.entries.map(async e=>({id:e.id,title:e.title,username:e.username,url:e.url,version:await entryVersion(e)})));
   const origin=new URL(m.origin);if(origin.protocol!=='https:'||origin.origin!==m.origin)throw Error('An exact HTTPS website is required');
   const find=()=>{const entry=this.entries.find(e=>e.id===m.id&&sameOrigin(e,m.origin));if(!entry)throw Error('Entry not found for this website');return entry};
   if(m.action==='list')return Promise.all(this.entries.filter(e=>sameOrigin(e,m.origin)).slice(0,100).map(async e=>({id:e.id,title:e.title,username:e.username,version:await entryVersion(e)})));
   // The editor gets the entry without its password while the passkey check is on; filling still gets all of it.
   if(m.action==='get'){const {previous,...entry}=find();return m.forEdit===true&&((await this.store.readConfirmReveal?.())??true)?{...entry,password:'',passwordHidden:true}:entry}
   // Show one password after the passkey or recovery key has been proven again against the saved profile.
   if(m.action==='reveal'){const entry=find();let prf=null;try{if(typeof m.prf==='string')prf=fromBase64(m.prf,64);const secret=prf?{prf}:typeof m.recoveryKey==='string'?{recoveryKey:m.recoveryKey}:null;if(!secret)throw Error('Confirm with your passkey or recovery key');await openProfile(await this.store.read(),secret)}finally{prf?.fill(0)}return {title:entry.title,username:entry.username,password:entry.password,...(entry.previous?{previous:{password:entry.previous.password,at:entry.previous.at}}:{})}}
   if(m.action==='delete'){const entry=find();if(m.expectedVersion&&m.expectedVersion!==await entryVersion(entry))throw Error('This entry changed on another device. Refresh and review it before deleting.');return await this.commit(this.entries.filter(e=>e.id!==m.id))}
   // Save a login from a web form. The same username, or failing that the same password (a generated one saved before the username was typed), updates that entry instead of adding another.
   // A form without a username (a change-password page) updates the website's only saved login; with several saved it adds a separate entry rather than guessing.
   if(m.action==='save-login'||m.action==='check-login'){if(typeof m.username!=='string'||typeof m.password!=='string'||!m.password)throw Error('A password is needed to save a login');
    const mine=this.entries.filter(e=>sameOrigin(e,m.origin)),match=(m.username&&mine.find(e=>e.username===m.username))||mine.find(e=>e.password===m.password)||(!m.username&&mine.length===1?mine[0]:null);
    // Asked before offering to save: is this exact login saved, saved with something different, or new? Nothing is stored.
    if(m.action==='check-login')return {state:!match?'new':match.password===m.password&&(!m.username||match.username===m.username)?'saved':'changed'};
    const next={id:match?.id||crypto.randomUUID(),title:match?.title||origin.hostname,url:m.origin,username:m.username||match?.username||'',password:m.password,...this.kept(match,m.password)};
    if(match&&match.username===next.username&&match.password===next.password)return {saved:true,unchanged:true,updated:false};
    return {...await this.commit([...this.entries.filter(e=>e.id!==next.id),next]),updated:!!match}}
   if(m.action==='put'){
    const entry=m.entry;if(!entry||typeof entry.title!=='string'||!entry.title.trim()||typeof entry.username!=='string'||typeof entry.password!=='string')throw Error('Enter title, username and password');
    if(m.create&&(!m.id||!/^[a-f0-9-]{36}$/.test(m.id)))throw Error('Invalid new entry ID');
    const before=m.id?this.entries.find(e=>e.id===m.id):null;if(before&&!sameOrigin(before,m.origin))throw Error('Entry belongs to another website');if(m.id&&!m.create)find();
    // Edited without the password on screen: an empty field keeps the saved one, and the baseline's unknown password counts as unchanged.
    let password=entry.password;if(m.hiddenPassword===true){if(!before)throw Error('Entry not found for this website');if(password==='')password=before.password;if(m.base)m={...m,base:{...m.base,password:before.password}}}
    let base=this.entries.map(e=>({...e}));if(m.base){if(m.base.id!==m.id||!sameOrigin(m.base,m.origin))throw Error('Invalid edited entry baseline');base=base.filter(e=>e.id!==m.id);base.push({id:m.base.id,...Object.fromEntries(['title','url','username','password'].map(k=>[k,m.base[k]]))})}
    const next={id:m.id||crypto.randomUUID(),title:entry.title.trim(),url:m.origin,username:entry.username,password,...this.kept(before,password)};
    if(m.create)base=base.filter(e=>e.id!==next.id);
    return await this.commit([...this.entries.filter(e=>e.id!==next.id),next],base);
   }
   throw Error('Unsupported vault request');
  }finally{if(epoch===this.epoch)this.busy=false}
 }
}
