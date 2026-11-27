import {parentPort} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
globalThis.self=globalThis;globalThis.postMessage=m=>parentPort.postMessage(m);
globalThis.fetch=async(input,options={})=>{
 const url=new URL(input instanceof Request?input.url:input);
 if(url.protocol==='file:')return new Response(await readFile(url),{headers:{'Content-Type':url.pathname.endsWith('.wasm')?'application/wasm':'text/javascript'}});
 if(url.origin!=='https://qkms.quilibrium.com')throw Error('Network prohibited');
 const request=input instanceof Request?input:new Request(input,options);
 const method=(request.headers.get('x-amz-target')||'').split('.').at(-1);parentPort.postMessage({rpc:method});
 if(method==='RegisterSidecar'){const body=await request.json();return new Response(JSON.stringify({SidecarId:body.SidecarId}),{headers:{'Content-Type':'application/json'}})}
 if(method==='ListTasksForSidecar')return new Response('{"Tasks":[]}',{headers:{'Content-Type':'application/json'}});
 throw Error('Unexpected RPC; live network disabled');
};
await import('../dist/engine.js');parentPort.on('message',data=>globalThis.onmessage({data}));parentPort.postMessage({harnessReady:true});
