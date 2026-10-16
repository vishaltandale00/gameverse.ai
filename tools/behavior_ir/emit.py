"""Emit a qualified symbolic component ABI for another native runtime/backend."""
from pathlib import Path
import argparse,hashlib,json,re,time
from lower import lower,T
from contract import validate
ROOT=Path(__file__).resolve().parents[2]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def emit(manifest_path,out,symbol):
 start=time.perf_counter()
 if not re.fullmatch('[A-Za-z_][A-Za-z_0-9]*',symbol):raise ValueError('invalid exported ABI symbol')
 m=json.loads(manifest_path.read_text());source=manifest_path.parent/m['behavior'];x=json.loads(source.read_text());receipt=manifest_path.parent/m['qualification']['receipt'];r=json.loads(receipt.read_text());validate(x)
 if m['qualification']['status']!='pass'or r['outcome']!='pass'or sha(source)!=m['behavior_sha256']or r['artifacts']['l1.json']['sha256']!=sha(source):raise ValueError('qualified behavior identity required')
 out.mkdir(parents=True,exist_ok=False);state=symbol+'_State';code=lower(x).replace('LiftedState',state).replace('behavior_0',symbol).replace('static uint','static __attribute__((unused)) uint')
 code=re.sub(r'^ (uint(?:8|16|32|64)_t) ((?:dependency_[0-9]+_)*value_[0-9]+);$',r' \1 \2 __attribute__((unused));',code,flags=re.MULTILINE)
 fields=''.join(' '+T[f['storage_type']]+' '+f['name']+';\n'for f in x['state'])+''.join(' '+T[c['storage_type']]+' '+c['name']+'['+str(c['count'])+'];\n'for c in x.get('collections',[]));params=''.join(', '+T[p['storage_type']]+' '+p['name']for p in x.get('parameters',[]));return_type='void'if x['return_type']=='void'else T[x['return_type']];header='#pragma once\n#include <stdint.h>\n/* Generated from qualified address-free L1; fields are owned symbolic state. */\ntypedef struct {\n'+fields+'} '+state+';\n'+return_type+' '+symbol+'('+state+' *s'+params+');\n';(out/'component.c').write_text(code);(out/'component.h').write_text(header)
 report={'schema':'gameverse.ir.emitted-abi/0.1','component':m['id'],'version':m['version'],'symbol':symbol,'state_type':state,'source_package_sha256':sha(manifest_path),'behavior_sha256':sha(source),'native_qualification_sha256':sha(receipt),'emitter_sha256':sha(Path(__file__)),'lowerer_sha256':sha(ROOT/'tools/behavior_ir/lower.py'),'outputs':{p.name:sha(p)for p in[out/'component.c',out/'component.h']},'state':x['state'],'collections':x.get('collections',[]),'parameters':x.get('parameters',[]),'return_type':x['return_type'],'effects':m['effects'],'preconditions':x['preconditions'],'limitations':m['gaps'],'timing':{'queue_s':None,'mode':'emit_only_no_native_retest','wall_s':time.perf_counter()-start}};(out/'abi-receipt.json').write_text(json.dumps(report,indent=2)+'\n');return report
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('package',type=Path);p.add_argument('out',type=Path);p.add_argument('--symbol',required=True);a=p.parse_args();print(json.dumps(emit(a.package.resolve(),a.out.resolve(),a.symbol),indent=2))
