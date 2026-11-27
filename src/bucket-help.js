const help={
 'create-denied':{title:'Bucket creation is not allowed',steps:['Give this access key permission to create buckets in QConsole, then try again.','Alternatively, create a private bucket manually in QConsole → Services → QStorage → Create Bucket. Enter the same bucket name here afterwards.']},
 'inspect-denied':{title:'QVault cannot check this bucket',steps:['Check the access key and secret, and make sure they belong to the intended QConsole account.','Allow this key to inspect the bucket. No creation request was sent. You can also check the bucket manually in QConsole.']},
 'authentication':{title:'QStorage could not verify your access details',steps:['Check that the access key ID and secret key were copied correctly and are still active.','Use a QConsole access key and its secret, not a browser Client API Key. Changing bucket permissions will not fix incorrect credentials.']},
 'clock':{title:'The device time could not be verified',steps:['Enable automatic date and time on this device, then try again.']},
 'name-taken':{title:'This bucket name is already taken',steps:['Choose a different, unique name, for example a name beginning with your own project name.','No existing bucket or its settings were changed.']},
 'unconfirmed':{title:'Bucket creation could not be confirmed',steps:['Check the same bucket in QConsole before starting again. It may already have been created.','No automatic creation retry was made. Check your connection, then try the same name again.']},
 'verify-denied':{title:'The bucket was accepted, but access is not confirmed',steps:['Check the same bucket in QConsole. Do not create another name just to retry.','Allow this access key to inspect the bucket, then check it again here.']},
 'invalid-name':{title:'Check the bucket name',steps:['Enter only the name: 3–63 lowercase letters, numbers, dots or hyphens. Do not enter a URL or folder path.','The name must not look like an IP address or contain consecutive dots.']},
 'credentials':{title:'Access details are missing',steps:['Enter the access key, secret key and region from QConsole.']},
 'quota':{title:'The account cannot create more buckets',steps:['Check the account’s bucket limit in QConsole, or ask the account administrator. An existing private bucket can be used instead.']},
 'check-failed':{title:'QStorage could not be checked',steps:['Check your connection and the region setting, then try again.','No bucket creation request was sent. If the service is unavailable, try later.']},
 'create-failed':{title:'The bucket could not be created',steps:['Check the bucket name, region and access permissions in QConsole.','You can create a private bucket manually in QConsole and then check it here.']}
};
export class BucketSetupError extends Error{constructor(code,message,status){super(message);this.name='BucketSetupError';this.code=code;this.status=status}}
export function bucketHelp(error){
 const known=error instanceof BucketSetupError?help[error.code]:null;
 if(known)return {...known,reference:error.status?'Service response: HTTP '+error.status:''};
 return {title:/Abort|Timeout/.test(error?.name||'')?'QStorage did not respond in time':'Cloud storage could not be prepared',steps:['Check your connection and try again.','If creation had already started, check the same bucket in QConsole first; its outcome may be unknown.'],reference:''};
}
