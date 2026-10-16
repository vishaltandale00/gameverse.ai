import test from 'node:test';
import assert from 'node:assert/strict';
import { footballDefinition as game } from '../src/football.js';
import { SportsInput } from '../src/sports-input.js';
import { mergePendingInput } from '../src/sports-feedback.js';
import { sportsPhysicsObservations } from '../src/sports-physics.js';
const idle = () => ({ move: {x:0,y:0}, aim: {x:0,y:0}, held: {}, pressed: {}, released: {} });
function tick(s,seconds,input=idle()){for(let i=0;i<Math.ceil(seconds*60);i++)game.step(s,1/60,input);}
function press(s,key){const i=idle();i.pressed[key]=true;game.step(s,1/60,i);}
function finishRun(s,spot){press(s,'confirm');s.players[s.carrier].x=25;s.players[s.carrier].y=spot;game.step(s,1/60,idle());}
function next(s){press(s,'confirm');}

test('football starts a valid seven-a-side match and ignores the snap hold as a throw',()=>{
 const s=game.createState();assert.equal(game.validateState(s),true);assert.equal(s.players.length,14);
 const snap=idle();snap.pressed.pass=true;snap.held.pass=true;game.step(s,1/60,snap);
 const holding=idle();holding.held.pass=true;tick(s,.3,holding);
 assert.equal(s.carrier,0);assert.equal(s.charging,false);
 game.step(s,1/60,idle());tick(s,.3,holding);assert.ok(s.charge>.2);
 const release=idle();release.released.pass=true;game.step(s,1/60,release);
 assert.equal(s.carrier,-1);assert.ok(s.ball.flight);assert.ok(s.ball.flight.ty>s.ball.flight.y);
});

test('first downs reset the series; four short plays turn the ball over at the spot',()=>{
 const s=game.createState();finishRun(s,-18);assert.match(s.message,/FIRST DOWN/);next(s);
 assert.equal(s.down,1);assert.equal(s.line,-18);assert.equal(s.target,-8);
 for(let down=1;down<=4;down++){assert.equal(s.down,down);finishRun(s,-18);next(s);}
 assert.equal(s.offense,1);assert.equal(s.down,1);assert.equal(s.line,-18);assert.equal(s.target,-28);assert.ok(s.controlled<7);
});

test('touchdowns lead to two-point attempts then the other team starts at its 20',()=>{
 const s=game.createState();press(s,'confirm');s.players[0].y=50.1;game.step(s,1/60,idle());
 assert.deepEqual(s.score,[6,0]);assert.match(s.message,/TOUCHDOWN/);next(s);
 assert.equal(s.conversion,true);assert.equal(s.line,47);press(s,'confirm');s.players[0].y=50.1;game.step(s,1/60,idle());
 assert.deepEqual(s.score,[8,0]);next(s);assert.equal(s.offense,1);assert.equal(s.line,30);assert.equal(s.conversion,false);
});

test('failed conversions do not grant points and switch possession',()=>{
 const s=game.createState();press(s,'confirm');s.players[0].y=51;game.step(s,1/60,idle());next(s);
 finishRun(s,48);assert.equal(s.score[0],6);next(s);assert.equal(s.offense,1);assert.equal(s.conversion,false);
});

test('A, B, X choose three distinct eligible receivers and right-stick aim cannot redirect a pass',()=>{
 const throws=[];
 for(const button of ['receiverA','receiverB','receiverX']){
  const s=game.createState();press(s,'confirm');tick(s,1);
  const original=structuredClone(s);
  for(const [state,rightStick]of [[s,1],[original,-1]]){
   const input=new SportsInput('football'),pad={id:'Test pad',index:0,mapping:'standard',connected:true,axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};
   input.sample(new Set(),[pad]);const n=['receiverA','receiverB','receiverX'].indexOf(button);pad.buttons[n]={pressed:true,value:1};pad.axes[2]=rightStick;
   for(let frame=0;frame<30;frame++)game.step(state,1/60,input.sample(new Set(),[pad]));
   pad.buttons[n]={pressed:false,value:0};pad.axes[2]=0;game.step(state,1/60,input.sample(new Set(),[pad]));
  }
  assert.deepEqual(s.ball,original.ball,'the real adapter right-stick input never changes the pass flight');
  assert.equal(s.controlled,0,'B receiver selection does not switch away from the QB');
  assert.ok(s.ball.flight);throws.push(s.ball.flight);
 }
 assert.deepEqual(throws.map(f=>f.receiver),[1,2,3]);
 assert.ok(throws[1].tx<throws[0].tx);assert.ok(throws[2].tx>10);
});

