"""Private, import-once component bundles for artifact-only cartridge rebuilding.

Bundles retain original-derived captured bytes. They are not redistributable
payloads, source-free game implementations, or independently regenerated IR.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import platform
import re
import shutil
import subprocess
import time
from pathlib import Path

SCHEMA = 'gameverse.private-component-bundle/1'
MAX_BYTES = 32*1024*1024


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _read(root, ref):
    if not isinstance(ref, dict) or not isinstance(ref.get('path'), str) or not isinstance(ref.get('sha256'), str):
        raise ValueError('exact local artifact path and SHA-256 required')
    relative = Path(ref['path'])
    path = (root/relative).resolve()
    if (relative.is_absolute() or '..' in relative.parts or '\\' in ref['path']
            or not path.is_relative_to(root.resolve()) or not path.is_file()):
        raise ValueError('missing or escaping private artifact')
    data = path.read_bytes()
    if len(data) > MAX_BYTES or _sha(data) != ref['sha256']:
        raise ValueError('private artifact pin mismatch or resource bound exceeded')
    return data


def _write(path, value):
    raw = (json.dumps(value, indent=2, sort_keys=True)+'\n').encode()
    with path.open('xb') as stream:
        stream.write(raw)
    return {'path': path.name, 'sha256': _sha(raw)}


def export_bundle(packet_dir, output_dir):
    """Import output components once, with no original ROM/source fallback."""
    started = time.perf_counter()
    packet, output = Path(packet_dir).resolve(), Path(output_dir).resolve()
    manifest_bytes, layout_bytes = (packet/'manifest.json').read_bytes(), (packet/'layout.json').read_bytes()
    manifest, layout = json.loads(manifest_bytes), json.loads(layout_bytes)
    if manifest.get('schema') != 'gameverse.rom-roundtrip/1' or layout.get('schema') != 'gameverse.rom-roundtrip-layout/1':
        raise ValueError('versioned roundtrip manifest and layout required')
    original = manifest['original']
    if layout.get('originalSha256') != original['sha256']:
        raise ValueError('packet source identity differs from layout')
    size = layout['artifact']['size']
    if type(size) is not int or not 0 < size <= MAX_BYTES:
        raise ValueError('bounded cartridge output required')
    source_rows = manifest.get('components', [])
    if not isinstance(source_rows, list) or not source_rows or len(source_rows) > 4096:
        raise ValueError('bounded explicit source component set required')
    sources = {row['id']: row for row in source_rows}
    if len(sources) != len(source_rows):
        raise ValueError('duplicate source component identity')
    for row in source_rows:
        if _sha(_read(packet, row['artifact'])) != row['sha256']:
            raise ValueError('source component bytes differ from declared source identity')
    from .contracts import validate_manifest
    errors = validate_manifest(manifest, packet, verify_files=True)
    if errors:
        raise ValueError('invalid source manifest: '+'; '.join(errors))
    rows = layout.get('components', [])
    if not isinstance(rows, list) or not rows or len(rows) > 4096:
        raise ValueError('bounded explicit output component set required')
    prepared, cursor, identities = [], 0, set()
    for row in sorted(rows, key=lambda row: row['offset']):
        if (type(row['offset']) is not int or type(row['size']) is not int or row['offset'] != cursor
                or row['size'] <= 0 or cursor+row['size'] > size or row['id'] in identities):
            raise ValueError('output component gap, overlap or duplicate identity')
        identities.add(row['id'])
        source = sources.get(row.get('sourceComponent', row['id']))
        if source is not None and row.get('version') != source.get('version'):
            raise ValueError('layout source component version mismatch')
        if source is None and not (row.get('sourceComponent') is None and row.get('role') == 'generated-output'):
            raise ValueError('layout source component identity missing')
        artifact = row.get('artifact') or (source or {}).get('artifact')
        data = _read(packet, artifact)
        if len(data) != row['size'] or _sha(data) != row['sha256']:
            raise ValueError('output artifact differs from admitted layout')
        provenance = {'id': row['id'], 'sourceComponent': row.get('sourceComponent', row['id']),
                      'source_version': (source or {}).get('version'), 'source_sha256': (source or {}).get('sha256'),
                      'stratum': row.get('stratum', (source or {}).get('stratum', 'unknown')),
                      'provider_kind': row.get('providerKind', (source or {}).get('provider', {}).get('kind')),
                      'origin_evidence_sha256': [ref.get('sha256') for ref in (source or {}).get('evidence', []) if isinstance(ref, dict)],
                      'offset': row['offset'], 'size': row['size']}
        portable_row = {key: copy.deepcopy(row[key]) for key in (
            'id', 'version', 'sourceComponent', 'role', 'offset', 'size', 'sha256', 'providerKind', 'stratum', 'transform') if key in row}
        portable_row['stratum'] = provenance['stratum']
        prepared.append((portable_row, data, provenance))
        cursor += len(data)
    assembled = b''.join(data for _, data, _ in prepared)
    if cursor != size or _sha(assembled) != layout['artifact']['sha256']:
        raise ValueError('output components do not match packet artifact identity')
    comparison = packet/'comparison.json'
    if not comparison.exists() and (packet/'raw-diff.json').exists():
        comparison = packet/'raw-diff.json'
    if comparison.exists():
        report = json.loads(comparison.read_text())
        standard = (report.get('validation', {}).get('valid') is True
                    and not report.get('validation', {}).get('errors')
                    and report.get('raw', {}).get('original_sha256') == original['sha256']
                    and report.get('raw', {}).get('original_size') == original['size']
                    and report.get('raw', {}).get('rebuilt_sha256') == _sha(assembled))
        native_provider = packet/'provider-report.json'
        retained = json.loads(native_provider.read_text()) if native_provider.exists() else {}
        native = (comparison.name == 'raw-diff.json' and retained.get('outcome') == 'pass'
                  and retained.get('rebuilt_sha256') == _sha(assembled)
                  and report.get('rebuilt_sha256') == _sha(assembled)
                  and report.get('original_sha256') == original['sha256']
                  and report.get('original_size') == original['size']
                  and retained.get('original_sha256') == original['sha256'])
        if not (standard or native):
            raise ValueError('retained comparison does not admit exact packet identity')
    else:
        raise ValueError('packet requires its retained validated raw comparison')
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    (output/'components').mkdir()
    placements, origins = [], []
    for index, (row, data, provenance) in enumerate(prepared):
        relative = f'components/{index:04d}.bin'
        (output/relative).write_bytes(data)
        row['artifact'] = {'path': relative, 'sha256': _sha(data)}
        row['evidence'] = []  # External proof references are provenance, not executable inputs.
        placements.append(row)
        origins.append(provenance)
    portable_layout = {'schema': layout['schema'], 'originalSha256': layout['originalSha256'],
                       'artifact': {'size': size, 'sha256': _sha(assembled)}, 'components': placements}
    if layout.get('reconstruction_mode'):
        portable_layout['reconstruction_mode'] = layout['reconstruction_mode']
    layout_ref = _write(output/'layout.json', portable_layout)
    strata = {}
    for row in origins:
        strata[row['stratum']] = strata.get(row['stratum'], 0)+row['size']
    exact = original['sha256'] == _sha(assembled) and original['size'] == size
    bundle = {'schema': SCHEMA, 'game_id': manifest.get('game_id'),
              'capability': 'rebuild_only', 'private_original_derived_bytes': True,
              'content_classification': 'mixed-code-and-data-unclassified',
              'redistribution': 'not_authorized', 'ir_regeneration': False, 'modifiable_ir': False,
              'replay_regenerated_bytes': 0,
              'original': {'sha256': original['sha256'], 'size': original['size']},
              'expected_artifact': {'sha256': _sha(assembled), 'size': size}, 'layout': layout_ref,
              'assembly_mode': 'exact-artifact' if exact else 'native-relocated',
              'provenance': {'manifest_sha256': _sha(manifest_bytes), 'layout_sha256': _sha(layout_bytes),
                             'comparison_sha256': _sha(comparison.read_bytes()) if comparison.exists() else None,
                             'components': origins, 'output_stratum_bytes': strata,
                             'external_rom_and_source_paths_excluded': True,
                             'semantic_proofs': 'inherited packet scope; not replayed or newly admitted by bundle export'},
              'timing': {'export_s': round(time.perf_counter()-started, 6), 'queue_s': None,
                         'environment': platform.platform(), 'build_s': None,
                         'note': 'Artifact import/copy only; no compiler or simulation stage'}}
    _write(output/'bundle.json', bundle)
    return bundle


def rebuild_bundle(bundle_dir, output_path):
    """Rebuild exclusively from bundle-local pinned bytes, without external paths."""
    started = time.perf_counter()
    root, output = Path(bundle_dir).resolve(), Path(output_path).resolve()
    bundle = json.loads((root/'bundle.json').read_text())
    if bundle.get('schema') != SCHEMA or bundle.get('capability') != 'rebuild_only':
        raise ValueError('unsupported private bundle capability')
    layout = json.loads(_read(root, bundle['layout']))
    if layout['artifact'] != bundle['expected_artifact']:
        raise ValueError('bundle output identity differs from pinned layout')
    if output.exists():
        raise FileExistsError('Rebuild output must be new')
    if output.is_relative_to(root):
        raise ValueError('Rebuild output must be isolated from imported bundle')
    if bundle['assembly_mode'] == 'native-relocated':
        from .native_provider import assemble_native_layout
        derived = assemble_native_layout(root/bundle['layout']['path'], output)
    elif bundle['assembly_mode'] == 'exact-artifact':
        # Reuse the strict existing assembler via a temporary declarative manifest;
        # component references remain anchored to the private bundle directory.
        from .reassemble import assemble
        rows = []
        for row in layout['components']:
            _read(root, row['artifact'])
            rows.append({'id': row['id'], 'version': row['version'], 'offset': row['offset'], 'size': row['size'],
                         'sha256': row['sha256'], 'artifact': row['artifact'], 'relocations': [],
                         'stratum': row['stratum'], 'contract': {},
                         'provider': {'kind': 'opaque_bytes'}, 'dependencies': []})
        # assemble() reads no original.path. Keep its input in a fresh temporary
        # directory and copy only verified artifacts, never the source cartridge.
        import tempfile
        with tempfile.TemporaryDirectory(prefix='private-bundle-rebuild-') as folder:
            isolated = Path(folder)
            for row in rows:
                target = isolated/row['artifact']['path']
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(_read(root, row['artifact']))
            manifest = {'schema': 'gameverse.rom-roundtrip/1', 'original': bundle['original'],
                        'constraints': {'preserve_layout': True}, 'components': rows}
            _write(isolated/'manifest.json', manifest)
            data, derived = assemble(isolated/'manifest.json')
        if _sha(data) != bundle['expected_artifact']['sha256']:
            raise ValueError('rebuilt bundle output differs from declared artifact')
        with output.open('xb') as stream:
            stream.write(data)
        derived['artifact']['path'] = str(output)
    else:
        raise ValueError('unsupported private assembly mode')
    return {'schema': 'gameverse.private-bundle-rebuild/1', 'status': 'passed', 'capability': 'rebuild_only',
            'artifact': {'path': str(output), 'sha256': derived['artifact']['sha256'], 'size': derived['artifact']['size']},
            'external_original_or_source_access': False, 'ir_regeneration': False,
            'replay_regenerated_bytes': 0,
            'wall_s': round(time.perf_counter()-started, 6), 'queue_s': None}


def export_retained_c_payload(packet_dir, bundle_dir):
    """Export one fixed three-unit generated-C recipe, separate from rebuild_only.

    This retains emitted C and IR provenance. It does not implement L0→IR lifting,
    arbitrary edits, qualification, or a manifest-controlled command executor.
    """
    packet, bundle = Path(packet_dir).resolve(), Path(bundle_dir).resolve()
    metadata = json.loads((bundle/'bundle.json').read_text())
    report = json.loads((packet/'provider-report.json').read_text())
    if metadata['expected_artifact']['sha256'] != report.get('rebuilt_sha256') or report.get('outcome') != 'pass':
        raise ValueError('retained C must belong to this exact exported packet')
    names = ['behavior/bound.c', 'wait/bound.c', 'timer/bound.c', 'native.ld', 'native.bin',
             'behavior/l1.json', 'wait/l1.json', 'timer/l1.json']
    content = {name: _read(packet, {'path': name, 'sha256': report['producer_pins'][name]}) for name in names}
    for name in names[:3]:
        for line in content[name].decode().splitlines():
            if re.match(r'\s*#\s*(include|include_next|import)', line) and not re.fullmatch(r'\s*#\s*include\s*<(stdint|stddef)\.h>\s*', line):
                raise ValueError('retained C has unsupported external include closure')
    linker = content['native.ld'].decode()
    if re.search(r'\b(INCLUDE|INPUT|GROUP|SEARCH_DIR|STARTUP|OUTPUT)\b', linker):
        raise ValueError('retained linker script requests external inputs')
    tools = {}
    for name in ('cc', 'arm-none-eabi-ld', 'arm-none-eabi-objcopy'):
        tool = shutil.which(name)
        if not tool:
            raise ValueError('required existing compiler unavailable: '+name)
        tools[name] = {'path': str(Path(tool).resolve()), 'sha256': _sha(Path(tool).resolve().read_bytes())}
    target = bundle/'retained-c'
    target.mkdir()
    refs = {}
    for name, data in content.items():
        path = target/name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        refs[name] = {'path': str(path.relative_to(bundle)), 'sha256': _sha(data)}
    closure = {'schema': 'gameverse.retained-c-payload/1', 'capability': 'native_payload_recompile_from_retained_c',
               'sources': refs, 'tools': tools, 'expected_payload_sha256': _sha(content['native.bin']),
               'expected_payload_bytes': len(content['native.bin']), 'recipe': 'three-unit-arm7tdmi-freestanding/1',
               'limits': {'timeout_s': 15, 'compile_units': 3}, 'fresh_ir_lifting': False,
               'arbitrary_modifications_qualified': False, 'provenance_provider_sha256': _sha((packet/'provider-report.json').read_bytes())}
    _write(bundle/'retained-c.json', closure)
    return closure


def recompile_retained_payload(bundle_dir, output_dir):
    """Run the fixed bounded recipe against retained C, requiring exact binary."""
    started = time.perf_counter()
    bundle, output = Path(bundle_dir).resolve(), Path(output_dir).resolve()
    closure = json.loads((bundle/'retained-c.json').read_text())
    if closure.get('schema') != 'gameverse.retained-c-payload/1' or closure.get('recipe') != 'three-unit-arm7tdmi-freestanding/1':
        raise ValueError('unsupported retained C recipe')
    sources = {name: _read(bundle, ref) for name, ref in closure['sources'].items()}
    expected_sources = {'behavior/bound.c', 'wait/bound.c', 'timer/bound.c', 'native.ld', 'native.bin',
                        'behavior/l1.json', 'wait/l1.json', 'timer/l1.json'}
    if set(sources) != expected_sources:
        raise ValueError('unsupported retained source closure')
    for name in ('behavior/bound.c', 'wait/bound.c', 'timer/bound.c'):
        for line in sources[name].decode().splitlines():
            if re.match(r'\s*#', line) and not re.fullmatch(r'\s*#\s*include\s*<(stdint|stddef)\.h>\s*', line):
                raise ValueError('retained C has unsupported preprocessor closure')
    if re.search(r'\b(INCLUDE|INPUT|GROUP|SEARCH_DIR|STARTUP|OUTPUT)\b', sources['native.ld'].decode()):
        raise ValueError('retained linker requests external inputs')
    if set(closure['tools']) != {'cc', 'arm-none-eabi-ld', 'arm-none-eabi-objcopy'}:
        raise ValueError('unsupported retained tool closure')
    for name, tool in closure['tools'].items():
        if Path(shutil.which(name) or '').resolve() != Path(tool['path']).resolve() or _sha(Path(tool['path']).read_bytes()) != tool['sha256']:
            raise ValueError('existing compiler pin changed')
    output.mkdir(parents=True, exist_ok=False)
    stages = []
    for name, data in sources.items():
        target = output/name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    def run(name, command):
        began = time.perf_counter()
        result = subprocess.run(command, cwd=output, capture_output=True, text=True, timeout=15)
        row = {'stage': name, 'wall_s': round(time.perf_counter()-began, 6), 'outcome': 'passed' if result.returncode == 0 else 'failed'}
        stages.append(row)
        (output/(name+'.stdout')).write_text(result.stdout)
        (output/(name+'.stderr')).write_text(result.stderr)
        result.check_returncode()
    receipt = {'schema': 'gameverse.retained-c-payload-result/1', 'status': 'failed', 'stages': stages,
               'capability': closure['capability'], 'fresh_ir_lifting': False, 'native_qualification_replayed': False,
               'queue_s': None, 'existing_tool_pins': closure['tools']}
    try:
        objects = []
        for name in ('behavior', 'wait', 'timer'):
            obj = name+'/bound.o'
            run('compile-'+name, [closure['tools']['cc']['path'], '-target', 'armv4t-none-eabi', '-mcpu=arm7tdmi', '-mthumb',
                                 '-ffreestanding', '-fno-builtin', '-Os', '-c', name+'/bound.c', '-o', obj])
            objects.append(obj)
        run('link', [closure['tools']['arm-none-eabi-ld']['path'], '-T', 'native.ld', '-e', 'native_behavior', *objects, '-o', 'recompiled.elf'])
        run('objcopy', [closure['tools']['arm-none-eabi-objcopy']['path'], '-O', 'binary', 'recompiled.elf', 'recompiled.bin'])
        data = (output/'recompiled.bin').read_bytes()
        if _sha(data) != closure['expected_payload_sha256'] or len(data) != closure['expected_payload_bytes']:
            raise ValueError('retained C recompilation changed native payload identity')
        receipt.update(status='passed', artifact={'path': str(output/'recompiled.bin'), 'sha256': _sha(data), 'size': len(data)},
                       byte_exact_payload=True, game_source_checkout_required=False, original_rom_required=False)
    except BaseException as error:
        receipt.update(error=str(error), error_type=type(error).__name__)
        raise
    finally:
        receipt['wall_s'] = round(time.perf_counter()-started, 6)
        _write(output/'receipt.json', receipt)
    return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    for name in ('export', 'rebuild', 'recompile'):
        command = commands.add_parser(name)
        command.add_argument('--input', type=Path, required=True)
        command.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(argv)
    result = export_bundle(args.input, args.output) if args.command == 'export' else (
        rebuild_bundle(args.input, args.output) if args.command == 'rebuild' else recompile_retained_payload(args.input, args.output))
    print(json.dumps(result if args.command != 'export' else {
        'status': 'exported', 'capability': result['capability'],
        'components': len(result['provenance']['components']), 'bundle': str(args.output.resolve()),
        'expected_artifact': result['expected_artifact']}, sort_keys=True))


if __name__ == '__main__':
    main()
