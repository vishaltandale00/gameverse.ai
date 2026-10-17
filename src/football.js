// Original seven-a-side arcade football. The model is independent of browser and renderer.
import { certifySportsMove, stepSportsBall, certifySportsPairCollision, certifySportsSeparation } from './sports-physics.js';
import { random } from './sports-league.js';
const FIELD = 50;
const RECEIVERS = ['receiverA', 'receiverB', 'receiverX'];
const RECEIVER_LABELS = ['A', 'B', 'X'];
const passType = charge => charge < .16 ? 'LOB' : charge < .42 ? 'TOUCH' : 'BULLET';
const OFFENSE = ['VERTICALS', 'CROSSING', 'SWEEP'];
const DEFENSE = ['BALANCED', 'BLITZ', 'DEEP COVER'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const direction = team => team === 0 ? 1 : -1;
const indexOf = (team, slot) => team * 7 + slot;
const norm = (x, y) => { const n = Math.hypot(x, y); return n > 0 ? { x: x / n, y: y / n } : { x: 0, y: 1 }; };
const blankInput = { move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, held: {}, pressed: {}, released: {} };
function createState() {
  const state = {
    schema: 5, started: false, frame: 0, time: 600, score: [0, 0], phase: 'select', phaseTime: 0,
    offense: 0, down: 1, line: -30, target: -20, conversion: false, play: 0,
    aiPlay: 0, controlled: 0, carrier: 0, ball: { x: 0, y: -34, z: 1, flight: null },
    charge: 0, charging: false, passReady: false, receiverButton: null, receiverReady: [false,false,false], throwHold: 0, thrown: false, intercepted: false,
    tackleCooldown: 0, tackleWindow: 0, catchProtection: 0, snapTime: 0, deadTime: 0, next: null,
    message: 'WELCOME TO ALDER GRIDIRON', lastResult: 'Choose a play. Own the field.',
    players: Array.from({ length: 14 }, (_, id) => ({ id, team: Math.floor(id / 7), slot: id % 7, x: 0, y: 0, vx: 0, vy: 0, wishX: 0, wishY: 0, prevX: 0, prevY: 0, stun: 0, stamina: 1, balance: 1, jukeCooldown: 0, jukeTime: 0, jukeX: 0, protect: false, hitCooldown: 0, spinTime: 0, stiffTime: 0, stiffCooldown: 0, diveTime: 0, diveCooldown: 0, diveX: 0, diveY: 0, diveHit: false, recover: 0, wrapTime: 0, strafe: false, facingX: 0, facingY: 1, moveWon: false })),
    aim: { x: 0, y: 1 }, handoffPending: false, handoffTime: 0, feedback: null, actionMessage: null, playNumber: 0,
  };
  formation(state);
  return state;
}
function upgradeState(s) {
  if(s?.schema===2 && Array.isArray(s.players)) {
    for(const p of s.players)Object.assign(p,{spinTime:0,stiffTime:0,stiffCooldown:0,diveTime:0,diveCooldown:0,diveX:0,diveY:0,diveHit:false,recover:0,facingX:0,facingY:direction(p.team),moveWon:false});
    s.handoffPending=false;s.handoffTime=0;s.feedback=null;s.actionMessage=null;s.schema=3;
  }
  if(s?.schema===3){s.playNumber=0;s.schema=4;}
  if(s?.schema===4){
    if(typeof s.started==='undefined')s.started=s.time<600||s.phase!=='select';
    s.receiverButton=null;s.receiverReady=[false,false,false];s.throwHold=0;s.charge=0;s.charging=false;
    for(const p of s.players){p.wrapTime=0;p.strafe=false;}
    s.schema=5;
  }
}
function feedback(s,kind,strength=.5,text=null) {
  s.feedback={id:(s.feedback?.id||0)+1,kind,strength:clamp(strength,0,1)};
  if(text)s.actionMessage={text,until:s.frame+70};
}
function beginDive(p,vector) {
  const n=norm(vector.x,vector.y);p.diveX=n.x;p.diveY=n.y;p.diveTime=.27;p.diveCooldown=1.25;p.diveHit=false;
}
function handoff(s,dt) {
  if(!s.handoffPending)return;
  s.handoffTime+=dt;
  const qb=s.players[indexOf(s.offense,0)],rb=s.players[indexOf(s.offense,1)];
  if(s.carrier!==qb.id||s.handoffTime>2.2){s.handoffPending=false;return;}
  if(distance(qb,rb)<1.45){
    const position={x:s.ball.x,y:s.ball.y,z:s.ball.z};
    s.carrier=rb.id;s.thrown=true;s.handoffPending=false;s.catchProtection=.2;
    s.ball.carry={x:position.x-rb.x,y:position.y-rb.y,z:position.z};
    if(s.offense===0)s.controlled=rb.id;
    feedback(s,'pass',.4,'HANDOFF · FOLLOW YOUR LEAD BLOCKER');
  }
}
function formation(s) {
  const d = direction(s.offense);
  const offensive = [[0, -4], [-7, -2], [-17, 0], [17, 0], [-3, 0], [0, 0], [3, 0]];
  if((s.offense===0?s.play:s.aiPlay)===2)offensive[1]=[-3.8,-4];
  const defensive = [[0, 7], [-9, 5], [-17, 6], [17, 6], [-3, 2], [0, 2], [3, 2]];
  for (const p of s.players) {
    const xy = (p.team === s.offense ? offensive : defensive)[p.slot];
    p.x = xy[0] * d; p.y = clamp(s.line + xy[1] * d, -57, 57);
    p.vx = 0; p.vy = 0; p.wishX = 0; p.wishY = 0; p.prevX = p.x; p.prevY = p.y; p.stun = 0;
    p.stamina = Math.min(1,p.stamina + .35); p.balance = 1; p.jukeCooldown = 0; p.jukeTime = 0; p.jukeX = 0; p.protect = false; p.hitCooldown = 0; p.spinTime=0;p.stiffTime=0;p.stiffCooldown=0;p.diveTime=0;p.diveCooldown=0;p.diveX=0;p.diveY=0;p.diveHit=false;p.recover=0;p.wrapTime=0;p.strafe=false;p.facingX=0;p.facingY=p.team===s.offense?d:-d;p.moveWon=false;
  }
  s.handoffPending=false;s.handoffTime=0;s.actionMessage=null;
  s.carrier = indexOf(s.offense, 0);
  s.controlled = s.offense === 0 ? 0 : 1;
  s.ball = { x: s.players[s.carrier].x, y: s.players[s.carrier].y, z: 1, flight: null };
  s.charge = 0; s.charging = false; s.passReady = false; s.receiverButton=null;s.receiverReady=[false,false,false];s.throwHold=0; s.thrown = false; s.intercepted = false;
  s.tackleCooldown = 0; s.tackleWindow = 0; s.catchProtection = 0; s.aim = { x: 0, y: d };
}
function setup(s, team, spot = -30 * direction(team), conversion = false) {
  s.offense = team; s.line = clamp(spot, -48, 48); s.target = clamp(s.line + direction(team) * 10, -50, 50);
  s.down = 1; s.conversion = conversion; s.phase = 'select'; s.phaseTime = 0; s.aiPlay = (s.playNumber + team) % 3;
  formation(s);
}
function dead(s, message, next) {
  s.phase = 'dead'; s.phaseTime = 0; s.deadTime = 2.2; s.message = message; s.lastResult = message;
  s.next = next; s.charging = false; s.charge = 0; s.receiverButton=null;s.throwHold=0; s.ball.flight = null;
}
function touchdown(s) {
  feedback(s,'goal',1);
  if (s.conversion) {
    s.score[s.offense] += 2;
    dead(s, 'TWO-POINT CONVERSION!', { team: 1 - s.offense, spot: -30 * direction(1 - s.offense), conversion: false });
  } else {
    s.score[s.offense] += 6;
    dead(s, 'TOUCHDOWN! +6', { team: s.offense, spot: 47 * direction(s.offense), conversion: true });
  }
}
function endPlay(s, incomplete = false, reason = 'TACKLED') {
  if (s.conversion) {
    dead(s, 'CONVERSION STOPPED', { team: 1 - s.offense, spot: -30 * direction(1 - s.offense), conversion: false });
    return;
  }
  const d = direction(s.offense);
  const spot = incomplete ? s.line : clamp(s.players[s.carrier]?.y ?? s.line, -50, 50);
  if (!incomplete && spot * d >= 50) { touchdown(s); return; }
  if (!incomplete && spot * d <= -50) {
    s.score[1 - s.offense] += 2;
    dead(s, 'SAFETY! +2', { team: 1 - s.offense, spot: -30 * direction(1 - s.offense), conversion: false }); return;
  }
  if (s.intercepted) {
    dead(s, 'INTERCEPTION RETURN ENDS — NEW POSSESSION', { team: s.offense, spot, conversion: false }); return;
  }
  const gain = Math.round((spot - s.line) * d);
  if ((spot - s.target) * d >= -0.05) {
    dead(s, `FIRST DOWN! ${gain > 0 ? '+' : ''}${gain} YARDS`, { team: s.offense, spot, conversion: false }); return;
  }
  if (s.down === 4) {
    dead(s, 'TURNOVER ON DOWNS', { team: 1 - s.offense, spot, conversion: false }); return;
  }
  dead(s, incomplete ? 'INCOMPLETE PASS' : `${reason} · ${gain > 0 ? '+' : ''}${gain} YARDS`, { team: s.offense, spot, down: s.down + 1, target: s.target, conversion: false });
}
function snap(s) {
  formation(s);s.playNumber+=1;s.started=true;
  s.phase = 'live'; s.phaseTime = 0; s.snapTime = 0; s.message = s.offense === 0 ? 'FIND YOUR WINDOW' : 'DEFEND YOUR END ZONE';
  s.passReady = false;
  if((s.offense===0?s.play:s.aiPlay)===2)s.handoffPending=true;
}
function moveToward(p, target, speed, dt) {
  const dx = target.x - p.x, dy = target.y - p.y, n = Math.hypot(dx, dy);
  const scale = n > 0.05 ? Math.min(speed, n / dt) / n : 0;
  p.wishX = dx * scale; p.wishY = dy * scale;
}
function throwBall(s, power, vector) {
  const p = s.players[s.carrier];
  if (!p || s.thrown || (p.y - s.line) * direction(s.offense) > 0.5) return false;
  const n = norm(vector.x, vector.y), range = 7 + power * 37, duration = .38 + range / 52;
  const vx = n.x * range / duration + p.vx * .3, vy = n.y * range / duration + p.vy * .3;
  const vz = (1.6 - 1.7) / duration + 13 * (duration + 1 / 60) / 2;
  s.ball = { x: p.x, y: p.y, z: 1.7, carry: null, flight: {
    x: p.x, y: p.y, tx: p.x + vx * duration, ty: p.y + vy * duration,
    vx, vy, vz, elapsed: 0, duration, passer: p.id,
  } };
  s.carrier = -1; s.thrown = true; s.charge = 0; s.charging = false; s.message = 'BALL IN THE AIR';feedback(s,'pass',.35+power*.5);
  return true;
}
// Receiver choice supplies intent, not a guaranteed catch. The selected athlete and
// every defender still have to meet the descending physical ball in advanceBall.
function throwToReceiver(s, button, lead) {
  const qb=s.players[s.carrier],receiver=s.players[indexOf(s.offense,RECEIVERS.indexOf(button)+1)];
  if(!qb||!receiver||s.thrown||(qb.y-s.line)*direction(s.offense)>.5)return false;
  const type=passType(s.throwHold),range=distance(qb,receiver);
  const duration=clamp(type==='LOB'?.85+range/35:type==='TOUCH'?.46+range/47:.23+range/65,.35,1.9);
  const d=direction(s.offense),leadLength=Math.hypot(lead.x,lead.y),leadScale=leadLength>1?1/leadLength:1;
  const tx=clamp(receiver.x+receiver.vx*duration+lead.x*leadScale*d*2.1,-24,24);
  const ty=clamp(receiver.y+receiver.vy*duration-lead.y*leadScale*d*2.1,-56,56);
  s.ball={x:qb.x,y:qb.y,z:1.7,carry:null,flight:{x:qb.x,y:qb.y,tx,ty,
    vx:(tx-qb.x)/duration,vy:(ty-qb.y)/duration,vz:-.1/duration+13*(duration+1/60)/2,
    elapsed:0,duration,passer:qb.id,receiver:receiver.id,type}};
  s.carrier=-1;s.thrown=true;s.charge=0;s.charging=false;s.receiverButton=null;s.throwHold=0;
  s.message=`${type} PASS · ${RECEIVER_LABELS[receiver.slot-1]}`;
  feedback(s,'pass',type==='BULLET'?.85:type==='TOUCH'?.6:.4,s.message);
  return true;
}
function switchPlayer(s) {
  // Keep direct control of the ball on offense; switching is useful on defense and in flight.
  if (s.offense === 0 && s.carrier >= 0) { s.controlled = s.carrier; return; }
  const target = s.ball.flight ? { x: s.ball.flight.tx, y: s.ball.flight.ty } : s.carrier >= 0 ? s.players[s.carrier] : s.ball;
  const ranked = s.players.filter(p => p.team === 0 && p.id !== s.controlled).sort((a, b) => distance(a, target) - distance(b, target));
  if (ranked[0]) s.controlled = ranked[0].id;
}
// Swept sphere contact tests the entire flight segment against a moving catch volume.
// This avoids both frame tunnelling and snapping a ball to a distant receiver.
function sweptCatch(ballBefore, ballAfter, player, reach) {
  const start = { x: ballBefore.x - player.prevX, y: ballBefore.y - player.prevY, z: ballBefore.z - (reach ? 2.05 : 1.65) };
  const delta = { x: ballAfter.x - player.x - start.x, y: ballAfter.y - player.y - start.y, z: ballAfter.z - (reach ? 2.05 : 1.65) - start.z };
  const radius = reach ? 1.15 : .9;
  if (certifySportsSeparation(
    {x:ballBefore.x,y:ballBefore.z,z:ballBefore.y},{x:ballAfter.x,y:ballAfter.z,z:ballAfter.y},
    {x:player.prevX,y:reach?2.05:1.65,z:player.prevY},{x:player.x,y:reach?2.05:1.65,z:player.y},radius)) return null;
  const c = start.x ** 2 + start.y ** 2 + start.z ** 2 - radius ** 2;
  if (c <= 0) return 0;
  const a = delta.x ** 2 + delta.y ** 2 + delta.z ** 2;
  if (a < 1e-10) return null;
  const b = 2 * (start.x * delta.x + start.y * delta.y + start.z * delta.z);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}
function advanceBall(s, dt) {
  const f = s.ball.flight;
  if (!f) {
    const p = s.players[s.carrier];
    if (p) {
      const carry = s.ball.carry || { x: 0, y: 0, z: 1.3 };
      const settle = Math.min(1,dt * 9);
      carry.x *= 1-settle; carry.y *= 1-settle; carry.z += (1.3-carry.z)*settle;
      s.ball.carry = carry; s.ball.x = p.x + carry.x; s.ball.y = p.y + carry.y; s.ball.z = carry.z;
    }
    return;
  }
  const before = { x:s.ball.x, y:s.ball.y, z:s.ball.z };
  const physical = stepSportsBall({x:s.ball.x,y:s.ball.z,z:s.ball.y,vx:f.vx,vy:f.vz,vz:f.vy},dt,{gravity:13,floor:.22,restitution:0,friction:1});
  s.ball.x=physical.x; s.ball.y=physical.z; s.ball.z=physical.y;
  f.vx=physical.vx; f.vy=physical.vz; f.vz=physical.vy; f.elapsed+=dt;
  if (f.vz < 0 && f.elapsed > .12) {
    const contacts = s.players.filter(p=>p.id!==f.passer && p.stun<=0 && (p.team!==s.offense||p.slot>=1&&p.slot<=3)).map(p=>({p,t:sweptCatch(before,s.ball,p,p.id===s.controlled&&s.tackleWindow>0)})).filter(hit=>hit.t!==null).sort((a,b)=>a.t-b.t || a.p.id-b.p.id);
    const hit = contacts[0];
    if (hit) {
      const catcher=hit.p, intercepted=catcher.team!==s.offense;
      const impact={x:before.x+(s.ball.x-before.x)*hit.t,y:before.y+(s.ball.y-before.y)*hit.t,z:before.z+(s.ball.z-before.z)*hit.t};
      s.carrier=catcher.id; s.ball.flight=null; s.catchProtection=.18;
      s.ball.x=impact.x; s.ball.y=impact.y; s.ball.z=impact.z;
      s.ball.carry={x:impact.x-catcher.x,y:impact.y-catcher.y,z:impact.z};
      if(intercepted){
        if(s.conversion){endPlay(s,true);return;}
        s.offense=catcher.team;s.intercepted=true;s.message='INTERCEPTION! RUN IT BACK';
      }else s.message='COMPLETE! TURN UPFIELD';
      if(catcher.team===0)s.controlled=catcher.id;else if(intercepted)switchPlayer(s);
      feedback(s,intercepted?'save':'catch',intercepted?.9:.55);
      s.snapTime=Math.max(s.snapTime,1.2);
      return;
    }
  }
  if (s.ball.z <= .225 || f.elapsed > 4 || Math.abs(s.ball.x)>25 || Math.abs(s.ball.y)>60) endPlay(s,true);
}
function integrateAthletes(s,dt) {
  for(const p of s.players){
    p.prevX=p.x;p.prevY=p.y;
    const desiredSpeed=Math.hypot(p.wishX,p.wishY), currentSpeed=Math.hypot(p.vx,p.vy);
    const reversing=p.vx*p.wishX+p.vy*p.wishY<0;
    const acceleration=p.jukeTime>0?68:p.diveTime>0?60:reversing||desiredSpeed<currentSpeed?38:28;
    const dvx=p.wishX-p.vx,dvy=p.wishY-p.vy,change=Math.hypot(dvx,dvy);
    const amount=change>0?Math.min(1,acceleration*dt/change):0;
    p.vx+=dvx*amount;p.vy+=dvy*amount;
    if(p.stun>0){p.vx*=Math.max(0,1-dt*8);p.vy*=Math.max(0,1-dt*8);}
    const accepted=certifySportsMove({x:p.x,y:0,z:p.y},{x:clamp(p.x+p.vx*dt,-26,26),y:0,z:clamp(p.y+p.vy*dt,-59,59)},14*dt);
    p.x=accepted.x;p.y=accepted.z;
  }
}
function collideAthletes(s,dt) {
  const touched=new Set();
  for(let i=0;i<s.players.length;i++)for(let j=i+1;j<s.players.length;j++){
    const a=s.players[i],b=s.players[j];
    let dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);
    const carrier=a.id===s.carrier?a:b.id===s.carrier?b:null;
    const defender=carrier===a?b:carrier===b?a:null;
    const committed=defender?.diveTime>0;
    const spinRadius=carrier?.spinTime>0.1&&carrier.spinTime<.43?1.08:1.35;
    const radius=committed?1.65:spinRadius;
    if(len>radius)continue;
    if(len<.001){dx=(i%2?1:-1)*.01;dy=.01;len=Math.hypot(dx,dy);}
    const nx=dx/len,ny=dy/len,closing=(a.vx-b.vx)*nx+(a.vy-b.vy)*ny;
    // Equal-mass impulse transfers momentum to the contacted athlete. The
    // generated guard checks pair momentum and nonincreasing kinetic energy.
    if(closing>0){
      const impulse=closing*.575;
      const accepted=certifySportsPairCollision(
        {x:a.vx,y:0,z:a.vy},{x:b.vx,y:0,z:b.vy},
        {x:a.vx-impulse*nx,y:0,z:a.vy-impulse*ny},
        {x:b.vx+impulse*nx,y:0,z:b.vy+impulse*ny});
      a.vx=accepted.a.x;a.vy=accepted.a.z;b.vx=accepted.b.x;b.vy=accepted.b.z;
    }
    if(len<1.35){
      const correction=Math.min((1.35-len)*.5,dt*2);
      for(const [p,sign] of [[a,-1],[b,1]]){
        const accepted=certifySportsMove({x:p.prevX,y:0,z:p.prevY},{x:p.x+nx*correction*sign,y:0,z:p.y+ny*correction*sign},14*dt);
        p.x=accepted.x;p.y=accepted.z;
      }
    }
    if(carrier&&defender.team!==carrier.team&&s.snapTime>.65&&s.catchProtection===0&&defender.stun<=0){
      touched.add(carrier.id);
      const front=((defender.x-carrier.x)*carrier.facingX+(defender.y-carrier.y)*carrier.facingY)/Math.max(.1,len);
      const armWin=carrier.stiffTime>0&&!carrier.moveWon&&front>.2&&closing<8;
      const spinWin=carrier.spinTime>.1&&carrier.spinTime<.43&&!carrier.moveWon&&Math.abs(front)<.75&&closing<7;
      if(armWin||spinWin){
        carrier.moveWon=true;defender.stun=armWin?.42:.28;defender.diveTime=0;defender.recover=.4;
        carrier.balance=Math.min(1,carrier.balance+.25);
        feedback(s,'skill',.8,armWin?'STIFF ARM · KEEP YOUR FEET':'SPUN FREE');
        continue;
      }
      const resistance=carrier.protect?.43:carrier.jukeTime>0?.32:carrier.spinTime>.1?.55:1;
      let damage=dt*(2.7+Math.max(0,closing)*.4)*resistance;
      if(carrier.hitCooldown===0&&closing>3){damage+=(closing-3)*.09*resistance;carrier.hitCooldown=.25;}
      if(defender.wrapTime>0){damage+=.62*resistance;defender.wrapTime=0;defender.diveHit=true;feedback(s,'tackle',.45);}
      if(committed){damage+=.85*resistance;s.tackleWindow=0;defender.diveTime=0;defender.diveHit=true;defender.recover=.2;feedback(s,'tackle',.65);}
      carrier.balance=Math.max(0,carrier.balance-damage);
      if(carrier.balance<=0){feedback(s,'tackle',.9);endPlay(s,false,carrier.protect?'WRAPPED UP':'TACKLED');return;}
    }
  }
  for(const p of s.players)if(!touched.has(p.id))p.balance=Math.min(1,p.balance+dt*.7);
}
function runAI(s, dt) {
  const d = direction(s.offense), carrier = s.players[s.carrier];
  const play = s.offense === 0 ? s.play : s.aiPlay;
  const defense = s.offense === 0 ? s.aiPlay : s.play;
  for (const p of s.players) {
    if (p.id === s.controlled) continue;
    if (p.stun > 0 || p.recover > 0) { p.wishX = 0; p.wishY = 0; continue; }
    if (p.team === s.offense) {
      if(s.handoffPending&&p.slot===1){
        moveToward(p,s.players[indexOf(s.offense,0)],9,dt);
      } else if (p.id === s.carrier) {
        if(s.handoffPending){moveToward(p,p,0,dt);continue;}
        if (s.intercepted || s.thrown || p.slot !== 0 || play === 2 || s.snapTime > 5.5) {
          const threat = s.players.filter(q => q.team !== p.team).sort((a,b) => distance(p,a)-distance(p,b))[0];
          const evade = threat && distance(p, threat) < 6 ? clamp((p.x - threat.x) * 2, -6, 6) : -p.x * .06;
          moveToward(p, { x: clamp(p.x + evade, -22, 22), y: p.y + d * 10 }, 8.6, dt);
        } else moveToward(p, { x: Math.sin(s.snapTime * .9) * 2, y: s.line - d * 6.2 }, 3, dt);
      } else if (p.slot >= 4 && !s.thrown && !s.intercepted) {
        const opponents = s.players.filter(q => q.team !== p.team);
        const threat = opponents.find(q=>q.slot===p.slot)||opponents.sort((a,b) => distance(p,a)-distance(p,b))[0];
        const runBlock=play===2;
        moveToward(p,runBlock&&p.slot===6?{x:carrier.x+6*d,y:carrier.y+6*d}:{x:threat.x,y:s.line+.5*d},runBlock?7.5:5.2,dt);
      } else if (s.ball.flight) {
        const f = s.ball.flight;
        const near = Math.hypot(p.x - f.tx, p.y - f.ty);
        moveToward(p, near < 22 && (f.receiver===undefined||f.receiver===p.id) ? { x: f.tx, y: f.ty } : { x: p.x, y: p.y + d * 4 }, f.receiver===undefined||f.receiver===p.id?9.3:7.5, dt);
      } else if (carrier && (s.thrown || s.intercepted || (carrier.y - s.line) * d > 1)) {
        const candidates=s.players.filter(q=>q.team!==p.team).sort((a,b)=>distance(a,carrier)-distance(b,carrier));
        const enemy=candidates[(p.slot+1)%Math.min(4,candidates.length)];
        moveToward(p, {x:enemy.x,y:enemy.y-d*.7}, 7.7, dt);
      } else {
        const t = Math.min(s.snapTime, 7);
        const sign = p.slot % 2 === 0 ? -1 : 1;
        let x = p.slot === 1 ? -7 * d : sign * 17 * d;
        let y = s.line + d * (t * 7 - (p.slot === 1 ? 2 : 0));
        if (play === 1 && t > 1.2) x = clamp(x - sign * d * (t - 1.2) * 7, -21, 21);
        if (play === 2) { x = (p.slot === 1 ? -13 : sign * 20) * d; y = s.line + d * (p.slot === 1 ? 3 : t * 5); }
        moveToward(p, { x, y: clamp(y, -56, 56) }, 7.5, dt);
      }
    } else {
      const rush = p.slot >= 4 || defense === 1 && p.slot === 0;
      let target;
      if (s.ball.flight && s.ball.flight.elapsed>.18+(p.slot%3)*.04) target = { x: s.ball.flight.tx, y: s.ball.flight.ty };
      else if (carrier && (rush || s.thrown || s.intercepted || (carrier.y - s.line) * d > 0 || s.snapTime > 5.5)) target = { x: carrier.x + carrier.vx * clamp(distance(p,carrier)/22,.15,.8), y: carrier.y + carrier.vy * clamp(distance(p,carrier)/22,.15,.8) };
      else {
        const receiver = s.players[indexOf(s.offense, p.slot === 0 ? 1 : Math.min(p.slot, 3))];
        target = { x: receiver.x - receiver.vx*.16 + (p.slot === 0 ? 4 : 0), y: receiver.y - receiver.vy*.16 + d * (defense === 2 ? 5 : 2.8) };
      }
      let speed = carrier&&s.thrown?8.5:rush?6.7:7.4;
      // Linemen form a real pocket and receivers can screen a pursuing defender.
      const blocker = s.players.find(q => q.team === s.offense && q.id !== s.carrier && distance(p,q) < 1.8);
      if (blocker && s.snapTime < 5 && !s.ball.flight) {
        speed *= .3; target = { x: target.x + (p.x >= blocker.x ? 3 : -3), y: target.y };
      }
      moveToward(p, target || p, speed, dt);
      if(carrier&&!s.handoffPending&&s.snapTime>1&&p.diveCooldown===0&&distance(p,carrier)<2.8&&!s.ball.flight){
        beginDive(p,{x:carrier.x+carrier.vx*.12-p.x,y:carrier.y+carrier.vy*.12-p.y});
      }
    }
  }
  if(s.offense===1&&s.carrier===7&&!s.thrown&&!s.handoffPending&&play!==2&&s.snapTime>1.25){
    const qb=s.players[7],defenders=s.players.filter(p=>p.team===0);
    const candidates=s.players.filter(p=>p.team===1&&p.slot>0&&p.slot<4).flatMap(p=>{
      const flight=.38+distance(qb,p)/52;
      // Lead the receiver; try a back-shoulder placement as well as his route.
      return [0,-1.7,1.7].map(side=>{
        const target={x:clamp(p.x+p.vx*flight*.85+side,-22,22),y:clamp(p.y+p.vy*flight*.85,-54,54)};
        const receiverTravel=distance(p,target)/7.7;
        const arrival=.38+distance(qb,target)/52;
        const defenderArrival=Math.min(...defenders.map(q=>distance(q,target)/(q.id===s.controlled?9.8:8.5)));
        const separation=Math.min(...defenders.map(q=>Math.hypot(q.x+q.vx*arrival*.55-target.x,q.y+q.vy*arrival*.55-target.y)));
        return {target,room:separation,margin:defenderArrival-receiverTravel,arrival};
      });
    }).sort((a,b)=>(b.margin+b.room*.08)-(a.margin+a.room*.08));
    const best=candidates[0],pressure=Math.min(...defenders.map(p=>distance(p,qb)));
    if(best&&best.room>2.35&&best.margin>-.04&&s.snapTime>1.45+(s.playNumber%3)*.22){
      const length=distance(qb,best.target);
      throwBall(s,clamp((length-7)/37,0,1),{x:best.target.x-qb.x,y:best.target.y-qb.y});
    }else if(pressure<3||s.snapTime>3.8){
      // A covered read becomes a scramble, rather than a forced interception.
      s.thrown=true;s.message='CANYON QB SCRAMBLES';
    }
  }

}
function step(s, dt, raw = blankInput) {
  upgradeState(s);
  const input = { ...blankInput, ...raw };
  // Legacy aliases support saved/replayed keyboard inputs; production input has
  // the explicit receiver names, so contextual face buttons never overlap here.
  const receiverInput = (edges,button) => Boolean(edges[button] ?? (button==='receiverA'?edges.pass:button==='receiverX'?edges.shoot:false));
  dt = clamp(dt, 0, .05); s.frame += 1;
  if (s.phase === 'finished') {
    if (input.pressed.rematch || input.pressed.confirm) Object.assign(s, createState());
    return;
  }
  s.phaseTime += dt; if(s.started)s.time = Math.max(0, s.time - dt);
  if (s.time === 0 && s.phase !== 'live' && s.phase !== 'dead') { s.phase = 'finished'; s.message = s.score[0] === s.score[1] ? 'FINAL · DRAW' : s.score[0] > s.score[1] ? 'FINAL · YOU WIN!' : 'FINAL · CANYON WINS'; return; }
  if (s.phase === 'dead') {
    if (s.phaseTime >= s.deadTime || input.pressed.confirm) {
      if (s.time <= 0) { s.phase = 'finished'; s.message = s.score[0] === s.score[1] ? 'FINAL · DRAW' : s.score[0] > s.score[1] ? 'FINAL · YOU WIN!' : 'FINAL · CANYON WINS'; return; }
      const next = s.next; setup(s, next.team, next.spot, next.conversion);
      if (next.down) { s.down = next.down; s.target = next.target; }
      s.next = null;
    }
    return;
  }
  if (s.phase === 'select') {
    if (input.pressed.left) s.play = (s.play + 2) % 3;
    if (input.pressed.right) s.play = (s.play + 1) % 3;
    if (input.pressed.confirm || receiverInput(input.pressed,'receiverA') || s.offense === 1 && s.phaseTime > 5) snap(s);
    return;
  }
  s.snapTime += dt; s.catchProtection = Math.max(0,s.catchProtection-dt); s.tackleCooldown = Math.max(0, s.tackleCooldown-dt); s.tackleWindow = Math.max(0,s.tackleWindow-dt);
  for (const p of s.players) {
    p.stun = Math.max(0,p.stun-dt); p.jukeCooldown = Math.max(0,p.jukeCooldown-dt); p.jukeTime = Math.max(0,p.jukeTime-dt); p.hitCooldown = Math.max(0,p.hitCooldown-dt);
    for(const key of ['spinTime','stiffTime','stiffCooldown','diveCooldown','recover','wrapTime'])p[key]=Math.max(0,p[key]-dt);
    if(p.diveTime>0){p.diveTime=Math.max(0,p.diveTime-dt);if(p.diveTime===0){p.recover=.42;if(p.id===s.controlled&&!p.diveHit)feedback(s,'denied',.3,'MISSED TACKLE · RECOVER');}}
    p.protect = false; p.stamina = Math.min(1,p.stamina+dt*.13);
  }
  const quarterback = s.offense===0 && s.carrier===s.controlled && !s.thrown && !s.handoffPending;
  if (input.pressed.switch && !quarterback && (s.offense!==0||s.ball.flight)) switchPlayer(s);
  const d = direction(s.offense);
  const controlled = s.players[s.controlled];
  if(quarterback && (controlled.y-s.line)*d>.5){s.thrown=true;s.message='QB KEEPER';s.charging=false;s.receiverButton=null;s.throwHold=0;s.charge=0;}
  for(let i=0;i<3;i++)if(!receiverInput(input.held,RECEIVERS[i])&&!input.cancelled?.[RECEIVERS[i]])s.receiverReady[i]=true;
  s.passReady=s.receiverReady[0];
  if(quarterback&&!s.thrown){
    if(s.receiverButton&&input.cancelled?.[s.receiverButton]){s.receiverReady[RECEIVERS.indexOf(s.receiverButton)]=false;s.receiverButton=null;s.charging=false;s.throwHold=0;s.charge=0;}
    if(!s.charging){
      const button=RECEIVERS.find((key,i)=>s.receiverReady[i]&&!input.cancelled?.[key]&&(receiverInput(input.pressed,key)||receiverInput(input.held,key)));
      if(button){s.receiverButton=button;s.charging=true;s.throwHold=0;}
    }
    if(s.charging){
      s.throwHold+=dt;s.charge=clamp(s.throwHold/.65,0,1);
      if(receiverInput(input.released,s.receiverButton)||!receiverInput(input.held,s.receiverButton)){
        if(!throwToReceiver(s,s.receiverButton,raw.aim || input.move))s.message='PAST THE LINE — RUN IT IN';
        s.receiverButton=null;s.charging=false;s.throwHold=0;s.charge=0;
      }
    }
  }
  // In-flight A reaches without lunging. On defense A is a controlled wrap;
  // X commits momentum to a dive and can miss with a recovery cost.
  if(!quarterback&&input.pressed.conservativeTackle&&s.carrier!==controlled.id&&controlled.diveCooldown===0){
    if(s.ball.flight)s.tackleWindow=.35;
    else{controlled.wrapTime=.35;controlled.diveCooldown=.65;feedback(s,'skill',.2,'BREAK DOWN · WRAP UP');}
  }
  if(!quarterback&&input.pressed.tackle&&s.carrier!==controlled.id&&controlled.diveCooldown===0){
    const target=s.players[s.carrier]||s.ball;const moving=Math.hypot(input.move.x,input.move.y)>.15;
    beginDive(controlled,moving?{x:input.move.x*d,y:-input.move.y*d}:{x:target.x-controlled.x,y:target.y-controlled.y});
    s.tackleWindow=.27;s.tackleCooldown=1.25;feedback(s,'skill',.25,s.ball.flight?'REACH FOR THE BALL':'COMMIT TO THE TACKLE');
  }
  runAI(s, dt);
  controlled.protect = Boolean(input.held.shield && s.carrier===controlled.id);
  const sprinting=Boolean(input.held.sprint && !controlled.protect);
  if(sprinting && Math.hypot(input.move.x,input.move.y)>.2)controlled.stamina=Math.max(0,controlled.stamina-dt*.26);
  const skillDirection=input.gesture||input.skillDirection||input.move;
  if((input.pressed.skill||input.pressed.spin)&&s.carrier===controlled.id&&!s.charging){
    if(controlled.jukeCooldown>0||controlled.stamina<.28)feedback(s,'denied',.2,controlled.stamina<.28?'LOW STAMINA':'LET YOUR FEET RESET');
    else{
      controlled.moveWon=false;
      if(!input.pressed.spin&&Math.abs(skillDirection.x)>.25){
        controlled.jukeTime=.22;controlled.jukeCooldown=.9;controlled.jukeX=Math.sign(skillDirection.x)*d;controlled.stamina-=.26;
        feedback(s,'skill',.55,'JUKE · CUT INTO SPACE');
      }else if(input.pressed.spin&&s.thrown&&controlled.stamina>=.36){
        controlled.spinTime=.5;controlled.jukeCooldown=1.35;controlled.stamina-=.36;
        feedback(s,'skill',.55,'SPIN · BEAT THE GLANCING HIT');
      }else if(input.pressed.spin&&s.thrown)feedback(s,'denied',.2,'LOW STAMINA FOR SPIN');
    }
  }
  if(input.pressed.stiffArm&&s.carrier===controlled.id&&s.thrown&&controlled.stiffCooldown===0&&controlled.stamina>=.14){
    controlled.stiffTime=.24;controlled.stiffCooldown=1;controlled.moveWon=false;controlled.stamina-=.14;
    feedback(s,'skill',.3,'STIFF ARM · MEET THE DEFENDER');
  }
  controlled.strafe=Boolean(input.held.strafe&&s.offense!==0);
  let speed=controlled.wrapTime>0?4.8:controlled.strafe||controlled.protect?5.8:sprinting?8+1.8*Math.sqrt(controlled.stamina):8;
  controlled.wishX=input.move.x*d*speed;controlled.wishY=-input.move.y*d*speed;
  if(Math.hypot(input.move.x,input.move.y)>.2&&controlled.diveTime===0){const n=norm(controlled.wishX,controlled.wishY);controlled.facingX=n.x;controlled.facingY=n.y;}
  if(controlled.strafe){const target=s.players[s.carrier]||s.ball;const facing=norm(target.x-controlled.x,target.y-controlled.y);controlled.facingX=facing.x;controlled.facingY=facing.y;}
  if(controlled.jukeTime>0){controlled.wishX=controlled.jukeX*12.8;controlled.wishY*=.88;}
  if(controlled.spinTime>0){controlled.wishX*=.8;controlled.wishY*=.8;}
  if(s.handoffPending&&controlled.id===indexOf(s.offense,0)){controlled.wishX*=.25;controlled.wishY*=.25;}
  for(const p of s.players){
    if(p.diveTime>0){p.wishX=p.diveX*11.5;p.wishY=p.diveY*11.5;}
    if(p.stun>0||p.recover>0){p.wishX=0;p.wishY=0;}
  }
  integrateAthletes(s,dt);
  collideAthletes(s,dt);
  if(s.phase!=='live')return;
  handoff(s,dt);
  advanceBall(s,dt,input);
  if (s.phase !== 'live') return;
  if (s.carrier >= 0) {
    const carrier = s.players[s.carrier]; const attack = direction(s.offense);
    if (carrier.y * attack >= FIELD) { touchdown(s); return; }
    if (Math.abs(carrier.x) >= 24.7) { endPlay(s,false,'OUT OF BOUNDS'); return; }

  }
  if (s.snapTime > 26) endPlay(s,s.carrier < 0,'PLAY CLOCK');
}
function cancelInput(s) {
  s.charge = 0; s.charging = false; s.passReady = false; s.receiverButton=null;s.receiverReady=[false,false,false];s.throwHold=0; s.tackleWindow = 0;
  for(const p of s.players){p.protect=false;p.wishX=0;p.wishY=0;}
}
function validateState(s) {
  upgradeState(s);
  if (!s || s.schema !== 5 || !['select','live','dead','finished'].includes(s.phase)) throw new Error('Unsupported football save');
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  for (const key of ['frame','time','phaseTime','line','target','charge','tackleCooldown','tackleWindow','catchProtection','snapTime','deadTime']) if (!finite(s[key])) throw new Error(`Invalid football ${key}`);
  if(![null,...RECEIVERS].includes(s.receiverButton)||!Array.isArray(s.receiverReady)||s.receiverReady.length!==3||!s.receiverReady.every(v=>typeof v==='boolean')||!finite(s.throwHold)||s.throwHold<0||s.charging!==(s.receiverButton!==null))throw new Error('Invalid football receiver controls');
  if (!Number.isInteger(s.playNumber)||s.playNumber<0) throw new Error('Invalid football play count');
  if (!Number.isInteger(s.frame) || s.frame < 0 || s.charge < 0 || s.charge > 1 || !['started','conversion','charging','passReady','thrown','intercepted'].every(k=>typeof s[k] === 'boolean')) throw new Error('Invalid football controls');
  if (!Array.isArray(s.score) || s.score.length!==2 || !s.score.every(v=>finite(v)&&v>=0) || s.time<0 || s.time>600 || ![0,1].includes(s.offense) || ![1,2,3,4].includes(s.down) || ![0,1,2].includes(s.play) || ![0,1,2].includes(s.aiPlay)) throw new Error('Invalid football match');
  if(typeof s.handoffPending!=='boolean'||!finite(s.handoffTime)||s.handoffTime<0) throw new Error('Invalid football handoff');
  if(s.feedback&&(!Number.isInteger(s.feedback.id)||s.feedback.id<1||!finite(s.feedback.strength)||s.feedback.strength<0||s.feedback.strength>1)) throw new Error('Invalid football feedback');
  if (!Array.isArray(s.players) || s.players.length !== 14) throw new Error('Invalid football teams');
  s.players.forEach((p,i)=>{ if(p.id!==i||p.team!==Math.floor(i/7)||p.slot!==i%7||!['x','y','vx','vy','wishX','wishY','prevX','prevY','stun','stamina','balance','jukeCooldown','jukeTime','jukeX','hitCooldown','spinTime','stiffTime','stiffCooldown','diveTime','diveCooldown','diveX','diveY','recover','wrapTime','facingX','facingY'].every(k=>finite(p[k]))||Math.abs(p.x)>30||Math.abs(p.y)>65||p.stamina<0||p.stamina>1||p.balance<0||p.balance>1||typeof p.protect!=='boolean'||typeof p.strafe!=='boolean') throw new Error('Invalid football athlete'); });
  if(!Number.isInteger(s.controlled)||s.controlled<0||s.controlled>6||!Number.isInteger(s.carrier)||s.carrier< -1||s.carrier>13||!s.ball||!['x','y','z'].every(k=>finite(s.ball[k]))||!s.aim||!finite(s.aim.x)||!finite(s.aim.y)) throw new Error('Invalid football ball');
  if(s.ball.carry && !['x','y','z'].every(k=>finite(s.ball.carry[k]))) throw new Error('Invalid football catch');
  if(s.ball.flight && (!['x','y','tx','ty','vx','vy','vz','elapsed','duration','passer'].every(k=>finite(s.ball.flight[k])) || s.ball.flight.duration <= 0 || !Number.isInteger(s.ball.flight.passer) || s.ball.flight.passer < 0 || s.ball.flight.passer > 13)) throw new Error('Invalid football pass');
  if(s.phase==='dead' && (!s.next||![0,1].includes(s.next.team)||!finite(s.next.spot))) throw new Error('Invalid football next play');
  return true;
}
function fieldTexture(THREE) {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 2048;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#187851'; ctx.fillRect(0,0,1024,2048);
  const sx = 1024/50, sy = 2048/120;
  for(let n=0;n<10;n++){ctx.fillStyle=n%2?'#1c8058':'#18714e';ctx.fillRect(0,(10+n*10)*sy,1024,10*sy);}
  ctx.fillStyle='#12b7ac';ctx.fillRect(0,0,1024,10*sy);
  ctx.fillStyle='#d8572b';ctx.fillRect(0,110*sy,1024,10*sy);
  ctx.strokeStyle='rgba(235,255,243,.8)';ctx.lineWidth=3;
  for(let n=10;n<=110;n+=5){ctx.beginPath();ctx.moveTo(0,n*sy);ctx.lineTo(1024,n*sy);ctx.stroke();}
  ctx.lineWidth=6;ctx.strokeRect(3,10*sy,1018,100*sy);
  ctx.lineWidth=2;
  for(let n=11;n<110;n++){for(const x of [2,18,32,48]){ctx.beginPath();ctx.moveTo(x*sx,n*sy);ctx.lineTo((x+.8)*sx,n*sy);ctx.stroke();}}
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='bold 52px sans-serif';ctx.fillStyle='rgba(255,255,255,.78)';
  for(let n=20;n<110;n+=10){const label=String(Math.min(n-10,110-n));ctx.fillText(label,8*sx,n*sy);ctx.save();ctx.translate(42*sx,n*sy);ctx.rotate(Math.PI);ctx.fillText(label,0,0);ctx.restore();}
  ctx.font='900 83px sans-serif';ctx.fillStyle='rgba(255,255,255,.95)';ctx.fillText('ALDER',512,5*sy);
  ctx.save();ctx.translate(512,115*sy);ctx.rotate(Math.PI);ctx.fillText('CANYON',0,0);ctx.restore();
  ctx.fillStyle='rgba(240,255,248,.12)';ctx.beginPath();ctx.arc(512,1024,122,0,Math.PI*2);ctx.fill();
  ctx.font='900 115px sans-serif';ctx.fillStyle='rgba(255,255,255,.38)';ctx.fillText('A',512,1024);
  const tex = new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=4;return tex;
}
function buildScene({THREE,scene,camera,renderer}) {
  scene.background = new THREE.Color('#08192b');
  scene.fog = new THREE.Fog('#08192b',125,260);
  const mat = (color,options={}) => new THREE.MeshStandardMaterial({color,roughness:.75,...options});
  const mesh = (geometry,material,x,y,z,parent=scene) => {const m=new THREE.Mesh(geometry,material);m.position.set(x,y,z);parent.add(m);return m;};
  scene.add(new THREE.HemisphereLight('#d9faff','#153d32',2.1));
  const key=new THREE.DirectionalLight('#e6f5ff',2.5);key.position.set(-25,65,25);scene.add(key);
  const rim=new THREE.DirectionalLight('#ffa76f',.9);rim.position.set(30,25,-60);scene.add(rim);
  mesh(new THREE.BoxGeometry(260,1,270),mat('#102a32'),0,-.7,0);
  const turf=mesh(new THREE.PlaneGeometry(50,120),new THREE.MeshStandardMaterial({map:fieldTexture(THREE),roughness:1}),0,.02,0);turf.rotation.x=-Math.PI/2;
  // A broad track and bright sidelines give the playing surface a crisp silhouette.
  const track=mesh(new THREE.PlaneGeometry(62,132),mat('#203d48'),0,0,0);track.rotation.x=-Math.PI/2;
  for(const x of [-26,26]) mesh(new THREE.BoxGeometry(.25,.12,120),mat('#e1fff8'),x,.08,0);
  const teal=mat('#13d6c4',{emissive:'#0c5e59',emissiveIntensity:.4});const coral=mat('#ff753f',{emissive:'#6a2711',emissiveIntensity:.3});
  for(const side of [-1,1]) {
    for(let tier=0;tier<6;tier++) mesh(new THREE.BoxGeometry(5,1.5,128),mat(tier%2?'#18384e':'#24485c'),side*(34+tier*4),tier*1.7+.7,0);
    mesh(new THREE.BoxGeometry(.7,1.5,130),side<0?teal:coral,side*30,1.5,0);
    for(const z of [-66,66]) mesh(new THREE.BoxGeometry(58,3,4),mat('#15364b'),0,1.5,z);
  }
  // Instancing keeps the crowd lively without hundreds of draw calls.
  const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(.65,1.1,.65),mat('#83b9cc'),456);
  const dummy=new THREE.Object3D();const crowdColor=new THREE.Color();let index=0;
  for(const side of [-1,1]) for(let tier=0;tier<6;tier++) for(let n=0;n<38;n++) {
    dummy.position.set(side*(34+tier*4),tier*1.7+2,(n-18.5)*3.2);dummy.rotation.y=(n%3)*.2;dummy.updateMatrix();crowd.setMatrixAt(index,dummy.matrix);
    crowdColor.set([0x58b8c3,0xf58956,0xc5d6db,0x214964,0xe9c76d][(n+tier*3)%5]);crowd.setColorAt(index++,crowdColor);
  }
  scene.add(crowd);
  for(const x of [-29,29]) for(const z of [-52,52]) {
    mesh(new THREE.CylinderGeometry(.22,.4,24,8),mat('#b4c9d5'),x,12,z);
    mesh(new THREE.BoxGeometry(6,1.6,1),mat('#efffff',{emissive:'#d6f8ff',emissiveIntensity:2}),x,24,z);
  }
  // Goal-line pylons, chain markers, benches, and coach boxes supply scale.
  for(const x of [-24.6,24.6]) for(const z of [-50,50])mesh(new THREE.BoxGeometry(.55,1.15,.55),coral,x,.6,z);
  for(const x of [-29,29]) for(const z of [-15,15]){
    mesh(new THREE.BoxGeometry(1,.55,7),mat('#b2ccd4'),x,.8,z);
    mesh(new THREE.BoxGeometry(1,.8,7),mat('#335269'),x,1.3,z);
  }
  const players=[];const skin=mat('#b77f5c');const dark=mat('#18232d');const white=mat('#f0f8f8');
  for(let i=0;i<14;i++){
    const team=Math.floor(i/7);const group=new THREE.Group();scene.add(group);
    const jersey=team===0?teal:coral;
    mesh(new THREE.BoxGeometry(1.1,.95,.65),jersey,0,1.32,0,group);
    mesh(new THREE.BoxGeometry(1.65,.4,.75),jersey,0,1.66,0,group);
    mesh(new THREE.SphereGeometry(.44,12,10),team===0?white:dark,0,2.13,0,group);
    mesh(new THREE.BoxGeometry(.59,.23,.12),dark,0,2.06,-.38,group);
    mesh(new THREE.BoxGeometry(.64,.07,.14),white,0,1.95,-.44,group);
    const legs=[],arms=[];
    for(const sign of [-1,1]){
      const leg=new THREE.Group();leg.position.set(sign*.31,.94,0);group.add(leg);
      mesh(new THREE.BoxGeometry(.38,.65,.43),team===0?white:mat('#fee3d1'),0,-.27,0,leg);
      mesh(new THREE.BoxGeometry(.29,.35,.31),skin,0,-.68,0,leg);
      mesh(new THREE.BoxGeometry(.4,.21,.62),dark,0,-.84,-.1,leg);legs.push(leg);
      const arm=new THREE.Group();arm.position.set(sign*.76,1.62,0);group.add(arm);
      mesh(new THREE.BoxGeometry(.32,.7,.35),skin,0,-.26,0,arm);
      mesh(new THREE.BoxGeometry(.35,.19,.4),white,0,-.65,0,arm);arms.push(arm);
    }
    // Chest stripe remains readable without tiny text or detailed licensed uniforms.
    mesh(new THREE.BoxGeometry(.4,.42,.03),team===0?dark:white,0,1.4,-.34,group);
    const shadow=mesh(new THREE.CircleGeometry(.95,16),new THREE.MeshBasicMaterial({color:'#001e20',transparent:true,opacity:.35,depthWrite:false}),0,.05,0,group);shadow.rotation.x=-Math.PI/2;
    const receiverRing=mesh(new THREE.RingGeometry(1.65,1.82,36),new THREE.MeshBasicMaterial({color:'#5dffd0',side:THREE.DoubleSide,transparent:true,opacity:.75}),0,.15,0);receiverRing.rotation.x=-Math.PI/2;receiverRing.visible=false;
    let receiverLabel=null;
    if(team===0&&i>0&&i<4){
      const icon=document.createElement('canvas');icon.width=128;icon.height=128;const ctx=icon.getContext('2d');
      ctx.fillStyle=['#27ba65','#e84d53','#3898f0'][i-1];ctx.beginPath();ctx.arc(64,64,54,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='#ffffff';ctx.lineWidth=6;ctx.stroke();ctx.font='bold 72px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#ffffff';ctx.fillText(RECEIVER_LABELS[i-1],64,68);
      const texture=new THREE.CanvasTexture(icon);texture.colorSpace=THREE.SRGBColorSpace;
      receiverLabel=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false,transparent:true}));receiverLabel.scale.set(2.1,2.1,1);receiverLabel.renderOrder=5;scene.add(receiverLabel);
    }
    players.push({group,legs,arms,receiverRing,receiverLabel});
  }
  const ball=mesh(new THREE.SphereGeometry(.42,16,10),mat('#a45a2c'),0,2,0);ball.scale.set(.7,.7,1.25);
  const ballStripe=mesh(new THREE.TorusGeometry(.27,.045,5,16),white,0,0,.25,ball);ballStripe.rotation.x=Math.PI/2;
  const ring=mesh(new THREE.RingGeometry(1.1,1.4,40),new THREE.MeshBasicMaterial({color:'#ffe45e',side:THREE.DoubleSide}),0,.13,0);ring.rotation.x=-Math.PI/2;
  const pointer=mesh(new THREE.ConeGeometry(.33,.6,3),new THREE.MeshBasicMaterial({color:'#ffe45e'}),0,3,0);pointer.rotation.z=Math.PI;
  const scrimmage=mesh(new THREE.BoxGeometry(50,.07,.18),new THREE.MeshBasicMaterial({color:'#53c9ff',transparent:true,opacity:.75}),0,.1,30);
  const firstDown=mesh(new THREE.BoxGeometry(50,.07,.2),new THREE.MeshBasicMaterial({color:'#ffda47',transparent:true,opacity:.9}),0,.1,20);
  const target=mesh(new THREE.RingGeometry(1.65,1.9,40),new THREE.MeshBasicMaterial({color:'#ffe673',side:THREE.DoubleSide,transparent:true,opacity:.9}),0,.17,0);target.rotation.x=-Math.PI/2;
  const trajectory=new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({length:25},()=>new THREE.Vector3())),new THREE.LineDashedMaterial({color:'#ffe673',dashSize:1,gapSize:.6,transparent:true,opacity:.85}));trajectory.frustumCulled=false;scene.add(trajectory);
  const routes=[];
  for(let i=0;i<3;i++){
    const route=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()]),new THREE.LineDashedMaterial({color:'#6effea',dashSize:1,gapSize:.55,transparent:true,opacity:.7}));route.frustumCulled=false;scene.add(route);routes.push(route);
  }
  camera.fov=49;camera.near=.1;camera.far=350;camera.updateProjectionMatrix();camera.position.set(0,48,60);camera.lookAt(0,0,15);
  return {THREE,players,ball,ring,pointer,scrimmage,firstDown,target,trajectory,routes,focus:30,cameraDirection:null};
}
function render({state:s,view:v,camera,dt}) {
  const {THREE}=v;
  for(const p of s.players){
    const model=v.players[p.id];model.group.position.set(p.x,0,-p.y);
    const running=s.phase==='live'?Math.hypot(p.vx,p.vy):0;
    const desired=p.strafe?Math.atan2(-p.facingX,p.facingY):running>.2?Math.atan2(-p.vx,p.vy):(p.team===s.offense?direction(s.offense):-direction(s.offense))===1?0:Math.PI;
    model.group.rotation.y=desired+(p.spinTime>0?(1-p.spinTime/.5)*Math.PI*2:0);
    model.group.rotation.z=p.jukeTime>0?-p.jukeX*.28:p.hitCooldown>0?Math.sin(p.hitCooldown*30)*.15:0;
    model.group.rotation.x=p.diveTime>0?.9:p.recover>0?.5:p.protect?.22:0;
    const gait=Math.sin(s.frame*.24+p.id)*Math.min(running/9,1)*.65;
    model.legs[0].rotation.x=gait;model.legs[1].rotation.x=-gait;
    model.arms[0].rotation.x=-gait*.8;model.arms[1].rotation.x=gait*.8;
    if(p.id===s.carrier){model.arms[1].rotation.x=p.protect?-1.65:-1;model.arms[1].rotation.z=-.3;if(p.protect)model.arms[0].rotation.x=-1.5;}else model.arms[1].rotation.z=0;
    if(s.ball.flight&&distance(p,s.ball)<3&&s.ball.z<4.2){model.arms[0].rotation.x=-2.4;model.arms[1].rotation.x=-2.4;}
    model.receiverRing.visible=s.offense===0&&p.team===0&&p.slot>0&&p.slot<4&&!s.thrown&&!s.handoffPending&&s.phase==='live';
    if(model.receiverLabel){
      model.receiverLabel.visible=s.offense===0&&!s.thrown&&!s.handoffPending&&(s.phase==='select'&&s.play!==2||s.phase==='live');
      model.receiverLabel.position.set(p.x,4.2,-p.y);
      const selected=s.receiverButton===RECEIVERS[p.slot-1];model.receiverLabel.scale.setScalar(selected?2.8:2.1);
      model.receiverLabel.material.opacity=s.charging&&!selected?.55:1;
    }
    if(model.receiverRing.visible){
      const room=Math.min(...s.players.filter(q=>q.team!==p.team).map(q=>distance(q,p)));
      model.receiverRing.material.color.set(room>2.4?'#5dffd0':'#9bc3db');model.receiverRing.material.opacity=room>2.4?.85:.28;
      model.receiverRing.position.set(p.x,.15,-p.y);
    }
    model.arms[0].rotation.z=p.stiffTime>0?-.8:0;if(p.stiffTime>0)model.arms[0].rotation.x=-1.5;
    model.group.position.y=running>.5?Math.abs(Math.sin(s.frame*.24+p.id))*.08:0;
    if(s.phase==='dead' && /TOUCHDOWN|CONVERSION!/.test(s.message) && p.team===s.offense){model.arms[0].rotation.x=-2.6;model.arms[1].rotation.x=-2.6;model.group.position.y=Math.max(0,Math.sin(s.phaseTime*7+p.id))*.4;}
  }
  v.ball.position.set(s.ball.x,s.ball.z,-s.ball.y);v.ball.rotation.x=s.ball.flight?s.frame*.35:0;
  const active=s.players[s.controlled];v.ring.position.set(active.x,.14,-active.y);v.pointer.position.set(active.x,3.25+Math.sin(s.frame*.08)*.12,-active.y);
  v.ring.material.color.set(active.jukeTime>0||active.spinTime>0?'#64fff0':active.protect?'#79b8ff':active.stamina<.28?'#ff935c':'#ffe45e');
  v.ring.scale.setScalar(1+Math.sin(s.frame*.08)*.06);v.ring.visible=s.phase!=='finished';v.pointer.visible=s.phase!=='finished';
  v.scrimmage.position.z=-s.line;v.firstDown.position.z=-s.target;
  v.scrimmage.visible=!s.intercepted;v.firstDown.visible=!s.intercepted&&!s.conversion;
  const d=direction(s.offense);
  const f=s.ball.flight;v.target.visible=Boolean(f);v.trajectory.visible=false;
  if(f)v.target.position.set(f.tx,.18,-f.ty);
  const selecting=s.phase==='select';
  for(let i=0;i<3;i++){
    const route=v.routes[i];route.visible=selecting&&s.offense===0;
    if(route.visible){const p=s.players[i+1];const attr=route.geometry.attributes.position;const sign=(i+1)%2===0?-1:1;
      attr.setXYZ(0,p.x,.18,-p.y);attr.setXYZ(1,p.x,.18,-(p.y+9*d));
      attr.setXYZ(2,s.play===1?p.x-sign*d*18:s.play===2?p.x+sign*3:p.x,.18,-clamp(p.y+(s.play===2?12:27)*d,-56,56));
      if(s.play===2&&i===0){attr.setXYZ(1,0,.18,-(s.line-4*d));attr.setXYZ(2,12*d,.18,-(s.line+6*d));}
      attr.needsUpdate=true;route.computeLineDistances();}
  }
  const focusY=s.phase==='select'?s.line:s.ball.y;
  const targetZ=-clamp(focusY,-39,39);
  const follow = Math.min(1,(dt||1/60)*3);
  if(v.cameraDirection===null)v.focus=targetZ;
  else v.focus += (targetZ-v.focus)*follow;
  const desired = new THREE.Vector3(s.ball.x*.28,37,v.focus+35*d);
  if(v.cameraDirection===null)camera.position.copy(desired);
  else if(v.cameraDirection!==d){
    // Movement changes ends with possession. Reflect only the orbit offset now,
    // so screen-relative controls agree immediately while field tracking stays smooth.
    camera.position.z=v.focus+Math.max(24,Math.abs(camera.position.z-v.focus))*d;
  }
  v.cameraDirection=d;
  camera.position.lerp(desired,follow);camera.lookAt(s.ball.x*.2,0,v.focus-8*d);
}
function hud(s) {
  const offense=s.offense===0;const yards=Math.max(1,Math.ceil((s.target-s.line)*direction(s.offense)));
  const ordinal=['','1ST','2ND','3RD','4TH'][s.down];
  const possession=offense?'ALDER BALL':'CANYON BALL';
  const label=s.phase==='finished'?'FINAL':s.conversion?'TWO-POINT ATTEMPT':`${ordinal} & ${Math.abs(s.target)===50?'GOAL':yards} · ${possession}`;
  let detail;
  if(s.phase==='select')detail=offense?'← / → or D-pad: play • A / J / Enter: snap':'← / → or D-pad: coverage • A / J / Enter: ready • AI snaps in 5s';
  else if(s.phase==='dead')detail='A new play is lining up • Enter: skip replay pause';
  else if(s.phase==='finished')detail='Enter: rematch • Menu: return to Alder District';
  else if(s.ball.flight)detail='B / Q: switch • A / J: reach • X / K: dive • Left stick: move';
  else if(offense)detail=s.handoffPending?'Automatic handoff · follow your lead blocker':s.thrown?'RS sideways: juke · B / U: spin · A / J: stiff arm · RB / C: protect · RT: sprint':'A / J · B / U · X / K: receiver • Tap: lob · Brief hold: touch · Hold: bullet • LS: lead';
  else detail='B / Q: switch · X / K / L: dive tackle · A / J: wrap tackle · LT / V: strafe · RT: sprint';
  return {score:[...s.score],teamNames:['ALDER','CANYON'],clock:s.time,label,message:s.phase==='select'?(offense?'CHOOSE YOUR PLAY':'SET YOUR DEFENSE'):s.phase==='live'&&s.actionMessage&&s.frame<s.actionMessage.until?s.actionMessage.text:s.message,detail,power:s.charge,stamina:s.players[s.controlled].stamina,skillHint:s.ball.flight?'B switch · A reach':offense?(!s.thrown?(s.play===2?'Run play · handoff happens automatically':s.charging?`${RECEIVER_LABELS[RECEIVERS.indexOf(s.receiverButton)]} · ${passType(s.throwHold)} · release to throw`:'A/B/X receiver · LS lead · tap lob / hold bullet'):'RS side: juke · B: spin · A: stiff arm · RB: protect'):'A wraps under control · X dives with recovery',passType:s.charging?passType(s.throwHold):null,selectedReceiver:s.receiverButton?RECEIVER_LABELS[RECEIVERS.indexOf(s.receiverButton)]:null,skillReady:s.players[s.controlled].jukeCooldown===0&&s.players[s.controlled].stamina>=.28,finished:s.phase==='finished',plays:s.phase==='select'?(offense?OFFENSE:DEFENSE):undefined,selectedPlay:s.play};
}
export const footballDefinition = {id:'football',title:'Alder Gridiron',createState,validateState,cancelInput,step,buildScene,render,hud};