test('a defender can intercept a misplaced throw and return possession',()=>{
 const s=game.createState();press(s,'confirm');s.carrier=-1;s.thrown=true;
 for(const p of s.players){p.x=20;p.y=-40;}
 s.players[7].x=0;s.players[7].y=0;
 s.ball={x:0,y:-.2,z:1.7,carry:null,flight:{x:0,y:-10,tx:0,ty:0,vx:0,vy:10,vz:-1,elapsed:.99,duration:1,passer:0}};
 game.step(s,1/60,idle());assert.equal(s.offense,1);assert.equal(s.carrier,7);assert.equal(s.intercepted,true);assert.match(s.message,/INTERCEPTION/);
 s.players[7].x=25;game.step(s,1/60,idle());next(s);assert.equal(s.offense,1);assert.equal(s.down,1);
});

test('AI runs routes and pursues on defense, then chooses and executes offensive plays',()=>{
 const s=game.createState();press(s,'confirm');const receiver=s.players[2].y,defender=s.players[11].y;tick(s,.6);
 assert.ok(s.players[2].y>receiver);assert.notEqual(s.players[11].y,defender);
 // Deliberately finish the human series to exercise the opponent's real possession loop.
 const away=game.createState();for(let n=0;n<4;n++){finishRun(away,-30);next(away);}
 assert.equal(away.offense,1);tick(away,5.2);assert.equal(away.phase,'live');
 const positions=away.players.slice(7).map(p=>p.y);tick(away,2.5);
 assert.ok(away.players.slice(7).some((p,i)=>Math.abs(p.y-positions[i])>3));
 assert.ok(away.ball.flight||away.thrown||away.phase==='dead'||away.snapTime>2);
});

test('JSON match snapshots continue exactly including in-flight passes',()=>{
 const s=game.createState();press(s,'confirm');game.step(s,1/60,idle());const i=idle();i.held.pass=true;tick(s,.4,i);game.step(s,1/60,idle());
 assert.ok(s.ball.flight);const restored=JSON.parse(JSON.stringify(s));assert.equal(game.validateState(restored),true);
 for(let frame=0;frame<600;frame++){
  const input=idle();input.move={x:Math.sin(frame*.1),y:-.7};input.pressed.switch=frame%90===0;
  game.step(s,1/60,input);game.step(restored,1/60,input);
 }
 assert.deepEqual(restored,s);
});

test('clock completion produces a final result and rematch creates a fresh game',()=>{
 const s=game.createState();s.time=.01;s.started=true;game.step(s,1/60,idle());assert.equal(s.phase,'finished');assert.equal(game.hud(s).finished,true);
 press(s,'confirm');assert.equal(s.time,600);assert.equal(s.phase,'select');assert.equal(s.frame,0);
});

test('invalid snapshots are rejected',()=>{
 const s=game.createState();s.players[0].x=NaN;assert.throws(()=>game.validateState(s));
 const b=game.createState();b.ball.flight={x:0};assert.throws(()=>game.validateState(b));
});

test('a human-timed downfield pass finds a receiver and earns a first down',()=>{
 const s=game.createState();press(s,'confirm');tick(s,1.5);
 const charge=idle();charge.held.receiverB=true;tick(s,.5,charge);
 const release=idle();release.released.receiverB=true;game.step(s,1/60,release);
 let completion=false;
 for(let frame=0;frame<240&&s.phase==='live';frame++){game.step(s,1/60,idle());completion ||= s.message.startsWith('COMPLETE');}
 assert.equal(completion,true);assert.match(s.message,/FIRST DOWN/);assert.ok(s.next.spot>-20);
});

