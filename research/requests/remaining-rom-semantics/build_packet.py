"""Materialize the bounded static-review packet; never executes a ROM or model."""
import datetime as dt
import hashlib
import json
from pathlib import Path
import time

ROOT=Path(__file__).resolve().parents[3]
OUT=Path(__file__).resolve().parent
BASE=ROOT/'local/re/experiments/20261016-corpus-decompile'
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def ref(path):return {'path':str(path.relative_to(ROOT)),'sha256':digest(path)}

def main():
 start=time.monotonic();roms={r['id']:r for r in json.loads((ROOT/'local/re/roms.json').read_text())}
 catalog=json.loads((BASE/'catalog.json').read_text()); survey={x['id']:x for x in json.loads((ROOT/'local/decomps/survey.json').read_text())}
 cohort=[];all_rows={};files={}
 for p in sorted(BASE.glob('shard-*/*/functions.jsonl')):
  game=p.parent.name;rows={}
  for line_number,line in enumerate(p.open(),1):
   d=json.loads(line);rows[d['entry']]={'data':d,'line':line_number}
  all_rows[game]=rows;files[game]=p
  c=next((g for g in catalog['games'] if g['id']==game),{})
  cohort.append({'game_id':game,'rom_sha1':roms[game]['sha1'],'export':ref(p),'function_records':len(rows),
    'generated_pseudo_c':sum(x['data'].get('decomp_ok',False) for x in rows.values()),
    'canonical_ontology_available':(ROOT/'ontology/games'/(game+'.yaml')).is_file(),
    'community_source_checkout_available':bool(survey.get(game,{}).get('clone_paths')),
    'new_semantic_review_this_packet':game in DESCRIPTIONS,
    'scope':'Retained capture-seeded partial export; function boundaries, ABI and semantics are not globally verified',
    'original_export_run_id':c.get('run_id')})
 candidates=[];games=[]
 for game,specs in DESCRIPTIONS.items():
  rom=ROOT/'local/roms'/roms[game]['file'];data=rom.read_bytes()
  game_record={'game_id':game,'rom_sha1':roms[game]['sha1'],'rom_sha256':hashlib.sha256(data).hexdigest(),
    'export':ref(files[game]),'capture_context':CAPTURES[game],'candidates':[],'next_action':NEXT[game]}
  image=ROOT/game_record['capture_context']['image'];game_record['capture_context']['image_sha256']=digest(image)
  summary=image.parents[2]/'summary.json'
  # Summary is game-level, one above the phase directory.
  summary=ROOT/'local/captures-experiments/20261016-current-scripts'/game/'summary.json'
  game_record['capture_context']['summary']=ref(summary)
  game_record['capture_context']['run_id']=json.loads(summary.read_text()).get('run_id')
  game_record['input_anchors']=[]
  for input_entry in INPUT_ANCHORS[game]:
   input_row=all_rows[game][input_entry];input_data=input_row['data'];input_path=OUT/'pseudocode'/(game+'--'+input_entry+'.c');input_path.write_text(input_data['c'])
   game_record['input_anchors'].append({'entry':input_entry,'export_record_line':input_row['line'],'pseudocode':ref(input_path),'pseudo_c_sha256':hashlib.sha256(input_data['c'].encode()).hexdigest(),'scope':'KEYINPUT-containing retained C only; polling, replay and repeat branches require instruction/runtime checks before treating all fields as live player intent'})
  seed_file=files[game].parent/'capture_seeds.json';seeds=json.loads(seed_file.read_text())
  coverage={}
  for source in seeds['sources']:
   current=ROOT/source['path'];same=current.exists() and digest(current)==source['sha256']
   entry={'path':source['path'],'recorded_sha256':source['sha256'],'current_bytes_match_export_seed_source':same}
   if same:
    cov=json.loads(current.read_text());regions=cov.get('regions',{});rom_cov=regions.get('rom',{})
    for row in rom_cov.get('functions',[]):
     address=row[0];address=int(address,0) if isinstance(address,str) else address
     coverage.setdefault('0x%08x'%address,[]).append({'phase_name':current.parent.name,'observed_calls':row[2],'source':entry})
  for spec in specs:
   entry=spec['entry'];row=all_rows[game][entry];d=row['data'];p=OUT/'pseudocode'/(game+'--'+entry+'.c');p.write_text(d['c'])
   source_line_count=len(d['c'].splitlines());spans=[]
   for lo,hi in spec.pop('line_ranges'):
    hi=min(hi,source_line_count);text='\n'.join(d['c'].splitlines()[lo-1:hi])+'\n';spans.append({'start_line':lo,'end_line':hi,'sha256':hashlib.sha256(text.encode()).hexdigest()})
   item={**spec,'game_id':game,'rom_sha1':roms[game]['sha1'],'status':'candidate_unverified_gameplay_semantics',
     'export_record':{'path':str(files[game].relative_to(ROOT)),'line':row['line'],'pseudo_c_sha256':hashlib.sha256(d['c'].encode()).hexdigest(),
       'reported_mode':d['mode'],'reported_body_size':d['size'],'boundary_and_ABI_verified':False},
     'pseudocode':{**ref(p),'reviewed_spans':spans},'observed_call_target_phases':coverage.get(entry,[]),
     'callers_from_partial_export':d.get('callers',[]),'warning_markers':{'warnings':d['c'].count('WARNING'),'unaff_register':'unaff_' in d['c'],'extraout_register':'extraout_' in d['c']},
     'not_claimed':['Native actor identity or named action without additional caller/state evidence','Full game coverage or native-equivalent executable C','Successful port or runtime strategy validation']}
   asm=OUT/'disassembly'/(game+'--'+entry+'-prefix.asm.txt')
   if asm.exists():
    offset=int(entry,16)-0x08000000;raw=data[offset:offset+192]
    item['instruction_prefix']={**ref(asm),'start':entry,'end_exclusive':hex(int(entry,16)+192),'rom_slice_sha256':hashlib.sha256(raw).hexdigest(),
      'scope':'Bounded Thumb prefix inspection only; literal pools and neighboring code may occur; not whole-function verification'}
   if entry=='0x080149dc':
    item['operator_verified_subset']={'range':'0x080149dc..0x08014a6a (exclusive)','scope':'Held/new/released input-field transformation and directional repeat-byte writes verified against Thumb instructions, including RAM literal0x03003100. Actor role/reachability unverified.',
       'rom_slice_sha256':hashlib.sha256(data[0x149dc:0x14a6a]).hexdigest()}
   candidates.append(item);game_record['candidates'].append(item['entry'])
  games.append(game_record)
 # Preserve short supporting functions and rejected generic leads for auditability.
 support=[]
 for game,entries in SUPPORT.items():
  for entry,reason in entries:
   row=all_rows[game][entry];d=row['data'];p=OUT/'pseudocode'/(game+'--'+entry+'.c');p.write_text(d['c'])
   support.append({'game_id':game,'entry':entry,'role':reason,'source_record_line':row['line'],'export_path':str(files[game].relative_to(ROOT)),
                   'pseudo_c_sha256':hashlib.sha256(d['c'].encode()).hexdigest(),'pseudocode':ref(p)})
 packet={'schema_version':1,'created_at':dt.datetime.now(dt.timezone.utc).isoformat(),
   'scope':'One bounded static pass over22 retained partial exports; deeper semantic triage of5 source-poor games',
   'counts':{'cohort_games':len(cohort),'games_deepened':len(games),'high_value_candidates':len(candidates),'supporting_or_rejected_spans':len(support),'bounded_instruction_prefixes':5,'instruction_prefix_bytes_total':960},
   'claims':['New exact source/ROM anchored candidate records, not complete ontologies','One DBZ input transformation locally instruction-checked; all broader player-facing identities remain candidates'],
   'inputs':{'rom_manifest':ref(ROOT/'local/re/roms.json'),'catalog':ref(BASE/'catalog.json'),'source_survey':ref(ROOT/'local/decomps/survey.json')},
   'cohort':cohort,'games':games,'candidates':candidates,'supporting_or_rejected':support,
   'resources':{'new_ROM_executions':0,'new_model_calls':0,'new_Ghidra_runs':0,'new_builds_or_tests':0,'generation_wall_s':round(time.monotonic()-start,6),
     'research_wall_s':None,'research_wall_note':'Interactive inspection start/stop not instrumented; generation time is not total research time'}}
 (OUT/'packet.json').write_text(json.dumps(packet,indent=2)+'\n')
 print(json.dumps(packet['counts']))

