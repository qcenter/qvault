import {parentPort} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
import {loadMpcWasm} from '../vendor/mpc/loader.js';
const api=await loadMpcWasm({wasmBytes:await readFile(new URL('../vendor/mpc/mpc.wasm',import.meta.url))});
const missing=JSON.parse(api.rsa_dkg_init(JSON.stringify({taskId:'synthetic-missing-preparation',keySize:2048,threshold:2,totalParties:2,partyId:1,requirePrepared:true})));
parentPort.postMessage({stage:'missing-preparation-rejected',rejected:typeof missing.error==='string',prepared:JSON.parse(api.rsa_dkg_prepared('{}')).ready});
globalThis.__qvaultCryptoProgress=stage=>parentPort.postMessage({stage});
api.rsa_dkg_prepare(JSON.stringify({keySize:2048}));
