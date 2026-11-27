import {discoverSnapshot,listSnapshots} from './snapshot-discovery.js';
import {AwsClient} from 'aws4fetch';
import {fromBase64,toBase64} from './profile-crypto.js';
const FORMAT='qvault-sync-head-v1';
export class SyncUnavailable extends Error{constructor(message){super(message);this.name='SyncUnavailable';this.code='SYNC_UNAVAILABLE'}}
export class SyncConflict extends Error{constructor(){super('Cloud state changed. Retrying the merge.');this.name='SyncConflict'}}
const sleep=(ms,signal)=>new Promise((resolve,reject)=>{if(signal?.aborted)return reject(Error('Vault locked'));const abort=()=>{clearTimeout(timer);reject(Error('Vault locked'))};const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve()},ms);signal?.addEventListener('abort',abort,{once:true})});
export class SyncTransport{
 constructor({credentials,profileId,keyId,handle,fetcher,now=()=>Date.now(),leaseWaitMs=60000,leaseTtlMs=300000,operationMs=120000}){if(!/^[a-f0-9-]{36}$/.test(profileId))throw Error('Invalid sync profile');Object.assign(this,{credentials,profileId,keyId,handle,now,leaseWaitMs,leaseTtlMs,operationMs});this.prefix='qvault/'+profileId+'/sync/v1/';this.fetcher=fetcher||new AwsClient({accessKeyId:credentials.accessKey,secretAccessKey:credentials.secretKey,service:'s3',region:credentials.region,retries:0});}
 page(signal){return async token=>{
   const url=new URL('https://qstorage.quilibrium.com/'+this.credentials.bucket);url.searchParams.set('list-type','2');url.searchParams.set('prefix','qvault/'+this.profileId+'/');url.searchParams.set('max-keys','1000');if(token)url.searchParams.set('continuation-token',token);
   const r=await this.fetcher.fetch(url.toString(),{method:'GET',redirect:'error',cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
   if(!r.ok)throw Object.assign(Error(r.status===403?'QVault cannot list cloud backups. Allow this account to list the vault’s storage, then unlock again. No saved data was changed.':'Cloud backup discovery HTTP '+r.status),{status:r.status});
   return r.text();
  }}
 async latestSnapshot(reference,signal){return discoverSnapshot({profileId:this.profileId,reference,signal,requestPage:this.page(signal)})}
 async listSnapshotItems(signal){return listSnapshots({profileId:this.profileId,signal,requestPage:this.page(signal)})}
 // Only this profile's own immutable snapshots (<uuid>.json directly under its prefix) can be deleted.
 async deleteSnapshot(object,signal){
  const base='qvault/'+this.profileId+'/';if(typeof object!=='string'||!object.startsWith(base)||!/^[a-f0-9-]{36}\.json$/.test(object.slice(base.length)))throw Error('Invalid cloud snapshot name');
  return this.fetcher.fetch('https://qstorage.quilibrium.com/'+this.credentials.bucket+'/'+object,{method:'DELETE',redirect:'error',cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
 }
 // Housekeeping after a save. Keeps the newest snapshots and anything recent, never the ones in `protect`; quiet when not permitted.
 async pruneSnapshots({keep=20,minAgeMs=30*86400000,maxDeletes=50,protect=[],signal}={}){
  let items;try{items=await this.listSnapshotItems(signal)}catch{return {deleted:0,denied:true}}
  const safe=new Set(protect.filter(Boolean)),cutoff=this.now()-minAgeMs;
  const victims=items.sort((a,b)=>b.modified-a.modified||a.object.localeCompare(b.object)).slice(keep).filter(i=>i.modified<cutoff&&!safe.has(i.object)).reverse().slice(0,maxDeletes);
  let deleted=0;for(const item of victims){let r;try{r=await this.deleteSnapshot(item.object,signal)}catch{return {deleted,denied:true}}if(r.ok||r.status===404)deleted++;else return {deleted,denied:true}}
  return {deleted,denied:false};
 }
 async request(name,{method='GET',body,etag,create=false,signal}={}){
  if(!/^[a-z0-9/._-]+$/.test(name))throw Error('Invalid sync object');const headers={};if(body!==undefined)headers['Content-Type']='application/json';if(etag)headers['If-Match']=etag;if(create)headers['If-None-Match']='*';
  return this.fetcher.fetch('https://qstorage.quilibrium.com/'+this.credentials.bucket+'/'+this.prefix+name,{method,body:body===undefined?undefined:JSON.stringify(body),headers,redirect:'error',cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
 }
 etag(response){const value=response.headers.get('etag');if(!value||!/^"[^"\r\n]{1,200}"$/.test(value))throw Error('QStorage must return a strong ETag for safe sync');return value}
 async json(response,max=131072){const text=await response.text();if(text.length>max)throw Error('Oversized sync metadata');try{return JSON.parse(text)}catch{throw Error('Invalid sync metadata')}}
 async verify(signal){
  if(this.verified)return;const name='probes/'+crypto.randomUUID()+'.json';
  try{await this.probe(name,signal)}finally{try{await this.request(name,{method:'DELETE',signal})}catch{}}
 }
 async probe(name,signal){
  let r=await this.request(name,{method:'PUT',body:{probe:1},create:true,signal});if(!r.ok)throw Error('QStorage sync check HTTP '+r.status);let tag=this.etag(r);
  r=await this.request(name,{method:'PUT',body:{probe:2},create:true,signal});if(r.status!==412){if(r.ok||[405,501].includes(r.status))throw new SyncUnavailable('QStorage does not enforce conditional create; automatic sync is unavailable');throw Error('QStorage conditional create check HTTP '+r.status);}
  r=await this.request(name,{method:'PUT',body:{probe:3},etag:'"qvault-stale-etag"',signal});if(r.status!==412){if(r.ok||[405,501].includes(r.status))throw new SyncUnavailable('QStorage does not enforce conditional update; automatic sync is unavailable');throw Error('QStorage conditional update check HTTP '+r.status);}
  r=await this.request(name,{method:'PUT',body:{probe:4},etag:tag,signal});if(!r.ok)throw Error('QStorage conditional update check failed');const current=this.etag(r);
  r=await this.request(name,{method:'PUT',body:{probe:5},etag:tag,signal});if(r.status!==412){if(r.ok)throw new SyncUnavailable('QStorage accepts stale updates; automatic sync is unavailable');throw Error('QStorage stale update check HTTP '+r.status);}
  r=await this.request(name,{signal});if(!r.ok||this.etag(r)!==current||(await this.json(r)).probe!==4)throw Error('QStorage sync readback check failed');this.verified=true;
 }
 aad(){return new TextEncoder().encode(JSON.stringify({format:FORMAT,profileId:this.profileId,keyId:this.keyId}))}
 async encode(state){const nonce=crypto.getRandomValues(new Uint8Array(12));const bytes=new TextEncoder().encode(JSON.stringify(state));try{return {format:FORMAT,profileId:this.profileId,keyId:this.keyId,nonce:toBase64(nonce),ciphertext:toBase64(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData:this.aad()},this.handle.key,bytes)))}}finally{bytes.fill(0)}}
 async decode(record){if(record.format!==FORMAT||record.profileId!==this.profileId||record.keyId!==this.keyId||fromBase64(record.nonce,12).length!==12)throw Error('Unexpected cloud sync head');let bytes;try{bytes=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:fromBase64(record.nonce),additionalData:this.aad()},this.handle.key,fromBase64(record.ciphertext,65536)));const s=JSON.parse(new TextDecoder().decode(bytes));if(s.version!==1||!/^[a-f0-9-]{36}$/.test(s.revision)||!Number.isSafeInteger(s.generation)||s.generation<1||!s.applied||typeof s.applied!=='object'||Array.isArray(s.applied)||Object.keys(s.applied).length>128)throw Error();for(const [id,n]of Object.entries(s.applied))if(!/^[a-f0-9-]{36}$/.test(id)||!Number.isSafeInteger(n)||n<1)throw Error();if(s.reference&&(!s.reference.object?.startsWith('qvault/'+this.profileId+'/')||!/^[-a-zA-Z0-9/._]+$/.test(s.reference.object)))throw Error();return s}catch{throw Error('Cloud sync head authentication/format check failed')}finally{bytes?.fill(0)}}
 async readHead(signal){const r=await this.request('head.json',{signal});if(r.status===404)return null;if(!r.ok)throw Error('QStorage sync read HTTP '+r.status);return {etag:this.etag(r),state:await this.decode(await this.json(r))}}
 async publish(expected,state,signal){const body=await this.encode(state);let r;try{r=await this.request('head.json',{method:'PUT',body,etag:expected?.etag,create:!expected,signal})}catch(e){if(signal?.aborted)throw e;const found=await this.readHead(signal);if(found?.state.revision===state.revision)return found;throw Error('Cloud save outcome is unknown. Pending changes are retained for retry.')}
  if(r.status===412)throw new SyncConflict();if(!r.ok)throw Error('QStorage sync publish HTTP '+r.status);return {etag:this.etag(r),state};
 }
 async withMpcLease(fn,{signal,onLost=()=>{}}={}){
  await this.verify(signal);const owner=crypto.randomUUID(),started=this.now();let owned=null;
  while(!owned){
   if(signal?.aborted)throw Error('Vault locked');if(this.now()-started>this.leaseWaitMs)throw Error('Another device is using the QKMS key. Sync will retry.');
   const r=await this.request('mpc-lease.json',{signal});let previous=null,serverTime;
   if(r.status===404){serverTime=Date.parse(r.headers.get('date'))}else{if(!r.ok)throw Error('QStorage key lease HTTP '+r.status);previous={etag:this.etag(r),body:await this.json(r,4096)};serverTime=Date.parse(r.headers.get('date'));if(typeof previous.body.owner!=='string'||!Number.isFinite(previous.body.expiresAt))throw Error('Invalid key-operation lease')}
   if(!Number.isFinite(serverTime))throw Error('QStorage server time is required for safe key-operation leases');
   if(previous&&previous.body.expiresAt>serverTime){await sleep(400+Math.random()*400,signal);continue}
   const body={owner,expiresAt:serverTime+this.leaseTtlMs};const put=await this.request('mpc-lease.json',{method:'PUT',body,etag:previous?.etag,create:!previous,signal});if(put.status===412)continue;if(!put.ok)throw Error('QStorage lease acquire HTTP '+put.status);owned={etag:this.etag(put),body};
  }
  const guard=new AbortController();let lost=false;const timer=setTimeout(()=>{lost=true;guard.abort();onLost()},this.operationMs);
  try{return await fn(AbortSignal.any([guard.signal,...(signal?[signal]:[])]))}finally{
   clearTimeout(timer);
   // The caller stops its participant workers before returning. Never delete a
   // newer lease or extend an old one after a timeout/partition.
   if(!lost)try{const r=await this.request('mpc-lease.json');if(r.ok){const current=await this.json(r,4096);if(current.owner===owner)await this.request('mpc-lease.json',{method:'PUT',etag:this.etag(r),body:{owner,expiresAt:0}})}}catch{}
  }
 }
}
