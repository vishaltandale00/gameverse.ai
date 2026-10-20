import { DurableObject } from 'cloudflare:workers';

// A small staging-wide resource cap, independent of a project's loop algorithm.
// An expired deadline never frees a slot until actual sandbox deletion is confirmed.
export class SandboxAdmission extends DurableObject {
  constructor(ctx,env) {
    super(ctx,env);
    this.sql=ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS active_sandbox (name TEXT PRIMARY KEY, deadline INTEGER NOT NULL)');
  }
  claim(name,deadline) {
    if(this.sql.exec('SELECT name FROM active_sandbox WHERE name=?',name).toArray().length)return true;
    if(this.sql.exec('SELECT COUNT(*) AS count FROM active_sandbox').one().count>=1)return false;
    this.sql.exec('INSERT INTO active_sandbox (name,deadline) VALUES (?,?)',name,deadline);return true;
  }
  releaseConfirmed(name) { this.sql.exec('DELETE FROM active_sandbox WHERE name=?',name); }
}
