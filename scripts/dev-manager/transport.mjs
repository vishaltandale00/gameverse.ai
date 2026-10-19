import {randomBytes,webcrypto} from 'node:crypto';
import {signatureInput,digest,publicKey,assert} from '../../src/dev-manager-protocol.js';
export async function identity(store){let value=await store.read('identity.json');if(value)return value;
  const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  value={id:crypto.randomUUID(),key:publicKey(await webcrypto.subtle.exportKey('jwk',pair.publicKey)),private_key:await webcrypto.subtle.exportKey('jwk',pair.privateKey),code:randomBytes(8).toString('hex'),paired:false};
  await store.write('identity.json',value);return value;}
export class Transport {
  constructor({url,identity,fetchImpl=fetch,allowHttp=false}){this.url=new URL(url);this.identity=identity;this.fetch=fetchImpl;
    assert(this.url.origin==='https://gameverse.build'||allowHttp&&this.url.protocol==='http:'&&this.url.hostname==='127.0.0.1','untrusted_manager_server');
    assert(!this.url.username&&!this.url.password&&this.url.pathname==='/','invalid_manager_url');}
  async call(path,value){const text=JSON.stringify(value),time=String(Date.now()),nonce=randomBytes(16).toString('hex'),id=this.identity.id;
    const key=await webcrypto.subtle.importKey('jwk',this.identity.private_key,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
    const signature=Buffer.from(await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,new TextEncoder().encode(signatureInput(id,time,nonce,'POST',path,await digest(text))))).toString('base64url');
    const response=await this.fetch(new URL(path,this.url),{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','X-Gameverse-Manager':id,'X-Gameverse-Time':time,'X-Gameverse-Nonce':nonce,'X-Gameverse-Signature':signature},body:text,signal:AbortSignal.timeout(10000)});
    const raw=await response.text();assert(raw.length<=262144,'manager_response_too_large');let result;try{result=JSON.parse(raw);}catch{throw Error('manager_response_invalid');}
    if(!response.ok)throw Error(/^[a-z0-9_]+$/.test(result.error?.code)?result.error.code:'manager_server_unavailable');return result;}
  device(value){return this.call('/api/dev-manager/device',value);}
}
