// Text for a failed QKMS request: status, method, the service's error type and its own reason, as plain text of limited length.
export function qkmsErrorText(e){
 let type='',reason='';
 try{const body=JSON.parse(e.body||'{}'),candidate=body.__type,message=body.message??body.Message;
  if(typeof candidate==='string'&&/^[A-Za-z0-9_#:.]{1,80}$/.test(candidate))type=' '+candidate;
  if(typeof message==='string'){const plain=message.replace(/[^\w .,:;()\/#'-]/g,'').trim().slice(0,200);if(plain)reason=': '+plain}}catch{}
 return 'QKMS HTTP '+e.status+(typeof e.method==='string'?' ('+e.method+')':'')+type+reason;
}
