"""Agent entrypoint for pinned same-module lifecycle phase extension.

Uses the browser/runtime JS implementation and existing assembly validator;
there is no second implementation of aliasing or cache lifecycle semantics.
"""
from pathlib import Path
import json
import subprocess

ROOT = Path(__file__).resolve().parents[2]


def extend_phase_request(request: dict, output_dir: Path) -> dict:
    output = Path(output_dir).resolve()
    if output.exists():
        raise ValueError('Phase extension output directory must not already exist.')
    output.parent.mkdir(parents=True, exist_ok=True)
    # Keep the exact reviewed request next to the exclusively created attempt.
    import tempfile
    with tempfile.TemporaryDirectory(prefix='phase-extension-request-') as folder:
        request_path = Path(folder) / 'request.json'
        request_path.write_text(json.dumps(request, indent=2) + '\n')
        process = subprocess.run(['node', str(ROOT / 'scripts/extend-prefab-phase.mjs'),
                                  '--request', str(request_path), '--output-dir', str(output)],
                                 cwd=ROOT, capture_output=True, text=True, timeout=40)
    receipt_path = output / 'receipt.json'
    if not receipt_path.is_file():
        raise RuntimeError(process.stderr or 'Phase extension produced no receipt.')
    result = json.loads(receipt_path.read_text())
    if process.returncode and result.get('status') != 'failed':
        raise RuntimeError('Phase extension process/receipt status mismatch.')
    return result
