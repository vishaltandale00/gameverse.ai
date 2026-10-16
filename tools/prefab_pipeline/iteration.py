"""Durable bounded build/DecisionAI iteration; callbacks are trusted registered code.

No shell or import paths come from a request. Diagnosis is a hypothesis, never
qualification or permission to activate a ROM. Callback deadlines are cooperative;
individual native/provider operations must also honor context.remaining().
"""
from __future__ import annotations

from dataclasses import dataclass
import copy
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import platform
import subprocess
import time
import traceback

from .contract import canonical_hash, file_ref, verify_file_ref

VERSION = 'prefab-iteration/1'


class IterationError(ValueError):
    pass


@dataclass(frozen=True)
class IterationStages:
    admit: object
    build: object
    experiment: object
    diagnose: object
    repair: object


class Context:
    def __init__(self, config, output, report, deadline):
        self.config, self.output, self.report, self.deadline = config, output, report, deadline
        self.checkpoint = None

    def remaining(self):
        used, limits = self.report['usage'], self.config['limits']
        return {'model_calls': max(0, limits['model_calls'] - used['model_calls']),
                'native_frames': max(0, limits['native_frames'] - used['native_frames']),
                'wall_seconds': max(0., self.deadline - time.monotonic()),
                'cost_usd': None if limits['cost_usd'] is None else max(0., limits['cost_usd'] - (used['cost_usd'] or 0.))}


