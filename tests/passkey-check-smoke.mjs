import assert from 'node:assert/strict';
import {checkPasskeyPrf,passkeyCheckMessage} from '../src/passkey-check.js';
// Synthetic authenticator. The check must report support without ever returning the secret.
const SECRET=Uint8Array.from({length:32},(_,i)=>i+1);
function authenticator({prf=true,enabled=true,stable=true,short=false,cancelAt=null,createError=null}={}){
 const calls=[];let gets=0;
 return {calls,create:async options=>{calls.push(['create',options]);if(cancelAt==='create')throw Object.assign(Error('cancel'),{name:'NotAllowedError'});if(createError)throw Object.assign(Error('private detail /Users/someone'),{name:createError});return {rawId:Uint8Array.of(9,9,9).buffer,authenticatorAttachment:'platform',getClientExtensionResults:()=>prf?{prf:{enabled}}:{}}},
  get:async options=>{calls.push(['get',options]);gets++;if(cancelAt==='get')throw Object.assign(Error('cancel'),{name:'NotAllowedError'});const out=Uint8Array.from(SECRET);if(!stable&&gets===2)out[0]^=1;return {getClientExtensionResults:()=>prf?{prf:{results:{first:(short?out.slice(0,16):out).buffer}}}:{}}}};
}
const leaks=value=>JSON.stringify(value,(k,v)=>v instanceof Uint8Array?Array.from(v):v).includes(JSON.stringify(Array.from(SECRET)).slice(1,40));
{
 const a=authenticator(),steps=[],result=await checkPasskeyPrf({container:a,onStep:s=>steps.push(s)});
 assert.deepEqual(result,{supported:true,bytes:32,enabledAtCreation:true,authenticator:'platform'});assert.ok(!leaks(result));assert.deepEqual(steps,['create','use-1','use-2']);
 const create=a.calls[0][1].publicKey;assert.equal(create.rp.name,'QVault');assert.equal(create.rp.id,undefined);assert.equal(create.authenticatorSelection.userVerification,'required');assert.deepEqual(create.extensions,{prf:{}});assert.equal(create.user.id.length,16);assert.equal(create.challenge.length,32);
 const gets=a.calls.filter(c=>c[0]==='get').map(c=>c[1].publicKey);assert.equal(gets.length,2);
 for(const g of gets){assert.equal(g.userVerification,'required');assert.equal(g.allowCredentials.length,1);assert.equal(g.extensions.prf.eval.first.length,32)}
 assert.deepEqual(Array.from(gets[0].extensions.prf.eval.first),Array.from(gets[1].extensions.prf.eval.first));assert.notDeepEqual(Array.from(gets[0].challenge),Array.from(gets[1].challenge));
 assert.match(passkeyCheckMessage(result),/can unlock QVault with a passkey/);
}
// Some authenticators only reveal support when the passkey is used.
assert.equal((await checkPasskeyPrf({container:authenticator({enabled:false})})).supported,true);
for(const [options,reason,text]of [[{prf:false},'no-secret',/does not provide the secret/],[{stable:false},'unstable',/different secret/],[{short:true},'no-secret',/does not provide the secret/],[{cancelAt:'create'},'cancelled',/cancelled/],[{cancelAt:'get'},'cancelled',/cancelled/],[{createError:'SecurityError'},'failed',/SecurityError/]]){
 const result=await checkPasskeyPrf({container:authenticator(options)});assert.equal(result.supported,false);assert.equal(result.reason,reason);assert.ok(!leaks(result));assert.match(passkeyCheckMessage(result),text);assert.ok(!passkeyCheckMessage(result).includes('/Users/'));
}
for(const container of [undefined,null,{},{create(){}}]){const result=await checkPasskeyPrf({container});assert.equal(result.reason,'unavailable');assert.match(passkeyCheckMessage(result),/does not offer passkeys/)}
console.log('PASS LOCAL: the passkey check asks for one creation and two uses with the same salt, requires user verification, reports support only for a stable 32-byte secret, distinguishes missing support, instability, cancellation and failure, and never returns the secret or raw error text. Synthetic authenticator only.');
