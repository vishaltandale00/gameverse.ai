"""Build bounded original-ROM candidates from pinned native prefab graph edits.

The shared native compiler owns ABI validation, dependency linking and cartridge
preservation. This frontend changes only declared package versions and exports or
constant arguments. Candidate construction never claims gameplay qualification.
"""
from __future__ import annotations
import copy
import hashlib
import json
import platform
import subprocess
import time
from pathlib import Path
from tools.prefab_pipeline.contract import canonical_hash

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = 'native-prefab-mod-request/1'
STRATEGY_LOWERERS = {
    'reward-strategy/1': ('tools/prefab_pipeline/reward_strategy.py', 'lower_reward_strategy'),
    'connected-strategy/1': ('tools/prefab_pipeline/momentum_strategy.py', 'lower_momentum_strategy'),
    'sonic-metroid-strategy/1': ('tools/prefab_pipeline/sonic_metroid_strategy.py', 'lower_sonic_metroid_strategy'),
}


def _digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _resolve(pin):
    if not isinstance(pin, dict) or set(pin) != {'path', 'sha256'}:
        raise ValueError('input requires exact path+sha256 pin')
    path = (ROOT / pin['path']).resolve()
    path.relative_to(ROOT)
    if not path.is_file() or _digest(path) != pin['sha256']:
        raise ValueError('missing or changed pinned input: ' + str(path))
    return path


def inspect_strategy_lowering(spec):
    """Check registration and immutable inputs without running generation."""
    if spec is None:
        return None
    if not isinstance(spec, dict) or spec.get('backend') not in STRATEGY_LOWERERS:
        raise ValueError('unsupported strategy lowering contract')
    expected = {'backend', 'strategy', 'lowerer'}
    if spec['backend'] == 'reward-strategy/1':
        expected.add('instance')
    if set(spec) != expected or ('instance' in expected and not isinstance(spec['instance'], str)):
        raise ValueError('unsupported strategy lowering contract fields')
    relative, function = STRATEGY_LOWERERS[spec['backend']]
    lowerer_path = _resolve(spec['lowerer'])
    if lowerer_path != (ROOT / relative).resolve():
        raise ValueError('strategy lowerer must be registered implementation')
    strategy_path = _resolve(spec['strategy'])
    if not isinstance(json.loads(strategy_path.read_text()), dict):
        raise ValueError('strategy must be a JSON object')
    return {'backend': spec['backend'], 'strategy_path': strategy_path,
            'lowerer_path': lowerer_path, 'function': function}


validate_strategy_lowering = inspect_strategy_lowering


def validate_native_mod_request(request):
    """Cheap admission: no lowerer, compiler, subprocess or generated outputs."""
    registration = inspect_strategy_lowering(request.get('strategy_lowering'))
    plan, rom, changes = prepare_native_mod_request(request, allow_deferred=registration is not None)
    return {'lowering': registration, 'plan': plan, 'rom': rom, 'changes': changes}


