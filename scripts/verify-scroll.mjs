// Optional local browser regression. Reuses Chrome's remote debugger and existing ws;
// does not add a browser dependency or a routine CI/build stage.
// Start Chrome with --headless=new --remote-debugging-port=9231 and a temporary
// --user-data-dir, then run: node scripts/verify-scroll.mjs
import assert from 'node:assert/strict';
import WebSocket from 'ws';
const endpoint = process.env.CHROME_DEBUG_URL || 'http://127.0.0.1:9231';
const app = process.env.GAMEVERSE_URL || 'http://localhost:4173/v0?view=workshop';
const started = performance.now();
async function connect(url) {
  const socket = new WebSocket(url); await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  let sequence = 0; const pending = new Map();
  socket.on('message', data => { const message = JSON.parse(data); if (!message.id) return; const job = pending.get(message.id); pending.delete(message.id); if (message.error) job.reject(Error(message.error.message)); else job.resolve(message.result); });
  return {socket, call(method, params = {}) { return new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, {resolve,reject}); socket.send(JSON.stringify({id,method,params})); }); }};
}
const info = await (await fetch(`${endpoint}/json/version`)).json();
const browser = await connect(info.webSocketDebuggerUrl);
const {browserContextId} = await browser.call('Target.createBrowserContext');
let page;
try {
  const {targetId} = await browser.call('Target.createTarget', {url:'about:blank', browserContextId});
  const targets = await (await fetch(`${endpoint}/json`)).json();
  page = await connect(targets.find(target => target.id === targetId).webSocketDebuggerUrl);
  const evaluate = async expression => { const response = await page.call('Runtime.evaluate', {expression,awaitPromise:true,returnByValue:true}); if(response.exceptionDetails) throw Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text); return response.result.value; };
  await page.call('Page.navigate', {url:app});
  for (let attempt=0; attempt<100; attempt++) { if (await evaluate(`!!document.querySelector('[data-open]') && !!document.querySelector('[data-ir-role]')`)) break; await new Promise(resolve=>setTimeout(resolve,100)); }
  assert.equal(await evaluate(`!!document.querySelector('[data-open]')`),true,'research UI must load');
  const results = await evaluate(`(async()=>{
    const results=[], frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    async function check(name, selector, act, {focus=true}={}) {
      const node=document.querySelector(selector); if(!node)throw Error('Missing '+selector);
      node.scrollIntoView({block:'center',behavior:'instant'});node.focus({preventScroll:true});await frame();
      const before=scrollY;act(node);await frame();const after=scrollY;
      const focused=document.activeElement.matches(selector);
      results.push({name,before,after,focused,pass:Math.abs(before-after)<=1&&(!focus||focused)});
    }
    const initial=document.querySelector('[data-assembly-add]');initial.scrollIntoView({block:'center',behavior:'instant'});scrollTo({top:500,behavior:'instant'});await frame();
    const before=scrollY;document.querySelector('.assembly-heading').click();await frame();results.push({name:'bubbling content click',before,after:scrollY,pass:scrollY===before&&document.body.onclick===null});
    await check('assembly search typing','[data-assembly-search]',node=>{node.value='motion';node.setSelectionRange(2,4);node.dispatchEvent(new Event('input',{bubbles:true}));});
    await check('ontology inspect','[data-open]',node=>node.click());
    await check('ontology basket toggle','[data-select]',node=>node.click());
    await check('ontology search typing','[data-search]',node=>{node.value='motion';node.setSelectionRange(2,4);node.dispatchEvent(new Event('input',{bubbles:true}));});
    const search=document.querySelector('[data-search]');results.push({name:'search selection',pass:search.selectionStart===2&&search.selectionEnd===4});
    search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('#fixed-preset-workflow').open=true;
    await check('preset selector','[data-ir-role]',node=>node.dispatchEvent(new Event('change',{bubbles:true})));
    await check('brief typing','#mix-intent',node=>{node.value='Keep the cursor here';node.setSelectionRange(5,8);node.dispatchEvent(new Event('input',{bubbles:true}));node.click();});
    const intent=document.querySelector('#mix-intent');results.push({name:'brief selection',pass:intent.selectionStart===5&&intent.selectionEnd===8});
    await check('parent select','[data-parent]',node=>node.dispatchEvent(new Event('change',{bubbles:true})));
    document.querySelector('.ir-design-notes').open=true;
    const direction=document.querySelector('#mix-components [data-direction]').dataset.direction;
    await check('design direction radio identity', '[name="direction-'+direction+'"][value="bridge"]',node=>node.click());
    const directionDetails=document.querySelector('.direction-details');directionDetails.open=true;
    const note=document.querySelector('[data-choice-note]');note.value='Retain research notes and cursor';note.setSelectionRange(7,15);note.dispatchEvent(new Event('input',{bubbles:true}));note.scrollIntoView({block:'center',behavior:'instant'});note.focus({preventScroll:true});await frame();
    const refreshBefore=scrollY,originalFetch=window.fetch;
    window.fetch=async(input,...args)=>String(input).startsWith('/research/status.json')?new Response(JSON.stringify({version:'scroll-regression-refresh',counts:{},stale:false}),{headers:{'Content-Type':'application/json'}}):originalFetch(input,...args);
    document.querySelector('#refresh-research').click();
    for(let i=0;i<100;i++){if(!document.querySelector('#refresh-research').disabled)break;await new Promise(resolve=>setTimeout(resolve,20));}
    window.fetch=originalFetch;await frame();const refreshedNote=document.querySelector('[data-choice-note]');
    results.push({name:'research cache refresh retains editing cursor',before:refreshBefore,after:scrollY,focused:document.activeElement===refreshedNote,pass:scrollY===refreshBefore&&document.activeElement===refreshedNote&&refreshedNote.selectionStart===7&&refreshedNote.selectionEnd===15&&refreshedNote.value==='Retain research notes and cursor'&&document.querySelector('.direction-details').open});
    scrollTo({top:500,behavior:'instant'});await frame();const sameBefore=scrollY;document.querySelector('.main-nav button[data-view="workshop"]').click();await frame();results.push({name:'same navigation tab',before:sameBefore,after:scrollY,pass:sameBefore===scrollY});
    scrollTo({top:500,behavior:'instant'});document.querySelector('.main-nav button[data-view="discover"]').click();await frame();results.push({name:'intentional new-page navigation',after:scrollY,pass:scrollY===0&&document.body.dataset.view==='discover'&&!document.querySelector('#discover-view').hidden});
    return results;
  })()`);
  for(const result of results) assert.equal(result.pass,true,JSON.stringify(result));
  console.log(JSON.stringify({outcome:'passed',url:app,checks:results,wallMs:performance.now()-started},null,2));
} finally {
  page?.socket.close(); await browser.call('Target.disposeBrowserContext',{browserContextId}); browser.socket.close();
}
