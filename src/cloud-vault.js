import {AwsClient} from 'aws4fetch';
import {fromBase64,toBase64} from './profile-crypto.js';
const FORMAT='qvault-passwords-v1',FORMAT2='qvault-passwords-v2',MAX=1024*1024;
const enc=new TextEncoder();
function location(credentials,profileId,object){if(!/^[a-f0-9-]{36}$/.test(profileId)||typeof object!=='string'||!object.startsWith('qvault/'+profileId+'/')||!/^[a-zA-Z0-9/._-]+$/.test(object)||object.split('/').some(s=>s===''||s==='.'||s==='..'))throw Error('Invalid cloud vault reference');return 'https://qstorage.quilibrium.com/'+credentials.bucket+'/'+object}
function client(c){return new AwsClient({accessKeyId:c.accessKey,secretAccessKey:c.secretKey,service:'s3',region:c.region,retries:0})}
function aad(profileId,keyId,object,format=FORMAT){return enc.encode(JSON.stringify({format,profileId,keyId,object}))}
// Local vault key layer (v2): the per-snapshot key is first wrapped with a key that never leaves the
// encrypted profile, and only that wrapped blob is given to the key service.
const wrapAad=(profileId,keyId,object)=>enc.encode(JSON.stringify({format:FORMAT2,purpose:'key-wrap',profileId,keyId,object}));
async function importLocalKey(localKey,usage){let raw;try{raw=fromBase64(localKey,32)}catch{throw Error('Invalid local vault key')}try{if(raw.length!==32)throw Error('Invalid local vault key');return await crypto.subtle.importKey('raw',raw,'AES-GCM',false,[usage])}finally{raw.fill(0)}}
export function validateEntries(entries){
 if(!Array.isArray(entries)||entries.length>1000)throw Error('Invalid password collection');
 const ids=new Set();for(const e of entries){if(!e||typeof e.id!=='string'||!/^[a-f0-9-]{36}$/.test(e.id)||ids.has(e.id))throw Error('Invalid password entry');ids.add(e.id);for(const f of ['title','url','username','password'])if(typeof e[f]!=='string'||e[f].length>4096)throw Error('Invalid password entry');if(e.url){const u=new URL(e.url);if(u.protocol!=='https:')throw Error('Use an HTTPS website URL')}
  // Optional: the password this entry had before its last change.
  if(e.previous!==undefined&&(!e.previous||typeof e.previous.password!=='string'||e.previous.password.length>4096||typeof e.previous.at!=='string'||e.previous.at.length>40))throw Error('Invalid password entry')}return entries;
}
// cache (optional): {get(object),put(object,text)} for a device-local copy of the encrypted object. It only saves the download:
// opening a copy needs the same key-service step and local vault key as opening the cloud object. Cache errors are ignored.
const cached=async(cache,object)=>{try{const text=await cache?.get?.(object);return typeof text==='string'&&text.length<=MAX*2?text:null}catch{return null}};
const remember=async(cache,object,text)=>{try{await cache?.put?.(object,text)}catch{}};
export async function saveCloudVault({credentials,profileId,keyId,entries,peer,signal,localKey,cache,check=()=>{}}){
 validateEntries(entries);const object='qvault/'+profileId+'/'+crypto.randomUUID()+'.json';
 const bytes=enc.encode(JSON.stringify({version:1,entries}));if(bytes.length>MAX)throw Error('Password collection is too large');
 const keyBytes=crypto.getRandomValues(new Uint8Array(32)),nonce=crypto.getRandomValues(new Uint8Array(12));
 const format=localKey===undefined?FORMAT:FORMAT2;let inner=null;
 try{check();
  if(format===FORMAT2){const local=await importLocalKey(localKey,'encrypt'),wrapNonce=crypto.getRandomValues(new Uint8Array(12));inner=new Uint8Array(60);inner.set(wrapNonce);inner.set(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:wrapNonce,additionalData:wrapAad(profileId,keyId,object)},local,keyBytes)),12);check()}
  const wrapped=await peer.call('encrypt',{keyId,value:toBase64(inner||keyBytes)});check();if(typeof wrapped.CiphertextBlob!=='string')throw Error('QKMS returned no wrapped key');
  const key=await crypto.subtle.importKey('raw',keyBytes,'AES-GCM',false,['encrypt']);const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData:aad(profileId,keyId,object,format)},key,bytes));check();
  const body=JSON.stringify({format,profileId,keyId,wrappedKey:wrapped.CiphertextBlob,nonce:toBase64(nonce),ciphertext:toBase64(cipher)});
  const response=await client(credentials).fetch(location(credentials,profileId,object),{method:'PUT',body,headers:{'Content-Type':'application/json','If-None-Match':'*'},redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(60000)])});check();if(!response.ok)throw Error('QStorage save HTTP '+response.status);
  await remember(cache,object,body);return {object};
 }finally{keyBytes.fill(0);bytes.fill(0);inner?.fill(0)}
}
export async function loadCloudVault({credentials,profileId,keyId,reference,peer,signal,localKey,cache,check=()=>{}}){
 if(!reference)return [];check();location(credentials,profileId,reference.object);
 const download=async()=>{const response=await client(credentials).fetch(location(credentials,profileId,reference.object),{method:'GET',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(60000)])});check();if(!response.ok)throw Error('QStorage read HTTP '+response.status);const text=await response.text();check();if(text.length>MAX*2)throw Error('Cloud vault is too large');return text};
 const local=await cached(cache,reference.object);check();
 if(local!==null){
  // A local copy that does not open for any reason is never fatal and never trusted: the cloud object decides.
  try{return await openSnapshot(local,{profileId,keyId,reference,peer,localKey,check})}catch{check()}
 }
 const text=await download(),entries=await openSnapshot(text,{profileId,keyId,reference,peer,localKey,check});await remember(cache,reference.object,text);return entries;
}
async function openSnapshot(text,{profileId,keyId,reference,peer,localKey,check}){
 const record=JSON.parse(text);
 const v2=record.format===FORMAT2;
 if(localKey!==undefined&&record.format===FORMAT)throw Error('This cloud snapshot is not protected by the local vault key. It was rejected.');
 if(v2&&localKey===undefined)throw Error('This cloud snapshot needs the local vault key from its profile.');
 if((!v2&&record.format!==FORMAT)||record.profileId!==profileId||record.keyId!==keyId||typeof record.wrappedKey!=='string'||record.wrappedKey.length>16384)throw Error('Unexpected cloud vault');
 const nonce=fromBase64(record.nonce,12);if(nonce.length!==12)throw Error('Invalid cloud vault nonce');
 const local=v2?await importLocalKey(localKey,'decrypt'):null;
 const unwrapped=await peer.call('decrypt',{keyId,value:record.wrappedKey});check();let keyBytes;
 if(v2){const blob=fromBase64(unwrapped.Plaintext,60);try{if(blob.length!==60)throw Error();keyBytes=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:blob.subarray(0,12),additionalData:wrapAad(profileId,keyId,reference.object)},local,blob.subarray(12)))}catch{throw Error('The local vault key does not open this cloud snapshot.')}finally{blob.fill(0)}}
 else keyBytes=fromBase64(unwrapped.Plaintext,32);
 if(keyBytes.length!==32)throw Error('Invalid recovered vault key');let bytes;
 try{const key=await crypto.subtle.importKey('raw',keyBytes,'AES-GCM',false,['decrypt']);bytes=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:nonce,additionalData:aad(profileId,keyId,reference.object,record.format)},key,fromBase64(record.ciphertext,MAX+16)));check();const payload=JSON.parse(new TextDecoder().decode(bytes));if(payload.version!==1)throw Error('Unsupported password collection');return validateEntries(payload.entries)}finally{keyBytes.fill(0);bytes?.fill(0)}
}
export function generatePassword(length=24){if(!Number.isInteger(length)||length<16||length>128)throw Error('Invalid password length');const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%*-_';let password='';const limit=256-256%alphabet.length;while(password.length<length){const bytes=crypto.getRandomValues(new Uint8Array(64));for(const b of bytes){if(b<limit)password+=alphabet[b%alphabet.length];if(password.length===length)break}bytes.fill(0)}return password}
