# Crash source loop and blocked useful prefab

[delivery.json](delivery.json) follows the canonical recovered-prefab delivery contract. It maps source scene creation → input capture → actor/controller admission → phase-selected payload application → actor/world updates → rearm → scene outcome/cleanup. These are source boundaries, not a guessed universal frame schedule. Controller/global actor identity and stack payload separation remain explicit.

Both published apply variants retain their existing finite native proofs. A new full-IO graph uses the exact source phase-zero payload `(8,18,1280)` and binds actual actor outputs instead of discarding them. The real validator rejects it: **`state requires known quantity/frame: actorChannelA`** in **0.000268583 s**. The existing numeric payload/output package channels remain unknown; no units were invented. The proposed graph is retained for the backend owner and is not allowlisted.

A bounded attempt to lift the recovered phase producer again failed in **0.006640084 s** at nested actor pointer `v57`. Its exact compiler hash, source hash, traceback and reproducer are pinned in the delivery. Closing producer → apply → rearm requires canonical nested actor references, consumer method/mapping lowering and a source-backed observable numeric-channel contract/profile.

`prefabs` and [prefab-allowlist.json](prefab-allowlist.json) are deliberately empty. The older positive graph admitted only sign flags with private zero payload defaults; it is binding evidence and is not presented as a useful prefab. The two apply methods are source-selected alternatives, so chaining them would invent behavior.

Publication intake, compiler owner and product lead received the stable delivery and exact blockers. No shared files, native proofs, source ROMs or prior artifacts were changed. No JVM, generated game/ROM, manual C compiler input or native rerun was used.
