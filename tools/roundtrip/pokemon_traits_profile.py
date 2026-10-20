"""Own-ROM species traits: automatic SSA behavior with source-attributed assets.

Use --runtime with a frozen compiler/provider checkout. No behavior is authored
here; the source formula below supplies validation-only expected results.
"""
from __future__ import annotations
import argparse, hashlib, json, shutil, subprocess, sys, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
GAMES={
 'ruby':{'game':'pokemon-ruby-version','rom':'Pokemon - Ruby Version (USA, Europe) (Rev 2).gba','sha256':'0fdd36e92b75bed65d09df4635ab0b707b288c2bf1dc4c6e7a4a4f0eebe9d64c','sha1':'5b64eacf892920518db4ec664e62a086dd5f5bc8','entries':{'gender':'0803c524','ability':'0803db14'},'table':0x081fec30,'global':0x02024c06,'source':'local/decomps/pokeruby/src/pokemon_2.c','header':'local/decomps/pokeruby/include/pokemon.h','revision':'local/decomps/pokeruby/ruby_rev2.sha1'},
 'leafgreen':{'game':'pokemon-leafgreen-version','rom':'Pokemon - LeafGreen Version (USA, Europe) (Rev 1).gba','sha256':'2f978f635b9593f6ca26ec42481c53a6b39f6cddd894ad5c062c1419fac58825','sha1':'7862c67bdecbe21d1d69ce082ce34327e1c6ed5e','entries':{'gender':'0803f7a0','ability':'08040d4c'},'table':0x082547d0,'global':0x02023d6a,'source':'local/decomps/pokefirered/src/pokemon.c','header':'local/decomps/pokefirered/include/pokemon.h','revision':'local/decomps/pokefirered/leafgreen_rev1.sha1'}}
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def save(p,v):p.write_text(json.dumps(v,indent=2,sort_keys=True)+'\n')
def prepare(game,runtime,export,vectors):
 cfg=GAMES[game]; started=time.perf_counter(); base=runtime/'local'/game;base.mkdir(parents=True,exist_ok=False)
 rom=ROOT/'local/roms'/cfg['rom'];raw=rom.read_bytes()
 assert sha(rom)==cfg['sha256'] and hashlib.sha1(raw).hexdigest()==cfg['sha1']
 assert (ROOT/cfg['revision']).read_text().split()[0]==cfg['sha1']
 shutil.copy2(rom,base/'original.gba');shutil.copytree(export/'l0',base/'l0');shutil.copy2(export/'report.json',base/'export-report.json')
 (base/'evidence').mkdir()
 pins=[]
 for name in ('source','header','revision'):
  source=ROOT/cfg[name];target=base/'evidence'/source.name;shutil.copy2(source,target);pins.append({'path':str(target.relative_to(runtime)),'sha256':sha(target),'original_path':cfg[name]})
 match=ROOT/'local/ir/pokemon-family-coverage-20261016/probe001/family-pattern-map.json';shutil.copy2(match,base/'evidence/family-pattern-map.json')
 table=raw[cfg['table']-0x08000000:cfg['table']-0x08000000+412*28]
 contract={'schema':'gameverse.source-traits-contract/1','game_id':cfg['game'],'original_sha256':cfg['sha256'],'original_sha1':cfg['sha1'],'source_matching_elf':None,'source_mapping':'Unique complete FireRed-linked machine instruction template match, masking only own-ROM literal pool words and BL relocations; each own-ROM L0 and native proof independent','source_pins':pins,'template_mapping':{'path':str((base/'evidence/family-pattern-map.json').relative_to(runtime)),'sha256':sha(match)},'species_table':{'address':cfg['table'],'records':412,'stride':28,'bytes':len(table),'sha256':hashlib.sha256(table).hexdigest(),'fields':{'genderRatio':16,'ability1':22,'ability2':23}},'input_domain':{'species':[0,411],'personality':'all u32; machine consumes low8','altAbility':'all u8; zero selects first, every nonzero selects second'},'canonical_last_used_ability':cfg['global'],'closure':'Shared immutable source table, gender branch semantics and ability selection plus canonical last-used byte only; monster record decoding/construction, battle activation and lifetime remain host','whole_game_equivalent':None}
 save(base/'source-contract.json',contract)
 sys.path.insert(0,str(runtime/'tools/behavior_ir'));from lift import Lifter
 from lower import lower
 from qualify import qualify
 rows=[]
 for label,entry in cfg['entries'].items():
  stage=time.perf_counter();d=base/label;d.mkdir();l0=base/'l0'/f'{entry}.json';shutil.copy2(l0,d/'l0.json')
  b,a=Lifter(json.loads(l0.read_text()),raw,param_domains={'r0':{'unsigned_min':0,'unsigned_max':411}}).build()
  save(d/'l1.json',b);save(d/'validation-adapter.json',a);(d/'generated.c').write_text(lower(b))
  expected_start=cfg['table']+(16 if label=='gender' else 22)
  assert a['assets'][0]['address']==expected_start and len(a['assets'])==1
  if label=='ability':assert len(a['fields'])==1 and (a['fields'][0]['address']or 0)+a['fields'][0]['offset']==cfg['global']
  inputs=[];expected=[]
  for species in range(412):
   ratio=table[species*28+16]
   values=sorted({0,255,max(0,ratio-1),ratio,min(255,ratio+1)}) if label=='gender' else [0,1,2,255]
   for value in values:
    byreg={'r0':species,'r1':value};inputs.append({p['name']:byreg[p['register']] for p in a['parameters']})
    expected.append((ratio if ratio in (0,254,255) else 254 if ratio>value else 0) if label=='gender' else table[species*28+22+(value!=0)])
  fixtures={'parameter_values':inputs,'expected_returns':expected,'context':{'source_contract':str((base/'source-contract.json').relative_to(runtime)),'scope':'Every valid species with threshold boundaries or zero/nonzero selector representatives; random vectors supplement, no whole-game equivalence'}}
  if label=='ability':fixtures.update(states=[{a['fields'][0]['name']:i%256} for i in range(len(inputs))],expected_states=[{a['fields'][0]['name']:v} for v in expected])
  save(d/'fixtures.json',fixtures);proof=qualify(d,base/'original.gba',vectors,True,fixtures)
  if proof['outcome']!='pass':raise RuntimeError(label+': '+str(proof.get('error')))
  save(d/'package.json',{'schema':'gameverse.executable-component/0.2','id':game+'.species.'+label,'origin':'automatic_highfunction_lift','behavior':'l1.json','behavior_sha256':sha(d/'l1.json'),'qualification':{'status':'pass','receipt':'receipt.json','vectors':vectors}})
  rows.append({'label':label,'entry':entry,'seconds':time.perf_counter()-stage,'expected_cases':len(inputs),'outcome':'pass'})
 profile={'id':game+'-species-traits-ir/1','original_sha256':cfg['sha256'],'original_sha1':cfg['sha1'],'targets':[(l,game+'.species.'+l,e) for l,e in cfg['entries'].items()],'package_roots':{game+'.species.'+l:str((base/l).relative_to(runtime)) for l in cfg['entries']},'retained_ir':True,'reuse_original_proof':True,'arena_append':True,'arena_address':0x09000000,'arena_capacity':65536,'arena_entry':None,'scope':contract['closure'],'source_context':{'source_contract':{'path':str((base/'source-contract.json').relative_to(runtime)),'sha256':sha(base/'source-contract.json')}},'state_lifecycle':{'authority':'Original species table and canonical last-used ability global; generated wrappers commit synchronously','host_dependencies':['Monster record decryption/GetMonData','Construction and battle consumers','Original RAM lifetime and interrupts'],'central_table_owner':'Original ROM; output embedded readonly windows are captured assets, not additional behavior'}}
 save(base/'profile.json',profile);save(base/'qualification-result.json',{'outcome':'pass','rows':rows,'seconds':time.perf_counter()-started,'queue_seconds':None})
 print(json.dumps({'outcome':'pass','qualification':str(base),'rows':rows}))
