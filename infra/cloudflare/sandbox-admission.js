import { DurableObject } from 'cloudflare:workers';

// A small staging-wide resource cap, independent of a project's loop algorithm.
// An expired deadline never frees a slot until actual sandbox deletion is confirmed.
export class SandboxAdmission extends DurableObject {
  constructor(ctx,env) {
    super(ctx,env);
    this.sql=ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS hosted_slot (id TEXT NOT NULL, owner TEXT NOT NULL, PRIMARY KEY(owner,id))');
    this.sql.exec('CREATE TABLE IF NOT EXISTS active_sandbox (name TEXT PRIMARY KEY, deadline INTEGER NOT NULL)');
  }
  claim(name,deadline) {
    if(this.sql.exec('SELECT name FROM active_sandbox WHERE name=?',name).toArray().length)return true;
    if(this.sql.exec('SELECT COUNT(*) AS count FROM active_sandbox').one().count>=1)return false;
    this.sql.exec('INSERT INTO active_sandbox (name,deadline) VALUES (?,?)',name,deadline);return true;
  }
  claimHosted(owner,id,limit) {
    if(!/^phone:[a-f0-9]{64}$/.test(owner)||!/^[a-f0-9-]{36}$/.test(id)||!Number.isInteger(limit)||limit<1||limit>8)throw Error('invalid_hosted_admission');
    const old=this.sql.exec('SELECT owner FROM hosted_slot WHERE owner=? AND id=?',owner,id).toArray()[0];
    if(old)return true;
    if(this.sql.exec('SELECT COUNT(*) AS count FROM hosted_slot').one().count>=limit)return false;
    this.sql.exec('INSERT INTO hosted_slot(id,owner) VALUES(?,?)',id,owner);return true;
  }
  releaseHosted(owner,id){this.sql.exec('DELETE FROM hosted_slot WHERE owner=? AND id=?',owner,id);}
  releaseConfirmed(name) { this.sql.exec('DELETE FROM active_sandbox WHERE name=?',name); }
}
