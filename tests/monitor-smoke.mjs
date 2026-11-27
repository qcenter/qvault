import {monitorKey} from '../src/monitor.js';
import assert from 'node:assert/strict';
let calls=0,progress=[];
const result=await monitorKey({probe:async()=>({ready:++calls===2,task:{status:'AWAITING_CLIENT',round:0,totalRounds:10}}),onProgress:r=>progress.push(r),timeoutMs:1000,intervalMs:1});assert.equal(result.ready,true);assert.equal(calls,2);assert.equal(progress.length,2);
const start=Date.now();await assert.rejects(monitorKey({probe:()=>new Promise(()=>{}),timeoutMs:30,intervalMs:1}),/monitoring deadline/);assert.ok(Date.now()-start<1000);
await assert.rejects(monitorKey({probe:async()=>{throw Error('synthetic network failure')},timeoutMs:1000,intervalMs:1}),/synthetic network failure/);
await assert.rejects(monitorKey({probe:async()=>({ready:false,task:{status:'TIMED_OUT',round:9,totalRounds:10}}),timeoutMs:1000,intervalMs:1}),/TIMED_OUT at round 9/);
const controller=new AbortController();const cancel=monitorKey({probe:()=>new Promise(()=>{}),signal:controller.signal,timeoutMs:10000});controller.abort();assert.equal(await cancel,null);
console.log('PASS: independent monitoring deadline fires even if participant/probe is stuck; progress and ready/error handling verified with synthetic responses.');
