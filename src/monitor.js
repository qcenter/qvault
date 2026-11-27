export async function monitorKey({probe,onProgress=()=>{},isCancelled=()=>false,signal,timeoutMs=180000,intervalMs=2000}){
 if(signal?.aborted)return null;
 let stopped=false,timer,heartbeat,sleepTimer,onAbort;const start=Date.now();
 const expired=new Promise((_,reject)=>{timer=setTimeout(()=>{stopped=true;reject(Error('Key did not become ready within the monitoring deadline. Participant/finalization status is NOT VERIFIED. No automatic retry or new key was created.'))},timeoutMs)});
 heartbeat=setInterval(()=>{if(!stopped&&!isCancelled())onProgress({waiting:true,elapsedSeconds:Math.floor((Date.now()-start)/1000)})},10000);
 const cancelled=new Promise(resolve=>{onAbort=()=>{stopped=true;resolve(null)};signal?.addEventListener('abort',onAbort,{once:true})});
 const run=(async()=>{while(!stopped&&!isCancelled()){
  const result=await probe();if(stopped||isCancelled())return null;onProgress(result);if(result.ready)return result;
  if(['TIMED_OUT','FAILED','CANCELLED'].includes(result.task?.status))throw Error('QKMS task ended: '+result.task.status+' at round '+result.task.round+'/'+result.task.totalRounds+'. No usable key is confirmed.');
  await new Promise(resolve=>sleepTimer=setTimeout(resolve,intervalMs));
 }return null})();
 try{return await Promise.race([run,expired,cancelled])}finally{stopped=true;clearTimeout(timer);clearInterval(heartbeat);clearTimeout(sleepTimer);signal?.removeEventListener('abort',onAbort)}
}
