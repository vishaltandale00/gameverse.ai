"""Map real saved RAM snapshots to symbolic scalar fixtures (validation only)."""
from pathlib import Path
import json,hashlib,shutil,sys
from qualify import qualify
ROOT=Path(__file__).resolve().parents[2]

def qualify_sonic_snapshots(out):
 captures=ROOT/'local/captures-experiments/20261016-current-scripts/sonic-advance'
 reports=[]
 for name in('sonic.motion.integrate','sonic.motion.gravity','sonic.motion.surface_projection','sonic.motion.slope_acceleration','sonic.motion.surface_detach'):
  source=ROOT/'local/ir/packages'/name;destination=out/name;destination.mkdir(parents=True,exist_ok=False)
  for f in('l1.json','validation-adapter.json','generated.c'):shutil.copy2(source/f,destination/f)
  a=json.loads((source/'validation-adapter.json').read_text());rows=[];contexts=[]
  for phase in('attract','gameplay'):
   folder=captures/phase;images={0x02000000:(folder/'ewram.bin').read_bytes(),0x03000000:(folder/'iwram.bin').read_bytes()};row={}
   for f in a['fields']:
    address=(0x03005a20+f['offset'])if f['owner']=='entity'else(f['address']+f['offset']);base=0x02000000 if address<0x03000000 else 0x03000000;start=address-base;row[f['name']]=int.from_bytes(images[base][start:start+f['width']//8],'little')
   rows.append(row);contexts.append({'phase':phase,'phase_metadata_sha256':hashlib.sha256((folder/'phase.json').read_bytes()).hexdigest(),'iwram_sha256':hashlib.sha256(images[0x03000000]).hexdigest(),'ewram_sha256':hashlib.sha256(images[0x02000000]).hexdigest(),'interpretation':'end-of-phase RAM snapshot, not a captured function-entry trace','entity_binding_evidence':'independently recovered native player actor instance'})
  fixtures={'states':rows,'context':contexts};(destination/'fixtures.json').write_text(json.dumps(fixtures,indent=2)+'\n');r=qualify(destination,ROOT/'local/roms/Sonic Advance (USA) (En,Ja).gba',len(rows),fixtures=fixtures);reports.append({'id':name,'outcome':r['outcome'],'wall_s':r['wall_s'],'error':r.get('error')});print(reports[-1],flush=True)
 (out/'summary.json').write_text(json.dumps(reports,indent=2)+'\n');return reports
if __name__=='__main__':qualify_sonic_snapshots(Path(sys.argv[1]).resolve())
