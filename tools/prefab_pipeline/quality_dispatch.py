"""Compose registered mod-quality contracts with actual retained native runs."""
from __future__ import annotations
import copy
import json
from pathlib import Path
import time
from .contract import canonical_hash, file_ref, verify_file_ref


def attach_quality(request, config, artifact, observed, context):
    started = time.monotonic()
    settings = config.get('experiment', {})
    contract = settings.get('mod_quality_ref')
    result = {'schema':'gameverse.mod-quality-dispatch/1', 'status':'unsupported',
              'reason':'paired_mod_quality_contract_not_configured',
              'native_objective_observed': observed.get('success') is True,
              'scenario_ref': settings.get('scenario_ref'), 'model_calls':0}
    if request.get('role') == 'original':
        result.update(status='not-evaluated', reason='original_baseline_only_no_candidate')
    elif contract:
        try:
            if not verify_file_ref(contract): raise ValueError('mod_quality_contract_pin_mismatch')
            from tools.playtester.mod_quality import evaluate, validate
            spec = validate(json.loads(Path(contract['path']).read_text()))
            refs = observed.get('evidence', [])
            def evidence(name):
                rows = [ref for ref in refs if Path(ref.get('path','')).name == name]
                if len(rows) != 1 or not verify_file_ref(rows[0]): raise ValueError('mod_quality_current_evidence_missing')
                return rows[0]
            report, events = evidence('report.json'), evidence('events.jsonl')
            selected = spec['candidate']; start = selected['startpoint']
            actual_source = request.get('source_revision') or 'build-input-sha256:' + canonical_hash({key:value for key,value in request.items() if key != 'request_id'})
            if selected['source_revision'] != actual_source: raise ValueError('mod_quality_current_source_revision_mismatch')
            if selected['game_version'] != artifact['sha256']: raise ValueError('mod_quality_current_artifact_mismatch')
            if start['kind'] == 'ordinary_save':
                actual_start = request.get('save', {}) if context.checkpoint is None else {}
            elif start['kind'] == 'fresh_boot':
                actual_start = artifact if context.checkpoint is None else {}
            else:
                actual_start = (context.checkpoint or {}).get('state', {})
                if not actual_start:
                    fixture = json.loads(Path(evidence('fixture.json')['path']).read_text())
                    actual_start = fixture.get('state', {})
            if start['reference'].get('sha256') != actual_start.get('sha256'):
                raise ValueError('mod_quality_actual_startpoint_mismatch')
            if spec['comparison']['inputs'] == 'mapped' and not verify_file_ref(spec['comparison']['mapping_reference']):
                raise ValueError('mod_quality_mapping_pin_mismatch')
            runs = copy.deepcopy(settings.get('mod_quality_runs', {}))
            # The current candidate always comes from this actual experiment;
            # supplied metadata cannot substitute a different candidate run.
            runs['candidate'] = {'report':report,'events':events,'source_revision':actual_source,'startpoint':start}
            result.update(evaluate(spec, runs), contract=contract)
        except (ValueError, KeyError, OSError, TypeError) as error:
            result.update(status='failed', reason='invalid_or_unbound_mod_quality_evidence', error_type=type(error).__name__)
    result['wall_seconds'] = round(time.monotonic()-started, 6)
    path = Path(context.output)/'mod-quality.json'
    path.write_text(json.dumps(result,indent=2,allow_nan=False)+'\n')
    observed['mod_quality'] = result
    observed.setdefault('evidence', []).append(file_ref(path))
    return observed
