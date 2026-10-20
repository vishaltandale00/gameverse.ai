"""Native-only retained-service binding and registered host-effect proof dispatch.

This backend emits canonical storage moves and calls exact retained ROM services;
service behavior is never supplied as C or inferred from a successful build.
Registered native proofs retain their own schemas and finite source-specific
scope. They are never substituted for generic scalar qualifier receipts.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re

from tools.behavior_ir.retained_services import validate_service, signature, render_call

ROOT = Path(__file__).resolve().parents[2]
NAME = re.compile(r'[A-Za-z_][A-Za-z_0-9]*\Z')
PROOF_ID = 'firered-text-wait/1'
PROOF_SCHEMA = 'gameverse.firered-native-service-parity/1'
FIRERED_SHA256 = '729041b940afe031302d630fdbe57c0c145f3f7b6d9b8eca5e98678d0ca4d059'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def load_evidence(config):
    """Read explicitly pinned workspace artifacts, never executable profile code."""
    if not isinstance(config, dict) or set(config) != {'proof', 'evidence'} or config['proof'] != PROOF_ID or not isinstance(config['evidence'], dict):
        raise ValueError('unsupported retained-service backend/proof configuration')
    evidence = {}
    for expected, name in config['evidence'].items():
        path = (ROOT / name).resolve()
        if not path.is_relative_to(ROOT) or not path.is_file():
            raise ValueError('retained-service source evidence must be a workspace file')
        data = path.read_bytes()
        if digest(data) != expected:
            raise ValueError('retained-service source evidence pin mismatch')
        evidence[expected] = data
    return evidence


class NativeServiceEmitter:
    """Explicit compiler callback for a validated native-only adapter.

    Canonical bound state is flushed/reloaded around every service. Alias checks
    are emitted for the actual context, including cross-owner globals/entity
    spans. Entity bases are restricted to EWRAM to exclude the wrapper stack.
    Unsupported input contexts trap; no original-behavior fallback exists.
    This bounds qualification to canonical aligned disjoint views. Object/reference
    rebinding, MMIO state views and pointer arguments remain unsupported.
    """
    def __init__(self, behavior, adapter, original, evidence):
        self._require_plain_native_state(behavior, adapter)
        contracts = adapter.get('retained_services', [])
        if not isinstance(contracts, list) or not contracts:
            raise ValueError('native retained-service adapter inventory required')
        normalized = [validate_service(c, original, evidence) for c in contracts]
        self.services = {c['id']: c for c in normalized}
        if len(self.services) != len(normalized) or behavior.get('retained_services') != [signature(c) for c in normalized] or behavior.get('execution_scope') != 'source_pinned_native_only' or behavior.get('semantic_closure') != 'OPEN':
            raise ValueError('native retained-service module signature/provenance mismatch')
        if adapter.get('object_references') or adapter.get('entity_references') or adapter.get('argument_views'):
            raise ValueError('retained-service reference stability/rebinding unsupported')
        if any(p.get('register') == 'r3' for p in adapter.get('parameters', [])) or any(f.get('owner') == 'entity' and f.get('argument') == 'r3' for f in adapter.get('fields', [])):
            raise ValueError('current entry veneer clobbers incoming r3; native context r3 unavailable')
        self.adapter = adapter
        self.fields = adapter.get('fields', [])
        self.collections = adapter.get('collections', [])
        self.spans = []
        for f in self.fields:
            if f.get('owner') not in ('global', 'entity') or not NAME.fullmatch(f.get('name', '')) or f.get('width') not in (8, 16, 32):
                raise ValueError('unsupported retained-service canonical field')
            size = f['width'] // 8
            if type(f.get('offset')) is not int or f['offset'] < 0 or f['owner']=='entity' and f['offset']+size > 0x40000:
                raise ValueError('retained-service field offset unsupported')
            if f['owner'] == 'global':
                address = f.get('address')
                if type(address) is not int:
                    raise ValueError('retained-service global address required')
                self.spans.append(('global', address+f['offset'], size))
            else:
                arg = f.get('argument')
                if arg not in ('r0', 'r1', 'r2', 'r3'):
                    raise ValueError('retained-service entity needs canonical argument')
                self.spans.append((arg, f['offset'], size))
        for c in self.collections:
            if not NAME.fullmatch(c.get('name', '')) or type(c.get('address')) is not int or c.get('size') not in (1, 2, 4) or c.get('stride', c['size']) != c['size'] or type(c.get('count')) is not int or not 1 <= c['count'] <= 4096:
                raise ValueError('retained-service collection requires contiguous canonical global backing')
            self.spans.append(('global', c['address'], c['size']*c['count']))
        for index, (owner, start, size) in enumerate(self.spans):
            if owner == 'global' and not self._ram(start, size):
                raise ValueError('retained-service bound storage outside canonical RAM')
            if owner == 'global' and start < 0x03008000 and start+size > 0x03007c00:
                raise ValueError('retained-service bound storage overlaps qualified native stack arena')
            if any(owner == other and start < end+length and end < start+size for other, end, length in self.spans[:index]):
                raise ValueError('retained-service canonical aliases require compiler coalescing')
        if len({f['name'] for f in self.fields}) != len(self.fields) or len({c['name'] for c in self.collections}) != len(self.collections):
            raise ValueError('retained-service duplicate canonical state names')
        state = {f['name']: f['storage_type'] for f in behavior['state']}
        if state != {f['name']: 'u'+str(f['width']) for f in self.fields}:
            raise ValueError('retained-service full state coverage mismatch')
        collections = {c['name']: (c['storage_type'], c['count']) for c in behavior.get('collections', [])}
        if collections != {c['name']: ('u'+str(c['size']*8), c['count']) for c in self.collections}:
            raise ValueError('retained-service full collection coverage mismatch')

    @staticmethod
    def _require_plain_native_state(behavior, adapter):
        if (behavior.get('resource_references') or adapter.get('resource_references')
                or any('resource_reference' in f for f in behavior.get('state', []))
                or any('resource_reference' in f for f in adapter.get('fields', []))):
            raise ValueError('retained-service resource references require an explicit native codec')

    def validate_module(self, behavior):
        self._require_plain_native_state(behavior, self.adapter)
        if (behavior.get('retained_services') != [signature(c) for c in self.services.values()]
                or behavior.get('execution_scope') != 'source_pinned_native_only'
                or behavior.get('semantic_closure') != 'OPEN'
                or {f['name']:f['storage_type'] for f in behavior['state']} != {f['name']:'u'+str(f['width']) for f in self.fields}
                or {c['name']:(c['storage_type'],c['count']) for c in behavior.get('collections',[])} != {c['name']:('u'+str(c['size']*8),c['count']) for c in self.collections}):
            raise ValueError('native retained-service module changed after binding validation')
        return True

    @staticmethod
    def _ram(start, size):
        return 0x02000000 <= start < start+size <= 0x02040000 or 0x03000000 <= start < start+size <= 0x03008000

    @staticmethod
    def _address(owner, start, context):
        return str(start)+'u' if owner == 'global' else '('+context+'->r['+owner[1:]+']+'+str(start)+'u)'

    def guards(self, context='native_ctx'):
        """Check dynamic canonical/disjoint bindings before any storage move."""
        lines = []
        for index, (owner, start, size) in enumerate(self.spans):
            if owner != 'global':
                base = context+'->r['+owner[1:]+']'
                lines.append('if(!(%s>=0x02000000u&&%s<=0x02040000u-%su))__builtin_trap();' % (base, base, start+size))
            address = self._address(owner, start, context)
            lines.append('uint32_t ir_bound_'+str(index)+'='+address+';')
            a = 'ir_bound_'+str(index)
            lines.append('if(!((%s>=0x02000000u&&%s<=0x02040000u-%su)||(%s>=0x03000000u&&%s<=0x03008000u-%su)))__builtin_trap();' % (a, a, size, a, a, size))
            # Alignment uses element width, not total collection span length.
            alignment = self.fields[index]['width']//8 if index < len(self.fields) else self.collections[index-len(self.fields)]['size']
            if alignment > 1:
                lines.append('if('+a+'&'+str(alignment-1)+'u)__builtin_trap();')
            for prior, (_, _, previous_size) in enumerate(self.spans[:index]):
                b = 'ir_bound_'+str(prior)
                lines.append('if('+a+'<'+b+'+'+str(previous_size)+'u&&'+b+'<'+a+'+'+str(size)+'u)__builtin_trap();')
        return '\n'.join(lines)

    def synchronization(self, context='native_ctx', state='s'):
        from .ir_provider import storage_moves
        loads, stores = storage_moves(self.adapter, state='(*'+state+')',
            argument_expressions={'r'+str(i):context+'->r['+str(i)+']' for i in range(4)})
        # Compiler barriers also make an empty bound-state module explicit.
        barrier = '__asm__ volatile("" ::: "memory");'
        return '\n'.join(loads+[barrier]), '\n'.join(stores+[barrier])

    def __call__(self, statement, *, render_expr, context='native_ctx'):
        service = self.services.get(statement.get('service'))
        if service is None:
            raise ValueError('native emitter has no validated retained-service binding')
        loads, stores = self.synchronization(context)
        return render_call(statement, service, render_expr, stores, loads)

    def binding(self, label):
        if not NAME.fullmatch(label):
            raise ValueError('native retained-service label required')
        loads, stores = self.synchronization('native_ctx', 's')
        args = []
        for p in self.adapter.get('parameters', []):
            if p.get('register') not in ('r0', 'r1', 'r2', 'r3'):
                raise ValueError('retained-service parameter outside register ABI')
            args.append('ctx.r['+p['register'][1:]+']')
        typ = self.adapter['return_type']
        if typ not in ('void', 'u8', 'u16', 'u32'):
            raise ValueError('retained-service parent return outside scalar ABI')
        ret = 'void' if typ == 'void' else 'uint32_t'
        call = 'lifted_'+label+'(s,native_ctx'+''.join(','+a for a in args)+');'
        return ('\n'+ret+' native_'+label+'(uint32_t r0,uint32_t r1,uint32_t r2,uint32_t r3){\n'
                'LiftedNativeContext ctx={{r0,r1,r2,r3}}; const LiftedNativeContext*native_ctx=&ctx;\n'
                'State_'+label+' value; State_'+label+'*s=&value;\n'+self.guards()+'\n'+loads+'\n'
                +('' if typ == 'void' else 'uint32_t result=')+call+'\n'+stores+'\n'
                +('return;' if typ == 'void' else 'return result;')+'\n}\n')


def _pinned_file(pin):
    path = Path(pin['path']).resolve()
    if not path.is_file() or digest(path.read_bytes()) != pin['sha256']:
        raise ValueError('retained-service proof artifact pin mismatch')
    return path


def qualify_registered(profile, original, rebuilt, output):
    """Execute one registered authentic original-versus-rebuilt host-effect proof."""
    config = profile.get('native_service_backend', {})
    load_evidence(config)
    if config['proof'] != PROOF_ID or profile.get('original_sha256') != FIRERED_SHA256 or [entry for _, _, entry in profile.get('targets', [])] != ['08005694']:
        raise ValueError('registered service proof does not cover this source target')
    original, rebuilt = Path(original).resolve(), Path(rebuilt).resolve()
    if digest(original.read_bytes()) != FIRERED_SHA256 or digest(rebuilt.read_bytes()) == FIRERED_SHA256:
        raise ValueError('registered provider proof requires distinct rebuilt candidate and pinned original')
    from .firered_text_profile import qualify_native_service
    report = qualify_native_service(original, rebuilt, output)
    validate_registered_proof(report, original, rebuilt)
    return report


def validate_registered_proof(report, original, rebuilt, *, artifact_root=None):
    """Authenticate the distinct native effect schema without manufacturing parity."""
    if report.get('schema') != PROOF_SCHEMA or report.get('outcome') != 'pass' or report.get('kind') != 'candidate-service-parity' or report.get('ir_regenerated_byte_credit') != 0:
        raise ValueError('retained-service proof failed or has unsupported schema/scope')
    original_bytes=original if isinstance(original,bytes) else Path(original).read_bytes()
    rebuilt_bytes=rebuilt if isinstance(rebuilt,bytes) else Path(rebuilt).read_bytes()
    if report['original']['sha256'] != digest(original_bytes) or report['rebuilt']['sha256'] != digest(rebuilt_bytes):
        raise ValueError('retained-service proof ROM identity mismatch')
    if artifact_root is None:
        for key in ('original', 'rebuilt', 'tool', 'oracle_template', 'native_runtime'):
            _pinned_file(report[key])
        native = json.loads(_pinned_file(report['native']).read_text())
    else:
        artifact_root=Path(artifact_root)
        for key,name in (('tool','profile-snapshot.py'),('oracle_template','oracle.c'),('native','native.json')):
            if digest((artifact_root/name).read_bytes()) != report[key]['sha256']:
                raise ValueError('retained-service local proof artifact pin mismatch')
        native=json.loads((artifact_root/'native.json').read_text())
    validate_native_cases(native)
    return True


def validate_native_cases(native):
    """Validate every required concrete observation; absent data never means zero."""
    cases=native.get('cases')
    aggregate=('vectors','failures','original_playse_visits','original_songstart_visits',
               'max_original_instructions','max_rebuilt_instructions','boot_frames','instruction_cap_per_call')
    if any(type(native.get(k)) is not int for k in aggregate) or native.get('outcome')!='pass' or native['vectors']!=64 or native['failures']!=0 or native['boot_frames']!=120 or native['instruction_cap_per_call']!=2048 or not isinstance(cases,list) or len(cases)!=64:
        raise ValueError('retained-service proof lacks typed actual native service coverage')
    required=('test','auto','keys','playback','disabled','counter_before_threshold','original_r0','rebuilt_r0',
              'original_abi_pass','rebuilt_abi_pass','original_instructions','rebuilt_instructions',
              'original_min_sp','rebuilt_min_sp','original_playse_visits','rebuilt_playse_visits',
              'original_songstart_visits','rebuilt_songstart_visits','original_play_arg','rebuilt_play_arg',
              'original_song_arg','rebuilt_song_arg','canonical_ram_differences','excluded_dead_stack_differences',
              'original_observed_audio_ram_changes','defined_audio_mmio_differences','pass')
    fixtures=set();tests=set()
    for case in cases:
        if not isinstance(case,dict) or any(type(case.get(k)) is not int or case[k]<0 for k in required):
            raise ValueError('retained-service proof missing typed per-case native observations')
        fixture=tuple(case[k] for k in ('auto','keys','playback','disabled','counter_before_threshold'))
        fixtures.add(fixture);tests.add(case['test'])
        if (case['pass']!=1 or case['canonical_ram_differences']!=0 or case['defined_audio_mmio_differences']!=0
                or case['original_abi_pass']!=1 or case['rebuilt_abi_pass']!=1
                or case['original_r0'] not in (0,1)
                or any(case['original_'+k]!=case['rebuilt_'+k] for k in ('r0','playse_visits','songstart_visits','play_arg','song_arg'))):
            raise ValueError('retained-service native state/ABI/effect mismatch')
        for side in ('original','rebuilt'):
            if (not 1<=case[side+'_instructions']<=2048 or not 0x03007c00<=case[side+'_min_sp']<=0x03007e00
                    or case[side+'_playse_visits'] not in (0,1) or case[side+'_songstart_visits'] not in (0,1)
                    or case[side+'_songstart_visits']>case[side+'_playse_visits']
                    or case[side+'_playse_visits'] and case[side+'_play_arg']!=5
                    or case[side+'_songstart_visits'] and case[side+'_song_arg']!=5):
                raise ValueError('retained-service instruction/stack/trace bound mismatch')
        raw=case.get('raw_ram_differences')
        if not isinstance(raw,list) or len(raw)!=case['excluded_dead_stack_differences'] or len(raw)>512:
            raise ValueError('retained-service raw excluded differences incomplete')
        for row in raw:
            if (not isinstance(row,dict) or any(type(row.get(k)) is not int for k in ('address','original','rebuilt','dead_stack'))
                    or not 0x03007c00<=row['address']<0x03007e00 or row['dead_stack']!=1
                    or not 0<=row['original']<=255 or not 0<=row['rebuilt']<=255 or row['original']==row['rebuilt']):
                raise ValueError('retained-service raw difference outside bounded dead stack')
        if len({row['address'] for row in raw})!=len(raw):
            raise ValueError('retained-service duplicate raw difference address')
    expected={(a,k,p,d,c) for a in range(2) for k in range(4) for p in range(2) for d in range(2) for c in range(2)}
    if fixtures!=expected or tests!=set(range(64)):
        raise ValueError('retained-service fixture coverage incomplete or duplicated')
    for key in ('playse_visits','songstart_visits'):
        total=sum(c['original_'+key] for c in cases)
        if total<=0 or native['original_'+key]!=total:
            raise ValueError('retained-service aggregate trace count mismatch')
    for side in ('original','rebuilt'):
        if native['max_'+side+'_instructions']!=max(c[side+'_instructions'] for c in cases):
            raise ValueError('retained-service aggregate instruction count mismatch')
    return True