INPUT_ANCHORS={'dragon-ball-advanced-adventure':['0x0810d2f8'],'kirby-and-the-amazing-mirror':['0x08152694'],'kirby-nightmare-in-dream-land':['0x080011dc'],'grand-theft-auto':['0x08065344'],'final-fantasy-vi-advance':['0x080f4850','0x08136600']}

DESCRIPTIONS={
'dragon-ball-advanced-adventure':[
 {'entry':'0x080149dc','label':'Actor-local held/pressed/released input and directional repetition','line_ranges':[(9,35)],
  'observation':'Object flag+0x0c bit0x400 suppresses global held input0x03003100; halfwords+0xe2/+0xe4/+0xe6 become held/new/released. +0xe8 combines newly pressed0x30f with a directional0xf0 repetition rule controlled by byte+0xe1.',
  'why_high_value':'Concrete seam between GBA input and an actor record; produces machine-readable action edges for subsequent locomotion/combat dispatch.',
  'reads':['0x03003100:u16','object+0x0c:flags','object+0xe2:previousHeld','object+0xe1:repeatByte'],
  'writes':['object+0xe2:u16','object+0xe4:u16','object+0xe6:u16','object+0xe8:u16','object+0xe1:u8'],
  'confidence':'High for the local input transformation after instruction inspection; medium for actor linkage because caller uses0x020205a0; unknown mapping of later named moves.',
  'gaps':['Source-mode redirect/replay branch in global input sampler needs isolation before calling every held bit live human input.','No native time unit assigned to repeat byte.']},
 {'entry':'0x08017244','label':'Capability-gated jump/direction action dispatch and horizontal decay','line_ranges':[(25,139),(226,310)],
  'observation':'Object capability bits+0xc4 and held/new input+0xe2/+0xe4 select different handler addresses; A-bit1, directions0x30/0x40/0x80 and shoulder0x200 are tested. The signed halfword+0x2c moves toward zero with a character-indexed table when its branch executes.',
  'why_high_value':'Candidate composable actor action-selection layer and movement damping, with concrete preconditions and downstream handlers rather than a genre guess.',
  'reads':['object+0xc4:capabilities','object+0xe2/+0xe4/+0xea:inputFields','object+0x2c:s16','0x0202066a:index','ROM0x08a41822:indexedTable'],
  'writes':['object+0x2c:s16','object+0x04:counter','object+0xa4:state','object+0x08:flags'],
  'confidence':'Medium candidate only; recovered C contains PIC/reachability warnings and a synthetic indirect return.',
  'gaps':['Need instruction check of each selected action branch; do not name jump/attack techniques from mask alone.','Record positions and velocity units remain unverified.']},
 {'entry':'0x08016c84','label':'Context-sensitive action handler selection','line_ranges':[(9,74)],
  'observation':'New B-bit2 or shoulder0x200 plus capability flags choose handlers; some branches depend on held directions, a signed resource+0xaa threshold0xff and current callback+0x10.',
  'why_high_value':'Separates input, actor capabilities, resource eligibility and state-specific action implementations—useful future ability/combat adapter contract.',
  'reads':['object+0xc4:flags','object+0xe2/+0xe4/+0xea:input','object+0xaa:s16','object+0x10:callback'],
  'writes':['Downstream handler effects unresolved'],
  'confidence':'Medium structural candidate; low for mapping handlers to named combat actions.',
  'gaps':['Resource+0xaa could be an eligibility meter but its actual meaning is unknown.','No complete downstream call graph or actor identity proof.']}
],
'kirby-and-the-amazing-mirror':[
 {'entry':'0x0800385c','label':'Tile-sampled actor bounds and position correction','line_ranges':[(35,94),(269,296)],
  'observation':'Reads position-like words+0x40/+0x44, signed bounds bytes+0x3c..+0x3f scaled256, displacement-like halfwords+0x50/+0x52 and map selector+0x56. It samples tile properties using080023e4 and082d88b8/082d8da4 tables, then writes corrected words+0x40/+0x44 and contact/property flags+0x57/+0x58/+0x62.',
  'why_high_value':'Candidate reusable side-view tile collision contract: actor position/bounds, tile sampler, correction and contact flags; not merely rendering.',
  'reads':['object+0x40/+0x44:i32','object+0x3c..0x3f:s8','object+0x50/+0x52:s16','object+0x56:u8','tilePropertyTables082d88b8/082d8da4'],
  'writes':['object+0x40/+0x44:i32','object+0x57:u8','object+0x58:u32','object+0x62:u8'],
  'confidence':'Medium-high geometry/collision candidate; prefix confirms field loads and signed byte scaling, full collision semantics/ABI remain unverified.',
  'gaps':['Native scale256 is explicit, but pixel units and tile naming not yet independently calibrated.','Callbacks via0815a2a4 need decoding before named solid/slope/one-way guarantees.']},
 {'entry':'0x08038b34','label':'Pairwise actor interaction filtering','line_ranges':[(19,80),(119,170)],
  'observation':'Iterates records at0x02020ee0 with stride0x1a8 up to byte0x0203ad44. Pairs are filtered by state/flags and shared field+0x60, checked by bounds predicate0803912c, then state handlers and per-pair bitfields are updated.',
  'why_high_value':'Candidate multiple-actor contact/interaction layer, relevant to companions and cooperative behavior, with exact record layout and exclusion gates.',
  'reads':['0x02020ee0:recordBase','0x0203ad44:recordCount','record+0x08:flags','record+0x60:sharedGroup','record+0xd4:state','record+0x103:mode'],
  'writes':['record+0xe1:pairBitset','record+0x104:pairFields','Downstream handler state'],
  'confidence':'Medium for pairwise structure; unknown which actor slots are player/partner/other.',
  'gaps':['Do not equate this function with the entire ally AI or copy-ability system.','Need callback and pairbit interpretation and contact trace.']}
],
'kirby-nightmare-in-dream-land':[
 {'entry':'0x0801e178','label':'Surface-table probes and position correction','line_ranges':[(19,115),(148,171)],
  'observation':'Global signed coordinates0x03005560/0x03005570 plus offset0x03005584 feed probes08021634/080216d8. Those helpers select a16x16-local sample and tile IDs; correction values from080219b0/080219d0/080219f0 update the position words, with flags controlling branch eligibility.',
  'why_high_value':'Candidate terrain collision and slope/height-field seam rather than another generic state helper.',
  'reads':['0x03005560:s16','0x03005570:s16','0x03005584:s16','0x03005578:tileIndex','0x0300553b:flags','tileShapeTables087328f0/08733ff0'],
  'writes':['0x03005560:s16','0x03005570:s16','0x0300553b/0x0300553c/0x0300553d:flags'],
  'confidence':'Medium-high terrain probe candidate; initial coordinate/probe call confirmed in ROM prefix; helper table interpretation from retained C only.',
  'gaps':['Need determine which runtime actor is copied into the global work record.','Surface names, world units, exact edge behavior and function returns remain unverified.']},
 {'entry':'0x08036280','label':'Actor-mode transitions driven by probes and input-like fields','line_ranges':[(9,97),(100,171)],
  'observation':'A current object pointer0x03002490 owns byte state+0x73 and flags+0x7a/+0x7b. Cases0..6 invoke different handlers and transition state after predicate08040298 and per-index bitfields at0x03002458/0x030023c0.',
  'why_high_value':'Concrete actor behavior state graph to trace for movement/AI or ability reactions, with named-actor claims intentionally withheld.',
  'reads':['0x03002490:objectPointer','object+0x73:state','object+0x7a/+0x7b:flags','object+0x88:slotPointer','0x03002458/0x030023c0:indexedBits'],
  'writes':['object+0x73:state','object+0x7a:u8','object+0x28:i32','Callbacks via0803e050/080413a4/08040b40'],
  'confidence':'Medium candidate state graph; individual mode labels unknown.',
  'gaps':['Not enough evidence to call this Kirby movement, enemy AI, inhaling or a specific copied power.','Needs object identity plus narrow state-transition recording.']}
],
'grand-theft-auto':[
 {'entry':'0x08045910','label':'Nearest-of-two position-record choice and reaction dispatch','line_ranges':[(19,105),(126,185)],
  'observation':'Compares two global record references0x02000f10/0x02001140 against the current object through coordinate-bearing pointers. Distance surrogate usesabs(dx)+abs(dy)-min/2-min/4+min/16; it caches the selected reference at0x0202f3dc keyed by object0x0202f3d8 and counter0x0202f3d0.',
  'why_high_value':'Candidate target selection/spatial awareness seam with concrete arithmetic, potentially useful for AI navigation/reactions.',
  'reads':['0x02000f10:recordRef','0x02001140:recordRef','object+0x18 or(object+0x20)+4:coordinatePointer','0x02000224:counter'],
  'writes':['0x0202f3dc:selectedRecord','0x0202f3d8:cachedObject','0x0202f3d0:cachedCounter','object+0x0c:flags','Referenced timers/state'],
  'confidence':'Medium candidate; prefix confirms pointer-selection/cache branch, distance expression not fully instruction checked.',
  'gaps':['No evidence yet which records are pedestrian, player, vehicle, police or mission target.','Distance units, overflow bounds and spatial eligibility rules unresolved.']},
 {'entry':'0x08051e78','label':'Timer- and flag-gated actor action controller','line_ranges':[(15,55),(165,212)],
  'observation':'An object with behavior/config pointer+0x2c is gated by flags+0x18, byte+0x0b and short timer+0x14. It calls080544c0 and08053d68 before selecting downstream actions and mutating callback-bearing related records+0x24/+0x28.',
  'why_high_value':'Candidate behavior scheduling/eligibility layer paired with a concrete target-selector lead; likely richer than raw render updates.',
  'reads':['object+0x2c:configPointer','object+0x18:flags','object+0x0b:mode','object+0x14:timer','0x03000000:deltaLikeValue'],
  'writes':['object+0x14:s16','object+0x0b:u8','object+0x18:u32','Related records+0x24/+0x28'],
  'confidence':'Medium structural candidate; low for named weapons or mission semantics.',
  'gaps':['No verified actor identity, timer units, pathfinding or combat meaning.','Need decode080544c0/08053d68 and runtime record provenance.']}
],
'final-fantasy-vi-advance':[
 {'entry':'0x0815115c','label':'Input-aware text/control-code stream driver','line_ranges':[(30,69),(124,265)],
  'observation':'Selects newly pressed or held input depending mode6, tracks state near0x03002518, obtains glyph/control values, draws values below0x10d and handles larger codes including0x10e/0x10f/0x135/0x136/0x137/0x13b. Fields+0x18/+0x19 track layout-like offsets and+0x1c a delay; A-bit affects delay/advance.',
  'why_high_value':'Candidate narrative presentation and dialogue pacing component that exposes concrete text/state boundaries; source-poor FFVI currently lacks a safe gameplay ontology.',
  'reads':['0x0300298c:newInputCandidate','0x03002998:heldInputCandidate','0x030027d4:mode','0x03002518:state','state+0x30:textPointer','state+0x40:glyphConfig'],
  'writes':['state+0x18/+0x19:layout','state+0x1c:delay','0x030024b8:currentControl','0x03003128/0x03003129:advanceState'],
  'confidence':'Medium-high text/control-driver candidate; prefix verifies mode-dependent button selection, full token meanings need decoding.',
  'gaps':['This is not evidence of the whole event/quest VM, battle formulas, character stats or story progression flags.','Extraout and indirect-return warnings prevent trusting all C ABI/dataflow.']}
]}