def prepare_native_mod_request(request, *, allow_deferred=False):
    if request.get('schema') != SCHEMA or not isinstance(request.get('request_id'), str):
        raise ValueError('unsupported native prefab modification request')
    plan_path, rom_path = _resolve(request['plan']), _resolve(request['rom'])
    baseline = json.loads(plan_path.read_text())
    modified = copy.deepcopy(baseline)
    native = modified['native_build']
    if native['version'] != 'gba-component-native/1' or not baseline['target'].get('preserve_campaign'):
        raise ValueError('requires supported campaign-preserving native graph')
    limits = request.get('limits', {'max_build_s': 60, 'max_payload_bytes': 16384, 'subprocess_s': 20})
    if set(limits) != {'max_build_s', 'max_payload_bytes', 'subprocess_s'}:
        raise ValueError('unknown native build limit')
    if not all(type(limits[key]) is int and 1 <= limits[key] <= maximum for key, maximum in [('max_build_s', 300), ('max_payload_bytes', 65536), ('subprocess_s', 30)]):
        raise ValueError('unsupported native build limits')
    native.update(max_build_s=limits['max_build_s'], max_payload_bytes=limits['max_payload_bytes'], timeout_s=limits['subprocess_s'])
    known = {entry['instance']: entry for entry in native['packages']}
    replacements = request.get('package_replacements', [])
    edits = request.get('hook_edits', [])
    if not isinstance(replacements, list) or not isinstance(edits, list) or not (replacements or edits or allow_deferred):
        raise ValueError('require explicit package or hook changes')
    changed = []
    replaced = set()
    for replacement in replacements:
        if (not isinstance(replacement, dict) or set(replacement) != {'instance', 'package'}
                or replacement['instance'] not in known or replacement['instance'] in replaced):
            raise ValueError('unknown package instance replacement')
        replaced.add(replacement['instance'])
        package_path = _resolve(replacement['package'])
        package = json.loads(package_path.read_text())
        if package.get('kind') != 'component_package' or package.get('lowering', {}).get('native_v1', {}).get('version') != 'freestanding-c-thumb/1':
            raise ValueError('replacement lacks supported native prefab lowering')
        entry = known[replacement['instance']]
        changed.append({'instance': entry['instance'], 'before': copy.deepcopy(entry['package']), 'after': copy.deepcopy(replacement['package'])})
        entry['package'] = {'ref': replacement['package']['path'], 'sha256': replacement['package']['sha256']}
    hook_map = {hook['host_hook']: hook for hook in native['hooks']}
    seen = set()
    for edit in edits:
        if set(edit) - {'host_hook', 'symbol', 'constant_arguments'} or edit.get('host_hook') not in hook_map or edit['host_hook'] in seen:
            raise ValueError('unknown, duplicate, or unsupported hook edit')
        seen.add(edit['host_hook'])
        hook = hook_map[edit['host_hook']]
        before = copy.deepcopy(hook)
        if 'symbol' in edit:
            if not isinstance(edit['symbol'], str):
                raise ValueError('symbol must name a packaged native export')
            hook['symbol'] = edit['symbol']
        for key, value in edit.get('constant_arguments', {}).items():
            index = int(key)
            if str(index) != key or not 0 <= index < len(hook['args']) or set(hook['args'][index]) != {'constant'} or type(value) is not int:
                raise ValueError('only existing scalar constant arguments may be rebound')
            hook['args'][index] = {'constant': value}
        changed.append({'hook': edit['host_hook'], 'before': before, 'after': copy.deepcopy(hook)})
    modified['id'] = request['request_id']
    # Source and host pin checks, reviewed authority, original-ROM identity and
    # executable argument domains remain mandatory in shared native_build.build.
    return modified, rom_path, changed


def _generated_pin(pin, output):
    path = _resolve(pin)
    try:
        path.relative_to(output)
    except ValueError:
        raise ValueError('lowerer artifact must be inside its isolated output') from None
    return path


def _verify_output_tree(value, output):
    if isinstance(value, dict) and set(value) == {'path', 'sha256'}:
        _generated_pin(value, output)
    elif isinstance(value, dict) and value:
        for child in value.values():
            _verify_output_tree(child, output)
    elif isinstance(value, list) and value:
        for child in value:
            _verify_output_tree(child, output)
    else:
        raise ValueError('lowerer outputs must contain immutable artifact pins')


def merge_strategy_changes(request, result, output_dir):
    """Validate every generated artifact and merge all authority atomically."""
    output = Path(output_dir).resolve()
    if not isinstance(result, dict) or not result.get('outputs'):
        raise ValueError('lowerer must return pinned outputs and receipt')
    _verify_output_tree(result['outputs'], output)
    _generated_pin(result.get('receipt'), output)
    replacements, edits = result.get('package_replacements', []), result.get('hook_edits', [])
    if not isinstance(replacements, list) or not isinstance(edits, list) or not (replacements or edits):
        raise ValueError('lowerer must return package replacements or hook edits')
    for replacement in replacements:
        if not isinstance(replacement, dict) or set(replacement) != {'instance', 'package'}:
            raise ValueError('unsupported generated package replacement')
        package = json.loads(_generated_pin(replacement['package'], output).read_text())
        # Shared compiler subsequently checks ABI/dependency semantics. Verify
        # exact referenced source bytes here before merging generated authority.
        for source in package.get('lowering', {}).get('native_v1', {}).get('sources', []):
            _resolve({'path': source['ref'], 'sha256': source['sha256']})
    merged = copy.deepcopy(request)
    merged.pop('strategy_lowering', None)
    for field, rows, identity in (('package_replacements', replacements, 'instance'), ('hook_edits', edits, 'host_hook')):
        combined = merged.get(field, []) + copy.deepcopy(rows)
        keys = [row.get(identity) for row in combined if isinstance(row, dict)]
        if len(keys) != len(combined) or any(not isinstance(key, str) or not key for key in keys) or len(set(keys)) != len(keys):
            raise ValueError(f'strategy and explicit {field} conflict or duplicate authority')
        merged[field] = combined
    # Apply no mutations to the input until every output and edit passes.
    prepare_native_mod_request(merged)
    return merged


