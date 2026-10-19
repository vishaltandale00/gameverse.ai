import test from 'node:test';
import assert from 'node:assert/strict';
import {RecordedTranscription} from '../src/recorded-transcription.js';
class Recorder {
 static isTypeSupported(type){return type==='audio/webm';}
 constructor(stream,{mimeType}){this.mimeType=mimeType;this.state='inactive';}
 start(){this.state='recording';}
 stop(){this.state='inactive';this.ondataavailable({data:new Blob(['real fixture bytes'])});this.onstop();}
}
const config={maxBytes:100,maxSeconds:15,timeoutMs:1000};
test('recording uploads bounded bytes once and polls the same request for transcript',async()=>{
 const requests=[],id=crypto.randomUUID();let polls=0;
 const r=new RecordedTranscription({stream:{},requestId:id,config,Recorder,fetchImpl:async(path,options={})=>{requests.push({path,options});if(options.method==='POST')return Response.json({requestId:id,status:'queued'},{status:202});return Response.json(++polls===1?{status:'audio'}:{status:'transcribed',text:'Play soccer'});}});
 await r.start();assert.equal((await r.stop()).text,'Play soccer');assert.equal(requests.filter(r=>r.options.method==='POST').length,1);assert.equal(requests[0].options.headers['X-Request-ID'],id);assert.equal(await requests[0].options.body.text(),'real fixture bytes');assert(requests.slice(1).every(r=>r.path==='/api/voice/requests/'+id));
});
test('aborted capture cannot upload late recorder data',async()=>{
 const c=new AbortController();let uploads=0;const r=new RecordedTranscription({stream:{},requestId:crypto.randomUUID(),config,signal:c.signal,Recorder,fetchImpl:async()=>{uploads++;}});await r.start();c.abort();await assert.rejects(r.stop(),{name:'AbortError'});assert.equal(uploads,0);
});
test('oversized and failed recordings never reach the backend',async()=>{
 let uploads=0;const r=new RecordedTranscription({stream:{},requestId:crypto.randomUUID(),config:{...config,maxBytes:1},Recorder,fetchImpl:async()=>{uploads++;}});await r.start();await assert.rejects(r.stop(),/too large/);assert.equal(uploads,0);
});
test('a terminal worker failure ends transcript polling promptly',async()=>{let calls=0;const r=new RecordedTranscription({stream:{},requestId:crypto.randomUUID(),config,Recorder,fetchImpl:async()=>Response.json(++calls===1?{status:'queued'}:{status:'failed',reason:'voice_broker_network_failed'})});await r.start();await assert.rejects(r.stop(),/could not finish/);assert.equal(calls,2);});
