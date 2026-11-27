import {ProfileStore,acquireProfileLease} from './profile-store.js';
import {validateEnvelope,openProfile} from './profile-crypto.js';
export class SetupProfile{
 constructor({store=new ProfileStore(),lease=acquireProfileLease}={}){this.store=store;this.lease=lease;}
 async read(){const record=await this.store.read();return record?validateEnvelope(record):null}
 async backup(){const record=await this.read();if(!record)throw Error('No saved profile to back up');return JSON.stringify(record)}
 async restore(file){
  if(!file||file.size>8*1024*1024)throw Error('Choose an encrypted QVault backup smaller than 8 MB');
  const record=validateEnvelope(JSON.parse(await file.text()));const release=await this.lease();
  try{await this.store.save(record,null);return record.profileId}finally{release()}
 }
 async resetTarget(){return this.read()}
 // Proven with the recovery key, or with secret {prf} from a passkey when no recovery key is typed.
 async reset({revision,recoveryKey,confirmation,acknowledged,secret}){
  if(confirmation!=='RESET'||acknowledged!==true)throw Error('Type RESET and confirm that you understand the local data removal');
  const release=await this.lease();try{
   const record=await this.read();if(!record||record.revision!==revision)throw Error('Profile changed. Open Reset this device again and review it.');
   await openProfile(record,secret?.prf?{prf:secret.prf}:{recoveryKey});
   await this.store.reset(revision,'profile');
  }finally{release()}
 }

}
