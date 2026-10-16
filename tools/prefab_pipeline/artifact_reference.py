"""Registered, pinned prebuilt traversal inputs; never a compiler or repair recipe."""
from __future__ import annotations
import copy
import json
from pathlib import Path
import shutil
import time

from .contract import canonical_hash, file_ref, verify_file_ref

SCHEMA = 'native-artifact-traversal-request/1'
RECEIPT = 'native-artifact-reference-result/1'
ROOT = Path(__file__).resolve().parents[2]
_FIELDS = {'schema', 'request_id', 'role', 'game_id', 'source_revision', 'source_rom',
           'artifact', 'elf', 'save', 'provider_manifest', 'game_profile', 'quality'}


class ArtifactReferenceError(ValueError):
    pass


def _pin(ref, root):
    if not isinstance(ref, dict) or set(ref) != {'path', 'sha256'} or not isinstance(ref['path'], str):
        raise ArtifactReferenceError('artifact_reference_requires_exact_file_pin')
    # Request paths are installation-relative; external provider paths never come
    # from a client. They are separately checked below inside the reviewed file.
    if Path(ref['path']).is_absolute():
        raise ArtifactReferenceError('artifact_reference_requires_installation_relative_path')
    path = (root / ref['path']).resolve()
    try:
        path.relative_to(root)
    except ValueError as error:
        raise ArtifactReferenceError('artifact_reference_path_escape') from error
    if not verify_file_ref(ref, root):
        raise ArtifactReferenceError('artifact_reference_pin_mismatch')
    return path


def _authority(request, config, root):
    authority = config.get('runtime_manifest') or {}
    if not authority.get('recipe_id') or not isinstance(authority.get('path'), str):
        raise ArtifactReferenceError('artifact_reference_registered_provider_required')
    inventory_path = (root / authority['path']).resolve()
    try:
        inventory_path.relative_to(root)
    except ValueError as error:
        raise ArtifactReferenceError('artifact_reference_authority_path_escape') from error
    inventory = json.loads(inventory_path.read_text())
    recipes = [row for row in inventory.get('recipes', []) if row.get('id') == authority['recipe_id']]
    if len(recipes) != 1:
        raise ArtifactReferenceError('artifact_reference_recipe_unregistered')
    recipe = recipes[0]
    rows = [row for row in inventory.get('files', []) if authority['recipe_id'] in row.get('recipes', [])]
    approved = {row['path']: row['sha256'] for row in rows}
    request_path = recipe.get('request_path')
    request_pin = {'path': request_path, 'sha256': approved.get(request_path)}
    if request_pin['sha256'] != recipe.get('request_sha256'):
        raise ArtifactReferenceError('artifact_reference_request_not_in_reviewed_readset')
    path = _pin(request_pin, root)
    if json.loads(path.read_text()) != request:
        raise ArtifactReferenceError('artifact_reference_request_identity_mismatch')
    for key in ('source_rom', 'artifact', 'elf', 'save', 'provider_manifest', 'game_profile', 'quality'):
        if approved.get(request[key]['path']) != request[key]['sha256']:
            raise ArtifactReferenceError('artifact_reference_input_not_in_reviewed_readset')
    return {'recipe_id': authority['recipe_id'], 'request': request_pin, 'approved': approved}


