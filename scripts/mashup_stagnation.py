"""Source-grounded motion rejection; preserves S1 scores and existing S2 escalation."""
VERSION='sonic-source-closed-gate-stagnation/1'
REQUIRED={'missile':2,'bomb':4,'high_jump':8,'ice_platform':16,'speed':64,'screw':128}

def closed_gate(world,facts):
    stage=facts.get('stage');x=facts.get('x');opened=facts.get('opened')
    if type(stage) is not int or not 0<=stage<len(world['stages']) or not isinstance(x,(int,float)) or not isinstance(opened,list) or stage>=len(opened):return None
    for prefab in world['stages'][stage]['prefabs']:
        if prefab['kind'] not in ('gate','freeze_gateway') or opened[stage]&(1<<prefab['id']):continue
        distance=prefab['x']-x
        if abs(distance)>20:continue
        requirement=REQUIRED.get(prefab['component'],0)
        return {'policy_version':VERSION,'basis':'Configured gate identity/position plus current native stage, position and closed ledger bit; opening is not assumed','stage':stage,'id':prefab['id'],'component':prefab['component'],'configured_x':prefab['x'],'distance_px':distance,'required_ability_bits':requirement,'owned_required_ability':bool(requirement and facts.get('upgrades',0)&requirement==requirement),'blocked_direction':'right' if distance>=0 else 'left'}
    return None

def blocked_movement(context,selected):
    """Require three observed same-direction actions and <=2px net/step movement."""
    facts=context['observation'].get('facts',{});gate=facts.get('source_closed_gate')
    if not gate or not facts.get('grounded') or selected!=gate['blocked_direction']:return None
    recent=context.get('memory',{}).get('recent_transitions',[])[-3:]
    if len(recent)!=3 or any(t.get('action_id')!=selected for t in recent):return None
    frames=sum(t.get('frame_after',0)-t.get('frame_before',0) for t in recent)
    if frames<48:return None
    starts=[];ends=[]
    for t in recent:
        before=t.get('before_progress',{});after=t.get('after_progress',{})
        if before.get('stage')!=gate['stage'] or after.get('stage')!=gate['stage'] or before.get('plane')!=after.get('plane'):return None
        a,b=before.get('x'),after.get('x')
        if not isinstance(a,(int,float)) or not isinstance(b,(int,float)) or abs(b-a)>2:return None
        starts.append(a);ends.append(b)
    if abs(ends[-1]-starts[0])>2:return None
    return {'policy_version':VERSION,'reason':'source_closed_gate_stagnation','gate':gate,'action_id':selected,'observed_actions':3,'observed_frames':frames,'net_displacement_px':ends[-1]-starts[0],'maximum_step_displacement_px':max(abs(b-a) for a,b in zip(starts,ends)),'effect':'Reject repeating this observed blocked movement into the existing S2 decision path. No firing action selected by this guard.'}
