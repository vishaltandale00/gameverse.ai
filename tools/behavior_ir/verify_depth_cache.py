"""Bounded cache/readiness checks only: no work(), ROM reads or native calls."""
import hashlib
import json
from pathlib import Path
import platform
import tempfile
import time
from depth import compiler_fingerprint, readiness_fields, target_rank, profile_cache_inputs, input_signature, reusable_native_proof, Unsupported


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def run():
    started = time.perf_counter()
    checked = 0
    with tempfile.TemporaryDirectory(prefix='depth-cache-') as directory:
        root = Path(directory)
        marker = root / 'executed'
        # These bodies must only be parsed, never imported/executed.
        (root / 'entry.py').write_text("import json\nfrom helper import value\ndef branch():\n from nested import value\n")
        (root / 'helper.py').write_text("from entry import branch\nvalue = 1\nraise RuntimeError('must never import')\n")
        (root / 'nested.py').write_text("from pathlib import Path\nPath(" + repr(str(marker)) + ").touch()\nvalue = 2\n")
        fingerprint = lambda: compiler_fingerprint(root, ('entry.py',), ())
        first = fingerprint()
        assert list(first['sources']) == ['entry.py', 'helper.py', 'nested.py']
        assert not marker.exists()
        assert first == fingerprint()
        profile = {'id': 'primitive'}
        prior = {'primitive': {'outcome': 'pending_dependency_or_compiler', 'input_signature': digest(first)}}
        assert target_rank(profile, prior, {'primitive': digest(fingerprint())}) == 3
        (root / 'nested.py').write_text('value = 3\n')
        changed = fingerprint()
        assert digest(changed) != digest(first)
        assert target_rank(profile, prior, {'primitive': digest(changed)}) == 1
        prior['primitive']['outcome'] = 'native_qualified'
        assert target_rank(profile, prior, {'primitive': digest(changed)}) == 2
        checked += 6
        # Unknown imports are explicit failures; declared external modules are
        # recorded without importing or locating their executable package code.
        (root / 'entry.py').write_text('import unavailable_external_package\n')
        declared = compiler_fingerprint(root, ('entry.py',), (), ('unavailable_external_package',))
        assert declared['external_modules'] == ['unavailable_external_package']
        checked += 1
        for text in ['from missing_helper import x\n', 'import missing_helper\n', 'def broken(:\n']:
            (root / 'entry.py').write_text(text)
            try:
                fingerprint()
            except Unsupported:
                checked += 1
            else:
                raise AssertionError('missing or invalid source silently reused')
        # Local package cycles, relative imports and child imports are included.
        (root / 'entry.py').write_text('from package import child\n')
        package = root / 'package'
        package.mkdir()
        (package / '__init__.py').write_text('from . import child\n')
        (package / 'child.py').write_text('from . import sibling\n')
        (package / 'sibling.py').write_text('from . import child\n')
        result = fingerprint()
        assert set(result['sources']) == {'entry.py', 'package/__init__.py', 'package/child.py', 'package/sibling.py'}
        (package / 'sibling.py').unlink()
        try:
            fingerprint()
        except Unsupported:
            checked += 2
        else:
            raise AssertionError('missing relative source silently reused')
        (package / '__init__.py').write_text('')
        (root / 'entry.py').write_text('from package import missing_child\n')
        try:
            fingerprint()
        except Unsupported:
            checked += 1
        else:
            raise AssertionError('missing package child silently reused')
        # Profile paths are immutable signature keys; their contents are not.
        profile = {'id': 'fixture', 'causal_fixture': 'fixture.json', 'cache_input_paths': ['optional.json']}
        fixture = root / 'fixture.json'
        fixture.write_text('{"value":1}')
        inputs = profile_cache_inputs(profile, root)
        assert inputs['optional.json']['state'] == 'missing'
        signature = input_signature(profile, first, {'entry': 'sourcehash'}, inputs)
        prior = {'fixture': {'outcome': 'native_qualified', 'input_signature': signature}}
        assert target_rank(profile, prior, {'fixture': signature}) == 3
        fixture.write_text('{"value":2}')
        changed = input_signature(profile, first, {'entry': 'sourcehash'}, profile_cache_inputs(profile, root))
        assert changed != signature and target_rank(profile, prior, {'fixture': changed}) == 2
        (root / 'optional.json').write_text('{}')
        assert inputs != profile_cache_inputs(profile, root)
        fixture.unlink()
        assert profile_cache_inputs(profile, root)['fixture.json']['state'] == 'missing'
        checked += 5
        for path in ('../escape.json', '/absolute.json', 'game.gba'):
            try:
                profile_cache_inputs({'cache_input_paths': [path]}, root)
            except Unsupported:
                checked += 1
            else:
                raise AssertionError('non-JSON/escaping input accepted for hashing')
        (root / 'qualify.py').write_text('from abi import render\n')
        (root / 'abi.py').write_text('render = 1\n')
        runtime = digest(compiler_fingerprint(root, ('qualify.py',), ()))
        proof_inputs = dict(qualification_runtime_signature=runtime, fixture_input_sha256='fixtures',
                            rom_sha256='rom', harness_sha256='oracle', generated_c_sha256='c',
                            adapter_sha256='adapter', parameter_grid=False, requested_vectors=1024)
        old = dict(outcome='pass', qualification_runtime_signature=runtime, fixture_input_sha256='fixtures',
                   rom_sha256='rom', harness_sha256='oracle', parameter_grid_low8=False, limits={'vectors': 1024},
                   artifacts={'generated.c': {'sha256': 'c'}, 'validation-adapter.json': {'sha256': 'adapter'},
                              'l1.json': {'sha256': 'oldmetadata'}})
        assert reusable_native_proof(old, **proof_inputs)
        old['artifacts']['l1.json']['sha256'] = 'newmetadata'
        assert reusable_native_proof(old, **proof_inputs)
        (root / 'abi.py').write_text('render = 2\n')
        new_runtime = digest(compiler_fingerprint(root, ('qualify.py',), ()))
        assert new_runtime != runtime
        assert not reusable_native_proof(old, **dict(proof_inputs, qualification_runtime_signature=new_runtime))
        assert not reusable_native_proof(dict(old, qualification_runtime_signature=None), **proof_inputs)
        assert not reusable_native_proof(old, **dict(proof_inputs, parameter_grid=True))
        assert not reusable_native_proof(old, **dict(proof_inputs, requested_vectors=2048))
        checked += 7
    typed = readiness_fields(True, True)
    assert typed['typed_ports_ready'] and typed['source_dependency_closed']
    assert typed['ports_ready'] and not typed['closure_ready']
    assert typed['closure_ready_deprecated'] and typed['system_closure_status'] == 'unproven'
    untyped = readiness_fields(False, True)
    assert not untyped['typed_ports_ready'] and untyped['source_dependency_closed']
    checked += 4
    # One bounded invocation per fingerprint; keep prior100-run benchmark
    # separate because it predates the qualification-runtime fingerprint.
    before = time.perf_counter()
    actual = compiler_fingerprint()
    compiler_s = time.perf_counter() - before
    before = time.perf_counter()
    runtime = compiler_fingerprint(entrypoints=('qualify.py',))
    runtime_s = time.perf_counter() - before
    for name in ('bounded_cfg.py', 'pointer_regions.py', 'entity_reference.py', 'native_abi.py'):
        assert name in actual['sources']
    checked += 4
    print(json.dumps({'outcome': 'pass', 'checks': checked, 'new_native_calls': 0,
        'timing': {'compiler_fingerprint_once_s': compiler_s,
                   'qualification_runtime_fingerprint_once_s': runtime_s,
                   'compiler_sources': len(actual['sources']), 'compiler_assets': len(actual['assets']),
                   'qualification_runtime_sources': len(runtime['sources']),
                   'context': 'same process/tool tree; Python ' + platform.python_version(),
                   'full_work_before_after': 'unavailable; no work()/ROM campaign/native qualification run'},
        'source_pins': {name: hashlib.sha256((Path(__file__).resolve().parent / name).read_bytes()).hexdigest()
                        for name in ('depth.py', 'verify_depth_cache.py')},
        'wall_s': time.perf_counter() - started}))


if __name__ == '__main__':
    run()
