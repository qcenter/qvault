// Secret factors only cross the local Rust/JS/Go memory boundary. No network calls.
export async function prepareWithRust({init,generate,api,progress=()=>{},random=bytes=>crypto.getRandomValues(bytes)}){
 if(typeof api.rsa_dkg_prepare_rust!=='function')throw Error('Missing Go validator for Rust preparation');
 await init();const factors=[];
 try{
  for(let i=0;i<2;i++){
   progress('rust-safe-prime-'+(i+1)+'-started');
   const seed=random(new Uint8Array(32));
   try{const factor=generate(seed);if(!(factor instanceof Uint8Array)||factor.length!==128)throw Error('Invalid Rust prime output');factors.push(factor)}finally{seed.fill(0)}
   progress('rust-safe-prime-'+(i+1)+'-finished');
  }
  const encode=bytes=>btoa(String.fromCharCode(...bytes));
  const result=JSON.parse(api.rsa_dkg_prepare_rust(JSON.stringify({p:encode(factors[0]),q:encode(factors[1])})));
  if(result.ready!==true)throw Error('Rust factors rejected by Go validation');
  return {ready:true,keySize:2048};
 }finally{for(const f of factors)f.fill(0)}
}
