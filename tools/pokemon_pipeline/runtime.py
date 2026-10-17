#!/usr/bin/env python3
"""Bounded, local-only LeafGreen source adapter; never publishes source assets."""
import argparse, hashlib, json, os, platform, re, shutil, subprocess, tarfile, time
from pathlib import Path
SOURCE_PIN='037335f4c725d7c9aecdac87066f2002b4bd7e14'
DONOR_PIN='731ad5bfd6e6f265508d0efcca0ba42f9dcf5881'
ROM_SHA1='7862c67bdecbe21d1d69ce082ce34327e1c6ed5e'
ROM_NAME='Pokemon - LeafGreen Version (USA, Europe) (Rev 1).gba'
TOKEN=re.compile(r'\b[A-Za-z_]\w*\b')
def digest(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def save(p,v):Path(p).write_text(json.dumps(v,indent=2)+'\n')
def command(args,cwd,log,timeout=180):
 start=time.monotonic()
 with open(log,'a') as stream:subprocess.run(args,cwd=cwd,env={**os.environ,'CPATH':'/opt/homebrew/include','LIBRARY_PATH':'/opt/homebrew/lib'},stdout=stream,stderr=subprocess.STDOUT,check=True,timeout=timeout)
 return round(time.monotonic()-start,6)
def git(p,*args):return subprocess.check_output(['git','-C',str(p),*args],text=True).strip()
def prepare(runtime,work,operation='emerald-overworld',host_original=None,donor_original=None):
 work.mkdir(parents=True,exist_ok=False);base=runtime/'local/decomps/pokefirered';donor=runtime/('local/decomps/sa2' if operation=='sonic-player' else 'local/decomps/pokeemerald');donor_pin='393357f7c9d46b5c10b6c41a57b80fe3b58f3c8d' if operation=='sonic-player' else DONOR_PIN;donor_id='sonic-advance' if operation=='sonic-player' else 'pokemon-emerald';tool=runtime/'local/game-builds/toolchains/agbcc-sonic';rom=host_original or runtime/'local/roms'/ROM_NAME
 for path,pin in [(base,SOURCE_PIN),(donor,donor_pin)]:
  if git(path,'rev-parse','HEAD')!=pin or git(path,'status','--porcelain'):raise ValueError('source_pin_or_cleanliness_mismatch:'+str(path))
 if operation=='sonic-player':
  sonic=donor_original or runtime/'local/roms/Sonic Advance (USA) (En,Ja).gba'
  if hashlib.sha1(sonic.read_bytes()).hexdigest()!='d842afa7dd1e84de08addb94a51506f1bcafd551':raise ValueError('sonic_original_identity_mismatch')
  shutil.copy2(sonic,work/'donor-original.gba')
 data=rom.read_bytes()
 if hashlib.sha1(data).hexdigest()!=ROM_SHA1 or data[0xac:0xb0]!=b'BPGE' or data[0xbc]!=1:raise ValueError('leafgreen_rev1_original_identity_mismatch')
 for path,name in [(base,'source'),(donor,'donor')]:
  archive=work/(name+'.tar');subprocess.run(['git','-C',str(path),'archive','--output='+str(archive),'HEAD'],check=True)
  dest=work/name;dest.mkdir()
  with tarfile.open(archive) as stream:
   for member in stream.getmembers():
    if member.issym() or member.islnk() or not (dest/member.name).resolve().is_relative_to(dest):raise ValueError('unsafe_source_archive')
   stream.extractall(dest)
  archive.unlink()
 install=work/'source/tools/agbcc'
 for folder in ['bin','include','lib']:(install/folder).mkdir(parents=True,exist_ok=True)
 for name in ['agbcc','old_agbcc','agbcc_arm']:shutil.copy2(tool/name,install/'bin'/name)
 for folder in ['libc/include','ginclude']:shutil.copytree(tool/folder,install/'include',dirs_exist_ok=True)
 for name in ['libgcc.a','libc.a']:shutil.copy2(tool/name,install/'lib'/name)
 receipt={'schema':'gameverse.pokemon-source-baseline/1','source_games':['pokemon-leafgreen',donor_id],'operation':operation,'base':{'id':'pokemon-leafgreen','revision':1,'code':'BPGE','original_sha1':ROM_SHA1,'original_sha256':digest(rom),'source_commit':SOURCE_PIN,'source_tree':git(base,'rev-parse','HEAD^{tree}')},'donor':{'id':donor_id,'source_commit':donor_pin,'source_tree':git(donor,'rev-parse','HEAD^{tree}')},'toolchain_commit':git(tool,'rev-parse','HEAD'),'toolchain_files':{name:digest(tool/name) for name in ['agbcc','old_agbcc','agbcc_arm','libgcc.a','libc.a']},'machine':platform.platform(),'queue_s':None,'ir_scope':'No IR regeneration. Version-matched decompilation supplies the native host; donor frame/palette data and explicit role bindings supply transferred rendering.'}
 if operation=='sonic-player':receipt['donor'].update(original_sha1=hashlib.sha1(sonic.read_bytes()).hexdigest(),original_sha256=digest(sonic))
 save(work/'baseline.json',receipt);return receipt

def definitions(root):
 result={}
 for file in (root/'src/data/object_events').glob('*.h'):
  text=file.read_text()
  pattern=r'(?m)^(?:static\s+)?const\s+[^;={\n]+?\b([gs]\w+)\s*(?:\[[^;=]*?\])?\s*=\s*'
  for match in re.finditer(pattern,text):
   end=text.find(';',match.end())
   if end<0:raise ValueError('unterminated_definition')
   result[match[1]]=text[match.start():end+1]
 return result

def import_assets(work):
 host=work/'source';donor=work/'donor';defs=definitions(donor);hostdefs=definitions(host)
 # Native host object IDs stay authoritative. Matching names denote the same NPC/Pokemon identity.
 pairs={name:name for name in hostdefs if name.startswith('gObjectEventGraphicsInfo_') and name in defs}
 for sex,character in [('Red','Brendan'),('Green','May')]:
  for state,source in [('Normal','Normal'),('Bike','MachBike'),('Surf','Surfing'),('FieldMove','FieldMove'),('Fish','Fishing')]:
   h='gObjectEventGraphicsInfo_'+sex+state;d='gObjectEventGraphicsInfo_'+character+source
   if h in hostdefs and d in defs:pairs[h]=d
 aliases={'Boy':'Boy1','OldMan1':'OldMan','OldMan2':'OldMan','Fisher':'Fisherman','GbaKid':'GameboyKid','Man':'Man1','Woman1':'Woman1','Woman2':'Woman2','Woman3':'Woman3','Mom':'Mom'}
 for h,d in aliases.items():
  h='gObjectEventGraphicsInfo_'+h;d='gObjectEventGraphicsInfo_'+d
  if h in hostdefs and d in defs:pairs[h]=d
 # Complete dependency closure includes OAM/subsprites, animations and frame pointers.
 ordered=[];seen=set()
 def visit(name):
  if name in seen:return
  seen.add(name)
  for token in TOKEN.findall(defs[name]):
   if token!=name and token in defs:visit(token)
  ordered.append(name)
 for name in pairs.values():visit(name)
 # Palette names have runtime tags and cannot be blindly grafted onto LeafGreen slots.
 # Until exact palette families are mapped, fail closed rather than emitting a misleading cartridge.
 manifest={'schema':'gameverse.pokemon-sprite-coverage/1','base_revision':1,'object_mappings':[{'host':h,'donor':d} for h,d in sorted(pairs.items())],'dependency_symbols':ordered,'unmatched_host_objects':sorted(set(n for n in hostdefs if n.startswith('gObjectEventGraphicsInfo_'))-set(pairs)),'status':'mapping-unqualified','gaps':['Exact palette-slot/reflection mapping and native graphics-consumer qualification pending. No cartridge may be qualified from this static dependency inventory.']}
 save(work/'sprite-coverage.json',manifest);return manifest

def baseline(work):
 source=work/'source';started=time.monotonic()
 receipt={'outcome':'failed','raw_exact':False,'expected_sha1':ROM_SHA1,'mode':'clean','cache':'miss; fresh git archive','wall_s':None,'timeout_s':180,'jobs':2}
 try:
  command(['make','-j2','CPP=clang -E -Wno-invalid-pp-token','compare_leafgreen_rev1'],source,work/'baseline-build.log')
  rom=source/'pokeleafgreen_rev1.gba'
  if hashlib.sha1(rom.read_bytes()).hexdigest()!=ROM_SHA1:raise ValueError('baseline_not_exact')
  (work/'baseline-artifacts').mkdir(exist_ok=True)
  for suffix in ['gba','elf','map']:shutil.copy2(source/('pokeleafgreen_rev1.'+suffix),work/('baseline-artifacts/pokeleafgreen_rev1.'+suffix))
  receipt.update(outcome='pass',raw_exact=True,sha1=ROM_SHA1,sha256=digest(rom))
  return receipt
 except BaseException as error:
  receipt.update(error=str(error),error_type=type(error).__name__);raise
 finally:
  receipt['wall_s']=round(time.monotonic()-started,6);save(work/'baseline-build.json',receipt)

def apply(work):
 recipe=json.loads((work/'recipe.json').read_text())
 if recipe.get('operation')=='sonic-player':
  from character_assets import apply as apply_assets
 else:
  from assets import apply as apply_assets
 if not json.loads((work/'baseline-build.json').read_text()).get('raw_exact'):raise ValueError('exact_leafgreen_baseline_required')
 result=apply_assets(work)
 save(work/'sprite-coverage.json',result)
 return result

def build(work):
 started=time.monotonic();receipt={'outcome':'failed','mode':'incremental','cache':'hit; exact baseline objects retained','wall_s':None,'timeout_s':180,'jobs':2}
 try:
  command(['make','-j2','CPP=clang -E -Wno-invalid-pp-token','leafgreen_rev1'],work/'source',work/'sprite-build.log')
  rom=work/'source/pokeleafgreen_rev1.gba';data=rom.read_bytes()
  if data[0xac:0xb0]!=b'BPGE' or data[0xbc]!=1:raise ValueError('modified_cartridge_host_identity_changed')
  if digest(rom)==json.loads((work/'baseline-build.json').read_text())['sha256']:raise ValueError('sprite_build_did_not_change_cartridge')
  (work/'build').mkdir(exist_ok=True)
  for suffix in ['gba','elf','map']:shutil.copy2(work/('source/pokeleafgreen_rev1.'+suffix),work/('build/game.'+suffix))
  receipt.update(outcome='pass',artifact={'path':str(work/'build/game.gba'),'sha256':digest(work/'build/game.gba')},elf={'path':str(work/'build/game.elf'),'sha256':digest(work/'build/game.elf')},map={'path':str(work/'build/game.map'),'sha256':digest(work/'build/game.map')})
  return receipt
 except BaseException as error:
  receipt.update(error=str(error),error_type=type(error).__name__);raise
 finally:
  receipt['wall_s']=round(time.monotonic()-started,6);save(work/'sprite-build.json',receipt)

def main():
 parser=argparse.ArgumentParser();parser.add_argument('stage',choices=['prepare','inventory','baseline','apply','build']);parser.add_argument('--workspace',type=Path,required=True);parser.add_argument('--runtime',type=Path);parser.add_argument('--host-original',type=Path);parser.add_argument('--donor-original',type=Path);parser.add_argument('--operation',choices=['emerald-overworld','sonic-player'],default='emerald-overworld');a=parser.parse_args();started=time.monotonic();result=None
 try:
  result=prepare(a.runtime.resolve(),a.workspace.resolve(),a.operation,a.host_original,a.donor_original) if a.stage=='prepare' else {'inventory':import_assets,'baseline':baseline,'apply':apply,'build':build}[a.stage](a.workspace.resolve())
 finally:
  if a.workspace.exists():save(a.workspace/(a.stage+'-stage.json'),{'stage':a.stage,'result':result,'wall_s':round(time.monotonic()-started,6),'outcome':'pass' if result is not None else 'failed'})
if __name__=='__main__':main()
