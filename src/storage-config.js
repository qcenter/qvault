export function validateStorageCredentials(value){
 if(!value||typeof value.accessKey!=='string'||!value.accessKey||typeof value.secretKey!=='string'||!value.secretKey||typeof value.region!=='string'||!/^[-a-z0-9]{1,64}$/.test(value.region)||typeof value.bucket!=='string'||!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value.bucket))throw Error('Invalid saved cloud storage settings');return value;
}
export const storageCredentialsFor=payload=>validateStorageCredentials(payload.storageCredentials||payload.credentials);
