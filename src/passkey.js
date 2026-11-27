import {toBase64,fromBase64} from './profile-crypto.js';
// WebAuthn helpers for unlocking with a passkey. The PRF extension makes the authenticator return a
// stable 32-byte secret after user verification (for example Touch ID). Secrets are returned to the
// caller only; nothing here stores or logs them.
export class PasskeyError extends Error{constructor(code,message){super(message);this.code=code}}
const bytes=n=>crypto.getRandomValues(new Uint8Array(n));
const failure=e=>e instanceof PasskeyError?e:e?.name==='AbortError'?new PasskeyError('withdrawn','The passkey request was withdrawn.'):e?.name==='NotAllowedError'?new PasskeyError('cancelled','The passkey request was cancelled or timed out.'):new PasskeyError('failed','The passkey request failed ('+(typeof e?.name==='string'&&/^[A-Za-z]{1,40}$/.test(e.name)?e.name:'Error')+').');
const copy=value=>value?new Uint8Array(value.buffer?value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength):value.slice(0)):null;
const base64url=b64=>b64.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const usable=container=>{if(typeof container?.create!=='function'||typeof container?.get!=='function')throw new PasskeyError('unavailable','This browser does not offer passkeys to the extension.')};
const NO_SECRET='This passkey provider does not return the secret QVault needs. Choose a different provider, such as iCloud Keychain or the browser profile.';
export async function passkeySecret({container=globalThis.navigator?.credentials,slots,signal}){
 usable(container);const usableSlots=(slots||[]).filter(s=>s?.type==='passkey');if(!usableSlots.length)throw new PasskeyError('no-passkey','This vault has no passkey. Use the recovery key.');
 let assertion;try{assertion=await container.get({...(signal?{signal}:{}),publicKey:{challenge:bytes(32),allowCredentials:usableSlots.map(s=>({type:'public-key',id:fromBase64(s.credentialId,1024)})),userVerification:'required',timeout:120000,extensions:{prf:{evalByCredential:Object.fromEntries(usableSlots.map(s=>[base64url(s.credentialId),{first:fromBase64(s.prfSalt,32)}]))}}}})}catch(e){throw failure(e)}
 const prf=copy(assertion?.getClientExtensionResults?.().prf?.results?.first);if(!prf||prf.length<32)throw new PasskeyError('no-secret',NO_SECRET);
 return {prf,credentialId:assertion.rawId?toBase64(new Uint8Array(assertion.rawId)):null};
}
export async function createPasskey({container=globalThis.navigator?.credentials,label='QVault vault'}={}){
 usable(container);const salt=bytes(32);let created;
 try{created=await container.create({publicKey:{rp:{name:'QVault'},user:{id:bytes(16),name:label,displayName:label},challenge:bytes(32),pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257}],authenticatorSelection:{residentKey:'preferred',userVerification:'required'},timeout:120000,extensions:{prf:{eval:{first:salt}}}}})}catch(e){throw failure(e)}
 if(!created?.rawId)throw new PasskeyError('failed','The passkey was not created.');
 const credentialId=toBase64(new Uint8Array(created.rawId)),prfSalt=toBase64(salt),results=created.getClientExtensionResults?.().prf;
 // Some authenticators answer at creation; others only when the passkey is used, which needs a second confirmation.
 let prf=copy(results?.results?.first);if(prf&&prf.length<32)prf=null;
 if(!prf){if(!results)throw new PasskeyError('no-secret',NO_SECRET);prf=(await passkeySecret({container,slots:[{type:'passkey',credentialId,prfSalt}]})).prf}
 return {credentialId,prfSalt,prf};
}
