import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createBroker} from '../browser-broker.js';
// Least privilege: no page access by default; the Q button on every site is an explicit, revocable choice.
const manifest=JSON.parse(readFileSync(new URL('../manifest.json',import.meta.url),'utf8'));
assert.equal(manifest.content_scripts,undefined);
assert.deepEqual([...manifest.host_permissions].sort(),['https://qkms.quilibrium.com/*','https://qstorage.quilibrium.com/*']);
assert.deepEqual(manifest.optional_host_permissions,['https://*/*']);assert.ok(manifest.permissions.includes('activeTab')&&manifest.permissions.includes('scripting'));
function setup({allowed,registered}){
 const calls=[];let scripts=registered.map(id=>({id}));
 const api={runtime:{id:'x',getURL:p=>'chrome-extension://x/'+p},permissions:{contains:async q=>{assert.deepEqual(q,{origins:['https://*/*']});return allowed}},tabs:{},windows:{},scripting:{getRegisteredContentScripts:async()=>scripts,registerContentScripts:async list=>{calls.push(['register',list]);scripts=scripts.concat(list.map(s=>({id:s.id})))},unregisterContentScripts:async({ids})=>{calls.push(['unregister',ids]);scripts=scripts.filter(s=>!ids.includes(s.id))}}};
 return {calls,broker:createBroker(api,async()=>({}))};
}
let t=setup({allowed:true,registered:[]});assert.equal(await t.broker.enableInline(),true);assert.equal(t.calls.length,1);
const [script]=t.calls[0][1];assert.deepEqual(script.matches,['https://*/*']);assert.deepEqual(script.js,['inline.js']);assert.equal(script.allFrames,false);assert.equal(script.id,'qvault-inline');
assert.equal(await t.broker.enableInline(),true);assert.equal(t.calls.length,1,'not registered twice');
t=setup({allowed:false,registered:['qvault-inline']});assert.equal(await t.broker.enableInline(),false);assert.deepEqual(t.calls,[['unregister',['qvault-inline']]]);
t=setup({allowed:false,registered:[]});assert.equal(await t.broker.enableInline(),false);assert.equal(t.calls.length,0);
t=setup({allowed:false,registered:['qvault-browser-inline']});await t.broker.enableInline();assert.deepEqual(t.calls,[['unregister',['qvault-browser-inline']]]);
// the popup asks the browser itself; it can only request or drop exactly the all-HTTPS-sites origin
class El{constructor(id=''){this.id=id;this.value='';this.hidden=false;this.disabled=false;this.children=[];this.textContent=''}append(...n){this.children.push(...n)}replaceChildren(...n){this.children=n}}
const els=new Map(),el=id=>{if(!els.has(id))els.set(id,new El(id));return els.get(id)},messages=[],asked=[];let granted=false;
globalThis.document={getElementById:el,createElement:()=>new El(),querySelectorAll:()=>[...els.values()]};globalThis.window={addEventListener(){},close(){}};
globalThis.chrome={permissions:{contains:async()=>granted,request:async q=>{asked.push(['request',q]);granted=true;return true},remove:async q=>{asked.push(['remove',q]);granted=false;return true}},runtime:{sendMessage:async m=>{messages.push(m.action);if(m.action==='page')return {data:{origin:'https://example.test'}};if(m.action==='status')return {data:{saved:false,unlocked:false}};return {data:true}}}};
const realSetInterval=globalThis.setInterval;globalThis.setInterval=()=>0;const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,2))}throw Error('popup timed out')};
try{
 await import('../popup.js');await wait(()=>/off/i.test(el('inline').textContent));
 el('inline').onclick();await wait(()=>/on$/i.test(el('inline').textContent.trim()));assert.deepEqual(asked,[['request',{origins:['https://*/*']}]]);assert.ok(messages.includes('sync-inline'));
 el('inline').onclick();await wait(()=>/off/i.test(el('inline').textContent));assert.deepEqual(asked.at(-1),['remove',{origins:['https://*/*']}]);assert.equal(messages.filter(m=>m==='sync-inline').length,2);
 console.log('PASS LOCAL: the manifest grants no website access by default (only the two service hosts, activeTab and scripting); the inline script is registered only while the user has granted all-sites access and removed when it is withdrawn; the popup requests or removes exactly that permission and tells the background to follow. Mocked extension API and DOM.');
}finally{globalThis.setInterval=realSetInterval}
