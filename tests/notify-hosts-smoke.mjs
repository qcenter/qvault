// The instant sync check can only reach QPing and QQ if the page's content security policy allows those hosts.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'..'),read=f=>readFileSync(path.join(root,f),'utf8');
const manifest=JSON.parse(read('manifest.json')),connect=/connect-src ([^;]*)/.exec(manifest.content_security_policy.extension_pages)[1].split(' ');
const hosts=[...read('src/notify-check.js').matchAll(/'(https:\/\/[a-z.]+)\/'/g)].map(m=>m[1]);assert.deepEqual(hosts.sort(),['https://qping.quilibrium.com','https://qq.quilibrium.com']);
for(const host of hosts){assert.ok(connect.includes(host),'the content security policy allows '+host);assert.ok(read('src/diagnostics.js').includes(host+'/*'),'the check asks the browser for '+host);assert.ok(!manifest.host_permissions.some(p=>p.startsWith(host)),host+' is not a standing permission');}
assert.deepEqual(connect.sort(),["'self'",'https://qkms.quilibrium.com','https://qping.quilibrium.com','https://qq.quilibrium.com','https://qstorage.quilibrium.com'],'pages may connect to the four Quilibrium service hosts and nothing else');
console.log('PASS LOCAL: the content security policy lets extension pages reach exactly the four Quilibrium service hosts, and the two used by the instant sync check are requested per run, not held permanently. Static check only.');
