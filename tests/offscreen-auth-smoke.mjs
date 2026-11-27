import assert from 'node:assert/strict';
let listener,workers=0;globalThis.chrome={runtime:{id:'fixture',onMessage:{addListener:f=>listener=f}}};globalThis.window={addEventListener:()=>{}};globalThis.Worker=class{constructor(){workers++}};
await import('../dist/offscreen.js');
for(const sender of [{id:'fixture',tab:{id:1},url:'https://example.test'},{id:'foreign',url:'chrome-extension://foreign/popup.html'}]){let reply;listener({target:'qvault-offscreen',command:{action:'unlock',password:'SHOULD_NOT_USE'}},sender,r=>reply=r);assert.equal(reply.error,'Unauthorized vault request')}
assert.equal(workers,0);console.log('PASS LOCAL: direct offscreen unlock requests from content tabs or foreign extensions are rejected before starting workers. Simulated Chrome runtime only.');
