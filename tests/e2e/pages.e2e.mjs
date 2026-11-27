// Real-browser test of everything QVault does on a website: generating a password while signing up, filling a login,
// changing a password, the question after a form is sent, two-step and no-reload logins, and the locked state.
// The website is a small local stand-in with real accounts in memory; storage and the passkey are stand-ins as in vault.e2e.mjs.
// Two test-only changes are made to a temporary copy of the extension, never to the packaged files:
//   - website access is granted in the manifest (the real permission prompt cannot be clicked by a test);
//   - the page panel's shadow root is opened so the test can find its buttons. Clicks are real, trusted clicks.
// Run: npm run test:e2e
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,cpSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {startFakeQStorage} from './fake-qstorage.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),bucket='qvault-e2e-bucket',SITE='https://shop.test';
// ---- the extension copy
const ext=mkdtempSync(path.join(tmpdir(),'qvault-e2e-ext-'));cpSync(root,ext,{recursive:true,filter:src=>!/(^|[\\/])(node_modules|\.git|tests|upstream|build)([\\/]|$)/.test(path.relative(root,src))});
{const file=path.join(ext,'manifest.json'),manifest=JSON.parse(readFileSync(file,'utf8'));manifest.host_permissions.push('https://*/*');writeFileSync(file,JSON.stringify(manifest));
 const inline=path.join(ext,'inline.js'),code=readFileSync(inline,'utf8');assert.equal(code.split("attachShadow({mode:'closed'})").length,3,'both shadow roots of the page script are closed in the packaged file');writeFileSync(inline,code.replaceAll("attachShadow({mode:'closed'})","attachShadow({mode:'open'})"))}
