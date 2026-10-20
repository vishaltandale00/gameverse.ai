"""Fresh bounded source-SSA lift of MZM's complete primary Morph Ball controller.

No ROM installation or authored donor gameplay C. Native spawn services remain
explicitly OPEN, source-pinned boundaries. Run only after the shared compiler and
service specification have been finalized for this attempt.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
ROM = ROOT / 'local/game-builds/mzm-us-baseline/mzm_us.gba'
CAPTURE = ROOT / 'local/roundtrip/mzm-behavior-swap-20261016/l0'
ROM_SHA256 = 'fc94f65380b65b870a30b9b04b39cca1dc63d6e46a4a373d3904adc0912ebc37'
TARGETS = (('init', '08013080'), ('get', '0801312c'), ('flash', '080131a0'), ('dispatch', '08013270'))


def digest(data):
    return hashlib.sha256(data).hexdigest()


def pin(path):
    path = Path(path).resolve()
    return {'path': str(path.relative_to(ROOT)), 'sha256': digest(path.read_bytes())}


def save(path, data):
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + '\n')


def compiler_pins():
    paths = sorted((ROOT/'tools/behavior_ir').glob('*.py'))
    paths += sorted((ROOT/'tools/behavior_ir').glob('*.in'))
    paths += [Path(__file__), ROOT/'tools/roundtrip/retained_services.py', ROOT/'tools/roundtrip/ir_provider.py']
    return [pin(p) for p in paths]


def run(specification, output):
    """Specification has exact services map and evidence {sha256:workspace_path}."""
    started = time.perf_counter()
    specification, output = Path(specification).resolve(), Path(output).resolve()
    if not specification.is_relative_to(ROOT) or not output.is_relative_to(ROOT):
        raise ValueError('source specification and output must remain in workspace')
    output.mkdir(parents=True, exist_ok=False)
    initial = compiler_pins()
    snapshots=[]
    for source_pin in initial:
        source=ROOT/source_pin['path']
        retained=output/'compiler-runtime'/'sources'/source_pin['path']
        retained.parent.mkdir(parents=True,exist_ok=True)
        retained.write_bytes(source.read_bytes())
        if digest(retained.read_bytes()) != source_pin['sha256']:
            raise ValueError('compiler changed while capturing input sources')
        snapshots.append({'original':source_pin,'retained':pin(retained)})
    report = {'schema':'gameverse.mzm-primary-acquisition-source-lift/1',
              'outcome':'running', 'run_id':output.name,
              'source_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
              'loop_config':'four original roots; sequential source lift; no native execution',
              'specification':pin(specification),
              'rom':pin(ROM), 'machine':platform.platform(),
              'compiler_inputs':initial, 'compiler_source_snapshots':snapshots, 'attempts':[], 'queue_s':None,
              'scope':'Full original primary Init/Get/Flash/dispatcher control and state; explicitly retained native spawn services remain OPEN',
              'native_parity':'separate proof required; no native execution in this source lift',
              'not_claimed':['portable service closure','native playback','whole-game equivalence','cross-game save migration']}
    save(output/'receipt.json', report)
    try:
        raw = ROM.read_bytes()
        if len(raw) != 8388608 or digest(raw) != ROM_SHA256:
            raise ValueError('exact original MZM 8MiB baseline required')
        (output/'specification.input.json').write_bytes(specification.read_bytes())
        report['specification_retained_exact_input']=pin(output/'specification.input.json')
        spec = json.loads(specification.read_text())
        if set(spec) - {'resource_references'} != {'services','evidence'} or not isinstance(spec['services'],dict) or not isinstance(spec['evidence'],dict) or not isinstance(spec.get('resource_references',[]),list):
            raise ValueError('specification needs services/evidence maps and optional resource_references list')
        evidence = {}
        for expected, name in spec['evidence'].items():
            source=(ROOT/name).resolve()
            if not source.is_relative_to(ROOT) or not source.is_file() or digest(source.read_bytes()) != expected:
                raise ValueError('source service evidence identity mismatch')
            evidence[expected] = source.read_bytes()
        report['service_evidence'] = [pin((ROOT/name).resolve()) for name in spec['evidence'].values()]
        save(output/'specification.json', spec)
        sys.path.insert(0, str(ROOT/'tools/behavior_ir'))
        from lift import Lifter
        from lower import lower
        from contract import validate
        from tools.roundtrip.retained_services import NativeServiceEmitter
        dependencies = {}
        for label,entry in TARGETS:
            stage_started=time.perf_counter()
            directory=output/label
            directory.mkdir()
            source=CAPTURE/(entry+'.json')
            row={'label':label,'entry':entry,'l0':pin(source)}
            try:
                l0=json.loads(source.read_text())
                if l0['entry'] != entry:
                    raise ValueError('L0 source root identity mismatch')
                (directory/'l0.json').write_bytes(source.read_bytes())
                behavior,adapter=Lifter(l0,raw,dependencies,
                    retained_services=spec['services'],service_evidence=evidence,
                    resource_references=spec.get('resource_references',[])).build()
                save(directory/'l1.json',behavior)
                save(directory/'validation-adapter.json',adapter)
                validate(behavior)
                dependencies[entry]=(behavior,adapter)
                artifacts=['l0.json','l1.json','validation-adapter.json']
                if behavior.get('resource_references'):
                    # The source lift owns symbolic IR, not a native resource
                    # codec. Its caller must select the authenticated host codec.
                    row['native_binding_emission']='not-attempted-requires-explicit-resource-codec'
                else:
                    emitter=NativeServiceEmitter(behavior,adapter,raw,evidence) if behavior.get('retained_services') else None
                    code=lower(behavior,native_service_emitter=emitter) if emitter else lower(behavior)
                    (directory/'generated.c').write_text(code)
                    artifacts.append('generated.c')
                    row['native_binding_emission']='intermediate-only-no-native-qualification'
                row.update(outcome='static-pass',fields=len(adapter['fields']),collections=len(adapter.get('collections',[])),
                           services=len(adapter.get('retained_services',[])),resources=len(adapter.get('resource_references',[])),
                           artifacts=[pin(directory/name)for name in artifacts])
            except Exception as error:
                row.update(outcome='blocked',error=str(error),error_type=type(error).__name__)
            row['wall_s']=time.perf_counter()-stage_started
            report['attempts'].append(row)
            save(output/'receipt.json',report)
        if not all(row['outcome']=='static-pass' for row in report['attempts']):
            raise ValueError('full source cluster remains blocked; retained per-root diagnostics')
        final=compiler_pins()
        if initial != final:
            report['compiler_inputs_after']=final
            raise ValueError('compiler inputs changed during source lift; no stable-input success claimed')
        report.update(outcome='pass',full_primary_roots=4,
                      dispatch_artifacts={name:pin(output/'dispatch'/name) for name in ('l0.json','l1.json','validation-adapter.json')},
                      native_binding_emission='Explicit resource codec/projection belongs to the separate native host recipe',
                      semantic_closure='OPEN explicit native host services',compiler_inputs_stable=True)
    except Exception as error:
        report.update(outcome='blocked',error=str(error),error_type=type(error).__name__)
    finally:
        report['wall_s']=time.perf_counter()-started
        report['stages_nested_in_total']=True
        save(output/'receipt.json',report)
    return report


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--specification',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    result=run(args.specification,args.output)
    print(json.dumps(result,indent=2))
    raise SystemExit(0 if result['outcome']=='pass' else 2)
