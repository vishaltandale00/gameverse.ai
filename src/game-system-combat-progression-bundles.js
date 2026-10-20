// Multiple facets describe one source module. Import its assembly once and retain
// the same state owner across cards; facets never authorize extra instances.
const base = 'research/ir-workshop/game-system-assembly-20261016';
const own = `${base}/combat-progression-bundles`;
const source = (game, file = 'system.json') => `research/deep-extraction/resume/${game}/next-extraction/${file}`;
const facet = (roleId, capability, status, scope, evidence) => ({roleId, capability, status, scope, evidence});
const assembly = (id, label, stem, packageIds, scope) => ({id, label, assemblyRef: `${own}/${stem}.assembly.json`, validationRef: `${own}/${stem}.validation.json`, packageIds, scope, runtimeQualified: false, readyToAdd: true});
const mzmEvidence = [`${base}/closure/system.json`];
const minishEvidence = [`${base}/progression/system.json`];
const ariaEvidence = [source('castlevania-aria-of-sorrow', 'l2-subsystem.json')];
const warioEvidence = [source('wario-land-4'), 'research/deep-extraction/resume/wario-land-4/coverage-pass/source-contract.json'];
const tekkenEvidence = ['research/deep-extraction/resume/tekken-advance/coverage-pass/system-materialize-v3.json', 'research/deep-extraction/resume/tekken-advance/coverage-pass/result-manifest.json'];

