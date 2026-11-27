import {fillForm} from './fill-form.js';
export function createBroker(api,vault){
 const popupUrl=api.runtime.getURL('popup.html');
 async function page(sourceTab=null){const tab=sourceTab===null?(await api.tabs.query({active:true,currentWindow:true}))[0]:await api.tabs.get(sourceTab);if(sourceTab!==null&&tab?.active!==true)throw Error('The source website is no longer active. Reopen QVault from its input.');if(!tab?.id)throw Error('No active website');const url=new URL(tab.url);if(url.protocol!=='https:')throw Error('Open an HTTPS website');return {tab,origin:url.origin,sourceTab}}
 async function samePage(context){const current=await page(context.sourceTab);if(current.tab.id!==context.tab.id||current.origin!==context.origin||(context.documentId&&current.tab.url!==context.tab.url))throw Error('The active website changed');return current}
 const result=rows=>{const main=rows?.find(r=>r.frameId===0);if(main?.result?.ok!==true)throw Error(main?.result?.error||'The browser did not confirm filling');return {ok:true,mode:main.result.mode}};
 async function fill(context,id,targeted){
  const target=context.documentId?{tabId:context.tab.id,documentIds:[context.documentId]}:{tabId:context.tab.id,frameIds:[0]};
  const inject=args=>api.scripting.executeScript({target,world:'ISOLATED',func:fillForm,args});
  const probe=result(await inject([context.origin,null,null,null,targeted]));const entry=probe.mode==='username'?(await vault({action:'list',origin:context.origin})).find(e=>e.id===id):await vault({action:'get',origin:context.origin,id});if(!entry)throw Error('Entry not found for this website');await samePage(context);
  return result(await inject([context.origin,entry.username,probe.mode==='password'?entry.password:null,probe.mode,targeted]));
 }
 // The Q button on every HTTPS page is opt-in. Without the optional all-sites permission the page helper is
 // injected only into the tab where the user opened QVault (activeTab). This keeps the registration in step with the permission.
 async function enableInline(){
  const ids=(await api.scripting.getRegisteredContentScripts()).map(s=>s.id);
  if(ids.includes('qvault-browser-inline'))await api.scripting.unregisterContentScripts({ids:['qvault-browser-inline']});
  let allowed=false;try{allowed=await api.permissions?.contains?.({origins:['https://*/*']})===true}catch{}
  const registered=ids.includes('qvault-inline');
  if(allowed&&!registered)await api.scripting.registerContentScripts([{id:'qvault-inline',matches:['https://*/*'],js:['inline.js'],runAt:'document_idle',allFrames:false,persistAcrossSessions:true}]);
  if(!allowed&&registered)await api.scripting.unregisterContentScripts({ids:['qvault-inline']});
  return allowed;
 }
 function popupSource(sender){
  if(sender.id!==api.runtime.id)return undefined;
  let u,expected;try{u=new URL(sender.url);expected=new URL(popupUrl)}catch{return undefined}
  if(u.protocol!==expected.protocol||u.host!==expected.host||u.pathname!==expected.pathname)return undefined;
  const raw=u.searchParams.get('sourceTab');if(raw===null)return null;
  if(!/^[0-9]{1,12}$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)<1)throw Error('Invalid source website');
  return Number(raw);
 }

 async function openPage(url,sourceTab){const options={url};if(sourceTab!==null){const tab=await api.tabs.get(sourceTab);if(Number.isInteger(tab.windowId))options.windowId=tab.windowId}await api.tabs.create(options);return true}
 // The toolbar icon is green only while the vault is unlocked. Locked or not set up it is grey, which is also the manifest default; the tooltip says which. Never blocks a vault request.
 const iconSet=name=>Object.fromEntries([16,32,48,128].map(size=>[size,'assets/icons/'+name+'-'+size+'.png']));
 async function showLock(unlocked,saved=true){try{await api.action?.setBadgeText?.({text:''});await api.action?.setIcon?.({path:iconSet(unlocked&&saved!==false?'icon':'locked')});await api.action?.setTitle?.({title:saved===false?'QVault: not set up':unlocked?'QVault: unlocked':'QVault: locked'})}catch{}}
 const unlockUrl=api.runtime.getURL('unlock.html');
 // The unlock window runs the passkey prompt. It may ask for status and unlock, nothing else, and only these fields are forwarded.
 function unlockSource(sender){if(sender.id!==api.runtime.id)return false;let u,expected;try{u=new URL(sender.url);expected=new URL(unlockUrl)}catch{return false}return u.protocol===expected.protocol&&u.host===expected.host&&u.pathname===expected.pathname}
 async function unlockWindow(m){if(m.action==='status')return vault({action:'status'});if(m.action==='unlock')return vault({action:'unlock',prf:typeof m.prf==='string'?m.prf:undefined,recoveryKey:typeof m.recoveryKey==='string'?m.recoveryKey:undefined});if(m.action==='reveal'){let origin=null;try{origin=new URL(m.origin)}catch{}if(!origin||origin.protocol!=='https:'||origin.origin!==m.origin)throw Error('An exact HTTPS website is required');return vault({action:'reveal',id:m.id,origin:m.origin,prf:typeof m.prf==='string'?m.prf:undefined,recoveryKey:typeof m.recoveryKey==='string'?m.recoveryKey:undefined})}throw Error('This request is not allowed from the unlock window')}
 // Reads from the popup are editor reads (the vault may hold the password back); a save says whether the password was hidden while editing.
 const editorFlags=m=>m.action==='get'?{forEdit:true}:m.action==='put'&&m.hiddenPassword===true?{hiddenPassword:true}:{};
 async function popup(m,sourceTab){
  if(m.action==='open-unlock'){if(!api.windows?.create)throw Error('This browser cannot open the QVault unlock window');let url=unlockUrl;if(m.reveal){const r=m.reveal;let origin=null;try{origin=new URL(r.origin)}catch{}if(typeof r.id!=='string'||!/^[A-Za-z0-9-]{1,64}$/.test(r.id)||!origin||origin.protocol!=='https:'||origin.origin!==r.origin)throw Error('Invalid entry to show');url+='?'+new URLSearchParams({reveal:r.id,origin:r.origin}).toString()}const options={url,type:'popup',width:400,height:520,focused:true};
   // Open it where the toolbar popup was (top right of the browser window) instead of the middle of the screen.
   try{const source=sourceTab!==null&&api.windows.get?await api.windows.get((await api.tabs.get(sourceTab)).windowId):await api.windows.getLastFocused?.();if(source&&[source.left,source.top,source.width,source.height].every(Number.isFinite)){options.height=Math.min(520,Math.max(320,source.height-100));options.left=Math.round(source.left+Math.max(0,source.width-options.width-16));options.top=Math.round(source.top+Math.max(0,Math.min(88,source.height-options.height-16)))}}catch{}
   await api.windows.create(options);return true}
  if(m.action==='unlock')throw Error('Unlock from the QVault unlock window');
  if(m.action==='set-lock-minutes')return vault({action:'set-lock-minutes',minutes:m.minutes});
  if(m.action==='set-confirm-reveal'){const answer=await vault({action:'set-confirm-reveal',value:m.value===true});if(typeof answer?.unlocked==='boolean')await showLock(answer.unlocked,answer.saved);return answer}
  if(m.action==='reveal')throw Error('Show a password from the QVault unlock window');
  if(['status','lock','generate','sync','all-entries'].includes(m.action)){const answer=await vault(m);if(typeof answer?.unlocked==='boolean')await showLock(answer.unlocked,answer.saved);return answer}
  if(m.action==='open-site-access'){return openPage('chrome://extensions/?id='+api.runtime.id,sourceTab)}
  if(m.action==='open-manager'){await vault({action:'lock'});return openPage(api.runtime.getURL(m.section==='restore'?'recovery.html':'setup.html')+(m.section==='restore'?'#restore':''),sourceTab)}
  if(m.action==='sync-inline')return enableInline();
  if(m.action==='enable-inline'){await enableInline();const context=await page(sourceTab);await api.scripting.executeScript({target:{tabId:context.tab.id,frameIds:[0]},world:'ISOLATED',files:['inline.js']});return true}
  if(m.scope==='all'&&['get','put','delete'].includes(m.action)){const origin=new URL(m.origin);if(origin.protocol!=='https:'||origin.origin!==m.origin)throw Error('An exact HTTPS website is required');return vault({action:m.action,origin:m.origin,id:m.id,expectedVersion:m.expectedVersion,base:m.base,create:m.create,entry:m.entry,...editorFlags(m)});}
  const context=await page(sourceTab);if(m.action==='page'){await api.scripting.executeScript({target:{tabId:context.tab.id,frameIds:[0]},world:'ISOLATED',files:['inline.js']});return {origin:context.origin}}
  if(m.origin!==context.origin)throw Error('The website changed. Reopen QVault.');
  if(m.action==='fill')return fill(context,m.id,false);
  if(['list','get','put','delete'].includes(m.action))return vault({action:m.action,origin:context.origin,id:m.id,passive:m.passive===true,expectedVersion:m.expectedVersion,...(m.action==='put'?{entry:{title:m.entry?.title,username:m.entry?.username,password:m.entry?.password},base:m.base,create:m.create}:{}),...editorFlags(m)});
  throw Error('Unsupported popup request');
 }
 // Logins typed into a form that was sent, waiting for the person's answer: per tab, for the same website only, for two minutes.
 const hints=new Map(),pending=new Map(),PENDING_MS=120000,waitingFor=(tabId,origin)=>{const p=pending.get(tabId);if(!p)return null;if(p.origin!==origin||Date.now()-p.at>PENDING_MS){pending.delete(tabId);return null}return p};
 async function inline(m,s){
  if(s.id!==api.runtime.id||s.frameId!==0||!s.tab?.id||!s.documentId)throw Error('Invalid website request');const context=await page();if(context.tab.id!==s.tab.id||new URL(s.url).origin!==context.origin)throw Error('The website changed');context.documentId=s.documentId;
  if(m.action==='inline-list'){const state=await vault({action:'status'});if(!state.saved)throw Error('QVault setup required on this device.');return vault({action:'list',origin:context.origin});}
  if(m.action==='inline-fill'){if(typeof m.id!=='string'||m.id.length>128)throw Error('Invalid entry');return fill(context,m.id,true)}
  // The page's own Q panel may ask for a generated password and may save a login. The website is always the page it came from, never a value from the message.
  if(m.action==='inline-generate')return vault({action:'generate'});
  if(m.action==='inline-save'||m.action==='inline-check'){if(typeof m.username!=='string'||typeof m.password!=='string'||!m.password||m.username.length>4096||m.password.length>4096)throw Error('Invalid login to save');await samePage(context);return vault({action:m.action==='inline-save'?'save-login':'check-login',origin:context.origin,username:m.username,password:m.password})}
  // The name typed on the first page of a two-step login, kept for the password page of the same tab and website.
  if(m.action==='inline-hint'){if(typeof m.username==='string'&&m.username&&m.username.length<=4096)hints.set(s.tab.id,{origin:context.origin,username:m.username,at:Date.now()});return true}
  if(m.action==='inline-pending'){pending.delete(s.tab.id);if(typeof m.username!=='string'||typeof m.password!=='string'||!m.password||m.username.length>4096||m.password.length>4096)return false;const hint=hints.get(s.tab.id);const username=m.username||(hint&&hint.origin===context.origin&&Date.now()-hint.at<=PENDING_MS?hint.username:'');let state;try{state=(await vault({action:'check-login',origin:context.origin,username,password:m.password,passive:true})).state}catch{return false}if(state==='saved')return false;pending.set(s.tab.id,{origin:context.origin,username,password:m.password,state,at:Date.now()});return true}
  if(m.action==='inline-pending-get'){const p=waitingFor(s.tab.id,context.origin);return p?{state:p.state,username:p.username}:null}
  if(m.action==='inline-pending-dismiss'){pending.delete(s.tab.id);hints.delete(s.tab.id);return true}
  if(m.action==='inline-pending-save'){const p=waitingFor(s.tab.id,context.origin);if(!p)throw Error('Nothing to save any more. Use Save this login from the Q button.');pending.delete(s.tab.id);hints.delete(s.tab.id);await samePage(context);return vault({action:'save-login',origin:p.origin,username:p.username,password:p.password})}
  if(m.action==='inline-popup'){
   await samePage(context);
   if(!api.windows?.create)throw Error('Use the QVault toolbar icon; this browser cannot open a small QVault window');
   const options={url:popupUrl+'?sourceTab='+context.tab.id,type:'popup',width:400,height:640,focused:true};
   if(Number.isInteger(context.tab.windowId)&&api.windows.get){
    const source=await api.windows.get(context.tab.windowId);
    if([source.left,source.top,source.width,source.height].every(Number.isFinite)){
     options.width=400;options.height=Math.min(640,Math.max(320,source.height-100));
     options.left=Math.round(source.left+Math.max(0,source.width-options.width-16));
     options.top=Math.round(source.top+Math.max(0,Math.min(88,source.height-options.height-16)));
    }
   }
   await samePage(context);await api.windows.create(options);return {opened:'window'};
  }
  throw Error('This website request is not allowed');
 }
 return {enableInline,showLock,handle:(m,s)=>{if(!m||typeof m.action!=='string')throw Error('Invalid request');const source=popupSource(s);if(source!==undefined)return popup(m,source);if(unlockSource(s))return unlockWindow(m);return inline(m,s)}};
}
