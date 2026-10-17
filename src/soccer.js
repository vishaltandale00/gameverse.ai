// Alder Five: an original, deterministic arcade soccer simulation. World x is
// the goal-to-goal axis; world z (input y) is the touchline axis.
import { certifySportsMove, stepSportsBall, certifySportsCollision, certifySportsPairCollision } from './sports-physics.js';
import { random } from './sports-league.js';

const HALF_X = 28, HALF_Z = 17, GOAL = 4.3, MATCH_SECONDS = 600;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const direction = (x, z) => { const length = Math.hypot(x, z); return length > 0.001 ? { x: x / length, z: z / length } : { x: 1, z: 0 }; };
const attack = team => team === 0 ? 1 : -1;
const playerDepth = { skillType:'none', skillDuration:0.42, comboTime:0, burst:0, runTime:0, kickTime:0, saveTime:0, jockey:false };
const positions = [[-25, 0], [-12, -8], [-12, 8], [-5, -6], [-5, 6]];

function resetPlayers(s) {
  s.players.forEach(p => {
    const side = attack(p.team), position = positions[p.id % 5];
    p.x = position[0] * side; p.z = position[1]; p.vx = p.vz = 0;
    p.fx = side; p.fz = 0; p.tackle = 0; p.cooldown = 0; p.think = 0; p.shield = false; p.skillTime = 0; p.skillCooldown = 0; p.skillX = 0; p.skillZ = 0; Object.assign(p,playerDepth);
  });
}
function createState() {
  const state = {
    version: 3, sport: 'soccer', frame: 0, phase: 'ready', clock: MATCH_SECONDS,
    score: [0, 0], active: 3, charge: 0, charging: null, passReady: true, shootReady:true, possessionAge: 0,
    feedback:{id:0,kind:'catch',strength:0}, delivery:'normal', pending:null, blockedActions:[], message: 'ALDER FIVE', messageTime: 0, restart: null, phaseTime: 0,
    players: Array.from({ length: 10 }, (_, id) => ({ id, team: id < 5 ? 0 : 1, keeper: id % 5 === 0,
      x: 0, z: 0, vx: 0, vz: 0, fx: 1, fz: 0, tackle: 0, cooldown: 0, think: 0, stamina: 1, shield: false, skillTime: 0, skillCooldown: 0, skillX: 0, skillZ: 0, ...playerDepth })),
    ball: { x: -4, z: -6, y: 0.32, vx: 0, vz: 0, vy: 0, owner: 3, lastTouch: 0, kicker: -1, lock: 0, spin: 0, touch: 0 },
    stats: { shots: [0, 0], passes: [0, 0], tackles: [0, 0], saves: [0, 0] },
  };
  resetPlayers(state); return state;
}
function validateState(s) {
  if(s?.version===2){s.version=3;s.feedback={id:0,kind:'catch',strength:0};s.delivery='normal';s.pending=null;s.shootReady=true;if(Array.isArray(s.players))s.players.forEach(p=>Object.assign(p,playerDepth));}
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  if (!s || s.version !== 3 || s.sport !== 'soccer' || !['ready', 'play', 'restart', 'goal', 'finished'].includes(s.phase)
    || !Number.isInteger(s.frame) || s.frame < 0 || !finite(s.clock) || s.clock < 0 || s.clock > MATCH_SECONDS
    || !Array.isArray(s.score) || s.score.length !== 2 || !s.score.every(n => Number.isInteger(n) && n >= 0)
    || !Number.isInteger(s.active) || s.active < 0 || s.active > 4
    || !Array.isArray(s.players) || s.players.length !== 10 || !s.ball
    || !finite(s.charge) || !finite(s.possessionAge) || !finite(s.phaseTime) || !finite(s.messageTime)
    || ![null, 'pass', 'shoot', 'through', 'lob'].includes(s.charging) || typeof s.passReady !== 'boolean' || typeof s.shootReady !== 'boolean') throw new Error('Invalid Alder Five match');
  for (const [i, p] of s.players.entries()) {
    if (p.id !== i || p.team !== (i < 5 ? 0 : 1) || p.keeper !== (i % 5 === 0) || typeof p.shield !== 'boolean'
      || !['x', 'z', 'vx', 'vz', 'fx', 'fz', 'tackle', 'cooldown', 'think', 'stamina', 'skillTime', 'skillCooldown', 'skillX', 'skillZ', 'skillDuration', 'comboTime', 'burst', 'runTime', 'kickTime', 'saveTime'].every(k => finite(p[k]))) throw new Error('Invalid soccer athlete');
  }
  if (!['x', 'z', 'y', 'vx', 'vz', 'vy', 'lock', 'spin', 'touch'].every(k => finite(s.ball[k]))
    || !Number.isInteger(s.ball.owner) || s.ball.owner < -1 || s.ball.owner > 9
    || ![0, 1].includes(s.ball.lastTouch) || !Number.isInteger(s.ball.kicker) || s.ball.kicker < -1 || s.ball.kicker > 9) throw new Error('Invalid soccer ball');
  if (!s.stats || !['shots', 'passes', 'tackles', 'saves'].every(k => Array.isArray(s.stats[k]) && s.stats[k].length === 2 && s.stats[k].every(n => Number.isInteger(n) && n >= 0))) throw new Error('Invalid soccer stats');
  if (s.phase === 'restart' && (!s.restart || ![0, 1].includes(s.restart.team) || !['Kickoff', 'Throw-in', 'Corner', 'Goal kick'].includes(s.restart.type)
    || !['x', 'z', 'time'].every(k => finite(s.restart[k])) || (s.restart.confirmQueued !== undefined && typeof s.restart.confirmQueued !== 'boolean') || !Number.isInteger(s.restart.taker) || s.restart.taker < 0 || s.restart.taker > 9 || s.players[s.restart.taker].team !== s.restart.team)) throw new Error('Invalid soccer restart');
  if (s.phase === 'goal' && (!s.restart || ![0, 1].includes(s.restart.team))) throw new Error('Invalid soccer goal restart');
  if(s.blockedActions!==undefined&&(!Array.isArray(s.blockedActions)||!s.blockedActions.every(k=>['shoot','lob'].includes(k))))throw new Error('Invalid soccer action gate');
  if(!['normal','finesse','through','loft','driven'].includes(s.delivery)||!s.feedback||!Number.isInteger(s.feedback.id)||!finite(s.feedback.strength))throw new Error('Invalid soccer action state');
  if(s.pending&&(!['pass','shoot','through','lob'].includes(s.pending.kind)||!['time','x','z'].every(k=>finite(s.pending[k]))))throw new Error('Invalid soccer buffered action');
  return true;
}
function signal(s,kind,strength=0.5){s.feedback={id:(s.feedback?.id||0)+1,kind,strength:clamp(strength,0,1)};}
function say(s, message, seconds = 2.4) { s.message = message; s.messageTime = seconds; }
function takeBall(s, p) {
  s.ball.owner = p.id; s.ball.lastTouch = p.team; s.ball.vx = p.vx; s.ball.vz = p.vz; s.ball.vy = 0; s.ball.spin = 0; s.ball.touch = 0;
  s.possessionAge = 0; p.think=0; signal(s,'catch',0.24);
  if (p.team === 0 && !p.keeper) s.active = p.id;
  s.charge = 0; s.charging = null;
}
function kick(s, p, type, power, aim, finesse = false, style = 'normal') {
  const d = direction(aim.x, aim.z), speed = (type === 'shoot' ? 18 + power * 19 : 10 + power * 16) * (finesse ? 0.84 : style==='through'||style==='driven'?1.22:style==='loft'?0.84:1);
  const b = s.ball;
  b.owner = -1; b.x = p.x + d.x * 1.05; b.z = p.z + d.z * 1.05; b.y = 0.35;
  b.vx = d.x * speed; b.vz = d.z * speed; b.vy = type === 'shoot' ? 2.2 + power * 3.2 : 0.8 + power * 1.3;
  if(style==='loft')b.vy=5.2+power*4.2;
  if(style==='through')b.vy=0.35;
  p.kickTime=0.28;signal(s,type==='shoot'?'kick':'pass',0.35+power*0.6);
  if(style==='through')say(s,'THROUGH BALL · RUN INTO SPACE',1.4);
  if(style==='loft')say(s,'LOFTED SERVICE',1.4);
  b.spin = finesse ? -Math.sign(p.z || d.z || 1) * attack(p.team) * (0.32 + power * 0.18) : 0;
  if (finesse) say(s, 'FINESSE · CURLING SHOT', 1.5);
  p.skillTime = 0;
  b.lastTouch = p.team; b.kicker = p.id; b.lock = 0.32; s.possessionAge = 0; s.charge = 0; s.charging = null;
  s.stats[type === 'shoot' ? 'shots' : 'passes'][p.team]++;
}
// Left-stick assistance chooses an intended receiver inside a forward cone.
// Power selects nearby versus distant teammates; the resulting kick still uses
// the same free ball physics and can be intercepted or overhit.
function humanKick(s,p,action,power,aim,modifier=false,style='normal') {
  const d=direction(aim.x,aim.z), isShot=action==='shoot';
  if(!isShot){
    const desired=7+power*27;
    const candidates=s.players.filter(q=>q.team===p.team&&q.id!==p.id).map(q=>{
      const distance=dist(q,p), alignment=((q.x-p.x)*d.x+(q.z-p.z)*d.z)/Math.max(distance,.01);
      return {q,distance,alignment,rank:alignment*9-Math.abs(distance-desired)*.22+(action==='through'&&q.runTime>0?1.2:0)};
    }).filter(c=>c.alignment>.42&&c.distance>1.6&&c.distance<38).sort((a,b)=>b.rank-a.rank||a.q.id-b.q.id);
    const target=candidates[0]?.q;
    if(target){
      const time=clamp(dist(target,p)/(12+power*16),.15,1.1);
      const lead=action==='through'?2.3+power*4.5:0;
      const x=clamp(target.x+target.vx*time*.65+attack(p.team)*lead,-27,27);
      const z=clamp(target.z+target.vz*time*.65,-16,16);
      kick(s,p,'pass',power,{x:x-p.x,z:z-p.z},false,style);
    }else kick(s,p,'pass',power,d,false,style);
    return;
  }
  const goalX=attack(p.team)*HALF_X, toward=direction(goalX-p.x,-p.z);
  // Deliberately facing away remains a clearance. Otherwise LS chooses the
  // side of goal, rather than requiring a precise world-space shooting ray.
  if(d.x*toward.x+d.z*toward.z<-.25){kick(s,p,'shoot',power,d,modifier);return;}
  const pressure=Math.max(0,2.6-Math.min(...s.players.filter(q=>q.team!==p.team&&!q.keeper).map(q=>dist(p,q))));
  const error=Math.sin(s.frame*1.73+p.id*2.1)*(pressure*.72+(1-p.stamina)*.38+Math.max(0,power-.78)*17);
  const goalZ=clamp(d.z*4+p.z*.1,-3.75,3.75)+error;
  let shot=direction(goalX-p.x,goalZ-p.z);
  if(modifier){
    const spin=-Math.sign(p.z||shot.z||1)*attack(p.team)*(.32+power*.18);
    const travel=Math.abs(goalX-p.x)/Math.max(8,(18+power*19)*.84*Math.abs(shot.x));
    const angle=-spin*travel*.38,cos=Math.cos(angle),sin=Math.sin(angle);
    shot={x:shot.x*cos-shot.z*sin,z:shot.x*sin+shot.z*cos};
  }
  kick(s,p,'shoot',power,shot,modifier);
}
function restart(s, type, team, x, z) {
  s.phase = 'restart'; s.restart = { type, team, x, z, time: 0, confirmQueued: false };
  s.ball.owner = -1; s.ball.x = x; s.ball.z = z; s.ball.y = 0.32; s.ball.vx = s.ball.vz = s.ball.vy = s.ball.spin = 0;
  s.players.forEach(p => {p.vx = p.vz = 0; p.skillTime = 0; p.shield = false;});
  s.charging = null; s.charge = 0; say(s, `${type.toUpperCase()} · ${team === 0 ? 'ALDER' : 'EMBER'}`, 5);
  if (type === 'Kickoff') resetPlayers(s);
  const candidates = s.players.filter(p => p.team === team && (type === 'Goal kick' ? p.keeper : !p.keeper));
  const taker = candidates.sort((a, b) => dist(a, s.ball) - dist(b, s.ball))[0];
  taker.x = x; taker.z = z; taker.fx = attack(team); taker.fz = z === 0 ? 0 : -Math.sign(z) * 0.5;
  if (team === 0) s.active = taker.id;
  // Give the restart taker space; the rules never trap a ball outside the field.
  s.players.filter(p => p.id !== taker.id && dist(p, taker) < 4).forEach(p => { p.x = clamp(p.x - attack(team) * 4, -27, 27); p.z = clamp(p.z + (p.id % 2 ? 4 : -4), -16, 16); });
  // Clamping a restart push at a touchline can put two athletes in the same
  // place. Place each athlete against already occupied restart spots.
  const placed=[taker];
  for(const athlete of s.players.filter(p=>p.id!==taker.id)){
    const original={x:athlete.x,z:athlete.z};let found=false;
    for(let radius=0;radius<=6&&!found;radius+=1.2)for(let turn=0;turn<16&&!found;turn++){
      const angle=(turn+athlete.id*.37)*Math.PI/8,candidate={x:clamp(original.x+Math.cos(angle)*radius,-27,27),z:clamp(original.z+Math.sin(angle)*radius,-16,16)};
      if(placed.every(other=>dist(candidate,other)>=1.1)){athlete.x=candidate.x;athlete.z=candidate.z;found=true;}
    }
    placed.push(athlete);
  }
  s.restart.taker = taker.id;
}
function resumeRestart(s) {
  const r = s.restart, p = s.players[r.taker];
  s.phase = 'play'; takeBall(s, p); s.restart = null; say(s, r.type === 'Kickoff' ? 'PLAY ON' : `${r.type.toUpperCase()} · PLAY ON`, 1.3);
  if ((r.team === 1 && r.type !== 'Kickoff') || p.keeper) {
    const teammate = s.players.filter(q => q.team === p.team && !q.keeper && q.id !== p.id).sort((a, b) => dist(a, p) - dist(b, p))[0];
    kick(s, p, 'pass', 0.48, direction(teammate.x - p.x, teammate.z - p.z));
    if (p.team === 0 && p.keeper) s.active = teammate.id;
  }
}
function move(p, targetX, targetZ, speed, dt) {
  const dx = targetX - p.x, dz = targetZ - p.z, distance = Math.hypot(dx, dz);
  const desiredSpeed = Math.min(speed, distance / dt), d = direction(dx, dz);
  // A failed tackle commits the athlete to a short lunge, then recovery.
  const recovering = p.cooldown > 0.35 && p.tackle <= 0;
  const targetVX = distance > 0.001 ? d.x * desiredSpeed * (recovering ? 0.35 : 1) : 0;
  const targetVZ = distance > 0.001 ? d.z * desiredSpeed * (recovering ? 0.35 : 1) : 0;
  const reversing = p.vx*targetVX+p.vz*targetVZ<0;
  const acceleration = distance < 0.001 ? 33 : p.burst>0 ? 40 : p.shield||p.jockey ? 35 : reversing ? 32 : 27;
  const deltaX = targetVX - p.vx, deltaZ = targetVZ - p.vz, change = Math.hypot(deltaX, deltaZ);
  const amount = Math.min(1, acceleration * dt / Math.max(change, 0.00001));
  p.vx += deltaX * amount; p.vz += deltaZ * amount;
  if (p.skillType==='dragback'&&p.skillTime>0.2){p.vx*=Math.exp(-dt*8);p.vz*=Math.exp(-dt*8);}
  if (p.tackle > 0.1) { p.vx = p.fx * 7.4; p.vz = p.fz * 7.4; }
  const next = {x:p.x+p.vx*dt,z:p.z+p.vz*dt}; // The completed move, including separation, is certified below.
  p.x = clamp(next.x, -HALF_X + 0.4, HALF_X - 0.4); p.z = clamp(next.z, -HALF_Z + 0.4, HALF_Z - 0.4);
  if (p.x !== next.x) p.vx = 0; if (p.z !== next.z) p.vz = 0;
  if (Math.hypot(p.vx,p.vz)>0.3 && !p.shield && !p.jockey) { const facing=direction(p.vx,p.vz);p.fx=facing.x;p.fz=facing.z; }
}
// Sweeps are collision proposals. Final rebounds pass the shared energy guard.
function sweepCircle(from, to, center, radius) {
  const dx=to.x-from.x,dz=to.z-from.z,ox=from.x-center.x,oz=from.z-center.z;
  const c=ox*ox+oz*oz-radius*radius,a=dx*dx+dz*dz;
  if(c<=0) return {t:0,normal:direction(ox,oz)};
  if(a<1e-12)return null;
  const b=2*(ox*dx+oz*dz),disc=b*b-4*a*c;if(disc<0)return null;
  const t=(-b-Math.sqrt(disc))/(2*a);if(t<0||t>1)return null;
  return {t,normal:direction(ox+dx*t,oz+dz*t)};
}
function rebound(ball, normal, restitution) {
  const dot=ball.vx*normal.x+ball.vz*normal.z;
  if(dot>=0)return;
  const next=certifySportsCollision({x:ball.vx,y:ball.vy,z:ball.vz},{x:(ball.vx-2*dot*normal.x)*restitution,y:ball.vy*restitution,z:(ball.vz-2*dot*normal.z)*restitution});
  ball.vx=next.x;ball.vy=next.y;ball.vz=next.z;ball.spin*=0.45;
}
function resolveFlight(s, previous) {
  const b=s.ball, end={x:b.x,z:b.z}, impacts=[];
  for(const x of [-28.1,28.1])for(const z of [-GOAL,GOAL]){
    const hit=sweepCircle(previous,end,{x,z},0.42);
    if(hit && previous.y+(b.y-previous.y)*hit.t<3.3) impacts.push({...hit,post:true});
  }
  for(const x of [-28.1,28.1]){
    const hit=sweepCircle({x:previous.x,z:previous.y},{x:b.x,z:b.y},{x,z:3},0.42);
    if(hit && Math.abs(previous.z+(b.z-previous.z)*hit.t)<GOAL+0.1)impacts.push({...hit,crossbar:true});
  }
  for(const p of s.players){
    if(p.id===b.kicker&&b.lock>0)continue;
    const hit=sweepCircle(previous,end,p,p.keeper?1.25:p.jockey?1.08:0.88);
    if(hit && previous.y+(b.y-previous.y)*hit.t<(p.keeper?2.8:1.7))impacts.push({...hit,player:p});
  }
  impacts.sort((a,c)=>a.t-c.t);const hit=impacts[0];if(!hit)return;
  b.x=previous.x+(end.x-previous.x)*hit.t; b.z=previous.z+(end.z-previous.z)*hit.t;
  if(hit.crossbar){
    const dot=b.vx*hit.normal.x+b.vy*hit.normal.z;
    const velocity=certifySportsCollision({x:b.vx,y:b.vy,z:b.vz},{x:(b.vx-2*dot*hit.normal.x)*0.76,y:(b.vy-2*dot*hit.normal.z)*0.76,z:b.vz*0.76});
    b.vx=velocity.x;b.vy=velocity.y;b.vz=velocity.z;b.y=previous.y+(b.y-previous.y)*hit.t+hit.normal.z*0.03;b.x+=hit.normal.x*0.03;say(s,'OFF THE CROSSBAR!',1.5);return;
  }
  if(hit.post){rebound(b,hit.normal,0.76);b.x+=hit.normal.x*0.03;b.z+=hit.normal.z*0.03;say(s,'OFF THE POST!',1.5);return;}
  const receiver=hit.player,speed=Math.hypot(b.vx,b.vz);
  if(!receiver.keeper&&speed>25&&b.y>0.85){
    rebound(b,hit.normal,0.42);b.lastTouch=receiver.team;b.kicker=receiver.id;b.lock=0.15;say(s,'SHOT BLOCKED',1.1);return;
  }
  const saved=receiver.keeper&&b.lastTouch!==receiver.team&&speed>12;
  if(saved){s.stats.saves[receiver.team]++;say(s,'KEEPER SAVE!',1.6);receiver.saveTime=0.48;}
  takeBall(s,receiver);if(saved)signal(s,'save',0.8);
  else if(receiver.jockey){say(s,'READ THE LANE · INTERCEPTION',1.4);signal(s,'tackle',0.5);}
}
function skillMove(s,p,gesture={x:0,y:0}) {
  if(p.shield||s.ball.owner!==p.id)return;
  const d=Math.hypot(gesture.x,gesture.y)>0.3?direction(gesture.x,gesture.y):{x:-p.fz,z:p.fx};
  const forward=d.x*p.fx+d.z*p.fz,side=d.x*(-p.fz)+d.z*p.fx;
  const opposite=p.comboTime>0&&p.skillType==='roll'&&(d.x*p.skillX+d.z*p.skillZ)<-0.5;
  if(p.skillCooldown>0&&!opposite){signal(s,'denied',0.18);return;}
  if(p.stamina<0.09){say(s,'RECOVER YOUR LEGS',1);signal(s,'denied',0.2);return;}
  p.skillTime=0.42;p.skillDuration=0.42;p.skillCooldown=0.72;p.comboTime=0.62;
  p.stamina=clamp(p.stamina-0.07,0,1);signal(s,'skill',0.46);
  if(opposite){
    p.skillType='double';p.skillX=d.x;p.skillZ=d.z;p.skillDuration=p.skillTime=0.32;p.burst=0.58;p.comboTime=0;
    say(s,'DOUBLE TOUCH · EXIT INTO SPACE',1.3);
  }else if(forward>0.7){
    p.skillType='knockon';p.burst=0.72;p.skillTime=0;
    Object.assign(s.ball,{owner:-1,vx:p.fx*(Math.hypot(p.vx,p.vz)+7.4),vz:p.fz*(Math.hypot(p.vx,p.vz)+7.4),vy:0.65,y:0.36,kicker:p.id,lock:0.22,spin:0});
    say(s,'KNOCK-ON · CHASE YOUR TOUCH',1.3);
  }else if(forward<-.6){
    p.skillType='dragback';p.skillX=-p.fx;p.skillZ=-p.fz;p.skillDuration=p.skillTime=0.5;p.comboTime=0;
    say(s,'DRAG BACK · CHANGE DIRECTION',1.3);
  }else{
    p.skillType='roll';p.skillX=-p.fz*Math.sign(side||1);p.skillZ=p.fx*Math.sign(side||1);
    say(s,'BALL ROLL · FLICK BACK FOR DOUBLE TOUCH',1.4);
  }
}
function requestRun(s,owner){
  const candidates=s.players.filter(p=>p.team===owner.team&&!p.keeper&&p.id!==owner.id);
  candidates.sort((a,b)=>(dist(a,owner)+Math.abs(a.z-owner.z)*0.3)-(dist(b,owner)+Math.abs(b.z-owner.z)*0.3));
  if(candidates[0]){candidates[0].runTime=3.1;say(s,`PLAYER ${candidates[0].id+1} · MAKING THE RUN`,1.4);signal(s,'skill',0.25);}
}
function laneClearance(s,from,to,team){
  const dx=to.x-from.x,dz=to.z-from.z,length=dx*dx+dz*dz;
  return Math.min(8,...s.players.filter(p=>p.team!==team).map(p=>{const t=clamp(((p.x-from.x)*dx+(p.z-from.z)*dz)/Math.max(length,0.1),0,1);return Math.hypot(p.x-from.x-dx*t,p.z-from.z-dz*t);}));
}
function ai(s, p, dt) {
  const b = s.ball, side = attack(p.team), owner = b.owner >= 0 ? s.players[b.owner] : null;
  p.think += dt;
  if (p.keeper) {
    if (b.owner === p.id) {
      if (s.possessionAge > 0.6) {
        const teammate = s.players.filter(q => q.team === p.team && !q.keeper).sort((a,c)=>(laneClearance(s,p,c,p.team)*4-dist(c,p)*.15)-(laneClearance(s,p,a,p.team)*4-dist(a,p)*.15))[0];
        kick(s, p, 'pass', 0.48, direction(teammate.x - p.x, teammate.z - p.z));
      }
      return;
    }
    const danger = b.x * side < -17;
    move(p, -25.4 * side + (danger ? 0.8 * side : 0), clamp(b.z * 0.45, -3.8, 3.8), danger ? 6.9 : 4.2, dt);
    return;
  }
  if (owner?.id === p.id) {
    const keeper=s.players.find(q=>q.team!==p.team&&q.keeper);
    const goal = { x: side * 29, z: -Math.sign(keeper.z || p.z || 1)*3.45 };
    const pressure = s.players.filter(q => q.team !== p.team).some(q => dist(q, p) < 3.6);
    if (p.think > 0.28 && p.x * side > 7 && Math.abs(p.z) < 13) {
      kick(s, p, 'shoot', 0.38 + 0.2 * Math.sin(s.frame * 0.013), direction(goal.x - p.x, goal.z - p.z)); p.think = 0; return;
    }
    if (pressure && p.think > 0.58) {
      const teammates = s.players.filter(q => q.team === p.team && !q.keeper && q.id !== p.id && dist(q, p) > 4);
      teammates.sort((a,c)=>(laneClearance(s,p,c,p.team)*2+c.x*side*1.6)-(laneClearance(s,p,a,p.team)*2+a.x*side*1.6));
      if (teammates[0] && laneClearance(s,p,teammates[0],p.team)>1.15 && (teammates[0].x*side>p.x*side-3 || p.think>1.4)) {
        const mate = teammates[0],flight=dist(mate,p)/18; kick(s, p, 'pass', clamp(dist(mate, p) / 30, 0.2, 0.75), direction(mate.x+mate.vx*flight*.65-p.x, mate.z+mate.vz*flight*.65-p.z)); p.think = 0; return;
      }
    }
    const nearby=s.players.filter(q=>q.team!==p.team&&!q.keeper).sort((a,b)=>dist(a,p)-dist(b,p))[0];
    let dribbleZ=goal.z;
    const evading=nearby&&dist(nearby,p)<5;
    if(evading){dribbleZ=p.z+Math.sign(p.z-nearby.z||p.id%2-.5)*6;}
    p.stamina=clamp(p.stamina-dt*.09,0,1);
    move(p, evading?p.x+side*8:goal.x, clamp(dribbleZ,-13,13), 6.3+1.8*clamp(p.stamina/.18,0,1), dt); return;
  }
  const ownBall = owner?.team === p.team;
  const nearest = s.players.filter(q => q.team === p.team && !q.keeper && (q.team !== 0 || q.id !== s.active))
    .sort((a, c) => dist(a, b) - dist(c, b))[0];
  if (!ownBall && nearest?.id === p.id) {
    move(p, b.x + b.vx * 0.13, b.z + b.vz * 0.13, 6.3, dt);
    if (owner && owner.team !== p.team && dist(owner, p) < 1.55 && p.think > 1.1 && p.cooldown <= 0 && s.possessionAge > 0.65) {
      tackle(s, p); p.think = 0;
    }
  } else {
    if(p.runTime>0&&(ownBall||(!owner&&b.lastTouch===p.team))){const origin=owner||b;move(p,clamp(origin.x+side*13,-25,25),clamp(p.z+(p.z-origin.z)*dt,-14,14),7.4,dt);return;}
    const slot=p.id%5;
    const lane = slot===1?0:slot===2?-11:slot===3?11:0;
    const depth=slot===1?-6:slot===2?3:slot===3?6:12;
    let x = clamp(b.x + side * (ownBall ? depth : Math.min(depth,-3)), -23, 23);
    let z = clamp(lane + b.z * 0.22, -14.8, 14.8);
    if (!ownBall && owner) x = (x + owner.x - side * 3) / 2;
    if(ownBall){
      const clearance=laneClearance(s,owner,{x,z},p.team);
      if(clearance<1.8)z=clamp(z+Math.sign(z-owner.z||lane)*3,-14.8,14.8);
      for(const mate of s.players.filter(q=>q.team===p.team&&q.id!==p.id&&q.id!==owner.id)){if(Math.hypot(x-mate.x,z-mate.z)<4)z=clamp(z+Math.sign(z-mate.z||p.id-mate.id)*2.5,-14.8,14.8);}
    }
    move(p, x, z, ownBall ? 4.8 : 5.2, dt);
  }
}
function tackle(s,p){
  if(p.cooldown>0)return;
  p.tackle=.28;p.cooldown=.95;p.vx=p.fx*7.4;p.vz=p.fz*7.4;
}
function tackleContact(s,p){
  // Contact is resolved during the lunge, after both athletes have moved.
  // There is no instant ownership transfer on the button press.
  if(p.tackle>.24||p.tackle<.08)return;
  const owner=s.ball.owner>=0?s.players[s.ball.owner]:null;
  if(!owner||owner.team===p.team||dist(owner,p)>1.95)return;
  const toBall=direction(s.ball.x-p.x,s.ball.z-p.z);
  if(p.fx*toBall.x+p.fz*toBall.z<.25||dist(p,s.ball)>1.2)return;
  const approach=direction(p.x-owner.x,p.z-owner.z);
  if(owner.shield&&approach.x*owner.fx+approach.z*owner.fz<.35){
    p.tackle=.07;say(s,'SHIELDED · GET AROUND THE BODY',1.3);signal(s,'denied',.2);return;
  }
  takeBall(s,p);p.tackle=.07;s.stats.tackles[p.team]++;say(s,'CLEAN TACKLE',1.2);signal(s,'tackle',.65);
}
function step(s, dt, input = {}) {
  dt = clamp(dt, 0, 1 / 20); if (!dt) return;
  const pressed = { ...input.pressed }, held = { ...input.held }, released = { ...input.released };
  // Cancellation wins even when an earlier render sample retained the press.
  // Soccer B also aliases tackle; a voice-owned B must not commit that action.
  for(const [kind,cancelled] of Object.entries(input.cancelled || {}))if(cancelled){
    for(const key of kind==='shoot'?['shoot','tackle']:[kind]){delete pressed[key];delete held[key];delete released[key];}
  }
  s.blockedActions ||= [];
  s.blockedActions=s.blockedActions.filter(kind=>held[kind]);
  if(s.charging&&input.cancelled?.[s.charging]){s.charging=null;s.charge=0;s.shootReady=false;}
  s.frame++; s.messageTime = Math.max(0, s.messageTime - dt);
  if (s.phase === 'finished') {
    if (pressed.confirm || pressed.rematch) Object.assign(s, createState());
    return;
  }
  if (s.phase === 'ready') {
    if (pressed.confirm || pressed.pass) { s.phase = 'play'; s.passReady=!(pressed.pass || held.pass); say(s, 'KICKOFF · ALDER ATTACKS RIGHT', 3); }
    return;
  }
  s.clock = Math.max(0, s.clock - dt);
  if (s.clock === 0) { s.phase = 'finished'; s.charging = null; s.charge = 0; say(s, s.score[0] > s.score[1] ? 'ALDER WINS' : s.score[0] < s.score[1] ? 'EMBER WINS' : 'HONORS EVEN', 1000); return; }
  if (s.phase === 'goal') {
    s.phaseTime -= dt;
    if (s.phaseTime <= 0) restart(s, 'Kickoff', s.restart.team, 0, 0);
    return;
  }
  if (s.phase === 'restart') {
    s.restart.time += dt;
    // Retain a new press through the brief presentation grace. A button already
    // held when the ball went out is not a restart request.
    if (pressed.confirm || pressed.pass) s.restart.confirmQueued=true;
    if (s.restart.time > 0.45 && (s.restart.confirmQueued || s.restart.time > (s.restart.team === 1 ? 1.6 : 5))) {
      s.passReady=!(pressed.pass || held.pass); resumeRestart(s);
    }
    return;
  }
  s.players.forEach(p => { p.cooldown = Math.max(0, p.cooldown - dt); p.tackle = Math.max(0, p.tackle - dt); p.skillTime=Math.max(0,p.skillTime-dt);p.skillCooldown=Math.max(0,p.skillCooldown-dt);p.shield=false;p.jockey=false;if(p.id!==s.active&&s.ball.owner!==p.id)p.stamina=clamp(p.stamina+dt*.14,0,1);for(const key of ['comboTime','burst','runTime','kickTime','saveTime'])p[key]=Math.max(0,p[key]-dt); });
  const b = s.ball, previousPositions=s.players.map(p=>({x:p.x,y:0,z:p.z}));
  const defending=!(b.owner>=0 && s.players[b.owner].team===0);
  if ((pressed.switch || input.gesture) && defending) {
    const from=s.players[s.active], flick=input.gesture;
    const candidates = s.players.filter(p => p.team === 0 && !p.keeper && p.id !== s.active);
    const rank=q=>{if(!flick)return dist(q,b);const d=direction(q.x-from.x,q.z-from.z);return -(d.x*flick.x+d.z*flick.y)*20+dist(q,from)*.15;};
    candidates.sort((a, c) => rank(a) - rank(c)); s.active = candidates[0].id; s.charging = null; s.charge = 0;
  }
  const p = s.players[s.active], movement = input.move || { x: 0, y: 0 }, aim = input.aim || input.move || { x: 0, y: 0 };
  p.shield=!!held.shield && b.owner===p.id;p.jockey=!!held.shield && b.owner!==p.id;
  if(p.jockey){const facing=direction(b.x-p.x,b.z-p.z);p.fx=facing.x;p.fz=facing.z;}
  if(s.pending){s.pending.time-=dt;if(s.pending.time<=0)s.pending=null;}
  const queuedAction=['shoot','through','lob','pass'].find(kind=>pressed[kind]);
  if(queuedAction&&b.owner!==p.id&&(b.owner>=0?s.players[b.owner].team===p.team:b.lastTouch===p.team)&&dist(p,b)<7){const d=Math.hypot(aim.x,aim.y)>.025?direction(aim.x,aim.y):{x:p.fx,z:p.fz};s.pending={kind:queuedAction,time:0.24,x:d.x,z:d.z};}
  const length = Math.hypot(movement.x, movement.y), sprinting = !!held.sprint && !p.shield && !p.jockey;
  const sprintSpeed=6.3+(p.burst>0?3:2.6)*clamp(p.stamina/.18,0,1);
  const speed = p.shield ? 3.4 : p.jockey ? 4.8 : sprinting ? sprintSpeed : 6.3;
  p.stamina = clamp(p.stamina + dt * (sprinting && length > 0.1 ? -0.16 : 0.14), 0, 1);
  if (length > 0.12) move(p, p.x + movement.x / Math.max(1, length) * speed * dt, p.z + movement.y / Math.max(1, length) * speed * dt, speed, dt);
  else move(p,p.x,p.z,0,dt);
  if (!p.jockey && Math.hypot(aim.x, aim.y) > 0.025 && (!(pressed.skill || input.gesture || p.skillTime > 0) || held.shoot)) { const d = direction(aim.x, aim.y); p.fx = d.x; p.fz = d.z; }
  if (pressed.tackle && b.owner !== p.id) {tackle(s, p);for(const kind of ['shoot','lob'])if(pressed[kind]&&!s.blockedActions.includes(kind))s.blockedActions.push(kind);}
  if((pressed.skill||input.gesture) && !held.shoot && !held.pass && !held.through && !held.lob && !s.charging)skillMove(s,p,input.gesture||input.skillDirection||aim);
  if((pressed.runRequest||pressed.switch)&&b.owner===p.id)requestRun(s,p);
  let faked=false;
  if(s.charging==='shoot'&&pressed.pass&&b.owner===p.id){faked=true;s.charging=null;s.charge=0;s.passReady=false;s.shootReady=false;p.burst=.45;p.skillType='fake';p.skillTime=.3;p.skillDuration=.3;signal(s,'skill',.4);say(s,'SHOT FAKE · TAKE THE SPACE',1.3);}
  // A used to enter play belongs to that transition, until it is released.
  if (!held.pass) s.passReady=true;if(!held.shoot)s.shootReady=true;
  if (b.owner === p.id && s.pending && !faked){const pending=s.pending;s.pending=null;humanKick(s,p,pending.kind,0.35,{x:pending.x,z:pending.z},false,pending.kind==='through'?'through':pending.kind==='lob'?'loft':'normal');say(s,'FIRST TIME',1);}
  if (b.owner === p.id && !faked) {
    const type = (held.shoot||pressed.shoot) && s.shootReady && !s.blockedActions.includes('shoot') ? 'shoot' : (held.through||pressed.through) ? 'through' : (held.lob||pressed.lob) && !s.blockedActions.includes('lob') ? 'lob' : (held.pass||pressed.pass) && s.passReady ? 'pass' : null;
    if (type) { if (s.charging !== type) {s.charge = 0;s.delivery='normal';} s.charging = type;
      if(type==='through')s.delivery=held.switch?'loft':'through';
      else if(type==='lob')s.delivery='loft';
      else if(type==='pass'&&(held.finesse||held.driven))s.delivery='driven';
      else if(type==='shoot'&&held.finesse)s.delivery='finesse'; s.charge = clamp(s.charge + dt / 0.9, 0, 1); }
    if (s.charging && (released[s.charging] || (!held[s.charging] && s.charge > 0))) {
      humanKick(s, p, s.charging, s.charge, { x: p.fx, z: p.fz }, s.charging==='shoot' && (held.finesse||s.delivery==='finesse'),s.delivery);
      if(held.switch)p.runTime=2.8;
    }
  } else { s.charge = 0; s.charging = null; }
  for (const q of s.players) if (q.id !== s.active) ai(s, q, dt);
  // Soft separation makes crowded tackles readable without hard body pinning.
  for (let i = 0; i < 10; i++) for (let j = i + 1; j < 10; j++) {
    const a = s.players[i], c = s.players[j], d = dist(a, c);
    if (d > 0.001 && d < 0.9) {
      const push = (0.9 - d) * 0.22, dx = (a.x - c.x) / d * push, dz = (a.z - c.z) / d * push;
      a.x = clamp(a.x + dx, -27.6, 27.6); a.z = clamp(a.z + dz, -16.6, 16.6);
      c.x = clamp(c.x - dx, -27.6, 27.6); c.z = clamp(c.z - dz, -16.6, 16.6);
      const nx=(a.x-c.x)/Math.max(dist(a,c),0.001),nz=(a.z-c.z)/Math.max(dist(a,c),0.001);
      const approach=(a.vx-c.vx)*nx+(a.vz-c.vz)*nz;
      if(approach<0){
        const impulse=-approach*0.5;
        const response=certifySportsPairCollision({x:a.vx,y:0,z:a.vz},{x:c.vx,y:0,z:c.vz},{x:a.vx+nx*impulse,y:0,z:a.vz+nz*impulse},{x:c.vx-nx*impulse,y:0,z:c.vz-nz*impulse});
        a.vx=response.a.x;a.vz=response.a.z;c.vx=response.b.x;c.vz=response.b.z;
      }
    }
  }
  s.players.forEach((p,i)=>{const accepted=certifySportsMove(previousPositions[i],{x:p.x,y:0,z:p.z},9.5*dt);p.x=accepted.x;p.z=accepted.z;});
  for(const athlete of s.players)tackleContact(s,athlete);
  b.lock = Math.max(0, b.lock - dt);
  if (b.owner >= 0) {
    const owner = s.players[b.owner]; s.possessionAge += dt; b.touch+=dt;
    const speed=Math.hypot(owner.vx,owner.vz),stride=0.72+Math.sin(b.touch*(10+speed))*0.12;
    const lead=owner.shield?0.43:stride+speed*0.065;
    const progress=1-owner.skillTime/owner.skillDuration;
    const roll=owner.skillTime>0?Math.sin(progress*Math.PI)*(owner.skillType==='double'?1.7:owner.skillType==='dragback'?1.35:owner.skillType==='fake'?0:1.35):0;
    const targetX=owner.x+owner.fx*lead+owner.skillX*roll,targetZ=owner.z+owner.fz*lead+owner.skillZ*roll;
    // Repeated feet-to-ball corrections leave visible travel between touches.
    const response=1-Math.exp(-dt*(owner.shield?25:16));
    b.vx=(targetX-b.x)*response/dt;b.vz=(targetZ-b.z)*response/dt;
    b.x+=b.vx*dt;b.z+=b.vz*dt;b.y=0.32+Math.abs(Math.sin(b.touch*13))*speed*0.009;
  } else {
    const previous={x:b.x,y:b.y,z:b.z};
    const turn=b.spin*dt,cos=Math.cos(turn),sin=Math.sin(turn),vx=b.vx;
    b.vx=vx*cos-b.vz*sin;b.vz=vx*sin+b.vz*cos;b.spin*=Math.exp(-dt*0.6);
    Object.assign(b,stepSportsBall(b,dt,{gravity:9.81,floor:0.32,restitution:0.35,friction:Math.exp(-(b.y<0.4?0.7:0.12)*dt)}));
    resolveFlight(s,previous);
  }
  // Resolve the line crossing before pickup so keepers cannot catch a scored ball.
  if (Math.abs(b.x) > HALF_X) {
    if (Math.abs(b.z) < GOAL && b.y < 3) {
      const team = b.x > 0 ? 0 : 1; s.score[team]++; s.phase = 'goal'; s.phaseTime = 2.6; s.restart = { team: 1 - team }; s.charge = 0; s.charging = null;
      say(s, `${team === 0 ? 'ALDER' : 'EMBER'} GOAL!`, 4);signal(s,'goal',1); return;
    }
    const defending = b.x > 0 ? 1 : 0;
    if (b.lastTouch === defending) restart(s, 'Corner', 1 - defending, Math.sign(b.x) * 27.4, Math.sign(b.z || 1) * 16.4);
    else restart(s, 'Goal kick', defending, Math.sign(b.x) * 24, 0);
    return;
  }
  if (Math.abs(b.z) > HALF_Z) { restart(s, 'Throw-in', 1 - b.lastTouch, clamp(b.x, -26, 26), Math.sign(b.z) * 16.2); return; }

}

