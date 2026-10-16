"""Original-behavior native relocation provider, distinct from exact recovery.

The original opaque host is preserved explicitly. Only the recovered defeat
transaction is compiled; differential witnesses cover deterministic service
boundaries, never the complete game or unmodified cartridge equivalence.
"""
from __future__ import annotations

import hashlib
import json
import platform
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PARITY_PLAN = ROOT / 'research/deep-extraction/castlevania/defeat-parity.plan.json'
ORACLE_SOURCE = ROOT / 'research/deep-extraction/castlevania/defeat-differential.c'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def pin(path):
    path = Path(path).resolve()
    return {'path': str(path), 'sha256': sha(path.read_bytes())}


def _write(path, value):
    Path(path).write_text(json.dumps(value, indent=2, sort_keys=True)+'\n')


def capture_native_layout(original, generated, lock, output_dir, *, original_path, evidence, native_contract=None):
    """Capture actual compiler pieces, checking all bytes outside native hooks."""
    output = Path(output_dir).resolve()
    output.mkdir(parents=True, exist_ok=False)
    (output/'source').mkdir()
    (output/'generated').mkdir()
    if (not 0 < len(original) < len(generated) <= 32*1024*1024
            or lock['output_sha256'] != sha(generated)
            or lock['retained_foundation_sha256'] != sha(original)
            or int(lock['payload_address'], 0) != 0x08000000+len(original)):
        raise ValueError('native compiler output identity/layout mismatch')
    payload_size = lock['payload_bytes']
    if type(payload_size) is not int or not 0 < payload_size <= len(generated)-len(original):
        raise ValueError('invalid native payload extent')
    if sha(generated[len(original):len(original)+payload_size]) != lock['payload_sha256']:
        raise ValueError('native payload identity mismatch')
    restored, hooks, end = bytearray(generated[:len(original)]), [], 0
    for row in sorted(lock['hook_lowering'], key=lambda x: int(x['hook']['address'], 0)):
        hook = row['hook']
        offset, preimage = int(hook['address'], 0)-0x08000000, bytes.fromhex(hook['preimage'])
        if offset < end or len(preimage) != 8 or offset+8 > len(original) or original[offset:offset+8] != preimage:
            raise ValueError('invalid or overlapping source hook')
        if generated[offset:offset+8].hex() != row['output_bytes']:
            raise ValueError('generated hook bytes differ from compiler lock')
        restored[offset:offset+8] = preimage
        hooks.append((offset, offset+8, row))
        end = offset+8
    if not hooks or restored != original:
        raise ValueError('native output changed opaque original bytes')
    components, placements = [], []
    boundaries = sorted({0, len(original), *(x for start, end, _ in hooks for x in (start, end))})
    hook_by_start = {start: row for start, _, row in hooks}
    for index, (start, end) in enumerate(zip(boundaries, boundaries[1:])):
        row = hook_by_start.get(start)
        identity = 'native-hook-'+row['hook']['id'] if row else f'opaque-{start:08x}'
        left, right = original[start:end], generated[start:end]
        source_path, generated_path = output/'source'/f'{identity}.bin', output/'generated'/f'{identity}.bin'
        source_path.write_bytes(left)
        generated_path.write_bytes(right)
        contract = native_contract or {'scope': 'native entry veneer only; function semantic evidence recorded separately'} if row else {}
        source = {'id': identity, 'version': 'sha256:'+sha(left), 'offset': start, 'size': end-start,
                  'sha256': sha(left), 'stratum': 'native-relocated' if row else 'opaque-preserved',
                  'artifact': {'path': str(source_path.relative_to(output)), 'sha256': sha(left)},
                  'provider': {'kind': 'native_compiler' if row else 'opaque_bytes'},
                  'dependencies': [], 'relocations': [], 'contract': contract,
                  'closure': {'status': 'closed' if row and native_contract else 'unknown',
                              'scope': 'Bounded entry-transfer under retained native host' if row else 'Opaque preserved host; semantic closure unavailable'},
                  'evidence': evidence if row else []}
        components.append(source)
        placements.append({'id': identity, 'sourceComponent': identity, 'version': source['version'],
                           'offset': start, 'size': end-start, 'sha256': sha(right),
                           'artifact': {'path': str(generated_path.relative_to(output)), 'sha256': sha(right)},
                           'providerKind': 'native_compiler' if row else 'opaque_bytes',
                           'stratum': source['stratum'], 'transform': 'compiled-native-veneer' if row else 'identity-placement',
                           'evidence': evidence if row else []})
    for component in components:
        if component['stratum'] == 'native-relocated':
            component['dependencies'] = [{'target': host['id'], 'version': host['version'], 'sha256': host['sha256'],
                                          'kind': 'retained-native-host', 'status': 'resolved'}
                                         for host in components if host['stratum'] == 'opaque-preserved']
    for identity, start, end, stratum in (
            ('native-payload', len(original), len(original)+payload_size, 'native-relocated'),
            ('cartridge-expansion-fill', len(original)+payload_size, len(generated), 'data-regenerated')):
        if end == start:
            continue
        data = generated[start:end]
        artifact = output/'generated'/f'{identity}.bin'
        artifact.write_bytes(data)
        placements.append({'id': identity, 'version': 'sha256:'+sha(data), 'sourceComponent': None,
                           'role': 'generated-output', 'offset': start, 'size': len(data), 'sha256': sha(data),
                           'artifact': {'path': str(artifact.relative_to(output)), 'sha256': sha(data)},
                           'providerKind': 'native_compiler', 'stratum': stratum, 'evidence': evidence})
    manifest = {'schema': 'gameverse.rom-roundtrip/1', 'game_id': 'castlevania-aria-of-sorrow',
                'original': {'path': str(Path(original_path).resolve()), 'sha256': sha(original), 'size': len(original)},
                'constraints': {'preserve_layout': True}, 'components': components,
                'claims': {'container_exact_reconstruction': False, 'whole_game_semantic_closure': False}}
    layout = {'schema': 'gameverse.rom-roundtrip-layout/1', 'originalSha256': sha(original),
              'artifact': {'sha256': sha(generated), 'size': len(generated)}, 'components': placements,
              'reconstruction_mode': 'native-relocated'}
    _write(output/'manifest.json', manifest)
    _write(output/'layout.json', layout)
    return manifest, layout


