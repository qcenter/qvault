import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// Username/e-mail field recognition by label, name or id in many languages. The same list must be in both scripts,
// because each is injected into pages on its own and cannot import a shared file.
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
const list=source=>{const m=source.match(/\/\*field-words\*\/(\[[\s\S]*?\])\/\*end-field-words\*\//);assert.ok(m,'word list markers missing');return JSON.parse(m[1].replace(/'/g,'"'))};
const inline=list(read('inline.js')),fill=list(read('fill-form.js'));
assert.deepEqual(inline,fill,'inline.js and fill-form.js must carry the same word list');assert.equal(new Set(inline).size,inline.length,'no duplicates');assert.ok(inline.length>=100);
const normal=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[^\p{L}\p{N}]/gu,'');
const words=new Set(inline.map(normal));
// one or two everyday labels per language, written the way a page would show them
const samples={English:['Username','E-mail address','User ID'],German:['Benutzername','E-Mail-Adresse'],French:["Nom d'utilisateur",'Adresse e-mail','Identifiant'],Spanish:['Nombre de usuario','Correo electrónico'],Portuguese:['Nome de usuário','Endereço de e-mail'],Italian:['Nome utente','Indirizzo email'],Dutch:['Gebruikersnaam','E-mailadres'],Polish:['Nazwa użytkownika','Adres e-mail'],Czech:['Uživatelské jméno'],Slovak:['Používateľské meno'],Hungarian:['Felhasználónév','E-mail cím'],Romanian:['Nume de utilizator'],Swedish:['Användarnamn','E-postadress'],Norwegian:['Brukernavn'],Danish:['Brugernavn'],Finnish:['Käyttäjätunnus','Sähköposti'],Turkish:['Kullanıcı adı','E-posta'],Russian:['Имя пользователя','Электронная почта','Логин'],Ukrainian:["Ім'я користувача",'Електронна пошта'],Greek:['Όνομα χρήστη'],Japanese:['ユーザー名','メールアドレス'],ChineseSimplified:['用户名','邮箱'],ChineseTraditional:['用戶名','電子郵件'],Korean:['아이디','이메일'],Arabic:['اسم المستخدم','البريد الإلكتروني'],Hebrew:['שם משתמש'],Hindi:['उपयोगकर्ता नाम'],Indonesian:['Nama pengguna'],Vietnamese:['Tên đăng nhập'],Thai:['ชื่อผู้ใช้']};
for(const [language,labels]of Object.entries(samples))for(const label of labels)assert.ok(words.has(normal(label)),language+': "'+label+'" is not recognised');
assert.ok(Object.keys(samples).length>=30);
for(const other of ['Comment','Search','Kommentar','Nachricht','Phone','Телефон','検索','First name','Password','Passwort'])assert.ok(!words.has(normal(other)),'"'+other+'" must not be treated as a username field');
// behaviour in the fill script: a lone text field is recognised by its label in any of these languages
const {fillForm}=await import('../fill-form.js');
class Input{constructor(label){this.type='text';this.form=form;this.disabled=false;this.readOnly=false;this.isConnected=true;this.autocomplete='';this.name='f1';this.id='f1';this.labels=[{textContent:label}];this._value=''}get value(){return this._value}set value(v){this._value=v}getClientRects(){return [{}]}dispatchEvent(){}hasAttribute(){return false}}
globalThis.HTMLInputElement=Input;globalThis.location={origin:'https://example.test',href:'https://example.test/login'};globalThis.getComputedStyle=()=>({visibility:'visible'});globalThis.window={};window.top=window;
let fields=[];const form={action:'https://example.test/session',target:'',querySelectorAll:s=>s.includes('type=password')?[]:fields};globalThis.document={querySelectorAll:s=>s.includes('formaction')?[]:form.querySelectorAll(s)};
for(const label of ['Имя пользователя','ユーザー名','Benutzername:','Correo electrónico *','اسم المستخدم','Felhasználónév']){fields=[new Input(label),new Input('Kommentar')];assert.deepEqual(await fillForm(location.origin,null,null,null,false),{ok:true,mode:'username'},label);
 assert.equal((await fillForm(location.origin,'fixture-user',null,'username',false)).ok,true);assert.equal(fields[0].value,'fixture-user');assert.equal(fields[1].value,'')}
fields=[new Input('Kommentar'),new Input('Nachricht')];assert.equal((await fillForm(location.origin,null,null,null,false)).ok,false);
// behaviour in the page helper: the Q button attaches to such a field
class Node{constructor(tag){this.tag=tag;this.children=[];this.style={setProperty(){}};this.className='';this.hidden=false;this.attributes={}}append(...n){this.children.push(...n)}replaceChildren(...n){this.children=n}attachShadow(){this.shadow=new Node('shadow');return this.shadow}setAttribute(k,v){this.attributes[k]=v}}
class Field{constructor(label){this.type='text';this.autocomplete='';this.isConnected=true;this.name='f1';this.id='f1';this.labels=[{textContent:label}]}getClientRects(){return [{}]}getBoundingClientRect(){return {top:100,bottom:140,right:400,height:40}}}
let run=0;for(const [label,shown]of [['ユーザー名',true],['Nom d\'utilisateur',true],['Kullanıcı Adı',true],['Kommentar',false]]){
 const root=new Node('root');globalThis.window={addEventListener(){}};window.top=window;globalThis.location={protocol:'https:'};globalThis.innerWidth=1000;globalThis.innerHeight=800;globalThis.HTMLInputElement=Field;globalThis.document={createElement:t=>new Node(t),documentElement:root,activeElement:new Field(label),addEventListener(){}};delete globalThis.__qvaultBrowserInline;
 await import('../inline.js?words'+(run++));assert.equal(root.children[0].className,shown?'shown':'',label);
}
console.log('PASS LOCAL: both page scripts carry the same list of '+inline.length+' username and e-mail words; everyday labels in '+Object.keys(samples).length+' languages and scripts are recognised after normalisation, unrelated labels are not; the fill script and the Q button act on such fields. Simulated DOM only.');
