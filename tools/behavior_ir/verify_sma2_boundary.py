"""Small cached-L0 regressions for the SMA2 immutable-table/shared-view boundary."""
import copy
import json
import time
from lift import Lifter, Unsupported
from qualify_sma2_reinitialize import SOURCE, ROM, profiles
from seeds import discover


def run():
    started = time.perf_counter()
    compiled = {}
    raw = ROM.read_bytes()
    for p in profiles():
        original = json.loads((SOURCE/(p['entry']+'.json')).read_text())
        snapshot = copy.deepcopy(original)
        result = Lifter(original, raw, compiled, argument_contract=p.get('argument_contract')).build()
        assert original == snapshot
        compiled[p['entry']] = result
    root, adapter = compiled['0802ebec']
    assert adapter['argument_views'][0]['base_offset'] == 0x6cc
    assert any(z['name'].endswith('table_index_34') for z in root['locals'])
    calls = [a for a in adapter['assumptions'] if a['kind']=='rom_proven_entry_pointer_call_argument']
    assert any(a['callee_entry']=='0802ea54' for a in calls)
    # An accessed scene slice overlapping the actor view cannot be scalarized.
    p = profiles()[2]
    bad = copy.deepcopy(p['argument_contract'])
    bad['shared_views'][0]['base_offset'] = 0x1194-96
    try:
        Lifter(json.loads((SOURCE/'0802ea54.json').read_text()), raw, argument_contract=bad).build()
    except Unsupported as error:
        assert 'alias requires canonical' in str(error)
    else:
        raise AssertionError('overlapping shared view silently scalarized')
    # Static evidence-only profiles may omit structured references; discovery
    # must retain them without claiming a structured layout from those records.
    found = discover('super-mario-advance-2-super-mario-world', ROM)
    assert len(found) >= 6
    print(json.dumps({'outcome':'pass','checks':['four cached inputs unchanged',
      'immutable table phi survives closure', 'decoded known callee provenance retained',
      'nonzero shared-view base offset retained', 'overlapping view rejected',
      'static-only profiles do not invent structured reference layouts'],
      'wall_s':time.perf_counter()-started}))


if __name__ == '__main__':
    run()
