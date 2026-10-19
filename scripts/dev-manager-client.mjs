import {homedir} from 'node:os';import {join} from 'node:path';import {readFile} from 'node:fs/promises';
import {Store} from './dev-manager/store.mjs';import {Transport} from './dev-manager/transport.mjs';
const [command,path]=process.argv.slice(2);
try{const store=new Store(process.env.GAMEVERSE_MANAGER_DIR||join(homedir(),'.config','gameverse-manager'));const identity=await store.read('identity.json');if(!identity?.paired)throw Error('pairing_required');
  const transport=new Transport({url:process.env.GAMEVERSE_MANAGER_URL||'https://gameverse.build',identity,allowHttp:process.env.GAMEVERSE_MANAGER_ALLOW_HTTP==='1'});
  let value;if(command==='status')value={op:'view'};
  else if(command==='submit'){const input=JSON.parse(await readFile(path,'utf8'));value={op:'submit',task:{...input,manager_id:identity.id}};}
  else if(command==='cancel')value={op:'cancel',id:path};else throw Error('unsupported_command');
  console.log(JSON.stringify(await transport.device(value),null,2));
}catch(e){console.error(JSON.stringify({error:/^[a-z0-9_]+$/.test(e.message)?e.message:'client_operation_failed'}));process.exitCode=1;}
