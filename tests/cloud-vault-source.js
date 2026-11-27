import assert from 'node:assert/strict';
import {saveCloudVault,loadCloudVault,generatePassword,validateEntries} from '../src/cloud-vault.js';
const originalFetch=globalThis.fetch,objects=new Map(),requests=[];
const profileId=crypto.randomUUID(),keyId='fictional-key',credentials={accessKey:'FICTIONAL_ACCESS',secretKey:'FICTIONAL_SECRET',region:'q-world-1',bucket:'fictional-bucket'};
const pair=await crypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},false,['encrypt','decrypt']);
const peer={call:async(action,m)=>{assert.equal(m.keyId,keyId);if(action==='encrypt')return {CiphertextBlob:Buffer.from(await crypto.subtle.encrypt({name:'RSA-OAEP'},pair.publicKey,Buffer.from(m.value,'base64'))).toString('base64')};if(action==='decrypt')return {Plaintext:Buffer.from(await crypto.subtle.decrypt({name:'RSA-OAEP'},pair.privateKey,Buffer.from(m.value,'base64'))).toString('base64')};throw Error('Unexpected RPC')}};
globalThis.fetch=async input=>{const request=input instanceof Request?input:new Request(input);requests.push(request.method);assert.equal(new URL(request.url).host,'qstorage.quilibrium.com');assert.ok(request.headers.has('authorization'));const path=new URL(request.url).pathname;if(request.method==='PUT'){assert.equal(request.headers.get('if-none-match'),'*');assert.ok(!objects.has(path));objects.set(path,await request.text());return new Response('')}if(request.method==='GET')return objects.has(path)?new Response(objects.get(path)):new Response('',{status:404});throw Error('Unexpected storage request')};
const args={credentials,profileId,keyId,peer,signal:new AbortController().signal};
const entries=[{id:crypto.randomUUID(),title:'FICTIONAL_TITLE',url:'https://example.test',username:'FICTIONAL_USERNAME',password:'FICTIONAL_PASSWORD'}];
try{
 const first=await saveCloudVault({...args,entries});assert.deepEqual(await loadCloudVault({...args,reference:first}),entries);
 for(const raw of objects.values())for(const secret of ['FICTIONAL_TITLE','FICTIONAL_USERNAME','FICTIONAL_PASSWORD','FICTIONAL_SECRET'])assert.ok(!raw.includes(secret));
 const second=await saveCloudVault({...args,entries:[]});assert.notEqual(first.object,second.object);assert.deepEqual(await loadCloudVault({...args,reference:second}),[]);assert.deepEqual(await loadCloudVault({...args,reference:first}),entries);
 const path='/fictional-bucket/'+first.object,original=objects.get(path),damaged=JSON.parse(original);damaged.ciphertext='AAAA'+damaged.ciphertext.slice(4);objects.set(path,JSON.stringify(damaged));await assert.rejects(()=>loadCloudVault({...args,reference:first}));objects.set(path,original);
 await assert.rejects(()=>loadCloudVault({...args,reference:{object:'qvault-main/snapshots/fictional.json'}}),/reference/);
 const traversal=requests.length;for(const object of ['qvault/'+profileId+'/../'+profileId+'/x.json','qvault/'+profileId+'/../../other-bucket/x.json','qvault/'+profileId+'//x.json','qvault/'+profileId+'/./x.json'])await assert.rejects(()=>loadCloudVault({...args,reference:{object}}),/reference/);assert.equal(requests.length,traversal);
 const before=requests.length;await assert.rejects(()=>saveCloudVault({...args,entries,check:()=>{throw Error('Session stopped.')}}),/stopped/);assert.equal(requests.length,before);
 assert.throws(()=>validateEntries([{...entries[0],url:'javascript:alert(1)'}]),/HTTPS/);assert.throws(()=>validateEntries([entries[0],entries[0]]),/Invalid/);
 const passwords=new Set(Array.from({length:50},()=>generatePassword()));assert.equal(passwords.size,50);for(const p of passwords){assert.equal(p.length,24);assert.match(p,/^[A-Za-z0-9!@#$%*_-]+$/)}
 console.log('PASS LOCAL: actual RSA-OAEP + AES-GCM encrypted save/read, signed immutable QStorage requests, old-snapshot preservation, plaintext absence, tamper/path rejection, cancellation before writes and generator validation. Mocked QKMS/HTTP only; no live service or real credentials.');
}finally{globalThis.fetch=originalFetch}
