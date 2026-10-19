import http from 'node:http';
export function discoveryServer({identity,origin,port=4177}) {
  const host=`127.0.0.1:${port}`;
  const server=http.createServer((req,res)=>{
    const allowed=req.headers.origin===origin;
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    if(req.headers.host!==host||!allowed){res.writeHead(403).end();return;}
    res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
    if(req.method==='OPTIONS'){
      res.setHeader('Access-Control-Allow-Methods','GET');res.setHeader('Access-Control-Allow-Private-Network','true');res.writeHead(204).end();return;}
    if(req.method!=='GET'||req.url!=='/health'){res.writeHead(404).end();return;}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({protocol:1,id:identity.id,source_commit:identity.source_commit||null,paired:identity.paired,capabilities:['inventory','reference-fixture','cancel','retention']}));
  });
  return {server,start:()=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);}),stop:()=>new Promise(resolve=>server.close(resolve))};
}
