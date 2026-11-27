import assert from 'node:assert/strict';
import {runNotifyCheck,notifyCheckMessage,NOTIFY_HOSTS} from '../src/notify-check.js';
// Experimental QPing + QQ check against a stand-in for SNS and SQS. Fictional credentials; no network.
const credentials={accessKey:'FICTIONAL_ACCESS',secretKey:'FICTIONAL_SECRET_KEY',region:'q-world-1'};
function service({sqsFormat='json',deny=null,deliver=true,strict=null}={}){
 const calls=[],topics=new Map(),queues=new Map();let subscriptions=new Map();
 const xml=(name,inner)=>new Response('<'+name+'Response><'+name+'Result>'+inner+'</'+name+'Result></'+name+'Response>',{status:200});
 const fetchImpl=async request=>{
  const url=request.url,body=await request.text(),target=request.headers.get('x-amz-target'),type=request.headers.get('content-type');
  assert.ok(url===NOTIFY_HOSTS.sns||url===NOTIFY_HOSTS.sqs,'requests go only to the two service hosts: '+url);assert.match(request.headers.get('authorization')||'',/^AWS4-HMAC-SHA256 /);assert.ok(!body.includes(credentials.secretKey));
  // A stricter service: it only accepts one way of signing, like a service that rebuilds the signature itself.
  if(strict){const auth=request.headers.get('authorization');if(!auth.includes('/'+strict.region+'/')||auth.includes('SignedHeaders=content-type;')!==strict.contentType){calls.push('refused');return new Response('<ErrorResponse><Error><Code>SignatureDoesNotMatch</Code><Message>Signature verification failed</Message></Error></ErrorResponse>',{status:403})}}
  if(url===NOTIFY_HOSTS.sns){const p=new URLSearchParams(body),action=p.get('Action');calls.push('sns:'+action);if(deny===action)return new Response('<ErrorResponse><Error><Code>AuthorizationError</Code></Error></ErrorResponse>',{status:403});
   if(action==='ListTopics')return xml(action,'<Topics></Topics>');
   if(action==='CreateTopic'){const arn='arn:aws:sns:q-world-1:000000000000:'+p.get('Name');topics.set(arn,true);return xml(action,'<TopicArn>'+arn+'</TopicArn>')}
   if(action==='Subscribe'){const arn=p.get('TopicArn')+':sub';subscriptions.set(arn,p.get('Endpoint'));return xml(action,'<SubscriptionArn>'+arn+'</SubscriptionArn>')}
   if(action==='Publish'){if(deliver)for(const endpoint of subscriptions.values())for(const q of queues.values())if(q.arn===endpoint)q.messages.push({Body:JSON.stringify({Type:'Notification',Message:p.get('Message')}),ReceiptHandle:'h'});return xml(action,'<MessageId>m</MessageId>')}
   if(action==='Unsubscribe'){subscriptions.delete(p.get('SubscriptionArn'));return xml(action,'')}
   if(action==='DeleteTopic'){topics.delete(p.get('TopicArn'));return xml(action,'')}
   return new Response('',{status:400})}
  const json=type==='application/x-amz-json-1.0';if(json!==(sqsFormat==='json')){calls.push('sqs:wrong-format');return new Response(json?'<ErrorResponse><Error><Code>InvalidAction</Code></Error></ErrorResponse>':'{"__type":"com.amazonaws.sqs#InvalidAction"}',{status:400})}
  const input=json?JSON.parse(body):Object.fromEntries(new URLSearchParams(body)),action=json?target.split('.').pop():input.Action;calls.push('sqs:'+action);if(deny===action)return new Response(json?'{"__type":"com.amazonaws.sqs#AccessDenied"}':'<ErrorResponse><Error><Code>AccessDenied</Code></Error></ErrorResponse>',{status:403});
  const answer=(o,x)=>json?new Response(JSON.stringify(o),{status:200}):xml(action,x);
  if(action==='ListQueues')return answer({QueueUrls:[]},'');
  if(action==='CreateQueue'){const u='https://qq.quilibrium.com/000000000000/'+input.QueueName;queues.set(u,{arn:'arn:aws:sqs:q-world-1:000000000000:'+input.QueueName,messages:[]});return answer({QueueUrl:u},'<QueueUrl>'+u+'</QueueUrl>')}
  const q=queues.get(input.QueueUrl);if(!q)return new Response('',{status:400});
  if(action==='GetQueueAttributes')return answer({Attributes:{QueueArn:q.arn}},'<Attribute><Name>QueueArn</Name><Value>'+q.arn+'</Value></Attribute>');
  if(action==='SetQueueAttributes')return answer({},'');
  if(action==='ReceiveMessage'){const m=q.messages.splice(0);return answer({Messages:m},m.map(x=>'<Message><Body>'+x.Body.replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'</Body><ReceiptHandle>'+x.ReceiptHandle+'</ReceiptHandle></Message>').join(''))}
  if(action==='DeleteQueue'){queues.delete(input.QueueUrl);return answer({},'')}
  return new Response('',{status:400})};
 return {fetchImpl,calls,left:()=>topics.size+queues.size+subscriptions.size};
}
for(const sqsFormat of ['json','query']){
 const s=service({sqsFormat}),lines=[];const r=await runNotifyCheck({credentials,fetchImpl:s.fetchImpl,log:l=>lines.push(l),waitSeconds:1});
 assert.equal(r.ok,true,lines.join('\n'));assert.equal(r.delivered,true);assert.equal(r.protocol,sqsFormat);assert.equal(s.left(),0,'topic, queue and subscription are removed again');
 assert.match(notifyCheckMessage(r),/^Passed/);assert.ok(lines.every(l=>!l.includes(credentials.secretKey)&&!l.includes(credentials.accessKey)),'the log never shows credentials');
}
{const s=service({deliver:false}),lines=[];const r=await runNotifyCheck({credentials,fetchImpl:s.fetchImpl,log:l=>lines.push(l),waitSeconds:1,attempts:2});
 assert.equal(r.ok,false);assert.equal(r.failedAt,'Receive it through the queue');assert.equal(s.left(),0,'cleanup runs after a failure too');assert.match(notifyCheckMessage(r),/Not passed/);assert.ok(lines.some(l=>/nothing arrived/.test(l)))}
{const s=service({deny:'CreateQueue'}),lines=[];const r=await runNotifyCheck({credentials,fetchImpl:s.fetchImpl,log:l=>lines.push(l),waitSeconds:1});
 assert.equal(r.ok,false);assert.equal(r.failedAt,'Create a temporary queue in QQ');assert.ok(lines.some(l=>/AccessDenied/.test(l)));assert.equal(s.left(),0);assert.ok(!s.calls.includes('sns:Publish'))}
{const s=service({deny:'CreateTopic'});const r=await runNotifyCheck({credentials,fetchImpl:s.fetchImpl,waitSeconds:1});assert.equal(r.failedAt,'Create a temporary topic in QPing');assert.deepEqual(s.calls.filter(c=>c!=='sqs:wrong-format'),['sns:ListTopics','sqs:ListQueues','sns:CreateTopic'],'only the two read-only questions come first; nothing needs removing')}
{// The service's own explanation is shown, because the error code alone often does not say enough.
 const lines=[];await runNotifyCheck({credentials,waitSeconds:1,log:l=>lines.push(l),fetchImpl:async()=>new Response('<ErrorResponse><Error><Code>AuthorizationError</Code><Message>FICTIONAL reason from the service</Message></Error></ErrorResponse>',{status:403})});assert.ok(lines.some(l=>/Ask QPing for its topic list: skipped, .*HTTP 403 AuthorizationError: FICTIONAL reason from the service/.test(l)),lines.join('|'));assert.ok(lines.some(l=>/4 ways of signing/.test(l)),lines.join('|'));assert.ok(lines.some(l=>/Ask QQ for its queue list: skipped/.test(l)))}
for(const strict of [{region:'us-east-1',contentType:true},{region:'q-world-1',contentType:true},{region:'us-east-1',contentType:false}]){const s=service({strict}),lines=[];const r=await runNotifyCheck({credentials,fetchImpl:s.fetchImpl,log:l=>lines.push(l),waitSeconds:1});assert.equal(r.ok,true,lines.join('\n'));assert.deepEqual(r.signing.sns,{region:strict.region,contentType:strict.contentType});assert.deepEqual(r.signing.sqs,{region:strict.region,contentType:strict.contentType});assert.ok(lines.some(l=>l.includes('QPing accepts requests signed for region '+strict.region)),lines.join('|'));assert.equal(s.left(),0)}
await assert.rejects(()=>runNotifyCheck({credentials:{accessKey:'',secretKey:''}}),/Enter the access key/);
console.log('PASS LOCAL: the experimental QPing + QQ check creates a temporary topic and queue, sends one message through them, works with either SQS wire format, reports where it stopped, always removes what it created, contacts only the two service hosts and never logs credentials. Stand-in services only; the real QPing and QQ are not tested here.');
