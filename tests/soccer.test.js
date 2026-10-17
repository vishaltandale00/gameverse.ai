import test from 'node:test';
import assert from 'node:assert/strict';
import { soccerDefinition as game } from '../src/soccer.js';
import { SportsInput } from '../src/sports-input.js';
import { mergePendingInput } from '../src/sports-feedback.js';
const dt = 1 / 60;
function live() { const s=game.createState(); game.step(s,dt,{pressed:{confirm:true}}); return s; }
function frames(s,n,input={}) { for(let i=0;i<n;i++)game.step(s,dt,input); }
function loose(s,x,z,vx=0,vz=0,lastTouch=0,y=0.4) {
  Object.assign(s.ball,{x,z,vx,vz,y,vy:0,owner:-1,lastTouch,kicker:-1,lock:0});
}

test('soccer creates a controller-ready 5v5 match with a ten minute clock behind the team select',()=>{
  const s=game.createState(); assert.equal(game.validateState(s),true); assert.equal(s.players.length,10);
  assert.equal(s.players.filter(p=>p.keeper).length,2); assert.equal(s.clock,600); assert.equal(s.version,4);
  frames(s,120); assert.equal(s.clock,600); assert.equal(s.phase,'setup');
  game.step(s,dt,{pressed:{pass:true}}); assert.equal(s.phase,'play'); assert.equal(s.teams[0].short,'ALDER'); assert.equal(s.teams[1].short,'EMBER');
});

test('assisted shot chooses the LS goal side, charges with held input, and launches on release',()=>{
  const s=live(); const p=s.players[s.active]; p.x=0;p.z=0; s.teams[0].players[3].ratings.sho=99;
  frames(s,30,{held:{shoot:true},aim:{x:0,y:-1}});
  assert.equal(s.ball.owner,s.active); assert.ok(s.charge>0.5);
  game.step(s,dt,{released:{shoot:true},aim:{x:0,y:-1}});
  assert.equal(s.ball.owner,-1); assert.ok(s.ball.vx > 25); assert.ok(s.ball.vz < 0); const crossing=s.ball.z+s.ball.vz/s.ball.vx*(28-s.ball.x); assert.ok(crossing < -2 && crossing > -4.3, `crossing ${crossing}`);
  assert.equal(s.stats.shots[0],1); assert.equal(s.charge,0);
});

test('crossing a goal scores once and restarts for the conceding team',()=>{
  const s=live(); loose(s,27.9,2,24,0,0,1);
  game.step(s,dt); assert.equal(s.phase,'goal'); assert.deepEqual(s.score,[1,0]);
  frames(s,157); assert.equal(s.phase,'restart'); assert.equal(s.restart.type,'Kickoff'); assert.equal(s.restart.team,1);
  assert.deepEqual(s.score,[1,0]);
});

test('touchlines, attacking misses, and defending touches select correct restarts',()=>{
  const cases=[
    {x:3,z:17.2,last:0,type:'Throw-in',team:1},
    {x:28.2,z:10,last:0,type:'Goal kick',team:1},
    {x:28.2,z:10,last:1,type:'Corner',team:0},
    {x:-28.2,z:-10,last:0,type:'Corner',team:1},
    {x:-28.2,z:2,last:1,type:'Goal kick',team:0,y:4},
  ];
  for(const c of cases){const s=live();loose(s,c.x,c.z,0,0,c.last,c.y||0.4);game.step(s,dt);
    assert.equal(s.phase,'restart');assert.equal(s.restart.type,c.type);assert.equal(s.restart.team,c.team);game.validateState(s);}
});

test('home restarts resume safely and clocks include stoppages',()=>{
  const s=live();loose(s,0,17.2,0,0,1);game.step(s,dt);const before=s.clock;
  frames(s,31); game.step(s,dt,{pressed:{pass:true}});
  assert.equal(s.phase,'play');assert.equal(s.players[s.ball.owner].team,0);assert.ok(s.clock<before-0.5);
});

test('AI moves off ball, opponents pursue, and loose home receipt changes selection',()=>{
  const s=live(), initial=s.players.map(p=>({x:p.x,z:p.z}));frames(s,90);
  assert.ok(s.players.slice(5).some((p,i)=>Math.hypot(p.x-initial[i+5].x,p.z-initial[i+5].z)>2));
  const target=s.players[2]; loose(s,target.x,target.z);game.step(s,dt);
  assert.equal(s.ball.owner,2);assert.equal(s.active,2);
});

test('defensive switching and tackling transfer possession with cooldown',()=>{
  const s=live();s.active=3;const p=s.players[3],q=s.players[8];p.x=0;p.z=0;q.x=1;q.z=0;s.ball.owner=8;s.ball.x=1.7;s.ball.z=0;s.possessionAge=1;
  game.step(s,dt,{pressed:{tackle:true}});assert.equal(s.ball.owner,8);frames(s,6);assert.equal(s.ball.owner,3);assert.equal(s.stats.tackles[0],1);
  s.ball.owner=8;game.step(s,dt,{pressed:{switch:true}});assert.notEqual(s.active,3);
});

test('save and restore continue deterministically including an in-flight shot',()=>{
  const a=live();frames(a,20,{held:{shoot:true},aim:{x:1,y:0.15}});game.step(a,dt,{released:{shoot:true}});
  const b=JSON.parse(JSON.stringify(a));game.validateState(b);
  const inputs=Array.from({length:150},(_,i)=>({move:{x:Math.sin(i*0.1),y:Math.cos(i*0.1)},pressed:{switch:i%47===0},held:{sprint:i%60<20}}));
  for(const input of inputs){game.step(a,dt,input);game.step(b,dt,input);}assert.deepEqual(a,b);
});

test('full time produces a result, rematch keeps the teams, and B returns to team select',()=>{
  const s=live();s.clock=dt/2;s.score=[3,1];game.step(s,dt);assert.equal(s.phase,'finished');assert.equal(game.hud(s).finished,true);
  assert.match(s.message,/ALDER WINS/);assert.ok(game.hud(s).summary.rows.some(r=>r[0]==='GOALS'&&r[1]===3&&r[2]===1));assert.equal(typeof game.hud(s).summary.star.name,'string');
  const frame=s.frame;game.step(s,dt);assert.deepEqual(s.score,[3,1]);assert.ok(s.frame>frame);
  game.step(s,dt,{pressed:{confirm:true}});assert.equal(s.phase,'play');assert.deepEqual(s.score,[0,0]);assert.equal(s.clock,600);assert.equal(s.teams[1].short,'EMBER');assert.equal(game.validateState(s),true);
  s.clock=dt/2;game.step(s,dt);assert.equal(s.phase,'finished');game.step(s,dt,{pressed:{back:true}});assert.equal(s.phase,'setup');assert.ok(game.hud(s).setup.rows.length>=4);
});

test('invalid serialized match data is rejected',()=>{
  for(const mutate of [s=>s.ball.x=NaN,s=>s.players[2].team=1,s=>s.clock=-1,s=>s.active=9,s=>s.stats.shots=null]){
    const s=game.createState();mutate(s);assert.throws(()=>game.validateState(s));
  }
});

test('serialized restart and goal states reject absent continuation data',()=>{
  const restart=live();loose(restart,0,17.2);game.step(restart,dt);delete restart.restart.taker;
  assert.throws(()=>game.validateState(restart));
  const goal=live();loose(goal,28.1,0,10,0);game.step(goal,dt);goal.restart=null;
  assert.throws(()=>game.validateState(goal));
});

test('stadium and animation construct without DOM or renderer dependencies',async()=>{
  const THREE=await import('three'),scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(46,16/9,0.1,220);
  const state=live(),view=game.buildScene({THREE,scene,camera});
  game.render({state,view,camera,dt});assert.equal(view.athletes.length,10);assert.ok(scene.children.length>100);
  assert.ok(camera.position.toArray().every(Number.isFinite));
  for(const obj of scene.children){if(obj.geometry)obj.geometry.dispose();}
});

test('an assisted LS corner shot usually beats the keeper after a controlled dribble; saves are graded, not a wall',()=>{
  let goals=0,saves=0;
  for(let seed=1;seed<=12;seed++){
    const s=game.createState({setup:false,seed}),p=s.players[s.active];p.x=12;p.z=0;s.teams[0].players[3].ratings.sho=99;
    // Isolate a breakaway; opposition positioning must not decide this shot test.
    s.players.filter(q=>q.team===1&&!q.keeper).forEach(q=>{q.x=-15;q.z=10;});
    frames(s,40,{move:{x:1,y:0},held:{sprint:true}});
    assert.ok(p.x>14.9);assert.equal(s.ball.owner,p.id);assert.ok(p.stamina<1);
    const aim={x:0.7,y:0.7};
    frames(s,20,{held:{shoot:true},aim});game.step(s,dt,{released:{shoot:true},aim});assert.equal(s.stats.shots[0],1);
    frames(s,70);if(s.score[0]===1)goals++;else if(s.stats.saves[1]===1)saves++;
  }
  assert.ok(goals>=6,`corner shots score most of the time (${goals}/12)`);assert.ok(goals+saves>=11,'a 99-rated shooter keeps the ball on target');
});

test('an assisted directional pass leads a moving teammate and changes control',()=>{
  const s=live();s.players.filter(q=>q.team===1&&!q.keeper).forEach(q=>{q.x=22;q.z=-12;});
  const aim={x:0.35,y:1};frames(s,18,{held:{pass:true},aim});game.step(s,dt,{released:{pass:true},aim});
  for(let i=0;i<110&&s.ball.owner<0;i++)game.step(s,dt);
  assert.equal(s.ball.owner,4);assert.equal(s.active,4);assert.equal(s.stats.passes[0],1);
});

test('a keeper collects a central shot and relinquishes possession without user intervention',()=>{
  const s=live();loose(s,-23.5,0,-23,0,1,0.6);s.ball.shot=true;
  for(let i=0;i<20&&s.ball.owner<0;i++)game.step(s,dt);
  assert.equal(s.ball.owner,0);assert.equal(s.stats.saves[0],1);assert.notEqual(s.active,0);
  frames(s,40);assert.notEqual(s.ball.owner,0);assert.equal(s.stats.passes[0],1);
});

test('pausing cancels a charged action without firing it on resume',()=>{
  const s=live();frames(s,15,{held:{shoot:true},aim:{x:1,y:0}});assert.ok(s.charge>0);
  const before={clock:s.clock,score:[...s.score],ball:{...s.ball},frame:s.frame};game.cancelInput(s);
  assert.equal(s.charge,0);assert.equal(s.charging,null);
  assert.deepEqual({clock:s.clock,score:s.score,ball:s.ball,frame:s.frame},before);
  game.step(s,dt);assert.equal(s.stats.shots[0],0);assert.equal(s.ball.owner,s.active);
});

