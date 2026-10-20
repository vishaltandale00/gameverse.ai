# Exact FireRed fonts in the Emerald renderer

`tools/whole_game/single_rom/fonts.py` exposes `stage_fonts(base, donor, out, report_dir=None)` and `verify_fonts(base, donor, out, report_dir=None)`. The source stage appends these native font IDs without changing Emerald font IDs 0–9:

| Native ID | Exact donor font |
| --- | --- |
| 10 | `FR_FONT_MALE` |
| 11 | `FR_FONT_FEMALE` |
| 12 | `FR_FONT_NORMAL` |
| 13 | `FR_FONT_NORMAL_COPY_1` |
| 14 | `FR_FONT_SMALL` |

The port preserves nine original Latin/Japanese PNG assets, eighteen glyph/metric arrays, fifteen source functions, all five original FontInfo records, glyph-width registration and cursor dimensions. Native RenderText dispatches these IDs to the actual donor glyph readers. The only function adaptations are text-printer field names/storage, glyph buffer representation, static namespacing and the positive glyph-width return type expected by Emerald. Neither male nor female fonts alias Emerald normal.

The existing Emerald gbagfx fullwidth Latin and Japanese packing functions match the donor packing functions token-for-token after function-name/comment/whitespace normalization. The stage reuses them. The donor small Latin font needs its distinct halfwidth layout, so the stage adds the exact donor halfwidth packer, writer and handler to the existing gbagfx source. This adds no tool or dependency; that existing tool rebuilds when its source changes. No complete ROM build was run here, so its build-latency effect remains unmeasured.

Original donor aliases `‥ = B0`, `LEFT_PAREN = F9 13`, `RIGHT_PAREN = F9 14`, and `DPAD_ANY = F8 0C` are also preserved. Parentheses use the imported original font glyphs. The native/donor keypad PNG metadata differ, but conversion with the existing gbagfx tool produced identical original 4bpp bytes (SHA-256 `2f40b6ea6cb7a73a18ce8c4b33b85a33c74dcf2393505b55333207a846473024`), so `DPAD_ANY` reuses that exact shared glyph.

`FR_FONT_*` charmap aliases emit `FC 06` followed by native IDs 10–14. Donor script/text importers must rewrite the five corresponding font tags to these aliases. Raw donor font enum values are incompatible with Emerald; unported donor fonts remain outside this stage's coverage. This stage does not certify unrelated donor UI resources.

`compiled-font-check.c` is generated from original donor functions, the actual staged adapted functions, the original PNG pixels decoded without optional dependencies, and the existing native glyph tile decoder. The executable compares donor/native packed graphics byte-for-byte, then compares original/adapted glyph widths and all 128 expanded pixel bytes for every defined Latin and Japanese glyph: **4,424 cases**. Five focused unit tests verify these checks, original native table/index preservation, original asset digests, deterministic repeat transformation and rejection of canonical source destinations.

`fonts-ledger.json` records source/asset digests and the exact closure. `compiled-font-verification.json` and `validation.json` record actual timings and limitations. The source dependency closure is complete; integrated ARM compilation, framebuffer rendering and complete campaign play remain separate qualification gates. No previous exact-font converter existed, so a comparable before measurement is unavailable.
