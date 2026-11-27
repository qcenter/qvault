import assert from 'node:assert/strict';
class El{constructor(id=''){this.id=id;this.value='';this.hidden=false;this.disabled=false;this.children=[];this.textContent=''}append(...n){this.children.push(...n)}replaceChildren(...n){this.children=n}}
const els=new Map();function el(id){if(!els.has(id))els.set(id,new El(id));return els.get(id)}
let closed=0;const messages=[];globalThis.document={getElementById:el,createElement:()=>new El(),querySelectorAll:()=>[...els.values()]};globalThis.window={addEventListener(){},close:()=>{closed++}};
globalThis.chrome={runtime:{sendMessage:async m=>{messages.push(m);if(m.action==='page')return {data:{origin:'https://example.test'}};if(m.action==='status')return {data:{saved:true,unlocked:false,auth:'passkey'}};return {data:true}}}};
const realSetInterval=globalThis.setInterval;globalThis.setInterval=()=>0;
try{
 await import('../popup.js');for(let i=0;i<200&&el('passkey-form').hidden!==false;i++)await new Promise(r=>setTimeout(r,1));
 assert.equal(el('passkey-form').hidden,false);assert.equal(el('unlocked').hidden,true);
 await el('passkey-unlock').onclick();for(let i=0;i<200&&!closed;i++)await new Promise(r=>setTimeout(r,1));
 assert.ok(messages.some(m=>m.action==='open-unlock'));assert.ok(!messages.some(m=>m.action==='unlock'));assert.equal(closed,1);
 console.log('PASS LOCAL: for a passkey vault the popup hides the master password form, offers Unlock with passkey, and hands over to the unlock window without sending any secret. Simulated DOM only.');
}finally{globalThis.setInterval=realSetInterval}