test('analog movement accelerates, carries momentum through turns, and brakes',()=>{
  const s=live(),p=s.players[s.active];
  game.step(s,dt,{move:{x:1,y:0}});const first=p.vx;assert.ok(first>0&&first<1);
  frames(s,22,{move:{x:1,y:0}});assert.ok(p.vx>5);const beforeTurn=p.vx;
  game.step(s,dt,{move:{x:-1,y:0}});assert.ok(p.vx>0&&p.vx<beforeTurn);
  const movingX=p.x;game.step(s,dt);assert.ok(p.x>movingX);assert.ok(p.vx>0);
  frames(s,30);assert.ok(Math.abs(p.vx)<0.01);
});

test('sprint dribbling pushes the ball farther ahead than shielded close control',()=>{
  const run=live(),close=live();
  for(const s of [run,close])s.players.filter(p=>p.team===1).forEach(p=>{p.x=24;p.z=14;});
  frames(run,45,{move:{x:1,y:0},held:{sprint:true}});
  frames(close,45,{move:{x:1,y:0},held:{shield:true}});
  assert.equal(run.ball.owner,3);assert.equal(close.ball.owner,3);
  assert.ok(run.ball.x-run.players[3].x>close.ball.x-close.players[3].x+0.2);
  assert.ok(run.players[3].vx>close.players[3].vx*1.5);
});

test('a directional ball roll moves the ball laterally and cannot be spammed',()=>{
  const s=live();frames(s,15);const before={x:s.ball.x,z:s.ball.z};
  game.step(s,dt,{pressed:{skill:true},held:{skill:true},aim:{x:0,y:1}});
  const p=s.players[s.active];assert.ok(p.skillCooldown>0.45,'Trickster recovers faster but still has a cooldown');frames(s,10);
  assert.ok(Math.abs(s.ball.z-before.z)>0.5);const cooldown=p.skillCooldown;
  game.step(s,dt,{pressed:{skill:true},held:{skill:true}});assert.ok(p.skillCooldown<cooldown);
});

test('finesse has a real curved trajectory and lower initial pace than a power shot',()=>{
  const straight=live(),curl=live();
  for(const s of [straight,curl]){
    s.players.filter(p=>p.team===1).forEach(p=>{p.x=-20;p.z=15;});
    frames(s,24,{held:{shoot:true},aim:{x:1,y:0}});
  }
  game.step(straight,dt,{released:{shoot:true},aim:{x:1,y:0}});
  game.step(curl,dt,{held:{finesse:true},released:{shoot:true},aim:{x:1,y:0}});
  assert.ok(Math.hypot(curl.ball.vx,curl.ball.vz)<Math.hypot(straight.ball.vx,straight.ball.vz));
  assert.ok(curl.ball.spin>0);const angle=Math.atan2(curl.ball.vz,curl.ball.vx);frames(straight,20);frames(curl,20);
  assert.ok(Math.atan2(curl.ball.vz,curl.ball.vx)>angle+0.08);
});

test('swept post collisions rebound fast shots instead of tunneling through the goal frame',()=>{
  const s=live();s.players[5].z=-3;loose(s,27.3,4.3,90,0,0,0.5);
  const before=s.ball.vx*s.ball.vx+s.ball.vy*s.ball.vy+s.ball.vz*s.ball.vz;
  game.step(s,dt);assert.equal(s.score[0],0);assert.equal(s.phase,'play');assert.ok(s.ball.vx<0);
  assert.ok(s.ball.vx*s.ball.vx+s.ball.vy*s.ball.vy+s.ball.vz*s.ball.vz<=before);
  assert.match(s.message,/POST/);
});

test('swept goalkeeper collision stops a fast shot that crosses the body in one step',()=>{
  const s=live();loose(s,-22.5,0,-220,0,1,0.6);s.ball.shot=true;game.step(s,dt);
  assert.ok(s.ball.owner===0||s.ball.vx>0,'caught or parried back into play');assert.equal(s.score[1],0);assert.equal(s.stats.saves[0],1);assert.equal(s.stats.onTarget[1],1);
});

test('shielding protects the ball from a tackle through the body, but an open tackle wins',()=>{
  const setup=()=>{const s=live(),p=s.players[3];p.x=0;p.z=0;p.fx=1;p.fz=0;
    Object.assign(s.ball,{x:0.6,z:0});s.possessionAge=1;
    s.players.filter(q=>q.id!==3).forEach(q=>{q.x=q.team===1?18:-18;q.z=10;});
    Object.assign(s.players[8],{x:-.3,z:1.1,fx:1,fz:0,think:2});return s;};
  const shielded=setup(),open=setup();game.step(shielded,dt,{held:{shield:true}});game.step(open,dt);frames(shielded,14,{held:{shield:true}});frames(open,14);
  assert.equal(shielded.ball.owner,3);assert.equal(open.ball.owner,8);assert.match(shielded.message,/SHIELDED/);
});

test('a missed tackle has a recovery cost before another tackle can fire',()=>{
  const s=live();loose(s,20,12);game.step(s,dt,{pressed:{tackle:true},move:{x:1,y:0}});
  const p=s.players[s.active];assert.ok(p.cooldown>0.8);frames(s,26,{move:{x:1,y:0}});
  assert.ok(p.cooldown>0.35);assert.ok(p.vx<4);const before=p.cooldown;
  game.step(s,dt,{pressed:{tackle:true},move:{x:1,y:0}});assert.ok(p.cooldown<before);
});

test('the right stick chooses either lateral ball-roll direction',()=>{
  const up=live(),down=live();for(const s of [up,down])frames(s,10);
  game.step(up,dt,{pressed:{skill:true},aim:{x:0,y:-1}});
  game.step(down,dt,{pressed:{skill:true},aim:{x:0,y:1}});
  frames(up,10);frames(down,10);
  assert.ok(up.ball.z<-6.5);assert.ok(down.ball.z>-5.5);
});

test('crossbar contact rebounds instead of scoring through the frame',()=>{
  const s=live();s.players[5].z=-3;loose(s,27.3,0,90,0,0,3);
  game.step(s,dt);assert.deepEqual(s.score,[0,0]);assert.ok(s.ball.vx<0);assert.match(s.message,/CROSSBAR/);
});

test('serialized curl and skill recovery resume exactly',()=>{
  const original=live();frames(original,20,{held:{shoot:true},aim:{x:1,y:0}});
  game.step(original,dt,{released:{shoot:true},held:{finesse:true},aim:{x:1,y:0}});
  const resumed=JSON.parse(JSON.stringify(original));game.validateState(resumed);
  for(let i=0;i<90;i++){
    const input={move:{x:0.5,y:-0.2},held:{shield:i>60},pressed:{skill:i===45}};
    game.step(original,dt,input);game.step(resumed,dt,input);
  }
  assert.deepEqual(original,resumed);
});

test('holding kickoff A cannot leak into a pass; a fresh press can charge and release',()=>{
  const s=game.createState();game.step(s,dt,{pressed:{pass:true},held:{pass:true}});
  assert.equal(s.passReady,false);frames(s,6,{held:{pass:true},move:{x:1,y:0}});
  assert.ok(s.players[3].x>-5);assert.equal(s.charging,null);assert.equal(s.charge,0);
  game.step(s,dt,{released:{pass:true}});assert.equal(s.ball.owner,3);assert.equal(s.stats.passes[0],0);assert.equal(s.passReady,true);
  frames(s,6,{held:{pass:true},aim:{x:0,y:1}});assert.ok(s.charge>0);
  game.step(s,dt,{released:{pass:true}});assert.equal(s.stats.passes[0],1);assert.equal(s.ball.owner,-1);
});

test('holding home-restart A is consumed by the restart and survives serialization',()=>{
  const s=live();loose(s,0,17.2,0,0,1);game.step(s,dt);frames(s,30);
  game.step(s,dt,{pressed:{pass:true},held:{pass:true}});assert.equal(s.phase,'play');assert.equal(s.passReady,false);
  const saved=JSON.parse(JSON.stringify(s));game.validateState(saved);
  frames(saved,6,{held:{pass:true}});game.step(saved,dt,{released:{pass:true}});
  assert.equal(saved.stats.passes[0],0);assert.equal(saved.ball.owner,saved.active);assert.equal(saved.passReady,true);
});

function space() {
  const s=live();s.players.filter(p=>p.id!==3&&!p.keeper).forEach((p,i)=>{p.x=20;p.z=10+i*.5;});return s;
}

test('a knock-on creates a recoverable chase in space and exposes the ball to a defender',()=>{
  const clear=space(),blocked=space();Object.assign(blocked.players[8],{x:-2.8,z:-6});
  let intercepted=false;
  for(const s of [clear,blocked]){game.step(s,dt,{gesture:{x:1,y:0},held:{skill:true}});assert.equal(s.ball.owner,-1);assert.equal(s.players[3].skillType,'knockon');for(let i=0;i<90;i++){game.step(s,dt,{move:{x:1,y:0},held:{sprint:true}});if(s===blocked&&s.ball.owner>=5)intercepted=true;}}
  assert.equal(clear.ball.owner,3);assert.equal(intercepted,true);
});

test('a reverse flick chains a double touch but repeated same-direction flicks do not reset recovery',()=>{
  const s=space();game.step(s,dt,{gesture:{x:0,y:1},held:{skill:true}});frames(s,8);
  const remaining=s.players[3].skillCooldown;game.step(s,dt,{gesture:{x:0,y:1},held:{skill:true}});assert.ok(s.players[3].skillCooldown<remaining);
  game.step(s,dt,{gesture:{x:0,y:-1},held:{skill:true}});assert.equal(s.players[3].skillType,'double');assert.ok(s.players[3].burst>.5);
  assert.equal(s.feedback.kind,'skill');assert.equal(s.ball.owner,3);
});

test('dragback pulls the ball behind the body; exhausted players cannot begin a skill',()=>{
  const s=space();frames(s,10);const before=s.ball.x;game.step(s,dt,{gesture:{x:-1,y:0},held:{skill:true}});frames(s,16);
  assert.equal(s.players[3].skillType,'dragback');assert.ok(s.ball.x<before-.7);
  const tired=space();tired.players[3].stamina=.01;game.step(tired,dt,{gesture:{x:0,y:1}});assert.equal(tired.players[3].skillType,'none');assert.equal(tired.feedback.kind,'denied');
});

