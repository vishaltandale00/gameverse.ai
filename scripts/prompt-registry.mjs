import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const sha = value => createHash('sha256').update(value).digest('hex');
export function validatePromptLock(lock) {
  if(lock?.schema!=='gameverse.prompt-lock/1'||!Array.isArray(lock.prompts))throw Error('invalid_prompt_lock');
  const ids=new Set();
  for(const pin of lock.prompts){
    if(ids.has(pin.id)||sha(pin.content)!==pin.sha256)throw Error('prompt_identity_mismatch');
    ids.add(pin.id);const value=JSON.parse(pin.content);
    if(value.schema!=='gameverse.prompt-template/1'||value.id!==pin.id||value.version!==pin.version||typeof value.template!=='string')throw Error('invalid_prompt_template');
  }
  return lock;
}
export async function loadPromptRegistry(root) {
  const raw=await readFile(join(root,'prompts/registry.json'),'utf8'), registry=JSON.parse(raw);
  if(registry.schema!=='gameverse.prompt-registry/1')throw Error('invalid_prompt_registry');
  const prompts=[];
  for(const pin of registry.prompts){
    if(!/^prompts\/[a-z0-9-]+\/[0-9]+\.[0-9]+\.[0-9]+\.json$/.test(pin.ref))throw Error('invalid_prompt_ref');
    prompts.push({...pin,content:await readFile(join(root,pin.ref),'utf8')});
  }
  return validatePromptLock({schema:'gameverse.prompt-lock/1',registry:{version:registry.version,sha256:sha(raw)},prompts});
}
export function renderPrompt(lock,id,values={}) {
  validatePromptLock(lock);const pin=lock.prompts.find(pin=>pin.id===id);
  if(!pin)throw Error('missing_prompt:'+id);
  const text=JSON.parse(pin.content).template.replace(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g,(_,key)=>{
    if(!Object.hasOwn(values,key)||typeof values[key]!=='string')throw Error('missing_prompt_variable:'+key);
    return values[key];
  });
  return {text,prompt:{id:pin.id,version:pin.version,template_sha256:pin.sha256,resolved_sha256:sha(text)}};
}
export async function savePromptCall(path,resolved) {
  await writeFile(path,JSON.stringify({schema:'gameverse.prompt-call/1',...resolved.prompt,resolved_prompt:resolved.text},null,2)+'\n',{mode:0o600});
  return {...resolved.prompt,snapshot:path};
}
export const promptLockSha256 = lock => sha(JSON.stringify(validatePromptLock(lock)));