def validate_artifact_reference(request, config, *, root=None):
    root = Path(root or ROOT).resolve()
    if (not isinstance(request, dict) or set(request) != _FIELDS or request.get('schema') != SCHEMA
            or request.get('role') not in ('original', 'candidate')
            or not all(isinstance(request.get(key), str) and request[key] for key in ('request_id', 'game_id', 'source_revision'))):
        raise ArtifactReferenceError('unsupported_artifact_reference_request')
    registered = _authority(request, config, root)
    paths = {key: _pin(request[key], root) for key in ('source_rom', 'artifact', 'elf', 'save', 'provider_manifest', 'game_profile', 'quality')}
    provider = json.loads(paths['provider_manifest'].read_text())
    if provider.get('schema') != 'gameverse.sid-rpg-provider/1' or provider.get('game_id') != request['game_id']:
        raise ArtifactReferenceError('artifact_reference_provider_identity_mismatch')
    provider_root = Path(provider['provider_root']).resolve()
    # Only this reviewed provider descriptor can choose external import/tool
    # paths. The traversal stage itself neither imports nor executes that code.
    for group in ('sources', 'tools', 'source_inputs'):
        for ref in provider.get(group, {}).values():
            path = Path(ref.get('path', '')).resolve()
            try:
                path.relative_to(provider_root)
            except ValueError as error:
                raise ArtifactReferenceError('artifact_reference_provider_code_escape') from error
            if not verify_file_ref(ref):
                raise ArtifactReferenceError('artifact_reference_provider_source_changed')
    identities = {'artifact': provider['rom'], 'source_rom': provider.get('source_rom', provider['rom']),
                  'elf': provider['elf'], 'save': provider.get('initial_save', {})}
    for key, expected in identities.items():
        if expected.get('sha256') != request[key]['sha256'] or not verify_file_ref(expected):
            raise ArtifactReferenceError('artifact_reference_provider_data_mismatch')
    profile = json.loads(paths['game_profile'].read_text())
    if profile.get('game_id') != request['game_id']:
        raise ArtifactReferenceError('artifact_reference_game_profile_mismatch')
    quality = json.loads(paths['quality'].read_text())
    if request['role'] == 'original' and quality.get('schema') == 'native-scenario-graph/1':
        from tools.playtester.scenario import validate
        validate(quality)
        quality = {'scope': 'original-baseline-scenario-only', 'scenario': request['quality'],
                   'original_game_version': request['artifact']['sha256'],
                   'original_source_revision': request['source_revision'], 'startpoint': request['save'],
                   'candidate': 'unavailable', 'changed_mechanic': 'unavailable',
                   'mod_quality': 'not-evaluated; no candidate provided'}
    else:
        from tools.playtester.mod_quality import validate
        quality = validate(quality)
        version = quality[request['role']]
        if (version['game_id'] != request['game_id'] or version['game_version'] != request['artifact']['sha256']
                or version['source_revision'] != request['source_revision']
                or version['adapter_version'] != config['adapter_version']):
            raise ArtifactReferenceError('artifact_reference_quality_version_mismatch')
        start = version['startpoint']['reference']
        start_kind = version['startpoint']['kind']
        if start_kind == 'ordinary_save':
            if start.get('sha256') != request['save']['sha256']:
                raise ArtifactReferenceError('artifact_reference_quality_startpoint_mismatch')
        elif start_kind == 'native_checkpoint':
            _pin(start, root)
            if registered['approved'].get(start['path']) != start['sha256']:
                raise ArtifactReferenceError('artifact_reference_checkpoint_not_in_readset')
        elif start.get('sha256') != request['artifact']['sha256']:
            raise ArtifactReferenceError('artifact_reference_fresh_boot_pin_mismatch')
    return {'registered': registered, 'paths': paths, 'provider': provider, 'quality': quality}


def reference_artifact(request, config, output_dir, *, root=None):
    """Copy verified bytes and retain selection timing; compilation is N/A."""
    began = time.monotonic()
    selected = validate_artifact_reference(request, config, root=root)
    output = Path(output_dir).resolve()
    output.mkdir(parents=True, exist_ok=False)
    target = output/'artifact.gba'
    shutil.copyfile(selected['paths']['artifact'], target)
    artifact = file_ref(target)
    if artifact['sha256'] != request['artifact']['sha256']:
        raise ArtifactReferenceError('artifact_reference_copy_changed')
    report = {'schema': RECEIPT, 'status': 'artifact-reused-copy-verified', 'operation': 'traversal',
        'request': copy.deepcopy(request), 'request_sha256': canonical_hash(request),
        'artifact': artifact, 'source_rom': request['source_rom'],
        'registered': {key: value for key, value in selected['registered'].items() if key != 'approved'},
        'role': request['role'], 'build_seconds': None, 'build_mode': 'not-applicable; pinned prebuilt artifact',
        'artifact_reference_seconds': round(time.monotonic()-began, 6), 'queue_seconds': None,
        'repair_support': 'unsupported without a separately registered build recipe',
        'qualification': {'input_pins': 'verified', 'quality_plan': request['quality'],
                          'coverage': selected['quality'],
                          'native_objective': 'pending', 'whole_campaign': 'untested'},
        'activation': 'not_performed'}
    (output/'report.json').write_text(json.dumps(report, indent=2)+'\n')
    return report


def artifact_stages():
    from .iteration import IterationStages

    def admit(request, context):
        validate_artifact_reference(request, context.config)
        return {'admitted': True, 'operation': 'pinned-artifact-traversal',
                'scope': 'Registered immutable inputs and selected original/candidate quality plan only'}

    def select(request, context):
        output = context.output/('artifact-%d' % len(context.report['attempts']))
        report = reference_artifact(request, context.config, output)
        return {'artifact_kind': 'prebuilt-reference', 'artifact': report['artifact'],
                'source_rom_sha256': request['source_rom']['sha256'],
                'artifact_receipt': file_ref(output/'report.json'),
                'build_report': file_ref(output/'report.json'), 'build_seconds': None,
                'artifact_reference_report': report}

    def experiment(artifact, context):
        from tools.playtester.rpg_experiment import experiment_rpg_candidate
        from .quality_dispatch import attach_quality
        observed = experiment_rpg_candidate(artifact, context)
        return attach_quality(context.report['request'], context.config, artifact, observed, context)

    def diagnose(request, artifact, observed, context):
        return {'schema': 'native-artifact-diagnosis/1', 'trust': 'hypothesis_only',
                'artifact_sha256': artifact['sha256'], 'basis': observed.get('evidence', []),
                'native_diagnosis': observed.get('diagnosis'),
                'reason': observed.get('reason', 'bounded_traversal_partial'),
                'repair_support': 'unsupported without a separately registered build recipe'}

    def repair(request, diagnosis, context):
        return {'blocked': True, 'reason': 'prebuilt_artifact_has_no_registered_repair_recipe',
                'diagnosis': diagnosis}

    return IterationStages(admit, select, experiment, diagnose, repair)
