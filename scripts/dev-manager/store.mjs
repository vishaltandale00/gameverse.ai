import {mkdir,readFile,open,rename,lstat,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomBytes} from 'node:crypto';
export class Store {
  constructor(directory){this.directory=resolve(directory);}
  path(name){if(!/^[a-z0-9-]+\.json$/.test(name))throw Error('invalid_state_name');return join(this.directory,name);}
  async init(){await mkdir(this.directory,{recursive:true,mode:0o700});const info=await lstat(this.directory);if(!info.isDirectory()||info.isSymbolicLink()||(info.mode&0o077)!==0)throw Error('unsafe_state_directory');}
  async read(name,fallback=null){try{const path=this.path(name),info=await lstat(path);if(info.isSymbolicLink()||(info.mode&0o077)!==0)throw Error('unsafe_state_file');return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
  async write(name,value){const target=this.path(name),tmp=target+'.'+randomBytes(6).toString('hex');let handle;
    try{handle=await open(tmp,'wx',0o600);await handle.writeFile(JSON.stringify(value)+'\n');await handle.sync();await handle.close();handle=null;await rename(tmp,target);}
    finally{await handle?.close();await unlink(tmp).catch(()=>{});}}
  async lock(){const path=join(this.directory,'manager.lock');
    try{const old=JSON.parse(await readFile(path,'utf8'));let alive=true;try{process.kill(old.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}
      if(alive)throw Error('manager_already_running');await unlink(path);
    }catch(e){if(e.code!=='ENOENT')throw e;}
    const file=await open(path,'wx',0o600);await file.writeFile(JSON.stringify({pid:process.pid}));await file.close();return ()=>unlink(path).catch(()=>{});}
}
