// Every page follows the system light/dark setting: colours are variables with a dark and a light value.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'..'),read=f=>readFileSync(path.join(root,f),'utf8');
for(const file of ['hosted-test.css','setup.css','lab.css','popup.css']){
 const css=read(file),a=css.indexOf('/*theme*/'),b=css.indexOf('/*end-theme*/');assert.ok(a===0&&b>a,file+' starts with the theme block');
 const theme=css.slice(a,b),rest=css.slice(b);
 const parts=theme.split('@media(prefers-color-scheme:light)');assert.equal(parts.length,2,file+' has one light block');
 const names=s=>new Set([...s.matchAll(/(--c-[0-9a-z-]+):/g)].map(m=>m[1]));const dark=names(parts[0]),light=names(parts[1]);
 assert.ok(dark.size>5,file+' defines colours');assert.deepEqual([...light].sort(),[...dark].sort(),file+' gives every colour a light value');
 for(const m of rest.matchAll(/var\((--c-[0-9a-z-]+)\)/g))assert.ok(dark.has(m[1]),file+' uses undefined '+m[1]);
 assert.equal(rest.match(/#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b|rgba?\(/g),null,file+' has a colour outside the theme block');
}
assert.match(read('hosted-test.css'),/color-scheme:light dark/);assert.match(read('popup.css'),/color-scheme:light dark/);
for(const page of ['setup.html','recovery.html','lab.html','unlock.html','storage-help.html','popup.html'])assert.ok(read(page).includes('<meta name="color-scheme" content="light dark">'),page+' declares both colour schemes');
console.log('PASS LOCAL: every stylesheet keeps its colours in one theme block with a dark and a light value for each, uses no colour outside it, and every page declares both colour schemes. Static check only.');