// ---- the website: accounts in memory, plain HTML forms
const accounts=new Map(),sessions=new Map();let nextSession=1;
const html=(title,body)=>'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>'+title+'</title><style>body{font:16px sans-serif;padding:30px}input{display:block;width:300px;padding:8px;margin:4px 0 14px}</style></head><body><h1>'+title+'</h1>'+body+'</body></html>';
const pages={
 '/register':q=>html('Create account',(q.get('error')?'<p id="error">'+q.get('error')+'</p>':'')+'<form method="post" action="/register"><label>E-mail<input type="email" name="email"></label><label>Password<input type="password" name="password"></label><label>Repeat password<input type="password" name="repeat"></label><button type="submit">Create account</button></form>'),
 // the only password field is marked new-password, as many real login pages do
 '/login':q=>html('Log in',(q.get('error')?'<p id="error">Wrong e-mail or password</p>':'')+'<form method="post" action="/login"><label>E-mail<input type="email" name="email"></label><label>Password<input type="password" name="password" autocomplete="new-password"></label><button type="button" id="show">Show</button> <button type="submit">Log in</button></form>'),
 // a login split over two pages: the e-mail first, the password on the next page
 '/step1':()=>html('Log in','<form method="post" action="/step1"><label>E-mail<input type="email" name="email"></label><button type="submit">Next</button></form>'),
 '/step2':q=>html('Enter your password','<p>Signing in as <span id="as">'+(q.get('email')||'')+'</span></p>'+(q.get('error')?'<p id="error">Wrong password</p>':'')+'<form method="post" action="/step2"><input type="hidden" name="email" value="'+(q.get('email')||'')+'"><label>Password<input type="password" name="password"></label><button type="submit">Log in</button></form>'),
 // a login that never loads a new page: the script sends it and swaps the form for a greeting
 '/app':()=>html('App','<div id="view"><form id="f"><label>E-mail<input type="email" name="email"></label><label>Password<input type="password" name="password"></label><button type="submit">Log in</button></form></div><script>document.getElementById("f").addEventListener("submit",async e=>{e.preventDefault();const r=await fetch("/api/login",{method:"POST",body:new URLSearchParams(new FormData(e.target))});document.getElementById("view").innerHTML=r.ok?"<p id=who>"+(await r.text())+"</p>":"<p id=error>Wrong e-mail or password</p>"})</script>'),
 '/change':q=>html('Change password',(q.get('error')?'<p id="error">'+q.get('error')+'</p>':'')+'<form method="post" action="/change"><label>Current password<input type="password" name="current"></label><label>New password<input type="password" name="fresh"></label><label>Repeat new password<input type="password" name="repeat"></label><button type="submit">Change password</button></form>')
};
function site(req,res,url,body){
 const cookie=/sid=(\d+)/.exec(req.headers.cookie||'')?.[1],user=sessions.get(cookie)||null,form=new URLSearchParams(body),go=(to,headers={})=>{res.writeHead(303,{Location:to,...headers});res.end()},show=text=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(text)};
 if(req.method==='GET'&&pages[url.pathname])return show(pages[url.pathname](url.searchParams));
 if(req.method==='GET'&&url.pathname==='/account')return user?show(html('Welcome','<p id="who">'+user+'</p>'+(url.searchParams.get('changed')?'<p id="changed">Password changed</p>':'')+'<a href="/change">Change password</a> <a href="/logout">Log out</a>')):go('/login');
 if(url.pathname==='/logout'){sessions.delete(cookie);return go('/login')}
 if(req.method==='POST'&&url.pathname==='/register'){const email=form.get('email'),password=form.get('password');if(!email||!password||password!==form.get('repeat'))return go('/register?error=Passwords+do+not+match');if(accounts.has(email))return go('/register?error=Already+registered');accounts.set(email,password);return go('/login')}
 if(req.method==='POST'&&url.pathname==='/login'){const email=form.get('email');if(!accounts.has(email)||accounts.get(email)!==form.get('password'))return go('/login?error=1');const sid=String(nextSession++);sessions.set(sid,email);return go('/account',{'Set-Cookie':'sid='+sid+'; Path=/; Secure'})}
 if(req.method==='POST'&&url.pathname==='/step1')return go('/step2?email='+encodeURIComponent(form.get('email')||''));
 if(req.method==='POST'&&url.pathname==='/step2'){const email=form.get('email');if(!accounts.has(email)||accounts.get(email)!==form.get('password'))return go('/step2?error=1&email='+encodeURIComponent(email||''));const sid=String(nextSession++);sessions.set(sid,email);return go('/account',{'Set-Cookie':'sid='+sid+'; Path=/; Secure'})}
 if(req.method==='POST'&&url.pathname==='/api/login'){const ok=accounts.has(form.get('email'))&&accounts.get(form.get('email'))===form.get('password');res.writeHead(ok?200:403,{'Content-Type':'text/plain'});return res.end(ok?form.get('email'):'no')}
 if(req.method==='POST'&&url.pathname==='/change'){if(!user)return go('/login');if(accounts.get(user)!==form.get('current'))return go('/change?error=Current+password+is+wrong');if(!form.get('fresh')||form.get('fresh')!==form.get('repeat'))return go('/change?error=New+passwords+do+not+match');accounts.set(user,form.get('fresh'));return go('/account?changed=1')}
 res.writeHead(404);res.end('not found');
}
const storage=await startFakeQStorage({bucket,site}),profile=mkdtempSync(path.join(tmpdir(),'qvault-e2e-profile-'));
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:['--disable-extensions-except='+ext,'--load-extension='+ext,'--host-resolver-rules=MAP qstorage.quilibrium.com 127.0.0.1:'+storage.port+', MAP shop.test 127.0.0.1:'+storage.port,'--ignore-certificate-errors','--no-proxy-server']});
const step=text=>console.log('  ok  '+text);
async function authenticator(page){const cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',ctap2Version:'ctap2_1',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,hasPrf:true,automaticPresenceSimulation:true}});return cdp}
try{
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:30000}),base='chrome-extension://'+new URL(worker.url()).host+'/';
 // ---- a vault, unlocked
 const setup=await context.newPage();await authenticator(setup);await setup.goto(base+'setup.html');await setup.waitForFunction(()=>document.getElementById('profile-state').textContent==='NO PROFILE YET');
 await setup.fill('#storage-bucket',bucket);await setup.fill('#storage-access','FICTIONAL_E2E_ACCESS');await setup.fill('#storage-secret','FICTIONAL_E2E_STORAGE_SECRET');await setup.uncheck('#storage-qkms');await setup.click('#storage-submit');
 await setup.waitForSelector('#recovery-panel',{state:'visible',timeout:60000});await setup.check('#recovery-ack');await setup.click('#recovery-done');
 await setup.addInitScript(()=>{window.close=()=>{}});await setup.goto(base+'unlock.html');await setup.waitForFunction(()=>/^Unlocked/.test(document.getElementById('unlock-status').textContent),null,{timeout:60000});
 const control=await context.newPage();await control.goto(base+'popup.html');const ask=(action,args={})=>control.evaluate(async m=>{const r=await chrome.runtime.sendMessage(m);if(r.error)throw Error(r.error);return r.data},{action,...args});
 for(let i=0;i<50&&!(await worker.evaluate(()=>chrome.scripting.getRegisteredContentScripts())).some(s=>s.id==='qvault-inline');i++)await new Promise(r=>setTimeout(r,200));
 assert.ok((await worker.evaluate(()=>chrome.scripting.getRegisteredContentScripts())).some(s=>s.id==='qvault-inline'),'with website access the page script is registered');step('vault created and unlocked; the page script is registered for websites');

 // ---- helpers for the website tab
 const web=await context.newPage();await web.bringToFront();
 const panel=web.locator('#panel'),card=web.locator('#ask'),openQ=async field=>{await web.bringToFront();await web.click(field);await web.locator('#q').click();await panel.waitFor({state:'visible'})},choose=async text=>{await panel.getByRole('button',{name:text}).click()};
 const noQuestion=async why=>{await web.waitForTimeout(3200);assert.equal(await card.count(),0,why)},entries=()=>ask('all-entries');
 const A='alex@shop.test',B='blake@shop.test';

 // 1. Sign up with a generated password
 await web.goto(SITE+'/register');await web.fill('[name=email]',A);await openQ('[name=password]');await choose('Generate a password');await panel.getByText('Generated and saved').waitFor();
 const first=await web.inputValue('[name=password]');assert.ok(first.length>=16,'a real password was generated');assert.equal(await web.inputValue('[name=repeat]'),first,'the repeat field got it too');
 let saved=await entries();assert.equal(saved.length,1);assert.equal(saved[0].username,A);assert.equal(saved[0].url,SITE);
 await web.keyboard.press('Escape');await web.click('button[type=submit]');await web.waitForURL(SITE+'/login');assert.equal(accounts.get(A),first,'the website has the generated password');await noQuestion('a login that is already saved is not asked about');
 step('sign-up: a generated password is filled into both fields, saved with the e-mail, and accepted by the website');

 // 2. Log in by filling (the password field is marked new-password)
 await openQ('[name=email]');await panel.getByRole('button',{name:A}).click();await web.waitForFunction(()=>document.querySelector('[name=password]').value!=='');assert.equal(await web.inputValue('[name=email]'),A);assert.equal(await web.inputValue('[name=password]'),first);
 await web.click('button[type=submit]');await web.waitForURL(SITE+'/account');assert.equal(await web.textContent('#who'),A);await noQuestion('filling a saved login asks nothing afterwards');
 step('login: the saved login fills e-mail and password, QVault does not send the form, and the website lets it in');

 // 3. Change the password
 await web.goto(SITE+'/change');await openQ('[name=current]');await panel.getByRole('button',{name:A}).click();await web.waitForFunction(()=>document.querySelector('[name=current]').value!=='');
 assert.equal(await web.inputValue('[name=current]'),first);assert.equal(await web.inputValue('[name=fresh]'),'','only the clicked field is filled');assert.equal(await web.inputValue('[name=repeat]'),'');
 await openQ('[name=fresh]');await choose('Generate a password');await panel.getByText('Generated and saved').waitFor();const second=await web.inputValue('[name=fresh]');
 assert.notEqual(second,first);assert.equal(await web.inputValue('[name=repeat]'),second);assert.equal(await web.inputValue('[name=current]'),first,'the current password is left alone');
 saved=await entries();assert.equal(saved.length,1,'the same entry is updated, not a second one added');
 await web.keyboard.press('Escape');await web.click('button[type=submit]');await web.waitForURL(SITE+'/account?changed=1');assert.equal(accounts.get(A),second);
 await web.goto(SITE+'/logout');await web.waitForURL(SITE+'/login');await openQ('[name=email]');await panel.getByRole('button',{name:A}).click();await web.waitForFunction(()=>document.querySelector('[name=password]').value!=='');assert.equal(await web.inputValue('[name=password]'),second,'QVault now fills the new password');await web.click('button[type=submit]');await web.waitForURL(SITE+'/account');
 step('change password: the current one is filled alone, a new one is generated into new and repeat, the entry is updated and the new password logs in');

 // 4. A typed sign-up is asked about after the form was sent, and saved on Save
 await web.goto(SITE+'/logout');await web.goto(SITE+'/register');await web.fill('[name=email]',B);await web.fill('[name=password]','typed-by-hand-1');await web.fill('[name=repeat]','typed-by-hand-1');
 assert.equal((await entries()).length,1,'typing saves nothing');await web.click('button[type=submit]');await web.waitForURL(SITE+'/login');await card.waitFor({state:'visible',timeout:15000});
 assert.match(await card.textContent(),/Save this login in QVault\?/);assert.match(await card.textContent(),new RegExp(B.replace('.','\\.')));assert.ok(!(await card.textContent()).includes('typed-by-hand-1'),'the question never shows the password');assert.equal((await entries()).length,1,'still nothing saved before the answer');
 await card.getByRole('button',{name:'Save'}).click();await card.getByText('Saved in QVault').waitFor();saved=await entries();assert.equal(saved.length,2);assert.ok(saved.some(e=>e.username===B));
 await openQ('[name=email]');await panel.getByRole('button',{name:B}).click();await web.waitForFunction(()=>document.querySelector('[name=password]').value!=='');assert.equal(await web.inputValue('[name=password]'),'typed-by-hand-1');await web.click('button[type=submit]');await web.waitForURL(SITE+'/account');assert.equal(await web.textContent('#who'),B);
 step('typed sign-up: nothing is saved while typing; after the form is sent the page asks, Save stores it, and it then fills and logs in');

 // 5. A wrong password typed at login is offered as an update; Not now leaves the saved one alone. A show-password button asks nothing.
 await web.goto(SITE+'/logout');await web.waitForURL(SITE+'/login');await web.fill('[name=email]',B);await web.fill('[name=password]','a-wrong-password');await web.click('#show');await noQuestion('a show-password button is not sending the form');
 await web.click('button[type=submit]');await web.waitForURL(SITE+'/login?error=1');await card.waitFor({state:'visible',timeout:15000});assert.match(await card.textContent(),/Update the saved password in QVault\?/);
 await card.getByRole('button',{name:'Not now'}).click();await card.waitFor({state:'detached'});await openQ('[name=email]');await panel.getByRole('button',{name:B}).click();await web.waitForFunction(()=>document.querySelector('[name=password]').value!=='');assert.equal(await web.inputValue('[name=password]'),'typed-by-hand-1','the saved password is unchanged');
 await web.click('button[type=submit]');await web.waitForURL(SITE+'/account');step('refused login: the page offers an update, Not now keeps the saved password, which still logs in');

 // 6. A login split over two pages: the name from the first page is joined to the password from the second, and filling works page by page
 const C='casey@shop.test';accounts.set(C,'two-step-password');await web.goto(SITE+'/logout');await web.goto(SITE+'/step1');await web.fill('[name=email]',C);await web.click('button[type=submit]');await web.waitForURL(u=>u.pathname==='/step2');
 await web.fill('[name=password]','two-step-password');await web.click('button[type=submit]');await web.waitForURL(SITE+'/account');await card.waitFor({state:'visible',timeout:15000});assert.match(await card.textContent(),/Save this login in QVault\?/);assert.ok((await card.textContent()).includes(C),'the question names the e-mail typed on the first page');
 await card.getByRole('button',{name:'Save'}).click();await card.getByText('Saved in QVault').waitFor();saved=await entries();assert.equal(saved.length,3);assert.ok(saved.some(e=>e.username===C));
 await web.goto(SITE+'/logout');await web.goto(SITE+'/step1');await openQ('[name=email]');await panel.getByRole('button',{name:C}).click();await web.waitForFunction(()=>document.querySelector('[name=email]').value!=='');assert.equal(await web.inputValue('[name=email]'),C);await web.click('button[type=submit]');await web.waitForURL(u=>u.pathname==='/step2');
 await openQ('[name=password]');await panel.getByRole('button',{name:C}).click();await web.waitForFunction(()=>document.querySelector('[name=password]').value!=='');await web.click('button[type=submit]');await web.waitForURL(SITE+'/account');assert.equal(await web.textContent('#who'),C);await noQuestion('a filled two-step login asks nothing');
 step('two-step login: typed once it is saved with the e-mail from the first page; afterwards each page is filled from the same entry');

 // 7. A login that never loads a new page: the question appears on the same page once the form is gone
 const D='devon@shop.test';accounts.set(D,'no-reload-password');await web.goto(SITE+'/logout');await web.goto(SITE+'/app');await web.fill('[name=email]',D);await web.fill('[name=password]','no-reload-password');await web.click('button[type=submit]');await web.waitForSelector('#who');
 await card.waitFor({state:'visible',timeout:15000});assert.ok((await card.textContent()).includes(D));await card.getByRole('button',{name:'Save'}).click();await card.getByText('Saved in QVault').waitFor();saved=await entries();assert.equal(saved.length,4);assert.ok(saved.some(e=>e.username===D));
 step('no-reload login: the question appears on the same page after the form disappears, and Save stores it');

 // 8. Locked: the panel offers unlocking and nothing else, and a sent form is not asked about
 await ask('lock');await web.goto(SITE+'/logout');await web.waitForURL(SITE+'/login');await openQ('[name=password]');await panel.getByText('Unlock to see your saved accounts.').waitFor();
 assert.equal(await panel.getByRole('button',{name:'Generate a password'}).count(),0);assert.equal(await panel.getByRole('button',{name:A}).count(),0);
 await web.keyboard.press('Escape');await web.fill('[name=email]',B);await web.fill('[name=password]','another-wrong-one');await web.click('button[type=submit]');await web.waitForURL(SITE+'/login?error=1');await noQuestion('nothing is kept or asked while the vault is locked');
 step('locked: the panel only offers unlocking, and a sent form is neither kept nor asked about');

 const everything=[...storage.objects.values()].map(o=>o.body).join('\n');for(const secret of [first,second,'typed-by-hand-1','two-step-password','no-reload-password',A,B,C,D])assert.ok(!everything.includes(secret),'cloud storage must only hold ciphertext');
 console.log('PASS E2E PAGES: real Chromium, real page script, broker and vault against a local stand-in website: sign-up with a generated password, filling a login, changing a password, the save question after a typed sign-up, the update question after a refused login, a login split over two pages, a login that never loads a new page, and the locked state. Website access and an open shadow root are set in a temporary copy of the extension; real websites, the permission prompt and Touch ID are not covered.');
}finally{await context.close();await storage.close();rmSync(profile,{recursive:true,force:true});rmSync(ext,{recursive:true,force:true})}
