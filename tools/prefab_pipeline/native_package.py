"""Normalize existing native component packages without claiming portable closure.

This reader never builds, patches ROMs, or upgrades historical evidence. Fixed
host services remain tied to the exact original ROM in the package recovery pin.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
import time


def extract_native_package(root: Path, package_path: str, *, max_files: int = 128,
                           max_bytes: int = 8 * 1024 * 1024) -> dict:
    root = Path(root).resolve()
    package_path = Path(package_path).as_posix()
    started = time.perf_counter()
    pins, gaps, total = {}, [], 0

    def read(path, expected=None, parse=False):
        nonlocal total
        p = Path(path)
        actual = (root / p).resolve()
        if p.is_absolute() or not actual.is_relative_to(root):
            raise ValueError('package reference must remain relative to root: ' + str(path))
        key = actual.relative_to(root).as_posix()
        if key in pins:
            ref = pins[key]
            if expected and ref['sha256'] != expected:
                gaps.append({'id': 'source-pin-mismatch', 'status': 'open', 'reason': key})
            return (json.loads(actual.read_text()) if parse else ref)
        if len(pins) >= max_files:
            raise ValueError('native package file budget exhausted')
        if not actual.is_file():
            gaps.append({'id': 'missing-source', 'status': 'open', 'reason': key})
            return None
        size = actual.stat().st_size
        if size > max_bytes - total:
            raise ValueError('native package byte budget exhausted')
        data = actual.read_bytes(); total += len(data)
        ref = {'path': key, 'sha256': hashlib.sha256(data).hexdigest()}
        pins[key] = ref
        if expected and ref['sha256'] != expected:
            gaps.append({'id': 'source-pin-mismatch', 'status': 'open', 'reason': key})
        return json.loads(data) if parse else ref

    if type(max_files) is not int or max_files < 1 or type(max_bytes) is not int or max_bytes < 1:
        raise ValueError('positive integer resource limits required')
    package = read(package_path, parse=True)
    if not package or package.get('kind') != 'component_package':
        raise ValueError('expected existing component_package')
    native = package.get('native_implementation', {})
    recovery = native.get('recovery', {})
    lowering = package.get('lowering', {}).get('native_v1', {})
    if not lowering:
        raise ValueError('package has no native_v1 implementation')
    for source in lowering.get('sources', []):
        read(source['ref'], source.get('sha256'))
    for path in lowering.get('translation_units', []):
        read(path)
    qualification_path = native.get('compiler_ref')
    qualification = read(qualification_path, parse=True) if qualification_path else None
    if not qualification:
        gaps.append({'id': 'qualification-unavailable', 'status': 'open', 'reason': 'No retained native qualification receipt'})
    for path, expected in (qualification or {}).get('source_pins', {}).items():
        read(path, expected)
    for witness in recovery.get('dynamic_witness_refs', []):
        read(witness)
    if not re.fullmatch(r'[0-9a-f]{64}', recovery.get('rom_sha256') or '') or recovery.get('rom_sha256') != (qualification or {}).get('rom_sha256'):
        gaps.append({'id': 'native-host-identity', 'status': 'open', 'reason': 'Qualification and recovery ROM identities differ or are absent'})
    source_gaps = list(gaps)
    q_pass = bool(qualification and qualification.get('outcome') == 'passed' and not source_gaps)
    for limitation in recovery.get('unknowns', []) + package.get('qualification', {}).get('known_limits', []):
        gaps.append({'id': 'scope-limit', 'status': 'open', 'reason': limitation})
    calls = lowering.get('host_calls', [])
    dependencies = [{'id': c['service'], 'resolved': False,
                     'resolution_scope': 'retained-exact-rom-service',
                     'native_address': c.get('address'), 'abi': c.get('abi'),
                     'host_rom_sha256': recovery.get('rom_sha256')}
                    for c in calls]
    # Retained host services are satisfied by the native patch backend after it
    # verifies that cartridge, not by the standalone recovered policy capsule.
    state = [{'name': s['id'], 'type': s.get('type'),
              'owner': 'retained-native-host', 'lifetime': s.get('lifetime', 'unknown')}
             for s in package.get('states', [])]
    qualification_ref = pins.get(qualification_path)
    evidence = []
    if qualification_ref:
        evidence.append({'kind': 'retained-native-qualification',
                         'status': 'passed' if q_pass else 'unverified',
                         'ref': qualification_ref,
                         'scope': qualification.get('scope'),
                         'differential': qualification.get('differential'),
                         'witnesses': qualification.get('witnesses')})
    capsule = {'schema_version': 1, 'prefab_id': package['id'], 'level': 'L1',
               'backend': 'native-rom-patch',
               'source': {'kind': native.get('origin', 'unknown'),
                          'engine': native.get('game_id', 'unknown'),
                          'abi': native.get('abi', 'unknown'), 'commit': None,
                          'sha256': recovery.get('rom_sha256'),
                          'rom_sha1': recovery.get('rom_sha1'),
                          'refs': sorted(pins.values(), key=lambda p: p['path'])},
               'provides': [{'id': package['id'], 'type': 'native-policy',
                             'semantic': package.get('concept', {}).get('pattern', '')}],
               'requires': [{'id': c['service'], 'type': c.get('abi', 'native-service'),
                             'semantic': 'Exact original ROM service'} for c in calls],
               'state': state, 'lifecycle': {'entry': package.get('behaviors', []),
                   'exit': {'status': 'unresolved', 'reason': 'Original caller continuation retained by patch backend'},
                   'tick': 'original native invocation', 'save': 'retained original game storage'},
               'dependencies': dependencies, 'assets': [], 'resources': [],
               'domain': {'preconditions': package.get('extraction', {}).get('preconditions', []),
                          'exports': lowering.get('exports', [])},
               'schedule': {'hooks': package.get('lowering', {}).get('hooks', []),
                            'behaviors': package.get('behaviors', [])},
               'progression': {'state': [s for s in state if s['lifetime'] == 'campaign']},
               'closure': {'status': 'partial', 'missing': ['standalone-service-closure', 'whole-game-lifecycle']},
               'evidence': evidence, 'gaps': gaps,
               'maturity': {'native_subset_qualified': q_pass, 'automatic_highfunction_l1': False,
                            'whole_game': False, 'full_rom': False},
               'modification_scope': {'backend': 'native-rom-patch',
                   'package_ref': pins[package_path],
                   'requires_exact_host_rom': True,
                   'allowed_exports': lowering.get('exports', []),
                   'qualification_valid': q_pass,
                   'native_services': calls,
                   'scope': 'Bounded policy replacement in original whole ROM; no independently portable lifecycle claim'}}
    return {'schema': 'gameverse.native-package-extraction/1', 'candidates': [capsule],
            'inputs': sorted(pins.values(), key=lambda p: p['path']),
            'timing': {'wall_s': time.perf_counter() - started, 'queue_s': None,
                       'build_s': None, 'native_s': None, 'bytes_read': total,
                       'files_read': len(pins), 'outcome': 'passed' if q_pass else 'unverified'}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--package', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = extract_native_package(args.root, args.package)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + '\n')


if __name__ == '__main__':
    main()