def reconstruct(game,runtime,vectors):
 sys.path.insert(0,str(runtime));from tools.roundtrip.extract import extract
 from tools.roundtrip.ir_provider import run
 base=runtime/'local'/game;baseline=base/'baseline';start=time.perf_counter();extract(base/'original.gba',baseline,GAMES[game]['game']);elapsed=time.perf_counter()-start
 report=run(json.loads((base/'profile.json').read_text()),base/'original.gba',baseline/'manifest.json',base/'reconstruction',vectors)
 save(base/'result.json',{'outcome':report['outcome'],'opaque_baseline_seconds':elapsed,'baseline_source_matching_elf':None,'provider_seconds':report['timing']['total_seconds'],'raw_changed_bytes':report['raw_changed_bytes'],'behavior_bytes':report['generated_behavior_function_bytes'],'rebuilt_sha256':report['rebuilt_sha256']})
 print((base/'result.json').read_text())
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--game',choices=GAMES,required=True);p.add_argument('--runtime',type=Path,required=True);p.add_argument('--export',type=Path);p.add_argument('--mode',choices=['qualify','reconstruct'],required=True);p.add_argument('--vectors',type=int,default=4096);args=p.parse_args();runtime=args.runtime.resolve()
 if args.mode=='qualify':prepare(args.game,runtime,args.export.resolve(),args.vectors)
 else:reconstruct(args.game,runtime,args.vectors)
if __name__=='__main__':main()
