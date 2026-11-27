// After a login or sign-up form is sent, QVault asks on the page whether to save what was typed.
// The typed login waits in the extension only; it is saved on a real click on Save. Simulated DOM and messaging.
import assert from 'node:assert/strict';
class Node{constructor(tag){this.tag=tag;this.children=[];this.style={setProperty(){}};this.className='';this.hidden=false;this.attributes={};this.textContent=''}append(...n){this.children.push(...n)}replaceChildren(...n){this.children=n}attachShadow(){this.shadow=new Node('shadow');return this.shadow}setAttribute(k,v){this.attributes[k]=v}remove(){this.removed=true}}
class Input{constructor(type,name,value=''){this.type=type;this.autocomplete='';this.isConnected=true;this.name=name;this.id='';this.labels=[];this.value=value;this.disabled=false;this.readOnly=false}getClientRects(){return [{}]}getBoundingClientRect(){return {top:100,bottom:140,right:400,height:40}}}
const events={},root=new Node('root'),sent=[];let waiting={state:'new',username:'new.user@example.test'};
globalThis.window={addEventListener(){}};window.top=window;globalThis.location={protocol:'https:'};globalThis.innerWidth=1000;globalThis.innerHeight=800;globalThis.HTMLInputElement=Input;globalThis.getComputedStyle=()=>({visibility:'visible'});
globalThis.document={createElement:t=>new Node(t),documentElement:root,activeElement:null,addEventListener:(e,f)=>events[e]=f,querySelectorAll:()=>[]};
globalThis.chrome={runtime:{sendMessage:async m=>{sent.push(m);if(m.action==='inline-pending-get')return {data:waiting};if(m.action==='inline-pending-save')return {data:{saved:true,updated:waiting?.state==='changed'}};return {data:true}}}};
const settle=()=>new Promise(r=>setTimeout(r,10)),card=()=>root.children.filter(n=>n.shadow&&!n.removed).map(n=>n.shadow.children.find(c=>c.id==='ask')).find(Boolean),button=(c,text)=>c.children.find(n=>n.tag==='button'&&n.textContent.startsWith(text)),words=c=>c.children.map(n=>n.textContent).join(' ');
await import('../inline.js');await settle();
// A login is waiting from the page before: the question is shown, with the username and never the password.
let ask=card();assert.ok(ask,'the question appears on the page after the form was sent');assert.match(words(ask),/Save this login in QVault\?/);assert.match(words(ask),/new\.user@example\.test/);
button(ask,'Save').onclick({isTrusted:false});await settle();assert.ok(!sent.some(m=>m.action==='inline-pending-save'),'a scripted click saves nothing');
await button(ask,'Save').onclick({isTrusted:true});assert.deepEqual(sent.at(-1),{action:'inline-pending-save'},'the page sends no login with the save request; the extension uses what it kept');assert.match(words(card()),/Saved in QVault/);
// Sending a form hands the typed login to the extension: the e-mail above the password, and on a change-password form the new password, not the current one.
const coupon=new Input('text','coupon','SAVE10'),user=new Input('email','email','new.user@example.test'),pass=new Input('password','password','typed-password'),login={querySelectorAll:()=>[coupon,user,pass]};
events.submit({target:login});await settle();assert.deepEqual(sent.find(m=>m.action==='inline-pending'),{action:'inline-pending',username:'new.user@example.test',password:'typed-password'});
const current=new Input('password','current','old-one'),fresh=new Input('password','new','new-one'),again=new Input('password','again','new-one'),change={querySelectorAll:()=>[current,fresh,again]};
sent.length=0;events.click({isTrusted:true,target:{closest:()=>({form:change,type:'button'})}});await settle();assert.ok(!sent.some(m=>m.action==='inline-pending'),'a show-password or other plain button is not taken for sending the form');events.click({isTrusted:true,target:{closest:()=>({form:change,type:'submit'})}});await settle();assert.deepEqual(sent.find(m=>m.action==='inline-pending'),{action:'inline-pending',username:'',password:'new-one'});
sent.length=0;events.click({isTrusted:true,target:{closest:()=>null}});events.submit({target:{querySelectorAll:()=>[coupon,user]}});await settle();assert.ok(!sent.some(m=>m.action==='inline-pending'),'no password typed, nothing handed over');
// The first page of a two-step login has only the name: it is passed on as a hint, so the password page can be saved with it.
assert.deepEqual(sent.find(m=>m.action==='inline-hint'),{action:'inline-hint',username:'new.user@example.test'});
// A changed password is asked as an update; Not now drops it.
waiting={state:'changed',username:'new.user@example.test'};await new Promise(r=>setTimeout(r,2700));assert.equal(card(),undefined,'while the filled form is still on the page nothing is asked');
events.submit({target:login});pass.value='';await new Promise(r=>setTimeout(r,2700));ask=card();assert.match(words(ask),/Update the saved password in QVault\?/);await button(ask,'Not now').onclick({isTrusted:true});assert.equal(sent.at(-1).action,'inline-pending-dismiss');assert.equal(card(),undefined,'the question goes away');
console.log('PASS LOCAL: after a form is sent the typed login is handed to the extension (the new password on a change-password form), the page asks whether to save or update it, saves only on a real click without sending the login again, and Not now drops it. Simulated DOM and messaging; real websites are not tested.');
process.exit(0);