test('shot fake cancels the strike and requires releasing both actions before a fresh charge',()=>{
  const s=space();frames(s,15,{held:{shoot:true},aim:{x:1,y:0}});assert.ok(s.charge>0);
  game.step(s,dt,{held:{shoot:true,pass:true},pressed:{pass:true}});frames(s,5,{held:{shoot:true,pass:true}});
  assert.equal(s.charging,null);assert.equal(s.stats.shots[0],0);assert.equal(s.stats.passes[0],0);assert.ok(s.players[3].burst>0);
  game.step(s,dt,{released:{pass:true,shoot:true}});game.step(s,dt,{pressed:{shoot:true},released:{shoot:true}});assert.equal(s.stats.shots[0],1);
});

test('quick controller taps within one simulation tick still produce a minimum-power pass or shot',()=>{
  for(const kind of ['pass','shoot']){const s=space();game.step(s,dt,{pressed:{[kind]:true},released:{[kind]:true},aim:{x:1,y:0}});
    assert.equal(s.ball.owner,-1);assert.equal(s.stats[kind==='pass'?'passes':'shots'][0],1);assert.ok(Math.hypot(s.ball.vx,s.ball.vz)>9);}
});

test('dedicated through and lob buttons produce distinct physical trajectories',()=>{
  const normal=space(),through=space(),loft=space();
  for(const [s,kind]of[[normal,'pass'],[through,'through'],[loft,'lob']]){frames(s,18,{held:{[kind]:true},aim:{x:1,y:0}});game.step(s,dt,{released:{[kind]:true},aim:{x:1,y:0}});}
  assert.ok(through.ball.vx>normal.ball.vx*1.15);assert.ok(loft.ball.vy>normal.ball.vy+3);
  assert.equal(through.players[3].skillType,'none');assert.equal(through.feedback.kind,'pass');
});

test('jockey keeps the defender facing the ball while retreating and reads a wider passing lane',()=>{
  const s=space();loose(s,8,-4);frames(s,12,{held:{shield:true},move:{x:-1,y:0}});
  const p=s.players[3];assert.ok(p.vx<0);assert.ok(p.fx>0);assert.equal(p.jockey,true);
  const normal=space(),jockey=space();for(const q of[normal,jockey])loose(q,-6,-5.05,24,0,1,.4);
  frames(normal,2);frames(jockey,2,{held:{shield:true}});assert.equal(normal.ball.owner,-1);assert.equal(jockey.ball.owner,3);
});

test('a requested teammate run progresses beyond the carrier and continues during the pass',()=>{
  const s=live();game.step(s,dt,{pressed:{runRequest:true}});const runner=s.players.find(p=>p.runTime>0);assert.ok(runner);
  const before=runner.x;frames(s,35);assert.ok(runner.x>before+1);
  frames(s,10,{held:{pass:true,skill:true},aim:{x:1,y:0}});game.step(s,dt,{released:{pass:true},held:{skill:true},aim:{x:1,y:0}});
  assert.ok(runner.runTime>0);assert.equal(s.stats.passes[0],1);
});

test('AI carrying into an open attack shoots rather than circulating indefinitely',()=>{
  const s=space(),p=s.players[8];Object.assign(p,{x:1,z:0,fx:-1,fz:0,think:0});Object.assign(s.ball,{owner:8,x:.3,z:0});
  frames(s,15);assert.equal(s.stats.passes[1],0);assert.ok(p.x<1);
  frames(s,225);assert.ok(s.stats.shots[1]>=1,'carries into the box and shoots within four seconds');
});

test('older match versions are rejected instead of guessed at',()=>{
  for(const version of [2,3,5]){const s=live();s.version=version;assert.throws(()=>game.validateState(s));}
});

test('restart clearance near the goal line never stacks clamped athletes',()=>{
  const s=live();Object.assign(s.players[4],{x:23.8866,z:3.0191});Object.assign(s.players[6],{x:26.0687,z:2.7371});
  loose(s,28.2,12,0,0,0);game.step(s,dt);assert.equal(s.restart.type,'Goal kick');
  for(let a=0;a<10;a++)for(let b=a+1;b<10;b++)assert.ok(Math.hypot(s.players[a].x-s.players[b].x,s.players[a].z-s.players[b].z)>=1.09);
});

test('fine post-deadzone aim is accepted and sprint exhaustion does not oscillate',()=>{
  const s=space();game.step(s,dt,{aim:{x:0,y:-.04}});assert.equal(s.players[3].fz,-1);
  const p=s.players[3];p.stamina=.003;frames(s,45,{held:{sprint:true},move:{x:1,y:0}});
  assert.equal(p.stamina,0);const speed=p.vx;frames(s,8,{held:{sprint:true},move:{x:1,y:0}});assert.ok(Math.abs(p.vx-speed)<.01);assert.ok(p.vx<=6.45,'exhausted sprint falls back to the athlete\'s Pace-rated run speed');
});

test('an early restart press is buffered through the grace period without becoming a pass',()=>{
  const s=live();loose(s,0,17.2,0,0,1);game.step(s,dt);
  game.step(s,dt,{pressed:{pass:true},held:{pass:true}});assert.equal(s.restart.confirmQueued,true);
  frames(s,22,{held:{pass:true}});assert.equal(s.phase,'restart');
  const restored=JSON.parse(JSON.stringify(s));game.validateState(restored);
  frames(restored,6,{held:{pass:true}});assert.equal(restored.phase,'play');assert.equal(restored.passReady,false);
  frames(restored,4,{held:{pass:true}});game.step(restored,dt,{released:{pass:true}});
  assert.equal(restored.stats.passes[0],0);assert.equal(restored.ball.owner,restored.active);
});

test('a button held from the preceding play cannot queue a restart',()=>{
  const s=live();loose(s,0,17.2,0,0,1);game.step(s,dt,{held:{pass:true,confirm:true}});
  frames(s,36,{held:{pass:true,confirm:true}});assert.equal(s.phase,'restart');assert.equal(s.restart.confirmQueued,false);
  game.step(s,dt,{released:{pass:true,confirm:true}});
  game.step(s,dt,{pressed:{pass:true,confirm:true},held:{pass:true,confirm:true}});assert.equal(s.phase,'play');assert.equal(s.stats.passes[0],0);
});

function passingLane(target={x:8,z:7}) {
  const s=live(),p=s.players[3];Object.assign(p,{x:0,z:0,fx:1,fz:0});Object.assign(s.ball,{x:.7,z:0});
  s.players.filter(q=>q.id!==3).forEach(q=>Object.assign(q,{x:q.team===1?24:-23,z:q.id%2?14:-14,vx:0,vz:0}));
  Object.assign(s.players[4],target);return s;
}

test('LS assisted passes actually reach receivers across forward, lateral, and backward angles',()=>{
  for(const target of [{x:8,z:7},{x:0,z:9},{x:-8,z:6}]){
    const s=passingLane(target),n=Math.hypot(target.x,target.z);
    // Deliberately imperfect LS direction: assistance must lead the receiver.
    const move={x:target.x/n+.12,y:target.z/n-.08};
    game.step(s,dt,{move,aim:{...move},pressed:{pass:true},released:{pass:true}});
    assert.equal(s.ball.owner,-1);
    for(let i=0;i<150&&s.ball.owner<0;i++)game.step(s,dt);
    assert.equal(s.ball.owner,4,`receiver at ${JSON.stringify(target)} should collect the actual flight`);assert.equal(s.active,4);
  }
});

test('neutral LS preserves facing for a pass instead of forcing rightward aim',()=>{
  const s=passingLane({x:0,z:8});Object.assign(s.players[3],{fx:0,fz:1});
  game.step(s,dt,{move:{x:0,y:0},aim:{x:0,y:0},pressed:{pass:true},released:{pass:true}});
  assert.ok(Math.abs(s.ball.vx)<1.2,'Passing noise only, no rightward aim');assert.ok(s.ball.vz>9);
  for(let i=0;i<120&&s.ball.owner<0;i++)game.step(s,dt);
  assert.equal(s.ball.owner,4);
});

test('through pass targets space ahead of the receiver and lob uses an aerial trajectory',()=>{
  const through=passingLane({x:8,z:6}),lob=passingLane({x:8,z:6});
  for(const [s,kind] of [[through,'through'],[lob,'lob']])game.step(s,dt,{move:{x:.8,y:.6},pressed:{[kind]:true},released:{[kind]:true}});
  const receiver=through.players[4];
  const crossingX=through.ball.x+through.ball.vx/through.ball.vz*(receiver.z-through.ball.z);
  assert.ok(crossingX>receiver.x+1.5,'through ball leads the runner instead of aiming at their feet');
  assert.ok(lob.ball.vy>4.8);assert.ok(through.ball.vy<.4);
  frames(lob,18);assert.ok(lob.ball.y>1.2,'lob must retain actual airborne travel');
});

test('LB requests an attacking run without switching away; RS chooses a defender directionally',()=>{
  const s=passingLane();game.step(s,dt,{pressed:{switch:true,runRequest:true},held:{switch:true}});
  assert.equal(s.active,3);assert.ok(s.players.some(p=>p.id!==3&&p.runTime>3));
  Object.assign(s.players[1],{x:0,z:-8});Object.assign(s.players[2],{x:-8,z:0});Object.assign(s.players[4],{x:0,z:8});
  s.ball.owner=8;game.step(s,dt,{gesture:{x:0,y:1},pressed:{skill:true}});
  assert.equal(s.active,4);assert.equal(s.players[4].skillType,'none');
});

test('a defensive B tackle cannot queue an accidental shot after winning possession',()=>{
  const s=live(),p=s.players[3],q=s.players[8];Object.assign(p,{x:0,z:0});Object.assign(q,{x:1,z:0});Object.assign(s.ball,{owner:8,x:1.7,z:0});s.possessionAge=1;
  game.step(s,dt,{pressed:{shoot:true,tackle:true},held:{shoot:true,tackle:true}});
  frames(s,8,{held:{shoot:true,tackle:true}});assert.equal(s.ball.owner,3);assert.equal(s.pending,null);assert.equal(s.charging,null);
  game.step(s,dt,{released:{shoot:true,tackle:true}});assert.equal(s.stats.shots[0],0);
  game.step(s,dt,{pressed:{shoot:true},released:{shoot:true}});assert.equal(s.stats.shots[0],1);
});

test('voice-consumed B cancels a charge without an implicit release shot',()=>{
  const s=space();frames(s,14,{held:{shoot:true}});assert.ok(s.charge>0);
  game.step(s,dt,{cancelled:{shoot:true}});frames(s,4);
  assert.equal(s.stats.shots[0],0);assert.equal(s.charging,null);assert.equal(s.charge,0);
});

