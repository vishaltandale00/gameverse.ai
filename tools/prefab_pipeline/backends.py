"""Explicit, bounded backend selection; no universal ROM compiler is implied.

Registered adapters cover the pinned Emerald <- FireRed source importer and
a qualified bounded edit of an intact original ROM. Portable IR is unsupported
until an engine/assembly closure is bound.
"""
from __future__ import annotations

import ast
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
BACKEND = "emerald-firered-source-import/1"
SOURCE_KIND = "decomp-source"
ABI = "gba-arm7tdmi"
PINS = {
    "base": ("emerald", "731ad5bfd6e6f265508d0efcca0ba42f9dcf5881", "local/decomps/pokeemerald"),
    "donor": ("firered", "037335f4c725d7c9aecdac87066f2002b4bd7e14", "local/decomps/pokefirered"),
}


class BackendError(ValueError):
    """An unsupported selection or unverified build; never a runnable artifact."""


def _hash(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _identity(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _git(path, *args):
    try:
        return subprocess.check_output(["git", "-C", str(path), *args], timeout=30).decode().strip()
    except (OSError, subprocess.SubprocessError) as error:
        raise BackendError(f"source inventory unavailable: {path}: {error}") from error


def _inventory(role, source):
    engine, commit, relative = PINS[role]
    path = (ROOT / source["path"]).resolve()
    if path != (ROOT / relative).resolve():
        raise BackendError(f"{role}: backend only consumes canonical pinned tree {relative}")
    if _git(path, "rev-parse", "HEAD") != commit or _git(path, "status", "--porcelain", "--untracked-files=all"):
        raise BackendError(f"{role}: source must be clean at pinned commit {commit}")
    rows = _git(path, "ls-tree", "-r", "-z", "--full-tree", commit)
    files = []
    for row in rows.split("\0"):
        if not row:
            continue
        header, name = row.split("\t", 1)
        mode, kind, blob = header.split()
        if kind != "blob" or mode not in ("100644", "100755"):
            raise BackendError(f"unsupported source entry: {name}")
        files.append({"path": name, "gitBlob": blob, "mode": mode})
    return {"role": role, "engine": engine, "commit": commit, "path": str(path),
            "kind": SOURCE_KIND, "abi": ABI, "scope": "complete-tree",
            "treeHash": _git(path, "rev-parse", "HEAD^{tree}"), "files": files}


def _modules():
    build = ROOT / "tools/whole_game/single_rom/build.py"
    declarations = [node for node in ast.parse(build.read_text()).body
                    if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "STAGES" for target in node.targets)]
    if len(declarations) != 1:
        raise BackendError("source importer stage registry is unavailable")
    stages = ast.literal_eval(declarations[0].value)
    if not isinstance(stages, tuple) or not all(isinstance(name, str) and name.isidentifier() for name in stages):
        raise BackendError("source importer stage registry is not an explicit module inventory")
    paths = [ROOT / "tools/whole_game/single_rom" / f"{name}.py" for name in ("build", *stages)]
    paths.extend(ROOT / name for name in ("tools/whole_game/build_sources.py", "tools/whole_game/single_pipeline.py", "tools/whole_game/pipeline.py", "tools/prefab_pipeline/backends.py"))
    missing = [str(path.relative_to(ROOT)) for path in paths if not path.is_file()]
    if missing:
        raise BackendError("required backend mechanisms are unavailable: " + ", ".join(missing))
    return [{"path": str(path), "sha256": _hash(path)} for path in paths]


def select_backend(capsules, request):
    """Return an immutable-input plan or raise a diagnostic BackendError.

    Selection uses explicit source contracts, never names or filename extensions.
    Each selected capsule must describe one of the complete canonical source trees.
    """
    if isinstance(request, dict) and (request.get("backend") == "bounded-original-rom-edit" or request.get("mode") == "bounded-original-rom-edit" or (isinstance(capsules, list) and capsules and all(isinstance(c, dict) and c.get("backend") == "native-rom-patch" for c in capsules))):
        return _select_original_edit(request, capsules)
    if not isinstance(request, dict) or request.get("target") != "gba":
        raise BackendError("unsupported target; registered backend target is gba")
    mode = request.get("mode", "qualified-build")
    if mode not in ("prepare", "qualified-build"):
        raise BackendError("unsupported mode; use prepare or qualified-build")
    limits = request.get("limits", {})
    jobs, timeout = limits.get("jobs", 2), limits.get("timeout_s", 300)
    if type(jobs) is not int or not 1 <= jobs <= 4 or type(timeout) is not int or not 1 <= timeout <= 3600:
        raise BackendError("limits require jobs 1..4 and timeout_s 1..3600 (total process wall time)")
    if not isinstance(capsules, list) or len(capsules) != 2:
        raise BackendError("source importer requires exactly two complete-source capsules")
    selected = {}
    for capsule in capsules:
        if not isinstance(capsule, dict):
            raise BackendError("capsule must be an object")
        source = capsule.get("source", {})
        role = source.get("role")
        if role not in PINS or role in selected:
            raise BackendError("require distinct explicit base and donor source roles")
        engine, commit, _ = PINS[role]
        expected = {"kind": SOURCE_KIND, "engine": engine, "abi": ABI, "commit": commit}
        if capsule.get("backend") != "source-engine-import" or any(source.get(key) != value for key, value in expected.items()):
            raise BackendError(f"unsupported {role} source contract; required {expected}; no heterogeneous fallback")
        if source.get("scope") != "complete-tree":
            raise BackendError(f"{role}: source.scope must explicitly be complete-tree; selective capsules cannot invoke whole-game import")
        if not isinstance(source.get("path"), str):
            raise BackendError(f"{role}: source.path required")
        selected[role] = {"prefab_id": capsule.get("prefab_id"), **_inventory(role, source)}
    plan = {"schema": "prefab-backend-plan/1", "backend": BACKEND, "target": "gba", "mode": mode,
            "limits": {"jobs": jobs, "timeout_s": timeout},
            "sources": [selected[role] for role in ("base", "donor")], "modules": _modules(),
            "scope": "complete pinned Emerald base plus complete FireRed donor; importer closure gates remain mandatory"}
    plan["sha256"] = _identity(plan)
    return plan


def _validate_plan(plan):
    if isinstance(plan, dict) and plan.get("backend") == "bounded-original-rom-edit":
        if plan != _select_original_edit(plan.get("request", {}), plan.get("capsules", [])):
            raise BackendError("original ROM edit plan or pinned inputs changed")
        return
    if not isinstance(plan, dict) or plan.get("schema") != "prefab-backend-plan/1" or plan.get("backend") != BACKEND:
        raise BackendError("unsupported backend plan")
    if plan.get("sha256") != _identity({key: value for key, value in plan.items() if key != "sha256"}):
        raise BackendError("backend plan identity changed")
    capsules = [{"prefab_id": source.get("prefab_id"), "backend": "source-engine-import", "source": source} for source in plan.get("sources", [])]
    expected = select_backend(capsules, {key: plan.get(key) for key in ("target", "mode", "limits")})
    if expected != plan:
        raise BackendError("backend source or implementation changed since planning")


def _run(command, timeout, stdout, stderr):
    """Bound the entire process group, including compiler grandchildren."""
    with stdout.open("w") as out, stderr.open("w") as err:
        process = subprocess.Popen(command, cwd=ROOT, stdout=out, stderr=err, text=True, start_new_session=True)
        try:
            return process.wait(timeout=timeout)
        except BaseException:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
            raise


def execute_backend(plan, output_dir):
    """Run strict importer and return evidence; only qualified output is publishable.

    Failed/blocked runs retain logs and a result record, and raise BackendError.
    Preparation can expose blockers but cannot return a publishable ROM.
    """
    _validate_plan(plan)
    if plan["backend"] == "bounded-original-rom-edit":
        from tools.prefab_pipeline.mod_rom import execute_mod_request
        result = execute_mod_request(plan["request"], Path(output_dir))
        _validate_plan(plan)
        if not isinstance(result, dict) or result.get("status") != "qualified-bounded-modification":
            raise BackendError("original ROM edit did not return qualified bounded evidence")
        artifact = Path(result.get("artifact", ""))
        witnesses = result.get("witnesses", {})
        if (not artifact.is_absolute() or not artifact.is_file() or _hash(artifact) != result.get("artifact_sha256")
                or result.get("original_bytes_preserved_outside_hooks") is not True
                or result.get("retained_original_sha256") != plan["request"].get("rom", {}).get("sha256")
                or result.get("differential", {}).get("outcome") != "passed"
                or result.get("differential", {}).get("vectors") != 14720
                or witnesses.get("original_parity_trace_equal") is not True
                or witnesses.get("original_parity_video_equal") is not True
                or type(witnesses.get("original_xp")) is not int or witnesses["original_xp"] <= 0
                or witnesses.get("parity_xp") != witnesses["original_xp"]
                or witnesses.get("modified_xp") != 2 * witnesses["original_xp"]):
            raise BackendError("original ROM edit artifact or causal qualification evidence is invalid")
        return {**result, "backend": "bounded-original-rom-edit", "planSha256": plan["sha256"],
                "publishable": True, "qualification_scope": "bounded original-ROM reward modification"}
    output = Path(output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    result_path = output / "backend-result.json"
    if result_path.exists():
        raise BackendError("output directory already contains a backend result; use an isolated attempt directory")
    started = time.monotonic()
    result = {"schema": "prefab-backend-result/1", "backend": BACKEND, "planSha256": plan["sha256"],
              "status": "failed", "publishable": False, "mode": plan["mode"], "queueMs": None}
    try:
        operation = "prepare" if plan["mode"] == "prepare" else "build"
        limits = plan["limits"]
        command = [sys.executable, str(ROOT / "tools/whole_game/single_rom/build.py"), operation,
                   "--jobs", str(limits["jobs"]), "--timeout", str(limits["timeout_s"])]
        stdout, stderr = output / "backend.stdout.log", output / "backend.stderr.log"
        code = _run(command, limits["timeout_s"], stdout, stderr)
        lines = [line.strip() for line in stdout.read_text().splitlines() if line.strip()]
        if not lines or not Path(lines[-1]).is_absolute() or Path(lines[-1]).name != "merge-receipt.json":
            raise BackendError("backend did not emit an absolute merge receipt path")
        receipt_path = Path(lines[-1]).resolve()
        receipt_path.relative_to((ROOT / "local/whole-game-mashup/emerald-firered/single-rom").resolve())
        merge = json.loads(receipt_path.read_text())
        result["mergeReceipt"] = {"path": str(receipt_path), "sha256": _hash(receipt_path)}
        from tools.whole_game.single_pipeline import compose, verify_manifest, verify_merge
        verify_merge(merge, ROOT, require_complete=operation == "build")
        for source in plan["sources"]:
            if merge[source["role"]]["treeHash"] != source["treeHash"]:
                raise BackendError("backend receipt source tree differs from planned input")
        if code != 0:
            raise BackendError(f"backend exited {code}: {merge.get('status')}")
        if operation == "prepare":
            result.update(status="prepared", unresolved=merge["unresolved"])
        else:
            if merge.get("status") != "built" or merge.get("buildEligible") is not True or merge.get("unresolved") != []:
                raise BackendError("strict source build is not complete; development artifacts cannot qualify")
            reference = merge.get("sourceBuildReceipt") or {}
            build_path = Path(reference["path"])
            if not build_path.is_absolute() or _hash(build_path) != reference.get("sha256"):
                raise BackendError("source build receipt identity mismatch")
            manifest = compose(receipt_path, build_path, development=False, root=ROOT)
            verify_manifest(manifest, ROOT, require_source_closed=True)
            result.update(status="built", publishable=True, manifest=manifest)
        _validate_plan(plan)
        return result
    except Exception as error:
        result.update(status="failed", publishable=False, error=str(error))
        raise BackendError(str(error)) from error
    finally:
        result["totalWallMs"] = round((time.monotonic() - started) * 1000)
        result_path.write_text(json.dumps(result, sort_keys=True, indent=2) + "\n")


def _select_original_edit(request, capsules=None):
    """Pin a scoped edit request; the existing host engine supplies engine closure.

    The mod backend validates the exact supported edit and qualification evidence.
    This route does not reinterpret a local edit as a complete recovered prefab.
    """
    if not isinstance(request, dict):
        raise BackendError("original ROM edit request must be an object")
    if request.get("target", "gba") != "gba":
        raise BackendError("original ROM edit target must be gba")
    capsules = capsules or []
    if not isinstance(capsules, list):
        raise BackendError("original ROM edit capsules must be a list")
    if capsules:
        if len(capsules) != 1 or not isinstance(capsules[0], dict) or capsules[0].get("backend") != "native-rom-patch":
            raise BackendError("original ROM edit requires exactly one native-rom-patch capsule")
        capsule = capsules[0]
        if (capsule.get("prefab_id") != request.get("prefab_id")
                or capsule.get("source", {}).get("sha256") != request.get("rom", {}).get("sha256")
                or capsule.get("modification_scope", {}).get("package_ref") != request.get("package")):
            raise BackendError("selected native capsule does not match request prefab, ROM or package identity")
    module = ROOT / "tools/prefab_pipeline/mod_rom.py"
    if not module.is_file():
        raise BackendError("bounded-original-rom-edit backend is not installed")
    from tools.prefab_pipeline.mod_rom import prepare_mod_request
    try:
        prepare_mod_request(request)
    except (KeyError, TypeError, ValueError, OSError) as error:
        raise BackendError(f"unsupported or unpinned original ROM edit: {error}") from error
    # All extant explicit file inputs are frozen, including ROM, plan/package,
    # qualification evidence and nested manifest references supplied in request.
    files = {}
    def collect(value):
        if isinstance(value, dict):
            for item in value.values():
                collect(item)
        elif isinstance(value, list):
            for item in value:
                collect(item)
        elif isinstance(value, str) and value:
            if len(value) > 4096 or "\0" in value or any(len(part) > 255 for part in value.split("/")):
                return
            candidate = Path(value)
            if not candidate.is_absolute():
                candidate = ROOT / candidate
            if candidate.is_file():
                candidate = candidate.resolve()
                key = str(candidate)
                if key in files:
                    return
                if len(files) >= 128:
                    raise BackendError("original ROM edit input closure exceeds 128 files")
                files[key] = _hash(candidate)
                if candidate.suffix == ".json" and candidate.stat().st_size <= 8 * 1024 * 1024:
                    contents = json.loads(candidate.read_text())
                    collect(contents)
                    for name in contents.get("source_pins", {}) if isinstance(contents, dict) else ():
                        collect(name)
    collect(request)
    for name in ("research/deep-extraction/castlevania/defeat-gameplay.json",
                 "research/deep-extraction/castlevania/defeat-differential.c",
                 "tools/re/session/build/gba-session", "tools/re/session/bridge.py"):
        collect(name)
    modules = [module, Path(__file__).resolve(), *sorted((ROOT / "tools/composition").glob("*.py"))]
    plan = {"schema": "prefab-backend-plan/1", "backend": "bounded-original-rom-edit",
            "target": "gba", "mode": "bounded-original-rom-edit",
            "request": json.loads(json.dumps(request)), "capsules": json.loads(json.dumps(capsules)),
            "inputs": [{"path": path, "sha256": digest} for path, digest in sorted(files.items())],
            "modules": [{"path": str(path), "sha256": _hash(path)} for path in modules],
            "scope": "bounded modification of the original complete host ROM; engine closure is inherited"}
    plan["sha256"] = _identity(plan)
    return plan
