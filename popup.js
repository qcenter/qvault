if(typeof location!=='undefined'&&new URLSearchParams(location.search).has('sourceTab'))document.documentElement?.classList?.add('floating');
const $=id=>document.getElementById(id);const originOf=u=>{try{return new URL(u).origin}catch{return ''}},hostOf=o=>{try{return new URL(o).hostname}catch{return 'No website'}},here=u=>{const o=originOf(u);return !!o&&o===origin};let origin='',rows=[],busy=false,uiEpoch=0,editingBase=null,editingHidden=false,revealTarget=null,confirmOn=true,lastRevision=null,allEntries=true;
async function send(action,args={}){const current=uiEpoch;if(typeof globalThis.chrome?.runtime?.sendMessage!=='function')throw Error('QVault was updated. Close this window and reopen it from QVault.');let r;try{r=await chrome.runtime.sendMessage({action,...args})}catch(e){if(/context invalidated|receiving end does not exist/i.test(e.message||''))throw Error('QVault was updated. Close this window and reopen it from QVault.');throw e};if(current!==uiEpoch)throw Error('Popup request cancelled');if(!r)throw Error('QVault is unavailable');if(r.error)throw Error(r.error);return r.data}
function status(t,kind=''){$('status').textContent=t;$('status').className=kind;$('status').hidden=!t||t==='Vault locked'}
function showEntryForm(){document.documentElement?.classList?.add('editing');$('entry-form').hidden=false;document.body?.scrollTo?.({top:Math.max(0,($('entry-form').offsetTop||0)-12),behavior:'auto'});$('username').focus?.({preventScroll:true})}
function clear(){document.documentElement?.classList?.remove('editing');editingBase=null;editingHidden=false;revealTarget=null;$('reveal').hidden=true;$('password').placeholder='';for(const id of ['entry-id','title','username','password','website'])$(id).value='';$('entry-form').hidden=true}
// quiet: background checks run without greying out the buttons, so the window does not flash every few seconds.
// A click that lands while a quiet background check is running waits for it instead of being dropped.
let running=null,runningQuiet=false;
async function work(fn,quiet=false){if(busy){if(quiet||!runningQuiet)return;try{await running}catch{}if(busy)return}let done;running=new Promise(r=>done=r);runningQuiet=quiet;try{await workNow(fn,quiet)}finally{done()}}
async function workNow(fn,quiet){const current=uiEpoch;busy=true;if(!quiet)for(const b of document.querySelectorAll('button'))b.disabled=b.id!=='lock';try{await fn()}catch(e){if(current===uiEpoch)status(e.message,'error')}finally{if(current===uiEpoch){busy=false;if(!quiet)for(const b of document.querySelectorAll('button'))b.disabled=false}}}
function render(){
 const q=$('search').value.trim().toLowerCase();const visible=rows.filter(e=>[e.title,e.username,e.url||''].some(s=>s.toLowerCase().includes(q)));$('entries').replaceChildren();$('entry-count').textContent=visible.length+' '+(visible.length===1?'entry':'entries');
 const matching=visible.filter(e=>!allEntries||here(e.url));const others=visible.filter(e=>allEntries&&!here(e.url));
 function group(items,heading){if(!items.length)return;const label=document.createElement('h2');label.className='list-heading';label.textContent=heading;$('entries').append(label);
 for(const e of items){const entryOrigin=allEntries?originOf(e.url):origin;const scope=allEntries?'all':'site';const canFill=!!entryOrigin&&entryOrigin===origin;const row=document.createElement('article');row.className='record';row.setAttribute?.('data-suggested',String(canFill));const tone=[...entryOrigin].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,0)%5;row.setAttribute?.('data-tone',String(tone));
 const avatar=document.createElement('span');avatar.className='record-avatar';avatar.textContent=(e.title||hostOf(entryOrigin)).replace(/^https?:\/\//,'').charAt(0).toUpperCase();avatar.setAttribute?.('aria-hidden','true');
 const main=document.createElement('button');main.className='record-main';const title=document.createElement('strong'),user=document.createElement('small');title.textContent=e.title||hostOf(entryOrigin);user.textContent=e.username||hostOf(entryOrigin);main.append(title,user);main.title=canFill?'Fill on this website':'Edit saved entry';
 const fill=()=>work(async()=>{const r=await send('fill',{origin,id:e.id});status(r.mode==='username'?'Email / username filled. Continue signing in yourself.':'Filled. Submit the login yourself.');window.close()});
 const edit=()=>work(async()=>{const entry=await send('get',{origin:entryOrigin,scope,id:e.id});editingBase={...entry};editingHidden=entry.passwordHidden===true;revealTarget={id:entry.id,origin:entryOrigin};$('reveal').hidden=!editingHidden;$('password').placeholder=editingHidden?'Leave empty to keep the saved one':'';$('website').value=entry.url;$('entry-id').value=entry.id;$('title').value=entry.title;$('username').value=entry.username;$('password').value=entry.password;$('website-label').hidden=!allEntries;showEntryForm()});main.onclick=canFill?fill:edit;
 const menu=document.createElement('details');menu.className='record-menu';const summary=document.createElement('summary');summary.textContent='⋯';summary.setAttribute?.('aria-label','Actions for '+title.textContent);summary.title='Entry actions';menu.append(summary);const actions=document.createElement('div');actions.className='record-actions';
 if(canFill){const button=document.createElement('button');button.textContent='Fill';button.onclick=fill;actions.append(button)}
 const editButton=document.createElement('button');editButton.textContent='Edit';editButton.onclick=()=>{menu.open=false;edit()};actions.append(editButton);
 const del=document.createElement('button');del.textContent='Delete';let armed=false;del.onclick=()=>{if(!armed){armed=true;del.textContent='Confirm delete';return}work(async()=>{await send('delete',{origin:entryOrigin,scope,id:e.id,expectedVersion:e.version});clear();await refresh();status('Entry deleted.');})};actions.append(del);menu.append(actions);row.append(avatar,main,menu);$('entries').append(row);
 }}
 group(matching,q?'Matching this website':'Suggested for this website');group(others,q?'Other results':matching.length?'Other saved entries':'Saved entries');
 if(!visible.length){const empty=document.createElement('p');empty.className='empty-list';empty.textContent=q?'No matching entries. Try another search.':'Nothing saved yet. Press + to add your first login.';$('entries').append(empty)}
}
async function refresh(passive=false){const next=allEntries?await send('all-entries',{passive}):origin?await send('list',{origin,passive}):[];const same=passive&&JSON.stringify(next)===JSON.stringify(rows);rows=next;if(!same)render();syncStatus(await send('status'),passive)}
function syncStatus(s,background=false){lastRevision=s.revision;$('sync-now').hidden=!s.unlocked;if(background&&(s.syncState==='checking'||s.syncing))return;$('sync-now').hidden=!s.unlocked;$('sync-status').textContent=s.pending?'Saved on this computer. Upload to the cloud is pending.':s.syncState==='synced'?'Synced'+(s.lastSync?' · '+new Date(s.lastSync).toLocaleTimeString():''):s.syncState==='checking'?'Syncing…':s.syncState==='locked'?'':s.mode==='single-device'?'Backed up to the cloud'+(s.lastSync?' · checked '+new Date(s.lastSync).toLocaleTimeString():''):s.syncState||''}
function applyState(s){confirmOn=s.confirmReveal!==false;$('confirm-reveal').textContent='Passkey before showing a password: '+(confirmOn?'on':'off');$('lock-minutes').value=String(s.lockMinutes||5);document.documentElement?.classList?.toggle('is-unlocked',!!s.unlocked);document.documentElement?.classList?.toggle('needs-setup',!s.saved);$('onboarding').hidden=!!s.saved;$('origin').hidden=!s.saved||!origin;$('sync-now').hidden=!s.unlocked;$('passkey-form').hidden=s.unlocked||!s.saved;$('unlocked').hidden=!s.unlocked;$('lock').disabled=false;$('lock').hidden=!s.saved;$('new').hidden=!s.unlocked;}
async function initialize(){
 try{origin=(await send('page')).origin;$('origin').textContent=origin}catch(e){$('origin').textContent=e.message}
 const s=await send('status');applyState(s);
 if(s.busy){status('A vault operation is running. Reopen QVault when it finishes.');return}
 if(!s.saved){status('');return}if(!s.unlocked){status('Vault locked');return}await refresh();status('');
}
$('passkey-unlock').onclick=()=>work(async()=>{await send('open-unlock');window.close()});
$('lock').onclick=async()=>{uiEpoch++;busy=false;clear();rows=[];$('entries').replaceChildren();try{await send('lock');await work(initialize)}catch(e){status(e.message,'error')}};
$('search').oninput=render;
$('view').onchange=()=>work(async()=>{allEntries=$('view').value==='all';clear();$('website-label').hidden=!allEntries;$('search-label').textContent=allEntries?'Search all entries':'Search this website';await refresh();status('');});
$('new').onclick=()=>{if(!origin&&!allEntries){status('Choose All entries or open an HTTPS website first','error');return}clear();$('website-label').hidden=!allEntries;$('entry-id').value=crypto.randomUUID();$('website').value=origin;$('title').value=origin?new URL(origin).hostname:'';showEntryForm()};
$('cancel').onclick=clear;
$('generate').onclick=()=>work(async()=>{$('password').value=(await send('generate')).password});
$('entry-form').onsubmit=e=>{e.preventDefault();work(async()=>{status('Saving…');const targetOrigin=allEntries?new URL($('website').value).origin:origin;const result=await send('put',{origin:targetOrigin,scope:allEntries?'all':'site',id:$('entry-id').value||undefined,base:editingBase,create:!editingBase,hiddenPassword:editingHidden,entry:{title:$('title').value,username:$('username').value,password:$('password').value}});clear();await refresh();status(result.mode==='single-device'?'Saved and encrypted in your cloud storage. Keep your backup file for recovery.':result.conflicts?'Saved. A different edit from another computer was kept as a separate copy.':'Saved and encrypted in your cloud storage.');})};
$('sync-now').onclick=()=>work(async()=>{await send('sync');await refresh();status('Up to date.');});
$('setup-start').onclick=()=>work(async()=>{await send('open-manager');window.close()});
$('restore-start').onclick=()=>work(async()=>{await send('open-manager',{section:'restore'});window.close()});
// Website access is optional and asked from the browser directly. The request has to start in the click itself.
const ALL_SITES={origins:['https://*/*']};let inlineOn=false;
async function siteAccess(){try{inlineOn=await chrome.permissions?.contains?.(ALL_SITES)===true}catch{inlineOn=false}$('inline').textContent='Q button on all websites: '+(inlineOn?'on':'off')}
$('inline').onclick=()=>{if(!chrome.permissions?.request)return;const change=inlineOn?chrome.permissions.remove(ALL_SITES):chrome.permissions.request(ALL_SITES);work(async()=>{await change;await send('sync-inline');await siteAccess()})};
siteAccess();
// The choice is read at once: a background check finishing in between would put the old value back into the list.
$('lock-minutes').onchange=()=>{const minutes=Number($('lock-minutes').value);return work(async()=>{applyState(await send('set-lock-minutes',{minutes}))})};
// Seeing a saved password asks for the passkey again in the unlock window. Turning that off locks the vault once.
$('reveal').onclick=()=>work(async()=>{await send('open-unlock',{reveal:revealTarget});window.close()});
$('confirm-reveal').onclick=()=>work(async()=>{const off=confirmOn;await send('set-confirm-reveal',{value:!confirmOn});await initialize();if(off)status('The passkey check is off. Unlock again to continue.')});
$('settings').onclick=()=>work(async()=>{await send('open-manager');window.close()});
window.addEventListener('pagehide',()=>{uiEpoch++;clear();rows=[]});
work(initialize);

const lockPoll=setInterval(()=>{if(!busy)work(async()=>{const s=await send('status');applyState(s);if(s.unlocked){const changed=s.revision!==lastRevision;syncStatus(s,true);if(changed)await refresh(true);}if(!s.unlocked){document.documentElement?.classList?.remove('is-unlocked');$('sync-now').hidden=true;$('sync-status').textContent='';clear();rows=[];$('entries').replaceChildren();$('unlocked').hidden=true;$('new').hidden=true;$('passkey-form').hidden=!s.saved;status(s.saved?'Vault locked':'')}},true)},10000);window.addEventListener('pagehide',()=>clearInterval(lockPoll));
