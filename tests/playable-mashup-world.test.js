import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, Q8, pixelToQ8, q8ToPixel, syncPosition, worldToShapeProbe, requireShapeProbe, resolveTerrain, admitJump, resetToCheckpoint, updateCamera } from '../src/playable-mashup-world.js';
const world = () => createWorld({ width: 640, height: 240, spawn: {x: 32, y: 200}, checkpoints: [{id: 'gate', x: 400, y: 200}], solids: [{x: 0,y: 200,width: 200,height: 40},{x: 300,y: 200,width: 340,height: 40},{x: 120,y: 120,width: 40,height: 16}], hazards: [{x: 210,y: 220,width: 80,height: 20}] });
const actor = (x = 32, y = 200) => ({xQ8: x*Q8,yQ8: y*Q8,vxQ8: 0,vyQ8: 0,grounded: false});
test('exact authored signed Q8 conversions floor negatives and reject overflow or implicit casts', () => {
  assert.equal(pixelToQ8(-1), -256); assert.equal(q8ToPixel(-1), -1); assert.equal(q8ToPixel(-257), -2);
  assert.equal(pixelToQ8(32767),8388352);
  for (const v of [8388608, -8388609, 1.5, NaN, Infinity]) assert.throws(() => pixelToQ8(v), RangeError);
  for (const v of [2147483648,-2147483649,1.5]) assert.throws(() => q8ToPixel(v),RangeError);
  const a=actor(); a.xQ8=-1; syncPosition(a); assert.equal(a.x,-1);
});
test('world-to-cell adapter is explicit and world coordinates cannot directly bind shape1', () => {
  const w=world(), probe=worldToShapeProbe(w,31*Q8+255,17*Q8);
  assert.deepEqual([probe.column,probe.row,probe.localX,probe.localY,probe.index],[1,1,15,1,31]);
  assert.equal(requireShapeProbe(probe),31);
  assert.throws(() => requireShapeProbe({index:31*Q8,quantity:'world_y',frame:'world'}),/cannot bind directly/);
  assert.throws(() => requireShapeProbe({...probe,index:256}),RangeError);
  assert.throws(() => worldToShapeProbe(w,-1,0),RangeError);
  assert.throws(() => worldToShapeProbe(w,640*Q8,0),RangeError);
  assert.throws(() => worldToShapeProbe({...w,tileSize:8},0,0),/16px/);
});
test('ground contact, jump admission and swept landing keep mirrors coherent', () => {
  const w=world(), a=actor();
  assert.equal(resolveTerrain(w,a,{...a}).grounded,true);
  assert.equal(admitJump(a,{pressed:false}),false); assert.equal(admitJump(a,{pressed:true}),true);
  assert.equal(admitJump(a,{pressed:true}),false);
  let landed=false, ticks=0;
  for (;ticks<80;ticks++) {
    const previous={...a}; a.xQ8+=a.vxQ8; a.yQ8+=a.vyQ8; a.vyQ8+=64;
    const contact=resolveTerrain(w,a,previous);
    assert.equal(a.x,Math.floor(a.xQ8/256)); assert.equal(a.y,Math.floor(a.yQ8/256));
    if(contact.landed) {landed=true;break;}
  }
  assert.equal(landed,true); assert.ok(ticks>10); assert.equal(a.yQ8,200*Q8); assert.equal(a.vyQ8,0); assert.equal(a.grounded,true);
});
test('side and underside contacts reject traversal through solids', () => {
  const w=world(), a=actor(100,130), previous={...a}; a.xQ8=140*Q8; a.vxQ8=40*Q8;
  assert.equal(resolveTerrain(w,a,previous).hitWall,true); assert.equal(a.x,114); assert.equal(a.vxQ8,0);
  const b=actor(140,160), before={...b}; b.yQ8=135*Q8; b.vyQ8=-25*Q8;
  assert.equal(resolveTerrain(w,b,before).hitCeiling,true); assert.equal(b.y,150); assert.equal(b.vyQ8,0);
});
test('hazard and fall recovery reset stale integer/fixed backing, velocity, ground and camera together', () => {
  const w=world(), a=actor(250,225), camera={x:0,y:0,width:160,height:120};
  assert.equal(resolveTerrain(w,a,{...a}).hazard,true);
  Object.assign(a,{x:0,y:65535,xQ8:20*Q8,yQ8:16*Q8,vxQ8:888,vyQ8:-777,grounded:false});
  resetToCheckpoint(w,a,camera,'gate');
  assert.deepEqual([a.x,a.y,a.xQ8,a.yQ8,a.vxQ8,a.vyQ8,a.grounded],[400,200,102400,51200,0,0,true]);
  assert.deepEqual(camera,{x:320,y:120,width:160,height:120});
  a.xQ8=250*Q8; a.yQ8=250*Q8;
  assert.equal(resolveTerrain(w,a,{...a}).hazard,true);
  resetToCheckpoint(w,a,camera); assert.equal(a.x,32); assert.equal(camera.x,0);
});
test('invalid reset is atomic and invalid motion/camera/domain never silently wrap', () => {
  const w=world(), a=actor(), camera={x:5,y:0,width:160,height:120}, before={...a};
  assert.throws(() => resetToCheckpoint(w,a,camera,'missing'),/unknown checkpoint/); assert.deepEqual(a,before);
  assert.throws(() => resetToCheckpoint(w,a,{...camera,width:NaN}),RangeError); assert.deepEqual(a,before);
  assert.throws(() => resolveTerrain(w,{...a,xQ8:a.xQ8+65*Q8},a),/sweep budget/);
  assert.throws(() => createWorld({width:640,height:240,spawn:{x:-1,y:0}}),RangeError);
  assert.throws(() => updateCamera(w,a,{width:0,height:120}),RangeError);
  const unsafe=createWorld({width:640,height:240,spawn:{x:100,y:220},solids:[{x:0,y:200,width:640,height:40}]});
  assert.throws(() => resetToCheckpoint(unsafe,a,camera),/unsafe terrain/); assert.deepEqual(a,before);
});

test('thin hazards are swept and checkpoint bodies must fit without relocating', () => {
  const w=createWorld({width:160,height:160,spawn:{x:32,y:100},hazards:[{x:50,y:80,width:1,height:20}]});
  const a=actor(32,100), previous={...a}; a.xQ8=90*Q8; a.vxQ8=58*Q8;
  assert.equal(resolveTerrain(w,a,previous).hazard,true);
  const edge=createWorld({width:160,height:160,spawn:{x:0,y:100}});
  assert.throws(() => resetToCheckpoint(edge,a,{width:80,height:80}),/unsafe terrain/);
});

test('initial terrain penetration fails explicitly instead of silently retaining incoherent contact', () => {
  const w=world(), a=actor(100,210), before={...a};
  assert.throws(() => resolveTerrain(w,a,before),/starts inside solid/);
  assert.deepEqual(a,before);
});