test('pausing a charged pass cancels it so neutral input on resume never throws',()=>{
 const s=game.createState();press(s,'confirm');game.step(s,1/60,idle());const charge=idle();charge.held.pass=true;tick(s,.3,charge);
 assert.ok(s.charge>0);game.cancelInput(s);game.step(s,1/60,idle());
 assert.equal(s.charge,0);assert.equal(s.charging,false);assert.equal(s.ball.flight,null);assert.equal(s.carrier,0);
});

test('manual defense can select the nearest defender and reach a carrier with a committed tackle',()=>{
 const s=game.createState();for(let n=0;n<4;n++){finishRun(s,-30);next(s);}press(s,'confirm');s.snapTime=1;
 const runner=s.players[s.carrier];
 for(let n=0;n<7;n++){s.players[n].x=20;s.players[n].y=20;}
 s.players[2].x=runner.x;s.players[2].y=runner.y+2.5;
 press(s,'switch');assert.equal(s.controlled,2);assert.equal(s.phase,'live');
 const tackle=idle();tackle.pressed.tackle=true;tackle.held.sprint=true;tackle.move={x:0,y:-1};game.step(s,1/60,tackle);
 assert.equal(s.phase,'live','a tackle cannot teleport across the gap');
 tackle.pressed={};for(let i=0;i<60&&s.phase==='live';i++)game.step(s,1/60,tackle);
 assert.equal(s.phase,'dead');assert.match(s.message,/TACKLED/);
});

test('a bounded complete match terminates with valid state and includes opponent possessions',()=>{
 const s=game.createState();let awayPossession=false;const before=sportsPhysicsObservations();
 for(let frame=0;frame<38000&&s.phase!=='finished';frame++){
  const input=idle();if(s.phase==='select')input.pressed.confirm=true;
  awayPossession ||=s.offense===1;
  game.step(s,1/60,input);
 }
 assert.equal(s.phase,'finished');assert.equal(s.time,0);assert.equal(awayPossession,true);assert.equal(game.validateState(s),true);
 const after=sportsPhysicsObservations();
 for(const key of ['moveChecks','flightChecks','pairChecks','separationChecks'])assert.ok(after[key]>before[key],`live football exercises ${key}`);
});

test('athletes accelerate, preserve momentum through a cut, and brake instead of teleporting velocity',()=>{
 const s=game.createState();press(s,'confirm');
 // Clear a patch so the test measures the locomotion model, not incidental contact.
 for(const p of s.players.slice(1)){p.x=20;p.y=30;}
 const input=idle();input.move={x:1,y:0};input.held.sprint=true;
 game.step(s,1/60,input);assert.ok(s.players[0].vx>0&&s.players[0].vx<1);
 tick(s,.3,input);const forward=s.players[0].vx;assert.ok(forward>4);
 input.move.x=-1;game.step(s,1/60,input);assert.ok(s.players[0].vx>0,'one opposite input frame cannot reverse momentum');
 tick(s,.35,input);assert.ok(s.players[0].vx<0);
 const before=Math.hypot(s.players[0].vx,s.players[0].vy);game.step(s,1/60,idle());
 assert.ok(Math.hypot(s.players[0].vx,s.players[0].vy)>0);assert.ok(Math.hypot(s.players[0].vx,s.players[0].vy)<before);
});

test('directional jukes consume stamina and cannot be spammed or used when exhausted',()=>{
 const s=game.createState();press(s,'confirm');for(const p of s.players.slice(1)){p.x=20;p.y=30;}
 const input=idle();input.pressed.skill=true;input.move={x:1,y:-.3};game.step(s,1/60,input);
 assert.ok(s.players[0].jukeTime>0);assert.ok(s.players[0].jukeCooldown>.8);assert.ok(s.players[0].stamina<.75);
 const spent=s.players[0].stamina;game.step(s,1/60,input);assert.ok(s.players[0].stamina>=spent,'held repeats do not spend another juke');
 s.players[0].jukeCooldown=0;s.players[0].jukeTime=0;s.players[0].stamina=.1;game.step(s,1/60,input);assert.equal(s.players[0].jukeTime,0);
});

