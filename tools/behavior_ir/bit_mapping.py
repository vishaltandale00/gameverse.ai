"""Explicit authored unsigned-bit transport; no recovered semantic relabeling."""
import copy
import hashlib
import json

KIND='authored_u16_bit_mapping'
SIGNATURE_KEYS={'storage_type','quantity','unit','frame'}
BIT_QUANTITIES={'bitset','held_button_bitset','input_bitmask'}


def validate_mapping(spec,state):
    def require(test,message):
        if not test:raise ValueError('bit mapping: '+message)
    require(isinstance(spec,dict) and set(spec)=={'kind','source_slot','target_slot','source_signature','target_signature','mapping','unmapped_target_bits','provenance'},'unsupported or missing adapter contract field')
    require(spec['kind']==KIND,'unsupported authored adapter kind')
    source=spec['source_slot'];target=spec['target_slot']
    require(source in state and target in state,'source and target slots must exist')
    require(source!=target,'source and target must be distinct canonical slots')
    for direction,name in [('source',source),('target',target)]:
        slot=state[name];signature=spec[direction+'_signature']
        require(isinstance(signature,dict) and set(signature)==SIGNATURE_KEYS,'signature must declare exact storage, quantity, unit and frame')
        require(slot.get('storage_type')=='u16' and 'count' not in slot,'only scalar u16 state is supported')
        require(signature==dict(storage_type=slot['storage_type'],**{k:slot['semantic_type'].get(k)for k in ('quantity','unit','frame')}),'stale '+direction+' semantic signature')
        require(signature['quantity'] in BIT_QUANTITIES,'only declared unsigned input bitsets are supported')
        require(signature['unit']=={'numerator':1,'denominator':1} and all(type(value) is int for value in signature['unit'].values()),'bitsets require dimensionless unit 1/1')
        require(not slot['semantic_type'].get('signed_encoding'),'signed encodings are unsupported for bit transport')
    mapping=spec['mapping'];require(isinstance(mapping,list) and 1<=len(mapping)<=16,'mapping must contain 1..16 declared bit pairs')
    source_bits=[];target_bits=[]
    for pair in mapping:
        require(isinstance(pair,dict) and set(pair)=={'source_bit','target_bit'},'mapping entries require source_bit and target_bit only')
        require(all(type(pair[k]) is int and 0<=pair[k]<=15 for k in pair),'bit indices must be integers 0..15')
        source_bits.append(pair['source_bit']);target_bits.append(pair['target_bit'])
    require(len(set(source_bits))==len(mapping) and len(set(target_bits))==len(mapping),'duplicate source or target bits are unsupported')
    require(spec['unmapped_target_bits']=='clear','unmapped target bits must explicitly clear')
    provenance=spec['provenance']
    require(isinstance(provenance,dict) and {'kind','mapping_basis','description'}<=set(provenance) and not(set(provenance)-{'kind','mapping_basis','description','evidence'}),'authored provenance is required')
    require(provenance['kind']=='authored' and provenance['mapping_basis'] in ('authored_configuration','explicit_user_mapping'),'mapping must be declared authored, never recovered or source-faithful')
    require(isinstance(provenance['description'],str) and 1<=len(provenance['description'])<=2000,'authored mapping description is required')
    require(isinstance(provenance.get('evidence',[]),list) and len(provenance.get('evidence',[]))<=32 and all(isinstance(v,str) and len(v)<=2048 for v in provenance.get('evidence',[])),'declared evidence references must be bounded strings')
    mask=sum(1<<bit for bit in target_bits)
    return {'kind':KIND,'authorship':'authored_not_original_game_behavior','contract_sha256':hashlib.sha256(json.dumps(spec,sort_keys=True,separators=(',',':')).encode()).hexdigest(),'source_domain':{'unsigned_min':0,'unsigned_max':65535},'target_domain':{'unsigned_min':0,'unsigned_max':mask,'allowed_bits':mask},'source_signature':copy.deepcopy(spec['source_signature']),'target_signature':copy.deepcopy(spec['target_signature']),'provenance':copy.deepcopy(provenance)}


def expression(spec,state):
    validate_mapping(spec,state)
    def const(value,t='u16'):return {'op':'const','type':t,'value':value}
    result=const(0)
    for pair in spec['mapping']:
        source={'op':'slot','name':spec['source_slot'],'type':'u16'}
        bit={'op':'bit_and','type':'u16','args':[{'op':'shift_right','type':'u16','args':[source,const(pair['source_bit'],'u32')]},const(1)]}
        moved={'op':'shift_left','type':'u16','args':[bit,const(pair['target_bit'],'u32')]}
        result={'op':'bit_or','type':'u16','args':[result,moved]}
    return result
