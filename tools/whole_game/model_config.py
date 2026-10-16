"""Explicit reuse of sidbot's configured credential reference; never log values."""
from pathlib import Path
import os


def load_sid_reference(path):
    """Map sidbot's existing KEY=VALUE secret mechanism to playtester settings.

    Only called with an explicit caller-selected file. Environment values win,
    matching sidbot. No shell evaluation, expansion, persistence, or provider
    fallback. Returned metadata contains names/presence only.
    """
    values = {}
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        key = key.removeprefix('export ').strip()
        if key not in ('SID_LLM_URL', 'SID_LLM_KEY'):
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        values[key] = value
    url = os.environ.get('SID_LLM_URL', values.get('SID_LLM_URL', ''))
    key = os.environ.get('SID_LLM_KEY', values.get('SID_LLM_KEY', ''))
    if not url or not key:
        raise ValueError('missing_SID_LLM_URL' if not url else 'missing_SID_LLM_KEY')
    settings = {'LITELLM_BASE': url, 'LITELLM_API_KEY': key,
                'PLAYTEST_LLM_BASE_URL': url, 'PLAYTEST_LLM_API_KEY': key,
                'PLAYTEST_LLM_MODEL': 'ramblerun/Multimodal-AI',
                'PLAYTEST_LLM_ENABLE_THINKING': 'false', 'PLAYTEST_LLM_JSON_MODE': 'json_object'}
    for name, value in settings.items():
        os.environ.setdefault(name, value)
    return {'mechanism': 'explicit sidbot env-file reference; process environment takes precedence',
            'reference': str(Path(path).resolve()), 'credential_presence': True,
            'system1_model': 'ramblerun/Decision-AI',
            'system2_model': os.environ['PLAYTEST_LLM_MODEL'],
            'secret_values_retained': False}
