import contextlib
import io
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

from .__main__ import main


class ProfileCLI(unittest.TestCase):
    def test_profile_prepares_and_runs_same_request(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request, template = root/'request.json', root/'template.json'
            request.write_text('{"request_id":"r"}')
            template.write_text('{"profile":"reviewed"}')
            def prepare(value, profile, run_id):
                self.assertEqual((value['request_id'], profile['profile'], run_id), ('r', 'reviewed', 'run'))
                return {'run_id': run_id}
            def run(value, config, output, resume=False):
                self.assertEqual(value['request_id'], 'r')
                self.assertEqual(json.loads((output/'prepared-config.json').read_text()), config)
                return {'status': 'budget', 'run_id': config['run_id']}
            module = types.SimpleNamespace(prepare_iteration_config=prepare, run_iteration=run)
            with patch.dict('sys.modules', {'tools.prefab_pipeline.iteration': module}), contextlib.redirect_stdout(io.StringIO()):
                code = main(['run-profile','--request',str(request),'--template',str(template),'--run-id','run','--output-dir',str(root/'run'),'--output',str(root/'result.json')])
            self.assertEqual(code, 2)
            self.assertEqual(json.loads((root/'result.json').read_text())['status'], 'budget')

    def test_continuation_uses_helper_verified_request(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            template = root/'template.json'; template.write_text('{}')
            def prepare(prior, profile, run_id):
                self.assertEqual(prior['sha256'], 'a'*64)
                return {'run_id': run_id, 'continuation_request': {'request_id': 'final-repair'}}
            def run(request, config, output, resume=False):
                self.assertEqual(request['request_id'], 'final-repair')
                self.assertNotIn('continuation_request', config)
                return {'status': 'qualified'}
            module = types.SimpleNamespace(prepare_continuation_config=prepare, run_iteration=run)
            with patch.dict('sys.modules', {'tools.prefab_pipeline.iteration': module}), contextlib.redirect_stdout(io.StringIO()):
                code = main(['continue-profile','--prior-report',str(root/'prior.json'),'--prior-report-sha256','a'*64,'--template',str(template),'--run-id','run','--output-dir',str(root/'run'),'--output',str(root/'result.json')])
            self.assertEqual(code, 0)

    def test_preparation_never_overwrites_existing_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request = root/'request.json'; request.write_text('{}')
            output = root/'output.json'; output.write_text('preserved')
            module = types.SimpleNamespace(prepare_iteration_config=lambda *args: {})
            with patch.dict('sys.modules', {'tools.prefab_pipeline.iteration': module}), contextlib.redirect_stderr(io.StringIO()):
                code = main(['prepare-iteration','--request',str(request),'--template',str(request),'--run-id','run','--output',str(output)])
            self.assertEqual(code, 2)
            self.assertEqual(output.read_text(), 'preserved')
