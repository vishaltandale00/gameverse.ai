#!/usr/bin/env python3
"""Build a complete, pinned Pokémon GBA source tree in an isolated run directory.

No checkout, toolchain, or original ROM is modified. Each invocation retains its
source snapshot, build log, ROM, ELF, and receipt, including failed attempts.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
OUTPUT_ROOT = ROOT / "local/whole-game-mashup/emerald-firered/builds"
GAMES = {
    "emerald": {
        "source": ROOT / "local/decomps/pokeemerald",
        "commit": "731ad5bfd6e6f265508d0efcca0ba42f9dcf5881",
        "rom": "pokeemerald.gba",
        "elf": "pokeemerald.elf",
        "sha1": "f3ae088181bf583e55daf962a92bb46f4f1d07b7",
        "toolchain": "agbcc-mzm",
        "toolchain_commit": "59b966ed1b8f371856dcf99f1546c2fe89c678ca",
    },
    "firered": {
        "source": ROOT / "local/decomps/pokefirered",
        "commit": "037335f4c725d7c9aecdac87066f2002b4bd7e14",
        "rom": "pokefirered.gba",
        "elf": "pokefirered.elf",
        "sha1": "41cb23d8dccc8ebd7c649cd8fbb58eeace6e2fdc",
        "toolchain": "agbcc-sonic",
        "toolchain_commit": "57a5b3e21157ffa5490deebfa4d6dcf0b3052d28",
    },
}


def git(path: Path, *args: str) -> str:
    return subprocess.check_output(["git", "-C", str(path), *args], text=True).strip()


def digest(path: Path, algorithm: str = "sha256") -> str:
    h = hashlib.new(algorithm)
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def snapshot_digest(path: Path) -> str:
    h = hashlib.sha256()
    for file in sorted(p for p in path.rglob("*") if p.is_file()):
        if "build" in file.relative_to(path).parts or "agbcc" in file.relative_to(path).parts:
            continue
        relative = file.relative_to(path).as_posix().encode()
        h.update(len(relative).to_bytes(4, "big"))
        h.update(relative)
        h.update(bytes.fromhex(digest(file)))
    return h.hexdigest()


def bridge_inputs() -> dict[str, str]:
    directory = ROOT / "tools/whole_game/source_bridge"
    names = ("install.py", "verify_compat.py", "whole_game_bridge.h", "whole_game_bridge.c.inc")
    return {name: digest(directory / name) for name in names}


def bridge_digest(inputs: dict[str, str]) -> str:
    h = hashlib.sha256()
    for name, file_hash in sorted(inputs.items()):
        h.update(name.encode() + b"\0" + bytes.fromhex(file_hash))
    return h.hexdigest()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def run(command: list[str], cwd: Path, env: dict[str, str], log: Path, timeout: int) -> float:
    start = time.monotonic()
    with log.open("ab") as output:
        output.write(("\n$ " + " ".join(command) + "\n").encode())
        output.flush()
        process = subprocess.Popen(command, cwd=cwd, env=env, stdout=output,
                                   stderr=subprocess.STDOUT, start_new_session=True)
        try:
            result = process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            raise RuntimeError(f"command exceeded {timeout}s: {' '.join(command)}")
        except KeyboardInterrupt:
            os.killpg(process.pid, signal.SIGTERM)
            process.wait()
            raise
        if result:
            raise RuntimeError(f"command exited {result}: {' '.join(command)}; see {log}")
    return round((time.monotonic() - start) * 1000)


def apply_source_patch(work: Path, patch: Path, log: Path, timeout: int,
                       expected_tree_hash: str | None = None) -> tuple[str, int]:
    """Apply inside a nested Git root and prove the complete post-patch tree."""
    env = os.environ.copy()
    # Without this nested root, Git discovers the enclosing Gameverse repo and
    # may silently skip every patch path from this deep archive directory.
    run(["git", "init", "-q"], work, env, log, timeout)
    run(["git", "add", "-A"], work, env, log, timeout)
    run(["git", "-c", "user.name=Gameverse Build", "-c",
         "user.email=build@localhost", "commit", "-q", "-m",
         "pinned source baseline"], work, env, log, timeout)
    run(["git", "apply", "--check", str(patch)], work, env, log, timeout)
    run(["git", "apply", str(patch)], work, env, log, timeout)
    run(["git", "add", "-A"], work, env, log, timeout)
    changed = git(work, "diff", "--cached", "--no-renames", "--name-only", "HEAD").splitlines()
    applied_tree = git(work, "write-tree")
    if not changed:
        raise RuntimeError("patch applied no source changes in isolated archive")
    if expected_tree_hash and applied_tree != expected_tree_hash:
        raise RuntimeError("post-patch source tree differs from expected merge tree")
    shutil.rmtree(work / ".git")
    return applied_tree, len(changed)


def compiler_errors(log: Path) -> tuple[list[str], int]:
    if not log.is_file():
        return [], 0
    diagnostic = re.compile(r"\berror:|\bError:|\bundeclared\b|\bsyntax error\b|\bimplicit declaration\b|duplicate array index|invalid operands|undefined reference|No rule to make target|make: \*\*\*")
    results, seen = [], set()
    for line in log.read_text(errors="replace").splitlines():
        if diagnostic.search(line) and line not in seen:
            seen.add(line)
            results.append(line)
    return results[:400], len(results)


def reusable_source_file(path: Path, root: Path) -> bool:
    parts = path.relative_to(root).parts
    return path.is_file() and "build" not in parts and "agbcc" not in parts and ".git" not in parts


def reuse_previous_build(fresh: Path, previous_receipt: Path, output: Path,
                         current: dict, log: Path, timeout: int) -> dict:
    """Clone a failed diagnostic build and overlay a verified new source snapshot.

    Existing objects are only a local diagnostic cache; a final qualification build
    must run clean. The fresh archive and patch have already passed their tree proof.
    """
    previous_receipt = previous_receipt.resolve(strict=True)
    previous = json.loads(previous_receipt.read_text())
    previous_source = previous_receipt.parent / "source"
    if previous_receipt.name != "receipt.json" or not previous_source.is_dir():
        raise RuntimeError("reuse receipt has no retained source tree")
    if previous_receipt == output / "receipt.json":
        raise RuntimeError("cannot reuse the current build")
    if previous.get("status") != "failed" or not previous.get("build", {}).get("diagnosticKeepGoing"):
        raise RuntimeError("reuse requires a retained failed diagnostic build")
    keys = ("game", "sourceCommit", "sourceTreeHash", "toolchain", "toolchainCommit")
    for key in keys:
        if previous.get(key) != current.get(key):
            raise RuntimeError(f"reuse {key} pin mismatch")
    if previous.get("machine") != current.get("machine"):
        raise RuntimeError("reuse machine context mismatch")
    if previous.get("toolchainFilesSha256") != current.get("toolchainFilesSha256"):
        raise RuntimeError("reuse toolchain file pin mismatch")
    if previous.get("sourceBridgeSha256") != current.get("sourceBridgeSha256"):
        raise RuntimeError("reuse source bridge pin mismatch")
    if (not previous.get("appliedSourceTreeHash") or not current.get("appliedSourceTreeHash")
            or previous.get("appliedSourceTreeHash") != previous.get("expectedTreeHash")):
        raise RuntimeError("reuse requires proven patched source trees")
    prior_patch = previous_receipt.parent / "source.patch"
    if not prior_patch.is_file() or digest(prior_patch) != previous.get("patchSha256"):
        raise RuntimeError("reuse prior patch pin mismatch")
    # A removed input can leave a stale generated output or object in the cache.
    # Such edits use the normal clean build until deletion invalidation is modeled.
    prior_numstat = subprocess.check_output(
        ["git", "apply", "--numstat", "-z", str(prior_patch)])
    prior_paths = [row.decode().split("\t", 2)[2]
                   for row in prior_numstat.split(b"\0") if row]
    for relative in prior_paths:
        if not (fresh / relative).is_file():
            raise RuntimeError(f"reuse rejects removed prior source: {relative}")
    fresh_files = sorted(p for p in fresh.rglob("*") if reusable_source_file(p, fresh))
    previous_files = {p.relative_to(previous_source).as_posix(): p
                      for p in previous_source.rglob("*") if reusable_source_file(p, previous_source)}
    changed = []
    for file in fresh_files:
        relative = file.relative_to(fresh).as_posix()
        old = previous_files.get(relative)
        if old is None or file.stat().st_size != old.stat().st_size or digest(file) != digest(old):
            changed.append(relative)
    build_inputs = {"Makefile", "config.mk", "ld_script.ld", "sym_ewram.ld", "sym_bss.ld"}
    if any(p in build_inputs or p.startswith("tools/") for p in changed):
        raise RuntimeError("reuse rejects changed build configuration or generator inputs")
    clone_start = time.monotonic()
    cached = output / "reused-source"
    try:
        subprocess.run(["cp", "-c", "-R", str(previous_source), str(cached)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       timeout=timeout)
        clone_mode = "apfs-clone"
    except (subprocess.CalledProcessError, FileNotFoundError):
        if cached.exists():
            shutil.rmtree(cached)
        shutil.copytree(previous_source, cached, copy_function=shutil.copy2)
        clone_mode = "copy"
    clone_ms = round((time.monotonic() - clone_start) * 1000)
    for prior in previous_source.rglob("*"):
        if prior.is_file():
            copied = cached / prior.relative_to(previous_source)
            if not copied.is_file() or copied.stat().st_ino == prior.stat().st_ino:
                raise RuntimeError(f"reuse clone does not isolate {prior.relative_to(previous_source)}")
    sync_start = time.monotonic()
    now = time.time()  # later than the retained failed build's object timestamps
    for relative in changed:
        target = cached / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(fresh / relative, target)
        os.utime(target, (now, now))
    for file in fresh_files:
        target = cached / file.relative_to(fresh)
        if not target.is_file() or file.stat().st_size != target.stat().st_size or digest(file) != digest(target):
            raise RuntimeError(f"reuse overlay source verification failed: {file.relative_to(fresh)}")
    sync_ms = round((time.monotonic() - sync_start) * 1000)
    # Never mutate a prior run, including through APFS copy-on-write hard links.
    for relative in changed:
        prior = previous_files.get(relative)
        if prior and (cached / relative).stat().st_ino == prior.stat().st_ino:
            raise RuntimeError(f"reuse clone shares mutable inode: {relative}")
    shutil.rmtree(fresh)
    cached.rename(fresh)
    with log.open("ab") as stream:
        stream.write((f"\nIncremental diagnostic cache: {previous_receipt}; "
                      f"{len(changed)} changed source inputs, {clone_mode}\n").encode())
    return {"receipt": {"path": str(previous_receipt), "sha256": digest(previous_receipt)},
            "priorAppliedSourceTreeHash": previous["appliedSourceTreeHash"],
            "cloneMode": clone_mode, "cloneWallMs": clone_ms, "syncWallMs": sync_ms,
            "changedSourceInputs": len(changed), "verifiedSourceFiles": len(fresh_files),
            "changedInputPins": [{"path": path, "sha256": digest(fresh / path)} for path in changed]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game", choices=GAMES)
    parser.add_argument("--patch", type=Path, help="explicit unified git patch, including new files")
    parser.add_argument("--patch-sha256", help="required digest when --patch is used")
    parser.add_argument("--expected-tree-hash", help="required post-patch Git tree for a composed source build")
    parser.add_argument("--source-bridge", action="store_true", help="install pinned cross-region source seam")
    parser.add_argument("--source-bridge-sha256", help="required combined source bridge input digest")
    parser.add_argument("--print-source-bridge-sha256", action="store_true",
                        help="print the current source bridge input digest and exit")
    parser.add_argument("--jobs", type=int, default=2)
    parser.add_argument("--timeout", type=int, default=300, help="per-command seconds")
    parser.add_argument("--diagnostic-keep-going", action="store_true",
                        help="continue independent make targets after errors; never marks a failed build passed")
    parser.add_argument("--reuse-build-receipt", type=Path,
                        help="reuse a failed diagnostic build cache; requires --diagnostic-keep-going")
    parser.add_argument("--reuse-build-receipt-sha256",
                        help="required SHA-256 pin of the retained diagnostic receipt")
    args = parser.parse_args()
    if args.print_source_bridge_sha256:
        print(bridge_digest(bridge_inputs()))
        return 0
    if args.game is None:
        parser.error("--game is required for a build")
    if not 1 <= args.jobs <= 4 or args.timeout < 1:
        parser.error("jobs must be 1..4 and timeout must be positive")
    if bool(args.patch) != bool(args.patch_sha256):
        parser.error("--patch and --patch-sha256 must be supplied together")
    if args.expected_tree_hash and not args.patch:
        parser.error("--expected-tree-hash requires --patch")
    if args.source_bridge != bool(args.source_bridge_sha256):
        parser.error("--source-bridge and --source-bridge-sha256 must be supplied together")
    if args.reuse_build_receipt and not args.diagnostic_keep_going:
        parser.error("--reuse-build-receipt requires --diagnostic-keep-going")
    if bool(args.reuse_build_receipt) != bool(args.reuse_build_receipt_sha256):
        parser.error("--reuse-build-receipt and --reuse-build-receipt-sha256 must be supplied together")
    game = GAMES[args.game]
    source = game["source"]
    run_id = f"{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}-{uuid.uuid4().hex[:12]}"
    output = OUTPUT_ROOT / args.game / run_id
    output.mkdir(parents=True, exist_ok=False)
    work = output / "source"
    log = output / "build.log"
    receipt_path = output / "receipt.json"
    started = time.monotonic()
    receipt = {
        "schema": "whole-source-build/1", "runId": run_id, "game": args.game,
        "startedAt": utc_now(), "status": "running", "sourceCommit": game["commit"],
        "sourceTreeHash": None, "sourceSnapshotSha256": None,
        "patchSha256": None, "expectedTreeHash": args.expected_tree_hash,
        "appliedSourceTreeHash": None, "appliedChangedFiles": None,
        "expectedBaselineSha1": game["sha1"],
        "sourceBridgeSha256": None, "sourceBridgeFilesSha256": None,
        "toolchain": game["toolchain"], "toolchainCommit": None,
        "machine": {"system": platform.system(), "release": platform.release(),
                    "machine": platform.machine(), "python": platform.python_version()},
        "build": {"mode": "incremental" if args.reuse_build_receipt else "clean",
                  "cacheState": "pending" if args.reuse_build_receipt else "miss; fresh git archive",
                  "jobs": args.jobs, "perCommandTimeoutSec": args.timeout,
                  "diagnosticKeepGoing": args.diagnostic_keep_going,
                  "wallMs": None, "outcome": "running"},
        "artifacts": {}, "baselineMatches": None,
    }
    def save() -> None:
        receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")

    save()
    try:
        actual_commit = git(source, "rev-parse", "HEAD")
        if actual_commit != game["commit"]:
            raise RuntimeError(f"source pin mismatch: {actual_commit}")
        if git(source, "status", "--porcelain"):
            raise RuntimeError(f"canonical source is dirty: {source}")
        receipt["sourceTreeHash"] = git(source, "rev-parse", "HEAD^{tree}")
        toolchain = ROOT / "local/game-builds/toolchains" / game["toolchain"]
        receipt["toolchainCommit"] = git(toolchain, "rev-parse", "HEAD")
        if receipt["toolchainCommit"] != game["toolchain_commit"]:
            raise RuntimeError(f"toolchain pin mismatch: {receipt['toolchainCommit']}")
        receipt["toolchainFilesSha256"] = {}
        for name in ("agbcc", "old_agbcc", "agbcc_arm", "libgcc.a", "libc.a"):
            if not (toolchain / name).is_file():
                raise RuntimeError(f"toolchain missing {name}: {toolchain}")
            receipt["toolchainFilesSha256"][name] = digest(toolchain / name)
        archive = subprocess.Popen(["git", "-C", str(source), "archive", "--format=tar", "HEAD"],
                                   stdout=subprocess.PIPE)
        assert archive.stdout is not None
        work.mkdir()
        with tarfile.open(fileobj=archive.stdout, mode="r|") as stream:
            for member in stream:
                target = (work / member.name).resolve()
                if work not in target.parents and target != work:
                    raise RuntimeError(f"unsafe archive member: {member.name}")
                if member.issym() or member.islnk():
                    raise RuntimeError(f"archive link is unsupported: {member.name}")
                stream.extract(member, work)
        if archive.wait() != 0:
            raise RuntimeError("git archive failed")
        if args.patch:
            patch = args.patch.resolve(strict=True)
            actual_hash = digest(patch)
            if actual_hash != args.patch_sha256.lower():
                raise RuntimeError(f"patch digest mismatch: {actual_hash}")
            shutil.copy2(patch, output / "source.patch")
            receipt["patchSha256"] = actual_hash
            receipt["appliedSourceTreeHash"], receipt["appliedChangedFiles"] = apply_source_patch(
                work, output / "source.patch", log, args.timeout, args.expected_tree_hash)
        if args.source_bridge:
            inputs = bridge_inputs()
            actual_hash = bridge_digest(inputs)
            if actual_hash != args.source_bridge_sha256.lower():
                raise RuntimeError(f"source bridge digest mismatch: {actual_hash}")
            retained = output / "source_bridge_inputs"
            retained.mkdir()
            for name, file_hash in inputs.items():
                shutil.copy2(ROOT / "tools/whole_game/source_bridge" / name, retained / name)
                if digest(retained / name) != file_hash:
                    raise RuntimeError(f"source bridge input changed during copy: {name}")
            receipt["sourceBridgeSha256"] = actual_hash
            receipt["sourceBridgeFilesSha256"] = inputs
            receipt["sourceBridgeInputsPath"] = str(retained)
            # The verifier resolves both canonical trees relative to its module.
            # Run it at its repository path and verify the frozen input hashes
            # immediately before and after invocation.
            if bridge_inputs() != inputs:
                raise RuntimeError("source bridge inputs changed before installation")
            installer = ROOT / "tools/whole_game/source_bridge/install.py"
            source_game = "pokeemerald" if args.game == "emerald" else "pokefirered"
            run([sys.executable, str(installer), source_game, str(work)],
                ROOT, os.environ.copy(), log, args.timeout)
            if bridge_inputs() != inputs:
                raise RuntimeError("source bridge inputs changed during installation")
        receipt["sourceSnapshotSha256"] = snapshot_digest(work)
        if args.reuse_build_receipt:
            if digest(args.reuse_build_receipt) != args.reuse_build_receipt_sha256.lower():
                raise RuntimeError("reuse build receipt digest mismatch")
            receipt["build"]["reuse"] = reuse_previous_build(
                work, args.reuse_build_receipt, output, receipt, log, args.timeout)
            receipt["build"]["cacheState"] = "hit; verified source overlay"
        install = work / "tools/agbcc"
        (install / "bin").mkdir(parents=True, exist_ok=True)
        (install / "include").mkdir(exist_ok=True)
        (install / "lib").mkdir(exist_ok=True)
        for name in ("agbcc", "old_agbcc", "agbcc_arm"):
            shutil.copy2(toolchain / name, install / "bin" / name)
        shutil.copytree(toolchain / "libc/include", install / "include", dirs_exist_ok=True)
        shutil.copytree(toolchain / "ginclude", install / "include", dirs_exist_ok=True)
        for name in ("libgcc.a", "libc.a"):
            shutil.copy2(toolchain / name, install / "lib" / name)
        env = os.environ.copy()
        env.setdefault("CPATH", "/opt/homebrew/include")
        env.setdefault("LIBRARY_PATH", "/opt/homebrew/lib")
        build_start = time.monotonic()
        # Upstream's macOS arm-none-eabi-cpp rejects legacy \u assembly tokens.
        # The host clang preprocessor accepts these files with this narrow flag.
        command = ["make", f"-j{args.jobs}"]
        if args.diagnostic_keep_going:
            command.append("-k")
        command += ["CPP=clang -E -Wno-invalid-pp-token", "all"]
        try:
            run(command, work, env, log, args.timeout)
        finally:
            receipt["build"]["wallMs"] = round((time.monotonic() - build_start) * 1000)
        for kind in ("rom", "elf"):
            path = work / game[kind]
            if not path.is_file():
                raise RuntimeError(f"full build missing {kind}: {path}")
            receipt["artifacts"][kind] = {
                "path": str(path), "relativePath": str(path.relative_to(output)),
                "sha256": digest(path), "bytes": path.stat().st_size,
            }
        receipt["artifacts"]["rom"]["sha1"] = digest(work / game["rom"], "sha1")
        receipt["baselineMatches"] = receipt["artifacts"]["rom"]["sha1"] == game["sha1"]
        if args.patch is None and not args.source_bridge and not receipt["baselineMatches"]:
            raise RuntimeError("unmodified full build did not reproduce expected ROM SHA1")
        receipt["build"]["outcome"] = "passed"
        receipt["status"] = "passed"
        return 0
    except KeyboardInterrupt:
        receipt["status"] = "cancelled"
        receipt["build"]["outcome"] = "cancelled"
        receipt["error"] = "interrupted"
        return 130
    except Exception as error:
        receipt["status"] = "failed"
        receipt["build"]["outcome"] = "failed"
        receipt["error"] = str(error)
        receipt["compilerErrors"], receipt["compilerErrorsTotal"] = compiler_errors(log)
        receipt["compilerErrorsTruncated"] = receipt["compilerErrorsTotal"] > len(receipt["compilerErrors"])
        print(str(error), file=sys.stderr)
        return 1
    finally:
        receipt["finishedAt"] = utc_now()
        receipt["totalWallMs"] = round((time.monotonic() - started) * 1000)
        save()
        print(receipt_path)


if __name__ == "__main__":
    raise SystemExit(main())
