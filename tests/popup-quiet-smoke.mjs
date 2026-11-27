// The popup's background check every few seconds must not make the window flash:
// no button is disabled, the list is rebuilt only when it really changed, and the footer does not flip to "Syncing…".
import assert from 'node:assert/strict';
let disabledWrites=0;
class El{constructor(id=''){this.id=id;this.value='';this.hidden=false;this._disabled=false;this.children=[];this.textContent='';this.className=''}get disabled(){return this._disabled}set disabled(v){if(v)disabledWrites++;this._disabled=v}append(...n){this.children.push(...n)}replaceChildren(...n){this.children=n;this.rebuilt=(this.rebuilt||0)+1}}
const els=new Map();function el(id){if(!els.has(id))els.set(id,new El(id));return els.get(id)}
const listeners={};let poll=null;const realInterval=globalThis.setInterval;globalThis.setInterval=(fn,ms)=>{if(ms===10000){poll=fn;return 0}return realInterval(fn,ms)};
globalThis.document={getElementById:el,createElement:()=>new El(),querySelectorAll:()=>[...els.values()]};globalThis.window={addEventListener:(e,f)=>(listeners[e]??=[]).push(f),close(){}};
const sent=[];let holdStatus=null;let rows=[{id:'a',title:'One',username:'user-one',url:'https://example.test',version:1}],revision='r1',syncState='Single-computer mode';
globalThis.chrome={runtime:{sendMessage:async m=>{sent.push(m);if(m.action==='page')return {data:{origin:'https://example.test'}};if(m.action==='status'&&holdStatus)await holdStatus;if(m.action==='status')return {data:{saved:true,unlocked:true,auth:'passkey',syncState,lastSync:1,revision,mode:'single-device'}};if(m.action==='all-entries'||m.action==='list')return {data:rows};return {data:true}}},permissions:{contains:async()=>false}};
const settle=()=>new Promise(r=>setTimeout(r,20));
try{
 await import('../popup.js');await settle();await settle();assert.equal(typeof poll,'function');assert.equal(el('unlocked').hidden,false);
 const footer=el('sync-status').textContent;assert.match(footer,/Backed up to the cloud/);
 const before=el('entries').rebuilt;disabledWrites=0;
 syncState='checking';poll();await settle();assert.equal(disabledWrites,0,'a background check must not disable the buttons');assert.equal(el('entries').rebuilt,before,'an unchanged list is not rebuilt');assert.equal(el('sync-status').textContent,footer,'the footer keeps its text during a background check');
 syncState='Single-computer mode';revision='r2';poll();await settle();assert.equal(el('entries').rebuilt,before,'a new revision with the same entries is not rebuilt either');
 rows=[...rows,{id:'b',title:'Two',username:'user-two',url:'https://example.test',version:1}];revision='r3';poll();await settle();assert.ok(el('entries').rebuilt>before,'a changed list is shown');assert.equal(disabledWrites,0);
 // A click that lands while a background check is still running must not be lost: it waits for the check and then runs.
 {let release;holdStatus=new Promise(r=>release=r);const before=sent.length;poll();await settle();el('lock-minutes').value='15';const clicked=el('lock-minutes').onchange();await settle();assert.ok(!sent.slice(before).some(m=>m.action==='set-lock-minutes'),'it waits for the running check');holdStatus=null;release();await clicked;await settle();assert.ok(sent.slice(before).some(m=>m.action==='set-lock-minutes'&&m.minutes===15),'and then goes through');}
 console.log('PASS LOCAL: the popup background check never disables buttons, rebuilds the list only when entries changed, and leaves the footer text alone while checking. Simulated DOM only.');
}finally{for(const f of listeners.pagehide??[])f();globalThis.setInterval=realInterval;delete globalThis.chrome;delete globalThis.document;delete globalThis.window}
