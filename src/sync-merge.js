import {validateEntries} from './cloud-vault.js';
const fields=['title','url','username','password'];
const canonical=e=>e?JSON.stringify([e.id,...fields.map(k=>e[k])]):'null';
export function sameEntries(a,b){return JSON.stringify([...a].sort((x,y)=>x.id.localeCompare(y.id)).map(canonical))===JSON.stringify([...b].sort((x,y)=>x.id.localeCompare(y.id)).map(canonical))}
export async function entryVersion(e){const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(e))));return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')}
async function copy(local,remote){const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('qvault-conflict-v1|'+canonical(local)+'|'+canonical(remote))));bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;const h=Array.from(bytes.slice(0,16),b=>b.toString(16).padStart(2,'0')).join('');return {...local,id:[h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-'),title:local.title.slice(0,4000)+' (conflict copy)'}}
// Per-entry three-way merge. Disjoint fields merge; different edits to the same
// field are retained as two entries. Delete-vs-edit preserves the edited value.
export async function mergeEntries(base,local,remote){
 for(const list of [base,local,remote])validateEntries(list);
 const maps=[base,local,remote].map(a=>new Map(a.map(e=>[e.id,e]))),result=new Map(),conflicts=[];
 for(const id of new Set([...maps[0].keys(),...maps[1].keys(),...maps[2].keys()])){
  const [b,l,r]=maps.map(m=>m.get(id)||null);const put=e=>{if(e)result.set(e.id,{...e})};
  if(canonical(l)===canonical(b)){put(r);continue}
  if(canonical(r)===canonical(b)||canonical(l)===canonical(r)){put(l);continue}
  if(!l){put(r);conflicts.push({entryId:id,type:'delete-versus-edit'});continue}
  if(!r){put(await copy(l,null));conflicts.push({entryId:id,type:'edit-versus-delete'});continue}
  if(b){const merged={...r};let collision=false;for(const f of fields){if(l[f]===b[f])continue;if(r[f]===b[f]||l[f]===r[f])merged[f]=l[f];else collision=true}if(!collision){put(merged);continue}}
  put(r);put(await copy(l,r));conflicts.push({entryId:id,type:'conflicting-edit'});
 }
 const entries=[...result.values()].sort((a,b)=>a.id.localeCompare(b.id));validateEntries(entries);return {entries,conflicts};
}
