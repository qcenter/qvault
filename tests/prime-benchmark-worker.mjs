import {parentPort,workerData} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
import {loadMpcWasm} from '../vendor/mpc/loader.js';
import initRust,{generate_safe_prime} from '../vendor/rust-primes/qvault_rust_primes.js';
const api=await loadMpcWasm({wasmBytes:await readFile(new URL('../vendor/mpc/mpc.wasm',import.meta.url))});
globalThis.__qvaultCryptoProgress=stage=>parentPort.postMessage({stage});
const started=performance.now();
let result;
if(workerData.backend==='rust'){
 await initRust({module_or_path:await readFile(new URL('../vendor/rust-primes/qvault_rust_primes_bg.wasm',import.meta.url))});
 const factors=[];
 try{
  for(let i=0;i<2;i++){
   const seed=crypto.getRandomValues(new Uint8Array(32));
   try{factors.push(generate_safe_prime(seed))}finally{seed.fill(0)}
   parentPort.postMessage({stage:'rust-prime-'+(i+1)+'-ready',elapsedMs:Math.round(performance.now()-started)});
  }
  result=JSON.parse(api.rsa_dkg_prepare_rust(JSON.stringify({p:Buffer.from(factors[0]).toString('base64'),q:Buffer.from(factors[1]).toString('base64')})));
 }finally{for(const f of factors)f.fill(0)}
}else result=JSON.parse(api.rsa_dkg_prepare('{"keySize":2048}'));
if(!result.ready)throw Error('Preparation failed (no secret payload displayed)');
// Verify the prepared state is actually accepted by the real unchanged DKG path.
const init=JSON.parse(api.rsa_dkg_init(JSON.stringify({taskId:'synthetic-'+crypto.randomUUID(),keySize:2048,threshold:2,totalParties:2,partyId:1,requirePrepared:true})));
if(init.error)throw Error('Prepared DKG init rejected');
if(JSON.parse(api.rsa_dkg_prepared('{}')).ready)throw Error('Preparation not consumed once');
parentPort.postMessage({done:true,backend:workerData.backend,elapsedMs:Math.round(performance.now()-started),validation:'Go safe-prime validation and one-use prepared DKG init passed'});
