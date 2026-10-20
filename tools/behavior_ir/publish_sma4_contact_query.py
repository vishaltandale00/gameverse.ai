"""Publish only a reviewed, finite-qualified declared sequence over cached L1s."""
import argparse
import json
import shutil
from pathlib import Path
from qualify_sma4_contact_query import ROOT, sha, save
from publish import effects

ID='sma4.collision.actor_pair_query'


def prepare(source):
    x=json.loads((source/'l1.json').read_text());a=json.loads((source/'validation-adapter.json').read_text());r=json.loads((source/'receipt.json').read_text());d=json.loads((source/'derivation.json').read_text())
    assert r['outcome']=='pass' and r['native_sequence']==a['native_sequence']
    for name in ['l1.json','validation-adapter.json','generated.c']:assert sha(source/name)==r['artifacts'][name]['sha256']
    for record in d['source_l0s']:assert sha(ROOT/record['ref'])==record['sha256']
    m={'schema':'gameverse.executable-component/0.2','id':ID,'version':'0.1.0','title':'Two actor shapes and inclusive local contact query','source_game':'super-mario-advance-4-super-mario-bros-3','origin':'automatic_highfunction_linked_sequence','behavior':'l1.json','behavior_sha256':sha(source/'l1.json'),'qualification':{'status':'pass','receipt':'receipt.json','vectors':r['parity']['vectors'],'scope':r['capture_fixtures']['scope'],'kind':'declared_connected_sequence_native_equivalence_not_original_function_root'},'derivation':d,'source_l0s':a['source_l0s'],'native_sequence':a['native_sequence'],'return_semantics':d['return_semantics'],'effects':effects(x),'field_meanings':{f['name']:f['semantic_type']for f in x['state']},'collection_meanings':{},'owned_collections':x['collections'],'lifecycle':{'storage':'component_instance_with_one_shared_collision_scratch','clock':'explicit_query_invocation','phase':'caller_proximity_and_eligibility_guards_before_query','ordering':'shape_B_then_shape_A_then_overlap'},'gaps':x['limitations'],'mechanics_role':'combat','ports_ready':True,'closure_ready':True,'dependency_closure':'closed_declared_helper_sequence'}
    save(source/'package.json',m);return m


def publish(source):
    m=prepare(source);destination=ROOT/'local/ir/packages'/ID;destination.mkdir(exist_ok=False)
    for name in ['linked-source.json','l1.json','validation-adapter.json','generated.c','receipt.json','package.json','derivation.json']:shutil.copy2(source/name,destination/('l0.json'if name=='linked-source.json'else name))
    return m


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('--publish',action='store_true');a=p.parse_args();print(json.dumps((publish if a.publish else prepare)(a.source.resolve()),indent=2))
