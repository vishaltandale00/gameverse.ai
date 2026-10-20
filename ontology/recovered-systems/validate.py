#!/usr/bin/env python3
"""Check source identity and normalized pointer fidelity without runtime work."""
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import sys
import time
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]

def validate():
    start = time.perf_counter()
    data = json.loads((ROOT / 'ontology/recovered-systems/index.json').read_text())
    ids = set()
    facts = edges = 0
    for system in data['systems']:
        assert system['id'] not in ids, system['id']
        ids.add(system['id'])
        assert system['executable'] is False and system['complete'] is False
        assert system['readiness'] == ('static' if system['recordKind'] == 'prior-source-analysis' else 'source-backed-system')
        if system['recordKind'] == 'source-system-contract':
            assert system['state'] and system['callOrder'], (system['id'], 'missing state/order contract')
            assert system['sourceEvidence'], (system['id'], 'missing source evidence')
            assert system['sourceFacts'].get('authored_wrapper') is not True
        source = system['provenance'][0]
        path = ROOT / source['ref']
        assert hashlib.sha256(path.read_bytes()).hexdigest() == source['sha256'], path
        original = json.loads(path.read_text())
        assert original == system['sourceFacts'], path
        for field, values in system.items():
            if not isinstance(values, list):
                continue
            for fact in values:
                if not isinstance(fact, dict) or 'value' not in fact:
                    continue
                node = original
                for token in fact['provenance']['pointer'].split('/')[1:]:
                    token = token.replace('~1', '/').replace('~0', '~')
                    node = node[int(token)] if isinstance(node, list) else node[token]
                assert node == fact['value'], (system['id'], field)
                facts += 1
        for edge in system['graph']['edges']:
            assert edge['executable'] is False
            assert str(edge['from']) in {n['id'] for n in system['graph']['nodes']}
            assert str(edge['to']) in {n['id'] for n in system['graph']['nodes']}
            edges += 1
    assert data['counts']['recoveredExecutableL2'] == 0
    assert data['counts']['analysisRecords'] == len(ids)
    assert data['counts']['completeGames'] == 0
    games = {g['gameId'] for g in data['games']}
    assert len(games) == data['counts']['originalGames']
    assert all(s['gameId'] in games for s in data['systems'])
    components = 0
    for game in data['games']:
        for component in game['automaticComponents']:
            path = ROOT / component['provenance']['ref']
            assert hashlib.sha256(path.read_bytes()).hexdigest() == component['provenance']['sha256']
            assert json.loads(path.read_text()) == component['contract']
            assert component['contract']['source_game'] == game['gameId']
            components += 1
    assert components == data['counts']['automaticComponentPackages']
    return {'outcome': 'pass', 'analysisRecords': len(ids), 'pointerFacts': facts, 'explicitEdges': edges,
            'automaticContracts': components,
            'wallSeconds': time.perf_counter() - start,
            'scope': 'Source hashes, exact JSON pointers, identity/counts/readiness only; no semantic, native or gameplay qualification',
            'queueSeconds': None, 'buildSeconds': None, 'simulationSeconds': None}

if __name__ == '__main__':
    result = validate()
    try:
        commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    except (OSError, subprocess.CalledProcessError):
        commit = None
    result['context'] = {
        'runId': 'ontology-integrity-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ'),
        'sourceCommit': commit,
        'sourceState': 'Workspace snapshot; script and index hashes identify uncommitted changes.',
        'indexSha256': hashlib.sha256((ROOT / 'ontology/recovered-systems/index.json').read_bytes()).hexdigest(),
        'validatorSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'ingesterSha256': hashlib.sha256((ROOT / 'ontology/recovered-systems/ingest.py').read_bytes()).hexdigest(),
        'sourceManifestSha256': hashlib.sha256((ROOT / 'ontology/recovered-systems/additional-sources.json').read_bytes()).hexdigest(),
        'python': sys.version.split()[0], 'machine': platform.platform(),
        'adapter': 'not-invoked', 'loop': 'not-invoked',
        'timing': 'wallSeconds covers validation only; context collection/report serialization excluded; no overlapping execution stages.'
    }
    if '--report' in sys.argv:
        (ROOT / 'ontology/recovered-systems/verification.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))
