import {createPasskeyProfile,sealProfile,openProfile,toBase64,isPasskeyProfile} from './profile-crypto.js';
import {storageCredentialsFor} from './storage-config.js';
import {VaultRuntime} from './vault-runtime.js';
import {validateProfilePayload} from './participant-state.js';
import {validateStorageCredentials} from './storage-config.js';
import {ensurePrivateBucket} from './bucket-setup.js';
import {createPasskey,passkeySecret} from './passkey.js';
export class SetupPasskeyError extends Error{}
// Opens a candidate profile exactly as an unlock would, against memory only, so a profile that cannot be reopened is never saved.
async function reopenWithRuntime({record,secret,deviceId,signal}){
 let candidate=record;const memory={read:async()=>candidate,getDeviceId:async()=>deviceId,save:async(next,expected)=>{if(candidate.revision!==expected)throw Error('Verification profile changed');candidate=next}};
 const runtime=new VaultRuntime({store:memory,lease:async()=>()=>{}}),cancel=()=>runtime.lock();signal?.addEventListener('abort',cancel,{once:true});
 try{signal?.throwIfAborted();await runtime.command({action:'unlock',prf:toBase64(secret.prf)});return await memory.read()}finally{signal?.removeEventListener('abort',cancel);runtime.lock()}
}
// First-time setup: check cloud storage, create a passkey, then save a local-topology vault profile.
// The vault key is random and lives only inside the profile; the profile opens with the passkey or the
// recovery key returned here once. No key service is involved.
export class SetupPasskeyVault{
 // hostedKey (optional): creates a QKMS key shared with the hosted service and returns {keyId,participant}; see createHostedKey.
 constructor({store,lease,ensure=ensurePrivateBucket,passkey=createPasskey,hostedKey=null,secret=slots=>passkeySecret({slots}),verify=reopenWithRuntime}){Object.assign(this,{store,lease,ensure,passkey,hostedKey,secret,verify})}
 async create({credentials,bucket,signal,qkms=false,onProgress=()=>{},onLog=()=>{}}){
  const release=await this.lease();let made=null;
  try{
   signal?.throwIfAborted();
   if(await this.store.read())throw new SetupPasskeyError('A vault profile already exists on this device. It was not changed.');
   if(qkms&&typeof this.hostedKey!=='function')throw new SetupPasskeyError('The QKMS key layer is not available here. Turn it off to continue.');
   let storage;try{storage=validateStorageCredentials({accessKey:credentials?.accessKey,secretKey:credentials?.secretKey,region:credentials?.region,bucket})}catch{throw new SetupPasskeyError('Enter the bucket name, region, access key and secret.')}
   onProgress('checking');await this.ensure({credentials:storage,bucket,signal,onProgress});signal?.throwIfAborted();
   onProgress('passkey');made=await this.passkey();signal?.throwIfAborted();
   // Optional second layer: a QKMS key split between the hosted service and this browser. It wraps what the local vault key already locked.
   let hosted=null;if(qkms){try{hosted=await this.hostedKey({credentials:storage,signal,onProgress,onLog})}catch(e){throw new SetupPasskeyError((e?.message||'The QKMS key could not be created.')+' The passkey created for this attempt is unused; you can delete “QVault vault” in your password manager.')}}
   onProgress('saving');const {handle,recoveryKey}=await createPasskeyProfile(made);
   const localBytes=crypto.getRandomValues(new Uint8Array(32)),localKey=toBase64(localBytes);localBytes.fill(0);
   const topology=hosted?'hosted':'local';
   const payload=validateProfilePayload({version:1,topology,keyId:hosted?hosted.keyId:'local',credentials:storage,participants:hosted?[hosted.participant]:[],localKey,vault:null});
   const record=await sealProfile(payload,handle);
   // Both ways in must work before anything is saved.
   for(const secret of [{prf:made.prf},{recoveryKey}]){const check=validateProfilePayload((await openProfile(record,secret)).payload);if(check.localKey!==localKey||check.topology!==topology)throw Error('Encrypted profile verification failed.')}
   signal?.throwIfAborted();await this.store.save(record,null);
   onProgress('vault-created');return {recoveryKey,profileId:record.profileId};
  }finally{made?.prf?.fill(0);release()}
 }
 // Replace the cloud access details of a passkey vault. The passkey is asked first; the vault is reopened with the
 // new details before the saved profile is replaced. Blank access key and secret, bucket or region keep the saved value.
 async updateStorage({credentials,bucket,signal,onProgress=()=>{}}){
  const release=await this.lease();let secret=null;
  try{
   signal?.throwIfAborted();const record=await this.store.read();
   if(!record||!isPasskeyProfile(record))throw new SetupPasskeyError('There is no passkey vault on this device.');
   onProgress('passkey-confirm');secret=await this.secret(record.slots);signal?.throwIfAborted();
   let opened;try{opened=await openProfile(record,{prf:secret.prf})}catch{throw new SetupPasskeyError('This passkey does not open the saved vault. Nothing was changed.')}
   const payload=validateProfilePayload(opened.payload);if(payload.sync?.pending)throw new SetupPasskeyError('Finish pending vault changes before updating storage settings.');
   const old=storageCredentialsFor(payload);
   if(!!credentials?.accessKey!==!!credentials?.secretKey)throw new SetupPasskeyError('Enter both the new access key and secret, or leave both blank to keep the saved pair.');
   let next;try{next=validateStorageCredentials({accessKey:credentials.accessKey||old.accessKey,secretKey:credentials.secretKey||old.secretKey,region:credentials.region||old.region,bucket:bucket||old.bucket})}catch{throw new SetupPasskeyError('Enter a valid bucket name and region.')}
   if((payload.vault||payload.sync?.generation)&&(next.bucket!==old.bucket||next.region!==old.region))throw new SetupPasskeyError('This vault already has cloud data. Keep its existing bucket and region; changing them requires a separate data migration.');
   onProgress('checking');await this.ensure({credentials:next,bucket:next.bucket,signal,onProgress});signal?.throwIfAborted();
   const updated={...payload,credentials:next};delete updated.storageCredentials;
   let candidate=await sealProfile(validateProfilePayload(updated),opened.handle);
   onProgress('reopening');try{candidate=await this.verify({record:candidate,secret,deviceId:await this.store.getDeviceId(),signal})}catch{throw new SetupPasskeyError('The vault could not be reopened with these storage details. Your saved profile was not replaced. Check the access key and bucket, then try again.')}
   const check=validateProfilePayload((await openProfile(candidate,{prf:secret.prf})).payload);if(candidate.profileId!==record.profileId||check.keyId!==payload.keyId||check.localKey!==payload.localKey)throw Error('Verification changed the vault identity');
   signal?.throwIfAborted();onProgress('saving');await this.store.save(candidate,record.revision);
   onProgress('profile-saved');return {profileSaved:true};
  }finally{secret?.prf?.fill(0);release()}
 }
}
