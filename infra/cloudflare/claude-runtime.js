// Public, fixed qualification task. No user text, credentials, or host management
// keys are interpolated into command strings. Secrets travel through file upload.
export const runtimeRoot = '/home/daytona/gameverse-run';
export const authPath = `${runtimeRoot}/auth/.credentials.json`;
export const cliVersion = '2.1.252';
export const installCommand = `mkdir -p ${runtimeRoot}/auth ${runtimeRoot}/work && chmod 700 ${runtimeRoot} ${runtimeRoot}/auth && npm install --prefix ${runtimeRoot}/tools --no-audit --no-fund @anthropic-ai/claude-code@${cliVersion} > ${runtimeRoot}/install.log 2>&1`;

export const runtimeScript = String.raw`
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync,unlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='/home/daytona/gameverse-run', auth=root+'/auth', work=root+'/work';
const mode=process.argv[2], jobId=process.argv[3];
const cli=root+'/tools/node_modules/.bin/claude';
const output=root+'/status.json';
const write=value=>writeFileSync(output,JSON.stringify(value),{mode:0o600});
const env={PATH:process.env.PATH,HOME:'/home/daytona',CLAUDE_CONFIG_DIR:auth,TERM:'dumb',BROWSER:'/bin/false',NO_COLOR:'1',DISABLE_TELEMETRY:'1',DISABLE_ERROR_REPORTING:'1'};
const started=Date.now();
let stdout='',stderr='',finished=false;
let args;
if(mode==='connect')args=['auth','login','--claudeai'];
else {
  if(existsSync(root+'/api-key'))env.ANTHROPIC_API_KEY=readFileSync(root+'/api-key','utf8');
  writeFileSync(work+'/calculator.py','def add(a, b):\n    raise NotImplementedError("Implement addition")\n');
  args=['-p','Implement add(a, b) in calculator.py using Python addition. Use the editing tools to change the file, then verify using python3. Keep the implementation minimal. Do not read files outside this working directory.','--output-format','json','--max-turns','4','--max-budget-usd','0.25','--permission-mode','acceptEdits','--allowedTools','Read','Edit','Write','Bash(python3*)','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--disable-slash-commands'];
}
const child=spawn(cli,args,{cwd:work,env,stdio:['pipe','pipe','pipe'],detached:true});
write({phase:mode==='connect'?'starting_login':'running',started_at:started});
const kill=()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}};
const timer=setTimeout(kill,mode==='connect'?600000:120000);
child.stdout.on('data',bytes=>{stdout=(stdout+bytes.toString()).slice(-131072);});
child.stderr.on('data',bytes=>{stderr=(stderr+bytes.toString()).slice(-131072);});
const poll=setInterval(()=>{
  if(mode!=='connect'||finished)return;
  const matches=(stdout+'\n'+stderr).match(/https:\/\/[^\s\x1b]+/g)||[];
  for(const raw of matches){try{
    const url=new URL(raw);
    if(['claude.ai','claude.com','platform.claude.com','console.anthropic.com'].includes(url.hostname)&&url.pathname.includes('oauth')) {
      write({phase:'awaiting_authorization',auth_url:url.toString(),started_at:started});break;
    }
  }catch{}}
  if(existsSync(root+'/login-code')){
    const code=readFileSync(root+'/login-code','utf8');unlinkSync(root+'/login-code');
    child.stdin.write(code.trim()+'\n');
  }
},250);
child.on('error',()=>{finished=true;clearInterval(poll);clearTimeout(timer);write({phase:'failed',reason:'runtime_start_failed'});});
child.on('close',async code=>{
  finished=true;clearInterval(poll);clearTimeout(timer);
  if(mode==='connect'){
    if(code!==0)writeFileSync(root+'/private-auth-diagnostic.json',JSON.stringify({stdout,stderr,exit_code:code}),{mode:0o600});
    write({phase:code===0&&existsSync(auth+'/.credentials.json')?'authorized':'failed',reason:code===0?null:'provider_login_failed',started_at:started,finished_at:Date.now()});return;
  }
  let agent={};try{agent=JSON.parse(stdout);}catch{}
  const verify=spawn('python3',['-c','from calculator import add; assert add(2,3)==5; assert add(-2,3)==1; assert add(0,0)==0; assert add(1.5,2.25)==3.75'],{cwd:work,env:{PATH:process.env.PATH},stdio:'ignore'});
  const verifyTimer=setTimeout(()=>verify.kill('SIGKILL'),5000);
  verify.on('close',verificationCode=>{
    clearTimeout(verifyTimer);
    const source=readFileSync(work+'/calculator.py','utf8');
    const changed=!source.includes('NotImplementedError');
    const success=code===0&&agent.type==='result'&&!agent.is_error&&Number.isSafeInteger(agent.num_turns)&&agent.num_turns>0&&verificationCode===0&&changed;
    const result={schema:'gameverse.connected-agent-probe/1',run_id:jobId,success,
      reason:success?null:'agent_task_failed',checks:{source_changed:changed,addition_cases_passed:verificationCode===0},
      source_sha256:createHash('sha256').update(source).digest('hex'),cli_version:'2.1.252',
      num_turns:Number.isSafeInteger(agent.num_turns)?agent.num_turns:null,
      reported_cost_usd:typeof agent.total_cost_usd==='number'?agent.total_cost_usd:null,
      started_at:started,finished_at:Date.now(),exit_code:code,verification_exit_code:verificationCode};
    writeFileSync(root+'/result.json',JSON.stringify(result),{mode:0o600});
    write({phase:'finished',success});
  });
});
`;

export const startRuntimeCommand = (mode, id) => {
  if(!['connect','job'].includes(mode)||!/^[0-9a-f-]{36}$/.test(id))throw Error('invalid_runtime_request');
  return `node ${runtimeRoot}/runtime.mjs ${mode} ${id} > ${runtimeRoot}/private-runtime.log 2>&1 < /dev/null &`;
};
