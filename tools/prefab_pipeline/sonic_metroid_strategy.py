"""Lower a pinned native campaign graph into an isolated source variant.

The recipe reuses the original native campaign, recovered controller/asset and
impact components. It adds recovered acquisition/event behavior through an
explicit task-owned sidecar; no host RAM address or ROM patch is invented here.
"""
from __future__ import annotations
import copy
import hashlib
import json
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
COMPONENT = Path('tools/composition/components/sonic_metroid')


def pin(path):
    path = Path(path)
    return {'path': str(path.relative_to(ROOT)), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


def resolve(value):
    if not isinstance(value, dict) or set(value) != {'path', 'sha256'}:
        raise ValueError('recipe inputs require exact file pins')
    path = (ROOT / value['path']).resolve()
    path.relative_to(ROOT)
    if not path.is_file() or pin(path) != value:
        raise ValueError('missing or stale recipe input: ' + str(path))
    return path


def lower_sonic_metroid_strategy(spec, output):
    started = time.monotonic()
    if spec.get('schema') != 'gameverse.sonic-metroid-strategy/1' or spec.get('save_policy') != 'fresh':
        raise ValueError('source-progress recipe requires explicit fresh campaign state')
    if set(spec) != {'schema', 'id', 'baseline_plan', 'source_modules', 'save_policy', 'state_extension', 'provenance'}:
        raise ValueError('unsupported Sonic/Metroid recipe fields')
    if spec['state_extension'] != {'base_bytes': 1536, 'allocation_bytes': 1600, 'sidecar_bytes': 36}:
        raise ValueError('unsupported native task state extension')
    baseline = json.loads(resolve(spec['baseline_plan']).read_text())
    if baseline.get('target', {}).get('foundation_game') != 'sonic-advance' or not baseline['target'].get('preserve_campaign'):
        raise ValueError('requires retained native Sonic campaign')
    modules = {name: resolve(value) for name, value in spec['source_modules'].items()}
    required = {'progression.c', 'progress_adapter.c', 'progress_adapter.h', 'generated/mzm_progress/acquire/component.c', 'generated/mzm_progress/acquire/component.h', 'generated/mzm_progress/events/component.c', 'generated/mzm_progress/events/component.h'}
    if set(modules) != required:
        raise ValueError('requires acquisition, event and native progression source closure')
    # Provenance is executable admission data: every receipt/serialized behavior
    # is verified before snapshotting. Synthetic qualification remains labeled.
    provenance = {name: pin(resolve(value)) for name, value in spec['provenance'].items()}
    output = Path(output).resolve()
    output.relative_to(ROOT)
    output.mkdir(parents=True, exist_ok=False)
    source_root = output / 'sources'
    packages = []
    inputs = {}
    templates = []
    for entry in baseline['native_build']['packages']:
        package_pin = {'path': entry['package']['ref'], 'sha256': entry['package']['sha256']}
        package = json.loads(resolve(package_pin).read_text())
        templates.append((entry['instance'], package, package_pin))
        for source in package['lowering']['native_v1']['sources']:
            value = {'path': source['ref'], 'sha256': source['sha256']}
            original = resolve(value)
            if original.suffix not in {'.c', '.h'}:
                continue
            if source['ref'] in inputs and inputs[source['ref']] != value:
                raise ValueError('conflicting source identity')
            inputs[source['ref']] = value
            destination = source_root / source['ref']
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(original.read_bytes())
    component_dir = source_root / COMPONENT
    header = component_dir / 'game.h'
    text = header.read_text()
    old = '#define GV_STATE_BYTES 1536'
    if text.count(old) != 1:
        raise ValueError('state allocation contract changed')
    header.write_text(text.replace(old, '#define GV_STATE_BYTES 1600'))
    # Offsets in the original 1536-byte observation ABI stay identical. The
    # parent native TaskCreate owns and zeroes the complete allocation.
    state = component_dir / 'state.c'
    state.write_text(state.read_text() + '\nvoid *gv_progress_state(GvState *s){return (uint8_t *)s+1536;}\n')
    for name, path in modules.items():
        destination = component_dir / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(path.read_bytes())
    version = '2.0.0-ir-progress'
    versions = {package['id']: version for _, package, _ in templates}
    snapshots = sorted(source_root.rglob('*'))
    snapshots = [p for p in snapshots if p.is_file()]
    common_sources = [{'ref': pin(p)['path'], 'sha256': pin(p)['sha256']} for p in snapshots]
    for instance, template, template_pin in templates:
        package = copy.deepcopy(template)
        package['version'] = version
        native = package['lowering']['native_v1']
        # Every variant package pins the same small source closure; compiler
        # deduplication compiles each translation unit once.
        native['sources'] = common_sources
        native['translation_units'] = [str((source_root / p).relative_to(ROOT)) for p in native['translation_units']]
        for dependency in native.get('requires', []):
            if dependency['id'] in versions:
                dependency['version'] = versions[dependency['id']]
        if instance == 'progression':
            native['translation_units'] += [str((component_dir / name).relative_to(ROOT)) for name in ['progress_adapter.c', 'generated/mzm_progress/acquire/component.c', 'generated/mzm_progress/events/component.c']]
        if instance == 'state':
            for binding in native.get('state_bindings', []):
                binding['bytes'] = 1600
                binding.setdefault('writes', []).extend([{'offset': 1536, 'width': 8, 'quantity': 'source_owned_beam_bits'}, {'offset': 1537, 'width': 8, 'quantity': 'source_owned_ability_bits'}] + [{'offset': 1540 + i * 4, 'width': 32, 'quantity': 'source_packed_event_word_' + str(i)} for i in range(8)])
                if isinstance(binding.get('allocation'), dict):
                    binding['allocation']['bytes'] = 1600
        package['recipe_provenance'] = {'baseline_package': template_pin, 'recipe_id': spec['id'],
            'source_modules': spec['source_modules'], 'qualified_source_provenance': provenance,
            'state_extension': spec['state_extension'], 'save_policy': 'fresh',
            'scope': 'Native campaign reuse with source-derived equipment/events; whole-campaign traversal pending'}
        package_path = output / (instance + '.package.json')
        package_path.write_text(json.dumps(package, indent=2) + '\n')
        packages.append({'instance': instance, 'package': pin(package_path)})
    inventory = {'schema': 'gameverse.native-prefab-reuse-inventory/1', 'baseline': spec['baseline_plan'],
        'categories': {instance: package.get('concept', {}).get('role', 'unknown') for instance, package, _ in templates},
        'input_sources': list(inputs.values()), 'source_modules': spec['source_modules'],
        'host_and_asset_ownership': 'Exact Sonic host, source-qualified MZM controllers and locally extracted MZM assets; original native services remain host-owned',
        'new_state_bytes': 64, 'used_sidecar_bytes': 36, 'save_policy': 'fresh',
        'qualification': 'Artifact availability separate from model experiment and whole campaign qualification'}
    (output / 'reuse-inventory.json').write_text(json.dumps(inventory, indent=2) + '\n')
    result = {'schema': 'gameverse.sonic-metroid-strategy-lowering/1',
        'status': 'generated-awaiting-native-proof', 'package_replacements': packages, 'hook_edits': [],
        'outputs': {str(p.relative_to(output)): pin(p) for p in sorted(output.rglob('*')) if p.is_file()},
        'new_ram_bytes': 64, 'wall_s': round(time.monotonic() - started, 6),
        'scope': 'Original campaign preserved; acquisition/events source-derived; authored bindings explicit; fresh state only'}
    receipt = output / 'lowering-receipt.json'
    receipt.write_text(json.dumps(result, indent=2) + '\n')
    result['receipt'] = pin(receipt)
    return result
