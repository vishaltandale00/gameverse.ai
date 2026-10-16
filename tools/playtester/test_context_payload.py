"""Payload regressions: preserve decisions while eliminating repeated snapshots."""
import copy
import json
import unittest

from tools.decisions import DecisionClient, ProviderConfig
from tools.decisions.client import WireResponse, to_wire
from .models import DecisionPolicy, MODEL_CONTEXT_SCHEMA, evidence_context, progress_delta


def undo_delta(after, delta):
    """Independent reverse replay verifies unchanged fields and absent/null state."""
    before = copy.deepcopy(after)
    for key, change in delta.items():
        if 'fields' in change:
            before[key] = undo_delta(before[key], change['fields'])
        elif change['before_present']:
            before[key] = change['before']
        else:
            before.pop(key, None)
    return before


class PayloadTests(unittest.TestCase):
    def fixture(self):
        options = [{'id': 'poi:one', 'description': 'Talk to guide at (4,7)', 'frames': 600,
                    'target': {'label': 'Guide', 'script': 'GuideScript', 'local_id': 4}},
                   {'id': 'poi:two', 'description': 'Read sign at (5,7)', 'frames': 600,
                    'target': {'label': 'Sign', 'script': 'SignScript', 'local_id': 5}}]
        before = {'story': {'quest': 1, 'resource': 75}, 'text': 'old message', 'menu': None, 'x': 4}
        after = {'story': {'quest': 2, 'resource': 75}, 'text': 'new message', 'added': None, 'x': 4}
        context = {'run_id': 'r', 'game_id': 'g', 'objective': 'Continue the quest', 'step': 7,
                   'awareness': {'perspective': 'top_down', 'locomotion': 'tile_rpg'},
                   'observation': {'frame': 90, 'state_key': 'current', 'phase': 'overworld',
                       'facts': {'HP': 15, 'story': after['story'], 'source_pois': [a['target'] for a in options],
                                 'source_objective': 'Find the next crew member', 'uncertainty': 'route unverified'},
                       'progress': after, 'options': options},
                   'memory': {'recent_transitions': [{'from': 'old', 'to': 'current', 'action_id': 'poi:one',
                       'before_progress': before, 'after_progress': after, 'unchanged': False}],
                       'state_visits': {'old': 1, 'current': 2}, 'action_attempts': {'poi:one': 2},
                       'barrier_candidates': [{'state_key': 'old', 'action_id': 'poi:one',
                                               'attempts_without_progress': 2, 'unknowns': ['locked door']}],
                       'system2_plan': {'hypothesis': 'Try the other route'}}}
        return context, options

    def test_semantics_history_and_input_immutability(self):
        context, options = self.fixture()
        original = copy.deepcopy(context)
        compact = evidence_context(context, options)
        self.assertEqual(context, original)
        self.assertEqual(compact['observation']['facts'], context['observation']['facts'])
        self.assertEqual(compact['observation']['progress'], context['observation']['progress'])
        self.assertNotIn('options', compact['observation'])
        for action in options:
            metadata = compact['observation']['option_metadata'][action['id']]
            restored = dict(metadata['fields'], id=action['id'], description=action['description'])
            if 'target_source_poi_index' in metadata:
                restored['target'] = compact['observation']['facts']['source_pois'][metadata['target_source_poi_index']]
            self.assertEqual(restored, action)
        self.assertEqual(compact['memory']['action_attempts'], context['memory']['action_attempts'])
        self.assertEqual(compact['memory']['barrier_candidates'], context['memory']['barrier_candidates'])
        transition = compact['memory']['recent_transitions'][0]
        self.assertFalse(transition['progress_unchanged'])
        self.assertEqual(transition['progress_baseline'], context['memory']['recent_transitions'][0]['before_progress'])
        self.assertEqual(undo_delta(context['observation']['progress'], transition['progress_delta']),
                         context['memory']['recent_transitions'][0]['before_progress'])
        self.assertIn('unchanged', compact['memory']['transition_encoding']['meaning'])
        self.assertEqual(compact['model_context_schema'], MODEL_CONTEXT_SCHEMA)

    def test_unchanged_empty_nested_and_null_presence(self):
        cases = [({}, {}), ({'a': {}}, {'a': {'b': None}}), ({'a': None}, {}),
                 ({'a': [1, 2]}, {'a': [2, 1]}), ({'a': 1}, {'a': 1}),
                 ({'a': True}, {'a': 1}), ({'a': [True]}, {'a': [1]}), ({'a': 1}, {'a': 1.0})]
        for before, after in cases:
            with self.subTest(before=before, after=after):
                self.assertEqual(json.dumps(undo_delta(after, progress_delta(before, after))), json.dumps(before))
        context, options = self.fixture()
        row = context['memory']['recent_transitions'][0]
        row['after_progress'] = copy.deepcopy(row['before_progress'])
        compact = evidence_context(context, options)
        self.assertTrue(compact['memory']['recent_transitions'][0]['progress_unchanged'])
        self.assertEqual(compact['memory']['recent_transitions'][0]['progress_delta'], {})

    def test_nonduplicated_action_arguments_and_discontinuous_history(self):
        context, options = self.fixture()
        options[0].update(input_key='A', cursor_address=1234, interaction_args={'facing': 'north'})
        options[0]['target'] = dict(options[0]['target'], unique_source_arg=17)
        first = context['memory']['recent_transitions'][0]
        second = dict(first, before_progress={'story': {'quest': 9}}, after_progress={'story': {'quest': 10}})
        context['memory']['recent_transitions'].append(second)
        context['observation']['progress'] = {'story': {'quest': 11}}
        compact = evidence_context(context, options)
        metadata = compact['observation']['option_metadata'][options[0]['id']]
        self.assertNotIn('target_source_poi_index', metadata)
        self.assertEqual(metadata['fields'], {k: v for k, v in options[0].items() if k not in ('id', 'description')})
        history = compact['memory']['recent_transitions']
        self.assertEqual(history[0]['progress_baseline'], first['before_progress'])
        self.assertEqual(history[1]['progress_continuity'], 'gap_anchor')
        self.assertEqual(history[1]['progress_baseline'], second['before_progress'])
        self.assertEqual(compact['observation']['progress']['story']['quest'], 11)

    def test_request_choices_order_criteria_and_safe_size_metadata(self):
        context, options = self.fixture()
        captured = {}
        def transport(url, key, body, timeout):
            captured.update(body)
            # Deliberately model a failed response: diagnostics must survive it.
            return WireResponse({})
        client = DecisionClient(ProviderConfig(api_key='secret-not-in-diagnostics'), transport=transport)
        result = DecisionPolicy(client=client).choose(context, options, 1)
        criteria = captured['questions']['action']['criteria']
        self.assertEqual(list(criteria), ['poi:one', 'poi:two', 'STOP'])
        self.assertEqual([criteria[a['id']] for a in options], [a['description'] for a in options])
        self.assertFalse(result['accepted'])
        sizes = result['record']['input_size']
        self.assertEqual(sizes['wire_bytes'], len(json.dumps(captured, allow_nan=False).encode()))
        self.assertEqual(sizes['state_utf8_bytes'], len(captured['state'].encode()))
        self.assertEqual(sizes['choice_counts']['action'], 3)
        self.assertNotIn('secret-not-in-diagnostics', json.dumps(result))
        self.assertEqual(result['record']['context']['input_descriptor']['schema'], MODEL_CONTEXT_SCHEMA)

    def test_repeated_full_progress_is_not_sent_six_times(self):
        context, options = self.fixture()
        story = {f'source_flag_{i}': i for i in range(64)}
        context['observation']['progress']['story'] = story
        transitions = []
        for i in range(6):
            transitions.append({'from': str(i), 'to': str(i+1), 'action_id': 'poi:one',
                'before_progress': {'story': story, 'x': i}, 'after_progress': {'story': story, 'x': i+1}})
        context['memory']['recent_transitions'] = transitions
        before = len(json.dumps(transitions).encode())
        after = len(json.dumps(evidence_context(context, options)['memory']['recent_transitions']).encode())
        self.assertLess(after, before / 2)
        self.assertEqual(evidence_context(context, options)['observation']['progress']['story'], story)


if __name__ == '__main__':
    unittest.main()
