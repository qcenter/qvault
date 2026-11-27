// Real-browser test: loads the unpacked extension into Chromium and drives the actual pages.
// Storage is a local stand-in for QStorage; the passkey is Chromium's virtual authenticator. No real service or credential is used.
// Run: npm run test:e2e   (needs `npx playwright install chromium` once, and openssl)
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {startFakeQStorage} from './fake-qstorage.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const EXPECTED_ID='pcgfaecdkkclfffceampfgfkcnhnbkjk',bucket='qvault-e2e-bucket',PASSWORD='FICTIONAL-E2E-ENTRY-PASSWORD',SECRET='FICTIONAL_E2E_STORAGE_SECRET';
const storage=await startFakeQStorage({bucket}),profile=mkdtempSync(path.join(tmpdir(),'qvault-e2e-profile-'));
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:['--disable-extensions-except='+root,'--load-extension='+root,'--host-resolver-rules=MAP qstorage.quilibrium.com 127.0.0.1:'+storage.port,'--ignore-certificate-errors','--no-proxy-server']});
const step=text=>console.log('  ok  '+text);
async function authenticator(page){const cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',ctap2Version:'ctap2_1',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,hasPrf:true,automaticPresenceSimulation:true}});return cdp}
try{
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:30000}),id=new URL(worker.url()).host,base='chrome-extension://'+id+'/';
 assert.equal(id,EXPECTED_ID,'the manifest key must give the same extension ID everywhere');
 const manifest=JSON.parse(readFileSync(path.join(root,'manifest.json'),'utf8'));step('extension loaded as '+id+' (version '+manifest.version+')');

 // Diagnostics: the passkey check against the virtual authenticator
 const lab=await context.newPage();await authenticator(lab);await lab.goto(base+'lab.html');await lab.click('#passkey-check');
 await lab.waitForFunction(()=>/^Passed/.test(document.getElementById('passkey-status').textContent),null,{timeout:30000});await lab.close();step('Diagnostics passkey check passes');

 // Setup: storage + passkey, local vault key only (the QKMS layer needs the real service)
 const setup=await context.newPage();await authenticator(setup);await setup.goto(base+'setup.html');
 await setup.waitForFunction(()=>document.getElementById('profile-state').textContent==='NO PROFILE YET');
 assert.equal(await setup.locator('#storage-master').count(),0,'Setup has no master password field');
 await setup.fill('#storage-bucket',bucket);await setup.fill('#storage-access','FICTIONAL_E2E_ACCESS');await setup.fill('#storage-secret',SECRET);await setup.uncheck('#storage-qkms');await setup.click('#storage-submit');
 await setup.waitForSelector('#recovery-panel',{state:'visible',timeout:60000}).catch(async e=>{throw Error('setup failed: '+await setup.textContent('#storage-status')+' | log: '+await setup.textContent('#storage-log')+' / '+e.message.split('\n')[0])});
 const recoveryKey=(await setup.textContent('#recovery-key-text')).trim();assert.match(recoveryKey,/^([A-Z2-7]{4}-){12}[A-Z2-7]{4}$/);
 assert.equal(await setup.textContent('#profile-state'),'PROFILE SAVED');assert.equal(await setup.inputValue('#storage-secret'),'');
 await setup.click('#recovery-done');assert.equal(await setup.isVisible('#recovery-panel'),true,'the recovery key cannot be dismissed unconfirmed');
 await setup.check('#recovery-ack');await setup.click('#recovery-done');assert.equal(await setup.isVisible('#recovery-panel'),false);assert.equal(await setup.textContent('#recovery-key-text'),'');
 step('Setup created a passkey vault and showed the recovery key once');

 // Unlock with the passkey (same tab, so the same virtual authenticator holds the passkey)
 const popupState=async page=>page.evaluate(async()=>(await chrome.runtime.sendMessage({action:'status'})).data);
 await setup.addInitScript(()=>{window.close=()=>{}}); // keep this tab: it holds the virtual passkey and is reused for the reset step
 await setup.goto(base+'unlock.html');await setup.waitForFunction(()=>/^Unlocked/.test(document.getElementById('unlock-status').textContent),null,{timeout:60000}).catch(async e=>{throw Error('passkey unlock failed: '+await setup.textContent('#unlock-status').catch(()=>'(window closed)')+' / '+e.message)});
 // The offscreen vault reports the unlock to the background, which marks the toolbar icon
 const badge=async want=>{for(let i=0;i<50;i++){if(await worker.evaluate(()=>chrome.action.getTitle({}))===want)return;await new Promise(r=>setTimeout(r,100))}throw Error('toolbar icon title is not '+JSON.stringify(want))};
 await badge('QVault: unlocked');
 step('unlock window unlocked the vault with the passkey; toolbar icon switched to unlocked');

 // Popup: add an entry, which is encrypted and uploaded
 const popup=await context.newPage();await popup.goto(base+'popup.html');await popup.waitForSelector('#unlocked',{state:'visible',timeout:30000});
 assert.equal((await popupState(popup)).auth,'passkey');
 await popup.click('#new');await popup.fill('#website','https://example.test');await popup.fill('#title','E2E entry');await popup.fill('#username','e2e-user');await popup.fill('#password',PASSWORD);await popup.click('#entry-form button[type=submit]');
 await popup.waitForFunction(()=>[...document.querySelectorAll('#entries .record strong')].some(n=>n.textContent==='E2E entry'),null,{timeout:60000}).catch(async e=>{throw Error('saving failed: '+await popup.textContent('#status')+' / '+e.message)});
 const snapshots=[...storage.objects].filter(([k])=>/^qvault\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.json$/.test(k));assert.ok(snapshots.length>=1,'a snapshot was uploaded');
 const everything=[...storage.objects.values()].map(o=>o.body).join('\n');for(const secret of [PASSWORD,'e2e-user','E2E entry',SECRET,recoveryKey])assert.ok(!everything.includes(secret),'cloud storage must only hold ciphertext');
 assert.ok(snapshots.every(([,o])=>JSON.parse(o.body).format==='qvault-passwords-v2'),'snapshots use the local-vault-key format');
 step('entry saved; cloud holds only ciphertext in the v2 format ('+snapshots.length+' snapshot)');

 // Lock, then unlock with the recovery key in a tab whose authenticator has no passkey
 await popup.click('#lock');await popup.waitForSelector('#passkey-form',{state:'visible',timeout:30000});assert.equal(await popup.locator('#unlock-form').count(),0);assert.equal((await popupState(popup)).unlocked,false);await badge('QVault: locked');
 const recovery=await context.newPage();await authenticator(recovery);await recovery.goto(base+'unlock.html');
 await recovery.evaluate(()=>{document.querySelector('.recovery-unlock').open=true});await recovery.fill('#recovery-key','AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA');await recovery.click('#recovery-form button[type=submit]');
 await recovery.waitForFunction(()=>/does not open/.test(document.getElementById('unlock-status').textContent),null,{timeout:30000});assert.equal((await popupState(popup)).unlocked,false);
 await recovery.fill('#recovery-key',recoveryKey);await recovery.click('#recovery-form button[type=submit]');
 await popup.waitForFunction(async()=>(await chrome.runtime.sendMessage({action:'status'})).data.unlocked===true,null,{timeout:60000});
 step('wrong recovery key refused; correct recovery key unlocked');

 // The entry comes back from the cloud copy with its password intact
 await popup.reload();await popup.waitForFunction(()=>[...document.querySelectorAll('#entries .record strong')].some(n=>n.textContent==='E2E entry'),null,{timeout:60000});
 await popup.click('#entries .record .record-main');await popup.waitForSelector('#entry-form',{state:'visible'});assert.equal(await popup.inputValue('#username'),'e2e-user');
 // The editor does not get the saved password; it is shown only after the passkey is confirmed again in the unlock window.
 assert.equal(await popup.inputValue('#password'),'');assert.equal(await popup.isVisible('#reveal'),true);const entryId=await popup.inputValue('#entry-id');
 await setup.goto(base+'unlock.html?'+new URLSearchParams({reveal:entryId,origin:'https://example.test'}));await setup.waitForFunction(p=>document.getElementById('reveal-password').textContent===p,PASSWORD,{timeout:60000}).catch(async e=>{throw Error('showing the password failed: '+await setup.textContent('#unlock-status')+' / '+e.message)});assert.equal((await popupState(popup)).unlocked,true);
 step('entry reopened after lock; its password is shown only after the passkey is confirmed again');

 // Least privilege: nothing is injected into pages and no site access is held by default
 const granted=await popup.evaluate(()=>chrome.permissions.contains({origins:['https://*/*']})),registered=await worker.evaluate(()=>chrome.scripting.getRegisteredContentScripts());
 assert.equal(granted,false);assert.deepEqual(registered,[]);step('no website access and no injected script by default');
 // Reset this device, confirmed with the passkey (the tab that created it), returns the popup to first-time setup
 await popup.goto(base+'popup.html');await popup.waitForSelector('#lock',{state:'visible'});await popup.click('#lock');await popup.waitForSelector('#passkey-form',{state:'visible',timeout:30000});
 {const manage=setup;
  await manage.goto(base+'recovery.html');await manage.waitForFunction(()=>document.getElementById('profile-state').textContent==='PROFILE SAVED');
  await manage.evaluate(()=>{document.getElementById('reset-details').open=true});await manage.click('#reset-open');await manage.waitForSelector('#reset-form',{state:'visible'});
  assert.match(await manage.textContent('#reset-secret-label'),/Recovery key/);await manage.fill('#reset-confirm','RESET');await manage.check('#reset-ack');await manage.click('#reset-submit');
  await manage.waitForFunction(()=>document.getElementById('profile-state').textContent==='NO PROFILE YET',null,{timeout:30000}).catch(async e=>{throw Error('reset failed: '+await manage.textContent('#reset-message')+' / '+e.message.split('\n')[0])});
  await popup.reload();await popup.waitForSelector('#onboarding',{state:'visible',timeout:30000});await badge('QVault: not set up');step('Reset this device confirmed with the passkey; popup is back at first-time setup');
 }
 console.log('PASS E2E: real Chromium with the unpacked extension: fixed extension ID, Diagnostics passkey check, passkey vault setup, passkey unlock, encrypted save to an S3-compatible stand-in, lock, recovery-key unlock, and reading the entry back. Virtual authenticator and local storage stand-in; Also Reset this device confirmed with the passkey. QKMS layer, Touch ID and page filling are not covered.');
}finally{await context.close();await storage.close();rmSync(profile,{recursive:true,force:true})}
