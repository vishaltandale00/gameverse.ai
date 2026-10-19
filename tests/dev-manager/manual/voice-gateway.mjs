// Loopback-only TLS fixture. Never deploy or expose this synthetic test gateway.
import https from 'node:https';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
export async function start({directory,backend='http://127.0.0.1:8788'}) {
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',directory+'/key.pem','-out',directory+'/cert.pem','-days','1','-subj','/CN=gameverse.build'],{stdio:'ignore'});
  const server=https.createServer({key:await readFile(directory+'/key.pem'),cert:await readFile(directory+'/cert.pem')},async(req,res)=>{
    try {
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const headers=new Headers(req.headers);headers.delete('host');headers.delete('content-length');headers.set('Accept-Encoding','identity');
      if(headers.has('Origin'))headers.set('Origin',backend);
      const response=await fetch(backend+req.url,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks),signal:AbortSignal.timeout(30000)});
      const outgoing=new Headers(response.headers);for(const name of ['content-encoding','content-length','transfer-encoding','connection'])outgoing.delete(name);
      res.writeHead(response.status,Object.fromEntries(outgoing));res.end(Buffer.from(await response.arrayBuffer()));
    } catch {res.writeHead(502).end();}
  });
  await new Promise(resolve=>server.listen(7443,'127.0.0.1',resolve));
  return ()=>new Promise(resolve=>server.close(resolve));
}