test('protecting the ball trades running speed for contact resistance',()=>{
 const open=game.createState();press(open,'confirm');for(const p of open.players.slice(1)){p.x=20;p.y=30;}
 const protectedRun=structuredClone(open);const fast=idle();fast.move={x:0,y:-1};fast.held.sprint=true;
 const shield=structuredClone(fast);shield.held.shield=true;
 tick(open,.4,fast);tick(protectedRun,.4,shield);
 assert.ok(open.players[0].vy>protectedRun.players[0].vy);assert.equal(protectedRun.players[0].protect,true);
 const contact = protectedBall => {
  const s=game.createState();press(s,'confirm');s.snapTime=1;
  for(const p of s.players.slice(1)){p.x=20;p.y=30;}
  s.players[7].x=.8;s.players[7].y=s.players[0].y;
  const input=idle();input.held.shield=protectedBall;game.step(s,1/60,input);return s.players[0].balance;
 };
 assert.ok(contact(true)>contact(false),'shield reduces the damage of the same contact');
});

test('ballistic flight changes vertical velocity under gravity and catches only by physical contact',()=>{
 const s=game.createState();press(s,'confirm');game.step(s,1/60,idle());
 const input=idle();input.held.pass=true;input.aim={x:.6,y:-.8};tick(s,.7,input);game.step(s,1/60,idle());
 assert.ok(s.ball.flight);const before=structuredClone(s.ball);game.step(s,1/60,idle());
 assert.ok(s.ball.flight.vz<before.flight.vz);assert.ok(Math.hypot(s.ball.x-before.x,s.ball.y-before.y)<1);
 const near=game.createState();press(near,'confirm');near.carrier=-1;near.thrown=true;
 for(const p of near.players){p.x=20;p.y=30;}
 near.players[1].x=1.8;near.players[1].y=0;
 near.ball={x:0,y:0,z:1.7,carry:null,flight:{x:0,y:-10,tx:0,ty:0,vx:0,vy:0,vz:-1,elapsed:1,duration:1,passer:0}};
 game.step(near,1/60,idle());assert.equal(near.carrier,-1,'a receiver 1.8 yards away cannot magnetically catch');
});

test('collision response transfers momentum and player displacement stays bounded',()=>{
 const s=game.createState();press(s,'confirm');s.snapTime=.2;
 for(const p of s.players.slice(1)){p.x=20;p.y=30;}
 s.players[0].vx=8;s.players[4].x=.9;s.players[4].y=s.players[0].y;s.players[4].vx=0;
 const prior=s.players.map(p=>({x:p.x,y:p.y}));game.step(s,1/60,idle());
 assert.ok(s.players[4].vx>0,'a contacted stationary teammate receives momentum');assert.ok(s.players[0].vx<8);
 for(const [i,p]of s.players.entries())assert.ok(Math.hypot(p.x-prior[i].x,p.y-prior[i].y)<=14/60+.001);
});

function openDuel() {
 const s=game.createState();press(s,'confirm');s.thrown=true;s.snapTime=2;s.line=-10;s.target=10;
 for(const p of s.players){p.x=20;p.y=-30;p.vx=0;p.vy=0;}
 Object.assign(s.players[0],{x:0,y:0,vy:8});
 Object.assign(s.players[7],{x:.5,y:3,vy:-8,diveX:0,diveY:-1,diveTime:.27,diveCooldown:1.25});
 return s;
}

