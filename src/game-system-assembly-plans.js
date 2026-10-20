import {GAME_BLUEPRINT_ARCHETYPES} from './game-system-blueprint-archetypes.js';
import {COMBAT_PROGRESSION_CAPABILITY_BUNDLES} from './game-system-combat-progression-bundles.js';
import {MARIO_CAPABILITY_BUNDLES} from './game-system-mario-bundles.js';
import {MOVEMENT_CAPABILITY_BUNDLES} from './game-system-movement-bundles.js';
import {attachCapabilityBundles} from './game-system-capability-bundles.js';
// Player goals and integration requirements, not executable game definitions.
// Candidate evidence is source-scoped. Selecting a candidate records a design
// decision; neither package presence nor symbolic bindings certify a system.
export const GAME_SYSTEM_PLAN_SCHEMA = 'gameverse.game-system-assembly-plan/1';
const packet = (game, file = 'system.json') => `research/deep-extraction/resume/${game}/next-extraction/${file}`;
const candidate = (id, label, sourceGame, sourceSystemId, packageIds, scope, gaps, evidence, settings = []) => ({
  id, label, description: scope, sourceGame, sourceSystemId, packageIds,
  availability: packageIds.length ? 'published-subset' : 'source-only',
  scope, gaps, evidence, settings, runtimeQualified: false,
  integration: 'Suggested source module. Shared state, units, scheduling and services must be mapped explicitly; selecting it does not prove compatibility.',
});
const missing = (id, label, scope, gaps) => ({id, label, description: scope, availability: 'missing', packageIds: [], scope, gaps, evidence: [], runtimeQualified: false});
const role = (id, label, description, capability, candidates, dependsOn = []) => ({id, label, description, capability, required: true, minCount: 1, maxCount: 1, candidates, dependsOn});
const movement = candidate('sma1-traversal-source', 'Ground and air movement · Super Mario Advance', 'super-mario-advance', 'sma1.controller.grounded_motion_subsystem',
  ['sma.motion.sma1_friction', 'sma.motion.sma1_gravity_hover', 'sma.motion.sma1_jump_onset', 'sma.motion.sma1_integrate_y'],
  'Recovered controller structure relates input, acceleration, braking, jump, gravity, terrain and position integration. Published parts cover braking, jump onset, gravity/hover and vertical integration; the full controller is still open.',
  ['Horizontal acceleration and speed-cap controller closure are blocked.', 'Grounded jump admission, terrain response, horizontal integration and source services must be recovered together.', 'The jump → next gravity example crosses scheduler phases; it is not a complete frame update.'],
  ['research/deep-extraction/mario/parallel-sma1/next-extraction/l2-contract.json'],
  ['Review source character profile and jump settings within evidenced domains.', 'Choose input semantics and record a real grounded / airborne admission policy.']);
const sonic = candidate('sonic-traversal-source', 'Airborne control & terrain handoff · Sonic Advance', 'sonic-advance', 'sonic-advance.source-system.6ecb0c97fa', [],
  'An alternative source structure for ground and air motion, terrain contact and transitions. This offers a different controller design to inspect, not an interchangeable Mario motion module.',
  ['Whole controller is source-only.', 'Actor fields, terrain units, callbacks and scheduler need a source-specific implementation and qualification.'],
  ['research/deep-extraction/resume/sonic-advance/next-extraction/l2-contract.json']);
const camera = candidate('shaman-map-camera-source', 'Map pan and shared camera · Shaman King', 'shaman-king-master-of-spirits', 'shaman.camera.map_pan',
  ['shaman.input.held_read', 'shaman.camera.layer1_scroll_publish'],
  'Recovered map-view pan, bounded smooth follow and common camera projection for background and overlays. Published input read and layer-scroll publication are endpoints; the smooth camera is not executable.',
  ['Magnitude, normalization, division and exact overflow domains remain open.', 'Scene lifecycle, overlay lifetime and VBlank scheduling need closure.', 'Map-view pan is evidenced; following a playable character requires an explicit new target mapping.'],
  [packet('shaman-king-master-of-spirits')], ['Decide whether the camera target is a map cursor or an actor; the source supports a map target.']);