CAPTURES={
'dragon-ball-advanced-adventure':{'image':'local/captures-experiments/20261016-current-scripts/dragon-ball-advanced-adventure/gameplay/keyframes/f005362_scene.png','observed':'Side-view scene with Goku HUD, ground platforms and two enemy-like figures; screenshot alone does not identify candidate function ownership.'},
'kirby-and-the-amazing-mirror':{'image':'local/captures-experiments/20261016-current-scripts/kirby-and-the-amazing-mirror/gameplay/keyframes/f005343.png','observed':'Side-view outdoor scene, Kirby-like actor, NORMAL HUD and large star effects; no ability/collision policy inferred from the effect.'},
'kirby-nightmare-in-dream-land':{'image':'local/captures-experiments/20261016-current-scripts/kirby-nightmare-in-dream-land/gameplay/keyframes/f005302.png','observed':'Side-view grassy platforms and airborne Kirby-like actor with HUD; input causality is not established by this single frame.'},
'grand-theft-auto':{'image':'local/captures-experiments/20261016-current-scripts/grand-theft-auto/gameplay/keyframes/f005394_scene.png','observed':'Top-down street scene, actor/vehicles, minimap and CHINATOWN HUD text; target-selector records are not identified by the picture.'},
'final-fantasy-vi-advance':{'image':'local/captures-experiments/20261016-current-scripts/final-fantasy-vi-advance/gameplay/keyframes/f013412.png','observed':'Snowy top-down town and Guard dialogue window. This supports text-scene context, not event-VM or actor-control completion.'}}

