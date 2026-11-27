import {AwsClient} from 'aws4fetch';
// Experimental check for instant sync: can this account publish to QPing (SNS-compatible) and receive through QQ (SQS-compatible)?
// It creates one temporary topic and one temporary queue, sends one message through them and removes both again.
// Requests go only to the two fixed service hosts. Nothing from a vault is sent.
export const NOTIFY_HOSTS={sns:'https://qping.quilibrium.com/',sqs:'https://qq.quilibrium.com/'};
const tag=(xml,name)=>{const m=new RegExp('<'+name+'>([^<]*)</'+name+'>').exec(xml);return m?m[1].replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"'):null};
const reason=(status,text)=>{let code=tag(text,'Code'),message=tag(text,'Message');if(!code){try{const j=JSON.parse(text);code=String(j.__type||j.code||j.Code||'').split('#').pop();message=j.message||j.Message||null}catch{}}return 'HTTP '+status+(code?' '+code.slice(0,80):'')+(message?': '+String(message).slice(0,200):'')};
class StepError extends Error{}
export async function runNotifyCheck({credentials,log=()=>{},fetchImpl=(...a)=>fetch(...a),name='qvault-check-'+crypto.randomUUID().slice(0,8),waitSeconds=10,attempts=3,now=()=>Date.now()}={}){
 const {accessKey,secretKey,region='q-world-1'}=credentials||{};if(!accessKey||!secretKey)throw Error('Enter the access key ID and the secret access key');
 // Services that check signatures themselves can be particular about two things: the region in the signature and whether
 // the content type is part of it. The first read-only question tries the combinations and the rest of the run uses the one that works.
 const clients=new Map(),clientFor=(service,r)=>{const k=service+'/'+r;if(!clients.has(k))clients.set(k,new AwsClient({accessKeyId:accessKey,secretAccessKey:secretKey,service,region:r,retries:0}));return clients.get(k)};
 const variants=[...new Set([region,'us-east-1'])].flatMap(r=>[{region:r,contentType:false},{region:r,contentType:true}]),chosen={sns:null,sqs:null};
 async function send(service,url,headers,body,variant){const v=variant||chosen[service]||variants[0];const request=await clientFor(service,v.region).sign(url,{method:'POST',headers,body,aws:{allHeaders:v.contentType}});const r=await fetchImpl(request);return {ok:r.ok,status:r.status,text:await r.text()}}
 const sns=async(action,params,variant)=>{const r=await send('sns',NOTIFY_HOSTS.sns,{'Content-Type':'application/x-www-form-urlencoded'},new URLSearchParams({Action:action,Version:'2010-03-31',...params}).toString(),variant);if(!r.ok)throw new StepError(reason(r.status,r.text));return r.text};
 let protocol=null;
 const sqsJson=async(action,input,variant)=>{const r=await send('sqs',NOTIFY_HOSTS.sqs,{'Content-Type':'application/x-amz-json-1.0','X-Amz-Target':'AmazonSQS.'+action},JSON.stringify(input),variant);if(!r.ok)throw new StepError(reason(r.status,r.text));try{return r.text?JSON.parse(r.text):{}}catch{throw new StepError('unexpected answer')}};
 const sqsQuery=async(action,params,variant)=>{const r=await send('sqs',NOTIFY_HOSTS.sqs,{'Content-Type':'application/x-www-form-urlencoded'},new URLSearchParams({Action:action,Version:'2012-11-05',...params}).toString(),variant);if(!r.ok)throw new StepError(reason(r.status,r.text));return r.text};
 const describe=v=>'for region '+v.region+(v.contentType?', content type included':', content type left out');
 // Try a read-only call each way; remember the first that the service accepts.
 async function settle(service,label,attempt){let last=null;for(const v of variants){try{await attempt(v);chosen[service]=v;log(label+' accepts requests signed '+describe(v));return}catch(e){if(!(e instanceof StepError))throw e;last=e}}throw new StepError('tried '+variants.length+' ways of signing, the last answer was '+last.message)}
 // One queue API, two wire formats: current AWS tools speak JSON, older ones the form format. The first call finds out which one the service answers.
 const queue={
  async create(queueName){if(protocol==='query'){const url=tag(await sqsQuery('CreateQueue',{QueueName:queueName}),'QueueUrl');if(!url)throw new StepError('no queue address');return url}try{const j=await sqsJson('CreateQueue',{QueueName:queueName});if(!j.QueueUrl)throw new StepError('no queue address');protocol='json';return j.QueueUrl}catch(first){try{const url=tag(await sqsQuery('CreateQueue',{QueueName:queueName}),'QueueUrl');if(!url)throw new StepError('no queue address');protocol='query';return url}catch(second){throw new StepError('JSON format: '+first.message+'; form format: '+second.message)}}},
  async arn(url){if(protocol==='json')return (await sqsJson('GetQueueAttributes',{QueueUrl:url,AttributeNames:['QueueArn']})).Attributes?.QueueArn;return tag(await sqsQuery('GetQueueAttributes',{QueueUrl:url,'AttributeName.1':'QueueArn'}),'Value')},
  async allow(url,policy){if(protocol==='json')return sqsJson('SetQueueAttributes',{QueueUrl:url,Attributes:{Policy:policy}});return sqsQuery('SetQueueAttributes',{QueueUrl:url,'Attribute.1.Name':'Policy','Attribute.1.Value':policy})},
  async receive(url){if(protocol==='json')return ((await sqsJson('ReceiveMessage',{QueueUrl:url,WaitTimeSeconds:waitSeconds,MaxNumberOfMessages:10})).Messages||[]).map(m=>({body:m.Body,handle:m.ReceiptHandle}));const xml=await sqsQuery('ReceiveMessage',{QueueUrl:url,WaitTimeSeconds:String(waitSeconds),MaxNumberOfMessages:'10'});return [...xml.matchAll(/<Message>([\s\S]*?)<\/Message>/g)].map(m=>({body:tag(m[1],'Body'),handle:tag(m[1],'ReceiptHandle')}))},
  async remove(url){if(protocol==='json')return sqsJson('DeleteQueue',{QueueUrl:url});return sqsQuery('DeleteQueue',{QueueUrl:url})}
 };
 const result={ok:false,protocol:null,delivered:false,delayMs:null,failedAt:null,signing:chosen};let topicArn=null,queueUrl=null,subscriptionArn=null;
 const step=async(label,fn,{optional=false}={})=>{try{const value=await fn();log(label+': ok');return value}catch(e){const why=e instanceof StepError?e.message:'no answer ('+(e?.message||'network error').slice(0,80)+')';log(label+': '+(optional?'skipped, ':'failed, ')+why);if(optional)return null;result.failedAt??=label;throw e}};
 try{
  // Two read-only questions first: they change nothing and show whether each service accepts this key at all.
  await step('Ask QPing for its topic list',()=>settle('sns','QPing',v=>sns('ListTopics',{},v)),{optional:true});
  await step('Ask QQ for its queue list',()=>settle('sqs','QQ',async v=>{try{await sqsJson('ListQueues',{},v);protocol='json'}catch(first){if(!(first instanceof StepError))throw first;try{await sqsQuery('ListQueues',{},v);protocol='query'}catch(second){if(!(second instanceof StepError))throw second;throw new StepError('JSON format: '+first.message+'; form format: '+second.message)}}}),{optional:true});
  topicArn=await step('Create a temporary topic in QPing',async()=>{const arn=tag(await sns('CreateTopic',{Name:name}),'TopicArn');if(!arn)throw new StepError('no topic address');return arn});
  queueUrl=await step('Create a temporary queue in QQ',()=>queue.create(name));result.protocol=protocol;log('QQ answers in the '+(protocol==='json'?'JSON':'form')+' format');
  const queueArn=await step('Read the queue address',async()=>{const arn=await queue.arn(queueUrl);if(!arn)throw new StepError('no queue address');return arn});
  await step('Allow the topic to write to the queue',()=>queue.allow(queueUrl,JSON.stringify({Version:'2012-10-17',Statement:[{Effect:'Allow',Principal:{Service:'sns.amazonaws.com'},Action:'sqs:SendMessage',Resource:queueArn,Condition:{ArnEquals:{'aws:SourceArn':topicArn}}}]})),{optional:true});
  subscriptionArn=await step('Subscribe the queue to the topic',async()=>tag(await sns('Subscribe',{TopicArn:topicArn,Protocol:'sqs',Endpoint:queueArn,ReturnSubscriptionArn:'true'}),'SubscriptionArn'));
  const token='qvault-check-'+crypto.randomUUID(),sent=now();
  await step('Publish a test message',()=>sns('Publish',{TopicArn:topicArn,Message:token}));
  await step('Receive it through the queue',async()=>{for(let i=0;i<attempts;i++){const messages=await queue.receive(queueUrl);if(messages.some(m=>String(m.body||'').includes(token))){result.delivered=true;result.delayMs=now()-sent;return}}throw new StepError('nothing arrived within '+attempts*waitSeconds+' seconds')});
  result.ok=true;
 }catch{}
 finally{
  // Always tidy up what was created, whatever happened above.
  if(subscriptionArn&&subscriptionArn.startsWith('arn:'))await step('Remove the subscription',()=>sns('Unsubscribe',{SubscriptionArn:subscriptionArn}),{optional:true});
  if(queueUrl)await step('Remove the temporary queue',()=>queue.remove(queueUrl),{optional:true});
  if(topicArn)await step('Remove the temporary topic',()=>sns('DeleteTopic',{TopicArn:topicArn}),{optional:true});
 }
 return result;
}
export function notifyCheckMessage(r){if(r.ok)return 'Passed: a message published to QPing arrived through QQ in about '+Math.max(1,Math.round(r.delayMs/1000))+' s. Instant sync between computers is possible with this account. The temporary topic and queue were removed.';return 'Not passed. Stopped at: '+(r.failedAt||'start')+'. See the steps below; copy them if you report this. Anything that was created has been removed where possible.'}
