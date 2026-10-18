import { DurableObject } from 'cloudflare:workers';

// Random, hashed transaction/session IDs select independent objects. No global
// account list or provider access token is retained here.
export class IdentityState extends DurableObject {
  async putRecord(record) {
    await this.ctx.storage.transaction(async txn => {
      if (await txn.get('record')) throw Error('identity_record_exists');
      await txn.put('record', record);
    });
    await this.ctx.storage.setAlarm(record.expires_at);
  }
  async readSession() {
    const record = await this.ctx.storage.get('record');
    return record?.kind === 'session' && record.expires_at > Date.now() ? record : null;
  }
  async reservePhoneCheck(binding) {
    return this.ctx.storage.transaction(async txn => {
      const record = await txn.get('record');
      if (!record || record.kind !== 'phone-challenge' || record.expires_at <= Date.now()
        || record.binding !== binding || record.attempts >= 5 || record.check_id) return null;
      const checkId=crypto.randomUUID();
      await txn.put('record', {...record,attempts:record.attempts+1,check_id:checkId});
      return {...record,check_id:checkId};
    });
  }
  async finishPhoneCheck(checkId, approved) {
    return this.ctx.storage.transaction(async txn => {
      const record=await txn.get('record');
      if(!record||record.expires_at<=Date.now()||record.check_id!==checkId)return false;
      if(approved||record.attempts>=5)await txn.delete('record');
      else await txn.put('record',{...record,check_id:null});
      return true;
    });
  }
  async takeRateLimit(limit, windowMs) {
    const result=await this.ctx.storage.transaction(async txn=>{
      let bucket=await txn.get('rate');
      if(!bucket||bucket.reset_at<=Date.now())bucket={count:0,reset_at:Date.now()+windowMs};
      if(bucket.count>=limit)return {allowed:false,reset_at:bucket.reset_at};
      await txn.put('rate',{...bucket,count:bucket.count+1});
      return {allowed:true,reset_at:bucket.reset_at};
    });
    await this.ctx.storage.setAlarm(result.reset_at);
    return result.allowed;
  }
  async revoke() { await this.ctx.storage.deleteAll(); }
  async alarm() { await this.ctx.storage.deleteAll(); }
}
