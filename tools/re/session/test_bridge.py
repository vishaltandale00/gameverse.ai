"""Explicit real-ROM integration check; not part of routine network/CI work.

SESSION_TEST_ROM=/absolute/game.gba python3 -m unittest tools.re.session.test_bridge
Build the native worker first. No model calls or player saves are used.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


@unittest.skipUnless(os.environ.get('SESSION_TEST_ROM'), 'requires explicit local ROM')
class SessionIntegration(unittest.TestCase):
    def test_checkpoint_replay_and_input_limits(self):
        with tempfile.TemporaryDirectory() as temporary:
            worker = subprocess.Popen(['python3', '-B', 'tools/re/session/bridge.py', '--rom',
                                       os.environ['SESSION_TEST_ROM'], '--out', str(Path(temporary) / 'session')],
                                      stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
            counter = 0
            def request(op, **fields):
                nonlocal counter
                counter += 1
                identity = str(counter)
                worker.stdin.write(json.dumps(dict(id=identity, op=op, **fields)) + '\n')
                worker.stdin.flush()
                reply = json.loads(worker.stdout.readline())
                self.assertEqual(reply['id'], identity)
                return reply
            try:
                hello = request('hello')['result']
                self.assertTrue(hello['isolated'])
                self.assertIn('restore', hello['capabilities'])
                self.assertTrue(request('act', action={'keys': ['START'], 'frames': 60})['ok'])
                saved = request('checkpoint')['result']
                initial = request('observe')['result']
                request('act', action={'keys': ['A'], 'frames': 30})
                first = request('observe')['result']
                self.assertTrue(request('restore', checkpoint=saved['checkpoint'])['ok'])
                restored = request('observe')['result']
                self.assertEqual(restored['evidence']['image_sha256'], initial['evidence']['image_sha256'])
                request('act', action={'keys': ['A'], 'frames': 30})
                replay = request('observe')['result']
                self.assertEqual(replay['evidence']['image_sha256'], first['evidence']['image_sha256'])
                self.assertEqual(replay['frame'], 90)
                self.assertFalse(request('act', action={'keys': ['RIGHT'], 'frames': 121})['ok'])
                self.assertFalse(request('act', action={'keys': ['INVALID'], 'frames': 1})['ok'])
                self.assertEqual(request('observe')['result']['frame'], 90)
                self.assertFalse(request('restore', checkpoint='foreign-session-token')['ok'])
                request('close')
                self.assertEqual(worker.wait(timeout=3), 0)
            finally:
                if worker.poll() is None:
                    worker.kill(); worker.wait(timeout=3)
                worker.stdin.close(); worker.stdout.close()


if __name__ == '__main__':
    unittest.main()
