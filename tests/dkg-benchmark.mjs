import {Worker} from 'node:worker_threads';
const timeoutMs=Number(process.env.QVAULT_BENCHMARK_TIMEOUT_MS||180000);
const workers=[];const results=[];const start=Date.now();
const jobs=[1,2].map(partyId=>new Promise(resolve=>{const worker=new Worker(new URL('./dkg-benchmark-worker.mjs',import.meta.url),{workerData:{partyId}});workers.push(worker);worker.on('message',message=>{console.log(JSON.stringify(message));if(message.stage==='finished'){results.push(message);resolve()}});worker.on('error',error=>{console.log(JSON.stringify({partyId,errorType:error.name}));resolve()})}));
const heartbeat=setInterval(()=>console.log(JSON.stringify({stage:'waiting',elapsedSeconds:Math.floor((Date.now()-start)/1000)})),10000);
let timer;await Promise.race([Promise.all(jobs),new Promise(resolve=>{timer=setTimeout(resolve,timeoutMs)})]);clearTimeout(timer);clearInterval(heartbeat);for(const w of workers)await w.terminate();
console.log(JSON.stringify({summary:results.length===2?'both-init-returned':'bounded-benchmark-expired',timeoutMs,results}));
