import assert from 'node:assert/strict';
import {SyncTransport} from '../src/sync-transport.js';
import {listSnapshots} from '../src/snapshot-discovery.js';
import {SingleDeviceSession} from '../src/single-device-session.js';
import {SyncSession} from '../src/sync-session.js';
// Cloud housekeeping with a fake S3-compatible endpoint. Nothing here can delete outside the vault's own snapshots.
const profileId=crypto.randomUUID(),prefix='qvault/'+profileId+'/',DAY=86400000,now=Date.UTC(2026,10,27);
const credentials={accessKey:'FICTIONAL_ACCESS',secretKey:'FICTIONAL_SECRET',region:'q-world-1',bucket:'fictional-bucket'};
function cloud({ages,deleteStatus=204,listStatus=200,extra=[]}){
 const objects=new Map(),log=[];ages.forEach((days,i)=>objects.set(prefix+crypto.randomUUID()+'.json',now-days*DAY-i));for(const key of extra)objects.set(key,now-400*DAY);
 const fetcher={fetch:async(url,options={})=>{const u=new URL(url),method=options.method||'GET';log.push([method,decodeURIComponent(u.pathname)]);
  if(method==='GET'&&u.searchParams.get('list-type')==='2'){if(listStatus!==200)return new Response('',{status:listStatus});const body='<ListBucketResult>'+[...objects].filter(([k])=>k.startsWith(u.searchParams.get('prefix'))).map(([k,t])=>'<Contents><Key>'+k+'</Key><LastModified>'+new Date(t).toISOString()+'</LastModified></Contents>').join('')+'<IsTruncated>false</IsTruncated></ListBucketResult>';return new Response(body)}
  if(method==='DELETE'){const key=decodeURIComponent(u.pathname).slice('/fictional-bucket/'.length);if(deleteStatus>=400)return new Response('',{status:deleteStatus});objects.delete(key);return new Response(null,{status:204})}
  return new Response('',{status:500})}};
 return {objects,log,transport:new SyncTransport({credentials,profileId,keyId:'k',handle:{},fetcher,now:()=>now})};
}
const deletes=c=>c.log.filter(l=>l[0]==='DELETE').map(l=>l[1].slice('/fictional-bucket/'.length));
// listing helper returns every snapshot once
{const c=cloud({ages:[1,2,3],extra:[prefix+'sync/v1/head.json',prefix+'sync/v1/probes/x.json']});const items=await c.transport.listSnapshotItems();assert.equal(items.length,3);assert.ok(items.every(i=>/^[a-f0-9-]{36}\.json$/.test(i.object.slice(prefix.length))));assert.equal(typeof listSnapshots,'function')}
// keeps the 20 newest and anything younger than 30 days; removes the rest, oldest first, never sync metadata
{
 const ages=[...Array.from({length:25},(_,i)=>i),40,50,60,70],c=cloud({ages,extra:[prefix+'sync/v1/head.json',prefix+'sync/v1/mpc-lease.json']});
 const before=[...c.objects].filter(([k])=>/^[a-f0-9-]{36}\.json$/.test(k.slice(prefix.length))).sort((a,b)=>b[1]-a[1]).map(([k])=>k);
 const result=await c.transport.pruneSnapshots();assert.deepEqual(result,{deleted:4,denied:false});
 assert.deepEqual(deletes(c).sort(),before.slice(25).sort());assert.equal(deletes(c)[0],before.at(-1));assert.ok(c.objects.has(prefix+'sync/v1/head.json')&&c.objects.has(prefix+'sync/v1/mpc-lease.json'));assert.equal((await c.transport.listSnapshotItems()).length,25);
 assert.deepEqual(await c.transport.pruneSnapshots(),{deleted:0,denied:false});
}
// the snapshot the profile points at is never removed, however old
{const c=cloud({ages:[...Array.from({length:22},(_,i)=>i),90,91]}),oldest=[...c.objects].sort((a,b)=>a[1]-b[1])[0][0];const result=await c.transport.pruneSnapshots({protect:[oldest,undefined,null]});assert.equal(result.deleted,1);assert.ok(c.objects.has(oldest))}
// bounded work per run; missing permission or a failed listing is quiet and leaves everything alone
{const c=cloud({ages:[...Array.from({length:20},(_,i)=>i),...Array.from({length:80},(_,i)=>100+i)]});assert.deepEqual(await c.transport.pruneSnapshots(),{deleted:50,denied:false});assert.equal(deletes(c).length,50)}
{const c=cloud({ages:[...Array.from({length:20},(_,i)=>i),100,101,102],deleteStatus:403});assert.deepEqual(await c.transport.pruneSnapshots(),{deleted:0,denied:true});assert.equal(deletes(c).length,1);assert.equal(c.objects.size,23)}
{const c=cloud({ages:[100,101],listStatus:403});assert.deepEqual(await c.transport.pruneSnapshots(),{deleted:0,denied:true});assert.equal(deletes(c).length,0)}
// object names are checked before any request
{const c=cloud({ages:[1]});for(const bad of ['other/x.json',prefix+'../x.json',prefix+'sync/v1/head.json','qvault/'+crypto.randomUUID()+'/'+crypto.randomUUID()+'.json',prefix+'a b.json'])await assert.rejects(()=>c.transport.deleteSnapshot(bad),/Invalid/);assert.equal(deletes(c).length,0)}
// sessions protect what they reference and never fail a save because cleanup failed
{
 let asked=null;const transport={pruneSnapshots:async o=>{asked=o;return {deleted:1,denied:false}}};
 const single=new SingleDeviceSession({transport,payload:{vault:{object:prefix+'current.json'}},handle:{profileId}});await single.prune();assert.deepEqual(asked.protect,[prefix+'current.json']);
 const shared=new SyncSession({transport,payload:{vault:{object:prefix+'p.json'}},handle:{profileId}});shared.head={state:{reference:{object:prefix+'h.json'}}};await shared.prune();assert.deepEqual(asked.protect.sort(),[prefix+'h.json',prefix+'p.json']);
 assert.equal(await new SingleDeviceSession({transport:{pruneSnapshots:async()=>{throw Error('FICTIONAL_CLEANUP_FAILURE')}},payload:{},handle:{profileId}}).prune(),null);
 assert.equal(await new SingleDeviceSession({transport:{},payload:{},handle:{profileId}}).prune(),null);
}
console.log('PASS LOCAL: cleanup keeps the 20 newest snapshots and everything younger than 30 days, removes older ones oldest first and at most 50 per run, never removes the snapshot a profile points at or any sync metadata, validates object names before deleting, and stays quiet when deleting or listing is not permitted. Fake S3-compatible endpoint.');
