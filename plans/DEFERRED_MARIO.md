# Deferred Mario source setup

Status: deferred on 2026-10-16. This game is excluded from the initial catalog and slice 1 acceptance. Existing source/tool pins remain in `games/sources.json` for a later explicit return to Mario.

The Mario project is an assembly disassembly, not a high-level C decompilation. Upstream describes a matching USA revision 1 build with labeled ROM pointers, while identifying remaining single-cartridge multiplayer regions and limited relocation testing. We have not verified that matching build or arbitrary Mario code changes. The native Windows recompilation is a different runtime and is not this GBA route.

Once the required local Mario base image exists:

```sh
npm run source:setup -- sma4
npm run game:build -- sma4 --base /absolute/path/to/sma4.gba
```

The script validates SHA-256 `53ec98fc672d94e3962ba854805ce5005e07e10a4c7ed4e7dbec7a2ca7846562`, invokes the pinned extraction code without its interactive ROM search, and assembles the editable source. The repository does not supply those original assets. CMake and Python 3 are also needed for this route. Armips setup/build and Mario gameplay are unqualified until those inputs are available.
