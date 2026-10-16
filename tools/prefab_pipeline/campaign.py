"""Finite, durable native campaigns over exact-state iteration chunks.

No request-selected imports or commands. Optional stages_factory is trusted Python
injection, like IterationStages; production uses the registered native stages.
"""
from __future__ import annotations

import copy
from datetime import datetime, timedelta, timezone
import json
import math
from pathlib import Path
import time

from .contract import canonical_hash, file_ref, verify_file_ref
from .iteration import (IterationError, IterationStages, _write, default_stages,
                        prepare_continuation_config, prepare_iteration_config, run_iteration)

VERSION = 'prefab-campaign/1'


class CampaignError(ValueError):
    pass


class _BoundaryCancellation(KeyboardInterrupt):
    """Known zero consumption: invoked before entering a registered stage."""


def _validate(config):
    if config.get('schema') != VERSION:
        raise CampaignError('unsupported_campaign_schema')
    if not isinstance(config.get('run_id'), str) or not config['run_id'].strip():
        raise CampaignError('campaign_run_id_required')
    limits = config.get('limits', {})
    for key in ('chunks', 'repairs', 'model_calls', 'native_frames', 'wall_seconds'):
        value = limits.get(key)
        if (type(value) not in (int, float) or not math.isfinite(value)
                or value < (0 if key == 'repairs' else 1)
                or (key != 'wall_seconds' and type(value) is not int)):
            raise CampaignError('invalid_campaign_limit_' + key)
    cost = limits.get('cost_usd')
    if 'cost_usd' not in limits or (cost is not None and (
            type(cost) not in (int, float) or not math.isfinite(cost) or cost <= 0)):
        raise CampaignError('explicit_nullable_campaign_cost_limit_required')
    canonical_hash(config)


