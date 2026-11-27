import assert from 'node:assert/strict';
// A page can create <div id="__qvaultBrowserInline">, which makes window.__qvaultBrowserInline
// resolve to that element in every world. That must not disable the inline helper.
class Node{constructor(tag){this.tag=tag;this.children=[];this.style={setProperty(){}};this.className='';this.hidden=false;this.attributes={}}append(...n){this.children.push(...n)}replaceChildren(...n){this.children=n}attachShadow(){this.shadow=new Node('shadow');return this.shadow}setAttribute(k,v){this.attributes[k]=v}}
class Input{constructor(){this.type='email';this.autocomplete='email';this.isConnected=true;this.name='email';this.id='';this.labels=[]}getClientRects(){return [{}]}getBoundingClientRect(){return {top:100,bottom:140,right:400,height:40}}}
const root=new Node('root'),input=new Input();
globalThis.window={addEventListener(){}};window.top=window;globalThis.location={protocol:'https:'};globalThis.innerWidth=1000;globalThis.innerHeight=800;globalThis.HTMLInputElement=Input;globalThis.getComputedStyle=()=>({visibility:'visible'});globalThis.document={createElement:t=>new Node(t),documentElement:root,activeElement:input,addEventListener(){}};globalThis.chrome={runtime:{sendMessage:async m=>({data:m?.action==='inline-pending-get'?null:[]})}};
globalThis.__qvaultBrowserInline=new Node('div');
await import('../inline.js');
assert.equal(root.children.length,1,'inline helper must start despite a clobbered guard name');
assert.equal(globalThis.__qvaultBrowserInline,true);assert.equal(globalThis.__qvaultInlineTarget,input);
await import('../inline.js?again');assert.equal(root.children.length,1,'second injection stays a no-op');
console.log('PASS LOCAL: a page element named like the injection guard cannot disable inline suggestions; repeated injection remains a no-op. Simulated DOM only.');
