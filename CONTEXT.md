# Gameverse

Gameverse is a single-player browser environment for playing games and developing them through conversation.

## Language

**Base game**: The persistent playable home through which the player enters subgames and returns to their profile and library. Its presentation is independent of any particular subgame.
_Avoid_: FireRed as a synonym for Gameverse

**Shell**: The persistent player interface for identity, game navigation, shared controls, builder conversations and recovery, including while a game is active.

**Subgame**: An independently versioned playable game entered from the base game, with its own core loop and progress. Complete FireRed is the first substantial subgame target.
_Avoid_: Scene as a synonym for subgame

**Game version**: One immutable playable revision of the base game or a subgame.

**Play session**: One visit to a specific game version using a particular profile and progress record.

**Checkpoint**: A recoverable progress record associated with the exact game version that can resume it.
_Avoid_: Emulator snapshot as a synonym for a portable save

**Improvement request**: The player's submitted intent, attached to a specific game and baseline version.

**Proposal**: A versioned description of intended gameplay and the scenarios used to verify a candidate before it becomes available.

**Candidate**: A built game version awaiting verification or activation; it is separate from the accepted version the player is using.

**Update**: A new version of the same game that preserves recognized progress under the compatibility contract.

**Fork**: A separate game with its own progress and pinned parent lineage.

**Mashup**: A new game combining contributions from multiple pinned parent games into a playable core loop.

**Progress adapter**: An explicit, verified mapping of copied progress from one game's schema into another's.

**Improvement loop**: The recurring journey from player intent through proposal, build, verification and safe activation to further player feedback.
