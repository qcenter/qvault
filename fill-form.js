export async function fillForm(origin,user,password,expectedMode,targeted=false){
 try {
  if(location.origin!==origin||window!==window.top)throw Error('The website changed.');
  const visible=e=>!e.disabled&&!e.readOnly&&e.getClientRects().length>0&&getComputedStyle(e).visibility==='visible';
  const target=targeted?globalThis.__qvaultInlineTarget:null;
  if(targeted&&(!target||!target.isConnected||!visible(target)))throw Error('The selected input changed. Click the input again.');
  const root=target?.form||document;
  const fields=[...root.querySelectorAll('input[type=password]')].filter(visible);
  // Several password fields mean a sign-up or change-password form. One field is a login form, also when the page marks it
  // autocomplete="new-password": many login pages do that only to stop the browser's own autofill.
  // Exception: the person clicked one particular password field (the current password on a change-password form); only that field is filled.
  const single=fields.length>1&&target?.type==='password'&&fields.includes(target);
  if(fields.length>1&&!single)throw Error('This form has several password fields, so it looks like a sign-up or change-password form. Click the password field you want filled, or use Generate a password.');
  const p=single?target:fields[0],mode=p?'password':'username';
  if(expectedMode&&expectedMode!==mode)throw Error('The form changed. Click Fill again.');
  const candidates=[...(p?.form||document).querySelectorAll('input')].filter(e=>visible(e)&&['text','email'].includes(e.type));
  let users=candidates.filter(e=>e.autocomplete==='username');
  if(!users.length)users=candidates.filter(e=>e.type==='email'||e.autocomplete==='email');
  if(!users.length){
   const normal=value=>String(value||'').toLowerCase().normalize('NFD').replace(/[^\p{L}\p{N}]/gu,'');
   // Username and e-mail field words in many languages. Keep identical to the list in inline.js (checked by tests/field-words-smoke.mjs).
   const words=new Set(/*field-words*/['email','e mail','emailaddress','mail','username','user name','userid','user id','login','loginid','login id','loginname','useremail','loginemail','loginusername','benutzername','nutzername','anmeldename','benutzerkennung','e mail adresse','nom d utilisateur','identifiant','adresse e mail','adresse email','adresse mail','courriel','adresse courriel','adresse électronique','usuario','nombre de usuario','correo','correo electrónico','dirección de correo','dirección de correo electrónico','nome de usuário','utilizador','nome de utilizador','endereço de e mail','endereço de email','correio eletrónico','correio eletrônico','nome utente','utente','indirizzo email','indirizzo e mail','posta elettronica','gebruikersnaam','e mailadres','nazwa użytkownika','adres e mail','adres email','uživatelské jméno','e mailová adresa','používateľské meno','felhasználónév','e mail cím','nume de utilizator','utilizator','adresă de e mail','användarnamn','e post','e postadress','brukernavn','e postadresse','brugernavn','käyttäjätunnus','käyttäjänimi','sähköposti','sähköpostiosoite','kullanıcı adı','kullanici adi','e posta','e posta adresi','имя пользователя','логин','электронная почта','адрес электронной почты','почта','ім я користувача','логін','електронна пошта','адреса електронної пошти','όνομα χρήστη','ηλεκτρονικό ταχυδρομείο','διεύθυνση email','ユーザー名','ユーザーid','メールアドレス','ログインid','メール','用户名','账号','邮箱','电子邮件','电子邮箱','邮箱地址','用戶名','帳號','電子郵件','電子信箱','아이디','사용자 이름','이메일','이메일 주소','اسم المستخدم','البريد الإلكتروني','البريد الالكتروني','שם משתמש','דואר אלקטרוני','אימייל','उपयोगकर्ता नाम','ईमेल','nama pengguna','surel','alamat email','tên đăng nhập','tên người dùng','ชื่อผู้ใช้','อีเมล']/*end-field-words*/.map(normal));
   users=candidates.filter(e=>[e.name,e.id].some(v=>words.has(normal(v)))||[...(e.labels||[])].some(label=>words.has(normal(label.textContent))));
  }
  if(!users.length&&p)users=candidates;
  if(target&&target.type!=='password')users=[target];
  if(single)users=[];
  if(users.length>1||(!p&&users.length!==1))throw Error('No clear email or username input found. Open the login form. Iframes are not supported.');
  const username=users[0]||null,form=p?p.form:username.form;
  if(p&&!form)throw Error('This password input has no supported form.');
  if(form){
   // A child named "action"/"target" replaces these properties with an element; refuse instead of guessing.
   if(typeof form.action!=='string'||typeof form.target!=='string')throw Error('This form cannot be verified. Type the login yourself.');
   if(new URL(form.action,location.href).origin!==origin||(form.target&&form.target!=='_self'))throw Error('The form submits to another website or window.');
   // Submit buttons can override the destination with formaction/formtarget.
   for(const b of document.querySelectorAll('[formaction],[formtarget]')){
    if(b.form!==form)continue;
    if((b.hasAttribute('formaction')&&new URL(b.formAction,location.href).origin!==origin)||(b.formTarget&&b.formTarget!=='_self'))throw Error('The form submits to another website or window.');
   }
  }
  if(expectedMode==='probe'||user===null)return {ok:true,mode};
  if(username&&(typeof user!=='string'||!user))throw Error('This entry has no username or email.');
  if(p&&(typeof password!=='string'||!password))throw Error('This entry has no password.');
  const set=(e,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))};
  if(username)set(username,user);if(p)set(p,password);
  await new Promise(resolve=>setTimeout(resolve,200));
  if(location.origin!==origin||(username&&(!username.isConnected||!visible(username)||username.value!==user))||(p&&(!p.isConnected||!visible(p)||p.value!==password)))throw Error('The page did not retain the filled values.');
  return {ok:true,mode};
 }catch(e){return {ok:false,error:e.message||'Filling failed.'}}
}

