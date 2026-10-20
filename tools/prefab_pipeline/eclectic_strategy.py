"""Emit pinned recovered mechanics for a foreign-engine integration.

Only structural namespacing and explicit scalar/packed-state bridges are authored
here. The algorithms and lookup assets come from admitted L1 packages. Native
scheduling, input scaling and gameplay policy belong to the consumer.
"""
from __future__ import annotations
import hashlib
import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
# Curated exact packages, not a selection by an untrusted descriptor label.
PACKAGES = {
    'steering': ('kart.driver_steering_accumulation_lane0', '20c8babdd82e67950ff94464e3ab16e893633ecfdd73b7a1f7fedef70e94c700'),
    'drag': ('kart.vehicle_turn_drag_acceleration', 'ffee0a1ab29cd9650c7101e3ef8183ed5abecac5f198b387410ccb000f4efe5f'),
    'speed': ('kart.vehicle_speed_heading_step', 'aedf0f4b4086e0ca5e23257aca9c1f32940bbd3e462350604584b9b316af83de'),
    'skills': ('tmc.progress.derive_skills', 'e3bed4e57a2259b5e7e358bc4b7e758b8ae8ebee069d330e7b726fc808a62b3f'),
    'beam': ('tmc.combat.learned_sword_beam_eligibility', '129a2846b3285506048b63188b60f3ae716e5c6266c6e9961b09f33eeddfbc8f'),
    'hp': ('ffvi.combat.hp_effect_actor0', '24e55698ca4aaec89d0b21b29d25f1a0f05f0add06b195afd61415a94e950524'),
}

RECEIPTS = {
    'steering': '979c36051cee99221504867ca1c5771fd1e0dfbde7a2e423db897bd84d732be9',
    'drag': 'cc413bbd1b5078b4b884fef8060d288c8f1c58cb3edc1f4615114161c786e4d8',
    'speed': 'd82ee4416d727916d3efcd452ae036f213b7a7086e7f263ff3a77cf54478bffb',
    'skills': '410f91c5ec89daf03465b8940184e3cdcf16fb6a306e8165236e1f0377c03d0a',
    'beam': '3c606f3f3989497d5eac60469f445d3403506f5e5c3ca1a2ac2929760fb3fdc9',
    'hp': '9730239860027d56e75d7705349547b84972e169c63c40251d225af2706c6760',
}

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def generate_eclectic_source(root=ROOT, *, native_types=False):
    """Return (standalone C, public header, provenance); no filesystem mutation.

    All public structures use fixed-width ISO C types. The consumer compiles the
    returned source once and includes the returned header. No new global/save
    storage is emitted; persistent/ephemeral state is explicitly caller-owned.
    """
    start = time.perf_counter()
    root = Path(root).resolve()
    # Existing lowerer modules use sibling absolute imports.
    path = str(root / 'tools/behavior_ir')
    if path not in sys.path:
        sys.path.insert(0, path)
    from lower import lower
    from contract import validate
    code = ['/* Exact recovered L1 algorithms; adapter policy is below. */\n']
    sources = []
    for name, (ident, digest) in PACKAGES.items():
        package = root / 'local/ir/packages' / ident / 'package.json'
        if sha(package) != digest:
            raise ValueError('pinned eclectic package changed: ' + ident)
        document = json.loads(package.read_text())
        behavior = package.parent / document['behavior']
        receipt = package.parent / document['qualification']['receipt']
        proof = json.loads(receipt.read_text())
        if (sha(receipt) != RECEIPTS[name]
                or document['qualification']['status'] != 'pass' or proof['outcome'] != 'pass'
                or sha(behavior) != document['behavior_sha256']
                or proof['artifacts']['l1.json']['sha256'] != sha(behavior)):
            raise ValueError('qualified eclectic behavior identity required: ' + ident)
        ir = json.loads(behavior.read_text())
        validate(ir)
        emitted = lower(ir)
        # Existing pure helper declares sign after masking; hoist its declaration
        # for the native GNU89 compiler without changing arithmetic.
        emitted = emitted.replace('uint64_t m=ir_mask(w);v&=m;uint64_t sign=(v>>(w-1))&1;',
                                  'uint64_t m=ir_mask(w);uint64_t sign;v&=m;sign=(v>>(w-1))&1;')
        # Separate helper/type/asset symbols make all exact functions coexist.
        emitted = re.sub(r'\b(LiftedState|behavior_0|ir_[A-Za-z0-9_]+|asset_[0-9]+)\b',
                         lambda m: 'gv_ir_' + name + '_' + m.group(), emitted)
        code.append(emitted)
        sources.append({'id': ident, 'package': str(package.relative_to(root)),
                        'package_sha256': digest, 'behavior_sha256': sha(behavior),
                        'receipt_sha256': sha(receipt), 'emitted_sha256': hashlib.sha256(emitted.encode()).hexdigest(),
                        'scope': document['qualification']['scope']})
    header = HEADER
    code += ['\n' + HEADER.replace('#pragma once\n', ''), BRIDGE]
    metadata = {'schema': 'gameverse.eclectic-strategy-lowering/1', 'sources': sources,
                'source_games': ['mario-kart-super-circuit', 'the-legend-of-zelda-the-minish-cap', 'final-fantasy-vi-advance'],
                'new_persistent_bytes': 0, 'global_storage_bytes': 0,
                'lowerer_sha256': sha(root / 'tools/behavior_ir/lower.py'),
                'adapter_sha256': sha(Path(__file__)),
                'limitations': ['Authored call order/scales are not the original kart scheduler.',
                               'Source finite native qualification does not qualify a Pokemon cartridge.',
                               'Mastery bank and HP projection are supplied by the consumer; no save allocation.'],
                'timing': {'queue_s': None, 'generation_wall_s': time.perf_counter() - start}}
    source = ''.join(code)
    if native_types:
        source = source.replace('#include <stdint.h>', NATIVE_TYPES)
        # Equivalent explicit unsigned64 hexadecimal tokens avoid agbcc's
        # large-decimal implicit-unsigned warning; all lowerer constants already
        # have explicit bit widths and UINT64_C wrappers.
        source = re.sub(r'UINT64_C\(([0-9]+)\)',
                        lambda m: 'UINT64_C(' + hex(int(m.group(1))) + ')', source)
        header = header.replace('#include <stdint.h>', NATIVE_TYPES)
    metadata['type_header'] = 'pokemon-global-h' if native_types else 'stdint-h'
    return source, header, metadata


