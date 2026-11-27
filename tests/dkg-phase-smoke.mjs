import {Worker} from 'node:worker_threads';
import assert from 'node:assert/strict';
const worker=new Worker(new URL('./dkg-benchmark-worker.mjs',import.meta.url),{workerData:{partyId:1}});let timer;
try{const stage=await new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('No phase event')),10000);worker.on('message',message=>{if(message.stage==='paillier-safe-prime-generation-started')resolve(message.stage)});worker.on('error',reject)});assert.equal(stage,'paillier-safe-prime-generation-started');console.log('PASS: actual WASM reports entry into Paillier safe-prime generation before doing costly initialization. The test cancels immediately; it does not prove key completion.')}finally{clearTimeout(timer);await worker.terminate()}
