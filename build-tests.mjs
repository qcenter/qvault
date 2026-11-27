import * as esbuild from 'esbuild';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const names=['completion','rsa-operation','profile','cloud-vault','restore','browser-runtime','channel','poll','sync','setup-profile','setup-ui','bucket-setup','setup-vault','onboarding-ui','onboarding-qkms-ui','unlock-ui','snapshot-discovery','local-key','hosted-runtime','passkey-profile','retention','snapshot-cache','notify-check','unlock-reveal'];
const plugins=[{name:'local-wasm',setup(b){b.onResolve({filter:/^@quilibrium\/mpc-wasm$/},()=>({path:'../vendor/mpc/loader.js',external:true}));b.onResolve({filter:/^(channelwasm|\.\.\/vendor\/channel\/channelwasm\.js)$/},()=>({path:'../vendor/channel/channelwasm.js',external:true}))}}];
for(const name of names)await esbuild.build({absWorkingDir:root,entryPoints:[path.join(root,'tests',name+'-source.js')],outfile:path.join(root,'tests',name+'-smoke.mjs'),bundle:true,format:'esm',platform:'node',nodePaths:[path.join(root,'node_modules')],plugins});
console.log('Rebuilt local test bundles.');