test('goal assistance preserves overpowered misses instead of guaranteeing an on-target shot',()=>{
  const s=passingLane();s.players[3].x=10;s.players[3].z=0;s.frame=3;s.charging='shoot';s.charge=1;
  game.step(s,dt,{move:{x:.5,y:1},released:{shoot:true}});
  const crossing=s.ball.z+s.ball.vz/s.ball.vx*(28-s.ball.x);
  assert.ok(Math.abs(crossing)>4.3,'overpowering can send an assisted shot outside the posts');assert.ok(s.ball.vy>5);
});

function controllerInput() {
  const adapter=new SportsInput('soccer'),keys=new Set();
  const pad={id:'Xbox soccer',index:0,connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};
  adapter.sample(keys,[pad]);
  return {pad,sample:()=>adapter.sample(keys,[pad]),button:(i,down)=>pad.buttons[i]={pressed:down,value:Number(down)},tick:(s,blockB=false)=>game.step(s,dt,adapter.sample(keys,[pad],blockB))};
}

test('real SportsInput A delivers a left-stick assisted pass to a moving receiver',()=>{
  const s=passingLane(),input=controllerInput();input.pad.axes=[.8,.6,0,0];input.button(0,true);
  for(let i=0;i<10;i++)input.tick(s);input.button(0,false);input.tick(s);input.pad.axes=[0,0,0,0];
  assert.equal(s.stats.passes[0],1);
  for(let i=0;i<150&&s.ball.owner<0;i++)input.tick(s);
  assert.equal(s.ball.owner,4);assert.equal(s.active,4);
});

test('real B shoots using LS while RS stays a skill stick; RB changes finesse without rolling',()=>{
  const normal=space(),curl=space();
  for(const [s,finesse] of [[normal,false],[curl,true]]){
    const input=controllerInput();input.pad.axes=[1,.4,-1,0];input.button(1,true);input.button(5,finesse);
    for(let i=0;i<14;i++)input.tick(s);assert.equal(s.players[3].skillType,'none');
    input.button(1,false);input.tick(s);assert.equal(s.stats.shots[0],1);assert.ok(s.ball.vx>15,'RS pointing left must not send the shot backwards');
  }
  assert.equal(normal.ball.spin,0);assert.notEqual(curl.ball.spin,0);
  assert.ok(Math.hypot(curl.ball.vx,curl.ball.vz)<Math.hypot(normal.ball.vx,normal.ball.vz));
});

test('real Y and X release dedicated through and lofted passes; triggers never shoot',()=>{
  for(const [button,delivery] of [[3,'through'],[2,'loft']]){
    const s=passingLane(),input=controllerInput();input.pad.axes=[.8,.6,0,0];input.button(button,true);
    for(let i=0;i<8;i++)input.tick(s);input.button(button,false);input.tick(s);
    assert.equal(s.stats.passes[0],1);assert.equal(s.stats.shots[0],0);assert.equal(s.delivery,delivery);
    if(button===2)assert.ok(s.ball.vy>5);else assert.ok(s.ball.vy<.4);
  }
  const s=space(),input=controllerInput();input.button(6,true);input.button(7,true);input.pad.axes=[1,0,0,0];
  for(let i=0;i<20;i++)input.tick(s);input.button(6,false);input.button(7,false);input.tick(s);
  assert.equal(s.stats.shots[0],0);assert.equal(s.charging,null);assert.equal(s.ball.owner,3);
});

test('real standalone RS performs a skill and real B then A performs a shot fake',()=>{
  const s=space(),input=controllerInput();input.pad.axes=[0,0,0,1];input.tick(s);
  assert.equal(s.players[3].skillType,'roll');assert.equal(s.stats.shots[0],0);
  input.pad.axes=[0,0,0,0];input.button(1,true);for(let i=0;i<10;i++)input.tick(s);
  input.button(1,false);input.button(0,true);input.tick(s);
  assert.equal(s.players[3].skillType,'fake');assert.equal(s.charging,null);assert.equal(s.stats.passes[0],0);assert.equal(s.stats.shots[0],0);
  input.button(0,false);input.tick(s);assert.equal(s.stats.passes[0],0);
});

test('a same-tick A tap cancels a released charged B into a fake without passing',()=>{
  const s=space();frames(s,10,{held:{shoot:true}});
  game.step(s,dt,{pressed:{pass:true},released:{pass:true,shoot:true}});
  assert.equal(s.players[3].skillType,'fake');assert.equal(s.stats.passes[0],0);assert.equal(s.stats.shots[0],0);
});

test('real voice cancellation swallows charged B through its eventual release',()=>{
  const s=space(),input=controllerInput();input.button(1,true);for(let i=0;i<12;i++)input.tick(s);
  input.tick(s,true);input.tick(s);input.button(1,false);input.tick(s);
  assert.equal(s.stats.shots[0],0);assert.equal(s.charging,null);
});

test('pass power chooses the distant teammate when two receivers occupy the LS cone',()=>{
  const short=passingLane({x:6,z:4}),long=passingLane({x:6,z:4});
  for(const [s,power] of [[short,.05],[long,.85]]){
    Object.assign(s.players[2],{x:17,z:4});s.charging='pass';s.charge=power;
    game.step(s,dt,{move:{x:1,y:.2},released:{pass:true}});
  }
  assert.ok(short.ball.vz/short.ball.vx>long.ball.vz/long.ball.vx+.2);
  assert.ok(Math.hypot(long.ball.vx,long.ball.vz)>Math.hypot(short.ball.vx,short.ball.vz));
});

test('sub-tick A tap retains sampled LS direction through input merge and actually reaches the receiver',()=>{
  const s=passingLane({x:0,z:9}),input=controllerInput();
  input.pad.axes=[0,1,0,0];input.button(0,true);
  const pending=input.sample(); // A pressed on a render frame before the simulation tick.
  input.pad.axes=[0,0,0,0];input.button(0,false);
  const merged=mergePendingInput(input.sample(),pending);
  assert.deepEqual(merged.move,{x:0,y:0});assert.deepEqual(merged.aim,{x:0,y:1});
  game.step(s,dt,merged);
  assert.ok(s.ball.vz>9&&Math.abs(s.ball.vx)<1.2,'the merged LS pass must travel toward the receiver, not neutral facing');
  assert.equal(s.players[3].x,0);assert.equal(s.players[3].z,0,'centering LS must stop movement while retaining the tap direction');
  for(let i=0;i<150&&s.ball.owner<0;i++)input.tick(s);
  assert.equal(s.ball.owner,4);assert.equal(s.active,4);
});

test('voice cancellation wins over a B press merged before the first simulation tick',()=>{
  const s=space(),adapter=new SportsInput('soccer');
  const pad={id:'voice race',index:0,connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};
  adapter.sample(new Set(),[pad]);pad.buttons[1]={pressed:true,value:1};
  const pending=adapter.sample(new Set(),[pad]);
  const merged=mergePendingInput(adapter.sample(new Set(),[pad],true),pending);
  assert.equal(merged.pressed.shoot,true);assert.equal(merged.cancelled.shoot,true);
  game.step(s,dt,merged);
  assert.equal(s.stats.shots[0],0);assert.equal(s.charging,null);assert.equal(s.ball.owner,3);
  pad.buttons[1]={pressed:false,value:0};game.step(s,dt,adapter.sample(new Set(),[pad]));
  assert.equal(s.stats.shots[0],0);
});

// ------------------------------------------------------------ league contract
const cpuMatch=(options={})=>game.createState({setup:false,mode:'watch',teams:[0,1],seed:11,...options});
function run(s,n,input){for(let i=0;i<n&&s.phase!=='finished';i++)game.step(s,dt,input);}

test('team select drives teams, mode and difficulty, then kicks off directly',()=>{
  const s=game.createState();assert.equal(s.phase,'setup');assert.equal(game.hud(s).setup.rows[0].label,'MODE');assert.equal(game.hud(s).message,'NIGHT LEAGUE · TEAM SELECT');
  game.step(s,dt,{pressed:{down:true}});game.step(s,dt,{pressed:{right:true}});
  assert.equal(s.setup.cursor,1);assert.equal(s.setup.teams[0],2,'the home side skips the team already chosen as the opponent');
  game.step(s,dt,{pressed:{down:true}});game.step(s,dt,{pressed:{down:true}});game.step(s,dt,{pressed:{right:true}});assert.equal(s.setup.difficulty,2);
  game.step(s,dt,{pressed:{confirm:true}});assert.equal(s.phase,'play');assert.equal(s.teams[0].short,'NORTHGATE');assert.equal(s.teams[1].short,'EMBER');assert.equal(s.difficulty,2);assert.equal(s.mode,'play');
  assert.equal(game.validateState(s),true);assert.equal(game.hud(s).teams[0].name,'NORTHGATE ROVERS');assert.equal(game.hud(s).athlete.name,'S. Iwasaki');assert.equal(game.hud(s).athlete.ratings.length,4);
});

test('createState options skip the setup screen and seed every random draw',()=>{
  const a=game.createState({setup:false,mode:'watch',teams:[2,3],difficulty:0,seed:123}),b=game.createState({setup:false,mode:'watch',teams:[2,3],difficulty:0,seed:123});
  assert.equal(a.phase,'play');assert.equal(a.mode,'watch');assert.equal(a.difficulty,0);assert.equal(a.seed,123);assert.deepEqual(a.setup.teams,[2,3]);assert.equal(a.setup.mode,1);
  run(a,600);run(b,600);assert.deepEqual(a,b);
  const c=game.createState({setup:false,mode:'watch',teams:[2,3],difficulty:0,seed:124});run(c,600);assert.notDeepEqual(c.players.map(p=>p.x),a.players.map(p=>p.x));
  assert.throws(()=>game.createState({seed:-1}));
});

test('watch mode runs both teams on the CPU and ignores gameplay input',()=>{
  const s=cpuMatch();run(s,300,{held:{shoot:true,sprint:true},move:{x:1,y:0},pressed:{tackle:true}});
  assert.equal(s.charge,0);assert.equal(s.charging,null);assert.equal(s.away.charge,0);
  const hud=game.hud(s);assert.equal(hud.mode,'watch');assert.deepEqual(hud.selected,[null,null]);assert.equal(hud.athlete,null);assert.match(hud.detail,/CPU vs CPU/);
  assert.ok(s.stats.passes[0]+s.stats.passes[1]>0,'the CPU teams play');
});