def verify_native_substitution(proof, original_component, candidate, root):
    """Verify exact retained host/output and the finite native witness receipt."""
    root = Path(root)
    def verified(ref):
        path = root/ref['path']
        if sha(path.read_bytes()) != ref['sha256']:
            raise ValueError('stale native proof artifact')
        return path
    native = json.loads(verified(proof['native_proof']).read_text())
    for ref in native['inputs'].values():
        verified(ref)
    verified(native['oracle_binary'])
    stdout = verified(native['oracle_stdout']).read_text()
    observed = json.loads(stdout.strip().splitlines()[-1])
    if observed != native['result'] or observed.get('outcome') != 'passed' or observed.get('vectors') != 14720:
        return False
    original = verified(native['inputs']['original']).read_bytes()
    generated = verified(native['generated_rom']).read_bytes()
    if sha(original) != proof['source_rom_sha256']:
        return False
    start, size = original_component['offset'], original_component['size']
    if (verified(original_component['artifact']).read_bytes() != original[start:start+size]
            or verified(candidate['artifact']).read_bytes() != generated[start:start+size]):
        return False
    for retained in proof['scope']['unchanged_prerequisites']:
        start, size = retained['offset'], retained['size']
        if original[start:start+size] != generated[start:start+size] or sha(original[start:start+size]) != retained['sha256']:
            return False
    return True


def assemble_native_layout(layout_path, output_path):
    """Assemble pinned pieces and return a derived layout without editing inputs.

    Creators may explicitly persist the returned metadata before sealing a new
    receipt. Verification callers leave the producer's layout bytes untouched.
    """
    layout_path, output = Path(layout_path), Path(output_path)
    layout = json.loads(layout_path.read_text())
    if layout.get('schema') != 'gameverse.rom-roundtrip-layout/1' or layout.get('reconstruction_mode') != 'native-relocated':
        raise ValueError('unsupported native output layout')
    size = layout['artifact']['size']
    if type(size) is not int or not 0 < size <= 32*1024*1024:
        raise ValueError('invalid native output size')
    cursor, chunks, identities = 0, [], set()
    for row in sorted(layout['components'], key=lambda x: x['offset']):
        if (type(row['offset']) is not int or type(row['size']) is not int or row['offset'] != cursor
                or row['size'] <= 0 or cursor+row['size'] > size or row['id'] in identities):
            raise ValueError('output piece gap/overlap/identity mismatch')
        identities.add(row['id'])
        relative = Path(row['artifact']['path'])
        path = (layout_path.parent/relative).resolve()
        if relative.is_absolute() or not path.is_relative_to(layout_path.parent.resolve()):
            raise ValueError('output piece escapes isolated artifacts')
        if output.resolve() == path:
            raise ValueError('cannot overwrite an input artifact')
        data = path.read_bytes()
        if len(data) != row['size'] or sha(data) != row['sha256'] or sha(data) != row['artifact']['sha256']:
            raise ValueError('output piece stale or wrong size')
        chunks.append(data)
        cursor += len(data)
    assembled = b''.join(chunks)
    if cursor != size or sha(assembled) != layout['artifact']['sha256']:
        raise ValueError('assembled native output identity mismatch')
    with output.open('xb') as stream:
        stream.write(assembled)
    layout['artifact']['path'] = str(output.resolve())
    return layout


