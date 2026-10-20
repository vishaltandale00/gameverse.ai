"""Focused exact entry-read proof checks using retained source; no native run."""
import copy
import hashlib
import json
from pathlib import Path
import time
from lift import Lifter
from lower import lower
from contract import validate
from readonly_entry import certify,validate_materialized


def fixture():
    root=Path(__file__).resolve().parents[2]
    source=root/'local/ir/fleet-next/sma2/contact-export01/l0/08034264.json'
    raw=json.loads(source.read_text());rom=(root/'local/roms/Super Mario Advance 2 - Super Mario World (USA, Australia).gba').read_bytes()
    callees={}
    for entry,name in [('0803407c','sma2.player_contact_box'),('0802f290','sma2.actor_contact_box'),('08034198','sma2.shared_contact_overlap')]:
        p=root/'local/ir/packages'/name;package=json.loads((p/'package.json').read_text())
        assert hashlib.sha256((p/package['behavior']).read_bytes()).hexdigest()==package['behavior_sha256']
        callees[entry]=(json.loads((p/package['behavior']).read_text()),json.loads((p/'validation-adapter.json').read_text()))
    context=json.loads((root/'research/deep-extraction/mario/context-observations.json').read_text())
    observed=next(r for r in context['records']if r['rom_sha256']==hashlib.sha256(rom).hexdigest())
    objects={f'{int(c,16):08x}':{'identity':'observed_'+c,'ownership':'distinct_access_windows','observed_targets':[int(v,16)],'evidence':['research/deep-extraction/mario/context-observations.json']}for c,v in observed['object_roots'].items()}
    request={'l0_canonical_sha256':hashlib.sha256(json.dumps(raw,sort_keys=True).encode()).hexdigest(),'load_pc':'080342cc','argument':'r0','offset':65,'width_bits':8,'value':194}
    kwargs={'callees':callees,'object_contract':objects,'state_domains':{'entity:r0:65':{'unsigned_min':194,'unsigned_max':194}},'argument_contract':{'shared_views':[{'argument':'r0','root_cell':'03007a48','base_offset':0x6cc,'stride':100,'count':12,'evidence':['research/deep-extraction/mario/parallel-sma2/dependency-contracts.json']}],'readonly_entry_reads':[request]},'project_load_lanes':True}
    return raw,rom,kwargs


def run():
    started=time.perf_counter();raw,rom,kwargs=fixture();checks=[]
    lifter=Lifter(raw,rom,**copy.deepcopy(kwargs));l1,adapter=lifter.build();validate(l1);lower(l1)
    assert l1['return_type']=='u32'and adapter['readonly_entry_reads'];checks.append('actual_original_query_materializes')
    field=next(f for f in adapter['fields']if f.get('argument')=='r0'and f['offset']==65)
    assert field['domain']=={'unsigned_min':194,'unsigned_max':194};checks.append('native_entry_byte_retained')
    assert any('Certified entry byte '+field['name']+' must equal 194'in p for p in l1['preconditions']);checks.append('symbolic_entry_precondition_retained')
    def rejects(name,change):
        source=copy.deepcopy(raw);options=copy.deepcopy(kwargs);change(source,options)
        try:Lifter(source,rom,**options)
        except (ValueError,KeyError):checks.append(name)
        else:raise AssertionError('unsafe entry read accepted: '+name)
    def insert(op):
        def change(source,options):
            next(b for b in source['blocks']if b['id']==4)['ops'].insert(0,{'id':'test_effect','pc':'080342b2','opcode':op,'inputs':[]})
            options['argument_contract']['readonly_entry_reads'][0]['l0_canonical_sha256']=hashlib.sha256(json.dumps(source,sort_keys=True).encode()).hexdigest()
        return change
    for op in ('STORE','CALLIND','CALLOTHER'):rejects('unknown_prefix_'+op,insert(op))
    rejects('unknown_callee',lambda s,k:k['callees'].pop('0803407c'))
    rejects('nonexact_domain',lambda s,k:k['state_domains']['entity:r0:65'].update(unsigned_min=193))
    rejects('stale_source',lambda s,k:k['argument_contract']['readonly_entry_reads'][0].update(l0_canonical_sha256='0'*64))
    rejects('wrong_width',lambda s,k:k['argument_contract']['readonly_entry_reads'][0].update(width_bits=16))
    rejects('wrong_offset',lambda s,k:k['argument_contract']['readonly_entry_reads'][0].update(offset=66))
    rejects('multiple_reads',lambda s,k:k['argument_contract']['readonly_entry_reads'].append(copy.deepcopy(k['argument_contract']['readonly_entry_reads'][0])))
    def overlap(source,options):
        callee=options['callees']['0803407c'][1]
        from publish import effects
        writes=effects(options['callees']['0803407c'][0])['writes']
        f=next(f for f in callee['fields']if f['name']in writes);f.update(offset=0x6cc+64,width=16)
    rejects('known_callee_partial_overlap',overlap)
    base=Lifter(raw,rom,**dict(copy.deepcopy(kwargs),argument_contract={'shared_views':kwargs['argument_contract']['shared_views']}))
    base.blocks[0]['start']='08000000'
    try:certify(base,kwargs['argument_contract']['readonly_entry_reads'])
    except ValueError:checks.append('current_cfg_remap')
    else:raise AssertionError('remapped CFG accepted')
    bad=copy.deepcopy(l1);bad['body'].append({'op':'assign_field','field':field['name'],'value':{'op':'const','type':'u8','value':0}})
    try:validate_materialized(lifter.readonly_entry_proofs,bad,adapter)
    except ValueError:checks.append('later_constrained_byte_clobber')
    else:raise AssertionError('later clobber accepted')
    bad=copy.deepcopy(adapter);next(f for f in bad['fields']if f['name']==field['name']).pop('domain')
    try:validate_materialized(lifter.readonly_entry_proofs,l1,bad)
    except ValueError:checks.append('lost_native_input_domain')
    else:raise AssertionError('missing native byte domain accepted')
    print(json.dumps({'outcome':'pass','checks':len(checks),'names':checks,'wall_s':time.perf_counter()-started,'native_calls':0}))


if __name__=='__main__':run()