test('a timed lateral juke beats the same committed tackle that stops a straight run',()=>{
 const straight=openDuel(),cut=structuredClone(straight);
 for(let frame=0;frame<45;frame++){
  const run=idle();run.move={x:0,y:-1};
  if(straight.phase==='live')game.step(straight,1/60,run);
  const juke=idle();juke.move={x:frame<15?-1:0,y:-1};juke.pressed.skill=frame===0;
  if(cut.phase==='live')game.step(cut,1/60,juke);
 }
 assert.equal(straight.phase,'dead');assert.equal(cut.phase,'live');
 assert.ok(cut.players[0].y>straight.players[0].y+3);assert.ok(cut.players[0].stamina<straight.players[0].stamina);
});

test('a spin beats a glancing contact but cannot erase a head-on dive',()=>{
 const headOn=openDuel(),flank=openDuel();flank.players[0].vy=0;
 Object.assign(flank.players[7],{x:1.5,y:.1,vx:-2,vy:0,diveTime:0,diveCooldown:1});
 for(const s of [headOn,flank]){
  press(s,'spin');for(let n=0;n<25&&s.phase==='live';n++)game.step(s,1/60,idle());
 }
 assert.equal(flank.players[0].moveWon,true);assert.equal(flank.phase,'live');
 assert.equal(headOn.phase,'dead');assert.equal(headOn.players[0].moveWon,false);
});

test('the stiff arm rewards facing the contact and fails against a hit from behind',()=>{
 const contact = y => {
  const s=openDuel();s.players[0].vy=0;Object.assign(s.players[7],{x:0,y,vy:y>0?-2:2,diveTime:0});
  const input=idle();input.held.shield=true;input.pressed.stiffArm=true;game.step(s,1/60,input);return s;
 };
 const front=contact(1.2),rear=contact(-1.2);
 assert.equal(front.players[0].moveWon,true);assert.ok(front.players[7].stun>0);assert.equal(front.feedback.kind,'skill');
 assert.equal(rear.players[0].moveWon,false);assert.equal(rear.players[7].stun,0);
});

test('a missed defensive lunge locks direction then requires recovery instead of homing',()=>{
 const s=openDuel();s.offense=1;s.carrier=7;
 Object.assign(s.players[0],{x:0,y:0,vy:0});Object.assign(s.players[7],{x:0,y:-8,vy:0,diveTime:0});
 const dive=idle();dive.move={x:0,y:-1};dive.pressed.tackle=true;game.step(s,1/60,dive);
 const reverse=idle();reverse.move={x:1,y:1};game.step(s,1/60,reverse);
 assert.ok(s.players[0].wishY<0);assert.ok(Math.abs(s.players[0].wishX)<.001);
 tick(s,.3,reverse);assert.ok(s.players[0].recover>0);assert.ok(Math.abs(s.players[0].wishX)<.001);
});

test('Sweep transfers the ball on real contact and automatically gives control to the running back',()=>{
 const s=game.createState();s.play=2;press(s,'confirm');
 assert.equal(s.carrier,0);assert.equal(s.handoffPending,true);
 let frames=0;
 while(s.carrier===0&&frames++<90){game.step(s,1/60,idle());}
 assert.equal(s.carrier,1);assert.equal(s.controlled,1);assert.ok(frames>10&&frames<45);
 assert.ok(Math.hypot(s.players[0].x-s.players[1].x,s.players[0].y-s.players[1].y)<1.45);
 assert.equal(s.ball.flight,null);assert.ok(s.ball.carry);assert.equal(s.feedback.kind,'pass');
});

test('a quick receiver tap captured between simulation ticks launches a lob',()=>{
 const s=game.createState();press(s,'confirm');game.step(s,1/60,idle());
 const tap=idle();tap.pressed.receiverA=true;tap.released.receiverA=true;game.step(s,1/60,tap);
 assert.equal(s.carrier,-1);assert.ok(s.ball.flight);assert.equal(s.ball.flight.type,'LOB');assert.equal(s.ball.flight.receiver,1);
});

test('the first playbook waits for the player without using match time',()=>{
 const s=game.createState();tick(s,8);assert.equal(s.time,600);assert.equal(s.started,false);
 press(s,'confirm');tick(s,1);assert.ok(s.time<600);assert.equal(s.started,true);
});

