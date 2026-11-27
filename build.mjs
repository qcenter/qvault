import * as esbuild from 'esbuild';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const plugin={name:'browser-only-sdk-subset',setup(build){
 build.onResolve({filter:/^(channelwasm|@quilibrium\/mpc-wasm)$/},args=>({path:args.path==='channelwasm'?'../vendor/channel/channelwasm.js':'../vendor/mpc/loader.js',external:true}));
 build.onResolve({filter:/vendor\/(mpc\/loader|channel\/channelwasm|rust-primes\/qvault_rust_primes)\.js$/},args=>({path:args.path,external:true}));
 build.onLoad({filter:/sidecar\/wasm-init\.ts$/},()=>({contents:"import init from 'channelwasm';let ready;export function initAllWasm(){return ready||(ready=init());}",loader:'js'}));
}};
await esbuild.build({absWorkingDir:root,entryPoints:{recovery:path.join(root,'src/recovery.js'),diagnostics:path.join(root,'src/diagnostics.js'),setup:path.join(root,'src/setup.js'),unlock:path.join(root,'src/unlock.js'),offscreen:path.join(root,'src/offscreen.js'),engine:path.join(root,'src/engine.js')},outdir:path.join(root,'dist'),bundle:true,format:'esm',platform:'browser',target:'chrome120',nodePaths:[path.join(root,'node_modules')],plugins:[plugin],sourcemap:true,logLevel:'warning'});
console.log('Bundled browser-only SDK subset.');
