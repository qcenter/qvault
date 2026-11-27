import {Worker} from 'node:worker_threads';
const backend=process.argv[2]||'rust';if(!['rust','go'].includes(backend))throw Error('backend must be rust or go');
const timeoutMs=Number(process.argv[3]||180000);
const w=new Worker(new URL('./prime-benchmark-worker.mjs',import.meta.url),{workerData:{backend}});
const start=Date.now();let timer,heartbeat;
try{await new Promise((resolve,reject)=>{
 timer=setTimeout(()=>{console.log(JSON.stringify({backend,status:'deadline',elapsedMs:Date.now()-start}));resolve()},timeoutMs);
 heartbeat=setInterval(()=>console.log(JSON.stringify({backend,status:'running',elapsedMs:Date.now()-start})),30000);
 w.on('error',reject);w.on('message',m=>{console.log(JSON.stringify({backend,...m}));if(m.done)resolve()});
})}finally{clearTimeout(timer);clearInterval(heartbeat);await w.terminate()}