test('schema2 saves migrate the new skill fields while retaining the match and momentum',()=>{
 const s=game.createState();s.schema=2;s.time=432;s.score=[8,6];s.players[0].vx=3;s.players[0].y=-22;
 for(const p of s.players)for(const key of ['spinTime','stiffTime','stiffCooldown','diveTime','diveCooldown','diveX','diveY','diveHit','recover','facingX','facingY','moveWon'])delete p[key];
 delete s.started;delete s.handoffPending;delete s.handoffTime;delete s.playNumber;
 game.validateState(s);assert.equal(s.schema,5);assert.equal(s.time,432);assert.deepEqual(s.score,[8,6]);
 assert.equal(s.players[0].vx,3);assert.equal(s.players[0].y,-22);assert.equal(s.players[0].spinTime,0);assert.equal(s.started,true);
});

test('receiver B bullet passes complete across a readable route-development window',()=>{
 for(const delay of [.8,1,1.2,1.4,1.6,1.8,2]){
  const s=game.createState();press(s,'confirm');tick(s,delay);
  const charge=idle();charge.held.receiverB=true;tick(s,.5,charge);game.step(s,1/60,idle());
  let caught=false;
  for(let frame=0;frame<300&&s.phase==='live';frame++){game.step(s,1/60,idle());caught ||=s.message.startsWith('COMPLETE');}
  assert.equal(caught,true,`charge beginning ${delay}s after the snap should find the receiver`);
 }
});

test('interception camera immediately faces the new attacking end while field tracking remains smooth',async()=>{
 const THREE=await import('three');
 const body=()=>new THREE.Object3D();
 const ring=()=>new THREE.Mesh(new THREE.RingGeometry(1,1.2,8),new THREE.MeshBasicMaterial());
 const s=game.createState();s.phase='dead';s.line=0;s.ball.y=0;s.ball.x=0;
 const view={THREE,players:s.players.map(()=>({group:body(),legs:[body(),body()],arms:[body(),body()],receiverRing:ring()})),ball:body(),ring:ring(),pointer:body(),scrimmage:body(),firstDown:body(),target:body(),trajectory:body(),routes:[body(),body(),body()],focus:0,cameraDirection:1};
 const camera=new THREE.PerspectiveCamera(49,16/9,.1,350);camera.position.set(0,37,35);
 game.render({state:s,view,camera,dt:1/120});
 const screenDirection = attackingDirection => {
  camera.updateMatrixWorld();
  const center=new THREE.Vector3(0,0,view.focus).project(camera);
  const forward=new THREE.Vector3(0,0,view.focus-attackingDirection*3).project(camera);
  return forward.y-center.y;
 };
 assert.ok(camera.position.z>view.focus);assert.ok(screenDirection(1)>0);
 // Interception six yards downfield: follow position must not jump to the new ball,
 // but the orbit must change sides on this very render frame.
 s.offense=1;s.ball.y=6;
 game.render({state:s,view,camera,dt:1/120});
 assert.ok(camera.position.z<view.focus);assert.ok(screenDirection(-1)>0,'up maps up immediately after interception');
 assert.ok(view.focus>-.2&&view.focus<0,'tracking still eases toward the ball');
 const previousZ=camera.position.z;s.ball.y=10;
 game.render({state:s,view,camera,dt:1/120});
 assert.ok(Math.abs(camera.position.z-previousZ)<1,'same-possession follow is still smooth');
 s.offense=0;game.render({state:s,view,camera,dt:1/120});
 assert.ok(camera.position.z>view.focus);assert.ok(screenDirection(1)>0);
 for(const p of view.players){p.receiverRing.geometry.dispose();p.receiverRing.material.dispose();}
 view.ring.geometry.dispose();view.ring.material.dispose();
});

