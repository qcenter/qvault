import {VaultRuntime} from './vault-runtime.js';
// Tell the background when the vault locks or unlocks; it only updates the toolbar badge.
const report=unlocked=>{try{Promise.resolve(chrome.runtime.sendMessage({target:'qvault-background',event:'lock-state',unlocked})).catch(()=>{})}catch{}};
const vault=new VaultRuntime({onState:report});
chrome.runtime.onMessage.addListener((m,s,reply)=>{
 if(m?.target!=='qvault-offscreen')return;
 if(s.id!==chrome.runtime.id||s.tab){reply({error:'Unauthorized vault request'});return}
 vault.command(m.command).then(data=>reply({data}),e=>reply({error:e instanceof SyntaxError?'Invalid protected data':e.message}));return true;
});
window.addEventListener('pagehide',()=>vault.lock());