def _run_strategy_lowering(spec, output):
    registration = inspect_strategy_lowering(spec)
    # Compile the freshly verified bytes, avoiding stale imported-module/pyc
    # state when multiple requests run in a long-lived improvement process.
    code = registration['lowerer_path'].read_bytes()
    if hashlib.sha256(code).hexdigest() != spec['lowerer']['sha256']:
        raise ValueError('strategy lowerer changed before execution')
    namespace = {'__name__': 'tools.prefab_pipeline.' + registration['lowerer_path'].stem,
                 '__package__': 'tools.prefab_pipeline', '__file__': str(registration['lowerer_path'])}
    exec(compile(code, str(registration['lowerer_path']), 'exec'), namespace)
    strategy_path = _resolve(spec['strategy'])
    result = namespace[registration['function']](json.loads(strategy_path.read_text()), output)
    if spec['backend'] == 'reward-strategy/1':
        result = {**result, 'package_replacements': [{'instance': spec['instance'], 'package': result['package']}], 'hook_edits': []}
    return result


def build_native_mod_request(request, output_dir):
    from tools.composition.native_build import build
    started = time.monotonic()
    original_request = copy.deepcopy(request)
    request = copy.deepcopy(request)
    output = Path(output_dir).resolve()
    output.mkdir(parents=True, exist_ok=False)
    report = {'schema': 'native-prefab-mod-result/1', 'request_id': request.get('request_id'), 'status': 'failed',
              'request': original_request, 'request_sha256': None,
              'resolved_request': None, 'strategy_lowering': None, 'frontend_sha256': _digest(Path(__file__)),
              'source_commit': None, 'environment': platform.platform(), 'queue_s': None, 'changes': [],
              'scope': 'Complete original-ROM preservation with bounded native prefab graph replacement; gameplay qualification pending',
              'qualification': {'native_abi_and_preservation': False, 'model_gameplay': 'pending', 'whole_campaign': 'untested'},
              'build_mode': 'clean native payload; existing compiler/toolchain; no dependency setup',
              'limits': request.get('limits', {'max_build_s': 60, 'max_payload_bytes': 16384, 'subprocess_s': 20}),
              'stage_accounting': 'Admission, lowering, preparation and compiler build stages nested within total_wall_s; compiler sub-stages overlap parent build; queue unavailable',
              'stages': []}

    def stage(name, action):
        before = time.monotonic()
        row = {'name': name, 'outcome': 'failed'}
        report['stages'].append(row)
        try:
            value = action()
            row['outcome'] = 'passed'
            return value
        except BaseException as error:
            row['error_type'] = type(error).__name__
            raise
        finally:
            row['wall_s'] = round(time.monotonic() - before, 6)

    try:
        report['request_sha256'] = canonical_hash(original_request)
        (output/'request.json').write_text(json.dumps(original_request, indent=2)+'\n')
        stage('admit', lambda: validate_native_mod_request(request))
        report['source_commit'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True, timeout=5).strip()
        lowering = request.get('strategy_lowering')
        if lowering is not None:
            result = stage('strategy-lowering', lambda: _run_strategy_lowering(lowering, output/'strategy'))
            report['strategy_lowering'] = result
            request = stage('merge-strategy', lambda: merge_strategy_changes(request, result, output/'strategy'))
        modified, rom, edits = stage('prepare', lambda: prepare_native_mod_request(request))
        report['resolved_request'], report['changes'] = request, edits
        plan_path = output/'modified.plan.json'
        plan_path.write_text(json.dumps(modified, indent=2)+'\n')
        (output/'resolved-request.json').write_text(json.dumps(request, indent=2)+'\n')
        report['derived_plan'] = {'path': str(plan_path), 'sha256': _digest(plan_path)}
        receipt = stage('build', lambda: build(modified, rom, output/'native'))
        lock_path = output/'native/composition.lock.json'
        lock = json.loads(lock_path.read_text())
        if lock['retained_foundation_sha256'] != request['rom']['sha256'] or receipt['outcome'] != 'built':
            raise ValueError('shared compiler did not prove pinned original cartridge preservation')
        report['qualification']['native_abi_and_preservation'] = True
        report.update(status='candidate-built', artifact=receipt['output'], artifact_sha256=receipt['output_sha256'],
                      build_receipt={'path': str(output/'native/receipt.json'), 'sha256': _digest(output/'native/receipt.json')},
                      lock={'path': str(lock_path), 'sha256': _digest(lock_path)},
                      hook_lowering=lock['hook_lowering'], payload_bytes=lock['payload_bytes'])
    except BaseException as error:
        report['error'] = str(error)
        report['error_type'] = type(error).__name__
        # Lowerer-written diagnostics and partially generated source remain in
        # the isolated attempt even when generation never returns a receipt.
        raise
    finally:
        report['total_wall_s'] = round(time.monotonic()-started, 6)
        (output/'report.json').write_text(json.dumps(report, indent=2)+'\n')
    return report
