const FORMAT2='qvault-profile-v2',MAX=4*1024*1024;
const encoder=new TextEncoder(),decoder=new TextDecoder();
export const toBase64=b=>{let s='';for(const n of b)s+=String.fromCharCode(n);return btoa(s)};
export function fromBase64(s,max=MAX){if(typeof s!=='string'||s.length>max*2||!s.length||!/^[A-Za-z0-9+/]*={0,2}$/.test(s))throw Error('Invalid encrypted profile');const b=Uint8Array.from(atob(s),c=>c.charCodeAt(0));if(b.length>max)throw Error('Oversized encrypted profile');return b}
export const isPasskeyProfile=record=>record?.format===FORMAT2;
const sized=(value,size)=>{try{return fromBase64(value,size).length===size}catch{return false}};
function validateSlot(slot){
 if(!slot||!['passkey','recovery'].includes(slot.type)||!sized(slot.salt,16)||!sized(slot.nonce,12)||!sized(slot.wrapped,48))throw Error('Invalid encrypted profile');
 if(slot.type==='passkey'){let id;try{id=fromBase64(slot.credentialId,1024)}catch{throw Error('Invalid encrypted profile')}if(!id.length||!sized(slot.prfSalt,32))throw Error('Invalid encrypted profile')}
}
export function validateEnvelope(record){
 if(isPasskeyProfile(record)){
  // v2: a random profile key encrypts the payload; each slot wraps that key for one passkey or for the recovery key.
  if(!/^[a-f0-9-]{36}$/.test(record.profileId)||!/^[a-f0-9-]{36}$/.test(record.revision)||!Array.isArray(record.slots)||record.slots.length<1||record.slots.length>8)throw Error('Unsupported encrypted profile');
  for(const slot of record.slots)validateSlot(slot);
  if(!record.slots.some(s=>s.type==='recovery'))throw Error('Invalid encrypted profile');
  if(fromBase64(record.nonce,12).length!==12||fromBase64(record.ciphertext).length<16)throw Error('Invalid encrypted profile');
  return record;
 }
 throw Error('Unsupported encrypted profile');
}
// ---- passkey + recovery key ----
const ALPHABET='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',NO_OPEN='This passkey or recovery key does not open the saved vault';
export function generateRecoveryKey(){const raw=crypto.getRandomValues(new Uint8Array(32));let bits=0,value=0,out='';for(const b of raw){value=(value<<8)|b;bits+=8;while(bits>=5){out+=ALPHABET[(value>>>(bits-5))&31];bits-=5}}if(bits)out+=ALPHABET[(value<<(5-bits))&31];raw.fill(0);return out.match(/.{4}/g).join('-')}
export function parseRecoveryKey(text){
 if(typeof text!=='string')throw Error('Invalid recovery key');const clean=text.toUpperCase().replace(/[\s-]/g,'');if(!/^[A-Z2-7]{52}$/.test(clean))throw Error('Invalid recovery key');
 const out=new Uint8Array(32);let bits=0,value=0,index=0;for(const c of clean){value=(value<<5)|ALPHABET.indexOf(c);bits+=5;if(bits>=8){if(index<32)out[index++]=(value>>>(bits-8))&255;bits-=8}value&=(1<<bits)-1}
 if(index!==32||value!==0){out.fill(0);throw Error('Invalid recovery key')}return out;
}
const slotAad=(profileId,slot)=>encoder.encode(JSON.stringify({format:FORMAT2,purpose:'profile-key',profileId,type:slot.type,credentialId:slot.credentialId??null,prfSalt:slot.prfSalt??null}));
const aad2=record=>encoder.encode(JSON.stringify({format:FORMAT2,profileId:record.profileId,revision:record.revision}));
async function slotKey(secret,salt,type,usage){const material=await crypto.subtle.importKey('raw',secret,'HKDF',false,['deriveKey']);return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt,info:encoder.encode('qvault-profile-key/'+type)},material,{name:'AES-GCM',length:256},false,[usage])}
async function wrapSlot(slot,secret,raw,profileId){const salt=crypto.getRandomValues(new Uint8Array(16)),nonce=crypto.getRandomValues(new Uint8Array(12)),key=await slotKey(secret,salt,slot.type,'encrypt');return {...slot,salt:toBase64(salt),nonce:toBase64(nonce),wrapped:toBase64(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData:slotAad(profileId,slot)},key,raw)))}}
async function unwrapSlot(slot,secret,profileId){const key=await slotKey(secret,fromBase64(slot.salt,16),slot.type,'decrypt');const raw=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:fromBase64(slot.nonce,12),additionalData:slotAad(profileId,slot)},key,fromBase64(slot.wrapped,48)));try{if(raw.length!==32)throw Error();return await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt'])}finally{raw.fill(0)}}
// prf: the secret a passkey returns for prfSalt. The recovery key is generated here and returned once.
export async function createPasskeyProfile({prf,credentialId,prfSalt,profileId=crypto.randomUUID()}){
 if(!(prf instanceof Uint8Array)||prf.length<32)throw Error('Invalid passkey secret');if(!/^[a-f0-9-]{36}$/.test(profileId))throw Error('Invalid profile identifier');
 const raw=crypto.getRandomValues(new Uint8Array(32)),recoveryKey=generateRecoveryKey(),recoveryBytes=parseRecoveryKey(recoveryKey);
 try{const slots=[await wrapSlot({type:'passkey',credentialId,prfSalt},prf,raw,profileId),await wrapSlot({type:'recovery'},recoveryBytes,raw,profileId)];for(const slot of slots)validateSlot(slot);
  return {handle:{format:FORMAT2,key:await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']),profileId,slots},recoveryKey}}finally{raw.fill(0);recoveryBytes.fill(0)}
}
// Adds a passkey to an existing passkey profile, proven by a secret that already opens it. The payload is re-sealed under a new revision.
export async function addPasskeyToProfile(record,secret,{prf,credentialId,prfSalt}){
 validateEnvelope(record);if(!isPasskeyProfile(record))throw Error('Only a passkey vault can get another passkey');
 if(!(prf instanceof Uint8Array)||prf.length<32)throw Error('Invalid passkey secret');
 if(record.slots.length>=8)throw Error('This vault already has too many passkeys');
 if(record.slots.some(s=>s.type==='passkey'&&s.credentialId===credentialId))throw Error('This passkey is already added to the vault');
 const opened=await openPasskeyProfile(record,secret),raw=await profileKeyBytes(record,secret);
 try{const slot=await wrapSlot({type:'passkey',credentialId,prfSalt},prf,raw,record.profileId);validateSlot(slot);return await sealPasskeyProfile(opened.payload,{...opened.handle,slots:[...record.slots,slot]})}finally{raw.fill(0)}
}
async function profileKeyBytes(record,secret){
 let bytes,type;if(secret?.prf instanceof Uint8Array&&secret.prf.length>=32){bytes=secret.prf;type='passkey'}else if(typeof secret?.recoveryKey==='string'){try{bytes=parseRecoveryKey(secret.recoveryKey)}catch{throw Error(NO_OPEN)}type='recovery'}else throw Error(NO_OPEN);
 try{for(const slot of record.slots.filter(s=>s.type===type)){try{const key=await slotKey(bytes,fromBase64(slot.salt,16),slot.type,'decrypt');const raw=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:fromBase64(slot.nonce,12),additionalData:slotAad(record.profileId,slot)},key,fromBase64(slot.wrapped,48)));if(raw.length===32)return raw;raw.fill(0)}catch{}}}finally{if(type==='recovery')bytes.fill(0)}
 throw Error(NO_OPEN);
}
async function sealPasskeyProfile(payload,handle){
 const record={format:FORMAT2,profileId:handle.profileId,revision:crypto.randomUUID(),slots:handle.slots,nonce:toBase64(crypto.getRandomValues(new Uint8Array(12)))};
 const bytes=encoder.encode(JSON.stringify(payload));if(bytes.length>MAX-16){bytes.fill(0);throw Error('Profile is too large')}
 try{record.ciphertext=toBase64(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:fromBase64(record.nonce),additionalData:aad2(record)},handle.key,bytes)));return record}finally{bytes.fill(0)}
}
async function openPasskeyProfile(record,secret){
 let bytes=null,type;if(secret?.prf instanceof Uint8Array&&secret.prf.length>=32){bytes=secret.prf;type='passkey'}else if(typeof secret?.recoveryKey==='string'){try{bytes=parseRecoveryKey(secret.recoveryKey)}catch{throw Error(NO_OPEN)}type='recovery'}else throw Error(NO_OPEN);
 let key=null;try{for(const slot of record.slots.filter(s=>s.type===type)){try{key=await unwrapSlot(slot,bytes,record.profileId);break}catch{}}}finally{if(type==='recovery')bytes.fill(0)}
 if(!key)throw Error(NO_OPEN);let plain;
 try{plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:fromBase64(record.nonce),additionalData:aad2(record)},key,fromBase64(record.ciphertext)));return {payload:JSON.parse(decoder.decode(plain)),handle:{format:FORMAT2,key,profileId:record.profileId,slots:record.slots}}}
 catch{throw Error(NO_OPEN)}finally{plain?.fill(0)}
}
// payload: the profile contents. handle: from createPasskeyProfile or openProfile. secret: {prf} from a passkey or {recoveryKey}.
export async function sealProfile(payload,handle){if(handle?.format!==FORMAT2)throw Error('Unsupported profile key');return sealPasskeyProfile(payload,handle)}
export async function openProfile(record,secret){validateEnvelope(record);return openPasskeyProfile(record,secret)}
