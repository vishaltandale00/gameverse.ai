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

test('soccer creates a controller-ready 5v5 match with a ten minute clock',()=>{
  const s=game.createState(); assert.equal(game.validateState(s),true); assert.equal(s.players.length,10);
  assert.equal(s.players.filter(p=>p.keeper).length,2); assert.equal(s.clock,600);
  frames(s,120); assert.equal(s.clock,600); assert.equal(s.phase,'ready');
  game.step(s,dt,{pressed:{pass:true}}); assert.equal(s.phase,'play');
});

test('assisted shot chooses the LS goal side, charges with held input, and launches on release',()=>{
  const s=live(); const p=s.players[s.active]; p.x=0;p.z=0;
  frames(s,30,{held:{shoot:true},aim:{x:0,y:-1}});
  assert.equal(s.ball.owner,s.active); assert.ok(s.charge>0.5);
  game.step(s,dt,{released:{shoot:true},aim:{x:0,y:-1}});
  assert.equal(s.ball.owner,-1); assert.ok(s.ball.vx > 25); assert.ok(s.ball.vz < 0); const crossing=s.ball.z+s.ball.vz/s.ball.vx*(28-s.ball.x); assert.ok(crossing < -3 && crossing > -4.3);
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

test('full time produces a result and rematch returns to a clean ready state',()=>{
  const s=live();s.clock=dt/2;s.score=[3,1];game.step(s,dt);assert.equal(s.phase,'finished');assert.equal(game.hud(s).finished,true);
  const frame=s.frame;game.step(s,dt);assert.deepEqual(s.score,[3,1]);assert.ok(s.frame>frame);
  game.step(s,dt,{pressed:{confirm:true}});assert.deepEqual(s,game.createState());
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

test('an assisted LS corner shot can beat the keeper after a controlled dribble',()=>{
  const s=live(),p=s.players[s.active];p.x=12;p.z=0;
  // Isolate a breakaway; opposition positioning must not decide this shot test.
  s.players.filter(q=>q.team===1&&!q.keeper).forEach(q=>{q.x=-15;q.z=10;});
  frames(s,40,{move:{x:1,y:0},held:{sprint:true}});
  assert.ok(p.x>14.9);assert.equal(s.ball.owner,p.id);assert.ok(p.stamina<1);
  const aim={x:0.45,y:0.9};
  frames(s,20,{held:{shoot:true},aim});game.step(s,dt,{released:{shoot:true},aim});
  frames(s,70);assert.deepEqual(s.score,[1,0]);assert.equal(s.stats.shots[0],1);
});

test('an assisted directional pass leads a moving teammate and changes control',()=>{
  const s=live();s.players.filter(q=>q.team===1&&!q.keeper).forEach(q=>{q.x=22;q.z=-12;});
  const aim={x:0.35,y:1};frames(s,18,{held:{pass:true},aim});game.step(s,dt,{released:{pass:true},aim});
  for(let i=0;i<110&&s.ball.owner<0;i++)game.step(s,dt);
  assert.equal(s.ball.owner,4);assert.equal(s.active,4);assert.equal(s.stats.passes[0],1);
});

test('a keeper collects a central shot and relinquishes possession without user intervention',()=>{
  const s=live();loose(s,-23.5,0,-23,0,1,0.6);
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
  const p=s.players[s.active];assert.ok(p.skillCooldown>0.65);frames(s,10);
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

test('swept goalkeeper collision catches a fast shot that crosses the body in one step',()=>{
  const s=live();loose(s,-22.5,0,-220,0,1,0.6);game.step(s,dt);
  assert.equal(s.ball.owner,0);assert.equal(s.score[1],0);assert.equal(s.stats.saves[0],1);
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
  frames(s,170);assert.ok(s.stats.shots[1]>=1);
});

test('version2 matches migrate without losing clock, score, ball position, or athlete poses',()=>{
  const s=live();frames(s,12,{move:{x:1,y:0}});s.version=2;delete s.feedback;delete s.delivery;delete s.pending;delete s.shootReady;
  const score=[...s.score],clock=s.clock,ball={...s.ball},poses=s.players.map(p=>[p.x,p.z]);
  game.validateState(s);assert.equal(s.version,3);assert.deepEqual(s.score,score);assert.equal(s.clock,clock);assert.deepEqual(s.ball,ball);assert.deepEqual(s.players.map(p=>[p.x,p.z]),poses);
});

test('restart clearance near the goal line never stacks clamped athletes',()=>{
  const s=live();Object.assign(s.players[4],{x:23.8866,z:3.0191});Object.assign(s.players[6],{x:26.0687,z:2.7371});
  loose(s,28.2,12,0,0,0);game.step(s,dt);assert.equal(s.restart.type,'Goal kick');
  for(let a=0;a<10;a++)for(let b=a+1;b<10;b++)assert.ok(Math.hypot(s.players[a].x-s.players[b].x,s.players[a].z-s.players[b].z)>=1.09);
});

test('fine post-deadzone aim is accepted and sprint exhaustion does not oscillate',()=>{
  const s=space();game.step(s,dt,{aim:{x:0,y:-.04}});assert.equal(s.players[3].fz,-1);
  const p=s.players[3];p.stamina=.003;frames(s,45,{held:{sprint:true},move:{x:1,y:0}});
  assert.equal(p.stamina,0);const speed=p.vx;frames(s,8,{held:{sprint:true},move:{x:1,y:0}});assert.ok(Math.abs(p.vx-speed)<.01);assert.ok(p.vx<=6.31);
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
  assert.ok(Math.abs(s.ball.vx)<.01);assert.ok(s.ball.vz>9);
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
  assert.ok(s.ball.vz>9&&Math.abs(s.ball.vx)<.05,'the merged LS pass must travel toward the receiver, not neutral facing');
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
