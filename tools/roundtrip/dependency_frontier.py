"""Mine retained IR dependency evidence without building or executing a cartridge.

Extends the existing ir-prefab graph; addresses and ownership never imply semantics.
Static SSA edges and optional observed bot evidence remain distinct.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import time


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def pin(path):
    path = Path(path).resolve()
    return {"path": str(path), "sha256": digest(path)}


def address(value):
    if isinstance(value, int):
        return value
    return int(value, 16)


def read(path):
    return json.loads(Path(path).read_text())


def mine(report_path, baseline_path=None, parent_l0=(), observations=()):
    started = time.perf_counter()
    report_path = Path(report_path).resolve()
    directory = report_path.parent
    report = read(report_path)
    graph_path = directory / 'prefab-graph.json'
    graph = read(graph_path)
    manifest_path = Path(baseline_path).resolve() if baseline_path else directory / 'manifest.json'
    manifest = read(manifest_path)
    if report['original_sha256'] != manifest['original']['sha256']:
        raise ValueError('Original ROM version mismatch between provider and manifest')
    inputs = [pin(report_path), pin(graph_path), pin(manifest_path)]
    components = {c['id']: c for c in graph['components']}
    targets = {address(c['original_entry']): c['id'] for c in graph['components']}
    for edge in graph.get('dependencies', []):
        for key in ('from', 'to'):
            if edge[key] != 'opaque-host' and edge[key] not in components:
                raise ValueError('Dangling prefab dependency: ' + edge[key])
    bodies, seed_bodies, retained_services, edges, dynamic = [], [], [], [], []
    base = manifest.get('address_base', 0x08000000)

    def ownership(entry):
        return [{"id": c['id'], "version": c.get('version'), "stratum": c['stratum'],
                 "source": c.get('contract', {}).get('source'),
                 "source_sha256": c.get('contract', {}).get('source_sha256'),
                 "object": c.get('contract', {}).get('object')}
                for c in manifest['components']
                if c['offset'] <= entry-base < c['offset']+c['size']]

    def scan(label, l0, adapter, evidence):
        nodes = {n['id']: n for n in l0['varnodes']}
        assumptions = adapter.get('assumptions', [])
        returns = {a.get('return_pc') for a in assumptions
                   if a.get('kind') == 'rom_proven_incoming_lr_return'}
        switches = {s['pc']: s for a in assumptions for s in a.get('internal_switches', [])}
        for block in l0['blocks']:
            for op in block['ops']:
                code = op['opcode']
                if code not in ('CALL', 'CALLIND', 'BRANCHIND'):
                    continue
                node = nodes.get(op.get('inputs', [None])[0], {})
                target = None
                if code == 'CALL' and node.get('space') in ('ram', 'const'):
                    target = int(node['offset'], 0) if str(node['offset']).startswith('0x') else int(node['offset'])
                if target is not None:
                    edges.append({"from": label, "to": targets.get(target), "target": f'{target:08x}',
                                  "native_pc": op['pc'], "kind": 'source-call',
                                  "status": 'resolved' if target in targets else 'unknown',
                                  "resolution_scope": ('retained-native-service-open' if components[targets[target]].get('implementation') == 'preserved_native_opaque' else 'inlined-dependency-only' if components[targets[target]].get('inlined_dependency') else 'included-generated-body') if target in targets else 'preserved-native-target',
                                  "evidence_kind": 'static-machine-SSA', "evidence": evidence,
                                  "target_ownership": ownership(target)})
                else:
                    proof = 'proven-incoming-return' if op['pc'] in returns else 'proven-internal-switch' if op['pc'] in switches else None
                    dynamic.append({"from": label, "native_pc": op['pc'], "opcode": code,
                                    "status": 'resolved-control-transfer' if proof else 'unknown',
                                    "resolution": proof, "evidence_kind": 'static-machine-SSA',
                                    "evidence": evidence,
                                    "reason": 'Bounded producer assumption retained; not a whole-host proof' if proof else 'Indirect target set not established by retained evidence'})

    for label, component in components.items():
        if component.get('implementation') == 'preserved_native_opaque':
            retained_services.append(dict(component, proof_scope='Native-only service contract; ABI/effects closure remains open; no regenerated implementation'))
            continue
        seed = label in report.get('dependency_seeds', {})
        module = report.get('dependency_seeds', {})[label] if seed else report['modules'][label]
        ir_reference = component.get('portable_ir', component.get('native_bound_ir'))
        l1path = directory/ir_reference['path']
        l0path = l1path.with_name('l0.json')
        expected_l0 = module.get('l0_sha256')
        file_checks = [(l1path, module['l1_sha256'])]
        if expected_l0:
            file_checks.append((l0path, expected_l0))
        else:
            inputs.append(pin(l0path))
        for path, expected in file_checks:
            if digest(path) != expected:
                # Provider records original package L0 bytes, then rewrites JSON.
                root = Path(__file__).resolve().parents[2]
                override = report.get('profile', {}).get('l0_paths', {}).get(label)
                package_root = report.get('profile', {}).get('package_roots', {}).get(module.get('package'))
                original_l0 = root/override if override else root/package_root/'l0.json' if package_root else root/'local/ir/packages'/module.get('package', '__unavailable__')/'l0.json'
                if path != l0path or not original_l0.exists() or digest(original_l0) != expected or read(original_l0) != read(l0path):
                    raise ValueError('IR version mismatch: ' + str(path))
                inputs.append(pin(original_l0))
            inputs.append(pin(path))
        if ir_reference['sha256'] != module['l1_sha256']:
            raise ValueError('Graph/module IR version mismatch: ' + label)
        entry = address(component['original_entry'])
        l1 = read(l1path)
        body = dict(component)
        body.update(source_ownership=ownership(entry), original_entry_address_retained=True,
                    generated_body_pin=pin(l1path), limitations=l1.get('limitations', []),
                    producer_assumptions=module['adapter'].get('assumptions', []))
        body.update(installed=not seed, inlined_dependency=seed,
                    l0_producer_pin_available=expected_l0 is not None)
        (seed_bodies if seed else bodies).append(body)
        scan(label, read(l0path), module['adapter'], pin(l0path))
    parents = []
    for path in parent_l0:
        path = Path(path).resolve()
        l0 = read(path)
        entry = address(l0['entry'])
        label = 'native:' + f'{entry:08x}'
        inputs.append(pin(path))
        parents.append({"id": label, "entry": f'{entry:08x}', "source_ownership": ownership(entry),
                        "generated": False, "source_rom_identity": 'unverified-parent-input', "evidence": pin(path)})
        scan(label, l0, {}, pin(path))
    storage = {}
    for body in bodies + seed_bodies:
        for field in body.get('state_fields', []):
            # Global fields use absolute offset; argument fields retain owner identity.
            key = (field.get('owner'), field.get('argument'), field.get('address'),
                   field.get('offset'), field.get('width'))
            storage.setdefault(('field',) + key, []).append({'component': body['id'], 'name': field.get('name')})
        for collection in body.get('state_collections', []):
            key = ('collection', collection.get('address'), collection.get('count'), collection.get('size'))
            storage.setdefault(key, []).append({'component': body['id'], 'name': collection.get('name')})
    aliases = [{'storage_key': list(key), 'users': users, 'basis': 'Exact retained storage tuple equality; lifetime and alias completeness unproved'}
               for key, users in storage.items() if len({u['component'] for u in users}) > 1]
    observed = []
    for path in observations:
        inputs.append(pin(path))
        observed.append({"evidence": pin(path), "evidence_kind": 'observed-only',
                         "record": read(path),
                         "claim_scope": 'Observation retained as a gap signal; does not resolve static dependencies or prove absence of unobserved calls'})
    parent_by_entry = {p['entry']: p for p in parents}
    for edge in edges:
        if edge['target'] in parent_by_entry:
            edge['target_source_body'] = parent_by_entry[edge['target']]['evidence']
            edge['resolution_scope'] = 'supplied-native-SSA-body-still-preserved'
    external_targets = sorted({e['target'] for e in edges if e['status'] == 'unknown'})
    closure_queue = [{"target": target,
                      "static_incoming_sites": sum(e['target'] == target for e in edges),
                      "source_body_available": target in parent_by_entry,
                      "generated": False, "closure_gain": None,
                      "effort_seconds": None,
                      "evidence": [e['evidence'] for e in edges if e['target'] == target]}
                     for target in external_targets]
    closure_queue.sort(key=lambda item: (-item['static_incoming_sites'], item['target']))
    unknown_edges = [e for e in edges if e['status'] == 'unknown']
    unknown_dynamic = [e for e in dynamic if e['status'] == 'unknown']
    blockers = list(graph.get('unknowns', []))
    blockers += [e.get('reason', 'Open retained host dependency') for e in graph.get('dependencies', []) if e.get('closure') == 'open']
    if unknown_edges: blockers.append('Static native call targets outside included generated bodies')
    if unknown_dynamic: blockers.append('Unresolved indirect control transfers in retained SSA')
    try:
        commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    except (subprocess.SubprocessError, FileNotFoundError):
        commit = None
    return {"schema": 'gameverse.dependency-frontier/1', "id": graph['id'] + '.frontier',
            "extends": {"schema": graph['schema'], **pin(graph_path)},
            "original_sha256": report['original_sha256'], "rebuilt_sha256": report['rebuilt_sha256'],
            "source_commit": report.get('source_commit'), "miner_commit": commit,
            "inputs": inputs, "included_generated_bodies": bodies, "inlined_dependency_bodies": seed_bodies,
            "retained_native_services": retained_services, "source_calls": edges,
            "indirect_control_transfers": dynamic, "parents": parents,
            "canonical_storage_aliases": aliases,
            "miner": pin(Path(__file__)),
            "host_dependencies": graph.get('dependencies', []),
            "source_context": graph.get("source_context", {}),
            "state_lifecycle": graph.get("state_lifecycle", {}),
            "lifecycle": graph.get('lifecycle'), "storage_authority": graph.get('storage_authority'),
            "profile_open_dependencies": report.get('profile', {}).get('open_dependencies', []),
            "observations": observed,
            "candidate_group": {"roots": [b["id"] for b in bodies],
                "basis": 'Existing provider group, pinned source ownership and canonical state/lifecycle links; no name-derived gameplay labels',
                "closure": 'open', "reuse_blockers": sorted(set(blockers)),
                "next_work": {"known_external_call_targets": sorted({e['target'] for e in unknown_edges}),
                    "known_parent_consumers": sorted({e['from'] for e in edges if e['from'].startswith('native:') and e['status']=='resolved'}),
                    "unresolved_indirect_sites": len(unknown_dynamic),
                    "closure_cost_seconds": None,
                    "cost_reason": 'No measured implementation or proof cost; target/site counts are evidence, not effort estimates'}},
            "coverage": {"scope": 'Only supplied retained modules and optional parent SSA; not whole-ROM call graph',
                         "complete_dependency_graph": False, "assets_complete": False,
                         "source_bytes_regenerated": None,
                         "source_bytes_reason": 'Generated output bytes do not measure source span semantic coverage',
                         "generated_behavior_output_bytes": report.get('generated_behavior_function_bytes'),
                         "installed_generated_body_count": len(bodies), "inlined_only_body_count": len(seed_bodies),
                         "retained_native_service_count": len(retained_services),
                         "resolved_static_calls": len(edges)-len(unknown_edges), "unknown_static_calls": len(unknown_edges)},
            "closure_queue": closure_queue,
            "queue_basis": "Static incoming call-site fanout only; closure gain and effort unmeasured; not semantic priority",
            "proof_scope": 'Declared original identity consistency and retained IR content pins checked; actual ROM bytes and producer proof validity not independently verified; map ownership is scaffolding; no native proof rerun, semantic certificate or whole-game closure admitted',
            "timing": {"total_seconds": time.perf_counter()-started, "queue_seconds": None,
                       "build_seconds": None, "native_seconds": None, "machine": platform.platform(),
                       "python": platform.python_version(), "mode": 'retained-static-evidence-only'}}


def validate_profile_frontier(profile, root=None):
    """Consume an optional profile pin as discovery input, never as proof authority."""
    reference = profile.get('dependency_frontier')
    if reference is None:
        return None
    root = Path(root) if root else Path(__file__).resolve().parents[2]
    path = Path(reference['path'])
    if not path.is_absolute():
        path = root/path
    if digest(path) != reference['sha256']:
        raise ValueError('Dependency frontier pin mismatch')
    frontier = read(path)
    if frontier.get('schema') != 'gameverse.dependency-frontier/1':
        raise ValueError('Unsupported dependency frontier schema')
    if frontier['original_sha256'] != profile['original_sha256']:
        raise ValueError('Dependency frontier ROM version mismatch')
    return {'frontier': pin(path), 'role': 'pinned-discovery-context',
            'semantic_closure_admitted': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--baseline', type=Path)
    parser.add_argument('--parent-l0', type=Path, action='append', default=[])
    parser.add_argument('--observations', type=Path, action='append', default=[])
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = mine(args.report, args.baseline, args.parent_l0, args.observations)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x') as out:
        json.dump(result, out, indent=2, sort_keys=True)
        out.write('\n')
    print(json.dumps({'output': str(args.output), 'coverage': result['coverage'], 'timing': result['timing']}))


if __name__ == '__main__':
    main()
