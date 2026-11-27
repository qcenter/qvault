import assert from 'node:assert/strict';
// An entry without a usable website (legacy or hand-edited data) must not blank the whole list.
class El{constructor(id=''){this.id=id;this.value='';this.hidden=false;this.disabled=false;this.children=[];this.textContent=''}append(...n){this.children.push(...n)}replaceChildren(...n){this.children=n}}
const els=new Map();function el(id){if(!els.has(id))els.set(id,new El(id));return els.get(id)}
globalThis.document={getElementById:el,createElement:()=>new El(),querySelectorAll:()=>[...els.values()]};globalThis.window={addEventListener(){},close(){}};
const rows=[{id:'a',title:'No website',username:'legacy-user',url:''},{id:'b',title:'Broken',username:'broken-user',url:'not a url'},{id:'c',title:'Fixture',username:'fixture-user',url:'https://example.test'}];
globalThis.chrome={runtime:{sendMessage:async m=>{if(m.action==='page')return {data:{origin:'https://example.test'}};if(m.action==='status')return {data:{saved:true,unlocked:true}};if(m.action==='all-entries')return {data:rows};return {data:true}}}};
const realSetInterval=globalThis.setInterval;globalThis.setInterval=()=>0;
try{
 await import('../popup.js');
 const records=()=>el('entries').children.filter(e=>e.className==='record');
 for(let i=0;i<200&&records().length<3;i++)await new Promise(r=>setTimeout(r,1));
 assert.equal(records().length,3,'all entries render: '+el('status').textContent);
 assert.equal(el('entry-count').textContent,'3 entries');
 const suggested=records().filter(r=>r.children[1].title==='Fill on this website');assert.equal(suggested.length,1);
 assert.equal(suggested[0].children[1].children[0].textContent,'Fixture');
 console.log('PASS LOCAL: entries with a missing or malformed website still render and are never offered for filling. Simulated DOM only.');
}finally{globalThis.setInterval=realSetInterval}
