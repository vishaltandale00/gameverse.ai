"""Exact Thumb guarded ROM switches for saved-return provenance analysis.
This admits only the five-instruction LSL/LDR/ADD/LDR/MOV-PC pipeline after an
adjacent CMP/BLS/default-B guard. No general indirect-call targets are inferred.
"""
import hashlib
import json


def prove_tables(l0,rom,entry,limit):
    base=0x08000000;tables={}
    def half(pc):
        if pc&1 or not entry<=pc<=limit or pc+2>base+len(rom):raise ValueError('switch instruction outside return-proof span')
        return int.from_bytes(rom[pc-base:pc-base+2],'little')
    for table in l0.get('jump_tables',[]):
        pc=int(table['pc'],16)
        if not entry<=pc<=limit:continue
        move=half(pc)
        if move&0xff87!=0x4687:raise ValueError('return switch is not low-register MOV-PC')
        index=(move>>3)&15
        if index>7:raise ValueError('return switch index register unsupported')
        compare=half(pc-14);guard=half(pc-12);default=half(pc-10)
        if compare&0xf800!=0x2800 or (compare>>8)&7!=index:raise ValueError('switch index CMP guard missing')
        if guard!=0xd900 or default&0xf800!=0xe000:raise ValueError('switch lacks exact BLS/default-branch guard')
        count=(compare&255)+1
        if half(pc-8)!=0x80|(index<<3)|index:raise ValueError('switch index does not scale by four')
        literal=half(pc-6)
        if literal&0xf800!=0x4800:raise ValueError('switch base is not ROM literal load')
        table_register=(literal>>8)&7
        if table_register==index:raise ValueError('switch literal clobbers scaled index')
        add=half(pc-4)
        if add!=0x1800|(table_register<<6)|(index<<3)|index:raise ValueError('switch address addition unsupported')
        if half(pc-2)!=0x6800|(index<<3)|index:raise ValueError('switch does not load exact indexed word')
        literal_pc=((pc-6+4)&~3)+(literal&255)*4
        if literal_pc&3 or not base<=literal_pc<=base+len(rom)-4:raise ValueError('switch base literal outside ROM')
        start=int.from_bytes(rom[literal_pc-base:literal_pc-base+4],'little')
        if start&3 or not base<=start<=base+len(rom)-count*4:raise ValueError('switch table outside aligned ROM')
        cases=table.get('cases',[])
        if len(cases)!=count or any(type(c.get('label'))is not int for c in cases):raise ValueError('switch table case count mismatch')
        ordered=sorted(cases,key=lambda c:c['label']);first=ordered[0]['label']
        if [c['label']for c in ordered]!=list(range(first,first+count)):raise ValueError('switch table labels not contiguous')
        targets=[]
        for i,case in enumerate(ordered):
            destination=int.from_bytes(rom[start-base+i*4:start-base+i*4+4],'little')
            if destination!=int(case['target'],16)or destination&1 or not entry<=destination<=limit:raise ValueError('switch source targets differ or escape return-proof span')
            targets.append(destination)
        if pc in tables:raise ValueError('duplicate return switch PC')
        tables[pc]={'pc':pc,'compare_pc':pc-14,'guard_pc':pc-12,'prefix_pc':pc-8,'targets':list(dict.fromkeys(targets)),
            'proof':{'kind':'rom_proven_guarded_thumb_switch','pc':f'{pc:08x}','table':f'{start:08x}','case_count':count,'targets':[f'{t:08x}'for t in targets],
                'instruction_sha256':hashlib.sha256(rom[pc-14-base:pc+2-base]).hexdigest(),
                'literal_sha256':hashlib.sha256(rom[literal_pc-base:literal_pc-base+4]).hexdigest(),
                'table_sha256':hashlib.sha256(rom[start-base:start-base+count*4]).hexdigest(),
                'source_table_sha256':hashlib.sha256(json.dumps(table,sort_keys=True).encode()).hexdigest()}}
    return tables
