#!/usr/bin/env python3
"""Fail closed if pinned Emerald/FireRed party wire assumptions change."""
from __future__ import annotations

import json
import re
from pathlib import Path

DECOMPS = Path(__file__).resolve().parents[3] / "local/decomps"
GAMES = ("pokefirered", "pokeemerald")


def defines(game: str, name: str) -> dict[str, int]:
    src = (DECOMPS / game / f"include/constants/{name}.h").read_text()
    out = {}
    for match in re.finditer(r"^#define\s+([A-Z][A-Z0-9_]+)\s+(\d+)\s*(?://.*)?$", src, re.M):
        out[match.group(1)] = int(match.group(2))
    return out


def emerald_items() -> dict[str, int]:
    src = (DECOMPS / "pokeemerald/include/constants/items.h").read_text()
    body = src.split("enum {", 1)[1].split("ITEMS_COUNT", 1)[0]
    out = {}
    value = 0
    for line in body.splitlines():
        line = line.split("//", 1)[0].strip()
        match = re.fullmatch(r"(ITEM_[A-Z0-9_]+),", line)
        if match:
            out[match.group(1)] = value
            value += 1
    return out


def canonical_structs(game: str) -> dict[str, str]:
    src = (DECOMPS / game / "include/pokemon.h").read_text()
    src = re.sub(r"/\*.*?\*/|//[^\n]*", "", src, flags=re.S)
    src = src.replace("metloc_u8_t", "u8").replace("CONTEST_RIBBON_BITS", "3")
    out = {}
    for name in ("PokemonSubstruct0", "PokemonSubstruct1", "PokemonSubstruct2", "PokemonSubstruct3", "BoxPokemon", "Pokemon"):
        match = re.search(r"struct " + name + r"\s*\{(.*?)\};", src, re.S)
        if not match:
            raise ValueError(f"missing struct {name} in {game}")
        out[name] = re.sub(r"\s+", "", match.group(1))
    return out


def verify() -> dict:
    results = {}
    for category, prefix, limit in (("species", "SPECIES_", 413), ("moves", "MOVE_", 355)):
        left = {k: v for k, v in defines(GAMES[0], category).items() if k.startswith(prefix) and v < limit}
        right = {k: v for k, v in defines(GAMES[1], category).items() if k.startswith(prefix) and v < limit}
        if left != right:
            raise ValueError(f"{category} IDs differ: {[(k,v,right.get(k)) for k,v in left.items() if right.get(k)!=v][:8]}")
        results[category] = {"common_named_ids": len(left), "numeric_limit": limit}
    fr_items = {k: v for k, v in defines("pokefirered", "items").items() if k.startswith("ITEM_") and v < 259}
    em_items = {k: v for k, v in emerald_items().items() if v < 259}
    if fr_items != em_items:
        raise ValueError(f"held item IDs differ: {[(k,v,em_items.get(k)) for k,v in fr_items.items() if em_items.get(k)!=v][:8]}")
    results["held_items"] = {"common_named_ids": len(fr_items), "numeric_limit_exclusive": 259, "reserved_ids_rejected": [52,62,72,82,87,92,99,102,105,112,120,226,253]}
    structs = {game: canonical_structs(game) for game in GAMES}
    if structs[GAMES[0]] != structs[GAMES[1]]:
        raise ValueError("Pokemon secure substructures/layout declarations differ")
    results["pokemon_structs_equal"] = list(structs[GAMES[0]])
    results["wire_size_asserted_by_source"] = 100
    return results


if __name__ == "__main__":
    print(json.dumps(verify(), indent=2, sort_keys=True))
