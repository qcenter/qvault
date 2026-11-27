import {validateStorageCredentials} from './storage-config.js';
import {fromBase64,toBase64} from './profile-crypto.js';
export function validateParticipantState(state,keyId){
 if(!state||state.version!==1||state.keyId!==keyId||typeof keyId!=='string'||!/^[A-Za-z0-9_:/.-]{1,256}$/.test(keyId)||!/^[a-f0-9]{32}$/.test(state.sidecarId)||!Array.isArray(state.entries)||state.entries.length!==2)throw Error('Invalid saved participant');
 const map=new Map();for(const pair of state.entries){if(!Array.isArray(pair)||pair.length!==2||!['identity','keyshare/'+keyId].includes(pair[0])||map.has(pair[0]))throw Error('Invalid saved participant entries');map.set(pair[0],fromBase64(pair[1],65536))}
 const identity=JSON.parse(new TextDecoder().decode(map.get('identity'))),share=JSON.parse(new TextDecoder().decode(map.get('keyshare/'+keyId)));
 if(identity.sidecarId!==state.sidecarId)throw Error('Saved participant identity mismatch');
 for(const field of ['identityPrivateX448','identityPublicX448','signedPreKeyPrivateX448','signedPreKeyPublicX448','signingPrivateEd448','signingPublicEd448','preKeySignature'])if(typeof identity[field]!=='string'||!/^([a-f0-9]{2}){32,128}$/.test(identity[field]))throw Error('Incomplete saved participant identity');
 if(fromBase64(share.n,512).length!==256||fromBase64(share.e,8).length===0||fromBase64(share.dShare,2048).length===0)throw Error('Invalid saved RSA share');
 return map;
}
export async function exportParticipant(storage,sidecarId,keyId){
 const entries=[];for(const k of ['identity','keyshare/'+keyId]){const bytes=await storage.get(k);if(!bytes)throw Error('Participant share is not ready for protected saving');entries.push([k,toBase64(bytes)])}
 const state={version:1,sidecarId,keyId,entries};validateParticipantState(state,keyId);return state;
}
export function validateProfilePayload(payload){
 if(!payload||payload.version!==1||typeof payload.credentials?.accessKey!=='string'||!payload.credentials.accessKey||typeof payload.credentials?.secretKey!=='string'||!payload.credentials.secretKey||typeof payload.credentials.region!=='string'||!/^[-a-z0-9]{1,64}$/.test(payload.credentials.region)||typeof payload.credentials.bucket!=='string'||!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(payload.credentials.bucket)||!Array.isArray(payload.participants))throw Error('Invalid protected profile payload');
 // 'hosted': the QKMS service holds one key share and this profile the other. Without it: both shares are local.
 // 'local': no key service at all; the local vault key is the only key and is therefore mandatory.
 if((payload.topology!==undefined&&!['hosted','local'].includes(payload.topology))||payload.participants.length!==({hosted:1,local:0}[payload.topology]??2))throw Error('Invalid protected profile payload');
 if(payload.topology==='local'&&(payload.keyId!=='local'||payload.localKey===undefined))throw Error('Invalid protected profile payload');
 for(const p of payload.participants)validateParticipantState(p,payload.keyId);
 if(new Set(payload.participants.map(p=>p.sidecarId)).size!==payload.participants.length)throw Error('Duplicate participant identity');
 if(payload.storageCredentials)validateStorageCredentials(payload.storageCredentials);
 if(payload.localKey!==undefined){let raw;try{raw=fromBase64(payload.localKey,32)}catch{throw Error('Invalid protected profile payload')}const size=raw.length;raw.fill(0);if(size!==32)throw Error('Invalid protected profile payload')}
 return payload;
}
