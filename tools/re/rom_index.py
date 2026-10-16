"""Index GBA ROMs by cartridge header so every pipeline stage shares stable IDs.

Usage: python3 tools/re/rom_index.py local/roms > local/re/roms.json
"""
import hashlib
import json
import re
import sys
from pathlib import Path


def slugify(name: str) -> str:
    name = re.sub(r"\s*\([^)]*\)", "", name)  # drop "(USA)" etc.
    name = name.replace("&", "and")
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def header(path: Path) -> dict:
    data = path.read_bytes()
    h = data[:0xC0]
    return {
        "id": slugify(path.stem),
        "file": path.name,
        "title": h[0xA0:0xAC].rstrip(b"\0").decode("ascii", "replace"),
        "game_code": h[0xAC:0xB0].decode("ascii", "replace"),
        "maker_code": h[0xB0:0xB2].decode("ascii", "replace"),
        "version": h[0xBC],
        "size_bytes": len(data),
        "sha1": hashlib.sha1(data).hexdigest(),
    }


if __name__ == "__main__":
    roms = sorted(Path(sys.argv[1]).glob("*.gba"))
    json.dump([header(p) for p in roms], sys.stdout, indent=2)
    print()
