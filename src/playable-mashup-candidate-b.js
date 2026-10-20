/** Echo Tactics: authored complete tactical game. Recovered source mechanics
 * execute unchanged generated C compiled to WebAssembly. JS exports below are
 * retained differential baselines only, never a runtime fallback. */
import { createInputLifecycle, createProgressionLifecycle, createCombatLifecycle } from './playable-mashup-lifecycle.js';
export const CANDIDATE_B_VERSION = 'echo-tactics-wasm-v4';
export const SOURCE_ITEMS = [72,73,74,75,76,77,78,79,6,115,116,117];
export function sourceLearn(bank,item,state) {
  if (!Number.isInteger(item)||item<0||item>255||!Number.isInteger(state)||state<0||state>3) throw new RangeError('Qualified packed inventory domain');
  const shift=(item&3)*2; bank[item>>>2]=((bank[item>>>2]&~(3<<shift))|(state<<shift))&255;
}
export function sourceRefresh(bank) { return SOURCE_ITEMS.reduce((skills,item,i)=>skills|((((bank[item>>>2]>>>((item&3)*2))&3)===1)?1<<i:0),0); }
export function sourceExchange(actions,battlers,a=0,b=1) {
  if (![a,b].every(i=>Number.isInteger(i)&&i>=0&&i<4)) throw new RangeError('Qualified order position');
  [actions[a],actions[b]]=[actions[b],actions[a]]; [battlers[a],battlers[b]]=[battlers[b],battlers[a]];
}
// FFVI resolved-HP specialization: actor0 effect mask1, zero exclusion/current
// status/recovery, fresh VM continuation0. Only HP and pending KO are transferred.
export function sourceDamage(hp,damage,maxHp) {
  if (![hp,damage,maxHp].every(x=>Number.isInteger(x)&&x>=0)||hp>maxHp||maxHp>30||damage>12) throw new RangeError('Qualified resolved HP domain');
  const next=Math.max(0,hp-damage); return {hp:next,pendingKo:next===0&&damage>0?128:0};
}
/** Both source order lanes are authoritative: action chooses behavior, battler
 * supplies its actor. A broken pair is rejected before it can act. */
