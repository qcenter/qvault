// Node-only harness for the exact bundled Web Worker. Network is prohibited.
import {parentPort} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
globalThis.self=globalThis;
globalThis.fetch=async input=>{const url=new URL(input);if(url.protocol!=='file:')throw Error('Network disabled in local test');return new Response(await readFile(url),{headers:{'Content-Type':url.pathname.endsWith('.wasm')?'application/wasm':'text/javascript'}})};
globalThis.postMessage=result=>parentPort.postMessage(result);
await import('../dist/engine.js');
parentPort.on('message',data=>globalThis.onmessage({data}));
parentPort.postMessage({harnessReady:true});
