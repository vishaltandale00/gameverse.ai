"""Continue incomplete Mario mechanics/dependency work within explicit batch caps.
A successful function/ROM build never marks a game or mechanic family complete.
"""
from pathlib import Path
import argparse,datetime,json,time
from pipeline import ROOT,save
from depth import work
from expand import expand
from seeds import discover
GAMES=['super-mario-advance','super-mario-advance-2-super-mario-world','super-mario-advance-4-super-mario-bros-3']
def run(queue,rounds=2,total_s=300):
 started=time.perf_counter();report={'schema':'gameverse.ir.mario-continuation/0.1','outcome':'continuation_required','limits':{'rounds':rounds,'total_wall_s':total_s,'targets_per_game_batch':8,'dependency_entries_per_export':8},'batches':[]};out=ROOT/'local/ir/mario-continuation'/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%f');out.mkdir(parents=True)
 for game in GAMES:
  q=json.loads(queue.read_text());item=next(i for i in q['items']if i['id']==game);known={p.stem for a in item['attempts']if a.get('artifacts')for p in(ROOT/a['artifacts']/'l0').glob('0*.json')};missing=[p['entry']for p in discover(game,ROOT/item['rom'])if p['entry']not in known]
  if missing and time.perf_counter()-started<total_s:report.setdefault('new_mechanic_exports',[]).append(expand(queue,game,missing[:64],min(75,total_s-(time.perf_counter()-started))))
 for round_index in range(rounds):
  for game in GAMES:
   if time.perf_counter()-started>=total_s:break
   result=work(queue,game,8,32,min(120,total_s-(time.perf_counter()-started)));batch={'round':round_index,'game':game,'counts':result['counts'],'selected_targets':result['selected_targets'],'missing_l0':result['missing_l0'],'depth_status':str(ROOT/'local/ir/depth-status'/(game+'.json'))};report['batches'].append(batch)
   if result['missing_l0']and time.perf_counter()-started<total_s:
    batch['dependency_export']=expand(queue,game,result['missing_l0'][:8],min(75,total_s-(time.perf_counter()-started)))
   report['wall_s']=time.perf_counter()-started;save(out/'receipt.json',report);print(game,batch['counts'],batch['missing_l0'],flush=True)
 report['wall_s']=time.perf_counter()-started;save(out/'receipt.json',report);return report
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('queue',type=Path);p.add_argument('--rounds',type=int,default=2);p.add_argument('--total-s',type=float,default=300);a=p.parse_args()
 if not 1<=a.rounds<=4 or not 0<a.total_s<=900:p.error('rounds1..4 and wall budget1..900seconds')
 run(a.queue,a.rounds,a.total_s)
