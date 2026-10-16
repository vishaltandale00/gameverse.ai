"""Strict artifact-only assembler. The original provenance path is never opened."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path

SCHEMA = "gameverse.rom-roundtrip/1"
MAX_IMAGE_BYTES = 32 * 1024 * 1024


def sha(data):
    return hashlib.sha256(data).hexdigest()


def integer(value, label):
    if type(value) is not int:
        raise ValueError(label + " must be an integer")
    return value


def local_artifact(root, record):
    ref = record["path"]
    path = Path(ref)
    if path.is_absolute() or ".." in path.parts or "\\" in ref:
        raise ValueError("Artifact must be local to extraction: " + ref)
    target = (root / path).resolve()
    if not target.is_relative_to(root.resolve()) or not target.is_file():
        raise ValueError("Missing or escaping artifact: " + ref)
    return target


def assemble(manifest_path):
    """Return (bytes, layout), validating every byte before creating output."""
    manifest_path = Path(manifest_path)
    manifest = json.loads(manifest_path.read_text())
    from .contracts import validate_manifest
    errors = validate_manifest(manifest, root=manifest_path.parent, verify_files=False)
    if errors:
        raise ValueError("Invalid reconstruction manifest: " + "; ".join(errors))
    if manifest.get("schema") != SCHEMA:
        raise ValueError("Unsupported roundtrip schema")
    original = manifest["original"]
    size = integer(original["size"], "Image size")
    if not 0 < size <= MAX_IMAGE_BYTES:
        raise ValueError("Image exceeds bounded GBA cartridge size")
    if manifest.get("constraints", {}).get("preserve_layout") is not True:
        raise ValueError("Address-preserving layout required")
    components = manifest["components"]
    if not isinstance(components, list) or not components or len(components) > 4096:
        raise ValueError("Expected 1..4096 addressed components")
    result = bytearray(size)
    cursor = 0
    identities = set()
    placements = []
    for row in sorted(components, key=lambda r: integer(r["offset"], "Offset")):
        identity = (row["id"], row["version"])
        if not all(isinstance(v, str) and v for v in identity) or identity[0] in identities:
            raise ValueError("Missing or duplicate component identity")
        identities.add(identity[0])
        offset = integer(row["offset"], "Offset")
        length = integer(row["size"], "Component size")
        if offset != cursor or length <= 0 or offset + length > size:
            raise ValueError("Component gap, overlap, or out-of-bounds: " + row["id"])
        if row.get("relocations") != []:
            raise ValueError("Relocations require an explicit supported backend")
        provider = row["provider"]["kind"]
        if provider not in ("opaque_bytes", "ir_generated", "source_generated", "data_generated"):
            raise ValueError("Unsupported component provider")
        path = local_artifact(manifest_path.parent, row["artifact"])
        if path.stat().st_size != length:
            raise ValueError("Component artifact size mismatch: " + row["id"])
        data = path.read_bytes()
        digest = sha(data)
        if digest != row["artifact"]["sha256"] or digest != row["sha256"]:
            raise ValueError("Component artifact hash mismatch: " + row["id"])
        result[offset:offset + length] = data
        placements.append({"id": row["id"], "version": row["version"], "offset": offset,
                           "size": length, "sha256": digest, "providerKind": provider,
                           "sourceComponent": row["id"], "transform": "identity-placement",
                           "evidence": row.get("evidence", [])})
        cursor += length
    if cursor != size:
        raise ValueError("Uncovered cartridge tail")
    for row in components:
        for edge in row.get("dependencies", []):
            if edge.get("status") == "unknown":
                continue  # Unknown is preserved honestly, never treated as closed.
            matches = [c for c in components if c["id"] == edge.get("target") and c["sha256"] == edge.get("sha256")]
            if len(matches) != 1:
                raise ValueError("Unresolved pinned dependency: " + str(edge))
    data = bytes(result)
    layout = {"schema": "gameverse.rom-roundtrip-layout/1", "originalSha256": original["sha256"],
              "artifactSha256": sha(data), "artifact": {"sha256": sha(data), "size": len(data)},
              "components": placements}
    return data, layout


def reassemble(manifest_path, output, layout_path=None):
    output = Path(output)
    data, layout = assemble(manifest_path)
    if output.resolve() == Path(json.loads(Path(manifest_path).read_text())["original"]["path"]).resolve():
        raise ValueError("Original cartridge is immutable")
    layout_path = Path(layout_path) if layout_path else output.with_suffix(output.suffix + ".layout.json")
    if output.exists() or layout_path.exists():
        raise FileExistsError("Reconstruction outputs must be new files")
    layout["artifact"]["path"] = str(output.resolve())
    with output.open("xb") as stream:
        stream.write(data)
    with layout_path.open("x") as stream:
        json.dump(layout, stream, indent=2, sort_keys=True)
        stream.write("\n")
    return layout
