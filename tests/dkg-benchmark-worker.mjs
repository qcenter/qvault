import {parentPort,workerData} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
import {loadMpcWasm} from '../vendor/mpc/loader.js';
globalThis.__qvaultCryptoProgress=stage=>parentPort.postMessage({stage,partyId:workerData.partyId});
const api=await loadMpcWasm({wasmBytes:await readFile(new URL('../vendor/mpc/mpc.wasm',import.meta.url))});
parentPort.postMessage({stage:'computing',partyId:workerData.partyId});const start=performance.now();
const response=JSON.parse(api.rsa_dkg_init(JSON.stringify({taskId:'offline-dkg-benchmark-'+workerData.partyId,keySize:2048,threshold:2,totalParties:2,partyId:workerData.partyId})));
parentPort.postMessage({stage:'finished',partyId:workerData.partyId,elapsedMs:Math.round(performance.now()-start),hasContribution:typeof response.data==='string',error:!!response.error});