const contact = candidate('sma2-contact-source', 'Player–actor contact · Super Mario World', 'super-mario-advance-2-super-mario-world', 'super-mario-advance-2-super-mario-world.source-system.b378fc7032',
  ['sma2.player_contact_box', 'sma2.actor_contact_box', 'sma2.shared_contact_overlap', 'sma2.actor_player_relative_side'],
  'Prepare player and actor bounds in shared scene scratch, then test overlap and relative side. Useful contact preparation; it does not decide damage, stomping or rewards.',
  ['Capture overlap and relative-side results before applying a contact policy.', 'Player form, actor shape, scratch ownership and entity lifetime require real source values.', 'Collision between two actors is not a terrain solver.'],
  ['research/deep-extraction/mario/parallel-sma2/next-extraction/l2-contract.json']);
const beam = candidate('mzm-beam-combat-source', 'Beam contact and enemy reaction · Metroid Zero Mission', 'metroid-zero-mission', 'mzm.system.ordinary-beam-contact-reaction',
  ['mzm.combat.impact', 'mzm.combat.reaction_tick'],
  'Recovered ordinary-beam contact → guarded damage or reaction → deferred enemy update. Published damage/reaction and lifecycle parts provide bounded behavior; spawning, contact dispatch and the complete encounter remain open.',
  ['Ordinary beam firing, projectile allocation and contact dispatcher are not a closed executable system.', 'Enemy scratch must write back to the same canonical enemy record; arbitrary species AI is not supplied.', 'Death, drop selection, effect allocation, audio and indirect dispatch remain incomplete.'],
  [packet('metroid-zero-mission')], ['Inspect evidenced damage inputs and HP/reaction changes.', 'Preserve the source enemy-before-projectile order and deferred next-enemy-tick reaction.']);
const inventory = candidate('aria-ownership-source', 'Collectible ownership transaction · Aria of Sorrow', 'castlevania-aria-of-sorrow', 'aria.soul_inventory_to_cast_lifecycle',
  ['aria.progress.category0_acquire', 'aria.progress.category1_acquire', 'aria.progress.category2_acquire', 'aria.progress.category3_acquire'],
  'Recovered category-specific count / acquire / conditional bank adjustment transaction over shared inventory backing. Finite native evidence covers all four categories; pickup interaction, equip, casting and save behavior remain separate.',
  ['A world pickup must establish category/index legality, eligibility and a durable claimed marker.', 'Equipment, learned abilities, MP debit, effect pool ownership and notification consumers are not closed.', 'Do not treat inventory bank bytes as interchangeable item IDs or grant a full ability from acquisition alone.'],
  [packet('castlevania-aria-of-sorrow', 'l2-subsystem.json')], ['Choose a source category and a legal item index.', 'Inspect acquired count, duplicate handling and untouched neighboring inventory entries.']);
const sword = candidate('minish-learned-ability-source', 'Learned ability → charged action · Minish Cap', 'legend-of-zelda-the-the-minish-cap', 'tmc.learned_sword_charge_release', [],
  'Recovered learned-state refresh and capability-gated sword charge/release structure. It relates progression to a new action; the complete action lifecycle is not qualified.',
  ['Trainer/script delivery, refresh scheduling and save/reload remain open.', 'Animation events are necessary for charge entry and spin completion.', 'Item/entity ownership, interruption and release services must preserve lifecycle order.'],
  [packet('legend-of-zelda-the-the-minish-cap')]);