test('two controllers drive their own selected athletes with independent charge state',()=>{
  const s=game.createState({setup:false,seed:5});
  const q=s.players[s.away.active];Object.assign(s.ball,{owner:q.id,x:q.x-1,z:q.z,lastTouch:1});
  for(let i=0;i<20;i++)game.step(s,dt,{teams:[{move:{x:0,y:0}},{held:{shoot:true},aim:{x:-1,y:0}}]});
  assert.ok(s.away.charge>0.25);assert.equal(s.away.charging,'shoot');assert.equal(s.charge,0);assert.equal(game.hud(s,1).power,s.away.charge);assert.equal(game.hud(s,1).charging,'shoot');assert.equal(game.hud(s).power,0);
  game.step(s,dt,{teams:[{},{released:{shoot:true},aim:{x:-1,y:0}}]});
  assert.equal(s.stats.shots[1],1);assert.ok(s.ball.vx<-15,'team 1 shoots toward -x');assert.equal(s.away.charge,0);
  const before=s.frame;run(s,120,{teams:[null,{}]});assert.ok(s.frame>before);assert.equal(game.validateState(s),true);
});

test('hud exposes the league contract from either controller perspective',()=>{
  const s=game.createState({setup:false,seed:3});const h=game.hud(s);
  for(const key of ['teams','selected','athlete','setup','summary','ticker','period','timeouts','mode','phase','message','detail','skillHint','skillReady','status','power','charging','stamina','score','clock','label','finished','teamNames'])assert.ok(key in h,key);
  assert.deepEqual(h.teams.map(t=>t.short),['ALDER','EMBER']);assert.equal(h.teams[1].primary,'#ff7654');assert.deepEqual(h.selected,[3,8]);assert.equal(h.athlete.name,'L. Okafor-Reyes');assert.equal(h.period,null);assert.equal(h.timeouts,null);assert.equal(h.summary,null);assert.equal(h.setup,null);assert.deepEqual(h.ticker,[]);
  const away=game.hud(s,1);assert.equal(away.athlete.name,'N. Castellan');assert.deepEqual(away.selected,[3,8]);assert.deepEqual(away.score,h.score);assert.match(away.detail,/EMBER ATTACKS ←/);assert.match(h.detail,/ALDER ATTACKS →/);assert.equal(away.message,h.message);assert.equal(away.stamina,s.players[8].stamina);
});

test('save, load and continue a CPU match exactly, with every new field validated',()=>{
  const a=cpuMatch({seed:21});run(a,1500);
  const b=JSON.parse(JSON.stringify(a));assert.equal(game.validateState(b),true);
  run(a,900);run(b,900);assert.deepEqual(a,b);
  for(const mutate of [s=>s.seed=-1,s=>s.teams[0].players[0].ratings.div=120,s=>s.players[3].yellow=3,s=>s.players[0].off=true,s=>s.ball.flagged=[12],s=>s.stats.fouls=[0],s=>s.events=Array(41).fill({frame:0,clock:0,kind:'goal',team:0,text:''}),s=>s.setPiece={kind:'Kickoff',taker:3,team:0},s=>s.setPiece={kind:'Corner',taker:8,team:0},s=>s.away.active=3,s=>s.mode='replay',s=>s.difficulty=3,s=>s.players[4].plan=null,s=>delete s.players[2].stats.fouls]){
    const s=cpuMatch();mutate(s);assert.throws(()=>game.validateState(s));
  }
});

test('a full built-in CPU match finishes quickly with valid state, plausible statistics and a star player',()=>{
  const s=cpuMatch({seed:77});const started=performance.now();let frames=0,fastest=0;
  while(s.phase!=='finished'&&frames<60*700){game.step(s,dt);frames++;for(const p of s.players)fastest=Math.max(fastest,Math.hypot(p.vx,p.vz));}
  const elapsed=performance.now()-started;
  assert.equal(s.phase,'finished');assert.equal(game.validateState(s),true);assert.ok(elapsed<2500,`simulated in ${elapsed} ms`);assert.ok(fastest<=9.3,`athlete speed ${fastest}`);
  const st=s.stats,total=k=>st[k][0]+st[k][1];
  assert.ok(total('shots')>=4&&total('shots')<=40,`shots ${total('shots')}`);assert.ok(total('passes')>=60);assert.ok(total('completed')<=total('passes'));assert.ok(st.onTarget.every((n,t)=>n<=st.shots[t]&&n>=s.score[t]));
  assert.ok(total('possession')>400&&total('possession')<=600.01);assert.ok(s.events.length<=40&&s.events.some(e=>e.kind==='whistle'));
  assert.ok(s.players.reduce((n,p)=>n+p.stats.goals,0)<=s.score[0]+s.score[1]);
  const hud=game.hud(s);assert.equal(hud.finished,true);assert.ok(hud.summary.rows.length>=8);assert.ok(hud.ticker.length<=4);assert.equal(typeof hud.summary.star.line,'string');assert.ok([0,1].includes(hud.summary.star.team));
});

// ------------------------------------------------------------------- rules
// Team 1's controller runs the carrier away (+x) while team 0's defender
// lunges from behind into the athlete, not the ball.
function fromBehind(seed,victimX,victimZ=0,{tackler=3,yellow=0,offTeammates=[],specialties}={}){
  const s=game.createState({setup:false,seed});s.active=tackler;const p=s.players[tackler],q=s.players[8];if(specialties)athlete(s,0,tackler).specialties=specialties;
  s.players.forEach(o=>{if(o.id!==p.id&&o.id!==q.id&&!o.keeper){o.x=o.team===0?-24:24;o.z=o.id%2?14:-14;}});
  Object.assign(q,{x:victimX,z:victimZ,fx:1,fz:0,vx:6,vz:0});Object.assign(p,{x:victimX-1.1,z:victimZ,fx:1,fz:0,vx:6,vz:0,yellow});
  for(const id of offTeammates)s.players[id].off=true;
  Object.assign(s.ball,{owner:8,x:victimX+1,z:victimZ,lastTouch:1});s.away.active=8;s.possessionAge=1;
  const run={move:{x:1,y:0}};
  game.step(s,dt,{teams:[{pressed:{tackle:true},move:{x:1,y:0}},run]});
  for(let i=0;i<20&&s.phase==='play';i++)game.step(s,dt,{teams:[{move:{x:1,y:0}},run]});
  return s;
}
const firstSeed=(predicate,build)=>{for(let seed=1;seed<80;seed++){const s=build(seed);if(predicate(s))return s;}return null;};

test('a mistimed tackle from behind is a foul: direct free kick at the spot, wall and taker lock',()=>{
  const s=firstSeed(s=>s.phase==='restart'&&s.restart.type==='Free kick',seed=>fromBehind(seed,-6));
  assert.ok(s,'some seed must produce a foul');assert.equal(s.restart.team,1);assert.equal(s.stats.fouls[0],1);assert.equal(s.stats.freeKicks[1],1);assert.equal(s.players[3].stats.fouls,1);
  assert.ok(s.restart.x>-8&&s.restart.x<-2&&Math.abs(s.restart.z)<1.5,`kick taken where the foul happened (${s.restart.x})`);assert.ok(['whistle','card'].includes(s.feedback.kind));assert.ok(s.events.some(e=>e.kind==='foul'));
  assert.ok(Array.isArray(s.restart.wall)&&s.restart.wall.length>=1&&s.restart.wall.every(id=>s.players[id].team===0&&Math.abs(Math.hypot(s.players[id].x-s.restart.x,s.players[id].z-s.restart.z)-5.2)<1.3),'a wall stands about 5 m away');
  assert.ok(s.players.filter(p=>p.team===0&&p.id!==0&&!s.restart.wall.includes(p.id)).every(p=>Math.hypot(p.x-s.restart.x,p.z-s.restart.z)>=5),'other defenders are held off');
  const taker=s.players[s.restart.taker];assert.equal(taker.team,1);assert.equal(game.validateState(s),true);
  frames(s,30);game.step(s,dt,{teams:[{},{pressed:{confirm:true}}]});assert.equal(s.phase,'play');assert.deepEqual(s.setPiece,{kind:'Free kick',taker:taker.id,team:1});assert.equal(s.ball.owner,taker.id);
  const spot={x:taker.x,z:taker.z};frames(s,20,{teams:[{move:{x:1,y:0}},{move:{x:-1,y:0},held:{sprint:true}}]});
  assert.ok(Math.hypot(taker.x-spot.x,taker.z-spot.z)<.05,'the taker cannot dribble before kicking');assert.match(game.hud(s,1).skillHint,/FREE KICK/);
  frames(s,12,{teams:[{},{held:{shoot:true},aim:{x:-1,y:0}}]});game.step(s,dt,{teams:[{},{released:{shoot:true},aim:{x:-1,y:0}}]});
  assert.equal(s.setPiece,null);assert.equal(s.stats.shots[1],1);assert.ok(s.ball.vx<0);
});

test('a foul inside the penalty area is a penalty: spot kick, cleared box, keeper on the line and a dive',()=>{
  const s=firstSeed(s=>s.phase==='restart'&&s.restart.type==='Penalty',seed=>fromBehind(seed,-21,1));
  assert.ok(s,'some seed must produce a penalty');assert.equal(s.restart.team,1);assert.equal(s.stats.penalties[1],1);assert.equal(s.stats.fouls[0],1);assert.match(s.message,/PENALTY/);
  assert.deepEqual([s.ball.x,s.ball.z],[-21.6,0]);const taker=s.players[s.restart.taker];assert.equal(taker.team,1);
  assert.ok(s.players.filter(p=>!p.off&&p.id!==taker.id&&!p.keeper).every(p=>!(p.x<-19&&Math.abs(p.z)<9)),'everyone else waits outside the box');
  const keeper=s.players[0];assert.ok(keeper.x<-26.5&&Math.abs(keeper.z)<.1,`keeper ${keeper.x},${keeper.z}`);
  frames(s,30);game.step(s,dt,{teams:[{},{pressed:{confirm:true}}]});assert.equal(s.setPiece.kind,'Penalty');
  frames(s,30,{teams:[{},{held:{shoot:true},aim:{x:-1,y:-.5}}]});game.step(s,dt,{teams:[{},{released:{shoot:true},aim:{x:-1,y:-.5}}]});
  assert.equal(s.stats.shots[1],1);assert.ok(keeper.dive>0,'the keeper commits to a side');assert.equal(s.setPiece,null);
  frames(s,60);assert.ok(s.phase!=='play'||s.ball.owner>=0||Math.abs(s.ball.x)<28);
});

