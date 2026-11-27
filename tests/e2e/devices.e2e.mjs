// Real-browser test with two separate browsers standing in for two computers that share one vault.
// Storage ignores conditional writes, like the real service did when this was written, so the vault runs in its
// backup mode: every save is uploaded, the other computer picks it up by itself, and a save is refused while a newer copy exists.
// Covers: backup file download, restore into a clean browser, first unlock there with the recovery key plus a new passkey,
// changes travelling both ways without locking, the refused save, and the idle lock. Stand-ins for storage and passkeys.
// Run: npm run test:e2e   (this file waits for real timers and takes a few minutes)
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {startFakeQStorage} from './fake-qstorage.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),bucket='qvault-e2e-bucket';
const storage=await startFakeQStorage({bucket,conditionalWrites:false}),scratch=mkdtempSync(path.join(tmpdir(),'qvault-e2e-two-'));
const launch=name=>chromium.launchPersistentContext(path.join(scratch,name),{channel:'chromium',headless:true,acceptDownloads:true,args:['--disable-extensions-except='+root,'--load-extension='+root,'--host-resolver-rules=MAP qstorage.quilibrium.com 127.0.0.1:'+storage.port,'--ignore-certificate-errors','--no-proxy-server']});
const step=text=>console.log('  ok  '+text);
async function computer(name){const context=await launch(name),worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:30000}),base='chrome-extension://'+new URL(worker.url()).host+'/';
 const authenticator=async page=>{const cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',ctap2Version:'ctap2_1',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,hasPrf:true,automaticPresenceSimulation:true}})};
 const key=await context.newPage();await authenticator(key);await key.addInitScript(()=>{window.close=()=>{}});// this tab holds the computer's passkey
 const me={name,context,worker,base,key,popup:null,
  status:()=>me.popup.evaluate(async()=>(await chrome.runtime.sendMessage({action:'status'})).data),
  async openPopup(){me.popup=await context.newPage();await me.popup.goto(base+'popup.html');return me.popup},
  async unlockWithPasskey(){await key.goto(base+'unlock.html');await key.waitForFunction(()=>/^Unlocked/.test(document.getElementById('unlock-status').textContent),null,{timeout:60000}).catch(async e=>{throw Error(name+': passkey unlock failed: '+await key.textContent('#unlock-status'))})},
  titles:()=>me.popup.evaluate(()=>[...document.querySelectorAll('#entries .record strong')].map(n=>n.textContent)),
  async sees(title,ms=60000){await me.popup.waitForFunction(t=>[...document.querySelectorAll('#entries .record strong')].some(n=>n.textContent===t),title,{timeout:ms}).catch(async()=>{throw Error(name+' never showed "'+title+'"; it shows '+JSON.stringify(await me.titles())+', status: '+await me.popup.textContent('#status'))})},
  async add(title){await me.popup.click('#new');await me.popup.fill('#website','https://example.test');await me.popup.fill('#title',title);await me.popup.fill('#username','user-'+title);await me.popup.fill('#password','FICTIONAL-'+title);await me.popup.click('#entry-form button[type=submit]')}};
 return me}
