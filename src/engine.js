import {validateParticipantState,exportParticipant} from './participant-state.js';
import initRustPrimes,{generate_safe_prime} from '../vendor/rust-primes/qvault_rust_primes.js';
import {prepareWithRust} from './rust-prepare.js';
import {qkmsErrorText} from './qkms-error.js';
import {QkmsRpcClient} from '../upstream/sdk-core/client.ts';
import {Sidecar,generateIdentity} from '../upstream/sdk-core/sidecar/index.ts';
import {RSASession} from '../upstream/sdk-core/sidecar/sessions/rsa.ts';
import {loadMpcWasm} from '../vendor/mpc/loader.js';
import * as channel from '../vendor/channel/channelwasm.js';
const realFetch=globalThis.fetch.bind(globalThis);globalThis.fetch=(input,options={})=>realFetch(input,{...options,redirect:'error',signal:options.signal||AbortSignal.timeout(/GetPublicKey|ListTasksForSidecar/.test(new Headers(options.headers).get('x-amz-target')||'')?12000:55000)});
globalThis.__qvaultCryptoProgress=stage=>self.postMessage({event:'crypto-progress',stage});
let preparationBackend='go';
let hostedTest=false,hosted=false;let client,sidecar;const data=new Map();let ownKey=null,createAttempted=false;
const storage={async get(k){return data.get(k)||null},async put(k,v){data.set(k,new Uint8Array(v))},async delete(k){data.delete(k)},async list(prefix){return [...data.keys()].filter(x=>x.startsWith(prefix))}};
function safeError(e){
 if(e?.status)return qkmsErrorText(e);
 if(e?.name==='TimeoutError'||e?.name==='AbortError')return 'Service request timed out.';
 return ['TypeError','RangeError','RuntimeError'].includes(e?.name)?e.name+': local participant protocol/runtime error.':'Local participant operation failed. No secret diagnostic payload is displayed.';
}
let lastError='',lastErrorAt=0;
function participantError(error,task){const safe=safeError(error);if(safe===lastError&&Date.now()-lastErrorAt<15000)return;lastError=safe;lastErrorAt=Date.now();self.postMessage({event:'participant-error',error:safe,task:task?{status:String(task.Status).slice(0,60),round:Number(task.Round),totalRounds:Number(task.TotalRounds)}:null})}

