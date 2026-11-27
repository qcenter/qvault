import {Worker} from 'node:worker_threads';
import assert from 'node:assert/strict';
const worker=new Worker(new URL('./worker-shim.mjs',import.meta.url));
try{const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Engine initialization timeout')),30000);worker.on('message',m=>{if(m.harnessReady){worker.postMessage({id:1,action:'local'});return}clearTimeout(timer);m.error?reject(Error(m.error)):resolve(m.data)});worker.on('error',reject)});assert.equal(result.ready,true);assert.match(result.sidecarId,/^[a-f0-9]{32}$/);console.log('PASS LOCAL: exact bundled browser worker initialized both WASM modules and completed RSA-OAEP local check with network prohibited. Node worker harness, not a live Chromium browser.')}finally{await worker.terminate()}