def _write(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')
    temporary.replace(path)


def _validate(config):
    if config.get('schema') != VERSION:
        raise IterationError('unsupported_iteration_schema')
    for name in ('run_id', 'source_commit', 'environment_version', 'adapter_version', 'loop_config_ref', 'mechanism_sha256', 'base_rom_sha256'):
        if not isinstance(config.get(name), str) or not config[name]:
            raise IterationError('missing_pin_' + name)
    for name in ('mechanism_sha256', 'base_rom_sha256'):
        if len(config[name]) != 64 or any(char not in '0123456789abcdef' for char in config[name]):
            raise IterationError('invalid_sha256_' + name)
    limits = config.get('limits', {})
    for name in ('attempts', 'model_calls', 'native_frames', 'wall_seconds'):
        value = limits.get(name)
        if type(value) not in (int, float) or not math.isfinite(value) or value <= 0:
            raise IterationError('invalid_limit_' + name)
        if name != 'wall_seconds' and type(value) is not int:
            raise IterationError('invalid_integer_limit_' + name)
    cost = limits.get('cost_usd')
    if cost is not None and (type(cost) not in (int, float) or not math.isfinite(cost) or cost <= 0):
        raise IterationError('invalid_cost_limit')
    if 'cost_usd' not in limits:
        raise IterationError('cost_limit_must_be_explicit_nullable')
    if not all(verify_file_ref(ref) for ref in config.get('mechanism_refs', [])):
        raise IterationError('mechanism_source_pin_mismatch')
    canonical_hash(config)


def checkpoint_compatible(checkpoint, artifact, config):
    """Exact cartridge, adapter, environment and state bytes only; no migration guess."""
    return bool(checkpoint and checkpoint.get('artifact_sha256') == artifact.get('sha256')
                and checkpoint.get('adapter_version') == config['adapter_version']
                and checkpoint.get('environment_version') == config['environment_version']
                and verify_file_ref(checkpoint.get('state'))
                and (not checkpoint.get('learning_context') or verify_file_ref(checkpoint['learning_context'])))


def run_iteration(request, config, output_dir, stages=None, *, resume=False):
    """Run registered stages and retain every completed/failed/cancelled stage.

    Stage result usage: {model_calls:int,native_frames:int,cost_usd:number|null}.
    build: {artifact:{path,sha256}, parent_sha256, cheap_guard_passed:true,
            intended_edit_witness:dict}; experiment: {native:true,success:bool,
            evidence:[file refs], decisions:[...], usage:{...}, checkpoint?:...}.
    repair: {request: exact configured supported_requests variant} or {blocked:true}.
    Resume never repeats an in-flight stage (its consumption is unknown). Terminal
    reports are idempotent. Checkpoints may continue within one bounded run only.
    """
    _validate(config)
    request, config = copy.deepcopy(request), copy.deepcopy(config)
    stages = stages or default_stages(request, config)
    output = Path(output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    report_path = output / 'iteration.json'
    identity = canonical_hash({'request': request, 'config': config})
    if report_path.exists():
        prior = json.loads(report_path.read_text())
        if prior['input_sha256'] != identity:
            raise IterationError('resume_input_identity_mismatch')
        if not resume:
            raise IterationError('existing_run_requires_resume')
        if prior['status'] != 'running':
            return prior
        # A killed process may have consumed provider resources without a receipt.
        prior.update(status='blocked', reason='interrupted_stage_usage_unknown')
        _write(report_path, prior)
        return prior
    started = time.monotonic()
    report = {'schema': VERSION, 'run_id': config['run_id'], 'request_id': request.get('request_id'),
              'input_sha256': identity, 'request': request, 'config': config, 'status': 'running',
              'started_utc': datetime.now(timezone.utc).isoformat(),
              'machine': {'platform': platform.platform(), 'python': platform.python_version()},
              'attempts': [], 'repairs': [], 'stages': [], 'usage': {'model_calls': 0, 'native_frames': 0, 'cost_usd': 0.},
              'queue_seconds': None, 'total_wall_seconds': None, 'activation': 'never_performed',
              'timing_note': 'Stage durations nested in total; native report child timings retained, not added again; queue unavailable.',
              'cost_basis': 'actual callback/provider billing only; null means unavailable',
              'usage_complete': True, 'unreported_usage_stages': []}
    context = Context(config, output, report, started + config['limits']['wall_seconds'])
    _write(output / 'inputs.json', {'request': request, 'config': config, 'identity': identity})
    _write(report_path, report)

    def stage(name, call, *args):
        row = {'name': name, 'attempt': len(report['attempts']), 'status': 'running'}
        report['stages'].append(row)
        _write(report_path, report)
        began = time.monotonic()
        result = None
        try:
            if context.remaining()['wall_seconds'] <= 0:
                raise IterationError('wall_budget')
            result = call(*args, context)
            canonical_hash(result)
            row.update(status='completed', result=result)
            usage = result.get('usage', {})
            for key in ('model_calls', 'native_frames'):
                value = usage.get(key, 0)
                if type(value) is not int or value < 0:
                    raise IterationError('invalid_usage_' + key)
                report['usage'][key] += value
            cost = usage.get('cost_usd', 0. if not usage.get('model_calls') else None)
            if cost is not None and (type(cost) not in (int, float) or not math.isfinite(cost) or cost < 0):
                raise IterationError('invalid_actual_cost')
            report['usage']['cost_usd'] = None if cost is None or report['usage']['cost_usd'] is None else report['usage']['cost_usd'] + cost
            for key in ('model_calls', 'native_frames'):
                if report['usage'][key] > config['limits'][key]:
                    raise IterationError('callback_exceeded_' + key)
            if config['limits']['cost_usd'] is not None:
                if report['usage']['cost_usd'] is None:
                    raise IterationError('cost_budget_unverifiable')
                if report['usage']['cost_usd'] > config['limits']['cost_usd']:
                    raise IterationError('cost_budget')
            if context.remaining()['wall_seconds'] <= 0:
                raise IterationError('wall_budget')
            return result
        except BaseException as error:
            if result is None:
                report['usage_complete'] = False
                report['unreported_usage_stages'].append({'name': name, 'attempt': len(report['attempts']),
                    'basis': 'stage failed before returning usage; cumulative counters are known lower bounds'})
            frames = traceback.extract_tb(error.__traceback__)
            origin = frames[-1] if frames else None
            diagnostic = {'type': type(error).__name__,
                          'source': {'path': origin.filename, 'line': origin.lineno} if origin else None}
            # Registered compiler errors are local diagnostics. Provider bodies
            # and arbitrary callback exception strings never enter the report.
            local_compilers = ('prefab_pipeline/native_mod.py', 'composition/native_build.py', 'prefab_pipeline/artifact_reference.py')
            if isinstance(error, IterationError) or (origin and origin.filename.endswith(local_compilers)):
                diagnostic['message'] = str(error)[:2000]
            row.update(status='cancelled' if isinstance(error, (KeyboardInterrupt, SystemExit)) else 'failed',
                       error_type=type(error).__name__, diagnostic=diagnostic)
            report['failure_diagnostic'] = diagnostic
            raise
        finally:
            row['wall_seconds'] = round(time.monotonic() - began, 6)
            _write(report_path, report)

    current, checkpoint = request, config.get('initial_checkpoint')
    try:
        for attempt in range(config['limits']['attempts']):
            report['attempts'].append({'attempt': attempt + 1, 'request': current, 'request_sha256': canonical_hash(current)})
            admitted = stage('admit', stages.admit, current)
            if admitted.get('admitted') is not True:
                report.update(status='blocked', reason='cheap_admission_failed')
                break
            reference_operation = current.get('schema') == 'native-artifact-traversal-request/1'
            built = stage('artifact-reference' if reference_operation else 'build', stages.build, current)
            artifact = built.get('artifact', {})
            if reference_operation:
                receipt_ref = built.get('artifact_receipt')
                if not verify_file_ref(receipt_ref) or not verify_file_ref(artifact):
                    raise IterationError('artifact_reference_receipt_or_bytes_invalid')
                receipt = json.loads(Path(receipt_ref['path']).read_text())
                if (built.get('artifact_kind') != 'prebuilt-reference'
                        or receipt.get('schema') != 'native-artifact-reference-result/1'
                        or receipt.get('status') != 'artifact-reused-copy-verified'
                        or receipt.get('request_sha256') != canonical_hash(current)
                        or artifact['sha256'] != current['artifact']['sha256']
                        or receipt.get('artifact', {}).get('sha256') != artifact['sha256']
                        or built.get('source_rom_sha256') != config['base_rom_sha256']
                        or built.get('build_seconds') is not None or receipt.get('build_seconds') is not None):
                    raise IterationError('artifact_reference_identity_or_operation_invalid')
                report['build_seconds'] = None
                report['operation'] = 'pinned-artifact-traversal'
            elif (built.get('cheap_guard_passed') is not True or not built.get('intended_edit_witness')
                    or built.get('parent_sha256') != config['base_rom_sha256'] or not verify_file_ref(artifact)
                    or artifact.get('sha256') == config['base_rom_sha256']):
                raise IterationError('build_artifact_or_edit_witness_invalid')
            report['artifact'] = artifact
            report['final_request'] = copy.deepcopy(current)
            if built.get('build_report'):
                if not verify_file_ref(built['build_report']):
                    raise IterationError('build_report_pin_mismatch')
                report['build_report'] = built['build_report']
            report['artifact_status'] = 'artifact-reused' if reference_operation else 'candidate-built-cheap-integrity-passed'
            report['qualification'] = {'native_objective': 'pending', 'whole_campaign': 'untested', 'activation': 'not_performed'}
            _write(report_path, report)
            context.checkpoint = copy.deepcopy(checkpoint) if checkpoint_compatible(checkpoint, artifact, config) else None
            report['attempts'][-1]['checkpoint_reused'] = context.checkpoint is not None
            if checkpoint and context.checkpoint is None:
                report['attempts'][-1]['checkpoint_reset_reason'] = 'artifact_or_runtime_identity_changed; fresh isolated fixture required'
            if context.remaining()['model_calls'] < 1 or context.remaining()['native_frames'] < 1:
                report.update(status='budget', reason='experiment_budget_exhausted')
                break
            if config['limits']['cost_usd'] is not None:
                # Current native providers expose no enforceable billing ceiling.
                # Do not spend first and claim that a finite dollar cap was held.
                raise IterationError('cost_budget_unverifiable')
            context.output = output / ('experiment-%d' % (attempt + 1))
            try:
                experiment = stage('experiment', stages.experiment, artifact)
            finally:
                context.output = output
            model_evidence = experiment.get('usage', {}).get('model_calls', 0) > 0 and bool(experiment.get('decisions'))
            navigation = experiment.get('deterministic_navigation') or {}
            navigation_records = navigation.get('decisions', [])
            def source_navigation_record(event):
                result = event.get('result', {})
                record = result.get('record', {})
                policy = record.get('policy')
                return (event.get('event') == 'decision' and result.get('accepted') is True
                        and isinstance(result.get('action_id'), str)
                        and (policy in ('single_available_action', 'continue_adapter_target')
                             or (policy == 'continue_model_wait'
                                 and record.get('basis') == 'source_proven_noninteractive_callback_unchanged')))
            deterministic_evidence = (reference_operation and config['adapter_version'] == 'sid-rpg-navigation/1'
                and experiment.get('control_basis') == 'source-defined-navigation'
                and experiment.get('usage', {}).get('model_calls') == 0
                and experiment.get('usage', {}).get('native_frames', 0) > 0
                and bool(navigation_records) and all(source_navigation_record(event) for event in navigation_records)
                and bool(navigation.get('evidence')) and all(verify_file_ref(ref) for ref in navigation['evidence']))
            if (experiment.get('native') is not True or not (model_evidence or deterministic_evidence)
                    or not experiment.get('evidence')
                    or not all(verify_file_ref(ref) for ref in experiment['evidence'])):
                raise IterationError('native_model_experiment_evidence_required')
            if experiment.get('mod_quality'):
                report['mod_quality'] = experiment['mod_quality']
                report['qualification']['mod_quality'] = experiment['mod_quality']['status']
            if config.get('require_mod_quality') and experiment.get('mod_quality', {}).get('status') != 'passed':
                report.update(status='blocked', reason='declared_mod_quality_not_passed')
                break
            checkpoint = experiment.get('checkpoint')
            report['checkpoint'] = checkpoint
            if config.get('pause_after_experiment'):
                report.update(status='partial', reason='awaiting_explicit_continuation')
                break
            if experiment.get('success') is True:
                witness = experiment.get('objective_witness') or {}
                if (witness.get('source') != 'native-observation' or witness.get('artifact_sha256') != artifact['sha256']
                        or not witness.get('observed_predicate') or not witness.get('evidence')
                        or not all(verify_file_ref(ref) for ref in witness['evidence'])):
                    raise IterationError('native_objective_witness_required')
                report['qualification']['native_objective'] = 'observed'
                report.update(status='success', reason='native_objective_observed', artifact=artifact, objective_witness=witness)
                break
            diagnosis = stage('diagnose', stages.diagnose, current, artifact, experiment)
            if reference_operation:
                report.update(status='partial', reason='experiment_budget_exhausted', repair_support='unsupported without a registered build recipe')
                break
            # The diagnosis cannot promote, mutate artifact identity, or skip guards.
            if attempt + 1 == config['limits']['attempts']:
                report.update(status='budget', reason='attempt_budget_exhausted')
                break
            repair = stage('repair', stages.repair, current, diagnosis)
            candidate = repair.get('request')
            supported = config.get('supported_requests', [request])
            if repair.get('blocked') or candidate not in supported:
                report.update(status='blocked', reason='no_supported_repair')
                break
            report['repairs'].append({'from_request_sha256': canonical_hash(current),
                'to_request_sha256': canonical_hash(candidate), 'diagnosis': diagnosis,
                'selection': repair.get('selection'), 'request': candidate})
            current = copy.deepcopy(candidate)
        else:
            report.update(status='budget', reason='attempt_budget_exhausted')
    except (KeyboardInterrupt, SystemExit):
        report.update(status='cancelled', reason='interrupted')
    except Exception as error:
        report.update(status='budget' if 'budget' in str(error) else 'blocked', reason=str(error) if isinstance(error, IterationError) else 'stage_exception', error_type=type(error).__name__)
    finally:
        if report.get('artifact') and report['status'] != 'success':
            report['experiment_outcome'] = report['status']
            if report.get('operation') != 'pinned-artifact-traversal':
                report['status'] = 'artifact-built-with-diagnostics'
        report['total_wall_seconds'] = round(time.monotonic() - started, 6)
        _write(report_path, report)
    return report


def default_stages(request, config):
    """Only the explicitly registered native cartridge experiment is selectable."""
    if config['mechanism_sha256'] != file_ref(Path(__file__))['sha256']:
        raise IterationError('iteration_mechanism_pin_mismatch')
    if request.get('schema') == 'native-artifact-traversal-request/1':
        from .artifact_reference import artifact_stages
        return artifact_stages()
    if request.get('schema') != 'native-prefab-mod-request/1':
        raise IterationError('unsupported_iteration_backend')
    from .native_mod import ROOT, build_native_mod_request

    def cached_build(value, context):
        ref = context.config.get('cached_build_report')
        if ref is None:
            return None
        if not verify_file_ref(ref):
            raise IterationError('cached_build_report_pin_mismatch')
        result = json.loads(Path(ref['path']).read_text())
        if result.get('request_sha256') != canonical_hash(value) and value in context.config.get('supported_requests', []):
            return None  # A selected reviewed repair must build its own artifact.
        if (result.get('status') != 'candidate-built' or result.get('request_sha256') != canonical_hash(value)
                or result.get('request') != value or result.get('request', {}).get('rom', {}).get('sha256') != context.config['base_rom_sha256']
                or not result.get('qualification', {}).get('native_abi_and_preservation')):
            raise IterationError('cached_build_request_or_guard_mismatch')
        refs = [result.get('build_receipt'), result.get('lock'), result.get('derived_plan'),
                {'path': result.get('artifact'), 'sha256': result.get('artifact_sha256')}]
        def output_refs(value):
            if isinstance(value, dict):
                if 'path' in value and 'sha256' in value:
                    yield value
                else:
                    for child in value.values():
                        yield from output_refs(child)
            elif isinstance(value, list):
                for child in value:
                    yield from output_refs(child)
        lowered = result.get('strategy_lowering', {})
        refs.extend(output_refs(lowered.get('outputs', {})))
        refs.extend(output_refs({key: lowered[key] for key in ('receipt', 'package', 'package_replacements') if key in lowered}))
        if not all(verify_file_ref(pin, ROOT) for pin in refs):
            raise IterationError('cached_build_artifact_or_source_mismatch')
        result['cache_reuse'] = {'report': ref, 'scope': 'Exact pinned artifact and generated source/lock/receipt reused; no compiler executed'}
        return result

    def admit(value, context):
        retained = cached_build(value, context)
        if retained:
            return {'admitted': True, 'scope': 'Exact retained request and native build/source evidence verified', 'cache': True}
        from .native_mod import validate_native_mod_request
        validate_native_mod_request(value)
        if value['rom']['sha256'] != context.config['base_rom_sha256']:
            raise IterationError('base_rom_pin_mismatch')
        return {'admitted': True, 'scope': 'pinned source, supported native edit and ABI guards; no campaign matrix'}

    def build(value, context):
        retained = cached_build(value, context)
        limit = value.get('limits', {}).get('max_build_s', 60)
        if retained is None and limit > context.remaining()['wall_seconds']:
            raise IterationError('insufficient_wall_budget_for_registered_build')
        result = retained or build_native_mod_request(value, context.output / ('build-%d' % len(context.report['attempts'])))
        build_report = result.get('cache_reuse', {}).get('report') or file_ref(context.output / ('build-%d' % len(context.report['attempts'])) / 'report.json')
        return {'artifact': {'path': result['artifact'], 'sha256': result['artifact_sha256']},
                'build_report': build_report,
                'parent_sha256': value['rom']['sha256'],
                'cheap_guard_passed': result['qualification']['native_abi_and_preservation'],
                'intended_edit_witness': {'changes': result['changes'], 'lock': result['lock'],
                                          'receipt': result['build_receipt']},
                'native_build_report': result}

    def experiment(artifact, context):
        from tools.playtester.experiment import experiment_native_candidate
        from .quality_dispatch import attach_quality
        observed = experiment_native_candidate(artifact, context)
        return attach_quality(context.report['attempts'][-1]['request'], context.config, artifact, observed, context)

    def diagnose(value, artifact, observed, context):
        result = {'schema': 'native-iteration-diagnosis/1', 'trust': 'hypothesis_only',
                'reason': observed.get('reason', 'objective_not_observed'),
                'basis': observed['evidence'], 'artifact_sha256': artifact['sha256'],
                'supported_repairs': [canonical_hash(row) for row in context.config.get('supported_requests', [])],
                'native_diagnosis': observed.get('diagnosis'),
                'scope': 'Native evidence plus bounded model repair hypothesis; never qualification or activation'}
        variants = [row for row in context.config.get('supported_requests', []) if row != value]
        if not variants or not context.config.get('model_repair_diagnosis'):
            return result
        if context.remaining()['model_calls'] < 1:
            result['reason'] = 'diagnosis_model_budget_exhausted'
            return result
        from tools.playtester.models import ChatPolicy
        profile = json.loads(Path(context.config['experiment']['profile']['path']).read_text())
        native = observed.get('diagnosis') or {}
        observation = {'frame': native.get('frame', 0), 'facts': native, 'progress': {}}
        model_context = {'run_id': context.config['run_id'], 'game_id': profile['game_id'],
            'game_version': artifact['sha256'], 'adapter_version': context.config['adapter_version'],
            'observation': observation, 'memory': {'state_visits': {}, 'recent_transitions': []},
            'objective': 'Diagnose the observed native result against the declared objective. Select an exact reviewed source repair only when current source event evidence causally supports it; STOP otherwise. No arbitrary code or proof claims.',
            'declared_objective': profile['objective'], 'current_request': value,
            'reviewed_variants': variants}
        options = [{'id': canonical_hash(row), 'description': row.get('intent', 'Reviewed exact source variation')} for row in variants]
        response = ChatPolicy.from_env().choose(model_context, options,
            min(context.remaining()['wall_seconds'], context.config['experiment'].get('model_timeout', 10)))
        result['model'] = response
        result['usage'] = {'model_calls': 1, 'native_frames': 0, 'cost_usd': None}
        recommendation = {'reason': response.get('reason'), 'evidence': observed['evidence']}
        if response.get('accepted') and response.get('action_id') in {row['id'] for row in options}:
            recommendation['recommended_variant_sha256'] = response['action_id']
        result['native_diagnosis'] = recommendation
        path = context.output / ('diagnosis-%d.json' % len(context.report['attempts']))
        _write(path, result)
        result['model_evidence'] = file_ref(path)
        return result

    def repair(value, diagnosis, context):
        # Selection is constrained to exact pre-admitted variants; model text is
        # never executable code, an import, arbitrary shell, or proof.
        variants = context.config.get('supported_requests', [])
        recommendation = diagnosis.get('native_diagnosis') or {}
        selected = recommendation.get('recommended_variant_sha256')
        variant = next((row for row in variants if canonical_hash(row) == selected), None)
        if (variant is not None and recommendation.get('reason') and recommendation.get('evidence')
                and all(verify_file_ref(ref) for ref in recommendation['evidence'])):
            return {'request': variant, 'basis': diagnosis, 'selection': 'evidence_linked_diagnosis_recommendation'}
        return {'blocked': True, 'reason': 'no_evidence_linked_supported_repair',
                'repair_task': {'diagnosis': diagnosis, 'allowed_variant_sha256': [canonical_hash(row) for row in variants],
                                'required': 'Causal diagnosis with observed evidence and an exact supported variant recommendation'}}

    return IterationStages(admit, build, experiment, diagnose, repair)


def prepare_iteration_config(request, template, new_run_id):
    """Prepare a fresh pinned config without compiling or contacting a provider.

    Request source/ROM/strategy pins remain strict. Refreshing a template's
    reviewed mechanism paths and experiment inputs is explicit in the returned
    manifest. Limits are copied verbatim; old resume/cache lineage is removed.
    """
    from .native_mod import ROOT, validate_native_mod_request
    if not isinstance(new_run_id, str) or not new_run_id.strip():
        raise IterationError('new_run_id_required')
    if new_run_id == template.get('run_id'):
        raise IterationError('fresh_run_requires_new_identity')
    reference_operation = request.get('schema') == 'native-artifact-traversal-request/1'
    if reference_operation:
        from .artifact_reference import validate_artifact_reference
        validate_artifact_reference(request, template)
        inspected = {}
    else:
        inspected = validate_native_mod_request(request)
    variants = template.get('supported_requests', [])
    if not isinstance(variants, list):
        raise IterationError('invalid_supported_requests')
    supported = [copy.deepcopy(request)]
    for variant in variants:
        if reference_operation:
            if variant != request:
                raise IterationError('prebuilt_artifact_repair_unsupported')
            continue
        validate_native_mod_request(variant)
        if variant.get('rom') != request.get('rom'):
            raise IterationError('repair_variant_base_rom_mismatch')
        if variant not in supported:
            supported.append(copy.deepcopy(variant))
    config = copy.deepcopy(template)
    manifest = []

    def checked_path(path):
        actual = (ROOT / path).resolve()
        try:
            actual.relative_to(ROOT)
        except ValueError as error:
            raise IterationError('template_pin_outside_workspace') from error
        if not actual.is_file():
            raise IterationError('template_pin_file_unavailable')
        return actual

    def refresh(field, old):
        if not isinstance(old, dict) or not isinstance(old.get('path'), str):
            raise IterationError('invalid_template_pin_' + field)
        actual = checked_path(old['path'])
        updated = file_ref(actual)
        manifest.append({'field': field, 'path': str(actual), 'before_sha256': old.get('sha256'),
                         'after_sha256': updated['sha256'], 'changed': old.get('sha256') != updated['sha256']})
        return updated

    # The caller's explicitly declared mechanism paths remain reviewable, rather
    # than scanning/importing arbitrary modules or guessing undeclared inputs.
    mechanisms = {str(checked_path(row['path'])): row for row in template.get('mechanism_refs', [])}
    required = [Path(__file__)]
    authority = template.get('runtime_manifest')
    manifest_ref = None
    if authority:
        manifest_path = checked_path(authority['path'])
        inventory = json.loads(manifest_path.read_text())
        rows = [row for row in inventory.get('files', []) if authority['recipe_id'] in row.get('recipes', [])]
        if authority.get('version_basis') == 'recipe-readset/1':
            rows = [row for row in rows if row['path'] not in (authority['path'], 'contracts/improvement-profile-registry.json')]
        if not rows:
            raise IterationError('reviewed_runtime_recipe_missing')
        mechanisms = {}
        for row in rows:
            actual = checked_path(row['path'])
            ref = {'path': str(actual), 'sha256': row['sha256']}
            if not verify_file_ref(ref):
                raise IterationError('reviewed_runtime_manifest_input_changed')
            mechanisms[str(actual)] = ref
        if str(Path(__file__).resolve()) not in mechanisms:
            raise IterationError('reviewed_runtime_manifest_missing_runner')
        manifest_ref = file_ref(manifest_path)
        if authority.get('version_basis') == 'recipe-readset/1':
            files = sorted(({"path": path, "sha256": sha} for path, sha in {row['path']: row['sha256'] for row in rows}.items()), key=lambda row: row['path'])
            readset = {'schema': 'gameverse.runtime-readset/1', 'recipe_id': authority['recipe_id'], 'files': files}
            config['runtime_readset_pin'] = {**readset, 'sha256': canonical_hash(readset)}
        else:
            mechanisms[str(manifest_path)] = manifest_ref
    registration = inspected.get('lowering')
    if registration:
        required.append(registration['lowerer_path'])
    if reference_operation:
        required.append(ROOT/'tools/prefab_pipeline/artifact_reference.py')
    else:
        plan_pin = request['plan']
        plan_path = ROOT / plan_pin['path']
        baseline = json.loads(plan_path.read_text())
        host = baseline['native_build']['host']
        host_pin = {'path': host['ref'], 'sha256': host['sha256']}
        if not verify_file_ref(host_pin, ROOT):
            raise IterationError('derived_host_pin_mismatch')
        required.extend([plan_path, ROOT/host['ref']])
    for path in required:
        actual = checked_path(path)
        if authority and authority.get('version_basis') == 'recipe-readset/1' and str(actual) not in mechanisms:
            raise IterationError('reviewed_runtime_manifest_missing_dependency')
        mechanisms.setdefault(str(actual), {'path': str(actual), 'sha256': None})
    config['mechanism_refs'] = [refresh('mechanism_refs', row) for row in mechanisms.values()]
    old_runner = {'path': str(Path(__file__)), 'sha256': template.get('mechanism_sha256')}
    config['mechanism_sha256'] = refresh('mechanism_sha256', old_runner)['sha256']
    for name in ('profile', 'memory_profile', 'fixture_recipe'):
        config['experiment'][name] = refresh('experiment.' + name, template['experiment'][name])
    config['experiment']['policy_ref'] = refresh('experiment.policy_ref',
        template['experiment'].get('policy_ref', {'path': str(ROOT/'tools/playtester/models.py')}))
    removed = [key for key in ('cached_build_report', 'initial_checkpoint', 'retry_of', 'repair_of', 'checkpoint') if key in config]
    for key in removed:
        config.pop(key)
    config.pop('preparation', None)
    config.pop('template_status', None)
    config.update(run_id=new_run_id, loop_config_ref='prepared:' + new_run_id,
                  source_commit=subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True).strip(),
                  base_rom_sha256=request['source_rom' if reference_operation else 'rom']['sha256'], supported_requests=supported)
    if manifest_ref:
        config['runtime_manifest_pin'] = manifest_ref
    config['preparation'] = {'schema': 'prefab-iteration-preparation/1', 'template_sha256': canonical_hash(template),
        'template_run_id': template.get('run_id'), 'template_config_ref': template.get('loop_config_ref'),
        'request_sha256': canonical_hash(request), 'refreshed_pins': manifest,
        'removed_resume_fields': removed, 'limits_preserved': config['limits'] == template['limits'],
        'execution': 'none; no build or provider calls'}
    _validate(config)
    return config


def prepare_continuation_config(prior_report_ref, template, new_run_id):
    """Explicit new-process chunk; exact artifact/state/context, no silent replay."""
    if not verify_file_ref(prior_report_ref):
        raise IterationError('prior_report_pin_mismatch')
    prior = json.loads(Path(prior_report_ref['path']).read_text())
    if prior.get('status') in ('running', 'cancelled', 'interrupted') or not prior.get('usage_complete'):
        raise IterationError('continuation_usage_or_lifecycle_unknown')
    if prior.get('reason') == 'interrupted_stage_usage_unknown':
        raise IterationError('continuation_usage_or_lifecycle_unknown')
    artifact, checkpoint = prior.get('artifact', {}), prior.get('checkpoint')
    if not verify_file_ref(artifact) or not checkpoint_compatible(checkpoint, artifact, prior['config']):
        raise IterationError('continuation_artifact_or_checkpoint_mismatch')
    if not checkpoint.get('learning_context') or not verify_file_ref(checkpoint['learning_context']):
        raise IterationError('continuation_learning_context_required')
    request = prior.get('final_request')
    if not isinstance(request, dict) or not verify_file_ref(prior.get('build_report')):
        raise IterationError('continuation_final_request_build_report_required')
    prepared = prepare_iteration_config(request, template, new_run_id)
    if (prepared['adapter_version'] != prior['config']['adapter_version']
            or prepared['environment_version'] != prior['config']['environment_version']):
        raise IterationError('continuation_environment_mismatch')
    for key in ('profile', 'memory_profile', 'fixture_recipe'):
        if prepared['experiment'][key]['sha256'] != prior['config']['experiment'][key]['sha256']:
            raise IterationError('continuation_experiment_pin_mismatch')
    if prepared['experiment'].get('models') != prior['config']['experiment'].get('models'):
        raise IterationError('continuation_model_identity_mismatch')
    prepared['initial_checkpoint'] = checkpoint
    if request.get('schema') == 'native-artifact-traversal-request/1':
        prepared['artifact_reference_parent'] = prior['build_report']
    else:
        prepared['cached_build_report'] = prior['build_report']
    prepared['pause_after_experiment'] = False
    prepared['continuation_request'] = request
    prepared['continuation'] = {'schema': 'prefab-iteration-continuation/1', 'prior_report': prior_report_ref,
        'prior_run_id': prior['run_id'], 'prior_usage': prior['usage'],
        'artifact_sha256': artifact['sha256'], 'mode': 'new bounded chunk from exact native and model context',
        'budget_accounting': 'Prior usage retained separately; this chunk uses the registered template limits unchanged.'}
    _validate(prepared)
    return prepared