const A=await computer('a'),B=await computer('b');
try{
 // ---- computer A: a vault with one entry, and its backup file
 await A.key.goto(A.base+'setup.html');await A.key.waitForFunction(()=>document.getElementById('profile-state').textContent==='NO PROFILE YET');
 await A.key.fill('#storage-bucket',bucket);await A.key.fill('#storage-access','FICTIONAL_E2E_ACCESS');await A.key.fill('#storage-secret','FICTIONAL_E2E_STORAGE_SECRET');await A.key.uncheck('#storage-qkms');await A.key.click('#storage-submit');
 await A.key.waitForSelector('#recovery-panel',{state:'visible',timeout:60000});const recoveryKey=(await A.key.textContent('#recovery-key-text')).trim();await A.key.check('#recovery-ack');await A.key.click('#recovery-done');
 const backupPage=await A.context.newPage();await backupPage.goto(A.base+'recovery.html');await backupPage.waitForFunction(()=>!document.getElementById('backup').disabled,null,{timeout:30000});
 const [download]=await Promise.all([backupPage.waitForEvent('download'),backupPage.click('#backup')]),backupFile=path.join(scratch,'backup.json');await download.saveAs(backupFile);assert.match(await backupPage.textContent('#profile-message'),/passkey or your recovery key/);await backupPage.close();
 await A.unlockWithPasskey();await A.openPopup();await A.popup.waitForSelector('#unlocked',{state:'visible',timeout:30000});await A.add('first');await A.sees('first');
 assert.equal((await A.status()).mode,'single-device','this storage ignores conditional writes, so the vault is in backup mode');assert.match(await A.popup.textContent('#sync-status'),/Backed up to the cloud/);
 step('computer A: vault created, backup file downloaded, first entry saved in backup mode');

 // ---- computer B: restore the file into a clean browser, unlock with the recovery key, get a passkey of its own
 const restorePage=await B.context.newPage();await restorePage.goto(B.base+'recovery.html');await restorePage.waitForFunction(()=>!document.getElementById('restore-profile').disabled,null,{timeout:30000});
 await restorePage.setInputFiles('#restore-profile',backupFile);await restorePage.waitForFunction(()=>/Vault restored/.test(document.getElementById('profile-message').textContent),null,{timeout:30000});assert.match(await restorePage.textContent('#profile-message'),/Unlock with passkey/);assert.doesNotMatch(await restorePage.textContent('#profile-message'),/master password/);await restorePage.close();
 await B.key.goto(B.base+'unlock.html');await B.key.waitForFunction(()=>document.getElementById('unlock-status').className==='storage-error',null,{timeout:60000});// no passkey on this computer yet
 await B.key.evaluate(()=>{document.querySelector('.recovery-unlock').open=true});assert.equal(await B.key.isChecked('#recovery-add-passkey'),true,'a passkey for the new computer is offered by default');
 await B.key.fill('#recovery-key',recoveryKey);await B.key.click('#recovery-form button[type=submit]');await B.key.waitForFunction(()=>/^Unlocked/.test(document.getElementById('unlock-status').textContent),null,{timeout:60000}).catch(async()=>{throw Error('recovery unlock on B failed: '+await B.key.textContent('#unlock-status'))});
 await B.openPopup();await B.popup.waitForSelector('#unlocked',{state:'visible',timeout:30000});await B.sees('first');
 await B.popup.click('#lock');await B.popup.waitForSelector('#passkey-form',{state:'visible',timeout:30000});await B.unlockWithPasskey();await B.popup.reload();await B.popup.waitForSelector('#unlocked',{state:'visible',timeout:30000});await B.sees('first');
 step('computer B: backup restored into a clean browser, unlocked with the recovery key, and its own new passkey unlocks it afterwards');

 // ---- changes travel both ways while both stay unlocked
 await A.add('from-a');await A.sees('from-a');await B.sees('from-a');step('a change on A appears on B without locking');
 await B.add('from-b');await B.sees('from-b');await A.sees('from-b');step('a change on B appears on A without locking');

 // ---- two saves at almost the same moment: the second is refused, not merged over the first, and works once the first has arrived
 await A.add('quick-a');await A.sees('quick-a');await B.add('quick-b');
 await B.popup.waitForFunction(()=>/Another computer just saved/.test(document.getElementById('status').textContent),null,{timeout:30000}).catch(async()=>{throw Error('B was not refused; status: '+await B.popup.textContent('#status')+', entries: '+JSON.stringify(await B.titles()))});
 assert.equal(await B.popup.evaluate(()=>document.getElementById('status').className),'error');await B.sees('quick-a');assert.ok(!(await B.titles()).includes('quick-b'),'the refused change is not half-saved');
 await B.popup.click('#cancel').catch(()=>{});await B.add('quick-b');await B.sees('quick-b');await A.sees('quick-b');
 for(const who of [A,B])assert.deepEqual((await who.titles()).sort(),['first','from-a','from-b','quick-a','quick-b'],who.name+' has every entry exactly once');
 step('a save made a moment after the other computer saved is refused, loads the other change, and succeeds when repeated; both end with the same five entries');

 // ---- idle lock at the shortest setting
 await A.popup.evaluate(()=>{document.querySelector('.settings-menu').open=true});await A.popup.selectOption('#lock-minutes','1');for(let i=0;i<30&&(await A.status()).lockMinutes!==1;i++)await new Promise(r=>setTimeout(r,250));assert.equal((await A.status()).lockMinutes,1);
 const started=Date.now();assert.equal((await A.status()).unlocked,true);while((await A.status()).unlocked){if(Date.now()-started>120000)throw Error('the vault did not lock itself within two minutes');await new Promise(r=>setTimeout(r,2000))}const took=Math.round((Date.now()-started)/1000);assert.ok(took>=50&&took<=100,'locked after about a minute, not at once and not much later (took '+took+' s)');
 await A.popup.waitForSelector('#passkey-form',{state:'visible',timeout:30000});for(let i=0;i<40&&await A.worker.evaluate(()=>chrome.action.getTitle({}))!=='QVault: locked';i++)await new Promise(r=>setTimeout(r,250));assert.equal(await A.worker.evaluate(()=>chrome.action.getTitle({})),'QVault: locked');
 assert.equal((await B.status()).unlocked,true,'the other computer is not affected');step('with the lock time set to 1 minute an unused vault locked itself after '+took+' s and the toolbar icon followed');

 const everything=[...storage.objects.values()].map(o=>o.body).join('\n');for(const secret of ['FICTIONAL-first','user-from-a','quick-b',recoveryKey])assert.ok(!everything.includes(secret),'cloud storage must only hold ciphertext');
 console.log('PASS E2E DEVICES: two real Chromium browsers sharing one vault through a storage stand-in that ignores conditional writes: backup download, restore into a clean browser, recovery-key unlock with a new passkey, changes both ways without locking, a refused near-simultaneous save, and the one-minute idle lock. Virtual authenticators; the real QStorage, QKMS and Touch ID are not covered.');
}finally{await A.context.close();await B.context.close();await storage.close();rmSync(scratch,{recursive:true,force:true})}