NEXT={
'dragon-ball-advanced-adventure':{'static':['Disassemble08014a6c..080153b4 and08017244..08017b8c, repair actual saved-LR epilogues before trusting callflow','Decode handlers08018e68/0801b93c and table08a41822 against ROM bytes'], 'bounded_capture':['Checkpoint a normal stage and probe LEFT/RIGHT/A/B separately for12frames','Watch fixed record020205a0 input+e2/e4/e6/e8 and position-like+1c/+20, velocity-like+2c/+2e; log selected callback+10']},
'kirby-and-the-amazing-mirror':{'static':['Check0800385c body and callback table082d8da4; decode sampler080023e4 and overlap0803912c','Map record02020ee0 stride1a8 actor identities before calling this partner AI'], 'bounded_capture':['Probe walking/jump into a known visible wall from an isolated checkpoint','At0800385c log R0/R1 and record+40/+44/+50/+52/+57/+58/+62, plus tile samples and contact outcome']},
'kirby-nightmare-in-dream-land':{'static':['Check08021634/080216d8/080219b0 and shape tables087328f0/08733ff0','Trace writes to current object pointer03002490 and global work record03005560/03005570'], 'bounded_capture':['Probe a flat landing and one ledge with separate short inputs','Log tile IDs03005578/03005588, local sample03005508 and correction before/after0801e178; trace state+73 object identity']},
'grand-theft-auto':{'static':['Decode08045910 distance arithmetic and writers of02000f10/02001140','Decode080544c0/08053d68 for eligibility before inferring combat, police or traffic rules'], 'bounded_capture':['Use an isolated street checkpoint; change only player proximity/vehicle state in short steps','Log0202f3d8/0202f3dc cache and both candidate coordinate records alongside pixels; do not infer mission success']},
'final-fantasy-vi-advance':{'static':['Disassemble0815115c stream branches and decode08150844/08150894 glyph helpers','Find actual token stream pointer writers before treating text codes as plot/event opcodes'], 'bounded_capture':['From the retained Guard dialogue state, compare WAIT vs A vs B with same checkpoint','Record03002518 state+18/+19/+1c/+30 and selected control030024b8; separate text advance from world movement']}}

