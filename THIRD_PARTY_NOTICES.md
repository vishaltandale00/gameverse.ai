# Third-party material

The root [MIT license](LICENSE) applies to original Gameverse material. It does not relicense third-party code, assets, trademarks, quoted text or tool-output excerpts referenced or retained for research.

| Material | Source and scope |
| --- | --- |
| `research/pokemon/forest-candidate.patch` | A research diff against [pret/pokefirered](https://github.com/pret/pokefirered) at `037335f4c725d7c9aecdac87066f2002b4bd7e14`; upstream portions are excluded from the Gameverse MIT grant. |
| `research/pokemon/firered-build-tail.log` | Retained FireRed build diagnostics; not a game artifact or working toolchain. |
| `research/pokemon/kanto_validator.log` | Tool-output excerpts from [peach231/pokemon-kanto](https://github.com/peach231/pokemon-kanto), with the pinned audit context in [audit-results.json](research/pokemon/audit-results.json). |
| Other research links, quotations and logs | Attribution and observed limitations remain in the research documents and adjacent audit records; upstream rights are retained. |

The 2026-10-14 source audit did not establish explicit permissive licensing for the audited game-source checkouts. The Gameverse license does not grant rights to distribute those games, their assets or an emulator. Evaluate the exact third-party versions and permissions separately before adding a packaged runtime or game artifact.

No game ROMs, third-party source checkouts, game saves or emulator binaries are tracked in this repository. Development installs `@wasm-gaming/mgba-wasm@0.1.1` through npm and checks out pinned game/tool sources under ignored `vendor/`; generated artifacts remain local.

The [mGBA wrapper/core](https://github.com/wasm-gaming/mGBA-wasm) identifies MPL-2.0 licensing; its wasm/loader remain third-party dependencies. The Gameverse worker frontend calls its pinned ABI. [KarisaAdvynia/sma4-disasm](https://github.com/KarisaAdvynia/sma4-disasm) is the selected Mario assembly source; its required original graphics/sound are not supplied. [pret/agbcc](https://github.com/pret/agbcc) and [Armips](https://github.com/Kingcom/armips) are independent build-tool dependencies. These sources and their data are not covered by Gameverse's MIT license. See [DEVELOPMENT.md](DEVELOPMENT.md) for pins, local setup and evidence boundaries.
