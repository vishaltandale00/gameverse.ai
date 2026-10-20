// Source-evidenced Mario capability bundles. Facets share moduleId and canonical backing.
// Native host plans are evidence, not portable mechanic-assembly prefabs.
export const MARIO_CAPABILITY_BUNDLES = [
  {
    "id": "mario-sma1-traversal-bundle",
    "label": "Run, jump, hover and ground admission \u00b7 Super Mario Advance",
    "sourceGame": "super-mario-advance",
    "moduleId": "sma1.controller.grounded_motion_subsystem",
    "availability": "published-subset",
    "packageIds": [
      "sma.motion.sma1_friction",
      "sma.motion.sma1_gravity_hover",
      "sma.motion.sma1_jump_onset",
      "sma.motion.sma1_integrate_y"
    ],
    "nativePackageIds": [
      "mario.sma1.character_jump_hover_motion",
      "mario.sma1.run_charge_carry_throw_controller"
    ],
    "scope": "One character controller relates running/skidding, grounded jump admission, charged jump, held-jump hover, carrier integration and clearance-tested carried-object release. Ground contact is an explicit source dependency of this same player lifecycle.",
    "description": "One character controller relates running/skidding, grounded jump admission, charged jump, held-jump hover, carrier integration and clearance-tested carried-object release. Ground contact is an explicit source dependency of this same player lifecycle.",
    "runtimeQualified": false,
    "portableExecutable": false,
    "prefabReady": false,
    "readiness": "Native local parts are qualified where recorded; the complete reusable host boundary remains partial.",
    "canonicalState": {
      "identity": "One native player rooted at 0x03005cf0 with shared profile/entities/character parameters",
      "fields": [
        "position and velocity",
        "air_mode and contact admission",
        "jump/hover/charge/action fields",
        "held/pressed keys",
        "carried actor slot in shared entity pool"
      ],
      "aliasRule": "All facets reuse this one canonical module instance and backing. Selecting another facet never creates another actor/controller copy."
    },
    "roleFacets": [
      {
        "roleId": "control",
        "capability": "ground_air_traversal",
        "status": "published-subset",
        "scope": "Running, friction, jump/charge/hover and integration share one player; native controller links its selected motion provider once.",
        "evidence": [
          "research/deep-extraction/mario/parallel-sma1/next-extraction/l2-contract.json",
          "tools/composition/packages/mario-sma1-controller-host.json"
        ]
      },
      {
        "roleId": "terrain",
        "capability": "ground_contact",
        "status": "source-only",
        "scope": "Terrain producer 0x080a821c supplies ground/standing permission to controller and jump onset. It is outside the closed recovered motion/controller parts; landing/contact resolution is still host owned.",
        "evidence": [
          "research/deep-extraction/mario/parallel-sma1/next-extraction/l2-contract.json"
        ]
      },
      {
        "roleId": "control",
        "capability": "carry_throw",
        "status": "published-subset",
        "scope": "The same controller checks tile clearance before releasing the same carried actor; not a separate player movement instance.",
        "evidence": [
          "tools/composition/packages/mario-sma1-controller-host.json"
        ]
      }
    ],
    "gaps": [
      "Terrain/contact producer 0x080a821c and full frame lifecycle are not closed.",
      "Natural motion Mario/Peach episodes qualified; full controller/carry-throw natural qualification remains pending.",
      "Existing jump\u2192next-gravity graph is binding admission across phases, not a complete grounded frame or contact solver."
    ],
    "settings": [
      "Native Mario and Peach parameter records are witnessed; Luigi/Toad mapping is not.",
      "Held/pressed masks, source frame byte and existing charge/carrier context are source inputs; no free gravity/speed sliders are established."
    ],
    "requiredServices": [
      "Original terrain/contact producer and frame scheduler",
      "Canonical tilemap and entity pool",
      "play_sound"
    ],
    "evidence": [
      "research/deep-extraction/mario/parallel-sma1/next-extraction/l2-contract.json",
      "research/corpus-mining/20261016-binary-corpus-round2/reviewed/sma1-motion-recovered.c",
      "research/corpus-mining/20261016-binary-corpus-round2/reviewed/sma1-controller-recovered.c",
      "tools/composition/packages/mario-sma1-motion-host.json",
      "tools/composition/packages/mario-sma1-controller-host.json",
      "research/corpus-mining/20261016-binary-corpus-round2/reviewed/sma1-native-motion-receipt.json",
      "research/corpus-mining/20261016-binary-corpus-round2/reviewed/sma1-motion-gameplay-receipt.json",
      "research/corpus-mining/20261016-binary-corpus-round2/reviewed/sma1-native-controller-receipt.json"
    ],
    "hostAssembly": {
      "planRef": "tools/composition/plans/sma1-controller-motion-parity.json",
      "status": "retained native host composition, not a portable mechanic-assembly prefab"
    },
    "integration": "Inspect and adapt the source module once. Ground/contact inputs, units, scheduling and services require explicit mappings.",
    "descriptorRef": "research/ir-workshop/game-system-assembly-20261016/mario-capability-bundles/mario-sma1-traversal-bundle.json",
    "sourceSystemId": "sma1.controller.grounded_motion_subsystem",
    "recordKind": "source-system-capability-bundle",
    "sourceContractRef": "research/deep-extraction/mario/parallel-sma1/next-extraction/l2-contract.json",
    "existingCandidateIds": [
      "sma1-traversal-source"
    ]
  },
  {
    "id": "mario-sma2-traversal-bundle",
    "label": "Run, jump, cape and ground context \u00b7 Super Mario World",
    "sourceGame": "super-mario-advance-2-super-mario-world",
    "moduleId": "mario.sma2.run_jump_cape_motion",
    "availability": "published-subset",
    "packageIds": [
      "sma-2-super-mario-world.motion.sma2_integrate",
      "sma-2-super-mario-world.motion.sma2_integrate_x",
      "sma-2-super-mario-world.motion.sma2_integrate_y",
      "sma-2-super-mario-world.motion.sma2_gravity",
      "sma-2-super-mario-world.motion.sma2_run_charge",
      "sma-2-super-mario-world.motion.sma2_decay_run_charge",
      "sma-2-super-mario-world.motion.sma2_special_surface"
    ],
    "nativePackageIds": [
      "mario.sma2.run_jump_cape_motion"
    ],
    "scope": "Charged running, normal/spin jump onset, character-dependent ascent, cape motion and fixed-point integration operate on one player. Ground/surface context is consumed by this controller; terrain detection and landing are required external phases.",
    "description": "Charged running, normal/spin jump onset, character-dependent ascent, cape motion and fixed-point integration operate on one player. Ground/surface context is consumed by this controller; terrain detection and landing are required external phases.",
    "runtimeQualified": false,
    "portableExecutable": false,
    "prefabReady": false,
    "readiness": "Native local parts are qualified where recorded; the complete reusable host boundary remains partial.",
    "canonicalState": {
      "identity": "One original player 0x03003fa0 and shared controls/engine/map/profile/scene backing",
      "fields": [
        "signed16 pixel position with u8 fractions",
        "native velocity and jump/spin/cape state",
        "ground/surface context",
        "ground-effect and audio state"
      ],
      "aliasRule": "All facets reuse this one canonical module instance and backing. Selecting another facet never creates another actor/controller copy."
    },
    "roleFacets": [
      {
        "roleId": "control",
        "capability": "ground_air_traversal",
        "status": "published-subset",
        "scope": "Run charge, normal/spin ascent, cape limit, gravity and integration belong to one controller.",
        "evidence": [
          "tools/composition/packages/mario-sma2-motion-host.json"
        ]
      },
      {
        "roleId": "terrain",
        "capability": "ground_contact",
        "status": "source-only",
        "scope": "Existing ground/surface flags and material context are inputs; sma2_ground_effect is an effect routine, not a ground detector. Terrain collision remains external.",
        "evidence": [
          "tools/composition/packages/mario-sma2-motion-host.json",
          "research/corpus-mining/20261016-binary-corpus-round2/reviewed/sma2-motion-recovered.c"
        ]
      }
    ],
    "gaps": [
      "Terrain collision, landing resolution and enemy eligibility remain original host behavior.",
      "Published automatic leaves do not assemble the whole native controller."
    ],
    "settings": [
      "Native held/pressed controls and existing character/riding/cape state are supported contextual inputs.",
      "Coefficient window is pinned source data, not a newly configurable physics range."
    ],
    "requiredServices": [
      "Terrain/contact phase",
      "Original scheduler and ability activation",
      "play_sound"
    ],
    "evidence": [
      "research/corpus-mining/20261016-binary-corpus-round2/reviewed/sma2-motion-recovered.c",
      "tools/composition/packages/mario-sma2-motion-host.json",
      "local/re/experiments/20261016-binary-corpus-round2/sma2-native-motion-01/receipt.json",
      "research/corpus-mining/20261016-binary-corpus-round2/reviewed/sma2-motion-gameplay-receipt.json"
    ],
    "hostAssembly": {
      "planRef": "tools/composition/plans/sma2-motion-parity.json",
      "status": "retained native host composition, not a portable mechanic-assembly prefab"
    },
    "integration": "Inspect and adapt the source module once. Ground/contact inputs, units, scheduling and services require explicit mappings.",
    "descriptorRef": "research/ir-workshop/game-system-assembly-20261016/mario-capability-bundles/mario-sma2-traversal-bundle.json",
    "recordKind": "native-host-recovery-bundle",
    "sourceContractRef": "tools/composition/packages/mario-sma2-motion-host.json"
  },
  {
    "id": "mario-sma4-traversal-bundle",
    "label": "Buffered jump and sampled wall response \u00b7 Super Mario Bros. 3",
    "sourceGame": "super-mario-advance-4-super-mario-bros-3",
    "moduleId": "mario.sma4.player_motion_jump_wall",
    "availability": "published-subset",
    "packageIds": [
      "sma-4-super-mario-bros-3.motion.horizontal_integration",
      "sma-4-super-mario-bros-3.motion.vertical_integration",
      "sma-4-super-mario-bros-3.motion.run_boost_helper"
    ],
    "nativePackageIds": [
      "mario.sma4.player_motion_jump_wall"
    ],
    "scope": "One caller-owned packet combines buffered variable-height jump/gravity policy, run boost, oriented displacement and response to supplied wall samples. Contact-derived airborne/material/buffer state and the final merge stay with the source host.",
    "description": "One caller-owned packet combines buffered variable-height jump/gravity policy, run boost, oriented displacement and response to supplied wall samples. Contact-derived airborne/material/buffer state and the final merge stay with the source host.",
    "runtimeQualified": false,
    "portableExecutable": false,
    "prefabReady": false,
    "readiness": "Native local parts are qualified where recorded; the complete reusable host boundary remains partial.",
    "canonicalState": {
      "identity": "One Sma4ComponentPacket; player and auxiliary views must track the same source player",
      "fields": [
        "player position/velocity",
        "airborne/jump buffer/material state",
        "contact selector and sampled tiles",
        "wall correction merge bits"
      ],
      "aliasRule": "All facets reuse this one canonical module instance and backing. Selecting another facet never creates another actor/controller copy."
    },
    "roleFacets": [
      {
        "roleId": "control",
        "capability": "ground_air_traversal",
        "status": "published-subset",
        "scope": "Buffered jump, held release and oriented integration share the player packet.",
        "evidence": [
          "tools/composition/packages/mario-sma4-player-parts.json"
        ]
      },
      {
        "roleId": "terrain",
        "capability": "ground_contact",
        "status": "source-only",
        "scope": "Caller supplies contact-derived airborne, buffer and material state. A landing solver is not recovered by the jump/gravity policy.",
        "evidence": [
          "research/corpus-mining/20261016-binary-corpus-round2/reviewed/sma4-jump-recovered.c"
        ]
      },
      {
        "roleId": "terrain",
        "capability": "wall_response",
        "status": "published-subset",
        "scope": "0x0809c02c corrects position/velocity for supplied selector0..3 and returns merge bits; upstream sampling and caller merge are mandatory.",
        "evidence": [
          "research/corpus-mining/20261016-binary-corpus-round2/reviewed/sma4-wall-contact-recovered.c",
          "research/corpus-mining/20261016-binary-corpus-round2/reviewed/sma4-wall-policy-receipt.json"
        ]
      }
    ],
    "gaps": [
      "No complete controller/world pipeline or native host adapter/hook recipe.",
      "Wall response neither finds contact nor completes landing.",
      "Packet ABI is not a drop-in original actor ABI."
    ],
    "settings": [
      "Supplied contact selector domain0..3; retained tile/probe tables.",
      "Source held/released input and transform selectors; no invented portable units."
    ],
    "requiredServices": [
      "Typed upstream terrain sampler",
      "Original scheduler and correction merge",
      "Explicit audio event consumer"
    ],
    "evidence": [
      "research/corpus-mining/20261016-binary-corpus-round2/reviewed/sma4-component.c",
      "research/corpus-mining/20261016-binary-corpus-round2/reviewed/sma4-jump-recovered.c",
      "research/corpus-mining/20261016-binary-corpus-round2/reviewed/sma4-wall-contact-recovered.c",
      "tools/composition/packages/mario-sma4-player-parts.json",
      "research/corpus-mining/20261016-binary-corpus-round2/reviewed/sma4-lowering-receipt.json",
      "research/corpus-mining/20261016-binary-corpus-round2/reviewed/sma4-jump-native-receipt.json"
    ],
    "hostAssembly": null,
    "integration": "Inspect and adapt the source module once. Ground/contact inputs, units, scheduling and services require explicit mappings.",
    "descriptorRef": "research/ir-workshop/game-system-assembly-20261016/mario-capability-bundles/mario-sma4-traversal-bundle.json",
    "recordKind": "native-host-recovery-bundle",
    "sourceContractRef": "tools/composition/packages/mario-sma4-player-parts.json"
  },
  {
    "id": "mario-kart-racer-bundle",
    "label": "Steering, track contact and race progress \u00b7 Mario Kart",
    "sourceGame": "mario-kart-super-circuit",
    "moduleId": "mario-kart-super-circuit.source-system.cbba0d958e",
    "availability": "published-subset",
    "packageIds": [
      "kart.steering_recovery",
      "kart.turn_recovery_acceleration",
      "kart.track_coordinate_bounds"
    ],
    "nativePackageIds": [],
    "scope": "One racer/track lifecycle relates signed steering recovery, velocity integration, track classification, contact/recovery and checkpoint/finish progress. Three qualified leaves support this source module; the driving and race transaction remain open.",
    "description": "One racer/track lifecycle relates signed steering recovery, velocity integration, track classification, contact/recovery and checkpoint/finish progress. Three qualified leaves support this source module; the driving and race transaction remain open.",
    "runtimeQualified": false,
    "portableExecutable": false,
    "prefabReady": false,
    "readiness": "Native local parts are qualified where recorded; the complete reusable host boundary remains partial.",
    "canonicalState": {
      "identity": "One canonical racer and shared track/race globals",
      "fields": [
        "previous/current racer position and velocity",
        "heading/recovery phase",
        "surface/checkpoint/finish state"
      ],
      "aliasRule": "All facets reuse this one canonical module instance and backing. Selecting another facet never creates another actor/controller copy."
    },
    "roleFacets": [
      {
        "roleId": "control",
        "capability": "racer_steering",
        "status": "published-subset",
        "scope": "Signed steering recovery and turn acceleration are finite qualified parts, not a full driving controller.",
        "evidence": [
          "research/deep-extraction/mario/parallel-kart/next-extraction/l2-contract.json"
        ]
      },
      {
        "roleId": "terrain",
        "capability": "track_contact",
        "status": "source-only",
        "scope": "Source update0x0803c4c0 integrates, classifies checkpoint/surface0x0803b98c, expires clocks and performs contact/recovery0x0803b550 on the same racer.",
        "evidence": [
          "research/deep-extraction/mario/parallel-kart/next-extraction/l2-contract.json"
        ]
      },
      {
        "roleId": null,
        "capability": "race_progress",
        "status": "source-only",
        "scope": "Checkpoint/finish flags are source structure on the same racer; allocation/retirement and complete race lifecycle remain unresolved. This is race progress, not character respawn.",
        "evidence": [
          "research/deep-extraction/mario/parallel-kart/next-extraction/l2-contract.json"
        ]
      }
    ],
    "gaps": [
      "Track pointer tree and full contact/dynamics closure unresolved.",
      "Input mask button meaning and physical units not calibrated.",
      "No linked race transaction or natural gameplay qualification."
    ],
    "settings": [
      "Only qualified leaf field domains are supported; no button map or adjustable handling sliders inferred."
    ],
    "requiredServices": [
      "Shared track geometry/classification",
      "Canonical racer scheduler and race globals"
    ],
    "evidence": [
      "research/deep-extraction/mario/parallel-kart/next-extraction/l2-contract.json"
    ],
    "hostAssembly": null,
    "integration": "Inspect and adapt the source module once. Ground/contact inputs, units, scheduling and services require explicit mappings.",
    "descriptorRef": "research/ir-workshop/game-system-assembly-20261016/mario-capability-bundles/mario-kart-racer-bundle.json",
    "sourceSystemId": "mario-kart-super-circuit.source-system.cbba0d958e",
    "recordKind": "source-system-capability-bundle",
    "sourceContractRef": "research/deep-extraction/mario/parallel-kart/next-extraction/l2-contract.json"
  },
  {
    "id": "mario-superstar-motion-bundle",
    "label": "Actor vertical motion lifecycle \u00b7 Superstar Saga",
    "sourceGame": "mario-and-luigi-superstar-saga",
    "moduleId": "mlss.motion.lifecycle",
    "availability": "published-subset",
    "packageIds": [
      "mlss.motion.initialize",
      "mlss.motion.update",
      "mlss.motion.reset"
    ],
    "nativePackageIds": [],
    "scope": "Initialization, repeated vertical motion update and reset relate through one canonical actor. The update already includes its qualified reset dependency. The source does not establish player jump, terrain contact or landing semantics.",
    "description": "Initialization, repeated vertical motion update and reset relate through one canonical actor. The update already includes its qualified reset dependency. The source does not establish player jump, terrain contact or landing semantics.",
    "runtimeQualified": false,
    "portableExecutable": false,
    "prefabReady": false,
    "readiness": "Native local parts are qualified where recorded; the complete reusable host boundary remains partial.",
    "canonicalState": {
      "identity": "One borrowed canonical actor, lifetime caller-owned",
      "fields": [
        "motion flags",
        "active invocation counter/inactive sentinel",
        "velocity/decrement fields",
        "saved motion parameter and termination flags"
      ],
      "aliasRule": "All facets reuse this one canonical module instance and backing. Selecting another facet never creates another actor/controller copy."
    },
    "roleFacets": [
      {
        "roleId": "control",
        "capability": "vertical_motion_lifecycle",
        "status": "published-subset",
        "scope": "Three finite-qualified roots; actor-state initialization and termination must share backing.",
        "evidence": [
          "research/deep-extraction/mario/parallel-superstar/next-extraction/l2-contract.json"
        ]
      },
      {
        "roleId": "terrain",
        "capability": "ground_contact",
        "status": "missing",
        "scope": "No ground/contact producer or landing meaning is established by these roots; vertical motion termination alone is insufficient.",
        "evidence": [
          "research/deep-extraction/mario/parallel-superstar/next-extraction/l2-contract.json"
        ]
      }
    ],
    "gaps": [
      "Cross-root actor alias bindings and initializer/update transaction unqualified.",
      "No terrain/input integration, gameplay identity or calibrated units.",
      "Do not append a separate reset after update: update contains its own reset path."
    ],
    "settings": [
      "Initializer accepts source r1/r2/r3 overrides with signed -1 default sentinel; no physical range inferred."
    ],
    "requiredServices": [
      "Caller actor lifetime and scheduler",
      "Terrain/input integration remains outside recovered roots"
    ],
    "evidence": [
      "research/deep-extraction/mario/parallel-superstar/next-extraction/l2-contract.json",
      "research/deep-extraction/mario/parallel-superstar/mashup-coverage/summary.json"
    ],
    "hostAssembly": null,
    "integration": "Inspect and adapt the source module once. Ground/contact inputs, units, scheduling and services require explicit mappings.",
    "descriptorRef": "research/ir-workshop/game-system-assembly-20261016/mario-capability-bundles/mario-superstar-motion-bundle.json",
    "sourceSystemId": "mlss.motion.lifecycle",
    "recordKind": "source-system-capability-bundle",
    "sourceContractRef": "research/deep-extraction/mario/parallel-superstar/next-extraction/l2-contract.json"
  },
  {
    "id": "mario-sma2-spin-response-bundle",
    "label": "Accepted spin impact, bounce and reward \u00b7 Super Mario World",
    "sourceGame": "super-mario-advance-2-super-mario-world",
    "moduleId": "mario.sma2.accepted_spin_stomp",
    "availability": "published-subset",
    "packageIds": [
      "sma-2-super-mario-world.combat.sma2_terminal_state",
      "sma-2-super-mario-world.combat.sma2_effect_suppressed"
    ],
    "nativePackageIds": [
      "mario.sma2.accepted_spin_stomp"
    ],
    "scope": "Accepted spin impact sets enemy terminal timer, selects player bounce, allocates particles and chains reward/life progression. All are one response transaction after host contact admission.",
    "description": "Accepted spin impact sets enemy terminal timer, selects player bounce, allocates particles and chains reward/life progression. All are one response transaction after host contact admission.",
    "runtimeQualified": false,
    "portableExecutable": false,
    "prefabReady": false,
    "readiness": "Native local parts are qualified where recorded; the complete reusable host boundary remains partial.",
    "canonicalState": {
      "identity": "Same player, selected enemy and canonical scene/reward pools",
      "fields": [
        "enemy terminal timer/state",
        "player bounce",
        "particle slots and reward/chain/life state"
      ],
      "aliasRule": "All facets reuse this one canonical module instance and backing. Selecting another facet never creates another actor/controller copy."
    },
    "roleFacets": [
      {
        "roleId": "reaction",
        "capability": "accepted_response",
        "status": "published-subset",
        "scope": "Accepted spin impact sets enemy terminal timer, selects player bounce, allocates particles and chains reward/life progression. All are one response transaction after host contact admission.",
        "evidence": [
          "tools/composition/packages/mario-sma2-spin-host.json"
        ]
      }
    ],
    "gaps": [
      "General contact admission and other enemy responses remain external."
    ],
    "settings": [
      "Only accepted native context and source item/actor domains; no arbitrary damage/form knobs."
    ],
    "requiredServices": [
      "Original accepted-contact dispatcher",
      "Canonical entity/particle/reward pools"
    ],
    "evidence": [
      "tools/composition/packages/mario-sma2-spin-host.json",
      "research/corpus-mining/20261016-binary-corpus-round2/reviewed/sma2-native-spin-receipt.json",
      "research/corpus-mining/20261016-binary-corpus-round2/reviewed/sma2-spin-gameplay-receipt.json"
    ],
    "hostAssembly": {
      "planRef": "tools/composition/plans/sma2-spin-parity.json",
      "status": "retained native host composition, not a portable mechanic-assembly prefab"
    },
    "integration": "Inspect and adapt the source module once. Ground/contact inputs, units, scheduling and services require explicit mappings.",
    "descriptorRef": "research/ir-workshop/game-system-assembly-20261016/mario-capability-bundles/mario-sma2-spin-response-bundle.json",
    "recordKind": "native-host-recovery-bundle",
    "sourceContractRef": "tools/composition/packages/mario-sma2-spin-host.json"
  },
  {
    "id": "mario-sma4-stomp-response-bundle",
    "label": "Accepted stomp, bounce and score \u00b7 Super Mario Bros. 3",
    "sourceGame": "super-mario-advance-4-super-mario-bros-3",
    "moduleId": "mario.sma4.stomp_host_bundle",
    "availability": "published-subset",
    "packageIds": [
      "sma-4-super-mario-bros-3.combat.bounce_initializer",
      "sma-4-super-mario-bros-3.combat.flatten_initializer"
    ],
    "nativePackageIds": [
      "mario.sma4.stomp_host_bundle"
    ],
    "scope": "Accepted top contact causes bounce, health decrement, actor type/state change and score-chain event; this is one response lifecycle, not independent damage and bounce actors.",
    "description": "Accepted top contact causes bounce, health decrement, actor type/state change and score-chain event; this is one response lifecycle, not independent damage and bounce actors.",
    "runtimeQualified": false,
    "portableExecutable": false,
    "prefabReady": false,
    "readiness": "Native local parts are qualified where recorded; the complete reusable host boundary remains partial.",
    "canonicalState": {
      "identity": "Same canonical player and contacted actor/world",
      "fields": [
        "player bounce and chain",
        "actor health/type/state"
      ],
      "aliasRule": "All facets reuse this one canonical module instance and backing. Selecting another facet never creates another actor/controller copy."
    },
    "roleFacets": [
      {
        "roleId": "reaction",
        "capability": "accepted_response",
        "status": "published-subset",
        "scope": "Accepted top contact causes bounce, health decrement, actor type/state change and score-chain event; this is one response lifecycle, not independent damage and bounce actors.",
        "evidence": [
          "tools/composition/packages/mario-sma4-stomp-host.json"
        ]
      }
    ],
    "gaps": [
      "Full contact filter, terrain and actor lifecycle remain outside this response."
    ],
    "settings": [
      "Only accepted native context and source item/actor domains; no arbitrary damage/form knobs."
    ],
    "requiredServices": [
      "Original top-contact admission",
      "score_chain",
      "play_sound"
    ],
    "evidence": [
      "tools/composition/packages/mario-sma4-stomp-host.json",
      "local/re/experiments/20261016-binary-corpus-round2/sma4-stomp-host-02/receipt.json",
      "local/re/experiments/20261016-binary-corpus-round2/sma4-stomp-live-02/probe.json"
    ],
    "hostAssembly": {
      "planRef": "tools/composition/plans/sma4-stomp-parity.json",
      "status": "retained native host composition, not a portable mechanic-assembly prefab"
    },
    "integration": "Inspect and adapt the source module once. Ground/contact inputs, units, scheduling and services require explicit mappings.",
    "descriptorRef": "research/ir-workshop/game-system-assembly-20261016/mario-capability-bundles/mario-sma4-stomp-response-bundle.json",
    "recordKind": "native-host-recovery-bundle",
    "sourceContractRef": "tools/composition/packages/mario-sma4-stomp-host.json"
  },
  {
    "id": "mario-sma4-pickup-response-bundle",
    "label": "Accepted powerup and pending form \u00b7 Super Mario Bros. 3",
    "sourceGame": "super-mario-advance-4-super-mario-bros-3",
    "moduleId": "mario.sma4.powerup_pickup_host_bundle",
    "availability": "published-subset",
    "packageIds": [],
    "nativePackageIds": [
      "mario.sma4.powerup_pickup_host_bundle"
    ],
    "scope": "Accepted growth, fire and leaf pickups create pending form changes, timers and rewards on the same player. Actual application of the pending form and ability activation remain host phases.",
    "description": "Accepted growth, fire and leaf pickups create pending form changes, timers and rewards on the same player. Actual application of the pending form and ability activation remain host phases.",
    "runtimeQualified": false,
    "portableExecutable": false,
    "prefabReady": false,
    "readiness": "Native local parts are qualified where recorded; the complete reusable host boundary remains partial.",
    "canonicalState": {
      "identity": "Same canonical player and accepted item",
      "fields": [
        "pending form transition and timers",
        "reward state"
      ],
      "aliasRule": "All facets reuse this one canonical module instance and backing. Selecting another facet never creates another actor/controller copy."
    },
    "roleFacets": [
      {
        "roleId": "benefit",
        "capability": "accepted_response",
        "status": "published-subset",
        "scope": "Accepted growth, fire and leaf pickups create pending form changes, timers and rewards on the same player. Actual application of the pending form and ability activation remain host phases.",
        "evidence": [
          "tools/composition/packages/mario-sma4-powerups-host.json"
        ]
      }
    ],
    "gaps": [
      "Item movement/collision and pending form application remain native host behavior.",
      "No complete weapon/flying/save lifecycle."
    ],
    "settings": [
      "Only accepted native context and source item/actor domains; no arbitrary damage/form knobs."
    ],
    "requiredServices": [
      "Original pickup eligibility and form-application phase",
      "score_direct",
      "play_sound"
    ],
    "evidence": [
      "tools/composition/packages/mario-sma4-powerups-host.json",
      "local/re/experiments/20261016-binary-corpus-round2/sma4-powerup-policy-01/receipt.json",
      "local/re/experiments/20261016-binary-corpus-round2/sma4-powerup-live-07/probe.json"
    ],
    "hostAssembly": {
      "planRef": "tools/composition/plans/sma4-powerup-parity.json",
      "status": "retained native host composition, not a portable mechanic-assembly prefab"
    },
    "integration": "Inspect and adapt the source module once. Ground/contact inputs, units, scheduling and services require explicit mappings.",
    "descriptorRef": "research/ir-workshop/game-system-assembly-20261016/mario-capability-bundles/mario-sma4-pickup-response-bundle.json",
    "recordKind": "native-host-recovery-bundle",
    "sourceContractRef": "tools/composition/packages/mario-sma4-powerups-host.json"
  }
];
