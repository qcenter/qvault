// The extension says plainly what it is built on, and that it is not an official Quilibrium product.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'..'),read=f=>readFileSync(path.join(root,f),'utf8');
const manifest=JSON.parse(read('manifest.json'));
assert.match(manifest.description,/Quilibrium/);assert.match(manifest.description,/[Uu]nofficial/);assert.ok(manifest.description.length<=132,'Chrome limits the description to 132 characters');
for(const file of ['README.md','setup.html','popup.html']){const text=read(file);assert.match(text,/Quilibrium/,file+' names Quilibrium');}
for(const file of ['README.md','setup.html'])assert.match(read(file),/not an official Quilibrium product/,file+' says it is independent');
assert.match(manifest.description,/[Ee]xperimental/);
const readme=read('README.md');for(const part of ['Experimental','## How it works','## Install','Load unpacked','## First setup','## Using it on another computer','## Known limits'])assert.ok(readme.includes(part),'README has '+part);
assert.ok(!/master password to unlock\. Do not create a new key|private GitHub release/.test(readme),'README has no outdated instructions');
for(const page of ['setup.html','recovery.html','lab.html','unlock.html','storage-help.html','popup.html'])assert.match(read(page),/EXPERIMENTAL/,page+' is marked experimental');
console.log('PASS LOCAL: the manifest, README, Setup page and popup name Quilibrium, and the manifest, README and Setup page say this is not an official Quilibrium product; every page is marked experimental and the README explains how it works, how to install it and its limits. Static check only.');