def reconstruct_native_parity(original_path, output_dir, *, plan_path=PARITY_PLAN):
    """One clean build and one bounded native differential, with failed receipts."""
    from tools.composition.native_build import build, validate
    from tools.prefab_pipeline.reconstruction_compare import compare_reconstruction
    output = Path(output_dir).resolve()
    output.mkdir(parents=True, exist_ok=False)
    began = time.monotonic()
    report = {'schema': 'gameverse.native-roundtrip-provider/1', 'status': 'failed', 'queue_s': None,
              'environment': platform.platform(), 'stages': [], 'model_calls': 0,
              'limits': {'build_s': 60, 'oracle_subprocess_s': 30, 'vectors': 14720},
              'scope': 'Recovered original defeat transaction; deterministic service boundary witnesses; no whole-game equivalence',
              'timing_note': 'Stages nested in total; compiler stage timings nested in build; queue unavailable'}
    def stage(name, action):
        started = time.monotonic()
        row = {'name': name, 'outcome': 'failed'}
        report['stages'].append(row)
        try:
            value = action()
            row['outcome'] = 'passed'
            return value
        finally:
            row['wall_s'] = round(time.monotonic()-started, 6)
    try:
        original = Path(original_path).read_bytes()
        plan = json.loads(Path(plan_path).read_text())
        native = plan['native_build']
        if (len(native['hooks']) != 1 or native['hooks'][0]['symbol'] != 'gv_aos_defeat_native'
                or native['hooks'][0]['args'] != [{'arg': 0}, {'constant': 1}]
                or len(native['packages']) != 1):
            raise ValueError('provider requires original defeat parity, not authored modifications')
        stage('validate-original-parity', lambda: validate(plan, original))
        report['inputs'] = {'original': pin(original_path), 'plan': pin(plan_path), 'oracle_source': pin(ORACLE_SOURCE),
                            'native_compiler': pin(ROOT/'tools/composition/native_build.py'), 'provider': pin(__file__)}
        receipt = stage('native-build', lambda: build(plan, original_path, output/'native'))
        cart = Path(receipt['output'])
        oracle = output/'defeat-oracle'
        def command(args, label):
            result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, timeout=30)
            (output/(label+'.stdout')).write_text(result.stdout)
            (output/(label+'.stderr')).write_text(result.stderr)
            result.check_returncode()
            return result.stdout
        stage('compile-oracle', lambda: command(['cc', '-O2', '-Wall', '-I/opt/homebrew/include', str(ORACLE_SOURCE),
              '-L/opt/homebrew/lib', '-Wl,-rpath,/opt/homebrew/lib', '-lmgba', '-o', str(oracle)], 'compile-oracle'))
        raw = stage('native-differential', lambda: command([str(oracle), str(Path(original_path).resolve()), str(cart)], 'native-differential'))
        result = json.loads(raw.strip().splitlines()[-1])
        if result.get('outcome') != 'passed' or result.get('vectors') != 14720:
            raise ValueError('original behavior differential incomplete')
        proof = {'schema': 'gameverse.native-roundtrip-proof/1', 'inputs': report['inputs'], 'generated_rom': pin(cart),
                 'oracle_binary': pin(oracle), 'result': result,
                 'oracle_stdout': pin(output/'native-differential.stdout'),
                 'limits': '115 species x128 contexts, 30000 instruction steps per call; RNG/tile/reward services intercepted deterministically',
                 'whole_game_equivalent': None, 'entry_point': '0x080683bc'}
        _write(output/'native-proof.json', proof)
        lock = json.loads((output/'native/composition.lock.json').read_text())
        host = json.loads((ROOT/native['host']['ref']).read_text())
        package = json.loads((ROOT/native['packages'][0]['package']['ref']).read_text())
        native_contract = {'entrypoints': ['0x080683bc'], 'call_targets': package['lowering']['native_v1'].get('host_calls', []),
                           'native_abi': package['native_implementation']['abi'],
                           'state_ownership': package['lowering']['native_v1']['state_bindings'],
                           'address_assumptions': {'original_sha256': sha(original), 'payload_address': lock['payload_address']},
                           'asset_mode': 'retain complete original cartridge bytes outside the single entry veneer',
                           'dispatch': 'native caller enters same address, veneer transfers to compiled recovered function',
                           'scheduling': 'original native caller, no new scheduler', 'authority': host['hooks'][0],
                           'literal_pools': 'compiler payload pinned by composition lock; original host retained byte-for-byte',
                           'compression': []}
        evidence = [pin(output/'native-proof.json'), pin(output/'native/composition.lock.json')]
        manifest, _ = stage('capture-compiler-artifacts', lambda: capture_native_layout(original, cart.read_bytes(), lock,
                             output/'pieces', original_path=original_path, evidence=evidence, native_contract=native_contract))
        layout = stage('artifact-only-reassembly', lambda: assemble_native_layout(output/'pieces/layout.json', output/'reconstructed.gba'))
        # This producer owns a new derived receipt. The supplied assembly input
        # remains immutable, including when another verifier later reassembles it.
        _write(output/'pieces/assembled-layout.json', layout)
        rebuilt = (output/'reconstructed.gba').read_bytes()
        from tools.roundtrip.contracts import canonical_hash, substitution_errors
        source = next(c for c in manifest['components'] if c['stratum'] == 'native-relocated')
        placement = next(c for c in layout['components'] if c['sourceComponent'] == source['id'])
        candidate = {**source, 'source_rom_sha256': sha(original), 'artifact': placement['artifact']}
        swap_proof = {'source_rom_sha256': sha(original), 'component_id': source['id'],
                      'original_artifact_sha256': source['artifact']['sha256'],
                      'candidate_artifact_sha256': candidate['artifact']['sha256'],
                      'contract_sha256': canonical_hash(source['contract']), 'native_proof': pin(output/'native-proof.json'),
                      'scope': {'mode': 'bounded-retained-host', 'unchanged_prerequisites': [
                          {'target': c['id'], 'version': c['version'], 'offset': c['offset'], 'size': c['size'],
                           'sha256': c['sha256'], 'artifact_sha256': c['artifact']['sha256'],
                           'no_output_changes': True, 'relocations': []}
                          for c in manifest['components'] if c['stratum'] == 'opaque-preserved']}}
        candidate['proof'] = swap_proof
        errors = substitution_errors(manifest, source['id'], candidate, output/'pieces', verify_native_substitution)
        if errors:
            raise ValueError('bounded native substitution rejected: '+'; '.join(errors))
        _write(output/'substitution.json', {'candidate': candidate, 'admitted': True,
                                           'scope': 'bounded retained-host native entry transfer; no whole-game equivalence'})
        comparison = stage('raw-comparison', lambda: compare_reconstruction(original, rebuilt, manifest, layout,
                           certificates=[swap_proof], evidence_verifier=lambda kind, record:
                           kind == 'certificate' and record == swap_proof and verify_native_substitution(record, source, candidate, output/'pieces')))
        _write(output/'comparison.json', comparison)
        report.update(status='bounded-native-parity-reconstructed', original=pin(original_path),
                      artifact=pin(output/'reconstructed.gba'), manifest=pin(output/'pieces/manifest.json'),
                      layout=pin(output/'pieces/assembled-layout.json'), comparison=pin(output/'comparison.json'),
                      semantic_evidence=pin(output/'native-proof.json'), build_receipt=pin(output/'native/receipt.json'),
                      substitution=pin(output/'substitution.json'),
                      raw_exact=rebuilt == original, compiler_artifact_exact=rebuilt == cart.read_bytes(),
                      source_semantic_ranges=json.loads((ROOT/native['packages'][0]['package']['ref']).read_text())['native_implementation']['recovery']['ranges'],
                      generated_payload_bytes=lock['payload_bytes'], original_source_hook_bytes=8)
    except BaseException as error:
        report['error'] = str(error)
        report['error_type'] = type(error).__name__
        raise
    finally:
        report['total_wall_s'] = round(time.monotonic()-began, 6)
        _write(output/'provider-report.json', report)
    return report
