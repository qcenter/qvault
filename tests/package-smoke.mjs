import assert from 'node:assert/strict';
import {readdirSync,readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
// The shipped folder is loaded unpacked, so everything in it is part of the extension.
// Guard against orphaned bundles, bundles without source, and pages nothing links to.
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=f=>readFileSync(path.join(root,f),'utf8');
const pages=readdirSync(root).filter(f=>f.endsWith('.html'));
const rootScripts=readdirSync(root).filter(f=>f.endsWith('.js'));
const sources=readdirSync(path.join(root,'src')).filter(f=>f.endsWith('.js'));
const bundles=readdirSync(path.join(root,'dist')).filter(f=>f.endsWith('.js'));
const manifest=read('manifest.json');
for(const page of pages)for(const [,src]of read(page).matchAll(/<script[^>]*\ssrc="([^"]+)"/g)){
 assert.ok(!/^[a-z]+:|^\/\//i.test(src),page+' loads a remote script: '+src);
 assert.ok(existsSync(path.join(root,src)),page+' loads a missing script: '+src);
}
const shippedText=[manifest,...pages.map(read),...rootScripts.map(read),...sources.map(f=>read('src/'+f))].join('\n');
for(const bundle of bundles){
 assert.ok(sources.includes(bundle),'dist/'+bundle+' has no src/'+bundle+' to rebuild it from');
 assert.ok(pages.some(p=>read(p).includes('"dist/'+bundle+'"'))||shippedText.includes("'./"+bundle+"'"),'dist/'+bundle+' is not loaded by any page or worker');
}
for(const page of pages){
 const others=[manifest,...pages.filter(p=>p!==page).map(read),...rootScripts.map(read),...sources.map(f=>read('src/'+f))].join('\n');
 assert.ok(others.includes(page),page+' is not referenced by the manifest, another page or extension code');
}
assert.equal(JSON.parse(manifest).content_scripts,undefined,'no script may be injected into pages by default');
// A fixed key keeps the extension ID identical on every computer and folder; passkeys are bound to that ID.
const key=JSON.parse(manifest).key;assert.equal(typeof key,'string');assert.ok(Buffer.from(key,'base64').length>=270&&/^[A-Za-z0-9+/]+=*$/.test(key),'manifest key must be a base64 public key');
console.log('PASS LOCAL: every page script exists locally, every dist bundle has a source and a loader, and every page is reachable. Static package check only.');
