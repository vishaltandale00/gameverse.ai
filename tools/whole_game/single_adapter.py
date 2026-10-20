"""One standalone ROM, one private native core; no engine handoff protocol."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import uuid

from tools.re.session.bridge import NativeSession
from .pipeline import ROOT, check_pin


FORMAT = 'whole-game-single-rom-state/1'


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class SingleSession:
    def __init__(self, manifest, output, binary, observer=None):
        self.manifest = manifest
        self.active = manifest['baseEngine']  # Source layout, not an engine switch.
        self.out = Path(output).resolve()
        self.out.mkdir(parents=True, exist_ok=False)
        self.observer = observer
        # Deliberately no mailbox_profile: host writes and second ROMs disabled.
        callback_profile = {'rom_sha256':manifest['artifacts']['rom']['sha256'], 'elf':{'path':str(check_pin(manifest['artifacts']['elf'])), 'sha256':manifest['artifacts']['elf']['sha256']}} if observer else None
        self.engine = NativeSession(check_pin(manifest['artifacts']['rom']), self.out/'native', binary, callback_profile=callback_profile)
        self.runtime_identity = {'native_sha256':self.engine.binary_sha256,'emulator':self.engine.emulator,
            'adapter_sha256':digest(__file__),'bridge_sha256':digest(Path(__file__).parents[1]/'re/session/bridge.py')}
        self.session_id = uuid.uuid4().hex
        self.restored = None
        self.checkpoint_dir = self.out/'checkpoints'
        self.checkpoint_dir.mkdir()

    def hello(self):
        result = {'schema_version':1,'adapter_version':'whole-game-single-rom/1','isolated':True,
                  'session_id':self.session_id,'game_id':self.manifest['gameId'],
                  'game_version':self.engine.game_version,'capabilities':['observe','act','checkpoint','restore'],
                  'max_action_frames':self.engine.max_frames,'runtime_dependencies':[],
                  'manifest_sha256':self.manifest['manifestSha256'],'runtime_identity':self.runtime_identity,
                  'execution':'one ROM in one native core; native game owns all world/party/save changes'}
        if self.observer:
            result.update(observation_schema=self.observer.schema,observation_profile_sha256=self.observer.sha256,
                          observation_implementation_sha256=self.observer.implementation_sha256, observation_implementation_files=self.observer.implementation_files)
        return result

    def observe(self):
        observation = copy.deepcopy(self.restored) if self.restored else self.engine.observe()
        if self.observer:
            observation = self.observer.enrich(self, observation)
        observation['game_artifact'] = {'rom_sha256':self.engine.game_version,'manifest_sha256':self.manifest['manifestSha256']}
        return observation

    def act(self, action, limit=None):
        receipt = self.engine.act(action, self.engine.max_frames if limit is None else limit)
        self.restored = None
        return receipt

    def checkpoint(self):
        token = uuid.uuid4().hex
        target = self.checkpoint_dir/token
        folder = self.checkpoint_dir/('.'+token+'.tmp')
        folder.mkdir()
        self.engine._command('save 31')
        state = folder/'state.ss'
        shutil.copyfile(self.engine.out/'checkpoint-31.ss',state)
        observation = self.observe()
        image = Path(observation['image'])
        shutil.copyfile(image,folder/'observation.png')
        observation['image'] = 'observation.png'
        record = {'format':FORMAT,'gameVersion':self.engine.game_version,'gameId':self.manifest['gameId'],
                  'manifestSha256':self.manifest['manifestSha256'],'runtimeIdentity':self.runtime_identity,
                  'frame':self.engine.frame,'state':{'sha256':digest(state),'bytes':state.stat().st_size},
                  'observation':observation,'imageSha256':digest(folder/'observation.png')}
        (folder/'state.json').write_text(json.dumps(record,indent=2)+'\n')
        for file in folder.iterdir():
            with file.open('rb') as stream:
                os.fsync(stream.fileno())
        os.replace(folder,target)
        descriptor = os.open(self.checkpoint_dir,os.O_RDONLY)
        try:os.fsync(descriptor)
        finally:os.close(descriptor)
        return {'checkpoint':token,'path':str(target),'frame':self.engine.frame,'game_version':self.engine.game_version}

    def restore_path(self, folder):
        folder = Path(folder).resolve()
        record = json.loads((folder/'state.json').read_text())
        if (record.get('format') != FORMAT or record.get('gameVersion') != self.engine.game_version or
                record.get('gameId') != self.manifest['gameId'] or record.get('manifestSha256') != self.manifest['manifestSha256'] or
                record.get('runtimeIdentity') != self.runtime_identity):
            raise ValueError('single_rom_checkpoint_identity_mismatch')
        if digest(folder/'state.ss') != record['state']['sha256'] or (folder/'state.ss').stat().st_size != record['state']['bytes']:
            raise ValueError('single_rom_checkpoint_state_corrupt')
        if digest(folder/'observation.png') != record['imageSha256']:
            raise ValueError('single_rom_checkpoint_image_corrupt')
        # Capture rollback before loading; restore never accepts another ROM.
        self.engine._command('save 30')
        try:
            shutil.copyfile(folder/'state.ss',self.engine.out/'checkpoint-31.ss')
            self.engine._command('load 31')
        except BaseException:
            self.engine._command('load 30')
            raise
        self.engine.frame = record['frame']
        self.restored = copy.deepcopy(record['observation'])
        self.restored['image'] = str(folder/'observation.png')
        return {'frame':self.engine.frame,'game_version':self.engine.game_version}

    def restore(self, token):
        if not isinstance(token,str) or len(token)!=32 or any(c not in '0123456789abcdef' for c in token):
            raise ValueError('invalid_checkpoint')
        return self.restore_path(self.checkpoint_dir/token)

    def close(self):
        self.engine.close()


def create(path, output, binary, *, observation_profile=None, resume_checkpoint=None):
    from .single_pipeline import verify_manifest
    manifest = verify_manifest(json.loads(Path(path).read_text()))
    observer = None
    profile_path = check_pin(manifest['observationProfile']) if manifest.get('observationProfile') else observation_profile
    if profile_path:
        from .observations import SourceObserver
        observer_manifest = {'sources':[{'id':manifest['baseEngine'], **manifest['artifacts']}]}
        observer = SourceObserver(profile_path, observer_manifest)
    session = SingleSession(manifest,output,binary,observer)
    try:
        if resume_checkpoint:
            session.restore_path(resume_checkpoint)
        return session
    except BaseException:
        session.close()
        raise


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--manifest',type=Path,required=True)
    ap.add_argument('--out',type=Path,required=True)
    ap.add_argument('--binary',type=Path,default=ROOT/'tools/re/session/build/gba-session')
    ap.add_argument('--observation-profile',type=Path)
    ap.add_argument('--resume-checkpoint',type=Path)
    args = ap.parse_args()
    session = create(args.manifest,args.out,args.binary,observation_profile=args.observation_profile,resume_checkpoint=args.resume_checkpoint)
    try:
        for raw in sys.stdin.buffer:
            identity, close = None, False
            try:
                if len(raw)>65536:raise ValueError('request_size_limit')
                request=json.loads(raw);identity=request.get('id');op=request.get('op')
                if op=='hello':result=session.hello()
                elif op=='observe':result=session.observe()
                elif op=='act':result=session.act(request['action'],request.get('max_frames'))
                elif op=='checkpoint':result=session.checkpoint()
                elif op=='restore':result=session.restore(request['checkpoint'])
                elif op=='close':result,close={},True
                else:raise ValueError('unsupported_operation')
                response={'id':identity,'ok':True,'result':result}
            except Exception:
                response={'id':identity,'ok':False,'error':'invalid_request_or_single_rom_failure'}
            print(json.dumps(response),flush=True)
            if close:break
    finally:session.close()


if __name__=='__main__':main()
