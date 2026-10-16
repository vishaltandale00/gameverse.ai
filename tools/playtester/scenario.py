"""Source-fact milestone graphs for native traversal; no action-count objectives."""
from __future__ import annotations
import copy
from tools.prefab_pipeline.contract import canonical_hash

VERSION = 'native-scenario-graph/1'


def validate(spec):
    if spec.get('schema') != VERSION or not isinstance(spec.get('id'), str):
        raise ValueError('invalid_native_scenario')
    nodes = spec.get('nodes')
    if not isinstance(nodes, list) or not 1 <= len(nodes) <= 128:
        raise ValueError('invalid_native_scenario_nodes')
    seen = set()
    for node in nodes:
        if not isinstance(node.get('id'), str) or node['id'] in seen:
            raise ValueError('duplicate_native_scenario_node')
        if not isinstance(node.get('after', []), list) or not set(node.get('after', [])).issubset(seen):
            raise ValueError('native_scenario_dependency_order')
        conditions = node.get('conditions')
        if not isinstance(conditions, list) or not 1 <= len(conditions) <= 16:
            raise ValueError('invalid_native_scenario_conditions')
        for row in conditions:
            if (not isinstance(row.get('field'), str) or row.get('op') not in ('eq', 'ge', 'le', 'mask_all')
                    or type(row.get('value')) not in (int, float, bool)):
                raise ValueError('invalid_native_scenario_predicate')
            if row['op'] == 'mask_all' and (type(row['value']) is not int or row['value'] < 0):
                raise ValueError('invalid_native_scenario_mask')
        seen.add(node['id'])
    if not isinstance(spec.get('goals'), list) or not spec['goals'] or not set(spec['goals']).issubset(seen):
        raise ValueError('invalid_native_scenario_goals')
    return spec


def matches(facts, row):
    value = facts
    for part in row['field'].split('.'):
        if not isinstance(value, dict) or part not in value:
            return False
        value = value[part]
    expected = row['value']
    if type(value) not in (int, float, bool):
        return False
    operation = row['op']
    if operation == 'eq': return value == expected
    if operation == 'ge': return value >= expected
    if operation == 'le': return value <= expected
    return type(value) is int and value & expected == expected


class ScenarioAdapter:
    def __init__(self, adapter, spec, prior=None):
        self.adapter = adapter
        self.spec = copy.deepcopy(validate(spec))
        self.identity = canonical_hash(spec)
        self.reached = {}
        if prior:
            if prior.get('scenario_sha256') != self.identity:
                raise ValueError('scenario_checkpoint_identity_mismatch')
            allowed = {node['id'] for node in self.spec['nodes']}
            if not set(prior.get('reached', {})).issubset(allowed):
                raise ValueError('scenario_checkpoint_unknown_node')
            self.reached = copy.deepcopy(prior.get('reached', {}))
        self.objective_witness = None
        self.checkpoints = {}

    def __getattr__(self, name): return getattr(self.adapter, name)

    def observe(self):
        observation = copy.deepcopy(self.adapter.observe())
        facts = observation.get('facts', {})
        for node in self.spec['nodes']:
            if (node['id'] not in self.reached and all(parent in self.reached for parent in node.get('after', []))
                    and all(matches(facts, row) for row in node['conditions'])):
                self.reached[node['id']] = {'frame': observation['frame'], 'facts': copy.deepcopy(facts),
                    'conditions': copy.deepcopy(node['conditions'])}
        goal = all(key in self.reached for key in self.spec['goals'])
        progress = {'scenario_id': self.spec['id'], 'reached': list(self.reached),
                    'goals': self.spec['goals'], 'complete': goal}
        observation.setdefault('facts', {})['scenario_progress'] = progress
        observation.setdefault('progress', {})['scenario_nodes'] = len(self.reached)
        base_failure = observation.get('terminal') is True and observation.get('success') is not True
        if not goal and observation.get('terminal') is True and observation.get('success') is True:
            observation['facts']['inner_objective_observed'] = True
            observation.update(terminal=False, success=False)
        if goal:
            self.objective_witness = {'scenario_id': self.spec['id'], 'scenario_sha256': self.identity,
                'observed_predicate': self.spec.get('objective', self.spec['id']),
                'nodes': copy.deepcopy(self.reached), 'source_scope': self.spec.get('scope')}
            if not base_failure:
                observation.update(terminal=True, success=True)
            observation['facts']['objective_witness'] = copy.deepcopy(self.objective_witness)
        return observation

    def checkpoint(self):
        result = self.adapter.checkpoint()
        if result.get('scenario_state') is not None:
            result['native_adapter_scenario_state'] = copy.deepcopy(result['scenario_state'])
        result['scenario_state'] = {'scenario_sha256': self.identity, 'reached': copy.deepcopy(self.reached)}
        if result.get('checkpoint'):
            self.checkpoints[result['checkpoint']] = copy.deepcopy(self.reached)
        return result

    def restore(self, token):
        if token not in self.checkpoints:
            raise ValueError('scenario_checkpoint_token_unknown')
        result = self.adapter.restore(token)
        self.reached = copy.deepcopy(self.checkpoints[token])
        self.objective_witness = None
        return result