test('receiver hold duration chooses a real lob, touch, or bullet trajectory',()=>{
 const flights=[];
 for(const hold of [.05,.27,.5]){
  const s=game.createState();press(s,'confirm');tick(s,.8);
  const input=idle();input.held.receiverB=true;tick(s,hold,input);
  assert.equal(game.hud(s).selectedReceiver,'B');
  game.step(s,1/60,idle());flights.push(s.ball.flight);
 }
 assert.deepEqual(flights.map(f=>f.type),['LOB','TOUCH','BULLET']);
 assert.ok(flights[0].duration>flights[1].duration&&flights[1].duration>flights[2].duration);
 assert.ok(flights[0].vz>flights[1].vz&&flights[1].vz>flights[2].vz);
 assert.ok(Math.hypot(flights[2].vx,flights[2].vy)>Math.hypot(flights[0].vx,flights[0].vy));
});

test('LS lead is bounded around the chosen receiver prediction, not free aiming',()=>{
 const s=game.createState();press(s,'confirm');tick(s,1);
 const charge=idle();charge.held.receiverX=true;tick(s,.5,charge);
 const left=structuredClone(s),right=structuredClone(s),neutral=structuredClone(s);
 const release=idle();release.move={x:1,y:0};release.aim={...release.move};game.step(right,1/60,release);
 release.move.x=-1;release.aim={...release.move};game.step(left,1/60,release);game.step(neutral,1/60,idle());
 assert.ok(Math.abs(right.ball.flight.tx-neutral.ball.flight.tx-2.1)<1e-9);
 assert.ok(Math.abs(neutral.ball.flight.tx-left.ball.flight.tx-2.1)<1e-9);
 assert.equal(right.ball.flight.ty,left.ball.flight.ty);
 assert.equal(right.ball.flight.receiver,3);
});

test('voice capture cancels a held receiver B pass without a fallback release throw',()=>{
 const s=game.createState();press(s,'confirm');tick(s,.8);
 const charge=idle();charge.held.receiverB=true;charge.held.spin=true;tick(s,.25,charge);
 assert.equal(s.receiverButton,'receiverB');
 const cancel=idle();cancel.cancelled={receiverB:true};game.step(s,1/60,cancel);
 assert.equal(s.ball.flight,null);assert.equal(s.charging,false);assert.equal(s.receiverButton,null);
 tick(s,.1);assert.equal(s.ball.flight,null);assert.equal(s.carrier,0);
});

test('resume requires the held receiver button to return neutral before it can charge again',()=>{
 const s=game.createState();press(s,'confirm');tick(s,.8);
 const charge=idle();charge.held.receiverX=true;tick(s,.2,charge);game.cancelInput(s);
 tick(s,.2,charge);assert.equal(s.charging,false);assert.equal(s.receiverButton,null);
 game.step(s,1/60,idle());tick(s,.2,charge);assert.equal(s.receiverButton,'receiverX');
 game.step(s,1/60,idle());assert.equal(s.ball.flight.type,'TOUCH');
});

test('B spins after a catch without switching, and A stiff-arms without starting another throw',()=>{
 const s=openDuel();s.carrier=2;s.controlled=2;Object.assign(s.players[2],{x:-10,y:0});
 const spin=idle();spin.pressed={receiverB:true,spin:true,switch:true};spin.held={receiverB:true,spin:true};
 game.step(s,1/60,spin);assert.equal(s.controlled,2);assert.ok(s.players[2].spinTime>0);assert.equal(s.charging,false);
 const arm=idle();arm.pressed={receiverA:true,pass:true,stiffArm:true,conservativeTackle:true};arm.held={receiverA:true};
 game.step(s,1/60,arm);assert.ok(s.players[2].stiffTime>0);assert.equal(s.ball.flight,null);assert.equal(s.receiverButton,null);
});