export function dispatchQueuedAction(action,battler,{playerAction,enemyAction}) {
  if(action===255&&battler===255)return;
  if(action===10){if(battler!==0)throw new Error('Inconsistent source hero action/battler pair');return playerAction();}
  if(action>=21&&action<=23){const actor=action-20;if(battler!==actor)throw new Error('Inconsistent source enemy action/battler pair');return enemyAction(actor-1);}
  throw new Error('Invalid source action queue entry');
}
export async function loadCandidateBMechanics({wasmBytes}={}) {
  if(!wasmBytes) {
    if(typeof window==='undefined') {const {readFile}=await import('node:fs/promises');wasmBytes=await readFile(new URL('../local/re/playable-mashups-20261016/candidate-b/mechanics.wasm',import.meta.url));}
    else {const response=await fetch('/playable-assets/candidate-b.wasm');if(!response.ok)throw new Error(`Echo Tactics source WASM unavailable (${response.status}); build candidate B mechanics.`);wasmBytes=await response.arrayBuffer();}
  }
  const {instance}=await WebAssembly.instantiate(wasmBytes,{});
  for(const name of ['b_reset','b_learn','b_refresh','b_bank_set','b_bank_get','b_order_set','b_exchange','b_order_action','b_order_battler','b_damage','b_presentation_reset','b_presentation_start','b_presentation_tick'])if(typeof instance.exports[name]!=='function')throw new Error(`Source WASM missing ${name}`);
  return instance.exports;
}
export async function createCandidate(options={}) {
  const wasm=await loadCandidateBMechanics(options);
  let state, inventory, combat, progression, serial=0, disposed=false;
  const input=createInputLifecycle({actions:{strike:'press',guard:'press',ember:'press',gale:'press',left:'press',right:'press',restart:'press'}});
  const say=text=>{ state.log.push(text); state.log=state.log.slice(-8); };
  const stages=[
    {name:'Threshold',reward:72,enemies:[['Moss sentinel',8,3]]},
    {name:'Ember Garden',enemies:[['Sun ward',6,2],['Moon ward',6,2],['Star ward',6,2]]},
    {name:'Storm Reliquary',reward:73,enemies:[['Storm herald',12,8,'storm']]},
    {name:'Crossed Paths',enemies:[['Dawn striker',7,8],['Dusk ward',7,1],['Ash ward',4,1]]},
    {name:'Crown Chamber',enemies:[['Crown keeper',24,9,'storm'],['Cinder ward',10,3],['Crown wisp',8,2]]}
  ];
  function register(actor) { combat.addActor(actor.id,{getHp:()=>actor.hp}); }
  function loadStage(index) {
    state.encounter=index+1; state.encounterTurn=0; state.room=stages[index].name; state.selectedTarget=0;
    state.enemies=stages[index].enemies.map(([name,hp,attack,pattern],i)=>({id:`enemy-${index}-${i}`,name,hp,maxHp:hp,attack,pattern:pattern||'strike',pendingKo:0,x:420+i*125,y:210+i*65}));
    state.enemies.forEach(register); say(`Gate ${index+1}: ${state.room}. Read the enemy intent before acting.`);
  }
  function capabilities() { state.skills=wasm.b_refresh(); return state.skills; }
  function available(kind,skills=capabilities()) {return (kind!=='ember'||(skills&1)!==0)&&(kind!=='gale'||(skills&2)!==0)&&(!['ember','gale'].includes(kind)||state.player.focus>=2);}
  function hit(actor,amount,id) {
    const result=combat.contact({actorId:actor.id,actionId:id,applyHit:()=>{const packed=wasm.b_damage(actor.hp,amount,actor.maxHp)>>>0;if(packed===0xffffffff)throw new RangeError('Source HP fixture bounds');actor.hp=packed&65535;actor.pendingKo|=packed>>>16;state.sourceCalls.damage++;}});
    if(result.accepted) state.events.push({type:'damage',actorId:actor.id,amount,hp:actor.hp});
  }
  function intent(enemy) {return enemy.hp<=0?{label:'Defeated',damage:0}:enemy.pattern==='storm'?(state.encounterTurn%2===0?{label:'Gathering storm · 0',damage:0}:{label:`Storm crash · ${enemy.attack}`,damage:enemy.attack}):{label:`Strike · ${enemy.attack}`,damage:enemy.attack};}
  function queuedOrder() {
    const foes=state.enemies.map((e,i)=>e.hp>0?i+1:255).filter(i=>i!==255), lanes=[...foes,0];
    while(lanes.length<4)lanes.push(255);return lanes;
  }
  function laneName(id){return id===0?'Wayfinder':id===255?'—':state.enemies[id-1]?.name||'—';}
  function resolve(command) {
    const kind=command.type;state.decisions[kind]=(state.decisions[kind]||0)+1;wasm.b_presentation_start(kind==='guard'?1:3);state.animationUntil=state.tick+24;state.turn++;state.encounterTurn++;state.events=[];combat.beginStep();
    const target=state.enemies[state.selectedTarget]; let block=kind==='guard'?6:0;
    const battlers=queuedOrder(),actions=battlers.map(id=>id===0?10:id===255?255:20+id);
    const before={actions:[...actions],battlers:[...battlers]};
    if(kind==='gale') {
      const hero=battlers.indexOf(0),selected=battlers.indexOf(state.selectedTarget+1);
      for(let i=0;i<4;i++)wasm.b_order_set(i,actions[i],battlers[i]);wasm.b_exchange(hero,selected);
      for(let i=0;i<4;i++){actions[i]=wasm.b_order_action(i);battlers[i]=wasm.b_order_battler(i);}state.sourceCalls.exchange++;
      state.events.push({type:'paired-order-exchange',before,after:{actions:[...actions],battlers:[...battlers]},target:target.id});
    }
    if(kind==='guard') {const at=battlers.indexOf(0);battlers.splice(at,1);actions.splice(at,1);battlers.unshift(0);actions.unshift(10);}
    state.order={before,actions:[...actions],battlers:[...battlers],names:battlers.map(laneName)};
    const playerAction=()=>{
      if(state.player.hp<=0)return;
      if(kind==='guard') {state.player.focus=Math.min(6,state.player.focus+2);state.player.hp=Math.min(state.player.maxHp,state.player.hp+2);say('Guard: block 6 from this volley, recover 2 HP and 2 focus.');}
      else {
        if(kind==='ember'||kind==='gale')state.player.focus-=2;
        const victims=kind==='ember'?state.enemies.filter(e=>e.hp>0):[target];
        for(const victim of victims)if(victim?.hp>0)hit(victim,kind==='ember'?4:kind==='gale'?7:5,`${command.commandId}:player`);
        say(kind==='ember'?'Ember sweeps every living ward for 4.':kind==='gale'?`Gale swaps your action with ${target?.name}: deal 7 at that queue position.`:`Strike ${target?.name} for 5.`);
      }
    };
    const enemyAction=enemy=>{
      if(enemy.hp<=0||state.player.hp<=0){if(enemy.hp<=0)state.decisions.interruptions++;state.events.push({type:'queued-action-cancelled',actorId:enemy.id,reason:enemy.hp<=0?'defeated-before-action':'player-terminal'});return;}
      const damage=enemy.pattern==='storm'?((state.encounterTurn-1)%2===0?0:enemy.attack):enemy.attack;
      const blocked=Math.min(block,damage);block-=blocked;const amount=damage-blocked;
      state.events.push({type:'enemy-action',actorId:enemy.id,damage:amount});
      if(amount)hit(state.player,amount,`${command.commandId}:${enemy.id}`);
      say(damage?`${enemy.name}: ${amount} damage${blocked?` (${blocked} blocked)`:''}.`:`${enemy.name} gathers a storm. Guard the next turn.`);
    };
    for(let i=0;i<4;i++){
      const lane=battlers[i];if(lane===255)continue;
      if(state.player.hp<=0){state.events.push({type:'queued-action-cancelled',actorId:lane===0?'player':state.enemies[lane-1]?.id,reason:'player-terminal'});continue;}
      dispatchQueuedAction(actions[i],lane,{playerAction:()=>{state.events.push({type:'player-action',action:kind});playerAction();},enemyAction:enemyIndex=>enemyAction(state.enemies[enemyIndex])});
    }
    combat.endStep();state.events.push(...combat.drainEvents());
    if(state.player.hp<=0){state.status='lost';say('The expedition falls. Restart and time Guard against the crown crash.');}
    else if(state.enemies.every(e=>e.hp===0)){
      state.decisions.gates.push(state.room);if(state.encounter===stages.length){state.status='won';say('The Crown is quiet. All five gates restored!');}
      else{const item=stages[state.encounter-1].reward;if(item!==undefined){progression.change({item,state:1});say(item===72?'Acquired Ember: 4 damage to ALL enemies.':'Acquired Gale: swap your queued action with the selected enemy.');}state.player.hp=Math.min(30,state.player.hp+8);state.player.focus=6;say('Gate restored: +8 HP, focus replenished.');loadStage(state.encounter);}

    }
    if(!state.enemies[state.selectedTarget]||state.enemies[state.selectedTarget].hp===0)state.selectedTarget=Math.max(0,state.enemies.findIndex(e=>e.hp>0));
  }
  function reset() {
    disposed=false;serial=0;input.reset();inventory=new Uint8Array(64);wasm.b_reset();wasm.b_presentation_reset();wasm.b_presentation_start(1);
    state={decisions:{strike:0,guard:0,ember:0,gale:0,interruptions:0,gates:[]},animationUntil:0,id:'candidate-b',version:CANDIDATE_B_VERSION,title:'Echo Tactics',status:'playing',tick:0,turn:0,encounter:1,player:{id:'player',name:'Wayfinder',hp:30,maxHp:30,focus:6,maxFocus:6,pendingKo:0,x:190,y:275},enemies:[],selectedTarget:0,skills:0,log:[],events:[],sourceCalls:{learn:0,refresh:0,exchange:0,damage:0}};
    combat=createCombatLifecycle({onDeath:id=>say(id==='player'?'Wayfinder is defeated.':`${state.enemies.find(e=>e.id===id)?.name??id} is defeated.`)});register(state.player);
    progression=createProgressionLifecycle({mutate:c=>{wasm.b_learn(c.item,c.state);for(let i=0;i<64;i++)inventory[i]=wasm.b_bank_get(i);state.sourceCalls.learn++;},refresh:()=>{state.sourceCalls.refresh++;return capabilities();},canUse:(skills,c)=>available(c.type,skills),consume:c=>resolve(c)});
    loadStage(0);const frame=wasm.b_presentation_tick()>>>0;state.player.presentation={image_index:frame&255,hflip:(frame>>>8)&1,delay:(frame>>>16)&255,clip:frame>>>24};return observe();
  }
  function step(raw={}) {
    if(disposed)return observe();state.tick++;const frame=wasm.b_presentation_tick()>>>0;state.player.presentation={image_index:frame&255,hflip:(frame>>>8)&1,delay:(frame>>>16)&255,clip:frame>>>24};if(state.tick>state.animationUntil)wasm.b_presentation_start(1);
    if(typeof raw==='string') {const kind=raw;raw={[kind]:true};input.sample({});}
    const sample=input.sample(raw,{disabled:false});
    if(sample.actions.restart)return reset();
    if(state.status!=='playing')return observe();
    if(sample.actions.left||sample.actions.right){const living=state.enemies.map((e,i)=>e.hp>0?i:-1).filter(i=>i>=0);const at=living.indexOf(state.selectedTarget);state.selectedTarget=living[(at+(sample.actions.left?-1:1)+living.length)%living.length];}
    const kind=['strike','guard','ember','gale'].find(k=>sample.actions[k]);
    if(kind){const commandId=typeof raw.commandId==='string'?raw.commandId:`turn:${++serial}`;const result=progression.use({type:kind,commandId});if(!result.accepted)say(result.reason==='duplicate-command'?'Repeated confirmation ignored.':'Ability unavailable: earn it at a gate and keep 2 focus.');state.events.push(...progression.drainEvents());}
    return observe();
  }
  function observe() {
    if(!state)return null;
    const skills=capabilities();
    const queue=queuedOrder(),swap=queue.indexOf(state.selectedTarget+1),hero=queue.indexOf(0),predicted=[...queue];if(swap>=0&&hero>=0)[predicted[swap],predicted[hero]]=[predicted[hero],predicted[swap]];
    return structuredClone({...state,queue:queue.map(laneName),galePreview:predicted.map(laneName),phase:state.status,objective:`Restore five gates · Gate ${state.encounter}/5`,currentObjective:['Defeat the sentinel to earn Ember.','Practice Ember against all three wards.','Read the storm: guard crash, strike windup; earn Gale.','Gale the early striker to cancel its lethal queued attack.','Combine Ember, selected Gale swaps and Guard to restore the Crown.'][state.encounter-1],controls:'1 Strike · 2 Guard · 3 Ember · 4 Gale · ←/→ target · R restart',enemies:state.enemies.map(e=>({...e,intent:intent(e).label,intentDamage:intent(e).damage})),abilities:[{id:'ember',name:'Ember',unlocked:!!(skills&1)},{id:'gale',name:'Gale',unlocked:!!(skills&2)}],availableActions:[{id:'strike',label:'1 · Strike (5)',enabled:state.status==='playing'},{id:'guard',label:'2 · Guard (+2 focus)',enabled:state.status==='playing'},{id:'ember',label:'3 · Ember (4 to all / 2 focus)',enabled:state.status==='playing'&&available('ember',skills)},{id:'gale',label:'4 · Gale (swap target / 7 / 2 focus)',enabled:state.status==='playing'&&available('gale',skills)}],progression:{inventory:Array.from(inventory),skills,freshness:'canonical refresh before each admitted command'},provenance:{rules:'Authored five-gate tactical microcampaign',source:'Unchanged generated C compiled to WebAssembly: Minish packed acquisition/skill refresh, Emerald paired order, bounded FFVI HP/KO specialization',execution:'wasm-required; no JavaScript source fallback',presentation:'Authored arena with separately identified source asset closure'},schedule:['input-edge','canonical-refresh','unique-confirmation','paired-order','live-HP-and-KO','death-settlement','reward-acquisition','outcome']});
  }
  reset();return {reset,step,observe,dispose(){disposed=true;input.reset();}};
}
export default createCandidate;