// Source-derived boundaries are distinct from the proposed cross-module plan edges.
// These are inspectable recovery records, not newly executable orchestrators.
movement.boundary = {
  entry: 'one eligible source player update',
  inputs: ['held and fresh button masks', 'canonical player motion/mode state', 'source frame phase', 'terrain view'],
  outputs: ['updated player velocity and position', 'action / airborne state', 'contact state'],
  events: ['grounded jump admission', 'directional hold / release', 'terrain contact'],
  exit: 'same player record after source terrain and position integration',
  sourceOrder: ['decay', 'gravity', 'controller', 'terrain', 'conditional edge response', 'integrate Y', 'integrate X'],
  sourceOrderStatus: 'static parent order; full executable closure unresolved',
  sharedIdentity: 'one original player record; terrain/controller views may not be detached copies',
};
sonic.recoveryDescriptorRef = 'research/ir-workshop/game-system-assembly-20261016/traversal/system.json';
sonic.boundary = {
  entry: 'original airborne branch (actor.flags & 6) == 2 on a persistent native actor',
  inputs: ['same actor backing', 'held / pressed source input', 'native acceleration / speed cap', 'world and terrain service references'],
  outputs: ['updated actor position / velocity', 'jump release limit', 'terrain handoff'],
  events: ['airborne update', 'jump release', 'air-to-ground contact'],
  exit: 'terrain handoff through the original landing host service; full landing remains open',
  sourceOrder: ['release / ability gates', 'air steer', 'world guard', 'integrate', 'gravity', 'angle relaxation', 'landing handoff'],
  sourceOrderStatus: 'recovered original source phase; ARM object compiles, composed native parity unavailable',
  sharedIdentity: 'Motion, Air and Jump are offset views of one persistent actor; no detached copies.',
};
sonic.settings = ['Inspect native air acceleration and speed-cap fields; no invented safe range.', 'Review jump-hold release limits and original jump impulse; landing still requires the native service.'];
sonic.scope = sonic.description = 'Recovered airborne steering, jump release, integration/gravity and terrain handoff on one original actor. The ARM source module compiles with mandatory native service ports; the full controller is not portable or runtime qualified.';
sonic.gaps = ['Original landing and directional terrain handlers remain mandatory host services.', 'Grounded control, task/input capture and ability bodies remain open.', 'The two-part integrate → gravity binding graph is only an internal air-advance subset, not the whole control system.'];
sonic.recoveredAssembly = {
  id: 'sonic.usa.character_traversal.air_phase', readyToAdd: false, label: 'Air integration → gravity subset',
  descriptorRef: sonic.recoveryDescriptorRef,
  assemblyRef: 'research/ir-workshop/game-system-assembly-20261016/traversal/air-advance.assembly.json',
  validationRef: 'research/ir-workshop/game-system-assembly-20261016/traversal/air-advance.validation.json',
  packageIds: ['sonic.motion.integrate', 'sonic.motion.gravity'],
  scope: 'Whole source air module requires native host services. Portable binding graph covers adjacent integrate → gravity stages sharing vertical velocity only.',
  runtimeQualified: false,
};
beam.boundary = {
  entry: 'accepted ordinary-beam hit on one live enemy; contact admission remains external',
  inputs: ['damage:u16', 'enemy HP:u16', 'packed reaction byte:u8', 'freeze byte:u8', 'source palette / pose / flags'],
  outputs: ['HP after damage', 'reaction countdown / marker', 'lethal pose and flags', 'later reaction display selector'],
  events: ['accepted hit', 'next eligible enemy update', 'species death continuation'],
  exit: 'same canonical enemy record after scratch writeback; death/drop services remain open',
  sourceOrder: ['enemy tick', 'projectile contact', 'guarded damage or minimum reaction', 'consume projectile', 'next eligible enemy reaction', 'species death / drop continuation'],
  sourceOrderStatus: 'source-root order; only bounded damage / reaction parts are published',
  sharedIdentity: 'HP, reaction, freeze and palette belong to one enemy. DMA scratch is a temporary view of the selected original record.',
};
beam.recoveredAssembly = {
  id: 'mzm.enemy.accepted-damage-and-reaction', readyToAdd: true,
  label: 'Accepted damage → later enemy reaction',
  descriptorRef: 'research/ir-workshop/game-system-assembly-20261016/closure/system.json',
  assemblyRef: 'research/ir-workshop/game-system-assembly-20261016/closure/damage-reaction-compat-20261016.assembly.json',
  packageIds: ['mzm.combat.impact', 'mzm.combat.reaction_tick'],
  inputs: [{id: 'damage', label: 'Accepted hit damage', storage: 'u16', min: 0, max: 65535, default: 3}, {id: 'enemy_hp', label: 'Initial enemy HP', storage: 'u16', min: 0, max: 65535, default: 10}],
  phases: [{id: 'damage', api: 'apply_accepted_damage', label: 'Apply an already accepted hit'}, {id: 'reaction', api: 'advance_eligible_reaction', label: 'Advance the next eligible enemy reaction'}],
  sharedState: ['enemy_hp', 'enemy_palette_selector', 'enemy_reaction', 'enemy_freeze'],
  scope: 'Post-contact damage and reaction core only. Input/contact admission, real enemy spawn, scheduler, rendering and death/drop continuation are external.',
  qualification: 'Read the current descriptor/validation receipt for composition evidence. Finite native component qualification does not certify composed gameplay.',
  runtimeQualified: false,
};
inventory.boundary = {
  entry: 'legal source category / index acquisition request after external pickup admission',
  inputs: ['category-specialized inventory view', 'legal index', 'signed source acquisition delta', 'canonical bank0 and bank1 backing'],
  outputs: ['updated inventory bytes', 'owned count on query', 'neighboring packed nibble preserved'],
  events: ['acquire', 'duplicate acquire', 'ownership query'],
  exit: 'same canonical bank backing; world claimed marker and equip/cast consumers remain external',
  sourceOrder: ['read bank1 nibble', 'conditional count query', 'conditional bank1 adjustment', 'bank0 adjustment observing prior write'],
  sourceOrderStatus: 'finite native-qualified acquisition roots across four categories; source category domains apply',
  sharedIdentity: 'Both bank views share source backing; category3 alias read-after-write must remain intact.',
};

