// Shared data contract only: no provider credentials or arbitrary commands.
export const VERSION = 1;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const HASH = /^[0-9a-f]{64}$/;
export const SOURCE = /^[0-9a-f]{40}$/;
export const terminal = value => ['succeeded','failed','cancelled'].includes(value);
export const fail = (code, status = 409) => Object.assign(Error(code), {status});
export const assert = (value, code = 'invalid_request', status = 409) => { if (!value) throw fail(code,status); };
export const canonical = value => JSON.stringify(sort(value));
function sort(value) { return Array.isArray(value) ? value.map(sort) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,sort(value[key])])) : value; }
export function publicKey(key) {
  assert(key?.kty === 'EC' && key.crv === 'P-256' && /^[A-Za-z0-9_-]{43}$/.test(key.x) && /^[A-Za-z0-9_-]{43}$/.test(key.y) && !key.d,'invalid_public_key');
  return {kty:'EC',crv:'P-256',x:key.x,y:key.y};
}
export function limits(value) {
  assert(value && Object.keys(value).sort().join(',') === 'job_wall_ms,max_jobs,max_sandboxes,model_calls,wall_ms','invalid_limits');
  const integer=(key,min,max)=>assert(Number.isSafeInteger(value[key])&&value[key]>=min&&value[key]<=max,'invalid_limits');
  integer('wall_ms',1000,900000); integer('job_wall_ms',1000,120000); integer('max_jobs',1,8); integer('max_sandboxes',1,4);
  assert(value.job_wall_ms <= value.wall_ms && value.model_calls === 0,'unsupported_limits');
  return {...value};
}
export function fixtureRequest(value) {
  assert(value && Object.keys(value).every(key=>['id','manager_id','parent_id','role','source_commit','limits'].includes(key)),'invalid_task');
  assert(UUID.test(value.id)&&UUID.test(value.manager_id)&&SOURCE.test(value.source_commit),'invalid_task');
  const role=value.role||'parent'; assert(['parent','improvement'].includes(role),'unsupported_role');
  assert(role==='parent' ? !value.parent_id : UUID.test(value.parent_id),'invalid_parent');
  return {id:value.id,manager_id:value.manager_id,parent_id:value.parent_id||null,role,source_commit:value.source_commit,limits:limits(value.limits)};
}
export const signatureInput = (id,time,nonce,method,path,digest) => [id,time,nonce,method,path,digest].join('\n');
export const hex = bytes => Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
export const digest = async bytes => hex(await crypto.subtle.digest('SHA-256',typeof bytes==='string'?new TextEncoder().encode(bytes):bytes));
export function inventoryEntry(item) {
  assert(UUID.test(item?.id),'invalid_inventory');
  return {id:item.id,name:String(item.name||'').slice(0,100),state:String(item.state||'unknown').slice(0,40),
    cpu:Number.isFinite(item.cpu)?item.cpu:null,memory:Number.isFinite(item.memory)?item.memory:null,disk:Number.isFinite(item.disk)?item.disk:null,
    created_at:typeof (item.createdAt??item.created_at)==='string'&&(Number.isFinite(Date.parse(item.createdAt??item.created_at)))?(item.createdAt??item.created_at):null};
}