export const COMBAT_PROGRESSION_CAPABILITY_BUNDLES = [
  {
    id: 'mzm-damage-reaction-bundle', existingCandidateIds: ['mzm-beam-combat-source', 'mzm-contact-admission-source'],
    label: 'Accepted damage, lethal state & hit recovery · Metroid Zero Mission',
    sourceGame: 'metroid-zero-mission', sourceSystemId: 'mzm.system.ordinary-beam-contact-reaction', moduleId: 'mzm.enemy.accepted-damage-and-reaction',
    availability: 'published-subset', packageIds: ['mzm.combat.impact', 'mzm.combat.reaction_tick'],
    scope: 'One post-contact enemy module subtracts HP, records lethal state and advances packed hit-reaction/palette state on a later eligible enemy update.',
    roleFacets: [
      facet('contact', 'admit an ordinary-beam contact', 'source-only', 'Eligibility, priority, AABB and vulnerability guards remain outside the usable core.', mzmEvidence),
      facet('reaction', 'apply accepted damage and later visible hit recovery', 'published-subset', 'HP, packed reaction, freeze and palette selector share one canonical enemy; rendering remains external.', mzmEvidence),
      facet('defeat', 'report lethal damage and source pose transition', 'published-subset', 'Source lethal return and state transition are preserved. Species death, drop, reward and retirement are not implemented by this core.', mzmEvidence),
    ],
    canonicalState: {identity: 'one selected live enemy plus host world contact state', fields: ['enemy_hp:u16', 'enemy_reaction:u8 packed marker/countdown', 'enemy_freeze:u8', 'enemy_palette_selector', 'pose/flags/link', 'world_player_contact_state'], aliasRule: 'Enemy DMA scratch is a temporary view. Damage and reaction commit to the same enemy record; host synchronizes the shared world contact byte across enemies.'},
    sourceOrder: ['host accepts one damaging contact', 'apply_accepted_damage once', 'commit same enemy and world contact state', 'next eligible scheduler prepass: advance_eligible_reaction', 'external species death/drop continuation'],
    settings: ['Incoming damage and initial HP are source u16 values 0..65535; defaults 3 and10 are fixture inputs.', 'Reaction low seven bits are countdown; high bit is contact marker. Do not scale the packed byte or infer60Hz.'],
    missingServices: ['contact acceptance and vulnerability', 'live enemy identity and eligible scheduler', 'impact allocation/projectile retirement', 'species death/drop/retirement', 'palette assets and renderer'],
    gaps: ['This is usable post-contact logic, not a complete combat encounter or enemy AI.', 'No composed original-ROM gameplay parity is claimed.'], evidence: mzmEvidence,
    recoveredAssembly: {id: 'mzm.enemy.accepted-damage-and-reaction', label: 'Accepted damage → later reaction', descriptorRef: `${base}/closure/system.json`, assemblyRef: `${base}/closure/damage-reaction.assembly.json`, validationRef: `${base}/closure/damage-reaction.validation.json`, packageIds: ['mzm.combat.impact', 'mzm.combat.reaction_tick'], scope: 'Existing compiled source L1 core; explicit accepted-contact and later eligible-reaction phases.', runtimeQualified: false, readyToAdd: true},
  },
  {
    id: 'minish-learning-bundle', existingCandidateIds: ['minish-learning-capabilities'], sourceOnlyCandidateIds: ['minish-learned-ability-source'],
    label: 'Learned ownership, capability refresh & equipped input · Minish Cap',
    sourceGame: 'legend-of-zelda-the-the-minish-cap', sourceSystemId: 'tmc.learned_sword_charge_release', moduleId: 'tmc.learned_sword_charge_release',
    availability: 'published-subset', packageIds: ['tmc.progress.inventory_write', 'tmc.progress.derive_skills', 'tmc.input.held_equipped_item'],
    scope: 'One persistent learned-state bank supplies a derived skill cache and separate equipped held-input query. The same source module describes sword consumers without claiming portable charged attacks.',
    roleFacets: [
      facet('ownership', 'record learned technique state preserving neighbors', 'published-subset', 'A four-state two-bit slot is persistent ownership; only state1 confers a skill. It is not an item count.', minishEvidence),
      facet('benefit', 'derive usable capability mask', 'published-subset', 'Refresh explicitly after transaction; no implicit equip, action admission or automatic refresh.', minishEvidence),
      facet('benefit', 'charge, release and use learned spin attack', 'source-only', 'Requires source animation events, live sword actor ownership, terrain/effect services and cleanup.', minishEvidence),
      facet('commit', 'deliver and save a learned reward', 'source-only', 'Trainer/script delivery, save transaction and reload ordering are host obligations.', minishEvidence),
    ],
    canonicalState: {identity: 'one player/session learned bank, derived cache and canonical sword activation', fields: ['inventory[64]:u8 packed256 two-bit slots', 'skills:u16', 'item_identity:u8', 'equipped_A/B:u8', 'held_buttons:u16', 'canonical live sword handle'], aliasRule: 'Every write and refresh shares one bank; skill cache aliases future sword consumers. Never import separate inventory copies for ownership and benefit cards.'},
    sourceOrder: ['external reward/trainer script calls transaction', 'explicit derived skill refresh before next eligible action', 'read equipped held input (A matching slot before B)', 'source-only swing completion → charge entry → charge ticks → ready/release → spin actor → owner-sensitive cleanup'],
    settings: ['Base spin technique0x48 and faster charge technique0x73 may be learned/unlearned at transaction entry.', 'Charge80/40 eligible updates are recovered source constants, not free prefab knobs.', 'Fixture zero bank must be replaced by imported accepted campaign bank in a real host.'],
    missingServices: ['reward/trainer interpreter and durable save', 'input/equipment ownership', 'source animation event stream', 'canonical entity allocator/scheduler and sword handle', 'terrain/contact/audio and DMA item-context release'],
    gaps: ['Equipped held input is read-only input state, not proof of learned capability.', 'Full portable sword action/lifecycle remains open.'], evidence: minishEvidence,
    recoveredAssembly: {id: 'tmc.learned_sword_charge_release', label: 'Learned ownership → derived capabilities', descriptorRef: `${base}/progression/system.json`, assemblyRef: `${base}/progression/learning.assembly.json`, validationRef: `${base}/progression/learning.validation.json`, verificationRef: `${base}/progression/verification.json`, packageIds: ['tmc.progress.inventory_write', 'tmc.progress.derive_skills', 'tmc.input.held_equipped_item'], scope: 'Existing automatic transaction/refresh/input-query core; sword consumer is source-only.', runtimeQualified: false, readyToAdd: true},
  },
  {
    id: 'aria-soul-ownership-bundle', existingCandidateIds: ['aria-ownership-source'],
    label: 'Soul ownership & acquisition transaction · Aria of Sorrow',
    sourceGame: 'castlevania-aria-of-sorrow', sourceSystemId: 'aria.soul_inventory_to_cast_lifecycle', moduleId: 'aria.soul_inventory_to_cast_lifecycle',
    availability: 'published-subset', packageIds: [0, 1, 2, 3].map(category => `aria.progress.category${category}_acquire`),
    scope: 'Choose one category-specialized original acquisition root. It includes the source ownership query and conditional bank adjustments internally; no separate counter, rollback or adjustment cards need instantiating.',
    roleFacets: [
      facet('ownership', 'acquire, handle duplicates and preserve neighboring soul counts', 'published-subset', 'Each category-specific original root has a retained512-vector finite native receipt, with exact category/index domains. It is not arbitrary runtime category switching.', ariaEvidence),
      facet('benefit', 'equip acquired soul and enable its action', 'source-only', 'Pickup→new/duplicate→acquire→progress→notification→autoequip is recovered call order, not emitted pickup/equip logic.', ariaEvidence),
      facet('commit', 'persist world claim and campaign progression', 'source-only', 'World pickup marker, save and progression consumers remain external to bank mutation.', ariaEvidence),
    ],
    canonicalState: {identity: 'campaign-owned canonical packed soul bank pair for selected category', fields: ['category0:56 bytes /56 indices', 'category1:26 bytes /26 indices', 'category2:36 bytes /36 indices', 'category3:4 bytes /8 indices (both bank views alias)'], aliasRule: 'Two four-bit entries per byte; preserve opposite nibble. Category3 final bank0 update must reread after bank1 adjustment on the same four bytes.'},
    sourceOrder: ['read bank1 nibble', 'if bank1 zero or delta<1: adjust bank0', 'otherwise count both banks', 'conditionally roll back bank1 if signed16(low8(count)+delta)>9', 'adjust bank0 observing earlier bank1 write'],
    settings: ['Select one category-specific graph; category and legal index range are fixed by its source domain:0..55 /0..25 /0..35 /0..7.', 'Delta uses source signed/narrowing arithmetic; selected nibble is signed8-added then clamped0..9.', 'Prefab bank zeroes and index0/delta1 are synthetic inputs; import accepted campaign state rather than reset it.'],
    missingServices: ['pickup admission, legal category/index and world claimed marker', 'ability enable and soul autoequip', 'MP/descriptor/free-slot casting closure', 'entity allocation, affine ownership, contact/culling and parent-sensitive retirement', 'save and notifications'],
    gaps: ['Bank acquisition is qualified within finite category domains; pickup/equip/cast/effect lifecycle is source-only.', 'No full combat, soul ability or campaign progression claim.'], evidence: ariaEvidence,
    recoveredAssembly: {...assembly('aria.soul.acquire.category3', 'Canonical aliased-bank acquisition (category3)', 'aria-category3', ['aria.progress.category3_acquire'], 'One original transaction over shared4-byte bank; no pickup or action behavior.'), descriptorRef: ariaEvidence[0]},
    assemblyVariants: [0, 1, 2, 3].map(category => ({...assembly(`aria.soul.acquire.category${category}`, `Category${category} soul acquisition`, `aria-category${category}`, [`aria.progress.category${category}_acquire`], 'Mutually exclusive category specialization of the same source module; import one selected category.'), category})),
  },
  {
    id: 'wario-protection-query-bundle', existingCandidateIds: [],
    label: 'Protection eligibility queries · Wario Land4', sourceGame: 'wario-land-4', sourceSystemId: 'wario-land-4.normal-form-protection-hazard', moduleId: 'wario-land-4.normal-form-protection-hazard',
    availability: 'published-subset', packageIds: ['wl4.protection.test_protected_zero_selector'],
    scope: 'One source zero-selector protection query reads the canonical player protection count and writes a typed stored predicate result. No detached bitset helpers or timer mutation are included.',
    roleFacets: [
      facet('contact', 'query protection eligibility from the canonical timer', 'published-subset', 'The actual stored field_0 predicate is bound as protected_predicate:u32. Full return bitset lacks return_meaning and is not captured. This query does not establish terrain or hit admission.', warioEvidence),
      facet('reaction', 'hurt entry, recovery and protection expiration', 'source-only', 'Hurt sets1, recovery from action0x13/0x14 seeds0x60, eligible callback decrements; renderer may clear protection for form>1.', warioEvidence),
      facet('contact', 'admit terrain hazard after protection expiration', 'source-only', 'Hazard consumes the same timer==0; terrain, callback ABI and resource-loss closure remain open.', warioEvidence),
    ],
    canonicalState: {identity: 'one canonical player normal-form protection lifetime and external query records', fields: ['form:u8', 'action:u8', 'protection_ticks:u8', 'protection_aged_this_tick:u8', 'world.presentation_clock:u8'], aliasRule: 'Hurt/recovery, age, hazard and presentation read/write the same player timer; aged flag can remain1 on the invocation where timer becomes0.'},
    sourceOrder: ['source-only hurt entry seeds1', 'source-only recovery seeds0x60', 'eligible age callback (not action0x13/0x14) decrements', 'hazard consumes zero timer; exact relative callback ordering still open', 'renderer can clear timer/aged flag for form>1'],
    settings: ['Timer units are eligible callback invocations, not assumed video frames.', 'Admitted graph starts at96 as a source-observed fixture sample; it does not execute recovery or age the timer.', 'Predicate selectors remain private zero/default; no dynamic selector exposed.'],
    missingServices: ['hurt/recovery/age executable roots', 'bounded terrain map lookup', 'normal-form callback trampoline ABI', 'resource-loss closure', 'presentation clock/palette update'],
    gaps: ['Single-call prefab exposes the written typed predicate; it does not implement a terrain hazard or hit-admission controller.', 'Return meanings are absent. Complement/read/tag helpers are omitted; no return capture or predicate-to-bitset bridge is fabricated.'], evidence: warioEvidence,
    recoveredAssembly: {...assembly('wl4.protection.query_subset', 'Stored protection predicate query', 'wario-protection', ['wl4.protection.test_protected_zero_selector'], 'Actual typed stored predicate output; query-only, no protection timer mutation or hazard admission.'), descriptorRef: warioEvidence[0]},
  },
  {
    id: 'tekken-actor-geometry-bundle', existingCandidateIds: [], planIds: ['combat-encounter'],
    label: 'Actor geometry publication & cleanup · Tekken Advance', sourceGame: 'tekken-advance', sourceSystemId: 'tekken.actor_box_contact_phase', moduleId: 'tekken.actor_box_contact_phase',
    availability: 'published-subset', packageIds: ['tekken.collision.materialize_actor_boxes', 'tekken.collision.clear_actor_boxes'],
    scope: 'One actor owns four local/world box records. Qualified materialization and clearing share that geometry; no separate box object is created for the contact card.',
    roleFacets: [
      facet('contact', 'materialize actor world-space contact geometry', 'published-subset', 'Normal and mirrored materialization plus geometry clearing are qualified individual functions; overlap/separation and impact remain open.', tekkenEvidence),
      facet('contact', 'clear actor geometry on initialization or tag/swap lifecycle', 'published-subset', 'Clear mutates the same box backing. It is a geometry reset, not save commit or actor destruction.', tekkenEvidence),
      facet('reaction', 'apply separation, impact/HP and KO effects', 'source-only', 'Full4×4 separator, impact, downstream contact-bit consumer and source scheduler remain unqualified.', tekkenEvidence),
    ],
    canonicalState: {identity: 'one canonical actor record with embedded local/world box arrays', fields: ['position x/y/depth:i32', 'previous x/y:i32', 'frame flags:u32', 'separation-disable bit3', 'local_boxes[4]:20-byte records', 'world_boxes[4]:20-byte records'], aliasRule: 'All box producer/clear/consumer phases alias actor backing. The prefab clears first and then publishes, retaining final geometry until a real consumer; cleanup is a later explicit lifecycle operation.'},
    sourceOrder: ['source init/tag-swap clears embedded geometry', 'movement uses canonical actor position/history', 'geometry phase materializes local boxes into world boxes', 'future separator consumes prior geometry before integration; full scheduler closure open'],
    settings: ['Actor x/y use sourceQ8 positions; depth axis interpretation remains pending.', 'Mirroring and native signed/wrapping arithmetic are preserved; inclusive touching and strict magnitude ties cannot be replaced by generic float collision rules.', 'The admitted clear-first→materialize graph is an explicit caller initialization/publication sample. Final geometry remains available; later cleanup requires a separate lifecycle invocation.'],
    missingServices: ['complete source scheduler and snapshot/integration', 'qualified4×4 separator', 'input/AI/script and animation dispatch', 'attack/hurt contact and impact/HP/KO/round progression'],
    gaps: ['Individual geometry functions have finite native evidence; composed native execution remains unproven.', 'No full fighting system, damage policy or enemy AI supplied.'], evidence: tekkenEvidence,
    recoveredAssembly: {...assembly('tekken.actor.geometry_publication_reset', 'Initialize actor boxes → publish geometry', 'tekken-geometry', ['tekken.collision.materialize_actor_boxes', 'tekken.collision.clear_actor_boxes'], 'Caller-declared clear-first initialization then geometry publication over shared boxes; final boxes remain available. No collision decision or full source frame lifecycle.'), descriptorRef: tekkenEvidence[0]},
  },
];
