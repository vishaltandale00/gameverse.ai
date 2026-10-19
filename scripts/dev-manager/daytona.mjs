import {Daytona} from '../../infra/cloudflare/daytona.js';
import {assert} from '../../src/dev-manager-protocol.js';
export class ManagerDaytona extends Daytona {
  constructor(env){super(env);this.snapshot=env.GAMEVERSE_MANAGER_SNAPSHOT||'dad882b3-a047-4715-8713-bddec50bb7ca';}
  async list(){const result=await this.request(`${this.base}/sandbox?page=1&limit=100`);const items=Array.isArray(result)?result:result?.items||result?.sandboxes||result?.data;
    assert(Array.isArray(items),'daytona_inventory_unavailable');return items.slice(0,100);}
  createJob(task){const ttlMinutes=Math.ceil(task.limits.job_wall_ms/60000)+1;
    return this.request(`${this.base}/sandbox`,'POST',{name:task.sandbox_name,snapshot:this.snapshot,target:'us',public:false,networkBlockAll:true,autoStopInterval:1,autoDeleteInterval:-1,ttlMinutes,
      labels:{'gameverse.scope':'dev-manager-v1','gameverse.task':task.id,'gameverse.owner':task.owner,'gameverse.manager':task.manager_id}});}
  stop(id){return this.request(`${this.base}/sandbox/${encodeURIComponent(id)}/stop`,'POST');}
  owned(sandbox,task){assert(sandbox.name===task.sandbox_name&&sandbox.labels?.['gameverse.task']===task.id&&sandbox.labels?.['gameverse.owner']===task.owner&&sandbox.labels?.['gameverse.scope']==='dev-manager-v1','sandbox_identity_mismatch');}
}
