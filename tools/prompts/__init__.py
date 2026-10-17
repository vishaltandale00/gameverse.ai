"""Resolve reviewed prompt templates or validate immutable run snapshots (no providers)."""
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]

def sha(value):
    return hashlib.sha256(value.encode()).hexdigest()

def validate(lock):
    if lock.get('schema') != 'gameverse.prompt-lock/1' or not isinstance(lock.get('prompts'), list):
        raise ValueError('invalid_prompt_lock')
    ids = set()
    for pin in lock['prompts']:
        if pin['id'] in ids or sha(pin['content']) != pin['sha256']:
            raise ValueError('prompt_identity_mismatch')
        ids.add(pin['id'])
        value = json.loads(pin['content'])
        if value.get('schema') != 'gameverse.prompt-template/1' or value['id'] != pin['id'] or value['version'] != pin['version'] or not isinstance(value['template'], str):
            raise ValueError('invalid_prompt_template')
    return lock

def load(root=ROOT):
    root = Path(root)
    # Never substitute the current registry for a retained run lock.
    if (root/'prompt-lock.json').exists():
        return validate(json.loads((root/'prompt-lock.json').read_text()))
    raw = (root/'prompts/registry.json').read_text()
    registry = json.loads(raw)
    if registry.get('schema') != 'gameverse.prompt-registry/1':
        raise ValueError('invalid_prompt_registry')
    pins = []
    for pin in registry['prompts']:
        if not re.fullmatch(r'prompts/[a-z0-9-]+/[0-9]+\.[0-9]+\.[0-9]+\.json', pin['ref']):
            raise ValueError('invalid_prompt_ref')
        pins.append(dict(pin, content=(root/pin['ref']).read_text()))
    return validate({'schema':'gameverse.prompt-lock/1', 'registry':{'version':registry['version'], 'sha256':sha(raw)}, 'prompts':pins})

def render(lock, ident, values=None):
    validate(lock)
    pin = next(p for p in lock['prompts'] if p['id'] == ident)
    def replace(match):
        key = match[1]
        if values is None or key not in values or not isinstance(values[key], str):
            raise ValueError('missing_prompt_variable:'+key)
        return values[key]
    text = re.sub(r'\{\{([A-Za-z][A-Za-z0-9]*)\}\}', replace, json.loads(pin['content'])['template'])
    return text, {'id':pin['id'], 'version':pin['version'], 'template_sha256':pin['sha256'], 'resolved_sha256':sha(text)}

def provenance(lock):
    validate(lock)
    return {'schema':'gameverse.prompt-provenance/1','registry':lock['registry'],
            'templates':[{k:p[k] for k in ('id','version','sha256')} for p in lock['prompts']]}