test('A on defense wraps without a lunge; X dives, and LT strafe keeps facing the carrier',()=>{
 const s=openDuel();s.offense=1;s.carrier=7;
 Object.assign(s.players[0],{x:0,y:0,vx:0,vy:0});Object.assign(s.players[7],{x:0,y:-7,vy:0,diveTime:0});
 const dive=structuredClone(s),wrap=idle();wrap.pressed={receiverA:true,pass:true,conservativeTackle:true};wrap.held.strafe=true;wrap.move={x:1,y:0};
 game.step(s,1/60,wrap);assert.ok(s.players[0].wrapTime>0);assert.equal(s.players[0].diveTime,0);assert.equal(s.players[0].strafe,true);assert.ok(s.players[0].facingY<0);
 const lunge=idle();lunge.pressed={receiverX:true,shoot:true,tackle:true};game.step(dive,1/60,lunge);assert.ok(dive.players[0].diveTime>0);assert.equal(dive.charging,false);
});

test('a covered early receiver bullet can still be physically intercepted',()=>{
 const s=game.createState();press(s,'confirm');tick(s,.4);
 const charge=idle();charge.held.receiverB=true;tick(s,.5,charge);game.step(s,1/60,idle());
 for(let n=0;n<150&&s.carrier<0&&s.phase==='live';n++)game.step(s,1/60,idle());
 assert.equal(s.intercepted,true);assert.equal(s.offense,1);assert.equal(s.carrier,9);
});

test('schema 4 migration preserves an airborne pass but cancels obsolete manual charging',()=>{
 const s=game.createState();press(s,'confirm');tick(s,1);const charge=idle();charge.held.receiverB=true;tick(s,.5,charge);game.step(s,1/60,idle());
 const flight=structuredClone(s.ball.flight);s.schema=4;s.charging=true;s.charge=.8;delete s.receiverButton;delete s.receiverReady;delete s.throwHold;
 for(const p of s.players){delete p.wrapTime;delete p.strafe;}
 game.validateState(s);assert.equal(s.schema,5);assert.equal(s.charging,false);assert.equal(s.receiverButton,null);assert.deepEqual(s.ball.flight,flight);
});

test('selected receiver and hold duration resume deterministically from a saved charged pass',()=>{
 const s=game.createState();press(s,'confirm');tick(s,1);const charge=idle();charge.held.receiverX=true;tick(s,.2,charge);
 const restored=JSON.parse(JSON.stringify(s));game.validateState(restored);
 tick(s,.3,charge);tick(restored,.3,charge);game.step(s,1/60,idle());game.step(restored,1/60,idle());
 assert.deepEqual(restored,s);assert.equal(s.ball.flight.type,'BULLET');assert.equal(s.ball.flight.receiver,3);
});


test('a receiver tap between 120Hz render frames preserves its LS lead at the fixed tick',()=>{
 const s=game.createState();press(s,'confirm');tick(s,.8);const neutral=structuredClone(s);
 const down=idle();down.pressed.receiverX=true;down.held.receiverX=true;down.aim={x:1,y:0};down.move={x:1,y:0};
 const up=idle();up.released.receiverX=true;
 game.step(s,1/60,mergePendingInput(up,down));
 const tap=idle();tap.pressed.receiverX=true;tap.released.receiverX=true;game.step(neutral,1/60,tap);
 assert.equal(s.ball.flight.type,'LOB');assert.ok(Math.abs(s.ball.flight.tx-neutral.ball.flight.tx-2.1)<1e-9);
 assert.equal(s.players[0].vx,0,'buffered lead does not keep moving the QB after the stick returned neutral');
});


test('a same-tick face-button pass cannot fall through into its defensive action alias',()=>{
 for(const n of [0,1,2]){
  const input=new SportsInput('football'),pad={id:'Test pad',index:0,mapping:'standard',connected:true,axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};
  input.sample(new Set(),[pad]);const s=game.createState();press(s,'confirm');tick(s,.8);
  pad.buttons[n]={pressed:true,value:1};const down=input.sample(new Set(),[pad]);
  pad.buttons[n]={pressed:false,value:0};const up=input.sample(new Set(),[pad]);game.step(s,1/60,mergePendingInput(up,down));
  assert.equal(s.ball.flight.receiver,n+1);assert.equal(s.controlled,0);assert.equal(s.players[0].diveTime,0);assert.equal(s.players[0].wrapTime,0);assert.equal(s.tackleWindow,0);
 }
});