const learning = {
  ...sword, id: 'minish-learning-capabilities', label: 'Learn techniques & refresh capabilities · Minish Cap',
  packageIds: ['tmc.progress.inventory_write', 'tmc.progress.derive_skills', 'tmc.input.held_equipped_item'], availability: 'published-subset',
  description: 'An explicit learned-state transaction changes persistent ownership; a later refresh derives the capability mask read by sword actions. Equipped held-input is a separate read-only boundary, not action permission.',
  scope: 'Portable source L1 core preserves the same packed learned-state bank across write → capability refresh. Compiled host checks cover learning, refresh, exact learned state and equipped-input precedence. The charged action consumer is still outside this core.',
  gaps: ['Deliver trainer/reward events and save the learned-state transaction through a real source caller.', 'Close the sword animation-event, live actor ownership and DMA cleanup dependencies before portable charged attacks work.', 'Only state1 confers a skill; these four-state slots are not item counts.'],
  evidence: [...sword.evidence, 'research/ir-workshop/game-system-assembly-20261016/progression/system.json'],
  settings: ['Learn base spin technique0x48, then explicitly refresh capabilities.', 'Learn faster charge technique0x73 in addition to base; native charge durations80/40 are source constants.', 'Inspect the source A-before-B equipped-input result; held does not mean ability admission.'],
  boundary: {
    entry: 'supplied legal learned-state transaction on the persistent player/session bank',
    inputs: ['one packed64-byte learned-state bank', 'source technique ID', 'two-bit learned state', 'equipped A/B and held input for separate query'],
    outputs: ['updated bank preserving neighbors', 'derived twelve-bit skill mask after explicit refresh', 'held equipped-item result'],
    events: ['learn or restore technique', 'refresh capabilities', 'sample equipped held input'],
    exit: 'same bank plus refreshed skill cache; sword consumer, reward delivery and save remain external',
    sourceOrder: ['write learned-state slot', 'explicit capability refresh', 'future legal-action skill read'],
    sourceOrderStatus: 'portable write / refresh core and separate input-query boundary compiled and checked; future sword action not emitted',
    sharedIdentity: 'All writes and refreshes share one persistent bank; skill cache aliases the future sword consumer.',
  },
  recoveredAssembly: {
    id: 'tmc.learned_sword_charge_release', readyToAdd: true, label: 'Learned ownership → derived capabilities',
    inputs: [{id: 'baseLearned', label: 'Base spin technique learned', type: 'boolean', default: true}, {id: 'fastLearned', label: 'Faster charge technique learned', type: 'boolean', default: true}],
    descriptorRef: 'research/ir-workshop/game-system-assembly-20261016/progression/system.json',
    assemblyRef: 'research/ir-workshop/game-system-assembly-20261016/progression/learning.assembly.json',
    validationRef: 'research/ir-workshop/game-system-assembly-20261016/progression/learning.validation.json',
    verificationRef: 'research/ir-workshop/game-system-assembly-20261016/progression/verification.json',
    packageIds: ['tmc.progress.inventory_write', 'tmc.progress.derive_skills', 'tmc.input.held_equipped_item'],
    phases: [{id: 'learn', api: 'learn_spin', label: 'Record base technique as learned'}, {id: 'refresh', api: 'refresh_capabilities', label: 'Refresh the source capability cache'}],
    scope: 'Automatic write / refresh and input-query boundary only. No portable sword animation, charged-action or trainer route is fabricated.',
    runtimeQualified: false,
  },
};

