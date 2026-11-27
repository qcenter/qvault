import {ProfileStore,acquireProfileLease} from './profile-store.js';
import {bucketHelp,BucketSetupError} from './bucket-help.js';
import {SetupPasskeyVault,SetupPasskeyError} from './setup-passkey.js';
import {PasskeyError} from './passkey.js';
import {isPasskeyProfile} from './profile-crypto.js';
import {createHostedKey} from './setup-vault.js';
import {BrowserParticipant} from './vault-runtime.js';
const $=id=>document.getElementById(id),store=new ProfileStore(),passkeyVault=new SetupPasskeyVault({store,lease:acquireProfileLease,hostedKey:options=>createHostedKey({...options,makePeer:onEvent=>{const peer=new BrowserParticipant();peer.onEvent=onEvent;return peer}})});let busy=false,mode='new',recoveryKey='';const sessionAbort=new AbortController();
const texts={checking:'Checking the bucket…',creating:'Creating a private bucket…',verifying:'Checking bucket access…',reopening:'Reopening your vault with the new storage settings…',saving:'Saving encrypted settings on this device…','profile-saved':'Cloud storage settings saved in your encrypted profile. Your vault was reopened successfully.','settings-saved':'Storage settings saved encrypted on this device.',passkey:'Confirm creating your passkey, for example with Touch ID…','passkey-confirm':'Confirm with your passkey…','vault-starting':'Creating the QKMS key: starting the local participant…','vault-preparing':'Creating the QKMS key: preparing key material on this device. Keep this page open.','vault-creating':'Creating the QKMS key: asking the service…','vault-waiting':'Creating the QKMS key: waiting for it to become ready. This usually takes about a minute…','vault-verifying':'Checking that the new key can encrypt and decrypt…','vault-reopening':'Checking that the key still works after a restart…','vault-created':'Vault created. Save your recovery key below, then open the QVault toolbar icon and unlock with your passkey.'};
// One card, two states: no vault yet (set up with a passkey) or a passkey vault (its storage access can be replaced).
const states={
 new:{badge:'NO PROFILE YET',title:'Set up your vault',description:'Connect your cloud storage, then create a passkey. Already have a vault? Restore it on the Backup & restore page.',heading:'Cloud storage',intro:'Where your encrypted vault is kept. The bucket is checked and created privately if it does not exist.',action:'Set up vault with passkey',saved:''},
 passkey:{badge:'PROFILE SAVED',title:'Your vault is ready',description:'Open the QVault toolbar icon and choose Unlock with passkey.',heading:'Cloud storage settings',intro:'To replace the access key and secret, enter the new pair and confirm with your passkey. Lock the vault first.',action:'Save cloud storage',saved:'Leave a field blank to keep what is saved. The bucket and region cannot change once the vault holds data.'}
};
// Step indicator for first-time setup: 1 storage, 2 passkey, 3 second lock (QKMS, optional), 4 recovery key.
const STEP={checking:1,creating:1,verifying:1,passkey:2,'vault-starting':3,'vault-preparing':3,'vault-creating':3,'vault-waiting':3,'vault-verifying':3,'vault-reopening':3,'vault-created':4};let stepping=false,currentStep=0;
function steps(active,{qkms=true,error=false}={}){currentStep=active;for(let n=1;n<=4;n++)$('step-'+n).className='step'+(n===3&&!qkms?' skipped':n<active?' done':n===active?(error?' error':' active'):'')}
async function refresh(){
 const record=await store.read();mode=record?'passkey':'new';const state=states[mode],old=!!record&&!isPasskeyProfile(record);
 $('profile-state').textContent=state.badge;$('profile-title').textContent=state.title;$('profile-description').textContent=state.description;$('storage-heading').textContent=state.heading;$('storage-intro').textContent=state.intro;$('storage-submit-label').textContent=state.action;
 // A profile from a version that did not use passkeys cannot be opened any more; say so instead of offering a form that cannot work.
 $('storage-saved').textContent=old?'This vault was made by an older version without passkeys, which is no longer supported. Reset this device on the Backup & restore page, then set up a new vault.':state.saved;$('storage-saved').hidden=!(old||state.saved);
 const keep=mode!=='new';$('storage-form').hidden=old;
 $('storage-bucket').required=!keep;$('storage-access').required=!keep;$('storage-secret').required=!keep;$('storage-bucket').placeholder=keep?'Leave blank to keep saved bucket':'qvault-yourname';$('storage-access').placeholder=keep?'Leave blank to keep saved access key':'Access key ID';$('storage-secret').placeholder=keep?'Leave blank to keep saved secret':'Secret access key';
 showFinish();$('recovery-panel').hidden=!recoveryKey;$('storage-qkms-label').hidden=mode!=='new';$('setup-steps').hidden=mode!=='new'&&!stepping;if(mode==='new'&&!busy&&!stepping)steps(0,{qkms:$('storage-qkms').checked===true});
 return record;
}
function logLine(text){const li=document.createElement('li'),time=document.createElement('time'),span=document.createElement('span');time.textContent=new Date().toLocaleTimeString();span.textContent=text;li.append(time,span);const list=$('storage-log');list.append(li);if(list.children.length>300)list.firstElementChild?.remove?.();$('storage-activity').hidden=false}
function lockForm(value){for(const id of ['storage-submit','storage-access','storage-secret','storage-bucket','storage-region','storage-qkms'])$(id).disabled=value}
function plain(text){$('storage-status').className='storage-error';$('storage-status').textContent=text;logLine('Stopped: '+text)}
function errorMessage(error){
 if(error instanceof SetupPasskeyError||error instanceof PasskeyError){plain(error.message+(error instanceof PasskeyError?' Nothing was saved; you can try again.':''));return}
 if(!(error instanceof BucketSetupError)&&mode==='new'&&!/fetch|network/i.test(error?.message||'')){plain('Setup failed: '+(error?.message||'unexpected error')+' Nothing was saved.');return}
 $('storage-status').className='storage-error';const help=bucketHelp(error);$('storage-status').textContent=help.title;for(const step of help.steps){const li=document.createElement('li');li.textContent=step;$('storage-next-steps').append(li)}$('storage-error-reference').textContent=help.reference;$('storage-help').hidden=false;
}
function clearError(){$('storage-help').hidden=true;$('storage-next-steps').replaceChildren();$('storage-status').className=''}
function showRecovery(key){recoveryKey=key;$('recovery-key-text').textContent=key;$('recovery-ack').checked=false;$('recovery-note').textContent='';$('recovery-panel').hidden=false}
function clearRecovery(){recoveryKey='';$('recovery-key-text').textContent='';$('recovery-panel').hidden=true}
$('recovery-copy').onclick=async()=>{try{await navigator.clipboard.writeText(recoveryKey);$('recovery-note').textContent='Copied. Paste it somewhere safe, then clear your clipboard.'}catch{$('recovery-note').textContent='Could not copy. Select the key and copy it yourself.'}};
$('recovery-download').onclick=()=>{const url=URL.createObjectURL(new Blob(['QVault recovery key\n\n'+recoveryKey+'\n\nKeep this somewhere safe and away from the computer that holds your vault.\n'],{type:'text/plain'}));try{const a=document.createElement('a');a.href=url;a.download='qvault-recovery-key.txt';a.click();$('recovery-note').textContent='Downloaded. Move the file somewhere safe; do not leave it in Downloads.'}finally{setTimeout(()=>URL.revokeObjectURL(url),1000)}};
$('recovery-done').onclick=()=>{if(!$('recovery-ack').checked){$('recovery-note').textContent='Confirm that you saved the recovery key first. It cannot be shown again.';return}clearRecovery();if(stepping){steps(5,{qkms:lastQkms});finished=true;showFinish()}};
// After first-time setup the page has nothing left to ask: show a closing panel instead of the settings form.
let finished=false;function showFinish(){$('finish-panel').hidden=!finished;for(const id of ['storage-form','storage-heading','storage-intro'])$(id).hidden=finished;if(finished)$('storage-saved').hidden=true}
$('finish-close').onclick=()=>{try{chrome.tabs.getCurrent(tab=>tab?chrome.tabs.remove(tab.id):window.close())}catch{window.close()}};
$('finish-settings').onclick=()=>{finished=false;stepping=false;refresh()};
$('storage-qkms').onchange=()=>{if(!busy&&mode==='new'&&!stepping)steps(0,{qkms:$('storage-qkms').checked===true})};let lastQkms=true;
$('storage-form').onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;clearError();$('storage-log').replaceChildren();$('storage-activity').hidden=true;
 const setup=mode==='new',qkms=$('storage-qkms').checked===true;if(setup){stepping=true;lastQkms=qkms;$('setup-steps').hidden=false;steps(1,{qkms})}
 let lastPhase='';const progress=(phase,seconds,task)=>{if(setup&&STEP[phase])steps(STEP[phase],{qkms});const text=texts[phase]||'Checking cloud storage…';$('storage-status').textContent=text+(task?' Round '+task.round+' of '+task.totalRounds+'.':'')+(seconds?' ('+seconds+'s)':'');if(phase!==lastPhase){lastPhase=phase;logLine(text)}};
 const request={signal:sessionAbort.signal,credentials:{accessKey:$('storage-access').value,secretKey:$('storage-secret').value,region:$('storage-region').value.trim()},bucket:$('storage-bucket').value.trim(),onProgress:progress,onLog:logLine,qkms};
 for(const id of ['storage-access','storage-secret'])$(id).value='';lockForm(true);
 try{if(mode==='new'){const result=await passkeyVault.create(request);showRecovery(result.recoveryKey)}else await passkeyVault.updateStorage(request)}
 catch(error){if(setup)steps(currentStep||1,{qkms,error:true});errorMessage(error)}
 finally{request.credentials.accessKey='';request.credentials.secretKey='';busy=false;try{await refresh()}catch(error){errorMessage(error)}lockForm(false)}};
refresh().catch(errorMessage);

globalThis.addEventListener?.('pagehide',()=>{sessionAbort.abort();clearRecovery();for(const id of ['storage-access','storage-secret'])$(id).value=''});
