import {BrowserParticipant} from './vault-runtime.js';
import {checkPasskeyPrf,passkeyCheckMessage} from './passkey-check.js';
import {runNotifyCheck,notifyCheckMessage} from './notify-check.js';
const $=id=>document.getElementById(id);let peer=null,epoch=0;
function stop(){epoch++;peer?.stop();peer=null;$('local-check').disabled=false;$('local-stop').disabled=true;$('local-stop').hidden=true;$('local-status').textContent='Local check cancelled. No cloud operation was performed.'}
$('local-stop').onclick=stop;
$('local-check').onclick=async()=>{if(peer)return;const current=++epoch,p=new BrowserParticipant();peer=p;$('local-check').disabled=true;$('local-stop').disabled=false;$('local-stop').hidden=false;$('local-status').textContent='Checking local encryption components and a random-data recovery…';try{const result=await p.call('local',{},240000);if(current!==epoch)return;if(result.ready!==true)throw Error('Local components did not confirm readiness');$('local-status').textContent='Local checks passed. Encryption components initialized and the random data was recovered correctly. No cloud service was tested.'}catch(e){if(current===epoch)$('local-status').textContent='Local check did not pass. '+e.message}finally{p.stop();if(current===epoch){peer=null;$('local-check').disabled=false;$('local-stop').disabled=true;$('local-stop').hidden=true}}};
const passkeySteps={create:'Step 1 of 3: confirm creating the test passkey…','use-1':'Step 2 of 3: confirm using the test passkey…','use-2':'Step 3 of 3: confirm using it once more…'};let passkeyBusy=false;
$('passkey-check').onclick=async()=>{if(passkeyBusy)return;passkeyBusy=true;$('passkey-check').disabled=true;$('passkey-status').textContent='Starting the passkey check…';try{$('passkey-status').textContent=passkeyCheckMessage(await checkPasskeyPrf({onStep:step=>{$('passkey-status').textContent=passkeySteps[step]||'Waiting for your confirmation…'}}))}catch{$('passkey-status').textContent='The passkey check failed. Nothing was changed in QVault.'}finally{passkeyBusy=false;$('passkey-check').disabled=false}};
window.addEventListener('pagehide',()=>{epoch++;peer?.stop();peer=null});

// Experimental: could this account sync at once through QPing and QQ? Uses the typed access details for this run only.
const NOTIFY_ORIGINS={origins:['https://qping.quilibrium.com/*','https://qq.quilibrium.com/*']};let notifyBusy=false;
$('notify-form').onsubmit=event=>{event.preventDefault();if(notifyBusy)return;
 const credentials={accessKey:$('notify-access').value.trim(),secretKey:$('notify-secret').value,region:'q-world-1'};$('notify-access').value='';$('notify-secret').value='';
 // The permission request has to start in the click itself.
 const allowed=globalThis.chrome?.permissions?.request?chrome.permissions.request(NOTIFY_ORIGINS):Promise.resolve(true);
 notifyBusy=true;$('notify-run').disabled=true;$('notify-log').replaceChildren();$('notify-status').textContent='Running the instant sync check…';
 (async()=>{try{if(await allowed!==true){$('notify-status').textContent='Not run: the browser was not allowed to contact QPing and QQ.';return}
  const result=await runNotifyCheck({credentials,log:line=>{const item=document.createElement('li');item.textContent=line;$('notify-log').append(item)}});$('notify-status').textContent=notifyCheckMessage(result)}
 catch(e){$('notify-status').textContent='The check could not run. '+(e?.message||'Unknown error')}
 finally{credentials.accessKey='';credentials.secretKey='';try{await globalThis.chrome?.permissions?.remove?.(NOTIFY_ORIGINS)}catch{}notifyBusy=false;$('notify-run').disabled=false}})()};