SUPPORT={
'dragon-ball-advanced-adventure':[('0x08014a6c','Caller candidate passes fixed record0x020205a0 to input conditioning; links action record to world-update family')],
'kirby-and-the-amazing-mirror':[('0x080023e4','Supporting tile sampler: map-indexed row-major byte lookup; return ABI unresolved'),('0x0803912c','Supporting oriented-bounds overlap candidate using same position/bounds offsets'),('0x08026698','Rejected as primary gameplay claim: mostly transition/presentation state; input use alone is insufficient')],
'kirby-nightmare-in-dream-land':[('0x08021634','Supporting16x16-local collision sample, table pointer087328f0, map dimensions03005620/0300561c'),('0x080216d8','Supporting tile-and-next-row sample with map bound handling'),('0x080219b0','Supporting signed surface offset lookup using current local sample03005508')],
'final-fantasy-vi-advance':[('0x08150844','Supporting indexed glyph code lookup; indirect return artifact'),('0x08150894','Supporting glyph lookup/draw call chain; actual glyph/layout behavior unresolved'),('0x0811ab18','Rejected primary claim: record initialization alone does not identify RPG party/stats'),('0x080164b8','Rejected primary claim: packed-bit unpacking with unaff-register artifacts, no player-facing semantics established')]}

if __name__=='__main__':main()
