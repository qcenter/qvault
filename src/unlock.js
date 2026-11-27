import {ProfileStore} from './profile-store.js';
import {acquireProfileLease} from './profile-store.js';
import {isPasskeyProfile,toBase64,addPasskeyToProfile,openProfile} from './profile-crypto.js';
import {passkeySecret,createPasskey,PasskeyError} from './passkey.js';
// Small extension window that runs the passkey prompt. A toolbar popup would close when the prompt takes focus.
const $=id=>document.getElementById(id),store=new ProfileStore();let busy=false,prompt=null;
function note(text,error=false){$('unlock-status').textContent=text;$('unlock-status').className=error?'storage-error':''}
async function send(message){const r=await chrome.runtime.sendMessage(message);if(!r)throw Error('QVault is unavailable. Reopen this window from the QVault toolbar icon.');if(r.error)throw Error(r.error);return r.data}
// Opened from the editor to show one saved password: the passkey is asked again and nothing is unlocked or changed.
const params=new URLSearchParams(globalThis.location?.search||''),reveal=params.get('reveal')?{id:params.get('reveal'),origin:params.get('origin')}:null;let hideTimer=null,shown='',fallback=false,left=0,copied=false;
// While a password is on screen the other controls step aside, so everything fits the small window without scrolling.
function roomFor(password){for(const id of ['passkey-actions','unlock-intro'])$(id).hidden=password;$('recovery-details').hidden=password||(!!reveal&&!fallback);$('unlock-main').className='unlock-window'+(password?' revealing':'')}
function hidePassword(){shown='';$('reveal-password').textContent='';$('reveal-previous').textContent='';$('reveal-previous').hidden=true;$('reveal-box').hidden=true;roomFor(false);clearInterval(hideTimer)}
function showPassword(entry){shown=entry.password;$('reveal-title').textContent=entry.title;$('reveal-user').textContent=entry.username;$('reveal-password').textContent=entry.password||'(no password saved)';if(entry.previous){let when='';try{when=' (replaced '+new Date(entry.previous.at).toLocaleString()+')'}catch{}$('reveal-previous').textContent='Previous password'+when+': '+entry.previous.password;$('reveal-previous').hidden=false}$('reveal-box').hidden=false;roomFor(true);left=30;copied=false;countdown();clearInterval(hideTimer);hideTimer=setInterval(()=>{left--;if(left<=0){hidePassword();note('Hidden again. You can close this window.')}else countdown()},1000)}
function countdown(){note((copied?'Copied. ':'')+'Hidden in '+left+' s.')}
if(reveal){$('unlock-heading').textContent='Show password';$('unlock-intro').textContent='Confirm with your passkey to see the saved password.';$('passkey-go-label').textContent='Confirm with passkey';$('recovery-details').hidden=true;$('recovery-add-label').hidden=true;$('recovery-submit').textContent='Show with recovery key'}
$('reveal-copy').onclick=async()=>{try{await navigator.clipboard.writeText(shown);copied=true;countdown()}catch{note('Could not copy. Select the password and copy it yourself.',true)}};
$('reveal-close').onclick=()=>{hidePassword();globalThis.close?.()};
function finish(){note('Unlocked. You can close this window and use QVault.');setTimeout(()=>globalThis.close?.(),900)}
async function withPasskey(){
 if(busy||prompt)return;const mine=prompt=new AbortController();$('passkey-go').disabled=true;let secret=null;
 try{
  const record=await store.read();
  if(!record){note('There is no vault on this device yet. Open Setup from the QVault toolbar icon.',true);return}
  if(!isPasskeyProfile(record)){note('This vault was made by an older version without passkeys, which is no longer supported. Reset this device on the Backup & restore page.',true);return}
  note('Confirm with your passkey…');secret=await passkeySecret({slots:record.slots,signal:mine.signal});
  if(mine.signal.aborted)return;busy=true;
  if(reveal){hidePassword();note('Checking…');showPassword(await send({action:'reveal',...reveal,prf:toBase64(secret.prf)}));return}
  note('Unlocking and reading your saved vault…');await send({action:'unlock',prf:toBase64(secret.prf)});finish();
 }catch(e){if(!mine.signal.aborted){// The passkey could not be used on this computer: only now is the recovery key offered for showing a password.
   if(reveal&&e instanceof PasskeyError){fallback=true;$('recovery-details').hidden=false}note(e.message+(e instanceof PasskeyError?' Try again, or use your recovery key below.':''),true)}}
 finally{secret?.prf?.fill(0);if(prompt===mine){prompt=null;busy=false}$('passkey-go').disabled=false}
}
$('passkey-go').onclick=withPasskey;
// A way out that does nothing: stop a waiting passkey prompt, clear what is on screen and close the window.
$('unlock-cancel').onclick=()=>{prompt?.abort();prompt=null;hidePassword();globalThis.close?.()};
// Optional: after the recovery key is proven correct, create a passkey for this computer so the key is not needed next time.
async function addPasskey(recoveryKey){
 const release=await acquireProfileLease();let made=null;
 try{const record=await store.read();if(!record||!isPasskeyProfile(record))throw Error('This vault cannot get a passkey here.');await openProfile(record,{recoveryKey});
  note('Confirm creating a passkey for this computer…');made=await createPasskey();const next=await addPasskeyToProfile(record,{recoveryKey},made);await store.save(next,record.revision)}
 finally{made?.prf?.fill(0);release()}
}
$('recovery-form').onsubmit=async e=>{e.preventDefault();if(busy)return;prompt?.abort();prompt=null;busy=true;const recoveryKey=$('recovery-key').value,add=$('recovery-add-passkey').checked===true;$('recovery-key').value='';
 try{if(reveal){hidePassword();note('Checking…');showPassword(await send({action:'reveal',...reveal,recoveryKey}));return}if(add){await addPasskey(recoveryKey);$('recovery-add-passkey').checked=false}note('Unlocking with your recovery key…');await send({action:'unlock',recoveryKey});finish()}
 catch(e){note(e.message+(e instanceof PasskeyError?' No passkey was added.':''),true)}finally{busy=false}};
globalThis.addEventListener?.('pagehide',()=>{$('recovery-key').value='';hidePassword()});
withPasskey();