def run_campaign(request, template, campaign_config, output_dir, *, resume=False,
                 stages_factory=None):
    """Chain bounded native chunks until observed goal, cancellation or finite cap.

    Campaign limits are cumulative; template limits bound each chunk. Repairs are
    exact registered variants only. Deadline includes downtime across resume.
    Remove cancel.request before resuming a cancelled campaign. Unknown in-flight
    consumption is blocked and never retried. Terminal success/budget/blocked
    reports are idempotent. A chunk cap is a partial result, never goal proof.
    Optional config.initial_report_ref explicitly adopts a pinned completed prefix;
    its calls, frames, repairs, chunk and execution time consume campaign limits.
    """
    _validate(campaign_config)
    request, template, config = map(copy.deepcopy, (request, template, campaign_config))
    output = Path(output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    path, cancel = output/'campaign.json', output/'cancel.request'
    identity = canonical_hash({'request': request, 'template': template, 'campaign_config': config})
    now = datetime.now(timezone.utc)
    if path.exists():
        report = json.loads(path.read_text())
        if report['input_sha256'] != identity:
            raise CampaignError('resume_input_identity_mismatch')
        if not resume:
            raise CampaignError('existing_campaign_requires_resume')
        if report['status'] not in ('running', 'cancelled'):
            return report
        if report['status'] == 'cancelled' and cancel.exists():
            return report
        report.update(status='running', reason='resumed')
    else:
        report = {'schema': VERSION, 'run_id': config['run_id'], 'request_id': request.get('request_id'),
                  'input_sha256': identity, 'request': request, 'template': template, 'config': config,
                  'status': 'running', 'reason': 'started', 'started_utc': now.isoformat(),
                  'goal_profile': template.get('experiment', {}).get('profile'),
                  'deadline_utc': (now + timedelta(seconds=config['limits']['wall_seconds'])).isoformat(),
                  'chunks': [], 'usage': {'model_calls': 0, 'native_frames': 0, 'cost_usd': 0., 'repairs': 0},
                  'usage_complete': True, 'queue_seconds': None, 'total_wall_seconds': 0.,
                  'active_wall_seconds': 0., 'retained_prefix_wall_seconds': 0., 'activation': 'never_performed',
                  'qualification': {'native_objective': 'pending', 'whole_campaign': 'untested'},
                  'timing_note': 'Elapsed wall includes resume downtime. Active wall includes child stages; child build/native setup/action/policy timings are nested, not added. Queue unavailable.'}
    began = time.monotonic()
    active_before = report['active_wall_seconds']
    limits = config['limits']
    deadline = datetime.fromisoformat(report['deadline_utc'])

    def save():
        report['active_wall_seconds'] = round(active_before + time.monotonic() - began, 6)
        report['total_wall_seconds'] = report.get('retained_prefix_wall_seconds', 0.) + max(0., (datetime.now(timezone.utc) - datetime.fromisoformat(report['started_utc'])).total_seconds())
        _write(path, report)

    def settle(row, child, receipt=None):
        # A receipt is accounted exactly once, including crash after child finish.
        row.update(status='completed', report=receipt or file_ref(Path(row['output'])/'iteration.json'),
                   outcome=child['status'], reason=child.get('reason'), usage=child['usage'],
                   wall_seconds=child.get('total_wall_seconds'), repairs=len(child.get('repairs', [])))
        for key in ('model_calls', 'native_frames'):
            report['usage'][key] += child['usage'][key]
        cost = child['usage'].get('cost_usd')
        report['usage']['cost_usd'] = None if cost is None or report['usage']['cost_usd'] is None else report['usage']['cost_usd'] + cost
        report['usage']['repairs'] += row['repairs']
        report['usage_complete'] = bool(child.get('usage_complete'))
        report['latest_iteration'] = row['report']
        if child.get('artifact'):
            report['artifact'] = child['artifact']
        save()

    def evaluate(child):
        if not child.get('usage_complete') or child.get('reason') == 'interrupted_stage_usage_unknown':
            report.update(status='blocked', reason='interrupted_stage_usage_unknown', usage_complete=False)
            return False
        for key in ('model_calls', 'native_frames', 'repairs'):
            if report['usage'][key] > limits[key]:
                report.update(status='blocked', reason='child_exceeded_campaign_' + key)
                return False
        if limits['cost_usd'] is not None and (report['usage']['cost_usd'] is None or report['usage']['cost_usd'] > limits['cost_usd']):
            report.update(status='blocked', reason='campaign_cost_budget_unverifiable_or_exceeded')
            return False
        if child['status'] == 'success':
            witness = child.get('objective_witness', {})
            if (witness.get('source') != 'native-observation' or not witness.get('observed_predicate')
                    or witness.get('artifact_sha256') != child.get('artifact', {}).get('sha256')
                    or not witness.get('evidence') or not all(verify_file_ref(ref) for ref in witness['evidence'])):
                report.update(status='blocked', reason='native_objective_witness_required')
                return False
            report['objective_witness'] = witness
            report['qualification']['native_objective'] = 'observed'
            if datetime.now(timezone.utc) >= deadline:
                report.update(status='partial', reason='campaign_wall_seconds_budget_exhausted')
                return False
            report.update(status='success', reason='native_objective_observed')
            return False
        experiments = [row.get('result', {}) for row in child.get('stages', [])
                       if row.get('name') == 'experiment' and row.get('status') == 'completed']
        if experiments and experiments[-1].get('success') is not True:
            experiment_reason = experiments[-1].get('reason')
            resource_reasons = {'step_limit', 'frame_limit', 'remaining_frame_budget_too_small',
                                'wall_time_limit', 'model_call_limit', 'decision_limit'}
            if experiment_reason not in resource_reasons:
                report.update(status='blocked', reason='experiment_' + str(experiment_reason or 'reason_unavailable'))
                return False
        if child.get('reason') == 'campaign_cancel_requested':
            report.update(status='cancelled', reason='cancel_requested')
            return False
        if child.get('reason') not in ('attempt_budget_exhausted', 'experiment_budget_exhausted',
                                      'awaiting_explicit_continuation', 'no_supported_repair', 'wall_budget'):
            report.update(status='blocked', reason='child_' + child.get('reason', 'failed'))
            return False
        return True

    save()
    try:
        prefix_ref = config.get('initial_report_ref')
        if prefix_ref and not report['chunks']:
            if not verify_file_ref(prefix_ref):
                raise CampaignError('initial_report_pin_mismatch')
            prefix = json.loads(Path(prefix_ref['path']).read_text())
            if (prefix.get('input_sha256') != canonical_hash({'request': prefix.get('request'), 'config': prefix.get('config')})
                    or prefix.get('status') in ('running', 'cancelled', 'interrupted')
                    or not prefix.get('usage_complete')):
                raise CampaignError('initial_report_identity_or_usage_unknown')
            if prefix.get('request') != request:
                raise CampaignError('initial_report_request_identity_mismatch')
            for key in ('model_calls', 'native_frames'):
                value = prefix.get('usage', {}).get(key)
                if type(value) is not int or value < 0:
                    raise CampaignError('initial_report_invalid_usage_' + key)
            prefix_wall = prefix.get('total_wall_seconds')
            if type(prefix_wall) not in (int, float) or not math.isfinite(prefix_wall) or prefix_wall < 0:
                raise CampaignError('initial_report_wall_usage_unavailable')
            prepare_continuation_config(prefix_ref, template, config['run_id'] + '-prefix-validation', campaign_resource_transition=True)
            # The explicit new campaign adopts immutable receipts; the gap before
            # adoption is not execution. Retained prefix work consumes its caps.
            report['retained_prefix_wall_seconds'] = prefix_wall
            active_before += prefix_wall
            deadline -= timedelta(seconds=prefix_wall)
            report['deadline_utc'] = deadline.isoformat()
            row = {'number': 1, 'origin': 'retained-prefix', 'status': 'running',
                   'output': str(Path(prefix_ref['path']).resolve().parent),
                   'request': prefix['request'], 'config': prefix['config']}
            report['chunks'].append(row)
            # No intermediate save: adoption + usage are one atomic receipt.
            settle(row, prefix, copy.deepcopy(prefix_ref))
            if not evaluate(prefix):
                return report
        # Persisted pending config lets us inspect the same child after a crash;
        # never start an unaccounted replacement process/provider operation.
        pending = next((row for row in report['chunks'] if row['status'] == 'running'), None)
        if pending:
            child_path = Path(pending['output'])/'iteration.json'
            if not child_path.exists():
                report.update(status='blocked', reason='interrupted_chunk_usage_unknown', usage_complete=False)
                return report
            child = json.loads(child_path.read_text())
            expected_identity = canonical_hash({'request': pending.get('request'), 'config': pending.get('config')})
            if (child.get('request') != pending.get('request') or child.get('config') != pending.get('config')
                    or child.get('input_sha256') != expected_identity):
                report.update(status='blocked', reason='pending_child_identity_mismatch', usage_complete=False)
                return report
            if child.get('status') == 'running':
                child.update(status='blocked', reason='interrupted_stage_usage_unknown', usage_complete=False)
                _write(child_path, child)
            settle(pending, child)
            if not evaluate(child):
                return report
        while True:
            if cancel.exists():
                report.update(status='cancelled', reason='cancel_requested')
                break
            remaining_wall = (deadline - datetime.now(timezone.utc)).total_seconds()
            exhausted = next((key for key in ('model_calls', 'native_frames') if report['usage'][key] >= limits[key]), None)
            if len(report['chunks']) >= limits['chunks'] or exhausted or remaining_wall <= 0:
                report.update(status='partial', reason='campaign_' + (exhausted or ('wall_seconds' if remaining_wall <= 0 else 'chunks')) + '_budget_exhausted')
                break
            chunk_template = copy.deepcopy(template)
            chunk_limits = chunk_template['limits']
            for key in ('model_calls', 'native_frames'):
                chunk_limits[key] = min(chunk_limits[key], limits[key] - report['usage'][key])
            chunk_limits['attempts'] = min(chunk_limits['attempts'], 1 + limits['repairs'] - report['usage']['repairs'])
            chunk_limits['wall_seconds'] = min(chunk_limits['wall_seconds'], remaining_wall)
            chunk_limits['cost_usd'] = limits['cost_usd'] if limits['cost_usd'] is not None else chunk_limits.get('cost_usd')
            if chunk_limits['cost_usd'] is not None:
                # Native provider has no enforceable dollar ceiling; fail before spend.
                report.update(status='blocked', reason='cost_budget_unverifiable')
                break
            number = len(report['chunks']) + 1
            run_id = config['run_id'] + '-chunk-%04d' % number
            prior_ref = report.get('latest_iteration')
            if prior_ref:
                if not verify_file_ref(prior_ref):
                    raise CampaignError('prior_report_pin_mismatch')
                prior = json.loads(Path(prior_ref['path']).read_text())
                # A cooperative cancellation before the first experiment has no
                # native/model state to restore. Its known receipts still count.
                if (prior.get('reason') == 'campaign_cancel_requested'
                        and prior.get('usage_complete') and not prior.get('checkpoint')
                        and not any(row['name'] == 'experiment' and row['status'] == 'completed'
                                    for row in prior.get('stages', []))):
                    inherited = prior.get('config', {}).get('initial_checkpoint')
                    if inherited:
                        retained = prior.get('config', {}).get('continuation', {}).get('prior_report')
                        if not verify_file_ref(retained):
                            raise CampaignError('cancelled_child_checkpoint_parent_pin_mismatch')
                        parent = json.loads(Path(retained['path']).read_text())
                        if (parent.get('checkpoint') != inherited
                                or parent.get('final_request') != prior.get('request')
                                or (prior.get('artifact') and prior['artifact'].get('sha256')
                                    != inherited.get('artifact_sha256'))):
                            raise CampaignError('cancelled_child_checkpoint_parent_identity_mismatch')
                        # Cancelled work still consumes a row and its measured
                        # resources; only state lineage comes from its parent.
                        prior_ref = retained
                    else:
                        prior_ref = None
            if prior_ref:
                child_config = prepare_continuation_config(prior_ref, chunk_template, run_id, campaign_resource_transition=True)
                child_request = child_config['continuation_request']
            else:
                child_config = prepare_iteration_config(request, chunk_template, run_id)
                child_request = request
            # Existing iteration's pause bypasses success verification; campaigns
            # always let the experiment witness be evaluated before chaining.
            child_config['pause_after_experiment'] = False
            remaining_wall = (deadline - datetime.now(timezone.utc)).total_seconds()
            if remaining_wall <= 0:
                report.update(status='partial', reason='campaign_wall_seconds_budget_exhausted')
                break
            child_config['limits']['wall_seconds'] = min(child_config['limits']['wall_seconds'], remaining_wall)
            child_output = output/('chunk-%04d' % number)
            row = {'number': number, 'status': 'running', 'output': str(child_output),
                   'request': child_request, 'config': child_config}
            report['chunks'].append(row)
            save()
            stages = (stages_factory or default_stages)(child_request, child_config)
            boundary_cancelled = []

            def guard(call):
                def wrapped(*args):
                    if cancel.exists():
                        boundary_cancelled.append(True)
                        raise _BoundaryCancellation()
                    return call(*args)
                return wrapped

            guarded = IterationStages(*(guard(getattr(stages, name)) for name in ('admit', 'build', 'experiment', 'diagnose', 'repair')))
            child = run_iteration(child_request, child_config, child_output, guarded)
            if boundary_cancelled:
                # The wrapper stopped BEFORE calling the stage, so its unknown
                # receipt is provably zero. Actual interrupted callbacks stay unknown.
                child.update(status='artifact-built-with-diagnostics' if child.get('artifact') else 'partial',
                             reason='campaign_cancel_requested', usage_complete=True,
                             unreported_usage_stages=[], experiment_outcome='partial')
                child['cancellation_basis'] = 'sentinel checked before registered stage; cancelled stage consumed zero'
                _write(child_output/'iteration.json', child)
            settle(row, child)
            if not evaluate(child):
                break
    except (KeyboardInterrupt, SystemExit):
        report.update(status='blocked', reason='interrupted_chunk_usage_unknown', usage_complete=False)
    except Exception as error:
        report.update(status='blocked', reason=str(error) if isinstance(error, (CampaignError, IterationError)) else 'campaign_exception', error_type=type(error).__name__)
    finally:
        save()
    return report


def main(argv=None):
    """Explicitly invoked qualification command; never part of routine CI."""
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('request', 'template', 'config', 'output'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--resume', action='store_true')
    args = parser.parse_args(argv)
    request, template, config = (json.loads(Path(value).read_text())
                                 for value in (args.request, args.template, args.config))
    result = run_campaign(request, template, config, args.output, resume=args.resume)
    print(json.dumps({'status': result['status'], 'reason': result['reason'],
                      'usage': result['usage'], 'report': str(Path(args.output).resolve()/'campaign.json')}))
    return 0 if result['status'] in ('success', 'partial', 'cancelled') else 1


if __name__ == '__main__':
    raise SystemExit(main())