def lower_eclectic_strategy(output_dir, root=ROOT, *, native_types=False):
    """Write eclectic-mechanics.c/.h and source-admission.json; return metadata."""
    source, header, metadata = generate_eclectic_source(root, native_types=native_types)
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    for name, content in [('eclectic-mechanics.c', source), ('eclectic-mechanics.h', header)]:
        (output / name).write_text(content)
    metadata['outputs'] = {name: {'path': str((output/name).resolve()), 'sha256': sha(output/name)}
                           for name in ['eclectic-mechanics.c', 'eclectic-mechanics.h']}
    (output/'source-admission.json').write_text(json.dumps(metadata, indent=2)+'\n')
    return metadata

HEADER = '''#pragma once
#include <stdint.h>
/* Callers own this ephemeral state and reset it at their declared lifecycle. */
/* speed_q16 stores a signed source Q16 bitvector: test signed before clamps. */
typedef struct { uint32_t speed_q16; uint16_t heading, turn; int16_t velocity_x, velocity_y; } GvEclecticRacer;
/* Input bits 0x100/0x200 are source encoded demands, not native Pokemon buttons.
   bands are explicit signed acceleration bands (source shift left8).
   Flags bit0 forces +0xc000 acceleration; it is not a braking flag.
   Turn damping does not reduce forward speed; use explicit negative bands. */
void GvEclecticKartStep(GvEclecticRacer *, uint16_t demands, uint16_t flags, const int16_t bands[16]);
/* Packed 2-bit original inventory: item 72..79 etc; no hidden native allocation. */
uint16_t GvEclecticSkills(const uint8_t inventory[64]);
/* Exact source-domain u8 health/capacity and learned-technique bitset. */
uint32_t GvEclecticBeam(uint8_t hp, uint8_t maximum, uint16_t skills);
typedef struct { uint16_t hp, damage, pending_status; uint8_t lethal_latch; } GvEclecticHpResult;
/* Recovery/damage are u16 source values, 0xffff is the original absent sentinel.
   Excluded requests suppress damage through the source effect-mask gate.
   A fresh private VM continuation context is created for every invocation. */
GvEclecticHpResult GvEclecticHp(uint16_t hp, uint16_t maximum, uint16_t damage, uint16_t recovery, uint16_t current_status, uint16_t pending_status, uint8_t excluded);
'''

