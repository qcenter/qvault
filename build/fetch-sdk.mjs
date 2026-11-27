// Fetches the QKMS SDK sources QVault is built from. They are not kept in this repository.
// Source: the public fork of https://github.com/QuilibriumNetwork/qkms-sdk with QVault's changes, at one fixed commit.
// QVAULT_SDK_SOURCE can point to a local clone of that fork; the commit must still be the one fixed here.
import {execFileSync} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const SOURCE=process.env.QVAULT_SDK_SOURCE||'https://github.com/qcenter/qkms-sdk.git';
const COMMIT='1c631fd2583055b189d512b67d129bd548066506';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),upstream=path.join(root,'upstream'),marker=path.join(upstream,'.sdk-commit');
const targets=[['packages/core/src','sdk-core'],['wasm/mpc-wasm','mpc-wasm']];
// Parts of the SDK QVault does not use (wallet providers, prebuilt packages) are left out.
const SKIP=new Set(['wallets','pkg']);
// Plain read-and-write copy: works the same on every file system.
const copy=(from,to)=>{mkdirSync(to,{recursive:true});for(const entry of readdirSync(from,{withFileTypes:true})){if(SKIP.has(entry.name))continue;const a=path.join(from,entry.name),b=path.join(to,entry.name);if(entry.isDirectory())copy(a,b);else if(entry.isFile())writeFileSync(b,readFileSync(a))}};
const current=()=>{try{return readFileSync(marker,'utf8').trim()===COMMIT&&targets.every(t=>existsSync(path.join(upstream,t[1])))}catch{return false}};
if(current())console.log('QKMS SDK sources are present ('+COMMIT.slice(0,12)+').');
else{
 const work=mkdtempSync(path.join(os.tmpdir(),'qvault-sdk-')),git=(...args)=>execFileSync('git',args,{cwd:work,encoding:'utf8',stdio:['ignore','pipe','inherit']}).trim();
 try{
  git('clone','--quiet','--no-checkout',SOURCE,'.');git('checkout','--quiet','--detach',COMMIT);
  if(git('rev-parse','HEAD')!==COMMIT)throw Error('The fetched QKMS SDK is not the expected commit.');
  mkdirSync(upstream,{recursive:true});rmSync(marker,{force:true});
  for(const [from,to] of targets){const target=path.join(upstream,to);rmSync(target,{recursive:true,force:true});copy(path.join(work,from),target)}
  writeFileSync(marker,COMMIT+'\n');console.log('Fetched QKMS SDK sources ('+COMMIT.slice(0,12)+').');
 }finally{rmSync(work,{recursive:true,force:true})}
}
