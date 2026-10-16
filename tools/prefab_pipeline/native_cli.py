"""Narrow transport CLI for the two registered native modification backends."""
import argparse
import json
from pathlib import Path
import subprocess
import sys


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('mod-rom', 'build-mod'))
    parser.add_argument('--request', required=True, type=Path)
    parser.add_argument('--output-dir', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        request = json.loads(args.request.read_text())
        if not isinstance(request, dict):
            raise ValueError('Expected a JSON request object')
        if args.command == 'mod-rom':
            from .mod_rom import execute_mod_request
            result = execute_mod_request(request, args.output_dir.resolve())
        else:
            from .native_mod import build_native_mod_request
            result = build_native_mod_request(request, args.output_dir.resolve())
        code = 0 if result.get('status') in ('qualified-bounded-modification', 'candidate-built') else 2
    except (ValueError, KeyError, OSError, RuntimeError, subprocess.SubprocessError) as error:
        result = {'schema': 'gameverse.prefab-cli-error/1', 'status': 'failed', 'error': str(error)}
        code = 2
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    return code


if __name__ == '__main__':
    sys.exit(main())
