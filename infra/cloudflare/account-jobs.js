import { DurableObject } from 'cloudflare:workers';
import { Daytona } from './daytona.js';
import { developerAccount, sha256 } from './phone-sign-in.js';
import { runtimeRoot, authPath, runtimeScript, installCommand, startRuntimeCommand, cliVersion } from './claude-runtime.js';

const terminal=new Set(['succeeded','failed','cancelled','cleanup_failed']);
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const decoder=new TextDecoder();
const safeReason=error=>/^(daytona_[a-z0-9_]+|connection_[a-z0-9_]+|credential_[a-z0-9_]+|login_superseded|[a-z]+_not_ready)$/.test(error.message)?error.message:'operation_failed';

export class AccountJobs extends DurableObject {
  constructor(ctx,env) {
    super(ctx,env);this.sql=ctx.storage.sql;this.api=new Daytona(env);
    const interval=Number(env.HOST_RECONCILE_MS);
    this.reconcileMs=Number.isSafeInteger(interval)&&interval>=25&&interval<=60000?interval:5000;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS account (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operation (id TEXT PRIMARY KEY, record TEXT NOT NULL);`);
  }
  initialize(owner) {
    if(typeof owner!=='string'||!/^phone:[0-9a-f]{64}$/.test(owner))throw Error('invalid_account');
    this.sql.exec('INSERT OR IGNORE INTO account (id,owner) VALUES (1,?)',owner);
    if(this.owner()!==owner)throw Error('account_mismatch');
  }
  owner() { return this.sql.exec('SELECT owner FROM account WHERE id=1').one().owner; }
  connections() { return this.env.AGENT_CONNECTIONS.getByName(this.owner()); }
  records() { return this.sql.exec('SELECT record FROM operation ORDER BY rowid').toArray().map(row=>JSON.parse(row.record)); }
  record(id) { const row=this.sql.exec('SELECT record FROM operation WHERE id=?',id).toArray()[0];return row?JSON.parse(row.record):null; }
  patch(id,values) {
    const row={...this.record(id),...values,updated_at:Date.now()};
    this.sql.exec('UPDATE operation SET record=? WHERE id=?',JSON.stringify(row),id);return row;
  }
  publicRecord(row) {
    if(!row)return null;
    return {schema:'gameverse.hosted-operation/1',id:row.id,type:row.type,provider:row.provider,phase:row.phase,
      intent:row.intent||null,target:row.target||null,baseline:row.baseline||null,created_at:row.created_at,
      updated_at:row.updated_at,started_at:row.started_at||null,finished_at:row.finished_at||null,
      auth_url:row.auth_url||null,reason:row.reason||null,cleanup_confirmed:row.cleanup_confirmed||false,
      connection_step:row.type==='connect'?(row.phase==='succeeded'||row.phase==='cleaning'&&row.outcome==='succeeded'?'connected':
        terminal.has(row.phase)?row.phase:row.cancel_requested?'cancelling':row.auth_code_submitted_at?'verifying':row.auth_url?'authorize':'preparing'):null,
      cancellation_requested:row.cancel_requested||false,result_available:!!row.result_key,
      total_ms:row.finished_at?row.finished_at-row.created_at:null,
      queue_ms:row.started_at&&row.queued_at?row.started_at-row.queued_at:null,
      runtime_sha256:row.runtime_sha256||null,cli_version:cliVersion};
  }
  list() { return this.records().slice(-30).reverse().map(row=>this.publicRecord(row)); }
  get(id) { return this.publicRecord(this.record(id)); }
  insert(row) {
    if(this.records().filter(r=>r.created_at>Date.now()-86400000).length>=10)throw Error('pilot_daily_limit');
    this.sql.exec('INSERT INTO operation (id,record) VALUES (?,?)',row.id,JSON.stringify(row));
  }
  async requestConnection(id) {
    if(!uuid(id))throw Error('invalid_request_id');
    const existing=this.record(id);
    if(existing){if(existing.type!=='connect')throw Error('request_conflict');return this.publicRecord(existing);}
    const active=this.records().find(r=>r.type==='connect'&&!terminal.has(r.phase));
    if(active)return this.publicRecord(active);
    this.insert({id,type:'connect',provider:'claude',phase:'queued',created_at:Date.now(),updated_at:Date.now(),
      deadline:Date.now()+15*60000,sandbox_name:`gv-${id}`,queued_at:Date.now(),cancel_requested:false});
    await this.ctx.storage.setAlarm(Date.now()+1);return this.get(id);
  }
  async requestJob(id,intent,provider) {
    if(!uuid(id)||typeof intent!=='string'||!intent.trim()||intent.length>4000)throw Error('invalid_request');
    if(provider!=='claude')throw Error('provider_runtime_not_enabled');
    const existing=this.record(id);
    if(existing){if(existing.type!=='job'||existing.intent!==intent||existing.provider!==provider)throw Error('request_conflict');return this.publicRecord(existing);}
    const settings=await this.connections().getConnections();
    const ready=settings.connections.some(c=>c.provider===provider&&c.status==='connected');
    const runtimeDigest=await sha256(runtimeScript);
    // Recheck after yielding to connection lookup so concurrent request retries insert once.
    const retry=this.record(id);if(retry)return this.requestJob(id,intent,provider);
    this.insert({id,type:'job',provider,intent,target:'public-addition-fixture',baseline:'addition-todo/1',
      phase:ready?'queued':'awaiting_connection',created_at:Date.now(),updated_at:Date.now(),
      sandbox_name:`gv-${id}`,runtime_sha256:runtimeDigest,queued_at:ready?Date.now():null,cancel_requested:false});
    await this.ctx.storage.setAlarm(Date.now()+1);return this.get(id);
  }
  async continuePending() {
    const settings=await this.connections().getConnections();
    for(const row of this.records())if(row.phase==='awaiting_connection'&&!row.cancel_requested&&settings.connections.some(c=>c.provider===row.provider&&c.status==='connected'))this.patch(row.id,{phase:'queued',queued_at:Date.now()});
    await this.ctx.storage.setAlarm(Date.now()+1);
  }
  async cancel(id) {
    const row=this.record(id);if(!row)return null;
    if(!terminal.has(row.phase))this.patch(id,{cancel_requested:true,auth_url:null});
    await this.ctx.storage.setAlarm(Date.now()+1);return this.get(id);
  }
  async disconnect(provider) {
    const settings=await this.connections().disconnect(provider);
    for(const row of this.records())if(row.provider===provider&&!terminal.has(row.phase))this.patch(row.id,{cancel_requested:true,auth_url:null});
    await this.ctx.storage.setAlarm(Date.now()+1);return settings;
  }
  async submitLoginCode(id,code) {
    const row=this.record(id);
    if(!row||row.type!=='connect'||row.phase!=='running'||row.cancel_requested||typeof code!=='string'||!code.trim()||code.length>4096||/[\r\n\0]/.test(code))throw Error('login_not_ready');
    if(row.auth_code_submitted_at)return this.get(id);
    // Claim before yielding. Refreshes and duplicate submissions must keep showing
    // verification, without delivering the same code to the CLI twice.
    this.patch(id,{auth_code_submitted_at:Date.now(),auth_url:null});
    try{
      const sandbox=await this.api.get(row.sandbox_name);if(!sandbox||sandbox.state!=='started')throw Error('sandbox_not_ready');
      const current=this.record(id);if(current.cancel_requested||current.phase!=='running')return this.get(id);
      await this.api.upload(sandbox,`${runtimeRoot}/login-code`,new TextEncoder().encode(code.trim()));
    }
    catch(error){
      this.patch(id,{phase:'cleaning',outcome:'failed',reason:'authorization_submission_failed',auth_url:null});
      await this.ctx.storage.setAlarm(Date.now()+1);throw error;
    }
    return this.get(id);
  }
  async result(id) {
    const row=this.record(id);if(!row?.result_key)return null;
    const object=await this.env.ARTIFACTS.get(row.result_key);
    return object?{...JSON.parse(await object.text()),hosting_receipt:this.publicRecord(row)}:null;
  }
  async alarm() {
    // Persist the next recovery event before external I/O, including failed calls.
    await this.ctx.storage.setAlarm(Date.now()+this.reconcileMs);
    const rows=this.records().filter(r=>!terminal.has(r.phase)&&(r.phase!=='awaiting_connection'||r.cancel_requested));
    if(!rows.length){await this.ctx.storage.deleteAlarm();return;}
    const row=rows.find(r=>r.phase!=='queued')||rows[0];
    try { await this.advance(row.id); }
    catch(error) {
      const current=this.record(row.id);
      const failures=(current.failures||0)+1;
      if(current.phase==='cleaning'&&failures>=5)this.patch(row.id,{phase:'cleanup_failed',reason:'cleanup_not_confirmed',auth_url:null});
      else if(current.phase==='creating'&&!/^daytona_http_4/.test(error.message))this.patch(row.id,{reason:'provisioning_unconfirmed',failures});
      else if(current.phase==='running'&&!/_not_ready$|login_superseded|connection_use_revoked/.test(error.message)&&failures<3)this.patch(row.id,{reason:safeReason(error),failures});
      else this.patch(row.id,{phase:'cleaning',outcome:current.cancel_requested?'cancelled':'failed',reason:safeReason(error),auth_url:null,failures});
    }
  }
  async advance(id) {
    let row=this.record(id);
    if(row.cancel_requested||(row.deadline&&row.deadline<Date.now())||!await developerAccount(this.owner(),this.env)) {
      row=this.patch(id,{phase:'cleaning',outcome:row.cancel_requested?'cancelled':'failed',reason:row.cancel_requested?'cancelled':'deadline_or_access_expired',auth_url:null});
    }
    if(row.phase==='awaiting_connection')return;
    const admission=this.env.SANDBOX_ADMISSION.getByName('staging');
    if(row.phase==='queued') {
      const deadline=Date.now()+(row.type==='connect'?12:5)*60000;
      if(!await admission.claim(row.sandbox_name,deadline))return;
      this.patch(id,{phase:'creating',deadline,started_at:Date.now(),create_sent:false});
      if(row.type==='connect')await this.connections().startConnection('claude','browser',id);
      if(this.record(id).cancel_requested){this.patch(id,{phase:'cleaning',outcome:'cancelled'});return;}
      this.patch(id,{create_sent:true});
      const sandbox=await this.api.create(row.sandbox_name,{network:true,ttlMinutes:row.type==='connect'?12:5});
      this.patch(id,{phase:'preparing',sandbox_id:sandbox.id});return;
    }
    if(row.phase==='creating') {
      // An uncertain create response is reconciled by name; it is never POSTed twice.
      const sandbox=await this.api.get(row.sandbox_name);
      if(sandbox)this.patch(id,{phase:'preparing',sandbox_id:sandbox.id});
      return;
    }
    if(row.phase==='preparing') {
      const sandbox=await this.api.get(row.sandbox_name);
      if(!sandbox)throw Error('sandbox_not_ready');
      if(sandbox.state!=='started')return;
      if(sandbox.cpu!==1||sandbox.memory!==1||sandbox.disk!==3)throw Error('sandbox_resources_not_ready');
      this.patch(id,{phase:'setup_sent'});
      const installed=await this.api.execute(sandbox,installCommand,30);
      if(installed.exitCode!==0)throw Error('runtime_not_ready');
      await this.api.upload(sandbox,`${runtimeRoot}/runtime.mjs`,new TextEncoder().encode(runtimeScript));
      if(row.type==='job') {
        const use=await this.connections().claimUse('claude',id,300000);
        this.patch(id,{lease_id:use.lease_id,credential_revision:use.revision,auth_method:use.auth_method});
        await this.api.upload(sandbox,use.auth_method==='browser'?authPath:`${runtimeRoot}/api-key`,new TextEncoder().encode(use.credential));
      }
      if(this.record(id).cancel_requested)return;
      this.patch(id,{phase:'running',runtime_sent_at:Date.now()});
      await this.api.execute(sandbox,startRuntimeCommand(row.type==='connect'?'connect':'job',id));return;
    }
    if(row.phase==='setup_sent')throw Error('runtime_not_ready');
    if(row.phase==='running') {
      const sandbox=await this.api.get(row.sandbox_name);if(!sandbox)throw Error('sandbox_not_ready');
      const bytes=await this.api.download(sandbox,`${runtimeRoot}/status.json`,8192);
      if(!bytes){if(Date.now()-row.runtime_sent_at>30000)throw Error('runtime_not_ready');return;}
      const status=JSON.parse(decoder.decode(bytes));
      if(status.phase==='failed')throw Error('runtime_not_ready');
      if(row.type==='connect'&&status.auth_url&&!this.record(id).auth_code_submitted_at) {
        const url=new URL(status.auth_url);
        if(url.protocol!=='https:'||!['claude.ai','claude.com','platform.claude.com','console.anthropic.com'].includes(url.hostname))throw Error('provider_not_ready');
        if(row.auth_url!==url.toString())this.patch(id,{auth_url:url.toString()});
      }
      if(row.type==='connect'&&status.phase==='authorized') {
        const auth=await this.api.download(sandbox,authPath,65536);if(!auth)throw Error('credential_not_ready');
        const credential=decoder.decode(auth), parsed=JSON.parse(credential);
        if(typeof parsed.claudeAiOauth?.accessToken!=='string')throw Error('credential_not_ready');
        await this.connections().completeConnection('claude',id,credential);
        this.patch(id,{phase:'cleaning',outcome:'succeeded',auth_url:null});return;
      }
      if(row.type==='job'&&status.phase==='finished') {
        const resultBytes=await this.api.download(sandbox,`${runtimeRoot}/result.json`,16384);
        if(!resultBytes)throw Error('result_not_ready');
        const result=JSON.parse(decoder.decode(resultBytes));
        if(result.schema!=='gameverse.connected-agent-probe/1'||result.run_id!==id||typeof result.success!=='boolean'
          ||!/^[0-9a-f]{64}$/.test(result.source_sha256)||result.cli_version!==cliVersion)throw Error('result_not_ready');
        const source=await this.api.download(sandbox,`${runtimeRoot}/work/calculator.py`,4096);
        if(!source||await sha256(decoder.decode(source))!==result.source_sha256)throw Error('result_not_ready');
        const verify=await this.api.execute(sandbox,`cd ${runtimeRoot}/work && python3 -c 'from calculator import add; assert add(2,3)==5; assert add(-2,3)==1; assert add(0,0)==0; assert add(1.5,2.25)==3.75' > /dev/null 2>&1`,5);
        const checks={source_changed:result.checks?.source_changed===true,addition_cases_passed:result.checks?.addition_cases_passed===true};
        result.success=result.success&&checks.source_changed&&checks.addition_cases_passed&&verify.exitCode===0;
        if(this.record(id).cancel_requested){this.patch(id,{phase:'cleaning',outcome:'cancelled'});return;}
        if(row.auth_method==='browser') {
          const auth=await this.api.download(sandbox,authPath,65536);if(!auth)throw Error('credential_not_ready');
          const tokens=JSON.parse(decoder.decode(auth)).claudeAiOauth;
          if(Object.values(tokens||{}).some(value=>typeof value==='string'&&value.length>=12&&decoder.decode(source).includes(value)))throw Error('credential_in_result');
          await this.connections().saveRefreshedCredential('claude',row.lease_id,row.credential_revision,decoder.decode(auth));
        }else{
          const key=await this.api.download(sandbox,`${runtimeRoot}/api-key`,2048);
          if(!key||decoder.decode(source).includes(decoder.decode(key)))throw Error('credential_in_result');
        }
        // Retain a whitelisted receipt, not raw provider output or authentication logs.
        const retained={schema:result.schema,run_id:id,success:result.success,checks,
          source_sha256:result.source_sha256,cli_version:cliVersion,num_turns:Number.isSafeInteger(result.num_turns)?result.num_turns:null,
          reported_cost_usd:Number.isFinite(result.reported_cost_usd)?result.reported_cost_usd:null,
          started_at:Number.isSafeInteger(result.started_at)?result.started_at:null,finished_at:Number.isSafeInteger(result.finished_at)?result.finished_at:null,
          runtime_sha256:row.runtime_sha256,target:row.target,baseline:row.baseline};
        const key=`accounts/${this.owner()}/runs/${id}/result.json`;
        await this.env.ARTIFACTS.put(key,JSON.stringify(retained),{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});
        await this.env.ARTIFACTS.put(`accounts/${this.owner()}/runs/${id}/calculator.py`,source,{onlyIf:{etagDoesNotMatch:'*'}});
        const cancelled=this.record(id).cancel_requested;
        this.patch(id,{result_key:key,phase:'cleaning',outcome:cancelled?'cancelled':result.success?'succeeded':'failed',reason:cancelled?'cancelled':result.success?null:'agent_task_failed'});return;
      }
      return;
    }
    if(row.phase==='cleaning') {
      if(row.create_sent){await this.api.delete(row.sandbox_name);const sandbox=await this.api.get(row.sandbox_name);if(sandbox&&sandbox.state!=='destroyed')return;}
      if(row.type==='connect')await this.connections().cancelConnection('claude',id);
      else await this.connections().finishRunUse('claude',id);
      await admission.releaseConfirmed(row.sandbox_name);
      this.patch(id,{phase:row.outcome||'failed',cleanup_confirmed:true,finished_at:Date.now(),auth_url:null});
      await this.continuePending();
    }
  }
}
