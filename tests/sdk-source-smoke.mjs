import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
// The QKMS SDK sources are not kept in this repository: the build fetches one fixed commit of the public fork.
const fetcher=read('build/fetch-sdk.mjs');
assert.ok(fetcher.includes("'https://github.com/qcenter/qkms-sdk.git'"));
const pin=/COMMIT='([a-f0-9]{40})'/.exec(fetcher);assert.ok(pin,'a full commit id is fixed');
assert.match(fetcher,/rev-parse/,'the fetched commit is checked');
assert.equal(JSON.parse(read('package.json')).scripts.build,'node build/fetch-sdk.mjs && node build.mjs');
const ignored=read('.gitignore').split('\n');for(const dir of ['upstream/sdk-core/','upstream/mpc-wasm/','upstream/.sdk-commit'])assert.ok(ignored.includes(dir),dir+' is ignored');
const sums=read('SHA256SUMS');for(const dir of ['upstream/sdk-core/','upstream/mpc-wasm/','upstream/SDK-README.md'])assert.ok(!sums.includes('  '+dir),dir+' is not part of the repository');
const notes=read('THIRD-PARTY.md');assert.ok(notes.includes('https://github.com/qcenter/qkms-sdk')&&notes.includes(pin[1]),'THIRD-PARTY.md names the fork and the same commit');
assert.ok(read('README.md').includes('qcenter/qkms-sdk'));
console.log('PASS LOCAL: the QKMS SDK sources are fetched from the public fork at one fixed, checked commit and are not stored in this repository.');
