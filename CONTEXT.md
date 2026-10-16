# Gameverse

Gameverse is a single-player browser environment for playing games and developing them through conversation.

## Language

**Base game**: The versioned playable world that owns subgame discovery and the player's return experience. The initial world is intended to be reused from an existing game and remains replaceable.
_Avoid_: FireRed as a synonym for Gameverse

**Shell**: The persistent player interface for identity, game navigation, shared controls, builder conversations and recovery, including while a game is active.

**Subgame**: An independently versioned playable game entered from the base game, with its own core loop and progress. Complete FireRed is the first substantial subgame target.
_Avoid_: Scene as a synonym for subgame

**Game version**: One immutable playable revision of the base game or a subgame.

**Game config**: A versioned manifest describing a base game or subgame and referring to its settings and larger source, build, asset, artifact and adapter objects.

**Environment harness**: The independently versioned system that hosts game adapters, player and simulation sessions, progress and accepted-version activation.

**Build/improvement harness**: Shishir's independently versioned LLM system for initial game construction, simulation and later improvement of base games and subgames.

**Loop config**: A versioned description of the build/improvement algorithm and its model/tool, evaluation and resource policies.

**Play session**: One visit to a specific game version using a particular profile and progress record.

**Simulation session**: An isolated execution of a pinned game version using copied or fresh state rather than the player's accepted progress.

**Checkpoint**: A recoverable progress record associated with the exact game version that can resume it.
_Avoid_: Emulator snapshot as a synonym for a portable save

**Improvement request**: The player's submitted intent, attached to a specific game and baseline version.

**Proposal**: A versioned description of intended gameplay and the scenarios used to verify a candidate before it becomes available.

**Candidate**: A built game version awaiting verification or activation; it is separate from the accepted version the player is using.

**Submission**: A versioned candidate envelope passed from the build/improvement harness to the environment for registration or activation.

**Update**: A new version of the same game that preserves recognized progress under the compatibility contract.

**Fork**: A separate game with its own progress and pinned parent lineage.

**Mashup**: A new game combining contributions from multiple pinned parent games into a playable core loop.

**Progress adapter**: An explicit, verified mapping of copied progress from one game's schema into another's.

**Improvement loop**: The recurring journey from player intent through proposal, build, verification and safe activation to further player feedback.

### Factory and verification

**Game factory**: Gameverse's system for turning player intent into constructed, evaluated and accepted playable game versions.

**Construction agent**: The agent that proposes and produces candidate game changes.

**Gameplay agent**: The agent that plays a pinned game version in an isolated simulation session to pursue scenario goals and collect evidence.

**Verification plan**: The approved, versioned definition of the claims, checks and evidence required to assess a candidate.

**Game law**: A precisely stated property that a game's rules or state transitions must preserve, under declared assumptions.

**Decision circuit**: A versioned composition of evidence-based decision questions and rules for combining or routing their outcomes.

**Gameplay evaluation**: An assessment of requested behavior and player experience using actual game execution.

**Verifier**: The component that assesses candidate evidence against the approved verification plan.

**Verification evidence**: Retained observations, execution traces and check results associated with the exact candidate assessed.

**Verifier qualification**: Evaluation of the verification pipeline against known working, broken and ambiguous cases.
