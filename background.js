import {createBroker} from './browser-broker.js';
let creating;
async function ensureVault(){
 if(!chrome.offscreen?.createDocument||!chrome.runtime.getContexts)throw Error('This browser needs offscreen document support for QVault');
 const url=chrome.runtime.getURL('offscreen.html');const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[url]});if(contexts.length)return;
 if(!creating)creating=chrome.offscreen.createDocument({url:'offscreen.html',reasons:['WORKERS'],justification:'Keep QKMS cryptographic participant workers alive while the password popup is closed.'}).finally(()=>creating=null);await creating;
}
async function vault(command){await ensureVault();const r=await chrome.runtime.sendMessage({target:'qvault-offscreen',command});if(!r)throw Error('QVault background is unavailable');if(r.error)throw Error(r.error);return r.data}
const broker=createBroker(chrome,vault);
// The offscreen vault reports every lock and unlock, including the idle lock, so the toolbar badge stays right while the popup is closed.
const offscreenUrl=chrome.runtime.getURL('offscreen.html');
chrome.runtime.onMessage.addListener((m,s,reply)=>{if(m?.target==='qvault-offscreen')return;if(m?.target==='qvault-background'){if(s.id===chrome.runtime.id&&!s.tab&&s.url===offscreenUrl&&m.event==='lock-state')broker.showLock(m.unlocked===true);return}Promise.resolve().then(()=>broker.handle(m,s)).then(data=>reply({data}),e=>reply({error:e instanceof SyntaxError?'Invalid vault data':e.message}));return true});
// The badge does not survive a browser restart or an extension reload, so set it again from the vault's own answer.
const markIcon=()=>vault({action:'status'}).then(s=>broker.showLock(s.unlocked===true,s.saved)).catch(()=>{});
chrome.runtime.onInstalled.addListener(()=>{broker.enableInline().catch(()=>{});markIcon()});
chrome.runtime.onStartup.addListener(()=>{broker.enableInline().catch(()=>{});markIcon()});
chrome.permissions?.onAdded?.addListener(()=>broker.enableInline().catch(()=>{}));
chrome.permissions?.onRemoved?.addListener(()=>broker.enableInline().catch(()=>{}));
// Lock an open vault as soon as the computer locks, which is also what a sleeping laptop does. A short pause does not count.
// If the vault page is not running there is nothing to lock, and it is not started just for this.
async function lockIfLoaded(){const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[offscreenUrl]});if(!contexts.length)return;await vault({action:'lock'})}
chrome.idle?.onStateChanged?.addListener(state=>{if(state==='locked')lockIfLoaded().catch(()=>{})});