test('a second yellow is a red: the athlete leaves, is ignored, and a team never drops below two outfielders',()=>{
  const s=firstSeed(s=>s.stats.yellows[0]+s.stats.reds[0]>0,seed=>fromBehind(seed,-6,0,{yellow:1}));
  assert.ok(s,'some seed must book the tackler');const p=s.players[3];
  assert.equal(p.off,true);assert.equal(s.stats.reds[0],1);assert.equal(p.yellow,2);assert.ok(s.events.some(e=>e.kind==='card'&&/RED CARD/.test(e.text)));assert.equal(s.feedback.kind,'card');
  assert.notEqual(s.active,3,'selection leaves the dismissed athlete');assert.equal(game.validateState(s),true);
  const bench={x:p.x,z:p.z};frames(s,200);assert.deepEqual({x:p.x,z:p.z},bench,'a sent-off athlete never moves again');
  assert.ok(s.players.filter(q=>q.team===0&&!q.off&&!q.keeper).length===3);
  const thin=firstSeed(s=>s.stats.yellows[0]+s.stats.reds[0]>0,seed=>fromBehind(seed,-6,0,{yellow:1,offTeammates:[1,2]}));
  assert.ok(thin);assert.equal(thin.players[3].off,false,'the booking stands without a send-off');assert.equal(thin.stats.reds[0],0);
});

test('keepers are never carded and sent-off athletes stay hidden for the rest of the match',()=>{
  let fouls=0,cards=0;
  for(let seed=1;seed<40;seed++){const s=fromBehind(seed,-6,0,{tackler:0});if(s.phase==='restart'&&s.restart.type==='Free kick'){fouls++;cards+=s.stats.yellows[0]+s.stats.reds[0];}}
  assert.ok(fouls>0);assert.equal(cards,0);
  const s=game.createState({setup:false,seed:4});s.players[2].off=true;s.players[2].x=-20;s.players[2].z=-18.6;frames(s,120);assert.deepEqual([s.players[2].x,s.players[2].z],[-20,-18.6]);
  s.clock=dt/2;game.step(s,dt);game.step(s,dt,{pressed:{confirm:true}});assert.equal(s.players[2].off,false,'a rematch restores the squad');
});

function offsideScene(receiverX,defenderX,seed=9){
  const s=game.createState({setup:false,seed});const p=s.players[3];Object.assign(p,{x:6,z:0,fx:1,fz:0});Object.assign(s.ball,{x:6.7,z:0});
  Object.assign(s.players[4],{x:receiverX,z:2});Object.assign(s.players[1],{x:-20,z:-12});Object.assign(s.players[2],{x:-20,z:12});
  [[6,defenderX,-10],[7,defenderX,10],[8,2,-12],[9,2,12]].forEach(([id,x,z])=>Object.assign(s.players[id],{x,z}));
  s.charging='pass';s.charge=.5;return s;
}
test('offside is flagged only in the attacking third, only on passes, and whistled on the next touch',()=>{
  const s=offsideScene(20,12);game.step(s,dt,{move:{x:1,y:.1},pressed:{pass:true},released:{pass:true}});
  assert.deepEqual(s.ball.flagged,[4]);for(let i=0;i<150&&s.phase==='play';i++)game.step(s,dt);
  assert.equal(s.phase,'restart');assert.equal(s.restart.type,'Free kick');assert.equal(s.restart.team,1);assert.equal(s.stats.offsides[0],1);assert.equal(s.stats.freeKicks[1],1);assert.match(s.message,/OFFSIDE · M\. QUILL/);assert.ok(s.events.some(e=>e.kind==='offside'));
  const shot=offsideScene(20,12);shot.charging='shoot';game.step(shot,dt,{move:{x:1,y:.1},pressed:{shoot:true},released:{shoot:true}});assert.deepEqual(shot.ball.flagged,[],'a shot never flags anyone');
  const middle=offsideScene(8,4);game.step(middle,dt,{move:{x:1,y:.1},pressed:{pass:true},released:{pass:true}});assert.deepEqual(middle.ball.flagged,[],'no offside outside the attacking third');
  const level=offsideScene(20,21);game.step(level,dt,{move:{x:1,y:.1},pressed:{pass:true},released:{pass:true}});assert.deepEqual(level.ball.flagged,[],'level with the second-last defender is onside');
  const other=offsideScene(20,12);game.step(other,dt,{move:{x:1,y:.1},pressed:{pass:true},released:{pass:true}});loose(other,other.players[3].x+.5,other.players[3].z,0,0,0);game.step(other,dt);assert.equal(other.ball.owner,3);assert.equal(other.stats.offsides[0],0,'a flagged athlete who never touches the ball is not punished');
});

// --------------------------------------------------- mechanics and ratings
const athlete=(s,team,slot)=>s.teams[team].players[slot];
// A side-on lunge at the ball of a shielding carrier: only reach decides it.
function reachTackle(configure){
  const s=live();configure(s);athlete(s,1,3).ratings.phy=0;s.active=3;const p=s.players[3],q=s.players[8];Object.assign(p,{x:0,z:0,fx:1,fz:0});Object.assign(q,{x:2.65,z:-.43,fx:0,fz:1});
  s.players.filter(o=>o.id!==3&&o.id!==8&&!o.keeper).forEach(o=>{o.x=o.team?22:-22;o.z=12;});Object.assign(s.ball,{owner:8,x:2.65,z:0,lastTouch:1});s.possessionAge=1;s.away.active=8;
  const shield={held:{shield:true}};game.step(s,dt,{teams:[{pressed:{tackle:true}},shield]});frames(s,14,{teams:[{},shield]});return s.ball.owner===3;
}
function shotScene(seed,x,{sho,specialties}={}){
  const s=game.createState({setup:false,seed});const p=s.players[3];Object.assign(p,{x,z:0,fx:1,fz:0});Object.assign(s.ball,{x:x+.7,z:0});
  s.players.filter(q=>q.id!==3&&!q.keeper).forEach(q=>Object.assign(q,{x:q.team===1?-22:-24,z:q.id%2?14:-14}));
  if(sho!==undefined)athlete(s,0,3).ratings.sho=sho;if(specialties)athlete(s,0,3).specialties=specialties;
  s.charging='shoot';s.charge=.5;game.step(s,dt,{move:{x:1,y:0},released:{shoot:true}});
  return {s,crossing:s.ball.z+s.ball.vz/s.ball.vx*(28-s.ball.x),speed:Math.hypot(s.ball.vx,s.ball.vz)};
}
const mean=values=>values.reduce((a,b)=>a+b,0)/values.length;
const seeds=Array.from({length:30},(_,i)=>i+1);

test('Shooting narrows shot error and Passing narrows pass error across many seeds',()=>{
  const sharp=mean(seeds.map(seed=>Math.abs(shotScene(seed,10,{sho:99}).crossing))),wild=mean(seeds.map(seed=>Math.abs(shotScene(seed,10,{sho:30}).crossing)));
  assert.ok(sharp<wild*.5,`99 Shooting mean miss ${sharp} vs 30 Shooting ${wild}`);
  const passError=pas=>mean(seeds.map(seed=>{const s=passingLane({x:10,z:0});s.seed=seed;athlete(s,0,3).ratings.pas=pas;game.step(s,dt,{move:{x:1,y:0},pressed:{pass:true},released:{pass:true}});return Math.abs(Math.atan2(s.ball.vz,s.ball.vx));}));
  assert.ok(passError(99)<passError(30)*.5,`pass angle error ${passError(99)} vs ${passError(30)}`);
});

test('Pace, Dribbling and Defending move speed, close control and tackle reach',()=>{
  const speedAfter=pac=>{const s=live();athlete(s,0,3).ratings.pac=pac;s.players.filter(p=>p.team===1).forEach(p=>{p.x=24;p.z=14;});frames(s,60,{move:{x:1,y:0},held:{sprint:true}});return s.players[3].vx;};
  assert.ok(speedAfter(99)>speedAfter(30)+1.2);assert.ok(speedAfter(99)<=9.3);
  const lead=dri=>{const s=live();athlete(s,0,3).ratings.dri=dri;s.players.filter(p=>p.team===1).forEach(p=>{p.x=24;p.z=14;});frames(s,40,{move:{x:1,y:0}});return s.ball.x-s.players[3].x;};
  assert.ok(lead(99)<lead(30)-.2,'better dribblers keep the ball closer');
  assert.equal(reachTackle(s=>athlete(s,0,3).ratings.def=99),true);assert.equal(reachTackle(s=>athlete(s,0,3).ratings.def=0),false);
});

test('keepers dive to the predicted crossing point, catch comfortably or parry into play',()=>{
  const s=live();loose(s,14,0,26,7,0,.5);s.ball.shot=true;s.ball.kicker=3;const keeper=s.players[5];let dove=false;
  for(let i=0;i<60&&s.phase==='play'&&s.ball.owner<0;i++){game.step(s,dt);if(keeper.dive>0)dove=true;}
  assert.ok(dove,'the keeper dives at a shot heading inside the posts');assert.ok(s.stats.saves[1]+s.score[0]>=1);
  const parry=firstSeed(s=>s.stats.saves[1]===1&&s.ball.owner===-1,seed=>{const s=game.createState({setup:false,seed});athlete(s,1,0).ratings.han=0;loose(s,20,0,32,0,0,.6);s.ball.shot=true;s.ball.kicker=3;frames(s,12);return s;});
  assert.ok(parry,'a poor handler parries');assert.ok(parry.ball.vx<0,'the parry travels back into the field');assert.match(parry.message,/PARRIED/);assert.equal(parry.stats.onTarget[0],1);
  const catches=seeds.filter(seed=>{const s=game.createState({setup:false,seed});athlete(s,1,0).ratings.han=99;loose(s,20,0,32,0,0,.6);s.ball.shot=true;s.ball.kicker=3;frames(s,12);return s.ball.owner===5;}).length;
  assert.ok(catches>=20,`99 Handling catches most fast shots (${catches}/30)`);
});

