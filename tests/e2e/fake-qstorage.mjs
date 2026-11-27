// Minimal S3-compatible stand-in for QStorage, for browser tests only. In-memory, HTTPS with a throwaway self-signed certificate.
import https from 'node:https';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
// site (optional): handler(req,res,url,body) for every request whose Host is not the storage host, so one HTTPS listener can also play a website.
// conditionalWrites=false makes it behave like a store that ignores If-Match / If-None-Match, which is what selects the backup-only mode.
export async function startFakeQStorage({bucket,site=null,conditionalWrites=true}){
 const dir=mkdtempSync(path.join(tmpdir(),'qvault-e2e-cert-'));
 try{execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(dir,'key.pem'),'-out',path.join(dir,'cert.pem'),'-days','1','-subj','/CN=qstorage.quilibrium.com'],{stdio:'ignore'})}catch{rmSync(dir,{recursive:true,force:true});throw Error('openssl is required to create the test certificate')}
 const key=readFileSync(path.join(dir,'key.pem')),cert=readFileSync(path.join(dir,'cert.pem'));rmSync(dir,{recursive:true,force:true});
 const objects=new Map(),requests=[];let clock=Date.now();
 const etag=body=>'"'+createHash('sha256').update(body).digest('hex').slice(0,32)+'"';
 const server=https.createServer({key,cert},(req,res)=>{
  const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{
   const url=new URL(req.url,'https://qstorage.quilibrium.com'),parts=decodeURIComponent(url.pathname).split('/').filter(Boolean),body=Buffer.concat(chunks).toString('utf8');
   if(site&&!String(req.headers.host||'').startsWith('qstorage.quilibrium.com'))return site(req,res,new URL(req.url,'https://'+req.headers.host),body);
   requests.push({method:req.method,path:url.pathname,search:url.search});
   const send=(status,text='',headers={})=>{res.writeHead(status,headers);res.end(text)};
   if(parts[0]!==bucket)return send(404,'<Error><Code>NoSuchBucket</Code></Error>');
   const objectKey=parts.slice(1).join('/');
   if(!objectKey){
    if(req.method==='HEAD')return send(200);
    if(req.method==='GET'&&url.searchParams.get('list-type')==='2'){const prefix=url.searchParams.get('prefix')||'';const xml='<?xml version="1.0" encoding="UTF-8"?><ListBucketResult>'+[...objects].filter(([k])=>k.startsWith(prefix)).map(([k,o])=>'<Contents><Key>'+k+'</Key><LastModified>'+new Date(o.modified).toISOString()+'</LastModified></Contents>').join('')+'<IsTruncated>false</IsTruncated></ListBucketResult>';return send(200,xml,{'Content-Type':'application/xml'})}
    return send(405);
   }
   const current=objects.get(objectKey);
   if(req.method==='PUT'){
    if(conditionalWrites&&req.headers['if-none-match']==='*'&&current)return send(412);
    if(conditionalWrites&&req.headers['if-match']&&(!current||current.etag!==req.headers['if-match']))return send(412);
    const next={body,etag:etag(body+':'+(++clock)),modified:++clock};objects.set(objectKey,next);return send(200,'',{ETag:next.etag});
   }
   if(req.method==='GET'||req.method==='HEAD')return current?send(200,req.method==='GET'?current.body:'',{ETag:current.etag,'Content-Type':'application/json'}):send(404,'<Error><Code>NoSuchKey</Code></Error>');
   if(req.method==='DELETE'){objects.delete(objectKey);return send(204)}
   return send(405);
  });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {port:server.address().port,objects,requests,close:()=>new Promise(resolve=>server.close(resolve))};
}