function buildScene({ THREE, scene, camera }) {
  scene.background = new THREE.Color(0x071a2b); scene.fog = new THREE.Fog(0x071a2b, 88, 165);
  camera.fov = 46; camera.near = 0.1; camera.far = 220; camera.position.set(0, 46, 43); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix();
  const materials = new Map();
  const mat = (color, extra = {}) => { const key = `${color}:${JSON.stringify(extra)}`; if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.72, ...extra })); return materials.get(key); };
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1), sphereGeometry = new THREE.SphereGeometry(1, 12, 10), torsoGeometry=new THREE.CapsuleGeometry(.34,.38,5,10), limbGeometry=new THREE.CapsuleGeometry(.1,.32,4,8);
  function mesh(geometry, material, x, y, z, sx, sy, sz, parent = scene) {
    const object = new THREE.Mesh(geometry, material); object.position.set(x, y, z); object.scale.set(sx, sy, sz); parent.add(object); return object;
  }
  const box = (color, x, y, z, w, h, d, parent = scene) => mesh(boxGeometry, mat(color), x, y, z, w, h, d, parent);
  const sphere = (color, x, y, z, r, parent = scene) => mesh(sphereGeometry, mat(color), x, y, z, r, r, r, parent);
  function line(points, color = 0xe6f3da, opacity = 1) {
    const geometry = new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p)));
    const object = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity })); scene.add(object); return object;
  }
  function label(text, color, x, y, z, width, height, ground = false) {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 128;
    const c = canvas.getContext('2d'); c.fillStyle = color; c.font = '900 74px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, 512, 64);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    m.position.set(x, y, z); if (ground) m.rotation.x = -Math.PI / 2; scene.add(m); return m;
  }
  scene.add(new THREE.HemisphereLight(0xc7e6ff, 0x194e35, 2.1));
  const sun = new THREE.DirectionalLight(0xffecd5, 2.6); sun.position.set(-16, 32, 18); scene.add(sun);
  const fill = new THREE.DirectionalLight(0x87caff, 1.8); fill.position.set(25, 25, -20); scene.add(fill);
  box(0x102935, 0, -0.7, 0, 90, 1, 64);
  box(0x184f3d, 0, -0.16, 0, 64, 0.3, 41);
  for (let i = 0; i < 14; i++) box(i % 2 ? 0x247447 : 0x2c8050, -26 + i * 4, 0, 0, 4, 0.08, 34);
  const y = 0.08;
  line([[-28,y,-17],[28,y,-17],[28,y,17],[-28,y,17],[-28,y,-17]]);
  line([[0,y,-17],[0,y,17]]);
  line(Array.from({ length: 65 }, (_, i) => [Math.cos(i / 64 * Math.PI * 2) * 5.4, y, Math.sin(i / 64 * Math.PI * 2) * 5.4]));
  sphere(0xe6f3da, 0, 0.08, 0, 0.13);
  for (const side of [-1, 1]) {
    line([[side*28,y,-9],[side*19,y,-9],[side*19,y,9],[side*28,y,9]]);
    line([[side*28,y,-5.8],[side*24.4,y,-5.8],[side*24.4,y,5.8],[side*28,y,5.8]]);
    sphere(0xe6f3da, side * 21.6, 0.08, 0, 0.13);
    for (const z of [-GOAL, GOAL]) { box(0xf4fff1, side * 28.1, 1.5, z, 0.16, 3, 0.16); box(0xb4d6d8, side * 30.5, 1.5, z, 0.12, 3, 0.12); }
    box(0xf4fff1, side * 28.1, 3, 0, 0.16, 0.16, GOAL * 2 + 0.16);
    for (let n = 0; n <= 16; n++) line([[side*28.1,3,-GOAL+n*GOAL/8],[side*30.5,2.8,-GOAL+n*GOAL/8],[side*30.5,0.1,-GOAL+n*GOAL/8]],0xd7efea,0.32);
    for (let n = 0; n < 7; n++) line([[side*28.1,n*0.45,-GOAL],[side*30.5,n*0.45,-GOAL],[side*30.5,n*0.45,GOAL],[side*28.1,n*0.45,GOAL]],0xd7efea,0.32);
    for (const z of [-17,17]) { box(0xdce9bd, side*28, 0.9, z, 0.07, 1.8, 0.07); box(0xffb553, side*28+0.3, 1.6, z, 0.6,0.4,0.04); }
  }
  // Low stands keep the broadcast camera's sightline clear.
  for (const side of [-1,1]) {
    box(0x113b48, 0, 0.55, side * 19, 66, 1.1, 0.55);
    box(side === -1 ? 0x1ad5cb : 0xffa544, 0, 1.12, side*19, 66,0.09,0.7);
    for (let row = 0; row < 4; row++) box(0x183344, 0, row*0.6+0.4, side*(21+row*1.5), 66,0.8,1.3);
    label(side === -1 ? 'ALDER FIVE  /  NIGHT LEAGUE' : 'OWN THE PITCH', side === -1 ? '#75fff0' : '#ffcc84', 0,1.3,side*19.35,27,2.8, true);
  }
  const crowdGeometry = new THREE.BoxGeometry(0.45,0.65,0.42);
  const crowd = new THREE.InstancedMesh(crowdGeometry, mat(0xffffff), 240), matrix = new THREE.Object3D();
  for (let i = 0; i < 240; i++) {
    const side = i < 120 ? -1 : 1, row = Math.floor((i % 120)/40), index = i % 40;
    matrix.position.set(-30+index*1.53,1.25+row*0.6,side*(21+row*1.5)); matrix.rotation.y = Math.sin(i*13)*0.25; matrix.updateMatrix(); crowd.setMatrixAt(i,matrix.matrix);
    crowd.setColorAt(i,new THREE.Color([0x2edbcc,0xf8bb76,0x385269,0xbad4db,0xfc6e53][i%5]));
  }
  scene.add(crowd);
  for (const x of [-33,33]) for (const z of [-23,23]) {
    box(0x455c70,x,9,z,0.4,18,0.4); box(0xd7eeff,x,18,z,4.2,0.7,0.7);
    mesh(boxGeometry,mat(0xe8faff,{ emissive:0xa9dfff,emissiveIntensity:2 }),x,17.8,z+0.4,3.8,0.45,0.1);
  }
  label('ALDER', '#4ddcca', -15,0.1,-14,10,1.4,true); label('EMBER', '#ffc084',15,0.1,14,10,1.4,true);
  const athletes = Array.from({length:10}, (_,i) => {
    const group = new THREE.Group(); scene.add(group);
    const team = i<5?0:1, keeper=i%5===0, jersey=keeper?0xf8df59:team===0?0x22d8c5:0xff7654;
    const skin=[0xc98d65,0x8d543c,0xeab491,0x654330,0xb87f58][i%5];
    mesh(torsoGeometry,mat(jersey),0,1.33,0,1,1,.73,group);
    box(0xeaf9f2,0,1.58,.255,.6,.07,.03,group); box(team===0?0x123f51:0x472b42,0,0.84,0,0.66,0.25,0.42,group);
    sphere(skin,0,1.99,0,0.32,group); box(0x26313e,0,2.2,-0.04,0.5,0.18,0.46,group);
    if(typeof document!=='undefined'){
      const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d');ctx.fillStyle='#f5ffff';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='900 96px system-ui';ctx.fillText(String(i%5+1),64,67);
      const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;const number=new THREE.Mesh(new THREE.PlaneGeometry(.38,.4),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false}));number.position.set(0,1.32,.267);group.add(number);
      const back=number.clone();back.position.z=-.267;back.rotation.y=Math.PI;group.add(back);
    }
    const limbs=[];
    for (const side of [-1,1]) {
      const leg = new THREE.Group(); leg.position.set(side*0.21,0.77,0); group.add(leg);
      mesh(limbGeometry,mat(skin),0,-.2,0,1,.85,1,leg); box(jersey,0,-0.43,0,0.23,0.2,0.24,leg); box(0xe6f7ea,0,-0.61,0.1,0.26,0.17,0.43,leg);
      const arm = new THREE.Group(); arm.position.set(side*0.48,1.62,0); group.add(arm); mesh(limbGeometry,mat(skin),0,-.25,0,1,1,1,arm);
      limbs.push(leg,arm);
    }
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.65,20), new THREE.MeshBasicMaterial({color:0x061c20,transparent:true,opacity:0.3,depthWrite:false})); shadow.rotation.x=-Math.PI/2; shadow.position.y=0.1; scene.add(shadow);
    const marker=new THREE.Mesh(new THREE.ConeGeometry(.22,.45,3),new THREE.MeshBasicMaterial({color:0x8affec}));marker.rotation.z=Math.PI;scene.add(marker);
    return {group,limbs,shadow,marker};
  });
  const ball = sphere(0xf5fff6,0,0.32,0,0.32);
  for (const a of [[0,0.31,0],[0,0,0.31],[0.31,0,0],[-0.31,0,0],[0,0,-0.31]]) sphere(0x193547,...a,0.13,ball);
  // Child patches must not inherit the ball's unit-radius scale.
  ball.scale.set(1,1,1); ball.geometry = new THREE.SphereGeometry(0.32,16,12);
  const ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.34,16),new THREE.MeshBasicMaterial({color:0x061c20,transparent:true,opacity:0.4,depthWrite:false})); ballShadow.rotation.x=-Math.PI/2; scene.add(ballShadow);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.88,1.05,32),new THREE.MeshBasicMaterial({color:0x8cfff1,side:THREE.DoubleSide})); ring.rotation.x=-Math.PI/2; scene.add(ring);
  const arrow = new THREE.ArrowHelper(new THREE.Vector3(1,0,0),new THREE.Vector3(0,0.2,0),3,0xd9ff7d,0.65,0.5); scene.add(arrow);
  const trail = Array.from({length:7},()=>{ const o=sphere(0xbfffea,0,0,0,0.15); o.material=new THREE.MeshBasicMaterial({color:0xbfffea,transparent:true,opacity:0.22,depthWrite:false}); return o; });
  const aimDots=Array.from({length:6},()=>{const dot=new THREE.Mesh(new THREE.RingGeometry(.1,.17,12),new THREE.MeshBasicMaterial({color:0xe7ff9b,transparent:true,opacity:.65,side:THREE.DoubleSide}));dot.rotation.x=-Math.PI/2;scene.add(dot);return dot;});
  return { athletes, ball, ballShadow, ring, arrow, trail, aimDots, history: [], cameraX:0,cameraZ:0,cameraZoom:1 };
}
function render({ state:s, view:v, camera, dt=1/60 }) {
  for (const p of s.players) {
    const visual=v.athletes[p.id], speed=Math.hypot(p.vx,p.vz), run=Math.sin(s.frame*0.24+p.id)*Math.min(0.7,speed*0.08);
    visual.group.position.set(p.x,Math.abs(run)*0.07,p.z); visual.group.rotation.y=Math.atan2(p.fx,p.fz);
    visual.group.rotation.x=p.tackle>0?-0.6:p.shield||p.jockey?0.16:clamp(speed*.015,0,.13);
    if(p.jockey)visual.group.position.y-=.12;
    visual.group.rotation.z=p.skillTime>0?Math.sin(p.skillTime*15)*0.2:0;
    visual.limbs.forEach((limb,i)=>{limb.rotation.x=run*(i<2?1:-1)*(i%2===0?1:-0.7);});
    if(p.kickTime>0)visual.limbs[2].rotation.x=-Math.sin((1-p.kickTime/.28)*Math.PI)*1.4;
    if(p.skillTime>0){visual.limbs[0].rotation.z=Math.sin(s.frame*.2)*.35;visual.limbs[2].rotation.z=-visual.limbs[0].rotation.z;}else{visual.limbs[0].rotation.z=visual.limbs[2].rotation.z=0;}
    if(p.shield||p.jockey){visual.limbs[1].rotation.z=.55;visual.limbs[3].rotation.z=-.55;}else{visual.limbs[1].rotation.z=visual.limbs[3].rotation.z=0;}
    if(p.saveTime>0){visual.group.rotation.z=Math.sin(p.saveTime/.48*Math.PI)*.7;visual.limbs[1].rotation.x=visual.limbs[3].rotation.x=-1.2;}
    visual.marker.position.set(p.x,2.9+Math.sin(s.frame*.08)*.07,p.z);visual.marker.visible=p.id===s.active||p.runTime>0;visual.marker.material.color.setHex(p.id===s.active?0x8affec:0xffde7a);
    if (s.phase==='goal') { visual.limbs[1].rotation.x=2.7; visual.limbs[3].rotation.x=2.7; }
    visual.shadow.position.set(p.x,0.1,p.z);
  }
  const b=s.ball, p=s.players[s.active]; v.ball.position.set(b.x,b.y,b.z); v.ball.rotation.z-=b.vx*dt*0.8; v.ball.rotation.x+=b.vz*dt*0.8;
  v.ballShadow.position.set(b.x,0.11,b.z); v.ballShadow.scale.setScalar(1+Math.max(0,b.y-0.32)*0.15);
  v.ring.position.set(p.x,0.12,p.z); v.ring.material.color.setHex(s.charging?0xfaff78:p.shield?0x82b4ff:p.skillTime>0?0xffa5f5:0x8cfff1);
  v.arrow.position.set(p.x,0.2,p.z); v.arrow.setDirection({x:p.fx,y:0,z:p.fz}); v.arrow.setLength(2.1+s.charge*3.3,0.6,0.45); v.arrow.visible=b.owner===s.active && s.phase==='play';
  v.aimDots.forEach((dot,i)=>{const distance=(i+1)*(1.8+s.charge*1.5);dot.position.set(p.x+p.fx*distance,.13,p.z+p.fz*distance);dot.visible=s.charging!==null&&b.owner===p.id&&Math.abs(dot.position.x)<28&&Math.abs(dot.position.z)<17;dot.material.color.setHex(s.delivery==='loft'?0xffbd79:0xe7ff9b);});
  v.history.unshift({x:b.x,y:b.y,z:b.z}); if(v.history.length>21)v.history.pop();
  v.trail.forEach((o,i)=>{ const past=v.history[i*3]; o.visible=!!past&&b.owner<0&&Math.hypot(b.vx,b.vz)>8&&s.phase==='play'; if(past)o.position.set(past.x,past.y,past.z); o.scale.setScalar(1-i*0.09); });
  const live=s.phase==='play',follow=1-Math.exp(-dt*5.5);
  const targetX=live?clamp(b.x*.62+p.x*.38,-23,23):0,targetZ=live?clamp(b.z*.55+p.z*.45,-11,11):0;
  v.cameraX+=(targetX-v.cameraX)*follow;v.cameraZ+=(targetZ-v.cameraZ)*follow;
  v.cameraZoom+=((live?.54:.95)-v.cameraZoom)*(1-Math.exp(-dt*4));
  const aspect=camera.aspect||1,distance=aspect<.85?.85/aspect:1;
  camera.position.set(v.cameraX,46*v.cameraZoom*distance,v.cameraZ+43*v.cameraZoom*distance);camera.lookAt(v.cameraX,0,v.cameraZ);
}
function hud(s) {
  const p=s.players[s.active], owner=s.ball.owner>=0?s.players[s.ball.owner]:null;
  return { phase:s.phase, teamNames:['ALDER','EMBER'], score:[...s.score],clock:s.clock,label:'ALDER FIVE · 5v5',
    message:s.phase==='ready'?'NIGHT LEAGUE · ALDER vs EMBER':s.phase==='finished'?s.message:s.messageTime>0?s.message:owner?.team===0?'ALDER IN POSSESSION':owner?'EMBER IN POSSESSION':'LOOSE BALL',
    detail:s.phase==='ready'?'First to the final whistle. Press A / Enter to kick off.':s.phase==='restart'?`${s.restart.type} · ${s.restart.team===0?'A / Enter to restart':'Ember restarting'}`:s.phase==='finished'?`Shots ${s.stats.shots[0]}–${s.stats.shots[1]} · Saves ${s.stats.saves[0]}–${s.stats.saves[1]} · Enter for rematch`:s.charging?`${s.charging==='shoot'?'SHOT · RB FINESSE':s.charging==='through'?'THROUGH BALL':s.charging==='lob'?'LOFTED PASS':'GROUND PASS'} · RELEASE TO STRIKE · ${Math.round(s.charge*100)}%`:`${p.keeper?'GOALKEEPER':`PLAYER ${p.id+1}`} · ${p.shield?'SHIELDING':p.skillCooldown>0?'SKILL RECOVERING':'RS SKILL · LT SHIELD'} · STAMINA ${Math.round(p.stamina*100)}% · ALDER ATTACKS →`,
    stamina:p.stamina,skillReady:p.skillCooldown<=0&&p.stamina>=.09,status:p.jockey?'JOCKEY':p.shield?'SHIELD':p.burst>0?'BURST':p.skillCooldown>0?'RECOVERING':'READY',
    skillHint:s.ball.owner===p.id?(s.charging==='shoot'?'LS place shot · RB/F finesse · A/J shot fake':'LS direction · A/J pass · B/K shoot · Y/U through · X/I lob · RS/E skill · LB/Q run'):'LT/C jockey · B/L tackle · X/I tackle · LB/Q or RS switch',
    power:s.charge,finished:s.phase==='finished' };
}
function cancelInput(s) { s.charge = 0; s.charging = null; s.players.forEach(p=>{p.shield=false;p.jockey=false;});s.pending=null; }
export const soccerDefinition = { id:'soccer', title:'Alder Five', createState, validateState, step, buildScene, render, hud, cancelInput };
