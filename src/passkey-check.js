// Diagnostic: can this browser give the extension a stable passkey secret (WebAuthn PRF)?
// Creates one test passkey and uses it twice. The secret is compared in memory, zeroed, and never returned or logged.
const bytes=n=>crypto.getRandomValues(new Uint8Array(n));
const errorName=e=>typeof e?.name==='string'&&/^[A-Za-z]{1,40}$/.test(e.name)?e.name:'Error';
export async function checkPasskeyPrf({container=globalThis.navigator?.credentials,onStep=()=>{}}={}){
 const fail=(reason,detail='')=>({supported:false,reason,detail});
 if(typeof container?.create!=='function'||typeof container?.get!=='function')return fail('unavailable');
 const stopped=e=>e?.name==='NotAllowedError'?fail('cancelled'):fail('failed',errorName(e));
 const salt=bytes(32);let created;
 onStep('create');
 try{created=await container.create({publicKey:{rp:{name:'QVault'},user:{id:bytes(16),name:'QVault passkey check',displayName:'QVault passkey check'},challenge:bytes(32),pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257}],authenticatorSelection:{residentKey:'preferred',userVerification:'required'},timeout:120000,extensions:{prf:{}}}})}catch(e){return stopped(e)}
 if(!created?.rawId)return fail('failed','NoCredential');
 const enabledAtCreation=created.getClientExtensionResults?.().prf?.enabled===true;
 const use=async()=>{const assertion=await container.get({publicKey:{challenge:bytes(32),allowCredentials:[{type:'public-key',id:created.rawId}],userVerification:'required',timeout:120000,extensions:{prf:{eval:{first:salt}}}}});const first=assertion?.getClientExtensionResults?.().prf?.results?.first;return first?new Uint8Array(first.buffer?first.buffer.slice(first.byteOffset,first.byteOffset+first.byteLength):first.slice(0)):null};
 let one=null,two=null;
 try{
  onStep('use-1');one=await use();if(!one||one.length<32)return fail('no-secret');
  onStep('use-2');two=await use();if(!two||two.length!==one.length)return fail('no-secret');
  if(!one.every((b,i)=>b===two[i]))return fail('unstable');
  return {supported:true,bytes:one.length,enabledAtCreation,authenticator:typeof created.authenticatorAttachment==='string'?created.authenticatorAttachment.slice(0,40):'unknown'};
 }catch(e){return stopped(e)}finally{one?.fill(0);two?.fill(0);salt.fill(0)}
}
export function passkeyCheckMessage(result){
 if(result?.supported)return 'Passed: this browser can unlock QVault with a passkey. It returned the same '+result.bytes+'-byte secret both times ('+(result.authenticator==='platform'?'built-in authenticator such as Touch ID':result.authenticator==='cross-platform'?'external security key or phone':'authenticator type not reported')+'). You can delete the test passkey "QVault passkey check" in your password manager.';
 switch(result?.reason){
  case 'unavailable':return 'Not available: this browser does not offer passkeys to the extension.';
  case 'cancelled':return 'The check was cancelled or timed out before finishing. Nothing was changed in QVault.';
  case 'no-secret':return 'Not supported: the passkey was created, but this authenticator does not provide the secret QVault needs (WebAuthn PRF). Try a different passkey provider when prompted. QVault cannot be used with this one.';
  case 'unstable':return 'Not usable: the passkey returned a different secret the second time, so it cannot protect a vault.';
  default:return 'The passkey check failed ('+(result?.detail||'Error')+'). Nothing was changed in QVault.';
 }
}
