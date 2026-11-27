// When the computer locks (which is also what a sleeping laptop does), an open vault is locked at once.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const manifest=JSON.parse(readFileSync(new URL('../manifest.json',import.meta.url),'utf8'));
assert.deepEqual([...manifest.permissions].sort(),['activeTab','idle','offscreen','scripting'],'idle is the only permission added for this, and it reads no page content');
let idle=null,offscreenOpen=false;const sent=[],created=[];const listener=()=>({addListener(){}});
globalThis.chrome={runtime:{id:'fixture',getURL:p=>'chrome-extension://fixture/'+p,onMessage:listener(),onInstalled:listener(),onStartup:listener(),getContexts:async()=>offscreenOpen?[{}]:[],sendMessage:async m=>{sent.push(m);return {data:{unlocked:false}}}},
 offscreen:{createDocument:async o=>{created.push(o);offscreenOpen=true}},permissions:{onAdded:listener(),onRemoved:listener(),contains:async()=>false},idle:{onStateChanged:{addListener:f=>{idle=f}}},
 action:{setBadgeText:async()=>{},setIcon:async()=>{},setTitle:async()=>{}},scripting:{getRegisteredContentScripts:async()=>[],registerContentScripts:async()=>{},unregisterContentScripts:async()=>{}},tabs:{}};
try{
 await import('../background.js');assert.equal(typeof idle,'function','the background listens for the computer locking');
 const settle=()=>new Promise(r=>setTimeout(r,10));
 idle('locked');await settle();assert.equal(sent.length,0,'nothing to lock while no vault is loaded');assert.equal(created.length,0,'and the vault page is not started just for this');
 offscreenOpen=true;for(const state of ['active','idle']){idle(state);await settle()}assert.equal(sent.length,0,'only the lock screen locks the vault, not a short pause');
 idle('locked');await settle();assert.deepEqual(sent,[{target:'qvault-offscreen',command:{action:'lock'}}]);
 console.log('PASS LOCAL: the background locks an open vault when the computer locks, ignores short idle periods, does not start the vault page just to lock it, and the manifest adds only the idle permission. Mocked Chrome APIs.');
}finally{delete globalThis.chrome}
