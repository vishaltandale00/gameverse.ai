"""Automatically link three cached shape/overlap L1s; native connected sequence.
The linking schedule is declared composition, not a fictitious original entry.
"""
import argparse
import hashlib
import json
from pathlib import Path
import time
from lift import Lifter
from lower import lower
from contract import validate
from qualify import qualify

ROOT=Path(__file__).resolve().parents[2]
RUN=ROOT/'local/ir/sma4-contact-query-20261016'
ROM=ROOT/'local/roms/Super Mario Advance 4 - Super Mario Bros. 3 (USA).gba'
SOURCES=[ROOT/'local/ir/dependency-exports/20261016T101717908568/super-mario-advance-4-super-mario-bros-3/l0/080460fc.json',ROOT/'local/ir/dependency-exports/20261016T100757084950/super-mario-advance-4-super-mario-bros-3/l0/08046154.json',ROOT/'research/deep-extraction/mario/parallel-sma4/overlap-export/l0/08046320.json']
ENTRIES=['080460fc','08046154','08046320']
EVIDENCE=['research/deep-extraction/mario/parallel-sma4/findings.json','research/deep-extraction/mario/parallel-sma4/overlap-findings.json']


def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def save(p,value):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(value,indent=2)+'\n')


def linked_source():
    vs=[dict(id='v0',size=4,space='register',offset=32,register='r0',input=True,constant=False),dict(id='v1',size=4,space='register',offset=36,register='r1',input=True,constant=False)]
    for i,entry in enumerate(ENTRIES):vs.append(dict(id='v'+str(i+2),size=4,space='const',offset=int(entry,16),input=False,constant=True))
    vs.extend([dict(id='v5',size=4,space='unique',offset=0,input=False,constant=False),dict(id='v6',size=4,space='const',offset=1,input=False,constant=True)])
    return dict(entry='080460fc',derivation='declared_connected_invocation_sequence_not_original_ROM_entry',varnodes=vs,blocks=[dict(id=0,predecessors=[],successors=[],ops=[dict(id='shape_b',opcode='CALL',pc='08046154',inputs=['v3','v1']),dict(id='shape_a',opcode='CALL',pc='080460fc',inputs=['v2','v0']),dict(id='overlap',opcode='CALL',pc='08046320',inputs=['v4'],output='v5'),dict(id='result',opcode='RETURN',pc='08046320',inputs=['v6','v5'])])])



