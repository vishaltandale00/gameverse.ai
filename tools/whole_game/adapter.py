"""Trusted JSONL adapter for a verified pair of complete source engines."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

from tools.re.session.bridge import NativeSession
from .elf_symbols import symbol
from .pipeline import ROOT, check_pin, verify_manifest
from .session import CompositionSession, SourceBridge


def create(manifest_path, output, binary, *, initial_states=None, resume_checkpoint=None, observation_profile=None):
    manifest = verify_manifest(json.loads(Path(manifest_path).read_text()))
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    profiles, engines = {}, {}
    initial_states = initial_states or {}
    if initial_states:
        raise ValueError('composition_requires_paired_pinned_checkpoint_use_resume_checkpoint')
    try:
        for source in manifest['sources']:
            region = source['id']
            elf = check_pin(source['elf'])
            rom = check_pin(source['rom'])
            address, size = symbol(elf, 'gWholeGameBridge')
            if size != 648:
                raise ValueError('unsupported_source_mailbox_size')
            profile = {'rom_sha256': source['rom']['sha256'],
                       'elf': {'path': str(elf), 'sha256': source['elf']['sha256']},
                       'address': address, 'bytes': size}
            profiles[region] = profile
            engines[region] = NativeSession(rom, output / region, binary,
                                           initial_state=initial_states.get(region), mailbox_profile=profile)
        bridge = SourceBridge(profiles, initialized_regions={'emerald'})
        session = CompositionSession(engines, bridge, manifest, output)
        if resume_checkpoint:
            session.restore_path(Path(resume_checkpoint))
        if observation_profile:
            from .observations import SourceObserver
            session = ObservedComposition(session, SourceObserver(observation_profile, manifest))
        return session
    except BaseException:
        for engine in engines.values():
            engine.close()
        raise


class ObservedComposition:
    """Read current restored RAM under an independently pinned fact schema."""
    def __init__(self, session, observer):
        self.session, self.observer = session, observer
    def __getattr__(self, key):
        return getattr(self.session, key)
    def hello(self):
        return dict(self.session.hello(), observation_schema=self.observer.schema,
                    observation_profile_sha256=self.observer.sha256,
                    observation_implementation_sha256=self.observer.implementation_sha256, observation_implementation_files=self.observer.implementation_files)
    def observe(self):
        return self.observer.enrich(self.session, self.session.observe())


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--manifest', type=Path, required=True)
    ap.add_argument('--out', type=Path, required=True)
    ap.add_argument('--binary', type=Path, default=ROOT / 'tools/re/session/build/gba-session')
    ap.add_argument('--observation-profile', type=Path, help='Exact ROM/ELF-pinned read-only source fact schema')
    ap.add_argument('--resume-checkpoint', type=Path, help='Exact-bundle portable composition checkpoint directory')
    ap.add_argument('--emerald-state', type=Path)
    ap.add_argument('--firered-state', type=Path)
    args = ap.parse_args()
    states = {region: path for region, path in [('emerald', args.emerald_state), ('firered', args.firered_state)] if path}
    session = create(args.manifest, args.out, args.binary, initial_states=states, resume_checkpoint=args.resume_checkpoint, observation_profile=args.observation_profile)
    try:
        for raw in sys.stdin.buffer:
            identity = None
            close = False
            try:
                if len(raw) > 65536:
                    raise ValueError('request_size_limit')
                request = json.loads(raw)
                identity = request.get('id')
                op = request.get('op')
                if op == 'hello':
                    result = session.hello()
                elif op == 'observe':
                    result = session.observe()
                elif op == 'act':
                    result = session.act(request['action'], request.get('max_frames'))
                elif op == 'checkpoint':
                    result = session.checkpoint()
                elif op == 'restore':
                    result = session.restore(request['checkpoint'])
                elif op == 'close':
                    result, close = {}, True
                else:
                    raise ValueError('unsupported_operation')
                response = {'id': identity, 'ok': True, 'result': result}
            except Exception:
                response = {'id': identity, 'ok': False, 'error': 'invalid_request_or_composition_failure'}
            print(json.dumps(response), flush=True)
            if close:
                break
    finally:
        session.close()


if __name__ == '__main__':
    main()