const progressAt=new Map();
function participantProgress(stage,task){const key=stage+':'+(task?.TaskId||'')+':'+task?.Round;const now=Date.now();if(now-(progressAt.get(key)||0)<15000)return;progressAt.set(key,now);self.postMessage({event:'participant-progress',stage,task:task?{round:Number(task.Round),totalRounds:Number(task.TotalRounds)}:null})}
async function initialize(){await channel.default({module_or_path:new URL('../vendor/channel/channelwasm_bg.wasm',import.meta.url)});return loadMpcWasm()}
async function action(m){
 if(m.action==='local'){const api=await initialize();const identity=await generateIdentity();if(!identity.sidecarId)throw Error('Identity failed');if(typeof api.rsa_shoup_partial!=='function'||typeof api.rsa_dkg_init!=='function'||typeof api.rsa_dkg_prepare!=='function'||typeof api.rsa_dkg_prepared!=='function')throw Error('Missing RSA exports');
 const pair=await crypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['encrypt','decrypt']);
 const jwk=await crypto.subtle.exportKey('jwk',pair.privateKey);const bytes=crypto.getRandomValues(new Uint8Array(32));const encoded=b=>btoa(String.fromCharCode(...b));const asBase64=s=>s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4);
 try{const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'RSA-OAEP'},pair.publicKey,bytes));const partial=JSON.parse(api.rsa_shoup_partial(JSON.stringify({input:encoded(cipher),n:asBase64(jwk.n),dShare:asBase64(jwk.d),totalParties:1})));const combined=JSON.parse(api.rsa_shoup_combine(JSON.stringify({input:encoded(cipher),n:asBase64(jwk.n),e:asBase64(jwk.e),partials:{'1':partial.partial},totalParties:1,unpadOaep:'RSAES_OAEP_SHA_256'})));const recovered=Uint8Array.from(atob(combined.result),c=>c.charCodeAt(0));if(recovered.length!==32||!bytes.every((b,i)=>b===recovered[i]))throw Error('RSA local roundtrip mismatch');recovered.fill(0)}finally{bytes.fill(0)}
 return {ready:true,sidecarId:identity.sidecarId}}
 if(m.action==='start'){
  hostedTest=m.hostedTest===true;if(hostedTest&&(m.exportPrivateShareForTest===true||m.restore))throw Error('Hosted isolation probe forbids private-share export and saved-profile restore');
  // Hosted vault participant: same live peer-scoped channel policy as the probe, but it may be saved and restored. Never exports its private share.
  hosted=m.hosted===true;if(hosted&&(hostedTest||m.exportPrivateShareForTest===true))throw Error('A hosted vault participant never exports its private share');
  preparationBackend=m.preparationBackend==='rust'?'rust':'go';
  if(sidecar)throw Error('Participant already started');
  if(m.restore){const restored=validateParticipantState(m.restore,m.restore.keyId);for(const [k,v]of restored)data.set(k,v);ownKey=m.restore.keyId;createAttempted=true;}
  await initialize();client=new QkmsRpcClient({server:'https://qkms.quilibrium.com',accessKey:m.credentials.accessKey,secretKey:m.credentials.secretKey,region:m.credentials.region});
  const rsa=new RSASession();rsa.requirePrepared=true;rsa.exportPrivateShareForTest=m.exportPrivateShareForTest===true;rsa.onKeyShareReady=async(id,json)=>{await storage.put('keyshare/'+id,new TextEncoder().encode(json))};rsa.loadKeyShare=async id=>{const b=await storage.get('keyshare/'+id);return b?new TextDecoder().decode(b):null};
  const ignored=new Set(Array.isArray(m.ignoreTaskIds)?m.ignoreTaskIds:[]);
  const acceptTask=m.syncSession===true?(task=>task.KeyId===ownKey&&['decrypt','sign'].includes(String(task.Operation).toLowerCase())&&!ignored.has(task.TaskId)):undefined;
  sidecar=new Sidecar({client,storage,acceptTask,reusePeerSession:hostedTest||hosted,operationsWithoutPeerSession:hosted,sessions:[rsa],useTofN:true,pollIntervalMs:500,autoRegister:true,onError:participantError,onProgress:participantProgress});await sidecar.start();const sidecarId=await sidecar.getSidecarId();if(m.restore&&sidecarId!==m.restore.sidecarId){sidecar.stop();throw Error('Restored sidecar identity mismatch')}return {sidecarId};
 }
 if(m.action==='observe-start'){
  client=new QkmsRpcClient({server:'https://qkms.quilibrium.com',accessKey:m.credentials.accessKey,secretKey:m.credentials.secretKey,region:m.credentials.region});ownKey=m.keyId;return {observer:true};
 }
 if(!client)throw Error('Connect first');
 if(m.action==='pending-tasks'){
  if(!Array.isArray(m.sidecarIds)||m.sidecarIds.length<1||m.sidecarIds.length>2||m.sidecarIds.some(id=>!/^[a-f0-9]{32}$/.test(id)))throw Error('Invalid participant list');
  const ids=new Set();for(const id of m.sidecarIds){const r=await client.listTasksForSidecar({SidecarId:id,Limit:100,IncludeTerminal:false});if(!Array.isArray(r.Tasks)||r.Tasks.length>=100)throw Error('Cannot safely establish pending-task baseline');for(const t of r.Tasks)if(t.Status==='AWAITING_CLIENT'){if(typeof t.TaskId!=='string'||!t.TaskId||t.TaskId.length>128)throw Error('Invalid pending-task identifier');ids.add(t.TaskId)}}return {ids:[...ids]};
 }
 if(m.action==='export-state'){
  if(hostedTest)throw Error('Hosted isolation probe cannot export participant state');
  if(!sidecar)throw Error('Participant not started');
  return exportParticipant(storage,await sidecar.getSidecarId(),m.keyId);
 }
 if(m.action==='prepare'){
  if(createAttempted)throw Error('A remote creation was already attempted; start a fresh session.');
  const api=await loadMpcWasm();
  if(JSON.parse(api.rsa_dkg_prepared('{}')).ready===true)return {ready:true,keySize:2048};
  if(preparationBackend==='rust')return prepareWithRust({init:()=>initRustPrimes({module_or_path:new URL('../vendor/rust-primes/qvault_rust_primes_bg.wasm',import.meta.url)}),generate:generate_safe_prime,api,progress:stage=>self.postMessage({event:'crypto-progress',stage})});
  const r=JSON.parse(api.rsa_dkg_prepare(JSON.stringify({keySize:2048})));if(r.ready!==true)throw Error('Offline RSA preparation failed');return {ready:true,keySize:2048};
 }
 if(m.action==='prepared'){
  const api=await loadMpcWasm();return JSON.parse(api.rsa_dkg_prepared('{}'));
 }
 if(m.action==='create'){
  if(hostedTest||hosted){const id=await sidecar.getSidecarId();if(!Array.isArray(m.participants)||m.participants.length!==2||!m.participants.includes('service')||!m.participants.includes(id))throw Error(hosted?'A hosted vault key requires service plus this browser only':'Hosted isolation probe requires service plus this browser only');}
  if(createAttempted)throw Error('This session already attempted CreateKey. No automatic retry is permitted.');
  const api=await loadMpcWasm();if(JSON.parse(api.rsa_dkg_prepared('{}')).ready!==true)throw Error('Offline RSA preparation required before CreateKey.');
  createAttempted=true;
  const r=await client.createKey({KeySpec:'RSA_2048',KeyUsage:'ENCRYPT_DECRYPT',Description:m.vault===true&&!hostedTest?'QVault vault key':'QVault synthetic test; ephemeral shares',Participants:m.participants,Threshold:2,TotalParties:2},{async:true});ownKey=r.KeyMetadata.KeyId;return {keyId:ownKey,pending:true};
 }
 if(m.action==='ready'){
  if(m.keyId!==ownKey)throw Error('Only this session test key is allowed');
  let ready=false,readError=null;
  try{const r=await client.getPublicKey({KeyId:ownKey});ready=typeof r.PublicKey==='string'&&r.PublicKey.length>0}catch(e){
   let type='';try{type=JSON.parse(e.body||'{}').__type||''}catch{};
   if(/NotFound|KMSInvalidState/.test(type))readError='key pending';
   else if(e?.name==='TimeoutError'||e?.name==='AbortError')readError='GetPublicKey request timed out';
   else throw e;
  }
  let task=null,taskError=null;
  try{const r=await client.listTasksForSidecar({SidecarId:m.sidecarId,Limit:100,IncludeTerminal:true});
   if(!Array.isArray(r.Tasks))taskError='Task response has no Tasks array';
   else{const tasks=r.Tasks.filter(t=>t.KeyId===ownKey);const t=tasks.find(t=>t.Operation==='CreateKey')||tasks[0];if(t)task={status:String(t.Status).slice(0,60),operation:String(t.Operation).slice(0,40),round:Number(t.Round),totalRounds:Number(t.TotalRounds)};else taskError='Task absent from returned list; this does not prove deletion';}
  }catch(e){taskError=safeError(e)}
  return {ready,readError,task,taskError};
 }
 if(m.action==='encrypt'||m.action==='decrypt'){
  if(m.keyId!==ownKey)throw Error('Only this session test key is allowed');
  return client.call(m.action==='encrypt'?'Encrypt':'Decrypt',{KeyId:ownKey,EncryptionAlgorithm:'RSAES_OAEP_SHA_256',...(m.action==='encrypt'?{Plaintext:m.value}:{CiphertextBlob:m.value})});
 }
 throw Error('Unknown action');
}
// Never log credentials, identities, key shares or raw RPC error bodies.
console.log=()=>{};console.warn=()=>{};console.error=()=>{};
self.onmessage=async({data:m})=>{try{const result=await action(m);self.postMessage({id:m.id,data:result})}catch(e){self.postMessage({id:m.id,error:safeError(e)})}};
