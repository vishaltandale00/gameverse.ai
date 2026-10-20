"""Small local admission regressions; no emulator, model calls or new tools."""
import copy
import hashlib
import tempfile
import unittest
from pathlib import Path
from tools.roundtrip.contracts import (BOUNDARIES, canonical_hash, dependency_closure,
                                       substitution_errors, validate_manifest)


class ContractsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.raw = b'original component bytes'
        (self.root / 'original.bin').write_bytes(self.raw)
        self.sha = hashlib.sha256(self.raw).hexdigest()
        self.component = {'id': 'code', 'version': '1', 'offset': 0, 'size': len(self.raw),
                          'sha256': self.sha, 'stratum': 'opaque-preserved',
                          'artifact': {'path': 'original.bin', 'sha256': self.sha},
                          'provider': {'kind': 'opaque_bytes'}, 'dependencies': [],
                          'relocations': [], 'contract': {'native_abi': 'unknown'},
                          'closure': {'status': 'unknown'}}
        self.manifest = {'schema': 'gameverse.rom-roundtrip/1',
                         'original': {'sha256': self.sha, 'size': len(self.raw)},
                         'components': [self.component]}

    def candidate(self):
        return dict(copy.deepcopy(self.component), source_rom_sha256=self.sha)

    def test_unknown_identity_preserved_not_semantically_closed(self):
        self.assertEqual(validate_manifest(self.manifest, self.root), [])
        self.assertEqual(substitution_errors(self.manifest, 'code', self.candidate(), self.root), [])
        self.assertFalse(dependency_closure(self.manifest)['code']['closed'])

    def test_preservation_cannot_lie_about_original_bytes_or_length(self):
        self.component['sha256'] = '0' * 64
        self.assertTrue(validate_manifest(self.manifest, self.root))
        self.component['sha256'] = self.sha
        self.component['size'] -= 1
        self.manifest['original']['size'] -= 1
        self.assertTrue(validate_manifest(self.manifest, self.root))

    def test_original_header_cannot_be_ignored(self):
        self.component['offset'] = 1
        self.assertTrue(validate_manifest(self.manifest, self.root))

    def test_dangling_and_wrong_pin_rejected(self):
        edge = {'target': 'missing', 'sha256': self.sha, 'kind': 'call', 'status': 'resolved'}
        self.component['dependencies'] = [edge]
        self.assertTrue(validate_manifest(self.manifest, self.root))
        edge['target'] = 'code'
        edge['sha256'] = '0' * 64
        self.assertTrue(validate_manifest(self.manifest, self.root))

    def test_pinned_unknown_dependency_preserved(self):
        self.component['dependencies'] = [{'target': 'code', 'sha256': self.sha,
                                           'kind': 'dispatch', 'status': 'unknown',
                                           'reason': 'dynamic dispatch targets not resolved'}]
        self.assertEqual(validate_manifest(self.manifest, self.root), [])
        self.assertFalse(dependency_closure(self.manifest)['code']['closed'])

    def test_hierarchical_containment_and_cycle(self):
        self.manifest['prefabs'] = [{'id': 'leaf', 'components': ['code'], 'dependencies': []},
                                    {'id': 'parent', 'prefabs': ['leaf'], 'dependencies': []}]
        self.assertEqual(validate_manifest(self.manifest, self.root), [])
        self.manifest['prefabs'][0]['prefabs'] = ['parent']
        self.assertTrue(validate_manifest(self.manifest, self.root))

    def test_identity_wrong_rom_abi_state_assets_authority_rejected(self):
        for key in ('native_abi', 'state_ownership', 'asset_mode', 'authority'):
            candidate = self.candidate()
            candidate['contract'][key] = 'different'
            with self.subTest(key=key):
                self.assertTrue(substitution_errors(self.manifest, 'code', candidate, self.root))
        candidate = self.candidate()
        candidate['source_rom_sha256'] = '0' * 64
        self.assertTrue(substitution_errors(self.manifest, 'code', candidate, self.root))

    def test_same_type_size_and_claimed_pass_insufficient(self):
        candidate = self.candidate()
        (self.root / 'variant.bin').write_bytes(b'x' * len(self.raw))
        candidate['artifact'] = {'path': 'variant.bin', 'sha256': hashlib.sha256(b'x' * len(self.raw)).hexdigest()}
        candidate['proof'] = {'status': 'pass', 'scope': 'all function ports'}
        self.assertTrue(substitution_errors(self.manifest, 'code', candidate, self.root))
        self.assertTrue(substitution_errors(self.manifest, 'code', candidate, self.root,
                                            proof_verifier=lambda *args: True))

    def test_bounded_unchanged_host_keeps_semantic_closure_open(self):
        hook, host = self.raw[:4], self.raw[4:]
        (self.root / 'hook.bin').write_bytes(hook)
        (self.root / 'host.bin').write_bytes(host)
        hook_sha, host_sha = map(lambda b: hashlib.sha256(b).hexdigest(), (hook, host))
        self.component.update(size=4, sha256=hook_sha, artifact={'path': 'hook.bin', 'sha256': hook_sha},
                              contract={k: [] for k in BOUNDARIES}, closure={'status': 'closed'},
                              dependencies=[{'target': 'host', 'sha256': host_sha,
                                             'kind': 'native-host-service', 'status': 'resolved'}])
        host_component = dict(copy.deepcopy(self.component), id='host', offset=4, size=len(host),
                              sha256=host_sha, artifact={'path': 'host.bin', 'sha256': host_sha},
                              contract={'native_abi': 'unknown'}, closure={'status': 'unknown'}, dependencies=[])
        self.manifest['components'].append(host_component)
        candidate = self.candidate()
        (self.root / 'variant.bin').write_bytes(b'xxxx')
        variant_sha = hashlib.sha256(b'xxxx').hexdigest()
        candidate['artifact'] = {'path': 'variant.bin', 'sha256': variant_sha}
        prerequisite = {'target': 'host', 'version': '1', 'offset': 4, 'size': len(host),
                        'sha256': host_sha, 'artifact_sha256': host_sha,
                        'no_output_changes': True, 'relocations': []}
        candidate['proof'] = {'source_rom_sha256': self.sha, 'component_id': 'code',
                              'original_artifact_sha256': hook_sha, 'candidate_artifact_sha256': variant_sha,
                              'contract_sha256': canonical_hash(self.component['contract']),
                              'scope': {'mode': 'bounded-retained-host', 'domain': 'finite retained vectors',
                                        'unchanged_prerequisites': [prerequisite]}}
        self.assertFalse(dependency_closure(self.manifest)['code']['closed'])
        self.assertTrue(substitution_errors(self.manifest, 'code', candidate, self.root))
        # A test verifier exercises plumbing only; actual acceptance requires native replay.
        self.assertEqual(substitution_errors(self.manifest, 'code', candidate, self.root,
                                              proof_verifier=lambda *args: True), [])
        prerequisite['no_output_changes'] = False
        self.assertTrue(substitution_errors(self.manifest, 'code', candidate, self.root,
                                             proof_verifier=lambda *args: True))
        prerequisite['no_output_changes'] = True
        candidate['dependencies'][0]['status'] = 'unknown'
        self.assertTrue(substitution_errors(self.manifest, 'code', candidate, self.root,
                                             proof_verifier=lambda *args: True))

    def test_shared_builder_comparator_dependency_schema(self):
        import json
        from tools.roundtrip.extract import extract
        from tools.roundtrip.reassemble import assemble
        from tools.prefab_pipeline.reconstruction_compare import compare_reconstruction
        source = self.root / 'source.gba'
        source.write_bytes(self.raw)
        directory = self.root / 'extracted'
        manifest = extract(source, directory, 'schema-integration', chunk_bytes=8)
        first, second = manifest['components'][:2]
        first['dependencies'] = [{'target': second['id'], 'sha256': second['sha256'],
                                  'version': second['version'], 'kind': 'literal',
                                  'status': 'resolved'}]
        path = directory / 'manifest.json'
        path.write_text(json.dumps(manifest))
        self.assertEqual(validate_manifest(manifest, directory), [])
        rebuilt, layout = assemble(path)
        report = compare_reconstruction(self.raw, rebuilt, manifest, layout)
        self.assertEqual(report['validation']['errors'], [])
        self.assertFalse(dependency_closure(manifest)[first['id']]['closed'])
        first['dependencies'][0]['sha256'] = '0' * 64
        report = compare_reconstruction(self.raw, rebuilt, manifest, layout)
        self.assertTrue(report['validation']['errors'])

    def test_scoped_verified_proof_gate(self):
        self.component['closure'] = {'status': 'closed'}
        self.component['contract'] = {k: [] for k in BOUNDARIES}
        self.component['contract']['native_abi'] = {'mode': 'thumb', 'entry': 0x08000000}
        self.component['contract']['asset_mode'] = 'none'
        candidate = self.candidate()
        (self.root / 'variant.bin').write_bytes(b'x' * len(self.raw))
        candidate['artifact'] = {'path': 'variant.bin', 'sha256': hashlib.sha256(b'x' * len(self.raw)).hexdigest()}
        candidate['proof'] = {'source_rom_sha256': self.sha, 'component_id': 'code',
                              'original_artifact_sha256': self.sha,
                              'candidate_artifact_sha256': candidate['artifact']['sha256'],
                              'contract_sha256': canonical_hash(self.component['contract']),
                              'scope': {'domain': 'finite retained native vectors'}}
        self.assertTrue(substitution_errors(self.manifest, 'code', candidate, self.root))
        self.assertTrue(substitution_errors(self.manifest, 'code', candidate, self.root,
                                            proof_verifier=lambda *args: False))
        # This test double verifies delegation only, not actual semantic equivalence.
        self.assertEqual(substitution_errors(self.manifest, 'code', candidate, self.root,
                                              proof_verifier=lambda *args: True), [])


if __name__ == '__main__':
    unittest.main()
