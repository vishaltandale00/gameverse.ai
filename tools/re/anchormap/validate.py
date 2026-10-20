#!/usr/bin/env python3
"""Score an anchormap profile against a matching-decomp linker map.

This is a *validation* aid only: it is not part of anchor discovery. It exists
because this prototype targets Metroid Zero Mission, whose repository ships a
matching-decomp build (`mzm_us.map`) with ground-truth symbol addresses. The
map is read after the fact, purely to measure precision/recall.

Usage: python3 validate.py PROFILE.json /path/to/game.map
"""
from __future__ import annotations

import json
import re
import sys

# Symbol -> whether the automatic anchor should land exactly on it.
TRUTH_SYMBOLS = {
    'input_shadow': ['gButtonInput', 'gPreviousButtonInput', 'gChangedInput'],
    'oam_mirror': ['gOamData'],
    'position': ['gSamusData', 'gCamera', 'gPreviousXPosition', 'gArmCannonX',
                 'gBg1XPosition', 'gBg2XPosition'],
}
MAIN = {'_start': 'rom_entry', 'gInterruptCode': 'irq_vector_0x03007ffc', 'IntrMain': 'irq_handler'}


def parse_map(path):
    syms = {}
    pat = re.compile(r'^\s+0x([0-9a-fA-F]{8})\s+([A-Za-z_][A-Za-z0-9_]*)\s*$')
    for line in open(path, errors='replace'):
        m = pat.match(line.rstrip('\n'))
        if m:
            syms[m.group(2)] = int(m.group(1), 16)
    return syms


def main():
    profile = json.load(open(sys.argv[1]))
    syms = parse_map(sys.argv[2])
    report = {'symbols': syms, 'checks': []}

    def add(name, detected, truth, exact):
        report['checks'].append({'check': name, 'detected': detected, 'truth': truth,
                                 'exact': exact})

    shadow = {int(c['address'], 16) for c in profile['input_shadow_candidates']}
    truth = {syms[s] for s in TRUTH_SYMBOLS['input_shadow'] if s in syms}
    add('input_shadow', ['0x%08x' % a for a in sorted(shadow)], ['0x%08x' % a for a in sorted(truth)],
        shadow == truth)

    oam = {int(c['address'], 16) for c in profile['oam_mirror_candidates']}
    oam_truth = {syms[s] for s in TRUTH_SYMBOLS['oam_mirror'] if s in syms}
    add('oam_mirror', ['0x%08x' % a for a in sorted(oam)], ['0x%08x' % a for a in sorted(oam_truth)],
        bool(oam & oam_truth))

    pos = {int(f['address'], 16) for f in profile['position_fields']['fields']}
    pos_truth = {syms[s] for s in TRUTH_SYMBOLS['position'] if s in syms}
    add('position_fields', ['0x%08x' % a for a in sorted(pos)],
        ['0x%08x' % a for a in sorted(pos_truth)],
        'recall=%.2f' % (len(pos & pos_truth) / len(pos_truth)) if pos_truth else 'n/a')
    add('position_field_player_x', '0x%08x' % syms.get('gSamusData', 0),
        'detected 0x030013e6 in set: %s' % (0x030013E6 in pos), 0x030013E6 in pos)

    entry = profile['main_loop']['rom_entry'].get('entry_point')
    add('rom_entry', entry, '0x%08x' % syms.get('_start', 0), entry == '0x%08x' % syms.get('_start', 0))
    irq = profile['main_loop']['irq_vector_0x03007ffc']
    add('irq_vector', irq, '0x%08x' % syms.get('gInterruptCode', 0),
        irq == '0x%08x' % syms.get('gInterruptCode', 0))
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
