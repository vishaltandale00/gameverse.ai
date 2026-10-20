"""Pinned bounded-run continuation memory; no model or emulator operations."""
from .core import digest


def capture(tester, runtime_identity):
    return {'schema':'native-playtester-learning/1','game_version':tester.profile['game_version'],
        'profile_sha256':digest(tester.profile),'runtime_identity':runtime_identity,'parent_run_id':tester.run_id,
        'state_visits':dict(tester.states),'attempts':list(tester.attempts.items()),
        'stationary':list(tester.stationary.items()),'stationary_frames':list(tester.stationary_frames.items()),
        'transitions':tester.transitions,'barriers':tester.barriers,'awareness':tester.awareness,
        'system2_plan':tester.system2_plan,'active_target':tester.active_target}


def restore(tester, retained, runtime_identity):
    if (retained.get('schema')!='native-playtester-learning/1' or
        retained.get('game_version')!=tester.profile['game_version'] or
        retained.get('profile_sha256')!=digest(tester.profile) or retained.get('runtime_identity')!=runtime_identity):
        raise ValueError('experiment_learning_identity_mismatch')
    tester.states.update(retained['state_visits'])
    for key in ('attempts','stationary','stationary_frames'):
        getattr(tester,key).update({tuple(pair):value for pair,value in retained[key]})
    for key in ('transitions','barriers','awareness','system2_plan','active_target'):
        setattr(tester,key,retained.get(key))
    tester.resume_origin={'parent_run_id':retained['parent_run_id'],'memory_restored':True,
        'frame_basis':'native snapshot resumes, relative frame numbers restart; one explicit render frame is charged'}
