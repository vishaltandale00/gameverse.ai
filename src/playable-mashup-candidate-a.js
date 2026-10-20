/** Relay Runner: authored complete research game executing recovered generated C
 * through WebAssembly. JS source functions below are differential baselines only. */
import {createInputLifecycle,createCombatLifecycle} from './playable-mashup-lifecycle.js';
import {createWorld,resolveTerrain,resetToCheckpoint} from './playable-mashup-world.js';
const s16 = x => (x << 16) >> 16;
// DB actor_edges_repeat, exact unsigned widths. Selected bits are authored inputs.
export function sourceInput(s, selected, disabled=false) {
  const held = disabled ? 0 : selected & 65535, old=s.held||0;
  s.pressed=held & (~old & 65535); s.released=old & (~held & 65535);
  s.held=held; s.repeat=s.pressed & 783;
  if (!(held & 240)) s.timer=16;
  else { if (s.timer===0 || s.timer===16) {s.repeat|=held&240;if(s.timer===0)s.timer=8;} s.timer=(s.timer-1)&255; }
  return s;
}
// Sonic air_steering for configured flags258/pose0, Q8 signed velocity and
// source cap1152/acceleration24. No inferred conversion to original frame time.
export function sourceMotion(p, held) {
  let vx=s16(p.vxQ8),vy=s16(p.vyQ8);
  if(held&2) vx=Math.max(vx-48,-1152); else if(held&1) vx=Math.min(vx+48,1152);
  if((vy&65535)>48383) {const drag=vx>>5; if(drag<0)vx=Math.min(0,vx-drag);else if(drag>=1)vx=Math.max(0,vx-drag);}
  p.vxQ8=s16(vx);p.xQ8=(p.xQ8+p.vxQ8)|0;p.yQ8=(p.yQ8+vy)|0;p.vyQ8=s16(vy+42);
}
// MZM impact over canonical enemy energy/reaction fields; all lethal branches
// preserved, including special terminal flag state. Field names are authored.
export function sourceDamage(s, amount) {
  amount &=65535;
  const lethal=amount>=s.hp;
  s.hp=lethal?0:(s.hp-amount)&65535;
  if(lethal){s.flags|=16;s.timer=0;s.pose=0;s.terminal=98;s.terminalAux=1;if(s.special && s.specialState===1){s.specialState=2;s.special=0;}}
  s.reaction=(s.reaction&128)|17;s.flags|=2;
  return Number(lethal);
}
const platforms=[{x:0,y:420,width:620,height:60},{x:690,y:420,width:1070,height:60},{x:200,y:350,width:105,height:18},{x:385,y:305,width:125,height:18},{x:750,y:340,width:110,height:18},{x:940,y:270,width:120,height:18},{x:1130,y:205,width:140,height:18},{x:1400,y:290,width:120,height:18}];
const gate={x:1350,y:120,width:20,height:300};
const base={id:'relay-runner-causeway-v1',width:1760,height:480,solids:platforms,hazards:[{x:620,y:456,width:70,height:24},{x:1390,y:410,width:65,height:10}],spawn:{x:65,y:420},checkpoints:[{id:'relay',x:745,y:420},{id:'seal',x:1320,y:420}]};
const freshEnemy=(id,x,y,hp,armored=false)=>({id,x,y,homeX:x,homeY:y,hp,maxHp:hp,armored,kind:'flyer',reaction:0,flags:0,pose:1,timer:0,special:0,specialState:0,terminal:0,terminalAux:0,dead:false});
export async function createCandidate({wasmBytes}={}) {
  if(!wasmBytes){
    if(typeof window==='undefined'){const {readFile}=await import('node:fs/promises');wasmBytes=await readFile(new URL('../local-data/playable-mashups/relay-runner.wasm',import.meta.url));}
    else {const response=await fetch('/private-playable/relay-runner.wasm');if(!response.ok)throw new Error('Relay Runner source WASM unavailable');wasmBytes=await response.arrayBuffer();}
  }
  const {instance}=await WebAssembly.instantiate(wasmBytes,{}),native=instance.exports;
  const wasmInput=(s,selected,disabled=false)=>{native.relay_input(s.timer,s.held,selected,+disabled);[s.timer,s.held,s.pressed,s.released,s.repeat]=[0,1,2,3,4].map(native.relay_result);};
  const wasmMotion=(p,held)=>{native.relay_motion(p.vxQ8,p.vyQ8,held,p.xQ8,p.yQ8);[p.xQ8,p.yQ8,p.vxQ8,p.vyQ8]=[0,1,2,3].map(native.relay_result);};
  const damageKeys=['hp','paletteSelector','terminal','terminalAux','reaction','timer','special','flags','specialState'];
  const wasmDamage=(s,amount)=>{native.relay_damage(...damageKeys.map(k=>s[k]||0),amount);const result=native.relay_result(0);damageKeys.forEach((k,i)=>s[k]=native.relay_result(i+1));return result;};
  const wasmReaction=e=>{native.relay_reaction(e.hp,0,e.paletteSelector||0,e.reaction,0,0,0,0,e.animationTick||0,e.terminal);e.reaction=native.relay_result(0);e.paletteSelector=native.relay_result(1);e.animationTick=native.relay_result(2);e.sourceSuppressed=!!native.relay_result(3);};
  let player,enemies,phase,tick,events,history,cores,guardianDefeated,attack,attackCooldown,doubleJump,airUsed,checkpoint,world,calls,sourceKeys;
  const input=createInputLifecycle({actions:{jump:'press',attack:'press',confirm:'press',left:'hold',right:'hold'}});
  const combat=createCombatLifecycle({protectionTicks:38,onDeath(id){if(id==='player') {phase='lost';announce('Courier down. Press Enter to restart.');} else {const e=enemies.find(e=>e.id===id);e.dead=true;if(e.guardian){guardianDefeated=true;announce('Sentinel shattered! Deliver the cores to the beacon.');return;}cores++;if(cores===1){doubleJump=true;checkpoint=true;announce('Relay core recovered: AIR STEP unlocked! Jump again in midair.');}else announce('Both relay cores recovered. Exit seal open!');}}});
  function announce(text){events.push({type:'message',text,tick});history.push(text);history=history.slice(-5);}
  function rebuildWorld(){world=createWorld({...base,solids:cores>=2?platforms:[...platforms,gate]});}
  function reset(){phase='playing';tick=0;events=[];history=[];cores=0;guardianDefeated=false;attack=null;attackCooldown=0;doubleJump=false;airUsed=false;checkpoint=false;calls={input:0,motion:0,damage:0,reaction:0};sourceKeys={held:0,timer:16};player={id:'player',xQ8:65*256,yQ8:420*256,vxQ8:0,vyQ8:0,x:65,y:420,grounded:true,hp:12,maxHp:12,facing:1,reaction:0,flags:0,pose:0,timer:0,special:0,specialState:0};enemies=[freshEnemy('sentry-alpha',440,378,6),freshEnemy('sentry-beta',1190,170,9,true),{...freshEnemy('sentinel',1540,405,9,true),guardian:true,kind:'guardian',telegraph:false,charging:false,chargeDirection:-1}];rebuildWorld();combat.reset();input.reset();combat.addActor('player',{getHp:()=>player.hp});for(const e of enemies)combat.addActor(e.id,{getHp:()=>e.hp});announce('Recover two relay cores. Defeat the low sentry to unlock Air Step.');return observe();}
  function step(raw={}){
    events=[];const controls=input.sample(raw);
    if(phase!=='playing'){if(controls.pressed.confirm)reset();return observe();}
    tick++;combat.beginStep();
    wasmInput(sourceKeys,(raw.right?1:0)|(raw.left?2:0)|(raw.jump?4:0)|(raw.attack?8:0));calls.input++;
    if(attackCooldown>0)attackCooldown--;
    if(attack && --attack.life<=0){combat.retireAction(attack.id);attack=null;}
    if(sourceKeys.held&1)player.facing=1;else if(sourceKeys.held&2)player.facing=-1;
    if((sourceKeys.pressed&4) && (player.grounded || (doubleJump&&!airUsed))){if(!player.grounded)airUsed=true;player.vyQ8=-1500;player.grounded=false;events.push({type:'jump',double:airUsed});}
    if((sourceKeys.pressed&8) && controls.actions.attack && !attackCooldown){attack={id:controls.actions.attack,life:13,damage:Math.abs(player.vxQ8)>=640?3:2,facing:player.facing};attackCooldown=22;events.push({type:'attack',damage:attack.damage});}
    const previous={xQ8:player.xQ8,yQ8:player.yQ8};wasmMotion(player,sourceKeys.held);calls.motion++;
    // Ground release braking is authored responsiveness glue; air inertia is source.
    if(player.grounded && !(sourceKeys.held&3))player.vxQ8=Math.trunc(player.vxQ8*0.72);
    const terrain=resolveTerrain(world,player,previous,{halfWidth:10,height:28});if(terrain.grounded)airUsed=false;
    if(terrain.hazard || player.y>470){combat.contact({actorId:'player',actionId:`fall:${tick}`,applyHit(){calls.damage++;wasmDamage(player,3);}});if(phase==='playing'){resetToCheckpoint(world,player,{x:0,y:0,width:960,height:480},cores>=2?'seal':checkpoint?'relay':null);announce('Lost footing. Returned to the relay checkpoint.');}}
    for(const e of enemies){if(phase!=='playing')break;if(e.dead)continue;wasmReaction(e);calls.reaction++;if(e.guardian){
        if(cores<2)continue;
        if(!e.active){e.active=true;e.age=0;e.chargeDirection=player.x<e.x?-1:1;}const cycle=e.age%150;if(!e.sourceSuppressed)e.age++;e.telegraph=cycle<50;e.charging=cycle>=50&&cycle<80&&!e.sourceSuppressed;e.state=e.telegraph?'telegraph':e.charging?'charging':'recovery';e.stateTicks=e.telegraph?50-cycle:e.charging?80-cycle:150-cycle;e.pose=e.telegraph?'charge-warning':e.charging?'charge':'recover';
        if(cycle===0)e.chargeDirection=player.x<e.x?-1:1;
        if(e.charging)e.x=Math.max(1460,Math.min(1640,e.x+e.chargeDirection*4.5));
      }else if(!e.sourceSuppressed){e.x=e.homeX+Math.sin(tick/52+(e.armored?1:0))*28;e.y=e.homeY+Math.sin(tick/27)*7;}
      const dx=e.x-player.x,dy=(e.y-14)-(player.y-16);
      if(attack&&e.guardian&&Math.abs(player.vxQ8)<640&&Math.abs(dx)<76&&Math.abs(dy)<49&&e.clanged!==attack.id){e.clanged=attack.id;events.push({type:'clang',text:'Shield held: strike at running speed!',x:e.x,y:e.y});}
      if(attack && (!e.guardian||Math.abs(player.vxQ8)>=640) && Math.abs(dx)<76 && Math.abs(dy)<49 && dx*attack.facing>-12){const damage=e.guardian?3:e.armored?Math.max(1,attack.damage-1):attack.damage;combat.contact({actorId:e.id,actionId:attack.id,applyHit(){calls.damage++;wasmDamage(e,damage);events.push({type:'hit',x:e.x,y:e.y,damage});}});}
      if(!e.dead && (!e.guardian||e.charging) && Math.abs(dx)<28 && Math.abs(dy)<27){const result=combat.contact({actorId:'player',actionId:`body:${e.id}:${Math.floor(tick/45)}`,applyHit(){calls.damage++;wasmDamage(player,2);player.vxQ8=dx<0?500:-500;}});if(result.accepted)events.push({type:'hurt'});}
    }
    if(cores>=2 && world.solids.length!==platforms.length)rebuildWorld();
    if(phase==='playing'&&cores>=2&&guardianDefeated&&player.x>1650){phase='won';announce('Relay restored. The causeway is safe! Press Enter for a fresh run.');}
    combat.endStep();events.push(...combat.drainEvents());return observe();
  }
  function observe(){return structuredClone({id:'relay-runner',version:'relay-runner-wasm-20261016-r3',title:'Relay Runner',status:phase,phase,tick,projection:'sideview',player:{...player,pose:attack?'attack':player?.grounded?'run':'jump',attacking:!!attack,attack, momentumReady:Math.abs(player?.vxQ8||0)>=640,airStepReady:doubleJump&&!airUsed&&!player?.grounded,protected:player?combat.observe('player').protection:0},actors:enemies?.filter(e=>!e.dead&&(!e.guardian||cores>=2)),enemies,world:{width:1760,height:480,tileSize:16,platforms,solids:platforms,gates:[{...gate,open:cores>=2}],hazards:base.hazards,exit:{x:1660,y:345,width:50,height:75},checkpoints:base.checkpoints,signs:[{x:75,y:360,text:'Run → release to brake · Jump across breaks'},{x:390,y:285,text:'Strike J · Speed strengthens the blow'},{x:780,y:285,text:'AIR STEP: jump again in the air'},{x:1320,y:350,text:'Checkpoint · Jump the hot conduit'},{x:1490,y:320,text:'Sentinel shield: strike while moving fast'}]},objective:cores===0?'Defeat the low sentry • recover Air Step':cores===1?'Air Step onto the high relay • defeat armored sentry':guardianDefeated?'Deliver both cores to the beacon':'Jump the conduit • shatter sentinel with moving strikes',progress:{cores,total:2,doubleJump,checkpoint,guardianDefeated,chapter:cores===0?'I · The broken relay':cores===1?'II · Air Step ascent':guardianDefeated?'IV · Home signal':'III · Sentinel causeway'},events,log:history,ending:phase==='won'?{title:'Home signal restored',text:'You reclaimed Air Step, recovered both relay cores, crossed the conduit and shattered the charging sentinel.',ticks:tick,hp:player.hp,cores,guardianDefeated}:null,controls:{left:'A / ←',right:'D / →',jump:'Space / Z (again for Air Step)',attack:'J / X',confirm:'Enter: restart after win or loss'},sourceCalls:calls,provenance:{execution:'Actual recovered generated C compiled to WebAssembly; JS translations retained only as differential test baselines',recovered:['db.input.actor_edges_repeat','sonic.motion.air_steering','sonic.motion.integrate','sonic.motion.gravity','mzm.combat.impact','mzm.combat.reaction_tick','mzm.lifecycle.enemy_update_gate'],authored:['60Hz invocation policy','world and terrain','jump / Air Step admission','attack allocation / contact / protection','enemy patrol and telegraphed sentinel charge','progression / objective','scene art'],cadence:'One source invocation per authored 60Hz game tick; no original source cadence parity claimed'}});}
  reset();return {reset,step,observe,dispose(){phase='disposed';}};
}
