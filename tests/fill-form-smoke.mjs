import assert from 'node:assert/strict';
import {fillForm} from '../fill-form.js';
class Input{constructor(type,form){this.type=type;this.form=form;this.disabled=false;this.readOnly=false;this.isConnected=true;this.autocomplete='';this.name=type==='email'?'email':'';this.id='';this.labels=[];this._value='';this.events=[]}get value(){return this._value}set value(v){this._value=v}getClientRects(){return [{}]}dispatchEvent(e){this.events.push(e.type)}}
globalThis.HTMLInputElement=Input;globalThis.location={origin:'https://example.test',href:'https://example.test/login'};globalThis.getComputedStyle=()=>({visibility:'visible'});globalThis.window={};window.top=window;
let fields=[];const form={action:'https://example.test/session',target:'',querySelectorAll:s=>s.includes('type=password')?fields.filter(f=>f.type==='password'):fields};let submitters=[];globalThis.document={querySelectorAll:s=>s.includes('formaction')?submitters:form.querySelectorAll(s)};
let email=new Input('email',form);fields=[email];globalThis.__qvaultInlineTarget=email;
assert.deepEqual(await fillForm(location.origin,null,null,null,true),{ok:true,mode:'username'});assert.equal(email.value,'');
assert.equal((await fillForm(location.origin,'fixture@example.test',null,'username',true)).ok,true);assert.equal(email.value,'fixture@example.test');assert.deepEqual(email.events,['input','change']);
const pass=new Input('password',form);fields.push(pass);globalThis.__qvaultInlineTarget=pass;assert.equal((await fillForm(location.origin,'fixture@example.test','FICTIONAL_PASSWORD','password',true)).ok,true);assert.equal(pass.value,'FICTIONAL_PASSWORD');
pass.value='';form.action='https://evil.test/session';assert.equal((await fillForm(location.origin,'fixture','SHOULD_NOT_FILL','password',true)).ok,false);assert.equal(pass.value,'');form.action='https://example.test/session';
{// Several password fields (sign-up or change-password): nothing is filled from the username field, but the one password field the person clicked gets the saved password and nothing else is touched.
 const second=new Input('password',form);fields.push(second);globalThis.__qvaultInlineTarget=email;email.value='';assert.equal((await fillForm(location.origin,'fixture','SHOULD_NOT_FILL',null,true)).ok,false);assert.equal(pass.value,'');
 globalThis.__qvaultInlineTarget=pass;assert.deepEqual(await fillForm(location.origin,'fixture@example.test','FICTIONAL_CURRENT',null,true),{ok:true,mode:'password'});assert.equal(pass.value,'FICTIONAL_CURRENT');assert.equal(second.value,'');assert.equal(email.value,'','the username field is left alone');pass.value='';fields.pop();}

// Many login pages mark their only password field autocomplete="new-password" to stop the browser's own autofill; that is still a login form.
pass.autocomplete='new-password';pass.value='';assert.equal((await fillForm(location.origin,'fixture@example.test','FICTIONAL_PASSWORD',null,true)).ok,true);assert.equal(pass.value,'FICTIONAL_PASSWORD');pass.value='';pass.autocomplete='';
assert.equal((await fillForm('https://evil.test',null,null,null,true)).ok,false);window.top={};assert.equal((await fillForm(location.origin,'fixture','SHOULD_NOT_FILL',null,true)).ok,false);
// Regression: clobbered form.action/form.target (a child named "action"/"target") and submitter
// formaction/formtarget overrides must not bypass the same-origin submit check.
window.top=window;pass.value='';const clobber=new Input('text',form);
form.action=clobber;assert.equal((await fillForm(location.origin,'fixture','SHOULD_NOT_FILL','password',true)).ok,false);assert.equal(pass.value,'');form.action='https://example.test/session';
form.target=clobber;assert.equal((await fillForm(location.origin,'fixture','SHOULD_NOT_FILL','password',true)).ok,false);assert.equal(pass.value,'');form.target='';
const submit={form,formAction:'https://evil.test/steal',formTarget:'',hasAttribute:n=>n==='formaction'};submitters=[submit];
assert.equal((await fillForm(location.origin,'fixture','SHOULD_NOT_FILL','password',true)).ok,false);assert.equal(pass.value,'');
submit.formAction='https://example.test/ok';submit.formTarget='_blank';submit.hasAttribute=n=>n==='formtarget';
assert.equal((await fillForm(location.origin,'fixture','SHOULD_NOT_FILL','password',true)).ok,false);assert.equal(pass.value,'');
submit.formTarget='_self';submit.hasAttribute=n=>n==='formaction';assert.equal((await fillForm(location.origin,'fixture','FICTIONAL_PASSWORD','password',true)).ok,true);pass.value='';
submitters=[{form:{},formAction:'https://evil.test/other-form',formTarget:'_blank',hasAttribute:()=>true}];
assert.equal((await fillForm(location.origin,'fixture','FICTIONAL_PASSWORD','password',true)).ok,true);assert.equal(pass.value,'FICTIONAL_PASSWORD');submitters=[];
console.log('PASS LOCAL: visible email-only and login-form fill with native setters/events; no autosubmit; cross-origin form, registration, ambiguous fields, wrong origin, iframe, clobbered form action/target and cross-origin submitter overrides rejected. Simulated DOM only.');