BRIDGE = r'''
void GvEclecticKartStep(GvEclecticRacer *r, uint16_t demands, uint16_t flags, const int16_t bands[16]) {
 gv_ir_steering_LiftedState steer = {0};
 gv_ir_drag_LiftedState drag = {0};
 gv_ir_speed_LiftedState speed = {0};
 unsigned i;
 /* Explicit source character-zero handling row, lane0 only. */
 steer.field_2=r->turn; steer.field_3=demands; steer.field_4=0;
 steer.field_6=2453; steer.field_7=155; steer.field_8=115; steer.field_9=124;
 steer.field_5=flags;
 gv_ir_steering_behavior_0(&steer);
 drag.field_0=steer.field_2; drag.field_1=flags; drag.field_2=r->speed_q16;
 for(i=0;i<16;i++) drag.collection_0[i]=(uint16_t)bands[i];
 gv_ir_drag_behavior_0(&drag);
 /* This call order is an authored integration, with one canonical speed word. */
 r->turn=drag.field_0; r->heading=(uint16_t)(r->heading+r->turn);
 speed.field_2=r->heading; speed.field_3=(uint16_t)r->speed_q16;
 speed.field_4=(uint16_t)(r->speed_q16>>16); speed.field_5=drag.field_3;
 gv_ir_speed_behavior_0(&speed);
 r->speed_q16=(uint32_t)speed.field_3|((uint32_t)speed.field_4<<16);
 r->velocity_x=(int16_t)speed.field_0; r->velocity_y=(int16_t)speed.field_1;
}
uint16_t GvEclecticSkills(const uint8_t inventory[64]) {
 gv_ir_skills_LiftedState s={0}; unsigned i;
 for(i=0;i<64;i++) s.dependency_0_collection_0[i]=inventory[i];
 gv_ir_skills_behavior_0(&s); return s.field_0;
}
uint32_t GvEclecticBeam(uint8_t hp, uint8_t maximum, uint16_t skills) {
 gv_ir_beam_LiftedState s={0}; s.field_0=hp; s.field_1=maximum; s.field_2=skills;
 return gv_ir_beam_behavior_0(&s);
}
GvEclecticHpResult GvEclecticHp(uint16_t hp,uint16_t maximum,uint16_t damage,uint16_t recovery,uint16_t current_status,uint16_t pending_status,uint8_t excluded) {
 gv_ir_hp_LiftedState s={0}; GvEclecticHpResult result;
 s.field_2=1; s.field_4=(uint8_t)damage; s.field_5=(uint8_t)(damage>>8);
 s.field_6=(uint8_t)recovery; s.field_7=(uint8_t)(recovery>>8);
 s.field_8=excluded?1:0;
 s.field_10=128; s.field_11=128; s.field_12=128; s.field_13=119;
 s.field_14=(uint8_t)hp; s.field_15=(uint8_t)(hp>>8);
 s.field_16=(uint8_t)maximum; s.field_17=(uint8_t)(maximum>>8);
 s.field_18=(uint8_t)pending_status; s.field_19=(uint8_t)(pending_status>>8);
 s.field_20=(uint8_t)current_status; s.field_21=(uint8_t)(current_status>>8);
 gv_ir_hp_behavior_0(&s);
 result.hp=(uint16_t)s.field_14|((uint16_t)s.field_15<<8);
 result.damage=(uint16_t)s.field_4|((uint16_t)s.field_5<<8);
 result.pending_status=(uint16_t)s.field_18|((uint16_t)s.field_19<<8);
 result.lethal_latch=s.field_13; return result;
}
'''

# The actual Pokemon global.h transitively includes agbcc's stdint.h. agbcc
# rejects even identical repeated typedef declarations, unlike modern compilers.
# Reuse that authority rather than redeclaring aliases in the generated unit.
NATIVE_TYPES = r'''#ifndef GV_ECLECTIC_INTEGER_TYPES
#define GV_ECLECTIC_INTEGER_TYPES
#include "global.h"
#ifndef UINT64_C
#define UINT64_C(value) value##ULL
#endif
#ifndef UINT64_MAX
#define UINT64_MAX 0xffffffffffffffffULL
#endif
#endif
'''
