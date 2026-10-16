"""Opt-in no-model paired native option benchmark; private ROM/state/output only."""
import argparse,importlib.util,json,time,hashlib,platform,subprocess
from pathlib import Path
from tools.playtester.sonic_adapter import SonicTraversalAdapter
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--rom',type=Path,required=True);parser.add_argument('--state',type=Path,required=True)
parser.add_argument('--out',type=Path,required=True);parser.add_argument('--baseline-ref',required=True)
parser.add_argument('--frames',type=int,default=240);parser.add_argument('--baseline-frames',type=int,default=24)
parser.add_argument('--repeats',type=int,default=2)
args=parser.parse_args()
if not 1<=args.frames<=3600 or not 1<=args.baseline_frames<=120 or not 1<=args.repeats<=3:
 parser.error('invalid bounded benchmark limits')
root=Path(__file__).resolve().parents[2];args.out=args.out.resolve();args.out.mkdir(parents=True,exist_ok=False)
old=args.out/'baseline-sonic.py'
old.write_bytes(subprocess.check_output(['git','show',args.baseline_ref+':tools/playtester/sonic_adapter.py'],cwd=root))
spec=importlib.util.spec_from_file_location('old_sonic',old);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);module.ROOT=root
rom=args.rom.resolve();state=args.state.resolve()
rows=[]
# Identical held RIGHT inputs, 240 frames total, same exact private state;
# changed-source boundaries are retained as new observations before continuing.
for run in range(args.repeats):
 for mode,cls in [('baseline',module.SonicTraversalAdapter),('watched',SonicTraversalAdapter)]:
  start=time.monotonic();out=args.out/f'{mode}-{run}'
  a=cls(rom,out,state,**({'max_option_frames':args.frames} if mode=='watched' else {}));setup=time.monotonic()-start
  a.inner.metrics={'command_count':{},'command_wall_s':{},'png_wall_s':0.,'rgba_read_wall_s':0.}
  action_s=observe_s=0.;spent=0;observations=0;boundaries=[]
  try:
   t=time.monotonic();initial=a.observe();observe_s+=time.monotonic()-t;observations+=1
   while spent<args.frames:
    count=min(args.baseline_frames if mode=='baseline' else args.frames,args.frames-spent)
    t=time.monotonic();r=a.act({'id':'right','keys':['RIGHT'],'frames':count},count);action_s+=time.monotonic()-t;spent+=r['frames']
    if r.get('decision_boundary'):boundaries.append(r['decision_boundary'])
    t=time.monotonic();last=a.observe();observe_s+=time.monotonic()-t;observations+=1
   row={'mode':mode,'repeat':run,'total_wall_s':time.monotonic()-start,'setup_wall_s':setup,'action_wall_s':action_s,'observation_wall_s':observe_s,'frames':spent,'observations':observations,'boundaries':boundaries,'native_metrics':a.inner.metrics,'end_progress':last['progress'],'image_sha256':last['evidence']['image_sha256']}
  finally:a.close()
  rows.append(row)
report={'schema':'gameverse.native-option-throughput/1','baseline_ref':args.baseline_ref,'frames_requested':args.frames,'baseline_frames':args.baseline_frames,'source_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'environment':platform.platform(),'rom_sha256':hashlib.sha256(rom.read_bytes()).hexdigest(),'state_sha256':hashlib.sha256(state.read_bytes()).hexdigest(),'native_sha256':hashlib.sha256((root/'tools/re/session/build/gba-session').read_bytes()).hexdigest(),'model_calls':0,'scope':'Same pinned supplied state and held RIGHT input, baseline short observations versus watched bounded option with120-frame position samples. Diagnostic input replay only, no model/campaign speed claim. All native commands include IPC+emulation; PNG metric overlaps observation. Queue/build/model unavailable in replay.','runs':rows}
p=args.out/'comparison.json';p.write_text(json.dumps(report,indent=2)+'\n');print(str(p))