const beamContact = {
  ...beam, id: 'mzm-contact-admission-source', label: 'Beam contact admission · Metroid Zero Mission',
  packageIds: [], availability: 'source-only', recoveredAssembly: undefined,
  scope: 'Source contact dispatcher checks overlap, vulnerability and damage/guard branches before the damage core. That dispatcher remains unresolved; the damage core cannot accept arbitrary overlaps.',
  description: 'Source contact admission and vulnerability policy; not an executable contact module.',
};

export const GAME_SYSTEM_PLANS = [
  {
    schema: GAME_SYSTEM_PLAN_SCHEMA, id: 'character-traversal', label: 'Character control & traversal', recommendedStartRoleId: 'control',
    description: 'Build the path from a player pressing move or jump to a character moving through solid ground, landing safely and staying visible.',
    playerOutcome: 'Move, stop, jump, collide with terrain and land with a camera that presents the same world state.',
    runtimeQualified: false, status: 'assembly-plan',
    roles: [
      role('control', 'Movement & jump controller', 'Own the character’s motion modes and decide which actions are legal from current input.', 'character-control', [movement, sonic]),
      role('terrain', 'Solid terrain & landing', 'Resolve walls, floors, slopes and grounded state against one map before committing the actor pose.', 'terrain-contact', [candidate('kirby-terrain-source', 'Terrain probes & contact resolution · Kirby', 'kirby-nightmare-in-dream-land', 'kirby-nightmare-in-dream-land.terrain-contact-resolution', ['kirby-nightmare.terrain.left_displacement_shape1', 'kirby-nightmare.terrain.right_displacement_shape1', 'kirby-nightmare.terrain.vertical_displacement_shape1'], 'Recovered terrain sampling and contact resolution structure, with three published shape-1 displacement lookups. These lookups do not supply a map or complete collision resolution.', ['General shape selection, map extent and metadata domains are unresolved.', 'Shared probe scratch and actor load/writeback must preserve identity.', 'Combining this with a different movement source needs coordinate and contact semantics mapping.'], [packet('kirby-nightmare-in-dream-land')])], ['control']),
      role('camera', 'Camera & visible character', 'Project the committed actor/world state into one shared view for scenery and actors.', 'world-presentation', [camera], ['control', 'terrain']),
      role('recovery', 'Spawn, fall & respawn', 'Create one actor, recover from invalid falls and reset the right state on respawn.', 'actor-lifecycle', [missing('traversal-recovery-missing', 'Spawn / respawn policy needed', 'No complete traversal spawn/checkpoint/death policy is supplied by these modules.', ['Choose spawn legality, fall detection, checkpoint state and reset ownership.', 'Rendering, actor allocation and play-session input delivery still need implementation.'])], ['control', 'terrain']),
    ],
    sharedState: [
      {id: 'actor', owner: 'control', fields: ['stable actor identity', 'position', 'velocity', 'grounded / air mode', 'facing', 'current action'], rule: 'Controller, terrain and camera must observe the same actor. Source units and coordinate frames require an explicit mapping.'},
      {id: 'world', owner: 'terrain', fields: ['map bounds', 'solid geometry', 'contact results'], rule: 'Terrain writes collision results before the next action admission; camera reads the committed pose.'},
    ],
    dependencies: [{from: 'control', to: 'terrain', contract: 'Proposed motion + actor shape → corrected pose + contact state; source-specific order must be preserved.'}, {from: 'terrain', to: 'camera', contract: 'Committed actor position + world bounds → camera projection.'}, {from: 'recovery', to: 'control', contract: 'Spawn/checkpoint → initialized canonical actor.'}],
    lifecycle: ['Initialize actor and terrain references.', 'Sample input once at the chosen source boundary.', 'Execute the selected source controller / terrain / integration order.', 'Publish the resulting pose to presentation.', 'Handle fall or respawn without retaining stale contacts.'],
    lifecycleScope: 'Integration responsibilities, not a universal frame schedule. For SMA1 the recovered parent is decay → gravity → controller → terrain → conditional edge handling → integrate Y → integrate X; that full parent is unresolved.',
    advancedPatternIds: ['jump-next-gravity'],
    completionRequirements: ['Close movement admission, terrain and integration together.', 'Verify grounded jump, wall stop, landing and respawn using real actor/world state.', 'Provide input, actor allocation and presentation services; no playable controller is certified by this plan.'],
    suggestedPlanIds: ['combat-encounter', 'exploration-progression'],
  },
  {
    schema: GAME_SYSTEM_PLAN_SCHEMA, id: 'combat-encounter', label: 'Combat & enemies', recommendedStartRoleId: 'reaction',
    description: 'Assemble an encounter where an attack reaches a live enemy, contact is admitted once, health changes, a reaction runs and defeat has a defined result.',
    playerOutcome: 'Attack an enemy, see its health/reaction change and finish the encounter without duplicate hits or orphaned actors.',
    runtimeQualified: false, status: 'assembly-plan',
    roles: [
      role('attack', 'Attack input & attack lifetime', 'Turn an allowed action into a hit shape or projectile, then retire it exactly once.', 'attack-lifecycle', [missing('attack-spawn-missing', 'Attack creation needed', 'The recovered beam system documents firing boundaries but does not supply a closed firing / projectile lifetime.', ['Choose an attack admission policy and one live owner per projectile.', 'Recover allocator, lifetime, contact dispatch and cleanup before claiming a working attack.'])]),
      role('contact', 'Contact & hit eligibility', 'Find attack/target overlap and apply invulnerability, team and repeat-hit rules before damage.', 'combat-contact', [beamContact, contact], ['attack']),
      role('reaction', 'Health, hit reaction & enemy update', 'Change one enemy’s health and defer reaction/AI work to the correct source update.', 'enemy-damage-reaction', [beam], ['contact']),
      role('defeat', 'Defeat, drops & cleanup', 'Commit a defeat outcome and release enemy/projectile/effect ownership without repeating rewards.', 'combat-resolution', [missing('combat-resolution-missing', 'Defeat / reward continuation needed', 'The Metroid source traces a species-specific death/drop continuation; complete services and general enemy dispatch are still open.', ['Recover drop selector, effect allocator and audio dependencies.', 'Define victory, rewards and actor retirement; a reaction countdown alone does not defeat an enemy.'])], ['reaction']),
    ],
    sharedState: [{id: 'enemy', owner: 'reaction', fields: ['enemy identity', 'HP', 'reaction byte', 'freeze state', 'pose', 'active status'], rule: 'Damage and later enemy updates must refer to the same canonical enemy record; Metroid DMA scratch is a borrowed view, not a second enemy.'}, {id: 'attack', owner: 'attack', fields: ['owner identity', 'active status', 'bounds', 'attack kind'], rule: 'Retire or record contact in the same attack instance so a hit cannot silently repeat.'}],
    dependencies: [{from: 'attack', to: 'contact', contract: 'Live attack identity + bounds → admitted target hit.'}, {from: 'contact', to: 'reaction', contract: 'Admitted hit + canonical target → HP and reaction mutation.'}, {from: 'reaction', to: 'defeat', contract: 'Lethal/terminal state → one death continuation and cleanup.'}],
    lifecycle: ['Allocate actors and attacks with stable owners.', 'Run the selected source enemy update, then projectile contact phase.', 'Admit contact; apply damage or minimum reaction; consume the projectile as the source requires.', 'Process reaction in the next eligible enemy update.', 'Resolve death/drop and retire owned records.'],
    lifecycleScope: 'Metroid source order is enemy tick before projectile tick, with scratch writeback to the same enemy. The full dispatcher and death services remain source-only.',
    advancedPatternIds: ['minimum-next-reaction', 'prepare-bounds-compare'],
    completionRequirements: ['Demonstrate contact, rejected hits and duplicate-hit prevention with real target identity.', 'Close enemy AI/admission, firing, collision dispatch and death services.', 'Verify nonlethal, frozen, lethal and retirement paths; symbolic graph validation does not qualify an encounter.'],
    suggestedPlanIds: ['character-traversal', 'exploration-progression'],
  },
  {
    schema: GAME_SYSTEM_PLAN_SCHEMA, id: 'exploration-progression', label: 'Exploration & progression', recommendedStartRoleId: 'ownership',
    description: 'Connect discovering a collectible to a durable ownership change and a visible reward or newly legal action.',
    playerOutcome: 'Reach a collectible, claim it once, inspect owned quantity and unlock a clearly defined benefit.',
    runtimeQualified: false, status: 'assembly-plan',
    roles: [
      role('discovery', 'World interaction & pickup eligibility', 'Identify a nearby collectible and check whether this actor can claim it.', 'world-interaction', [missing('pickup-interaction-missing', 'Pickup interaction needed', 'Inventory transactions do not locate collectibles or establish contact eligibility.', ['Supply movement/world interaction, collectible identity and legal category/index mapping.', 'Own the persistent claimed marker so reloads cannot award it twice.'])]),
      role('ownership', 'Inventory & duplicate handling', 'Apply the source ownership transaction to one canonical inventory and retain neighboring entries.', 'inventory-transaction', [learning, inventory], ['discovery']),
      role('benefit', 'Reward → ability or equipment', 'Make an acquired reward affect a real capability, equipped item or usable action.', 'progression-capability', [sword, missing('reward-consumer-missing', 'Reward consumer needed', 'An inventory count alone does not enable movement, combat or equipment behavior.', ['Choose a specific ability/equipment consumer and map ownership to its capability contract.', 'Cross-game inventory-to-ability translation is a design task, not automatic compatibility.'])], ['ownership']),
      role('commit', 'Feedback, save & return', 'Show the claim outcome and preserve inventory, claimed marker and capability together.', 'progression-persistence', [missing('progression-save-missing', 'Progress persistence needed', 'A coherent pickup save/reload transaction and notification consumer are not supplied by this assembly.', ['Define commit / rollback for pickup, inventory and capability.', 'Provide notification, save schema and restoration evidence.'])], ['ownership', 'benefit']),
    ],
    sharedState: [{id: 'inventory', owner: 'ownership', fields: ['category', 'legal item index', 'bank0', 'bank1', 'owned count'], rule: 'Choose one source inventory model. Minish uses packed four-state learned slots and an explicit derived cache; Aria uses count/acquisition banks. These models do not automatically translate.'}, {id: 'progress', owner: 'commit', fields: ['collectible identity', 'claimed marker', 'capability revision'], rule: 'World claim and benefit must commit together. No Aria → Minish mapping is implied.'}],
    dependencies: [{from: 'discovery', to: 'ownership', contract: 'Eligible unclaimed collectible → category/index/delta ownership request.'}, {from: 'ownership', to: 'benefit', contract: 'Committed ownership result → explicitly mapped ability/equipment refresh.'}, {from: 'benefit', to: 'commit', contract: 'Updated ownership and capability → feedback + persistent claim record.'}],
    lifecycle: ['Load canonical inventory and world claim state.', 'Admit one pickup interaction.', 'Execute count / acquire / conditional bank updates in the selected source order.', 'Refresh the chosen benefit through an explicit mapping.', 'Commit claim state, show outcome and verify restoration.'],
    lifecycleScope: 'Minish offers a coherent learned-state write → refresh → future sword-consumer boundary; portable action closure is still open. Aria offers an alternative count/acquisition transaction. Their inventory models do not automatically translate.',
    advancedPatternIds: ['count-before-acquire'],
    completionRequirements: ['Use the coherent ownership transaction within its evidenced domains.', 'Verify first claim, duplicate acquisition, rejected claim and reload without duplicate reward.', 'Close interaction, benefit consumer and persistence; this plan does not implement a complete exploration game.'],
    suggestedPlanIds: ['character-traversal', 'combat-encounter'],
  },
];

GAME_SYSTEM_PLANS.push(...GAME_BLUEPRINT_ARCHETYPES);

attachCapabilityBundles(GAME_SYSTEM_PLANS, [...MOVEMENT_CAPABILITY_BUNDLES, ...MARIO_CAPABILITY_BUNDLES.filter(bundle => bundle.id !== 'mario-kart-racer-bundle'), ...COMBAT_PROGRESSION_CAPABILITY_BUNDLES]);

export function gameSystemPlan(id) { return GAME_SYSTEM_PLANS.find(plan => plan.id === id) || null; }
export function nextGameSystemRole(plan, selections = {}) { return plan.roles.find(item => item.required && !item.candidates.some(option => option.id === selections[item.id] && option.availability !== 'missing')) || null; }
// Design progress only. Runtime qualification never follows from selected cards.
export function gameSystemPlanProgress(plan, selections = {}) {
  const chosen = plan.roles.filter(item => item.candidates.some(option => option.id === selections[item.id] && option.availability !== 'missing'));
  return {chosen: chosen.length, required: plan.roles.filter(item => item.required).length, runtimeQualified: false, canBuildGame: false};
}
