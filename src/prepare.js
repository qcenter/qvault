// No network/key creation callback is entered until every local participant is ready.
export async function prepareThenCreate({peers,create,onProgress=()=>{},isCancelled=()=>false,timeoutMs=1200000}){
 if(!peers.length)throw Error('No browser participant connected.');
 await Promise.all(peers.map(async(p,index)=>{const r=await p.call('prepare',{},timeoutMs);if(isCancelled())throw Error('Session stopped.');if(r.ready!==true||r.keySize!==2048)throw Error('Participant preparation did not succeed.');onProgress(index+1)}));
 if(isCancelled())throw Error('Session stopped.');
 const checks=await Promise.all(peers.map(p=>p.call('prepared',{},15000)));
 if(isCancelled())throw Error('Session stopped.');
 if(checks.some(r=>r.ready!==true||r.keySize!==2048))throw Error('Local preparation expired or is unavailable. No remote key was created.');
 return create();
}
