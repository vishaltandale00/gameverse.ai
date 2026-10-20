"""Port exact FireRed UI glyphs/fonts into extra Emerald font slots.

No original font IDs are reused. The source transform adds the donor glyph
readers, metrics and renderer dispatch; copied PNGs remain the original assets.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import shutil
import struct
import subprocess
import tempfile
import time
import zlib

FONT_SPECS = (("Male", "MALE", 10), ("Female", "FEMALE", 11), ("Normal", "NORMAL", 12), ("NormalCopy1", "NORMAL_COPY_1", 13), ("Small", "SMALL", 14))


def _function(source, name):
    match = re.search(r"^(?:static\s+)?(?:void|u8|u16|u32|s32)\s+(?:UNUSED\s+)?" + re.escape(name) + r"\s*\([^;]*?\)\s*\{", source, re.M)
    if match is None:
        raise ValueError("missing source function " + name)
    depth, pos = 1, match.end()
    while depth:
        if source[pos] == "{":
            depth += 1
        elif source[pos] == "}":
            depth -= 1
        pos += 1
    return source[match.start():pos]


def _array(source, name):
    match = re.search(r"(?:static\s+)?const\s+[^;=\n]+\b" + re.escape(name) + r"\s*\[[^;=]*=\s*(?:\{.*?\n\}|INCBIN_\w+\([^;]*\));", source, re.S)
    if not match:
        raise ValueError("missing source array " + name)
    return match[0]


def _append_initializer(source, name, entries):
    match = re.search(r"\b" + re.escape(name) + r"\s*\[[^;]*?=\s*\{", source)
    if match is None:
        raise ValueError("missing native initializer " + name)
    pos, depth = match.end(), 1
    while depth:
        if source[pos] == "{":
            depth += 1
        elif source[pos] == "}":
            depth -= 1
        pos += 1
    before = source[:pos - 1].rstrip()
    if not before.endswith(","):
        before += ","
    return before + "\n" + entries + "\n" + source[pos - 1:]


def _adapt(text):
    tokens = {"FONT_" + constant: "FR_FONT_" + constant for _, constant, _ in FONT_SPECS}
    for suffix, _, _ in FONT_SPECS:
        for prefix in ("FontFunc_", "DecompressGlyph_", "GetGlyphWidth_"):
            tokens[prefix + suffix] = "FR_" + prefix + suffix
    tokens.update({name: "FR_" + name for name in re.findall(r"\bsFont\w+", text)})
    text = re.sub(r"\b[A-Za-z_]\w*\b", lambda m: tokens.get(m[0], m[0]), text)
    text = text.replace("&textPrinter->subUnion.sub", "(struct TextPrinterSubStruct *)textPrinter->subStructFields")
    text = text.replace("textPrinter->subUnion.sub.glyphId", "subStruct->fontId").replace("hasGlyphIdBeenSet", "hasFontIdBeenSet")
    text = text.replace("gGlyphInfo.pixels", "((u8 *)&gCurGlyph)").replace("gGlyphInfo.width", "gCurGlyph.width").replace("gGlyphInfo.height", "gCurGlyph.height")
    text = re.sub(r"^(?:static )?s32 (FR_GetGlyphWidth_\w+)", r"static u32 \1", text, flags=re.M)
    text = re.sub(r"^(?:static )?(u16|void) (FR_(?:FontFunc|DecompressGlyph)_\w+)", r"static \1 \2", text, flags=re.M)
    return text


def _normalized_function(source, name):
    text = _function(source, name)
    text = text.replace(name, "CONVERTER")
    text = re.sub(r"/\*.*?\*/|//[^\n]*", "", text, flags=re.S)
    return re.sub(r"\s+", "", text)


def stage_fonts(base, donor, out, report_dir=None):
    base, donor, out = (Path(p).resolve() for p in (base, donor, out))
    if any(out == src or src in out.parents or out in src.parents for src in (base, donor)):
        raise ValueError("font output must be isolated from source trees")
    source = (donor / "src/text.c").read_text()
    menu = (donor / "src/new_menu_helpers.c").read_text()
    native = (out / "src/text.c").read_text()
    header = (out / "include/text.h").read_text()
    changed, provenance = [], []
    donor_converter = (donor / "tools/gbagfx/font.c").read_text()
    native_converter = (base / "tools/gbagfx/font.c").read_text()
    equivalent = []
    for donor_name, native_name in (("ConvertToFullWidthLatinFont", "ConvertToLatinFont"), ("ConvertToFullwidthJapaneseFont", "ConvertToFullwidthJapaneseFont")):
        if _normalized_function(donor_converter, donor_name) != _normalized_function(native_converter, native_name):
            raise ValueError("font packing converter differs: " + donor_name)
        equivalent.append({"donor": donor_name, "native": native_name, "method": "exact C function token equality after function-name/whitespace/comments normalization"})

    def write(path, text):
        target = out / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)
        changed.append(path)

    charmap_path = out / "charmap.txt"
    charmap = charmap_path.read_text()
    if not re.search(r"^\x27‥\x27\s*=", charmap, re.M):
        charmap += "\n\x27‥\x27 = B0 @ Original FireRed ellipsis alias\n"
        write("charmap.txt", charmap)
    if not re.search(r"^FR_FONT_MALE\s*=", charmap, re.M):
        charmap += "\n@ Exact imported FireRed font IDs; native entries above stay unchanged.\n" + "".join("FR_FONT_" + constant + " = FC 06 " + format(index, "02X") + "\n" for _, constant, index in FONT_SPECS)
        write("charmap.txt", charmap)
    for alias, value in (("LEFT_PAREN", "F9 13"), ("RIGHT_PAREN", "F9 14"), ("DPAD_ANY", "F8 0C")):
        if not re.search(r"^" + alias + r"\s*=", charmap, re.M):
            charmap += alias + " = " + value + " @ Original donor glyph, used with imported FR font\n"
            write("charmap.txt", charmap)
    arrays = sorted(set(re.findall(r"\bsFont\w+", "\n".join(_function(source, "DecompressGlyph_" + suffix) + _function(source, "GetGlyphWidth_" + suffix) for suffix, _, _ in FONT_SPECS))))
    data = "\n\n".join(_array(source, name) for name in arrays)
    assets = sorted(set(re.findall(r'INCBIN_U16\("(graphics/fonts/[^\"]+)"\)', data)))
    for asset in assets:
        png = str(Path(asset).with_suffix(".png"))
        target = out / "graphics/firered/fonts" / Path(png).name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(donor / png, target)
        relative = str(target.relative_to(out))
        changed.append(relative)
        provenance.append({"source": png, "destination": relative, "sha256": hashlib.sha256((donor / png).read_bytes()).hexdigest()})
        extension = Path(asset).suffix.replace(".fwlatfont", ".latfont")
        data = data.replace('INCBIN_U16("' + asset + '")', 'INCGFX_U16("' + relative + '", "' + extension + '")')
    data = _adapt(data)
    functions = "\n\n".join(_adapt(_function(source, prefix + suffix)) for suffix, _, _ in FONT_SPECS for prefix in ("FontFunc_", "DecompressGlyph_", "GetGlyphWidth_"))
    write("src/data/firered/fonts.h", data + "\n")
    write("src/data/firered/font_functions.h", functions + "\n")
    if "FR_FONT_MALE" not in header:
        header = header.replace("    FONT_BOLD, // JP glyph set only", "    FONT_BOLD, // JP glyph set only\n" + "\n".join("    FR_FONT_" + constant + " = " + str(index) + "," for _, constant, index in FONT_SPECS))
        if "FR_FONT_MALE = 10" not in header:
            raise ValueError("native font enum anchor changed")
        write("include/text.h", header)
    if '"data/firered/fonts.h"' not in native:
        prototypes = "\n".join("static " + ret + " FR_" + name + suffix + args + ";" for suffix, _, _ in FONT_SPECS for ret, name, args in (("u16", "FontFunc_", "(struct TextPrinter *)"), ("void", "DecompressGlyph_", "(u16, bool32)"), ("u32", "GetGlyphWidth_", "(u16, bool32)")))
        native = native.replace('#include "fonts.h"', '#include "fonts.h"\n#include "data/firered/fonts.h"\n\n' + prototypes)
        native = _append_initializer(native, "sGlyphWidthFuncs", "\n".join("    { FR_FONT_" + constant + ", FR_GetGlyphWidth_" + suffix + " }," for suffix, constant, _ in FONT_SPECS))
        donor_infos = _array(menu, "gFontInfos")
        entries = []
        for suffix, constant, _ in FONT_SPECS:
            entry = re.search(r"\[FONT_" + constant + r"\]\s*=\s*\{.*?\n    \},", donor_infos, re.S)
            if entry is None:
                raise ValueError("missing exact donor FontInfo " + constant)
            entries.append("    " + _adapt(entry[0]))
        native = _append_initializer(native, "sFontInfos", "\n".join(entries))
        native = _append_initializer(native, "sMenuCursorDimensions", "\n".join("    [FR_FONT_" + constant + "] = { 8, " + ("13" if suffix == "Small" else "14") + " }," for suffix, constant, _ in FONT_SPECS))
        anchor = "        case FONT_SMALL:\n            DecompressGlyph_Small(currChar, textPrinter->japanese);"
        if native.count(anchor) != 1:
            raise ValueError("native RenderText glyph switch anchor changed")
        dispatch = "\n".join("        case FR_FONT_" + constant + ":\n            FR_DecompressGlyph_" + suffix + "(currChar, textPrinter->japanese);\n            break;" for suffix, constant, _ in FONT_SPECS)
        native = native.replace(anchor, dispatch + "\n" + anchor)
        native += '\n// Exact donor glyph readers use the native printer/glyph ABI.\n#include "data/firered/font_functions.h"\n'
        write("src/text.c", native)
    # Small FR glyphs use their original halfwidth Latin packing, which Emerald
    # does not expose. Extend the existing gbagfx tool with only that format.
    tool_font = (out / "tools/gbagfx/font.c").read_text()
    tool_header = (out / "tools/gbagfx/font.h").read_text()
    tool_main = (out / "tools/gbagfx/main.c").read_text()
    if "void WriteHalfWidthLatinFont(" not in tool_font:
        tool_font += "\n" + _function(donor_converter, "ConvertToHalfWidthLatinFont") + "\n" + _function(donor_converter, "WriteHalfWidthLatinFont") + "\n"
        tool_header = tool_header.replace("#endif", "void WriteHalfWidthLatinFont(char *path, struct Image *image);\n\n#endif")
        donor_main = (donor / "tools/gbagfx/main.c").read_text()
        tool_main = tool_main.replace("int main(int argc, char **argv)", _function(donor_main, "HandlePngToHalfWidthLatinFontCommand") + "\n\nint main(int argc, char **argv)")
        tool_main = tool_main.replace('{ "png", "latfont", HandlePngToLatinFontCommand },', '{ "png", "latfont", HandlePngToLatinFontCommand },\n        { "png", "hwlatfont", HandlePngToHalfWidthLatinFontCommand },')
        write("tools/gbagfx/font.c", tool_font)
        write("tools/gbagfx/font.h", tool_header)
        write("tools/gbagfx/main.c", tool_main)
    changed.extend(["charmap.txt", "include/text.h", "src/text.c", "src/data/firered/fonts.h", "src/data/firered/font_functions.h", "tools/gbagfx/font.c", "tools/gbagfx/font.h", "tools/gbagfx/main.c"])
    source_files = [donor / "src/text.c", donor / "src/new_menu_helpers.c", donor / "tools/gbagfx/font.c", donor / "tools/gbagfx/main.c", base / "src/text.c", base / "include/text.h", base / "tools/gbagfx/font.c"]
    ledger = {"schema": "whole-game-fonts/v1", "status": "complete", "buildEligible": True, "unresolved": [], "changedFiles": sorted(set(changed)), "coverage": {"fontIds": {"FR_FONT_" + constant: index for _, constant, index in FONT_SPECS}, "nativeIdsPreserved": list(range(10)), "glyphArrays": len(arrays), "originalAssets": len(assets), "adaptedFunctions": len(FONT_SPECS) * 3, "fontInfos": len(FONT_SPECS), "charmapAliases": len(FONT_SPECS), "glyphAliases": {"‥": "B0", "LEFT_PAREN": "F9 13", "RIGHT_PAREN": "F9 14", "DPAD_ANY": "F8 0C"}}, "assetProvenance": provenance, "sourceProvenance": [{"game": "firered" if donor in path.parents else "emerald", "path": str(path.relative_to(donor if donor in path.parents else base)), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()} for path in source_files], "converterEquivalence": equivalent, "abiChanges": ["new font IDs10..14 appended; existing0..9 unchanged", "donor TextPrinterSubStruct glyphId/hasGlyphIdBeenSet mapped to native fontId/hasFontIdBeenSet", "donor128byte glyph pixels mapped to native TextGlyph first128bytes", "positive s32 glyphwidth return type adapted to native u32 callback"], "verification": {"romBuild": "not run by source transformer", "onDeviceRendering": "unavailable; requires integrated native UI playthrough"}}
    if report_dir is not None:
        report = Path(report_dir)
        report.mkdir(parents=True, exist_ok=True)
        (report / "fonts-ledger.json").write_text(json.dumps(ledger, indent=2) + "\n")
    return ledger


def _png_packed_pixels(path):
    """Decode donor indexed 2-bit PNG scanlines without optional dependencies."""
    data = path.read_bytes()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError("not a PNG: " + str(path))
    width, height, depth, color, compression, filtering, interlace = struct.unpack('>IIBBBBB', data[16:29])
    if (width, depth, color, compression, filtering, interlace) != (256, 2, 3, 0, 0, 0):
        raise ValueError("unsupported donor font PNG format")
    compressed, pos = bytearray(), 8
    while pos < len(data):
        size = struct.unpack('>I', data[pos:pos + 4])[0]
        if data[pos + 4:pos + 8] == b'IDAT':
            compressed.extend(data[pos + 8:pos + 8 + size])
        pos += 12 + size
    scanlines = zlib.decompress(compressed)
    stride, decoded, previous = width // 4, bytearray(), bytearray(width // 4)
    if len(scanlines) != height * (stride + 1):
        raise ValueError("invalid donor PNG scanline length")
    for row in range(height):
        kind = scanlines[row * (stride + 1)]
        current = bytearray(scanlines[row * (stride + 1) + 1:(row + 1) * (stride + 1)])
        for x in range(stride):
            left, above, upper_left = (current[x - 1] if x else 0), previous[x], (previous[x - 1] if x else 0)
            if kind == 1:
                prediction = left
            elif kind == 2:
                prediction = above
            elif kind == 3:
                prediction = (left + above) // 2
            elif kind == 4:
                estimate = left + above - upper_left
                distances = [abs(estimate - left), abs(estimate - above), abs(estimate - upper_left)]
                prediction = (left, above, upper_left)[distances.index(min(distances))]
            elif kind == 0:
                prediction = 0
            else:
                raise ValueError("unknown PNG filter")
            current[x] = (current[x] + prediction) & 255
        decoded.extend(current)
        previous = current
    return bytes(decoded), height // 16


def verify_fonts(base, donor, out, report_dir=None, compiler="cc"):
    """Compile and execute original/adapted readers against actual donor pixels.

    This checks all defined Latin/Japanese glyph metrics and the complete 128byte
    expanded pixel buffers. It is a native C check, not a ROM or display test.
    """
    base, donor, out = map(Path, (base, donor, out))
    source = (donor / "src/text.c").read_text()
    native_source = (base / "src/text.c").read_text()
    generated = (out / "src/data/firered/font_functions.h").read_text()
    donor_converter = (donor / "tools/gbagfx/font.c").read_text()
    native_converter = (base / "tools/gbagfx/font.c").read_text()
    arrays = sorted(set(re.findall(r"\bsFont\w+", "\n".join(_function(source, "DecompressGlyph_" + suffix) + _function(source, "GetGlyphWidth_" + suffix) for suffix, _, _ in FONT_SPECS))))
    prologue = '''#include <stdint.h>
#include <stdio.h>
#include <string.h>
typedef uint8_t u8; typedef uint16_t u16; typedef uint32_t u32; typedef int32_t s32; typedef uint32_t bool32;
#define TRUE 1
#define UNUSED
struct TextGlyph { u32 gfxBufferTop[16]; u32 gfxBufferBottom[16]; u8 width; u8 height; };
struct { u8 pixels[128]; u8 width; u8 height; } gGlyphInfo;
struct TextGlyph gCurGlyph;
static u16 sFontHalfRowLookupTable[0x51];
static u16 sLastTextBgColor, sLastTextFgColor, sLastTextShadowColor;
'''
    parts = [prologue, _array(native_source, "sFontHalfRowOffsets"), _function(native_source, "GenerateFontHalfRowLookupTable"), _function(native_source, "GetLastTextColor"), _function(native_source, "DecompressGlyphTile")]
    init, checks, counts = [], [], {}
    converter_names = {".fwlatfont": "ConvertToFullWidthLatinFont", ".fwjpnfont": "ConvertToFullwidthJapaneseFont", ".hwlatfont": "ConvertToHalfWidthLatinFont"}
    for name in converter_names.values():
        parts.append(_function(donor_converter, name))
    for donor_name, native_name in (("ConvertToFullWidthLatinFont", "ConvertToLatinFont"), ("ConvertToFullwidthJapaneseFont", "ConvertToFullwidthJapaneseFont")):
        parts.append(_function(native_converter, native_name).replace(native_name, "Native_" + native_name))
    for name in arrays:
        array = _array(source, name)
        asset = re.search(r'INCBIN_U16\("([^\"]+)"\)', array)
        if asset:
            path = Path(asset[1])
            pixels, rows = _png_packed_pixels(donor / path.with_suffix(".png"))
            size = len(pixels)
            parts.append("static unsigned char input_" + name + "[] = {" + ",".join(map(str, pixels)) + "};")
            parts.append("static u16 " + name + "[" + str(size // 2) + "], FR_" + name + "[" + str(size // 2) + "];")
            converter = converter_names[path.suffix]
            init.append(converter + "(input_" + name + ", (unsigned char *)" + name + ", " + str(rows) + ");")
            native_name = {".fwlatfont": "Native_ConvertToLatinFont", ".fwjpnfont": "Native_ConvertToFullwidthJapaneseFont", ".hwlatfont": "ConvertToHalfWidthLatinFont"}[path.suffix]
            init.append(native_name + "(input_" + name + ", (unsigned char *)FR_" + name + ", " + str(rows) + ");")
            init.append("if (memcmp(" + name + ", FR_" + name + ", sizeof(" + name + "))) return 2;")
            counts[name] = size // (32 if path.suffix == ".hwlatfont" or "SmallJapanese" in name or "TallJapanese" in name else 64)
        else:
            parts.append(array)
            parts.append(_adapt(array))
            numbers = re.findall(r"\b\d+\b", array.split("{", 1)[1])
            counts[name] = len(numbers)
    cases = 0
    for suffix, _, _ in FONT_SPECS:
        for prefix in ("DecompressGlyph_", "GetGlyphWidth_"):
            parts.append(_function(source, prefix + suffix))
            parts.append(_function(generated, "FR_" + prefix + suffix))
        latin_count = counts["sFont" + suffix + "LatinGlyphWidths"]
        if suffix in ("Small", "NormalCopy1"):
            japanese_count = counts["sFontSmallJapaneseGlyphs" if suffix == "Small" else "sFontTallJapaneseGlyphs"]
        else:
            japanese_count = counts["sFont" + suffix + "JapaneseGlyphWidths"]
        cases += latin_count + japanese_count
        for japanese, count in ((0, latin_count), (1, japanese_count)):
            checks.append('''for (unsigned i = 0; i < COUNT; i++) {
    memset(&gCurGlyph, 0, sizeof(gCurGlyph)); memset(&gGlyphInfo, 0, sizeof(gGlyphInfo));
    DecompressGlyph_SUFFIX(i, JP); FR_DecompressGlyph_SUFFIX(i, JP);
    if ((u32)GetGlyphWidth_SUFFIX(i, JP) != FR_GetGlyphWidth_SUFFIX(i, JP)) return 3;
    if (memcmp(gGlyphInfo.pixels, &gCurGlyph, 128) || gGlyphInfo.width != gCurGlyph.width || gGlyphInfo.height != gCurGlyph.height) { fprintf(stderr, "glyph mismatch: SUFFIX %u %u\\n", i, JP); return 4; }
}'''.replace("COUNT", str(count)).replace("SUFFIX", suffix).replace("JP", str(japanese)))
    parts.append("int main(void) {\nGenerateFontHalfRowLookupTable(2,1,3);\n" + "\n".join(init + checks) + '\nprintf("verified ' + str(cases) + ' glyph cases\\n");\nreturn 0;\n}\n')
    code = "\n\n".join(parts)
    start = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="firered-font-c-") as directory:
        directory = Path(directory)
        test_source = directory / "font_check.c"
        binary = directory / "font_check"
        test_source.write_text(code)
        compile_run = subprocess.run([compiler, "-std=c99", "-Wall", "-Werror", "-O1", str(test_source), "-o", str(binary)], text=True, capture_output=True)
        if compile_run.returncode:
            raise RuntimeError("compiled font verification failed:\n" + compile_run.stderr)
        result = subprocess.run([str(binary)], text=True, capture_output=True)
        if result.returncode:
            raise RuntimeError("glyph verification failed:\n" + result.stderr)
    report = {"schema": "whole-game-font-c-verification/v1", "outcome": "passed", "compiler": compiler, "durationSeconds": time.monotonic() - start, "glyphCases": cases, "fonts": len(FONT_SPECS), "originalAssets": len(set(re.findall(r'INCGFX_U16\("([^\"]+)"', (out / "src/data/firered/fonts.h").read_text()))), "widthAnd128ByteBufferChecks": "all defined source Latin/Japanese glyphs", "packedFontConverters": "exact donor/native conversion of original PNG pixels compared byte-for-byte", "stdout": result.stdout.strip(), "limitations": ["native C only; integrated ARM build not run", "font rendering on the GBA framebuffer not visually qualified"]}
    if report_dir is not None:
        directory = Path(report_dir)
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "compiled-font-check.c").write_text(code)
        (directory / "compiled-font-verification.json").write_text(json.dumps(report, indent=2) + "\n")
    return report