function headerScene(seed,specialties){
  const s=game.createState({setup:false,seed});const q=s.players[9];Object.assign(q,{x:-16,z:0,fx:-1,fz:0});if(specialties)athlete(s,1,4).specialties=specialties;
  s.players.filter(p=>p.id!==9&&!p.keeper).forEach(p=>{p.x=p.team?20:16;p.z=p.id%2?13:-13;});
  Object.assign(s.ball,{x:-6,z:0,y:.4,vx:-14,vz:0,vy:5,owner:-1,lastTouch:1,kicker:8,lock:0,pass:true,shot:false});s.away.active=9;
  for(let i=0;i<80&&s.stats.shots[1]===0;i++)game.step(s,dt,{teams:[null,{pressed:{shoot:true},aim:{x:-1,y:0}}]});
  return s;
}
test('a lofted ball at head height can be headed first time; Aerial Threat heads harder',()=>{
  const s=headerScene(2);assert.equal(s.stats.shots[1],1);assert.match(s.message,/HEADER · R\. ADAIR · AERIAL THREAT/);assert.ok(s.ball.y>1);
  const plain=headerScene(2,[]);assert.equal(plain.stats.shots[1],1);assert.ok(Math.hypot(s.ball.vx,s.ball.vz)>Math.hypot(plain.ball.vx,plain.ball.vz)*1.2);
  const ignored=game.createState({setup:false,seed:2});Object.assign(ignored.players[9],{x:-16,z:0});Object.assign(ignored.ball,{x:-6,z:0,y:.4,vx:-14,vz:0,vy:5,owner:-1,lastTouch:1,kicker:8,lock:0,pass:true});ignored.away.active=9;
  frames(ignored,40,{teams:[null,{}]});assert.equal(ignored.stats.shots[1],0,'a controlled athlete heads only on request');
});

test('a hard pass to a poor dribbler can bounce off while a good first touch controls it',()=>{
  const spills=dri=>seeds.filter(seed=>{const s=game.createState({setup:false,seed});athlete(s,0,4).ratings.dri=dri;Object.assign(s.players[4],{x:10,z:0});
    s.players.filter(p=>p.id!==4&&!p.keeper).forEach(p=>{p.x=p.team?24:-24;p.z=12;});Object.assign(s.ball,{x:1,z:0,y:.35,vx:26,vz:0,vy:0,owner:-1,lastTouch:0,kicker:3,lock:.3,pass:true});
    frames(s,30);return /HEAVY TOUCH/.test(s.message);}).length;
  assert.equal(spills(99),0);assert.ok(spills(30)>=8,`poor dribblers spill often (${spills(30)}/30)`);
});

test('every soccer specialty produces exactly its stated effect against a control profile',()=>{
  const pair=(team,slot,id,build)=>{const on=build(s=>athlete(s,team,slot).specialties=[id]),off=build(s=>athlete(s,team,slot).specialties=[]);return [on,off];};
  // finisher: inside-box shots are more accurate for every seed (same random draws, scaled error)
  for(const seed of seeds.slice(0,10)){const [on,off]=pair(0,3,'finisher',set=>{const s=game.createState({setup:false,seed});set(s);const p=s.players[3];Object.assign(p,{x:22,z:0,fx:1,fz:0});Object.assign(s.ball,{x:22.7,z:0});s.players.filter(q=>q.id!==3&&!q.keeper).forEach(q=>Object.assign(q,{x:-22,z:q.id%2?14:-14}));s.charging='shoot';s.charge=.5;game.step(s,dt,{move:{x:1,y:0},released:{shoot:true}});return Math.abs(s.ball.vz/s.ball.vx);});assert.ok(on<=off+1e-9,'finisher');}
  // cannon: power shots leave 12% faster
  {const [on,off]=pair(0,3,'cannon',set=>{const s=live();set(s);s.players[3].x=5;s.charging='shoot';s.charge=1;game.step(s,dt,{move:{x:1,y:0},released:{shoot:true}});return Math.hypot(s.ball.vx,s.ball.vz);});assert.ok(Math.abs(on/off-1.2)<.02,`cannon ${on/off}`);}
  // playmaker: driven passes deviate less from the aim for every seed
  for(const seed of seeds.slice(0,10)){const [on,off]=pair(0,3,'playmaker',set=>{const s=passingLane({x:12,z:0});set(s);s.seed=seed;s.charging='pass';s.charge=.4;s.delivery='driven';game.step(s,dt,{move:{x:1,y:0},held:{driven:true},released:{pass:true}});return Math.abs(Math.atan2(s.ball.vz,s.ball.vx));});assert.ok(on<=off+1e-9,'playmaker');}
  // trickster: half the stamina cost and a shorter recovery
  {const [on,off]=pair(0,3,'trickster',set=>{const s=live();set(s);athlete(s,0,3).ratings.dri=99;frames(s,10);game.step(s,dt,{pressed:{skill:true},aim:{x:0,y:1}});const cost=s.players[3].stamina;game.step(s,dt);return [cost,s.players[3].skillCooldown];});assert.ok(on[0]>off[0]+.03);assert.ok(Math.abs((.72-off[1])*1.3-(.72-on[1]))<1e-6,'recovers 30% faster');}
  // speedster: bursts accelerate harder
  {const [on,off]=pair(0,3,'speedster',set=>{const s=live();set(s);s.players[3].burst=.6;frames(s,4,{move:{x:1,y:0},held:{sprint:true}});return s.players[3].vx;});assert.ok(on>off+.1,'speedster');}
  // wall: a shield covers a wider arc, so the same angled lunge is held off
  {const [on,off]=pair(0,3,'wall',set=>{const s=live();set(s);const p=s.players[3],q=s.players[8];Object.assign(p,{x:0,z:0,fx:1,fz:0});Object.assign(s.ball,{x:.43,z:0});s.players.filter(o=>o.id!==3&&o.id!==8&&!o.keeper).forEach(o=>{o.x=o.team?20:-20;o.z=12;});Object.assign(q,{x:.65,z:1.79,fx:-.12,fz:-.99});s.possessionAge=1;s.away.active=8;
    game.step(s,dt,{teams:[{held:{shield:true}},{pressed:{tackle:true}}]});frames(s,14,{teams:[{held:{shield:true}},{}]});return s.ball.owner===3;});assert.equal(on,true,'wall holds an angled lunge');assert.equal(off,false,'control is dispossessed by the same lunge');}
  // interceptor: reads lanes with more reach
  {const [on,off]=pair(1,3,'interceptor',set=>{const s=game.createState({setup:false,seed:1});set(s);const q=s.players[8];Object.assign(q,{x:8,z:1.0});s.players.filter(p=>p.id!==8&&!p.keeper).forEach(p=>{p.x=p.team?24:-24;p.z=14;});Object.assign(s.ball,{x:0,z:0,y:.35,vx:16,vz:0,vy:0,owner:-1,lastTouch:0,kicker:3,lock:.3,pass:true});s.away.active=8;frames(s,60,{teams:[null,{}]});return s.ball.owner===8;});assert.equal(on,true,'interceptor');assert.equal(off,false);}
  // ball winner: tackles connect from farther and foul less often
  {assert.equal(reachTackle(s=>athlete(s,0,3).specialties=['ball_winner']),true,'ball winner reach');assert.equal(reachTackle(s=>athlete(s,0,3).specialties=[]),false,'control reach');
   const fouls=specialties=>seeds.filter(seed=>fromBehind(seed,-6,0,{specialties}).phase==='restart').length;
   assert.ok(fouls(['ball_winner'])<fouls([])*.75,`ball winner fouls ${fouls(['ball_winner'])} vs ${fouls([])}`);}
  // engine: stamina drains slower
  {const [on,off]=pair(0,3,'engine',set=>{const s=live();set(s);frames(s,90,{move:{x:1,y:0},held:{sprint:true}});return s.players[3].stamina;});assert.ok(on>off+.05,'engine');}
  // cat reflexes: dives earlier at close-range shots
  {const [on,off]=pair(1,0,'cat_reflexes',set=>{const s=live();set(s);loose(s,18,0,26,6,0,.5);s.ball.shot=true;s.ball.kicker=3;for(let i=0;i<40;i++){game.step(s,dt);if(s.players[5].dive>0)return i;}return 99;});assert.ok(on<off,`cat reflexes dive frame ${on} vs ${off}`);}
  // sweeper keeper: comes out to claim a loose ball far from the line
  {const [on,off]=pair(0,0,'sweeper_keeper',set=>{const s=live();set(s);s.players.filter(p=>p.team===1).forEach(p=>{p.x=24;p.z=p.id%2?12:-12;});loose(s,-13,0,0,0,1,.4);frames(s,60);return s.players[0].x;});assert.ok(on>off+2,`sweeper ${on} vs ${off}`);}
});

// ------------------------------------------------ review fixes (human play)
test('the CPU confronts an idle carrier within seconds instead of holding off forever',()=>{
  for(const seed of [1,2,3]){
    const s=game.createState({setup:false,seed,teams:[0,1]});let f=0;
    for(;f<600&&s.ball.owner===3&&s.phase==='play';f++)game.step(s,dt,{teams:[{move:{x:0,y:0}},null]});
    assert.ok(f<360,`idle carrier dispossessed after ${f} frames`);
  }
  const idle=game.createState({setup:false,seed:17,teams:[0,1]});run(idle,60*60,{teams:[{},null]});
  assert.ok(idle.stats.possession[1]>10&&idle.stats.passes[1]>3,'an idle controller cannot freeze the match');
});

test('shield-walking is no longer invincible: frontal tackles and shoulders test it, and shielding tires',()=>{
  let lost=0;
  for(let seed=1;seed<=6;seed++){
    const s=game.createState({setup:false,seed,teams:[0,2],difficulty:2}),p=s.players[3];frames(s,60);
    for(let i=0;i<60*25&&s.phase==='play'&&s.ball.owner===3&&!(p.x>19&&Math.abs(p.z)<9);i++)game.step(s,dt,{held:{shield:true},move:{x:1,y:0},aim:{x:1,y:0}});
    if(s.ball.owner!==3)lost++;
  }
  assert.ok(lost>=4,`shield walk dispossessed ${lost}/6`);
  const s=live();s.players.filter(p=>p.team===1).forEach(p=>{p.x=24;p.z=14;});frames(s,120,{held:{shield:true}});assert.ok(s.players[3].stamina<.85,'shielding drains stamina');
});

