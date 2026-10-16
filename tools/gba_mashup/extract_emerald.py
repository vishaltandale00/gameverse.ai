#!/usr/bin/env python3
"""Extract pinned Emerald C, tables and indexed sprite pixels for a native bridge.

This never fetches a ROM or substitutes recalled mechanics for missing source.
Generated data remain local. The manifest hashes every original span and output.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

COMMIT = "731ad5bfd6e6f265508d0efcca0ba42f9dcf5881"
SPECIES = ("BULBASAUR", "CHARMANDER", "SQUIRTLE", "ZUBAT", "GEODUDE", "PARAS", "WINGULL", "ZIGZAGOON")
MOVES = ("TACKLE", "VINE_WHIP", "RAZOR_LEAF", "MEGA_DRAIN", "SCRATCH",
         "EMBER", "FLAMETHROWER", "QUICK_ATTACK", "POUND", "WATER_GUN",
         "BUBBLE", "SURF", "STRUGGLE", "BITE", "WING_ATTACK", "LEECH_LIFE",
         "ROCK_THROW", "MUD_SLAP", "ABSORB", "PECK")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def block(text, marker):
    """Balanced C definition, including string/comment awareness and trailing ;."""
    match = re.search(marker, text, re.M)
    if not match:
        raise ValueError("Source marker missing: " + marker)
    start = match.start()
    brace = text.index("{", match.end())
    token = re.compile(r'/\*.*?\*/|//[^\n]*|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|[{}]', re.S)
    depth = 0
    for part in token.finditer(text, brace):
        if part.group() == "{":
            depth += 1
        elif part.group() == "}":
            depth -= 1
            if depth == 0:
                end = part.end()
                if text[end:end+1] == ";":
                    end += 1
                return text[start:end], text.count("\n", 0, start) + 1
    raise ValueError("Unclosed C definition")


def extract(source, out):
    revision = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
    if revision != COMMIT:
        raise ValueError("Unreviewed Emerald revision: " + revision)
    dirty = subprocess.check_output(["git", "-C", str(source), "status", "--porcelain", "--untracked-files=no"], text=True)
    if dirty.strip():
        raise ValueError("Emerald tracked source has modifications; refuse unpinned extraction")
    out.mkdir(parents=True, exist_ok=True)
    records, outputs = [], {}

    def record(path, symbol, content, line):
        records.append({"path": path, "symbol": symbol, "line": line,
                        "sha256": sha(content.encode()), "file_sha256": sha((source / path).read_bytes())})

    definitions = []
    for path, marker, symbol in [
        ("src/pokemon.c", r"^s32 CalculateBaseDamage\(", "CalculateBaseDamage"),
        ("src/pokemon.c", r"^const u8 gStatStageRatios\[", "gStatStageRatios"),
        ("src/pokemon.c", r"^static const u8 sHoldEffectToType\[", "sHoldEffectToType"),
        ("src/battle_main.c", r"^const u8 gTypeEffectiveness\[", "gTypeEffectiveness"),
        ("src/battle_script_commands.c", r"^static void ModulateDmgByType2\(u8 multiplier, u16 move, u8 \*flags\)\n", "ModulateDmgByType2"),
        ("src/battle_script_commands.c", r"^u8 TypeCalc\(", "TypeCalc"),
        ("src/battle_script_commands.c", r"^static inline void ApplyRandomDmgMultiplier\(void\)\n", "ApplyRandomDmgMultiplier"),
    ]:
        content, line = block((source / path).read_text(), marker)
        record(path, symbol, content, line)
        definitions.append(content)
    pokemon = (source / "src/pokemon.c").read_text()
    macro = re.search(r"^#define APPLY_STAT_MOD.*?^}", pokemon, re.M | re.S).group()
    record("src/pokemon.c", "APPLY_STAT_MOD", macro, pokemon[:pokemon.index(macro)].count("\n") + 1)
    # Data first, then functions; all function bodies are retained verbatim.
    definitions = [definitions[i] for i in (1, 2, 3, 0, 4, 5, 6)]
    moves_text = (source / "src/data/battle_moves.h").read_text()
    moves = []
    for name in MOVES:
        entry, line = block(moves_text, r"^    \[MOVE_" + name + r"\] =")
        record("src/data/battle_moves.h", "MOVE_" + name, entry, line)
        moves.append(entry + ",")
    move_table = "static const struct BattleMove gBattleMoves[MOVES_COUNT] = {\n" + "\n".join(moves) + "\n};"

    species_text = (source / "src/data/pokemon/species_info.h").read_text()
    species_rows = []
    for name in SPECIES:
        entry, line = block(species_text, r"^    \[SPECIES_" + name + r"\] =")
        record("src/data/pokemon/species_info.h", "SPECIES_" + name, entry, line)
        stats = [re.search(r"\." + key + r"\s*=\s*(\d+)", entry).group(1) for key in
                 ("baseHP", "baseAttack", "baseDefense", "baseSpAttack", "baseSpDefense", "baseSpeed")]
        types = re.search(r"\.types\s*=\s*\{([^}]+)\}", entry).group(1).strip()
        ability = re.search(r"\.abilities\s*=\s*\{\s*(\w+)", entry).group(1)
        species_rows.append('{"' + name + '", SPECIES_' + name + ', {' + types + '}, {' + ', '.join(stats) + '}, ' + ability + '}')
    species_table = "static const struct GvSpeciesSeed gvSpeciesSeeds[] = {\n" + ",\n".join(species_rows) + "\n};"

    # Keep only constants reachable from selected source, including transitive
    # object-like macro references. Reject conflicts rather than guessing values.
    defines = {}
    for path in sorted((source / "include/constants").glob("*.h")) + sorted((source / "include").glob("*.h")):
        for match in re.finditer(r"^#define\s+(\w+)([ \t]+[^\n]+)$", path.read_text(), re.M):
            name, value = match.groups()
            value = value.split("//")[0].strip()
            if name not in defines:
                defines[name] = value
    for name in ("TYPE_FORESIGHT", "TYPE_ENDTABLE", "TYPE_MUL_NO_EFFECT", "TYPE_MUL_NOT_EFFECTIVE", "TYPE_MUL_SUPER_EFFECTIVE", "DYNAMIC_TYPE_MASK"):
        for path in (source / "include").glob("*.h"):
            match = re.search(r"^#define\s+" + name + r"\s+([^\n]+)", path.read_text(), re.M)
            if match:
                defines[name] = match.group(1).split("//")[0].strip()
                break
    corpus = "\n".join(definitions + [macro, move_table, species_table])
    wanted = set(re.findall(r"\b[A-Z][A-Z0-9_]+\b", corpus))
    # The bridge uses these source constants outside extracted definitions.
    wanted.update("STATUS1_PARALYSIS STATUS1_BURN EFFECT_ABSORB EFFECT_BURN_HIT EFFECT_PARALYZE_HIT EFFECT_SPEED_DOWN_HIT EFFECT_HIGH_CRITICAL B_WEATHER_RAIN_TEMPORARY B_WEATHER_SUN_TEMPORARY MOVE_NONE MOVE_STRUGGLE ABILITYEFFECT_FIELD_SPORT ABILITY_CLOUD_NINE ABILITY_AIR_LOCK".split())
    previous = set()
    while previous != wanted:
        previous = wanted.copy()
        for name in tuple(wanted):
            if name in defines:
                wanted.update(re.findall(r"\b[A-Z][A-Z0-9_]+\b", defines[name]))
    constants = "\n".join("#define " + name + " " + defines[name] for name in sorted(wanted) if name in defines)
    items_enum, line = block((source / "include/constants/items.h").read_text(), r"^enum\s*")
    record("include/constants/items.h", "item enum", items_enum, line)
    outputs["emerald_constants.h"] = "/* Generated from pinned Emerald source constants. */\n" + constants + "\n" + items_enum + "\n"
    outputs["emerald_extracts.inc"] = "/* Verbatim source definitions; see provenance.json. */\n" + macro + "\n" + move_table + "\n" + "\n\n".join(definitions) + "\n" + species_table + "\n"

    # Pillow is provided by the existing workspace Python runtime. No install.
    from PIL import Image
    sprites = []
    for name in SPECIES:
        for side in ("front", "back"):
            path = "graphics/pokemon/" + name.lower() + "/" + side + ".png"
            image = Image.open(source / path)
            if image.mode != "P" or image.width != 64 or image.height < 64:
                raise ValueError("Unexpected source sprite layout: " + path)
            palette_path = "graphics/pokemon/" + name.lower() + "/normal.pal"
            # JASC palettes carry canonical game colours, independent of PNG preview.
            colors = [tuple(map(int, row.split())) for row in (source / palette_path).read_text().splitlines()[3:] if row.strip()]
            if len(colors) != 16:
                raise ValueError("Expected exactly 16 canonical palette colors")
            values = []
            cropped = image.crop((0, 0, 64, 64))
            indices = cropped.get_flattened_data() if hasattr(cropped, "get_flattened_data") else cropped.getdata()
            for index in indices:
                r, g, b = colors[index]
                values.append(0x8000 if index == 0 else (r >> 3) | ((g >> 3) << 5) | ((b >> 3) << 10))
            lines = [", ".join("0x%04x" % v for v in values[i:i+16]) for i in range(0, len(values), 16)]
            sprites.append("static const GvU16 gvSprite_" + name + "_" + side + "[4096] = {\n" + ",\n".join(lines) + "\n};")
            for asset in (path, palette_path):
                records.append({"path": asset, "sha256": sha((source / asset).read_bytes()), "transform": "first 64x64 indexed frame; canonical normal.pal; RGB555; palette0 transparent0x8000"})
    sprites.append("const GvU16 *GvSpeciesSprite(GvU16 species, GvU8 back) {\n switch(species) {\n" + "\n".join("case SPECIES_" + n + ": return back ? gvSprite_" + n + "_back : gvSprite_" + n + "_front;" for n in SPECIES) + "\n default: return 0; }\n}")
    outputs["emerald_sprites.inc"] = "\n".join(sprites) + "\n"

    # Two native 32x32 field frames packed as four 16x16 OBJ parts per frame.
    # MZM uses 2D OBJ mapping: each 16x16 part spans tile n,n+1,n+32,n+33.
    # Packing four parts along a row leaves both frames within one 64-tile
    # (2048 byte) original spriteset allocation. No new reserved VRAM is assumed.
    fields = []
    for name in SPECIES[3:]:
        field_path = source / ("graphics/object_events/pics/pokemon/" + name.lower() + ".png")
        if field_path.exists():
            image = Image.open(field_path)
            w = 16 if image.width == 16 else 32
            colors = [tuple(image.getpalette()[i:i+3]) for i in range(0,48,3)]
            frames = [image.crop((0, i*w, w, (i+1)*w)).resize((32,32), Image.Resampling.NEAREST) for i in (0,1)]
            asset_path = str(field_path.relative_to(source))
            transform = "native overworld indexed frames0,1; nearest 16to32 upscale where needed; PNG palette; packed MZM 2D OBJ"
        else:
            asset_path = "graphics/pokemon/" + name.lower() + "/front.png"
            image = Image.open(source / asset_path)
            colors = [tuple(map(int,row.split())) for row in (source / ("graphics/pokemon/" + name.lower() + "/normal.pal")).read_text().splitlines()[3:] if row.strip()]
            frames = [image.crop((0, i*64, 64, (i+1)*64)).resize((32,32),Image.Resampling.NEAREST) for i in (0,1)]
            transform = "source battle-front indexed frames0,1 adapted to field at32x32 nearest-neighbor; canonical normal.pal; packed MZM 2D OBJ; not original overworld art"
        tiles = bytearray(2048)
        for frame_index, frame in enumerate(frames):
            for y in range(32):
                for x in range(0,32,2):
                    quadrant = (y//16)*2+x//16
                    local_x,local_y=x%16,y%16
                    tile = frame_index*8 + quadrant*2 + (local_y//8)*32 + local_x//8
                    pos=tile*32+(local_y%8)*4+(local_x%8)//2
                    tiles[pos]=frame.getpixel((x,y)) | (frame.getpixel((x+1,y))<<4)
        pal=[(r>>3)|((g>>3)<<5)|((b>>3)<<10) for r,g,b in colors]
        words=[tiles[i]|(tiles[i+1]<<8) for i in range(0,len(tiles),2)]
        fields.append("static const GvU16 gvField_"+name+"[1024]={"+",".join(hex(x) for x in words)+"};")
        fields.append("static const GvU16 gvFieldPal_"+name+"[16]={"+",".join(hex(x) for x in pal)+"};")
        records.append({"path":asset_path,"sha256":sha((source/asset_path).read_bytes()),"transform":transform})
    fields.append("const GvU16 *GvFieldTiles(GvU16 species) {switch(species){"+"".join("case SPECIES_"+n+":return gvField_"+n+";" for n in SPECIES[3:])+"default:return 0;}}")
    fields.append("const GvU16 *GvFieldPalette(GvU16 species) {switch(species){"+"".join("case SPECIES_"+n+":return gvFieldPal_"+n+";" for n in SPECIES[3:])+"default:return 0;}}")
    outputs["emerald_field_sprites.inc"]="\n".join(fields)+"\n"
    manifest = {"schema_version": 1, "source": "https://github.com/pret/pokeemerald", "source_commit": revision,
                "extraction_version": 2, "source_spans": records,
                "output_sha256": {name: sha(data.encode()) for name, data in outputs.items()},
                "limitations": ["Not the full Emerald battle engine or AI bytecode interpreter", "Reduced singles state, eight species and selected moves; wild has exactly one opponent", "MZM world/gameplay retained by separate native integration", "Raw generated assets remain local and are not added to git"]}
    for name, data in outputs.items():
        (out / name).write_text(data)
    (out / "provenance.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path("local/decomps/pokeemerald"))
    parser.add_argument("--out", type=Path, default=Path("tools/gba_mashup/native/generated"))
    args = parser.parse_args()
    result = extract(args.source.resolve(), args.out.resolve())
    print(json.dumps({"source_commit": result["source_commit"], "source_spans": len(result["source_spans"]), "output_sha256": result["output_sha256"]}))
