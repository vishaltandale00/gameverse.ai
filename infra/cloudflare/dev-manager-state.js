import { DurableObject } from 'cloudflare:workers';
import { Registry } from '../../scripts/dev-manager/registry-core.js';
export class DevManagerState extends DurableObject {
  constructor(ctx,env){super(ctx,env);this.sql=ctx.storage.sql;this.sql.exec('CREATE TABLE IF NOT EXISTS registry (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)');
    const row=this.sql.exec('SELECT value FROM registry WHERE id=1').toArray()[0];
    this.core=new Registry({...(row?{state:JSON.parse(row.value)}:{}),save:value=>this.sql.exec('INSERT INTO registry (id,value) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',JSON.stringify(value))});}
  register(v){return this.core.register(v);} device(id){return this.core.device(id);} nonce(...args){return this.core.nonce(...args);}
  pair(...args){return this.core.pair(...args);} revoke(...args){return this.core.revoke(...args);}
  authorize(id){return this.core.authorize(id);} submit(...args){return this.core.submit(...args);} cancel(...args){return this.core.cancel(...args);}
  sync(...args){return this.core.sync(...args);} manage(...args){return this.core.manage(...args);} poll(...args){return this.core.poll(...args);}
  report(...args){return this.core.report(...args);} artifact(...args){return this.core.artifact(...args);} view(owner){return this.core.view(owner);}
  task(id){return this.core.task(id);}
}
