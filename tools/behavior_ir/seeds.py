"""Evidence-backed L0 entry discovery. Never reads recovered C or lift_ref files."""
from pathlib import Path
import hashlib,json
ROOT=Path(__file__).resolve().parents[2]
def discover(game,rom):
 raw=rom.read_bytes();digest=hashlib.sha256(raw).hexdigest();result={}
 for path in sorted((ROOT/'tools/composition/packages').glob('*.json')):
  m=json.loads(path.read_text());native=m.get('native_implementation',{});recovery=native.get('recovery',{});concept=m.get('concept',{}).get('role','');role=concept.split('.')[0]
  if native.get('origin')!='self_decompilation'or native.get('game_id')!=game or role not in('movement','combat','progression'):continue
  if recovery.get('rom_sha256')!=digest:continue
  for r in recovery.get('ranges',[]):
   entry=int(r['address'],16);start=entry-0x08000000;size=r['size'];expected=r.get('instruction_sha256')
   if not expected or start<0 or hashlib.sha256(raw[start:start+size]).hexdigest()!=expected:continue
   label=r.get('name','behavior');key=f'{entry:08x}'
   result.setdefault(key,{'entry':key,'id':game.replace('super-mario-advance','sma')+'.'+('motion'if role=='movement'else role)+'.'+label,'title':label.replace('_',' ').capitalize(),'role':role,'domains':{},'semantics':{},'source_evidence':{'record':str(path.relative_to(ROOT)),'range_sha256':expected,'naming_status':r.get('name_status','unqualified_analysis_label')}})
 targets=ROOT/'research/deep-extraction/mario/mechanics-targets.json'
 if targets.exists():
  for t in json.loads(targets.read_text()).get('targets',[]):
   if t['game']!=game or t['rom_sha256']!=digest:continue
   span=t['instruction_span'];offset=int(span['address'],16)-0x08000000
   if hashlib.sha256(raw[offset:offset+span['size']]).hexdigest()!=span['sha256']:raise ValueError('mechanic discovery span mismatch')
   family=t['family'];role='combat'if any(v in family for v in('combat','health','carry','entity'))else'progression'if any(v in family for v in('forms','progression','resource'))else'movement'
   result.setdefault(t['entry'],{'entry':t['entry'],'id':t['id'],'title':t['id'].split('.')[-1].replace('_',' ').capitalize(),'role':role,'domains':{},'semantics':{},'family':family,'source_evidence':{'record':str(targets.relative_to(ROOT)),'range_sha256':span['sha256'],'naming_status':t['semantic_status']}})
 for p in result.values():
  observation=ROOT/'research/deep-extraction/mario/context-observations.json'
  if observation.exists():
   contexts=[r for r in json.loads(observation.read_text())['records']if r['rom_sha256']==digest]
   cells={cell for r in contexts for cell in r['object_roots']}
   p['object_contract']={f'{int(cell,16):08x}':{'identity':'observed_context_'+str(i),'ownership':'distinct_access_windows','observed_targets':sorted({int(r['object_roots'][cell],16)for r in contexts if cell in r['object_roots']}),'evidence':[str(observation.relative_to(ROOT))]}for i,cell in enumerate(sorted(cells))}
  evidence=ROOT/'research/deep-extraction/mario/l0-context-evidence.json'
  if evidence.exists():
   e=next((e for e in json.loads(evidence.read_text())['profiles']if e['game']==game and e['entry']==p['entry']and e['rom_sha256']==digest),None)
   if e:
    span=e['instruction_span'];offset=int(span['address'],16)-0x08000000
    if hashlib.sha256(raw[offset:offset+span['size']]).hexdigest()!=span['sha256']:raise ValueError('L0 context instruction identity mismatch')
    p['object_contract']={f"{int(r['root']['address'],16):08x}":{'identity':r['id'],'ownership':'distinct_access_windows','observed_targets':[int(v,16)for v in r['observed_bases']],'storage':r['storage'],'evidence':[str(evidence.relative_to(ROOT)),e['native_context_observation']]}for r in e['references']}
    p['field_annotations']={}
    references={r['id']:f"{int(r['root']['address'],16):08x}"for r in e['references']}
    meaning_types={'air_mode':('enum',1,'player.air_mode'),'remaining_hover':('counter',1,'hover.invocations'),'initial_hover_frames':('counter',1,'hover.invocations'),'jump_variant_selector':('enum',1,'player.jump_variant'),'crouch_charge':('counter',1,'player.crouch_charge'),'carried_object_present':('boolean',1,'player.carry'),'charged_jump_phase':('enum',1,'player.charge_phase'),'carried_object_type':('enum',1,'world.object_kind'),'special_jump_velocity':('velocity',16,'world.y.down'),'gravity_unheld':('acceleration',16,'world.y.down'),'gravity_held':('acceleration',16,'world.y.down'),'special_air_gravity':('acceleration',16,'world.y.down'),'held_keys':('input',1,'gba.buttons'),'frame_phase':('counter',1,'clock.invocation')}
    def annotate(key,f):
     unit=f.get('physical_unit');meaning=f['meaning'];typ=(unit['quantity'].replace('_per_update',''),unit['denominator'],unit['frame'])if unit else meaning_types.get(meaning)
     if typ:p['field_annotations'][key]={'quantity':typ[0],'unit':{'numerator':1,'denominator':typ[1]},'frame':typ[2],'confidence':0.9,'label':meaning,'evidence':[str(evidence.relative_to(ROOT)),'research/deep-extraction/mario/sma1-unit-calibration.json'] if game=='super-mario-advance'else[str(evidence.relative_to(ROOT))],'naming_status':'evidence_annotation_not_behavior_input'}
    for identity,fields in e.get('fields',{}).items():
     for f in fields:
      if 'index_domain'not in f:annotate('reference:'+references[identity]+':'+str(int(f['offset'],16)),f)
    for f in e.get('scalar_globals',[]):annotate('global:0:'+str(int(f['address'],16)),f)
    for c in p['object_contract'].values():
     if c['storage']=='readonly_rom':
      c['configuration_labels']={str(base):('Mario profile'if base==0x08368838 else'Peach profile'if base==0x08368880 else'Observed native configuration')for base in c['observed_targets']}
    if game=='super-mario-advance'and p['entry']=='080a9808':p['public_collections']={'collection_0':{'quantity':'jump_onset_velocity_profile','unit':{'numerator':1,'denominator':16},'frame':'world.y.down','confidence':0.9,'evidence':[str(evidence.relative_to(ROOT))]}}
    if e.get('input_domains',{}).get('player.jump_variant_selector'):
     d=e['input_domains']['player.jump_variant_selector'];p['state_domains']={'reference:03005cf0:44':{'unsigned_min':min(d),'unsigned_max':max(d)}}
    if e.get('input_domains',{}).get('argument_0'):
     d=e['input_domains']['argument_0'];p['domains']['r0']={'unsigned_min':min(d),'unsigned_max':max(d)}
  if game=='super-mario-advance-2-super-mario-world'and p['entry']in('0806b5a8','0806b604'):
   axis='x.right'if p['entry']=='0806b5a8'else'y.down'
   def sem(quantity,den):return {'quantity':quantity,'unit':{'numerator':1,'denominator':den},'frame':'world.'+axis,'confidence':0.9,'evidence':['own_rom_signed_velocity_shift_and_byte_carry_l0','research/corpus-mining/20261016-binary-corpus-round2/reviewed/sma2-motion-gameplay-receipt.json'],'naming_status':'analysis_annotation_not_behavior_input'}
   p['semantics']={'field_0':sem('velocity',16),'field_1':sem('position',1),'field_2':sem('subpixel_remainder',256)}
 return sorted(result.values(),key=lambda p:(0 if any(s in p['title'].lower()for s in('integrat','gravity','jump','stomp','pickup'))else 1,p['entry']))
