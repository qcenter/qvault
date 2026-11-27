import assert from 'node:assert/strict';
import {createBroker} from '../browser-broker.js';
// The passkey unlock window may only ask for status, unlock and showing one password; everything else stays with the popup.
const id='fictional-extension-id',base='chrome-extension://'+id+'/',vaultCalls=[],windows=[];
const api={runtime:{id,getURL:p=>base+p},tabs:{query:async()=>[],get:async()=>({}),create:async()=>{}},scripting:{executeScript:async()=>[],getRegisteredContentScripts:async()=>[]},windows:{create:async o=>{windows.push(o);return {}},getLastFocused:async()=>frame}};let frame={left:100,top:50,width:1400,height:900};
const broker=createBroker(api,async command=>{vaultCalls.push(command);return {ok:true,action:command.action}});
const unlock={id,url:base+'unlock.html',tab:{id:7},frameId:0,documentId:'d'},popup={id,url:base+'popup.html'};
assert.deepEqual(await broker.handle({action:'status'},unlock),{ok:true,action:'status'});
await broker.handle({action:'unlock',prf:'UFJG',recoveryKey:undefined,password:'SHOULD_NOT_PASS',id:'x',origin:'https://evil.test',entry:{password:'x'}},unlock);
assert.deepEqual(vaultCalls.at(-1),{action:'unlock',prf:'UFJG',recoveryKey:undefined});
await broker.handle({action:'unlock',recoveryKey:'AAAA-BBBB'},unlock);assert.deepEqual(vaultCalls.at(-1),{action:'unlock',prf:undefined,recoveryKey:'AAAA-BBBB'});
const before=vaultCalls.length;
for(const action of ['get','list','all-entries','put','delete','lock','generate','sync','fill','open-manager','open-unlock','inline-list','inline-fill','page'])await assert.rejects(async()=>broker.handle({action,origin:'https://example.test',id:'x'},unlock),/not allowed/);
assert.equal(vaultCalls.length,before);
// Look-alike senders are not the unlock window.
for(const sender of [{...unlock,id:'other-extension'},{...unlock,url:base+'unlock.html.evil'},{...unlock,url:'https://evil.test/unlock.html'},{...unlock,url:base+'sub/unlock.html'}])await assert.rejects(async()=>broker.handle({action:'unlock',prf:'UFJG'},sender));
assert.equal(vaultCalls.length,before);
// The popup opens the unlock window; a web page (content script) cannot.
assert.equal(await broker.handle({action:'open-unlock'},popup),true);assert.equal(windows.length,1);assert.equal(windows[0].url,base+'unlock.html');assert.equal(windows[0].type,'popup');
// It opens where the toolbar popup was: top right of the browser window, not the middle of the screen.
assert.equal(windows[0].left,100+1400-windows[0].width-16);assert.equal(windows[0].top,50+88);assert.ok(windows[0].height<=900-100);
frame={left:0,top:0,width:500,height:380};await broker.handle({action:'open-unlock'},popup);assert.ok(windows[1].left>=0&&windows[1].top>=0&&windows[1].height>=320);
frame={};await broker.handle({action:'open-unlock'},popup);assert.equal(windows[2].left,undefined);assert.equal(windows[2].top,undefined);windows.length=1;
await assert.rejects(async()=>broker.handle({action:'open-unlock'},{id,url:'https://example.test/',tab:{id:3},frameId:0,documentId:'x'}));assert.equal(windows.length,1);
{const withQuery={...unlock,url:unlock.url+'?reveal=a&origin=https%3A%2F%2Fexample.test&scope=all'};await broker.handle({action:'reveal',id:'entry-1',origin:'https://example.test',scope:'all',prf:'UFJG',password:'SHOULD_NOT_PASS',entry:{}},withQuery);assert.deepEqual(vaultCalls.at(-1),{action:'reveal',id:'entry-1',origin:'https://example.test',prf:'UFJG',recoveryKey:undefined});await assert.rejects(()=>broker.handle({action:'reveal',id:'entry-1',origin:'http://example.test',prf:'UFJG'},withQuery),/HTTPS/);}
console.log('PASS LOCAL: the unlock window can only request status and unlock (passkey secret or recovery key, nothing else forwarded); entry, lock, fill and page requests from it are refused; look-alike senders are rejected; only the popup can open the unlock window. Mocked extension API.');
