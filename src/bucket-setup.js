import {BucketSetupError} from './bucket-help.js';
import {AwsClient} from 'aws4fetch';
export function validateBucketName(bucket){
 if(typeof bucket!=='string'||!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)||/\.\.|\.-|-\./.test(bucket)||/^\d+\.\d+\.\d+\.\d+$/.test(bucket))throw new BucketSetupError('invalid-name','Enter a bucket name, 3–63 lowercase letters/numbers, dots or hyphens. Do not enter a URL or path.');return bucket;
}
async function errorCode(response){const text=await response.text();if(text.length>8192)return '';const xml=text.match(/<Code>\s*([A-Za-z0-9]{1,80})\s*<\/Code>/);if(xml)return xml[1];try{const json=JSON.parse(text);const value=json.Code||json.code;return typeof value==='string'&&/^[A-Za-z0-9]{1,80}$/.test(value)?value:''}catch{return ''}}
export async function ensurePrivateBucket({credentials,bucket,signal,onProgress=()=>{},client}){
 validateBucketName(bucket);if(!credentials?.accessKey||!credentials.secretKey||!/^[-a-z0-9]{1,64}$/.test(credentials.region||''))throw new BucketSetupError('credentials','Enter your access key, secret key and region');
 const api=client||new AwsClient({accessKeyId:credentials.accessKey,secretAccessKey:credentials.secretKey,service:'s3',region:credentials.region,retries:0});const url='https://qstorage.quilibrium.com/'+bucket;
 const request=(method,options={})=>api.fetch(url,{method,redirect:'error',cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000),...options});
 const accessError=status=>new BucketSetupError('inspect-denied','QStorage access denied (HTTP '+status+'). Check the access key and bucket permissions. No bucket was created.',status);
 onProgress('checking');let head=await request('HEAD');if(head.status===200){onProgress('existing');return {bucket,created:false,ready:true}}
 if([401,403].includes(head.status))throw accessError(head.status);if(head.status!==404)throw new BucketSetupError('check-failed','Could not check QStorage bucket (HTTP '+head.status+'). No bucket was created.',head.status);
 onProgress('creating');let response;
 try{response=await request('PUT',{headers:{'Content-Type':'application/xml','x-amz-acl':'private'},body:'<CreateBucketConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"></CreateBucketConfiguration>'})}
 catch(e){if(signal?.aborted)throw e;try{head=await request('HEAD');if(head.status===200){onProgress('available');return {bucket,created:false,ready:true,creationOutcome:'unconfirmed'}}}catch{}throw new BucketSetupError('unconfirmed','The bucket creation response was lost or timed out. Creation is not confirmed. Check the same bucket again; no automatic creation retry was made.')}
 let created=response.ok;
 if(!created){
  const code=await errorCode(response);
  if(response.status===401||['SignatureDoesNotMatch','InvalidAccessKeyId','InvalidToken','ExpiredToken','AuthorizationHeaderMalformed'].includes(code))throw new BucketSetupError('authentication','QStorage could not authenticate the access key.',response.status);
  if(code==='RequestTimeTooSkewed')throw new BucketSetupError('clock','Device clock check failed.',response.status);
  if(response.status===403)throw new BucketSetupError('create-denied','QStorage denied bucket creation. The access key needs bucket creation permission.',response.status);
  if(code==='TooManyBuckets')throw new BucketSetupError('quota','Account bucket limit reached.',response.status);
  if(response.status===409&&code==='BucketAlreadyOwnedByYou'){created=false}
  else if(response.status===409&&code==='BucketAlreadyExists')throw new BucketSetupError('name-taken','This bucket name is already taken. Choose another name; the existing bucket was not changed.');
  else throw new BucketSetupError('create-failed','Could not create QStorage bucket (HTTP '+response.status+'). No existing bucket settings were changed.',response.status);
 }
 onProgress('verifying');head=await request('HEAD');if(head.status!==200)throw new BucketSetupError('verify-denied','Bucket creation was accepted, but access could not be verified (HTTP '+head.status+'). Check the same bucket again.',head.status);
 onProgress(created?'created':'existing');return {bucket,created,ready:true};
}
