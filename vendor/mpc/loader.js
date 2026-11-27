import './wasm_exec.js';
let promise;
export function loadMpcWasm(options={}){
 if(!promise)promise=(async()=>{
  const bytes=options.wasmBytes||await (await fetch(new URL('./mpc.wasm',import.meta.url))).arrayBuffer();
  const go=new globalThis.Go();const {instance}=await WebAssembly.instantiate(bytes,go.importObject);
  go.run(instance).catch(()=>{});
  for(let i=0;i<100;i++){if(globalThis.mpcWasm)return globalThis.mpcWasm;await new Promise(r=>setTimeout(r,10))}
  throw Error('MPC WebAssembly did not initialize.');
 })();return promise;
}
