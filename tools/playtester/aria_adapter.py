"""Actual Aria ROM experiment; read-only source rewards and supported buttons."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import sys

from tools.playtester.adapters import SubprocessAdapter


ROM_SHA256='6f42b0b50c42df23518feb897a12beba5319736bece29c8f79fa3f0c9f5366ac'


class AriaRewardAdapter:
    def __init__(self, command, *, expected_rom_sha256=ROM_SHA256, goal="reward", native_event_audit=False, target_abs_velocity_q16=196608):
        self.inner=SubprocessAdapter(command,timeout_s=10)
        meta=self.inner.hello()
        if meta['game_version']!=expected_rom_sha256:
            self.inner.close();raise ValueError('aria_candidate_rom_mismatch')
        self.goal=goal
        self.native_event_audit=native_event_audit;self.target_abs_velocity_q16=target_abs_velocity_q16
        self.native_events=[];self.bone_seen=set();self.audit_seeded=False
        self.initial_xp=None;self.reward_frame=None;self.initial_inventory=None;self.objective_witness=None
    def hello(self):
        meta=self.inner.hello()
        meta['adapter_version']='aria-readonly-reward-fragment/1'
        meta['scenario']='bounded native traversal' if self.goal=='traversal' else 'observed native reward, then another game input; not campaign completion'
        return meta
    def observe(self):
        obs=self.inner.observe();xp=obs['facts']['XP']
        actor=obs['facts'].get('player_actor_pointer')
        # Exact Aria cast-host ABI; dereference only a complete bounded RAM span.
        if type(actor) is int and (0x02000000<=actor<=0x02040000-0x50 or 0x03000000<=actor<=0x03008000-0x50):
            raw=bytes.fromhex(self.inner._request('read_memory',address=actor+0x40,length=16)['hex'])
            obs['facts']['player_motion_q16']={name:int.from_bytes(raw[index*4:index*4+4],'little',signed=True)
                for index,name in enumerate(('x','y','velocity_x','velocity_y'))}
        elif actor is not None:obs['facts']['player_motion_unavailable']='native actor pointer not in bounded RAM'
        if self.initial_xp is None:self.initial_xp=xp
        inventory={}
        capacities={0:56,1:26,2:36,3:8}
        for key,value in list(obs['facts'].items()):
            if not key.startswith('soul_inventory_'):continue
            parts=key.split('_');kind,bank,offset=map(int,parts[2:])
            for nibble in range(8):
                index=offset*2+nibble
                if index<capacities[kind]:
                    identity=f'{kind}:{index}'
                    inventory[identity]=inventory.get(identity,0)+((value>>(4*nibble))&15)
        if self.initial_inventory is None:self.initial_inventory=dict(inventory)
        acquired=[{'kind':int(key.split(':')[0]),'index':int(key.split(':')[1]),'before':0,'after':value}
            for key,value in inventory.items() if self.initial_inventory.get(key,0)==0 and value>0]
        obs['facts']['owned_souls']={key:value for key,value in inventory.items() if value}
        satisfied=(bool(self.objective_witness) if self.goal=='skeleton_birth_impulse' else False) if self.goal in ('traversal','skeleton_birth_impulse') else (bool(acquired) if self.goal=='soul_acquisition' else xp>=self.initial_xp+2)
        if satisfied and self.reward_frame is None:
            self.reward_frame=obs['frame'];self.objective_witness=self.objective_witness or {'XP_delta':xp-self.initial_xp,'acquired':acquired,'observed_frame':obs['frame']}
        obs['facts']['new_soul_inventory_entries']=acquired
        obs['facts']['source_native_events']=self.native_events[-6:]
        if self.native_event_audit:obs['facts']['native_event_goal']={'kind':'skeleton_birth_impulse','target_abs_velocity_q16':self.target_abs_velocity_q16}
        obs['progress']={'XP':xp,'HP':obs['facts']['HP'],'level':obs['facts']['level'],'owned_souls':obs['facts']['owned_souls']}
        if 'player_motion_q16' in obs['facts']:obs['progress']['player_motion_q16']=obs['facts']['player_motion_q16']
        if 'MP' in obs['facts']:obs['progress']['MP']=obs['facts']['MP']
        obs['phase']='source_recipe_early_corridor_setup'
        obs['facts']['scenario_initial_XP']=self.initial_xp
        obs['facts']['scenario_XP_delta']=xp-self.initial_xp
        obs['facts']['reward_observed']=self.reward_frame is not None
        if self.goal=='skeleton_birth_impulse' and self.objective_witness:
            obs.update(terminal=True,success=True)
            obs['facts']['objective_witness']=self.objective_witness
        obs['facts']['source_refs']=['research/deep-extraction/castlevania/defeat-policy.c',
            'research/deep-extraction/castlevania/defeat-gameplay.json','tools/prefab_pipeline/mod_rom.py:_gameplay']
        if self.reward_frame is not None and obs['frame']>self.reward_frame:
            obs.update(terminal=True,success=True)
            obs['facts']['scenario_outcome']='Native objective observed and original game advanced afterward'
            obs['facts']['objective_witness']=self.objective_witness
        return obs
    def _audit_birth(self, mp_before, seed=False):
        def read(address,n):
            response=self.inner._request('read_memory',address=address,length=n)
            self.audit_observed_frame=response['frame']
            return bytes.fromhex(response['hex'])
        player=int.from_bytes(read(0x02013110,4),'little')
        if player%4 or not 0x02000000<=player<=0x02040000-0x60:return None
        slots=read(0x02013124,32);current=set();event=None
        for offset in range(0,32,4):
            pointer=int.from_bytes(slots[offset:offset+4],'little')
            if pointer%4 or not 0x02000000<=pointer<=0x02040000-0x20:continue
            raw=read(pointer,32)
            if int.from_bytes(raw[:4],'little')!=0x08026009 or int.from_bytes(raw[20:24],'little')!=player:continue
            if raw[10]>=1:current.add(pointer)
            if not seed and pointer not in self.bone_seen and raw[10]==1:
                motion=read(player+0x48,8);vx=int.from_bytes(motion[:4],'little',signed=True)
                event={'kind':'newly_observed_initialized_skeleton_birth','callback':'0x08026009','entity':pointer,
                    'parent':player,'frame':self.audit_observed_frame,'state':raw[10],'velocity_x_q16':vx,'velocity_y_q16':int.from_bytes(motion[4:],'little',signed=True),
                    'MP_before_action':getattr(self,'audit_action_initial_MP',mp_before),'MP_before_frame':mp_before,'MP_after_frame':int.from_bytes(read(0x0201327c,2),'little'),
                    'basis':'Native active slot, exact Skeleton callback, initialized state1 and source player parent; per-frame observation, not instruction-level hook trace'}
                self.native_events.append(event)
                if abs(vx)>=self.target_abs_velocity_q16:self.objective_witness=dict(event)
        self.bone_seen=current
        return event

    def act(self,action,max_frames):
        if self.native_event_audit:
            spent=0;event=None
            for index in range(min(action['frames'],max_frames)):
                keys=action.get('keys',[])
                if index==0 and action['frames']>1:keys=[key for key in keys if key not in ('A','B')]
                mp=int.from_bytes(bytes.fromhex(self.inner._request('read_memory',address=0x0201327c,length=2)['hex']),'little')
                if index==0:self.audit_action_initial_MP=mp
                if not self.audit_seeded:self._audit_birth(mp,seed=True);self.audit_seeded=True
                receipt=self.inner.act(dict(action,keys=keys,frames=1),max_frames=1);spent+=receipt['frames']
                event=self._audit_birth(mp)
                if event:
                    event['action_native_frames']=spent
                    break
            return {'frames':spent,'native_event_audit':True,'event_breakpoint':event,'sampled_button_release_frames':int(action['frames']>1)}

        keys,frames=action.get('keys',[]),action['frames']
        if any(key in keys for key in ('A','B')) and frames>1:
            # Model chooses the macro; sample a real release before its press.
            # Otherwise consecutive hold-B commands never create a new attack.
            release=dict(action,keys=[key for key in keys if key not in ('A','B')],frames=1)
            first=self.inner.act(release,max_frames=max_frames)
            pressed=dict(action,frames=frames-1)
            second=self.inner.act(pressed,max_frames=max_frames-first['frames'])
            return {'frames':first['frames']+second['frames'],'sampled_button_release_frames':1}
        return self.inner.act(action,max_frames=max_frames)
    def checkpoint(self):
        result=self.inner._request('checkpoint')
        result['scenario_state']={'initial_xp':self.initial_xp,'reward_frame':self.reward_frame,'initial_inventory':self.initial_inventory,'objective_witness':self.objective_witness,'native_events':self.native_events,'bone_seen':list(self.bone_seen)}
        self.checkpoints=getattr(self,'checkpoints',{})
        self.checkpoints[result['checkpoint']]=copy.deepcopy(result['scenario_state'])
        return result
    def restore(self,token):
        result=self.inner._request('restore',checkpoint=token)
        state=self.checkpoints[token]
        self.initial_xp=state['initial_xp'];self.reward_frame=state['reward_frame'];self.initial_inventory=state['initial_inventory'];self.objective_witness=state['objective_witness'];self.native_events=state.get('native_events',[]);self.bone_seen=set(state.get('bone_seen',[]))
        return result
    def close(self):self.inner.close()


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--rom',type=Path,required=True);ap.add_argument('--out',type=Path,required=True)
    ap.add_argument('--initial-state',type=Path,required=True);ap.add_argument('--memory-profile',type=Path,required=True)
    ap.add_argument('--expected-rom-sha256',default=ROM_SHA256)
    ap.add_argument('--goal',choices=['reward','soul_acquisition','traversal'],default='reward')
    args=ap.parse_args()
    adapter=AriaRewardAdapter([sys.executable,'-B','tools/re/session/bridge.py','--rom',str(args.rom),
        '--game-id','castlevania-aria-of-sorrow-double-xp','--out',str(args.out),'--initial-state',str(args.initial_state),
        '--memory-profile',str(args.memory_profile)],expected_rom_sha256=args.expected_rom_sha256,goal=args.goal)
    try:
        for raw in sys.stdin.buffer:
            ident=None;close=False
            try:
                if len(raw)>65536:raise ValueError('request_size_limit')
                request=json.loads(raw);ident=request.get('id');op=request.get('op')
                if op=='hello':result=adapter.hello()
                elif op=='observe':result=adapter.observe()
                elif op=='act':result=adapter.act(request['action'],request.get('max_frames',120))
                elif op=='checkpoint':result=adapter.checkpoint()
                elif op=='restore':result=adapter.restore(request['checkpoint'])
                elif op=='close':result={};close=True
                else:raise ValueError('unsupported_operation')
                response={'id':ident,'ok':True,'result':result}
            except Exception:response={'id':ident,'ok':False,'error':'invalid_request_or_aria_session_failure'}
            print(json.dumps(response),flush=True)
            if close:break
    finally:adapter.close()


if __name__=='__main__':main()