function placedShot(seed,dz,{x=14,sho=99}={}){
  const s=game.createState({setup:false,seed}),p=s.players[3];Object.assign(p,{x,z:0,fx:1,fz:0});Object.assign(s.ball,{x:x+.7,z:0});
  s.players.filter(q=>q.id!==3&&!q.keeper).forEach(q=>{q.x=q.team?24:-24;q.z=q.id%2?14:-14;});athlete(s,0,3).ratings.sho=sho;
  s.charging='shoot';s.charge=.7;const dx=Math.sqrt(1-dz*dz);game.step(s,dt,{move:{x:dx,y:dz},aim:{x:dx,y:dz},released:{shoot:true}});
  const crossing=s.ball.z+s.ball.vz/s.ball.vx*(28-s.ball.x),before=s.stats.saves[1];
  for(let i=0;i<150&&s.phase==='play'&&s.ball.owner===-1;i++)game.step(s,dt);
  return {crossing,goal:s.score[0]>0,saved:s.stats.saves[1]>before};
}
test('keeper saves are graded: central shots are held, mid-corner shots are a contest, and post-aimed placement is risky',()=>{
  const central=seeds.slice(0,12).map(seed=>placedShot(seed,0)),mid=seeds.slice(0,20).map(seed=>placedShot(seed,2.5/4.6)),post=seeds.slice(0,20).map(seed=>placedShot(seed,.85));
  assert.equal(central.filter(r=>r.saved).length,12,'body saves');
  const midGoals=mid.filter(r=>r.goal).length;assert.ok(midGoals>=3&&midGoals<=17,`mid corner is a contest (${midGoals}/20)`);
  // Centre and post aims consume the same random draws per seed, so the paired difference isolates the placement risk.
  const paired=central.map((row,i)=>(post[i].crossing-3.9)-(row.crossing-0));
  assert.ok(mean(paired.map(Math.abs))>.2&&Math.max(...paired.map(Math.abs))>.4,`placement risk grows toward the post (mean ${mean(paired.map(Math.abs)).toFixed(2)})`);
  assert.ok(post.some(r=>!r.goal&&!r.saved),'post-aimed shots can miss');
});

test('penalty keepers react after the same Reflexes delay against human and CPU takers',()=>{
  const human=firstSeed(s=>s.phase==='restart'&&s.restart.type==='Penalty',seed=>fromBehind(seed,-21,1));
  frames(human,30);game.step(human,dt,{teams:[{},{pressed:{confirm:true}}]});human.away.charging='shoot';human.away.charge=.6;
  game.step(human,dt,{teams:[{},{released:{shoot:true},aim:{x:-1,y:.8}}]});const keeper=human.players[0],delay=keeper.diveDelay;
  assert.ok(keeper.dive>0&&delay>0,'the dive is committed but delayed');const z=keeper.z;game.step(human,dt,{teams:[{},{}]});assert.equal(keeper.z,z,'no movement during the reaction delay');
  assert.ok(Math.hypot(human.ball.vx,human.ball.vz)<=26.01,'penalties are placed, not blasted');
  const cpu=firstSeed(s=>s.phase==='restart'&&s.restart.type==='Penalty',seed=>fromBehind(seed,-21,1));
  while(cpu.phase==='restart')game.step(cpu,dt,{teams:[null,null]});while(cpu.setPiece&&cpu.phase==='play')game.step(cpu,dt,{teams:[null,null]});
  assert.ok(cpu.players[0].dive>0);assert.ok(Math.abs(cpu.players[0].diveDelay-delay)<1e-9,'identical reaction delay for both takers');
});

test('a ball that passes over a controlled athlete keeps its certified flight instead of hovering',()=>{
  const s=game.createState({setup:false,seed:3});s.players.filter(p=>![3,4].includes(p.id)&&!p.keeper).forEach(p=>{p.x=p.team?24:-24;p.z=p.id%2?14:-14;});
  Object.assign(s.players[3],{x:0,z:0});Object.assign(s.players[4],{x:8,z:0});s.active=4;
  Object.assign(s.ball,{x:1,z:0,y:.35,vx:14,vz:0,vy:5.5,owner:-1,lastTouch:0,kicker:3,lock:.3,shot:false,pass:true,style:'loft'});
  let previous=s.ball.x,stalls=0;
  for(let i=0;i<60;i++){game.step(s,dt,{teams:[{move:{x:0,y:0}},null]});if(s.ball.owner<0&&s.ball.x===previous)stalls++;previous=s.ball.x;}
  assert.equal(stalls,0);assert.ok(s.ball.x>8.5,'the ball travelled past the athlete');
});

test('bookings at the two-outfielder floor never push yellow past two, so saves stay valid',()=>{
  const s=firstSeed(s=>s.stats.yellows[0]>0,seed=>fromBehind(seed,-6,0,{yellow:2,offTeammates:[1,2]}));
  assert.ok(s);assert.equal(s.players[3].yellow,2);assert.equal(s.players[3].off,false);assert.equal(game.validateState(JSON.parse(JSON.stringify(s))),true);
});

test('throw-ins, goal kicks and corners are locked set pieces whose delivery never flags offside',()=>{
  const s=offsideScene(20,12);s.charging=null;s.charge=0;loose(s,4,17.2,0,0,1);game.step(s,dt);
  assert.equal(s.restart.type,'Throw-in');assert.equal(s.restart.team,0);frames(s,30);game.step(s,dt,{pressed:{confirm:true}});
  assert.equal(s.setPiece.kind,'Throw-in');const taker=s.players[s.setPiece.taker],spot={x:taker.x,z:taker.z};frames(s,10,{move:{x:1,y:0},held:{sprint:true}});
  assert.ok(Math.hypot(taker.x-spot.x,taker.z-spot.z)<.05,'the thrower cannot dribble away');
  Object.assign(s.players[4],{x:20,z:2});s.charging='pass';s.charge=.6;game.step(s,dt,{move:{x:1,y:-.3},released:{pass:true}});
  assert.equal(s.setPiece,null);assert.deepEqual(s.ball.flagged,[],'no offside from a throw-in');
  const g=game.createState({setup:false,seed:5,mode:'watch'});Object.assign(g.players[4],{x:20,z:2});[[6,12,-10],[7,12,10]].forEach(([id,x,z])=>Object.assign(g.players[id],{x,z}));
  loose(g,-28.2,10,0,0,1);game.step(g,dt);assert.equal(g.restart.type,'Goal kick');run(g,120);assert.deepEqual(g.ball.flagged,[],'no offside from a goal kick');
});

test('only shots earn saves and on-target credit; a facing-away clearance is not a shot',()=>{
  const s=game.createState({setup:false,seed:1,mode:'watch'});s.players.filter(p=>!p.keeper).forEach(p=>{p.x=p.team?24:-24;p.z=p.id%2?14:-14;});
  Object.assign(s.ball,{x:-19,z:0,y:.36,vx:-22,vz:0,vy:0,owner:-1,lastTouch:1,kicker:8,lock:0,shot:false,pass:false});
  for(let i=0;i<40&&s.ball.owner===-1&&s.phase==='play';i++)game.step(s,dt);
  assert.equal(s.ball.owner,0);assert.deepEqual(s.stats.saves,[0,0]);assert.deepEqual(s.stats.onTarget,[0,0]);
  const c=live();const p=c.players[3];Object.assign(p,{x:0,z:0,fx:-1,fz:0});Object.assign(c.ball,{x:-.7,z:0});c.charging='shoot';c.charge=.5;
  game.step(c,dt,{move:{x:-1,y:0},aim:{x:-1,y:0},released:{shoot:true}});assert.equal(c.stats.shots[0],0);assert.equal(c.stats.passes[0],0);assert.ok(c.ball.vx<-10);assert.equal(c.ball.shot,false);assert.match(c.message,/CLEARED/);
});

test('finesse from a wide angle is a real weapon: more goals and fewer misses than a plain shot',()=>{
  const shoot=(seed,finesse)=>{const s=game.createState({setup:false,seed}),p=s.players[3];Object.assign(p,{x:14,z:-7,fx:1,fz:0});Object.assign(s.ball,{x:14.7,z:-7});
    s.players.filter(q=>q.id!==3&&!q.keeper).forEach(q=>{q.x=q.team?24:-24;q.z=q.id%2?14:-14;});s.charging='shoot';s.charge=.65;s.delivery=finesse?'finesse':'normal';const before=s.stats.saves[1];
    game.step(s,dt,{move:{x:.7,y:-1},aim:{x:.7,y:-1},released:{shoot:true},held:{finesse}});for(let i=0;i<120&&s.phase==='play'&&s.ball.owner===-1;i++)game.step(s,dt);
    return s.score[0]>0?'goal':s.stats.saves[1]>before?'saved':'miss';};
  const tally=finesse=>{const t={goal:0,saved:0,miss:0};for(let seed=1;seed<=30;seed++)t[shoot(seed,finesse)]++;return t;};
  const curl=tally(true),plain=tally(false);
  assert.ok(curl.goal>plain.goal,`finesse ${JSON.stringify(curl)} vs plain ${JSON.stringify(plain)}`);assert.ok(curl.miss<=plain.miss);
});

test('Speedster accelerates harder on RT sprints, not only on skill bursts',()=>{
  const sprint=on=>{const s=live();athlete(s,0,3).specialties=on?['speedster']:[];s.players.filter(p=>p.team===1).forEach(p=>{p.x=24;p.z=14;});frames(s,6,{move:{x:1,y:0},held:{sprint:true}});return s.players[3].vx;};
  assert.ok(sprint(true)>sprint(false)*1.1);
});

test('step requires the fixed 60 Hz tick, and an in-place restore never serves stale per-frame reads',()=>{
  const s=live();assert.throws(()=>game.step(s,1/30));game.step(s,0);assert.equal(s.frame,1);
  const base=game.createState({setup:false,seed:4242,mode:'watch'});run(base,1500);const snap=JSON.stringify(base);
  game.step(base,dt);Object.assign(base,JSON.parse(snap));const fresh=JSON.parse(snap);
  for(let i=0;i<240;i++){game.step(base,dt);game.step(fresh,dt);}assert.deepEqual(base,fresh);
});

test('an idle human set-piece taker is auto-taken after six seconds',()=>{
  const s=firstSeed(s=>s.phase==='restart'&&s.restart.type==='Free kick',seed=>fromBehind(seed,-6));
  frames(s,30);game.step(s,dt,{teams:[{},{pressed:{confirm:true}}]});assert.equal(s.setPiece.kind,'Free kick');
  run(s,60*5,{teams:[{},{}]});assert.ok(s.setPiece,'still waiting before six seconds');
  run(s,60*2,{teams:[{},{}]});assert.equal(s.setPiece,null);assert.ok(s.stats.passes[1]+s.stats.shots[1]>=1);
});

test('validation rejects a wall on the wrong side, a running skill without duration, and a taker off his team',()=>{
  const s=firstSeed(s=>s.phase==='restart'&&s.restart.type==='Free kick',seed=>fromBehind(seed,-6));
  const bad=mutate=>{const c=JSON.parse(JSON.stringify(s));mutate(c);assert.throws(()=>game.validateState(c));};
  bad(c=>c.restart.wall=[8]);bad(c=>{c.players[1].skillTime=.2;c.players[1].skillDuration=0;});
  const live2=live();live2.setPiece={kind:'Free kick',taker:8,team:0};assert.throws(()=>game.validateState(live2));
});
