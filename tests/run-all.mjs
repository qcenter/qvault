// Runs every tests/*-smoke.mjs in its own Node process and reports a summary.
// Usage: npm test            (run `npm run build && node build-tests.mjs` first after source changes)
import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const files=readdirSync(dir).filter(f=>f.endsWith('-smoke.mjs')).sort();
const failed=[];
for(const file of files){
 const r=spawnSync(process.execPath,[path.join(dir,file)],{encoding:'utf8',timeout:300000});
 if(r.status===0)console.log('ok   '+file);
 else{failed.push(file);console.log('FAIL '+file);console.log(((r.stderr||'')+(r.stdout||'')).trim().split('\n').slice(0,12).join('\n'))}
}
console.log('\n'+(files.length-failed.length)+'/'+files.length+' test files passed.');
if(failed.length){console.log('Failed: '+failed.join(', '));process.exit(1)}
