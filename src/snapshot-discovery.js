// List immutable snapshots only. Never use bucket-wide keys or plaintext indexes.
function field(xml,name){const matches=[...xml.matchAll(new RegExp('<'+name+'>([\\s\\S]*?)</'+name+'>','g'))];if(matches.length!==1)throw Error('Invalid cloud snapshot listing');return matches[0][1].replace(/&(?:amp|lt|gt|quot|apos);/g,e=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[e])).replace(/&#(?:x([0-9a-f]+)|(\d+));/gi,(_,h,d)=>String.fromCodePoint(parseInt(h||d,h?16:10)))}
export function parseSnapshotPage(xml,profileId){
 if(xml.length>4*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(xml)||!/<ListBucketResult(?:\s[^>]*)?>/.test(xml)||!/<\/ListBucketResult>\s*$/.test(xml))throw Error('Invalid cloud snapshot listing');
 const prefix='qvault/'+profileId+'/',items=[];
 for(const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)){
  const key=field(match[1],'Key');if(!key.startsWith(prefix))throw Error('Cloud listing returned another vault');
  if(!/^[a-f0-9-]{36}\.json$/.test(key.slice(prefix.length)))continue;
  const modified=Date.parse(field(match[1],'LastModified'));if(!Number.isFinite(modified))throw Error('Invalid cloud snapshot date');items.push({object:key,modified});
 }
 const truncated=field(xml,'IsTruncated');if(!['true','false'].includes(truncated))throw Error('Invalid cloud snapshot listing');
 return {items,next:truncated==='true'?field(xml,'NextContinuationToken'):null};
}
// Every immutable snapshot of this profile, each once, with its storage modification time.
export async function listSnapshots({requestPage,profileId,signal}){
 let token=null;const items=[],seen=new Set(),tokens=new Set();
 do{
  if(signal?.aborted)throw Error('Vault locked');
  const page=parseSnapshotPage(await requestPage(token),profileId);
  for(const item of page.items){if(seen.has(item.object))continue;seen.add(item.object);if(items.length>=10000)throw Error('Too many cloud snapshots. Recovery needs review.');items.push(item)}
  token=page.next;if(token){if(tokens.has(token)||tokens.size>=100)throw Error('Invalid cloud snapshot pagination');tokens.add(token)}
 }while(token);
 return items;
}
export async function discoverSnapshot({requestPage,profileId,reference,signal}){
 const items=await listSnapshots({requestPage,profileId,signal});let latest=null,tied=false;
 for(const item of items){if(!latest||item.modified>latest.modified){latest=item;tied=false}else if(item.modified===latest.modified)tied=true}
 if(tied)throw Error('Several cloud snapshots have the same date. Recovery needs review; no snapshot was selected.');
 if(reference&&!items.some(item=>item.object===reference.object))throw Error('Saved cloud snapshot is missing from the listing. Your profile was not changed.');
 return latest?{object:latest.object}:null;
}
