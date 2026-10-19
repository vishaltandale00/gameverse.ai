import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {Store} from './dev-manager/store.mjs';
import {identity} from './dev-manager/transport.mjs';
import {Transport} from './dev-manager/transport.mjs';
import {ManagerDaytona} from './dev-manager/daytona.mjs';
import {Runner} from './dev-manager/runner.mjs';
import {discoveryServer} from './dev-manager/server.mjs';
import {digest,inventoryEntry} from '../src/dev-manager-protocol.js';
const args=process.argv.slice(2),at=args.indexOf('--env-file');
let release,discovery,stopping=false;
try{
  const file=at>=0?parseEnv(await readFile(args[at+1],'utf8')):{};
  const env={...file,...process.env};if(!env.DAYTONA_API_KEY)throw Error('daytona_key_required');
  const directory=env.GAMEVERSE_MANAGER_DIR||join(homedir(),'.config','gameverse-manager');const store=new Store(directory);await store.init();release=await store.lock();
  const ident=await identity(store),url=env.GAMEVERSE_MANAGER_URL||'https://gameverse.build';
  const commit=env.GAMEVERSE_MANAGER_SOURCE_COMMIT||execFileSync('git',['rev-parse','HEAD'],{cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8'}).trim();if(!/^[a-f0-9]{40}$/.test(commit))throw Error('invalid_source_commit');ident.source_commit=commit;
  if(args.includes('--reconnect')){ident.paired=false;ident.code=randomBytes(8).toString('hex');await store.write('identity.json',ident);}
  const transport=new Transport({url,identity:ident,allowHttp:env.GAMEVERSE_MANAGER_ALLOW_HTTP==='1'});
  if(!ident.paired){try{const recovered=await transport.device({op:'poll'});ident.paired=true;ident.owner=recovered.owner;delete ident.code;await store.write('identity.json',ident);}catch(e){if(!['manager_not_found','pairing_required'].includes(e.message))throw e;}}
  if(!ident.paired){ident.code=randomBytes(8).toString('hex');await store.write('identity.json',ident);await transport.call('/api/dev-manager/register',{id:ident.id,key:ident.key,code_hash:await digest(ident.code)});
    console.log(JSON.stringify({status:'awaiting_pairing',pairing_code:ident.code,expires_in_seconds:300,instructions:'Click Check for dev app and Connect in your Gameverse developer account.'}));}
  const port=Number(env.GAMEVERSE_MANAGER_PORT||4177);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('invalid_manager_port');
  discovery=discoveryServer({identity:ident,origin:new URL(url).origin,port});await discovery.start();
  const daytona=new ManagerDaytona(env),runner=new Runner({store,transport,daytona});await runner.init();
  let inventoryAt=0,previousError=null;
  // A signal only requests shutdown. The current awaited operation owns the journal until the loop drains.
  const requestStop=()=>{stopping=true;};
  const stop=async()=>{stopping=true;await discovery.stop();await release();release=null;console.log(JSON.stringify({status:'stopped',remote_jobs:'bounded_existing_work_retained; new_launches_wait_for_reconnection'}));};
  process.once('SIGINT',requestStop);process.once('SIGTERM',requestStop);
  console.log(JSON.stringify({status:'manager_running',port,protocol:1,source_operations:'model-free reference fixture only',model_calls:0}));
  while(!stopping){
    try{
      const response=await transport.device({op:'poll'});if(stopping)break;
      if(!ident.paired){ident.paired=true;ident.owner=response.owner;delete ident.code;await store.write('identity.json',ident);console.log(JSON.stringify({status:'paired'}));}
      await runner.reconcile(response.tasks);if(stopping)break;await runner.commands(response.commands);if(stopping)break;await runner.advance({allowNew:()=>!stopping});if(stopping)break;
      if(Date.now()-inventoryAt>=5000){const items=await daytona.list();await transport.device({op:'inventory',entries:items.map(inventoryEntry)});inventoryAt=Date.now();}
      if(previousError)console.log(JSON.stringify({status:'reconnected'}));previousError=null;
    }catch(e){const code=/^[a-z0-9_]{1,80}$/.test(e.message)?e.message:'manager_disconnected';
      if((code!=='pairing_required'||ident.paired)&&code!==previousError)console.log(JSON.stringify({status:'waiting_for_reconnection',reason:code}));previousError=code;
      // No fresh dispatch without an authenticated poll. Existing remote jobs retain their own deadlines.
    }
    if(stopping||args.includes('--once'))break;
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  await stop();
}catch(e){await discovery?.stop().catch(()=>{});await release?.();console.error(JSON.stringify({error:/^[a-z0-9_]+$/.test(e.message)?e.message:'manager_start_failed'}));process.exitCode=1;}
