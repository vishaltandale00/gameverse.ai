"""Publish compact, conservative progress from retained receipts; no new tests."""
from pathlib import Path
import datetime,json,subprocess
from pipeline import ROOT,save
from catalog import export_catalog

def snapshot(queue_path):
 q=json.loads(queue_path.read_text());catalog=export_catalog();packages=[]
 for p in sorted((ROOT/'local/ir/packages').glob('*/package.json')):
  m=json.loads(p.read_text());r=json.loads((p.parent/m['qualification']['receipt']).read_text());packages.append({'id':m['id'],'source_game':m['source_game'],'vectors':r['parity']['vectors'],'qualification':'native_finite_pass','typed_ports':any(f.get('quantity')!='unknown'for f in m['field_meanings'].values())or bool(m.get('collection_meanings'))})
 for item in q['items']:
  item['game_readiness']='partial_not_complete';item['all_mechanics_recovered']=False
  path=ROOT/'local/ir/depth-status'/(item['id']+'.json')
  if path.exists():
   s=json.loads(path.read_text());item['counts'].update(s['counts']);item['depth_status']=str(path.relative_to(ROOT));item['pending_depth_targets']=[{'id':r['id'],'reason':r.get('reason','unattempted')}for r in s['rows']if r['outcome']!='native_qualified'];item['missing_l0']=s['missing_l0']
  known={p.stem for a in item['attempts']if a.get('artifacts')for p in(ROOT/a['artifacts']/'l0').glob('0*.json')}
  if known:item['counts']['exported']=len(known)
 q['policy'].update(active_depth_games=['super-mario-advance','super-mario-advance-2-super-mario-world','super-mario-advance-4-super-mario-bros-3'],completion='Explicit full mechanic-family closure plus unknown-coverage review; never an export, candidate, function or one component lane. Per-batch caps continue pending work.');save(queue_path,q)
 status_path=ROOT/'research/automatic-ir/status.json';old=json.loads(status_path.read_text());history=ROOT/'research/automatic-ir/initial-slice-status.json'
 if not history.exists():save(history,old)
 generations=[]
 for p in sorted((ROOT/'local/ir/generated').glob('*/status.json')):
  r=json.loads(p.read_text());generations.append({'request_id':r['request_id'],'outcome':r.get('outcome'),'diagnostic':r.get('diagnostic'),'rom_sha256':r.get('artifacts',{}).get('rom_sha256'),'receipt':str(p.relative_to(ROOT)),'wall_s':r.get('wall_s'),'route':r.get('qualification',{})})
 result={'schema':'gameverse.automatic-ir-status/0.3','source_commit_at_snapshot':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'updated_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'objective_status':'ONGOING_ALL_GAMES_PARTIAL','scope':'Automatic own-ROM executable mechanics and new-ROM compositions; complete Mario mechanic recovery is active priority. None of this count is whole-game completeness.','rom_inventory':len(q['items']),'discovery_states':{s:sum(i['state']==s for i in q['items'])for s in{r['state']for r in q['items']}},'bounded_l0_exports':sum(i['counts']['exported']for i in q['items']),'bounded_static_l1_candidates':sum(i['counts']['static_candidates']for i in q['items']),'retained_native_qualified_packages':len(packages),'typed_port_subset_packages':sum(p['typed_ports']for p in packages),'retained_package_fixture_pairs':sum(p['vectors']for p in packages),'packages':packages,'generated_compositions':generations,'queue_ref':'local/ir/automatic-queue.json','coverage_ref':'research/automatic-ir/mario-mechanic-coverage.json','continuation_policy':'tools/behavior_ir/CONTINUATION.md','initial_checkpoint_ref':'research/automatic-ir/initial-slice-status.json','count_limits':['Candidate pools are bounded, not complete ROM/function/instruction coverage','Fixture counts sum retained per-package finite proofs; they are not unique gameplay states or whole-game mechanics coverage','Typed port subsets are usable qualified pieces, not completed parent controllers or games','New-ROM world/contact/projectile/gate/rendering are explicitly authored IR; recovered behaviors and source datasets are named in composition receipts'],'active_blockers':['Mario shared world/entity actor views require typed entity handles and alias-preserving pool schema; separate actor/world copies would be incorrect','Original audio/render service boundaries are not interchangeable with resource/collision effects','General loop structuring, dynamic callbacks, unresolved pointer aliases and non-AAPCS profiles remain unsupported','Full terrain/controllers/health/death/enemies/abilities/progression/persistence and bundled engines remain partial/unexplored'],'timing_context':'Retained receipts include actual build/native stages and immutable hashes; queue latency is unavailable. No paid provider calls or new dependency/CI job. Reused exact behavior/native identities avoid broad unchanged reruns.'};save(status_path,result);return result
if __name__=='__main__':
 import argparse
 p=argparse.ArgumentParser();p.add_argument('queue',type=Path);a=p.parse_args();r=snapshot(a.queue);print(json.dumps({k:r[k]for k in('objective_status','rom_inventory','retained_native_qualified_packages','typed_port_subset_packages','retained_package_fixture_pairs')},indent=2))
