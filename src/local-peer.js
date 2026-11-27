import {fromBase64} from './profile-crypto.js';
// Stand-in for the key service in a local-topology vault. The cloud format wraps every snapshot key
// with the local vault key first; this peer just passes that already-wrapped blob through and refuses
// anything else, so an unwrapped key can never be written to cloud storage.
export class LocalKeyPeer{
 constructor(){this.closed=false}
 async call(action,{value}={}){
  if(this.closed)throw Error('Vault locked');if(action!=='encrypt'&&action!=='decrypt')throw Error('Unsupported local key operation');
  let raw;try{raw=fromBase64(value,60)}catch{throw Error('Refusing to store an unwrapped key')}const size=raw.length;raw.fill(0);if(size!==60)throw Error('Refusing to store an unwrapped key');
  return action==='encrypt'?{CiphertextBlob:value}:{Plaintext:value};
 }
 stop(){this.closed=true}
}