def fixtures(adapter,raw):
    table=raw[0x154cdc:0x154cdc+256]
    assert hashlib.sha256(table).hexdigest()=='d8b545e39329dd4883f4d5d744dd51d62dd41697d19c22fdece0f5b228c6fba2'
    states=[];expected=[];returns=[];classes={}
    fields=adapter['fields'];entity={(f['argument'],f['offset']):f['name']for f in fields if f['owner']=='entity'}
    glob={f['offset']-0x03003ad4:f['name']for f in fields if f['owner']=='global'}
    for ai in range(64):
        for bi in range(64):
            n=len(states);kind=n%12;flag_a=(n//12)%2;flag_b=(n//24)%2
            ta=table[ai*4:ai*4+4];tb=table[bi*4:bi*4+4]
            wa=(ta[1]+16*flag_a)&255;wb=(tb[1]+16*flag_b)&255;ha=ta[3];hb=tb[3]
            dx,dy=[(0,0),(wa,ha),(-wb,-hb),(wa+1,0),(0,ha+1),(-wb-1,0),(0,-hb-1),(128,0),(0,128),(-1,1),(1,-1),(255,255)][kind]
            ax,ay=(250 if n%2 else 32),(240 if n%3 else 64);bx=(ax+dx)&255;by=(ay+dy)&255
            row={f['name']:(0x5a+n*17+i*29)&255 for i,f in enumerate(fields)}
            for role,index,t,x,y,flag in [('r0',ai,ta,ax,ay,flag_a),('r1',bi,tb,bx,by,flag_b)]:
                row[entity[role,12]]=(x-t[0])&255;row[entity[role,14]]=(y-t[2])&255
                row[entity[role,100]]=index|((n%4)<<6);row[entity[role,105]]=flag*(1+n%255)
            scratch=[row[glob[i]]for i in range(12)]
            scratch[0:4]=[ax,wa,bx,wb];scratch[4:8]=[ay,ha,by,hb]
            delta=(bx-ax)&255;sign=int(bool(delta&128));mag=(-delta)&255 if sign else delta;width=wb if sign else wa
            scratch[10]=mag;scratch[11]=sign;result=0;phase='x_failure'
            if mag<=width:
                phase='y_failure';scratch[11]=sign*2;scratch[8]=(mag-width)&255
                delta=(by-ay)&255;sign=int(bool(delta&128));mag=(-delta)&255 if sign else delta;height=hb if sign else ha
                scratch[10]=mag;scratch[11]+=sign
                if mag<=height:scratch[0]=height;scratch[9]=(mag-height)&255;result=1;phase='overlap'
            final=dict(row);final.update({glob[i]:v for i,v in enumerate(scratch)})
            label=phase
            classes[label]=classes.get(label,0)+1;states.append(row);expected.append(final);returns.append(result)
    return {'states':states,'expected_states':expected,'expected_returns':returns,'context':{'scope':'4096 exact connected cases: all64x64 shape-selector pairs, distributed width flags and12 touching/separation/wrap/sign classes; not full cross-product with positions/flags', 'source_table_sha256':hashlib.sha256(table).hexdigest(),'classes':classes,'shared_scratch':'one owner, B then A then overlap; full expected scratch and unchanged actor fields/backing','caller_proximity':'Full-world eligibility is deliberately outside this local modulo256 service'}}


def run(out,vectors):
    out.mkdir(parents=True,exist_ok=False);start=time.perf_counter();raw=ROM.read_bytes();compiled={}
    for entry,path in zip(ENTRIES,SOURCES):
        l0=json.loads(path.read_text());before=json.dumps(l0,sort_keys=True)
        compiled[entry]=Lifter(l0,raw).build();assert json.dumps(l0,sort_keys=True)==before
        save(out/'helpers'/entry/'l1.json',compiled[entry][0]);save(out/'helpers'/entry/'validation-adapter.json',compiled[entry][1])
    source=linked_source();save(out/'linked-source.json',source)
    x,a=Lifter(source,raw,compiled,argument_contract={'separation':'distinct_accessed_views','evidence':EVIDENCE,'precondition':'Two distinct actor records; scratch is one shared owner, never per-actor copies'}).build()
    sequence=[]
    for entry,size,args in zip(['08046154','080460fc','08046320'],[88,88,118],[{'r0':'r1'},{'r0':'r0'},{}]):
        offset=int(entry,16)-0x08000000
        sequence.append({'entry':entry,'arguments':args,'instruction_span':{'size':size,'sha256':hashlib.sha256(raw[offset:offset+size]).hexdigest()}})
    a['native_sequence']=sequence;a['source_l0s']=[{'ref':str(p.relative_to(ROOT)),'sha256':sha(p)}for p in SOURCES]
    x['limitations'].extend(['Declared shape-B, shape-A, overlap invocation sequence, not one original ROM function or recovered caller eligibility','Two distinct actor records; modulo256 local pixel geometry only; caller must enforce full-world proximity before invoking','Touching is inclusive. Scratch failure outputs may be stale; inspect Boolean before interpreting penetration/direction','No target eligibility, HP, damage, retirement, pixel-mirror synchronization, full contact dispatch or game completeness claim'])
    def meaning(quantity,frame,label,**extra):return dict(quantity=quantity,unit={'numerator':1,'denominator':1},frame=frame,label=label,confidence=0.98,evidence=EVIDENCE,**extra)
    for f in a['fields']:
        annotation=None
        if f['owner']=='entity':
            if f['offset']in(12,14):annotation=meaning('position','collision.local.'+('x.right'if f['offset']==12 else'y.down'),'Actor pixel mirror modulo256')
            elif f['offset']==100:annotation=meaning('enum','sma4.collision.shape_selector','Source selector, low6 bits select one of64 shapes')
            elif f['offset']==105:annotation=meaning('flag','sma4.collision.width_expansion','Zero or any nonzero: add16 pixels to width')
        elif f['offset']in(0x03003ad5,0x03003ad7):annotation=meaning('extent','collision.local.x.right','Selected source shape width')
        elif f['offset']in(0x03003ad9,0x03003adb):annotation=meaning('extent','collision.local.y.down','Selected source shape height')
        elif f['offset']in(0x03003adc,0x03003add):annotation=meaning('penetration_negative','collision.local.'+('x.right'if f['offset']==0x03003adc else'y.down'),'Negative overlap depth; valid only after successful query',signed_encoding='twos_complement')
        elif f['offset']==0x03003adf:annotation=meaning('bitset','sma4.collision.direction','On success bit1 is negativeX difference, bit0 negativeY; failure representation differs')
        if annotation:next(z for z in x['state']if z['name']==f['name'])['semantic_type']=annotation
    caller=ROOT/'local/ir/dependency-exports/20261016T095404606414/super-mario-advance-4-super-mario-bros-3/l0/08051144.json'
    caller_data=json.loads(caller.read_text());blocks={b['id']:b for b in caller_data['blocks']};dom={i:set(blocks)for i in blocks};dom[min(blocks)]={min(blocks)}
    while True:
        updated={i:({i}if i==min(blocks)else{i}|set.intersection(*(dom[p]for p in b['predecessors'])))for i,b in blocks.items()}
        if updated==dom:break
        dom=updated
    assert 6 in dom[17]
    call_proofs=[]
    for pc,target in [(0x08051194,0x08046154),(0x08051224,0x080460fc),(0x08051228,0x08046320)]:
        data=raw[pc-0x08000000:pc-0x08000000+4];first=int.from_bytes(data[:2],'little');second=int.from_bytes(data[2:],'little');delta=first&2047;delta=delta-2048 if delta&1024 else delta
        assert first&0xf800==0xf000 and second&0xf800==0xf800 and (pc+4+delta*4096+(second&2047)*2)&0xffffffff==target
        call_proofs.append({'call_pc':f'{pc:08x}','callee':f'{target:08x}','bytes_hex':data.hex(),'sha256':hashlib.sha256(data).hexdigest()})
    save(out/'derivation.json',{'kind':'declared_ordered_composition_of_automatically_recovered_L1_bodies','schedule':['shape_b','shape_a','overlap'],'source_l0s':a['source_l0s'],'caller_evidence':{'ref':str(caller.relative_to(ROOT)),'sha256':sha(caller),'calls':call_proofs,'dominance':'shapeB block6 dominates shapeA/overlap block17'},'excluded':'Caller loop, proximity, eligibility and reaction dispatch are not recovered by this wrapper','return_semantics':meaning('boolean','collision.overlap','Inclusive local shape overlap; fullu32 originalr0 compared')})
    validate(x);save(out/'l1.json',x);save(out/'validation-adapter.json',a);(out/'generated.c').write_text(lower(x))
    data=fixtures(a,raw);save(out/'fixtures.json',data)
    assert vectors>=len(data['states'])
    result=qualify(out,ROM,vectors,fixtures=data)
    summary={'outcome':result['outcome'],'error':result.get('error'),'vectors':vectors,'wall_s':time.perf_counter()-start,'qualification_wall_s':result['wall_s'],'publication':'pending independent semantic review'};save(out/'summary.json',summary);return summary


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True);p.add_argument('--vectors',type=int,default=4096);a=p.parse_args();print(json.dumps(run(a.out.resolve(),a.vectors),indent=2))
