// Source-scoped facets share moduleId across roles. A facet does not add another runtime instance.
// Native component parity and binding admission never certify the containing system.
export const MOVEMENT_CAPABILITY_BUNDLES = [
  {
    "id": "sonic-traversal-bundle",
    "label": "Air steering, jump release & terrain handoff \u00b7 Sonic Advance",
    "sourceGame": "sonic-advance",
    "sourceSystemId": "sonic-advance.source-system.6ecb0c97fa",
    "moduleId": "sonic.usa.character_traversal.air_phase",
    "packageIds": [
      "sonic.motion.integrate",
      "sonic.motion.gravity"
    ],
    "availability": "published-subset",
    "description": "Source-derived air phase connects release gates, steering, integration, gravity, angle relaxation and directional terrain handoff. Its authored service-table orchestration compiles; native composition parity remains unavailable. Portable graph covers adjacent integration \u2192 gravity only.",
    "scope": "Source-derived air phase connects release gates, steering, integration, gravity, angle relaxation and directional terrain handoff. Its authored service-table orchestration compiles; native composition parity remains unavailable. Portable graph covers adjacent integration \u2192 gravity only.",
    "gaps": [
      "Landing dispatcher 0x08042e08 and directional terrain handlers are mandatory original host services.",
      "Ground control, input/task capture and ability bodies remain open.",
      "Authored orchestration is source-derived plumbing, not an automatically recovered executable prefab; finite leaf checks do not qualify this phase."
    ],
    "evidence": [
      "research/ir-workshop/game-system-assembly-20261016/traversal/system.json"
    ],
    "runtimeQualified": false,
    "canonicalState": {
      "identity": "sonic.usa.character_traversal.air_phase:canonical-actor",
      "fields": [
        "x:i32 Q24.8",
        "y:i32 Q24.8",
        "vx/vy:i16 Q8.8",
        "ground_speed:i16",
        "flags:u32",
        "surface_angle:u8",
        "acceleration/max_speed:i32",
        "held/pressed:u16"
      ],
      "aliasRule": "One persistent native actor; Motion, Air and Jump are overlapping views, never separate entities."
    },
    "roleFacets": [
      {
        "roleId": "control",
        "capability": "airborne-steering-and-jump-release",
        "status": "source-only",
        "scope": "0x08047378 air branch orders 0x0804463c release/ability gate, 0x0804456c air steering, then 0x080470b4 integration and 0x08047100 gravity; original jump remains a separate source entry.",
        "evidence": [
          "research/ir-workshop/game-system-assembly-20261016/traversal/system.json"
        ]
      },
      {
        "roleId": "terrain",
        "capability": "directional-contact-and-landing-handoff",
        "status": "source-only",
        "scope": "0x08042e08 dispatches four directional contact handlers; attached contact uses 0x0804386c. These are true contact evidence, with landing implementation still external.",
        "evidence": [
          "research/ir-workshop/game-system-assembly-20261016/traversal/system.json"
        ]
      }
    ],
    "integration": "Select once across roles; preserve this module instance and its source actor. Cross-game state, units and services require explicit mapping.",
    "recoveredAssembly": {
      "id": "sonic.air-advance-subset",
      "label": "Air position advance \u2192 gravity subset",
      "descriptorRef": "research/ir-workshop/game-system-assembly-20261016/traversal/system.json",
      "assemblyRef": "research/ir-workshop/game-system-assembly-20261016/traversal/air-advance.assembly.json",
      "validationRef": "research/ir-workshop/game-system-assembly-20261016/traversal/air-advance.validation.json",
      "packageIds": [
        "sonic.motion.integrate",
        "sonic.motion.gravity"
      ],
      "scope": "Two adjacent source air stages; shared vertical velocity. Does not implement steering, jump admission or landing.",
      "runtimeQualified": false,
      "readyToAdd": false
    },
    "existingCandidateIds": [
      "sonic-traversal-source"
    ],
    "planIds": [
      "character-traversal"
    ]
  },
  {
    "id": "fusion-transition-motion-bundle",
    "label": "Directional motion, jump transitions & contact \u00b7 Metroid Fusion",
    "sourceGame": "metroid-fusion",
    "sourceSystemId": "metroid-fusion.player.jump-transition-contact",
    "moduleId": "metroid-fusion.player.jump-transition-contact",
    "packageIds": [
      "fusion.motion.directional_acceleration",
      "fusion.state.transition_snapshot_reset"
    ],
    "availability": "published-subset",
    "description": "One player transition structure includes input-conditioned jump request, two terrain samples, snapshot/reset, initialization, movement and collision request handling. Published acceleration and transition snapshot are bounded members; frame-driver connections remain unresolved.",
    "scope": "One player transition structure includes input-conditioned jump request, two terrain samples, snapshot/reset, initialization, movement and collision request handling. Published acceleration and transition snapshot are bounded members; frame-driver connections remain unresolved.",
    "gaps": [
      "Returned request0xfe \u2192 transition driver and jump initializer \u2192 motion frame schedule are unresolved.",
      "Terrain/contact, landing and state callback targets are source-only.",
      "Connected acceleration \u2192 snapshot graph is an explicit assembly choice, not recovered full-frame order; most snapshot fields remain private defaults."
    ],
    "evidence": [
      "research/deep-extraction/resume/metroid-fusion/next-extraction/system.json"
    ],
    "runtimeQualified": false,
    "canonicalState": {
      "identity": "metroid-fusion.player.jump-transition-contact:canonical-actor",
      "fields": [
        "player.current:44-byte record",
        "state/jump_variant:u8",
        "x/y/vx/vy:s16",
        "facing:u16",
        "previous_transition:44-byte record"
      ],
      "aliasRule": "Current and previous records have distinct identities; packed snapshot words must alias their byte/halfword views. Shared velocity binding alone does not unify all player fields."
    },
    "roleFacets": [
      {
        "roleId": "control",
        "capability": "directional-acceleration-and-jump-transition",
        "status": "published-subset",
        "scope": "0x08006240 acceleration and 0x08004d60 snapshot/reset are finite-qualified; surrounding jump admission and initialization remain source-only.",
        "evidence": [
          "research/deep-extraction/resume/metroid-fusion/next-extraction/system.json"
        ]
      },
      {
        "roleId": "terrain",
        "capability": "terrain-probes-and-collision-transition",
        "status": "source-only",
        "scope": "0x08005eec calls 0x08068b1c at two feet samples; 0x0800a054 may send a collision-produced request to 0x08008fa0. Full contact/landing closure remains open.",
        "evidence": [
          "research/deep-extraction/resume/metroid-fusion/next-extraction/system.json"
        ]
      }
    ],
    "integration": "Select once across roles; preserve this module instance and its source actor. Cross-game state, units and services require explicit mapping.",
    "recoveredAssembly": {
      "id": "fusion.acceleration-snapshot-subset",
      "label": "Acceleration \u2192 transition snapshot subset",
      "descriptorRef": "research/deep-extraction/resume/metroid-fusion/next-extraction/system.json",
      "assemblyRef": "research/deep-extraction/resume/metroid-fusion/coverage-pass/acceleration-snapshot-connected.graph.json",
      "validationRef": "local/ir/mashup-coverage/metroid-fusion/acceleration-snapshot-connected.receipt.json",
      "packageIds": [
        "fusion.motion.directional_acceleration",
        "fusion.state.transition_snapshot_reset"
      ],
      "scope": "Binding/lowering admitted with shared vx; chosen order and private snapshot defaults remain assumptions.",
      "runtimeQualified": false,
      "readyToAdd": false
    },
    "planIds": [
      "character-traversal"
    ]
  },
  {
    "id": "kirby-terrain-bundle",
    "label": "Terrain probes, wall correction & support flags \u00b7 Kirby",
    "sourceGame": "kirby-nightmare-in-dream-land",
    "sourceSystemId": "kirby-nightmare-in-dream-land.terrain-contact-resolution",
    "moduleId": "kirby-nightmare-in-dream-land.terrain-contact-resolution",
    "packageIds": [
      "kirby-nightmare.terrain.left_displacement_shape1",
      "kirby-nightmare.terrain.right_displacement_shape1",
      "kirby-nightmare.terrain.vertical_displacement_shape1"
    ],
    "availability": "published-subset",
    "description": "Actor contact root samples center/side feet, applies signed lateral/vertical displacement, conditionally resamples and publishes contact/material flags. Published leaves cover only shape selector1, not a terrain solver.",
    "scope": "Actor contact root samples center/side feet, applies signed lateral/vertical displacement, conditionally resamples and publishes contact/material flags. Published leaves cover only shape selector1, not a terrain solver.",
    "gaps": [
      "Sampler map extents, dynamic shapes and metadata domains remain open.",
      "Actor root, actor load/writeback and source cadence are unqualified.",
      "Published displacement returns lack return_meaning/unit/frame, so existing admission deliberately leaves return unbound."
    ],
    "evidence": [
      "research/deep-extraction/resume/kirby-nightmare-in-dream-land/next-extraction/system.json"
    ],
    "runtimeQualified": false,
    "canonicalState": {
      "identity": "kirby-nightmare-in-dream-land.terrain-contact-resolution:canonical-actor",
      "fields": [
        "scratch sampleIndex:u16",
        "current/below shape and attribute:u16",
        "actor scratch x/y:s16",
        "contact flags/material",
        "terrain map and immutable shape rows"
      ],
      "aliasRule": "One mutable probe scratch across sequential samples and lookups; preserve saved caller locals, mixed-width actor scratch and original actor load/writeback."
    },
    "roleFacets": [
      {
        "roleId": "terrain",
        "capability": "wall-floor-displacement-and-ground-support",
        "status": "published-subset",
        "scope": "0x0801e178 performs actual feet/side correction and contact flag publication. Three native-qualified shape1 lookup leaves support that root; sampler\u2192correction is not executable.",
        "evidence": [
          "research/deep-extraction/resume/kirby-nightmare-in-dream-land/next-extraction/system.json"
        ]
      }
    ],
    "integration": "Select once across roles; preserve this module instance and its source actor. Cross-game state, units and services require explicit mapping.",
    "existingCandidateIds": [
      "kirby-terrain-source"
    ],
    "planIds": [
      "character-traversal"
    ]
  },
  {
    "id": "megaman-air-contact-bundle",
    "label": "Air motion, contact result & landing rewrite \u00b7 MegaMan Zero",
    "sourceGame": "megaman-zero",
    "sourceSystemId": "megaman-zero.air-entry-motion-contact-landing",
    "moduleId": "megaman-zero.air-entry-motion-contact-landing",
    "packageIds": [
      "megaman_zero.motion.command_horizontal_step"
    ],
    "availability": "published-subset",
    "description": "Air entry and ordered air step share command history, position/contact views and motion state. The root integrates Y before gravity, retains vertical contact return and then rewrites landing state. Published horizontal command step is the only qualified member.",
    "scope": "Air entry and ordered air step share command history, position/contact views and motion state. The root integrates Y before gravity, retains vertical contact return and then rewrites landing state. Published horizontal command step is the only qualified member.",
    "gaps": [
      "Terrain/contact return and landing animation/state closure remain source-only.",
      "Callback dispatch, division, command-ring producer/index and physical units remain unresolved.",
      "Animation clock/state changes cannot be discarded as cosmetic; launch\u2192air-mode schedule remains unproved."
    ],
    "evidence": [
      "research/deep-extraction/resume/megaman-zero/next-extraction/system.json"
    ],
    "runtimeQualified": false,
    "canonicalState": {
      "identity": "megaman-zero.air-entry-motion-contact-landing:canonical-actor",
      "fields": [
        "x/y:i32",
        "horizontal_magnitude/vy/ay:i32",
        "packed motion state/history",
        "command ring:u8[64]",
        "shape reference and previous/contact subview",
        "effective input:u16"
      ],
      "aliasRule": "All callees reference one actor; ring and packed state aliases must remain intact. Facing writes precede collision calls."
    },
    "roleFacets": [
      {
        "roleId": "control",
        "capability": "command-directed-horizontal-air-step",
        "status": "published-subset",
        "scope": "0x08016d78 consumes command ring and facing, mutating X; parent 0x0801f674 orders it before contact and vertical advance.",
        "evidence": [
          "research/deep-extraction/resume/megaman-zero/next-extraction/system.json"
        ]
      },
      {
        "roleId": "terrain",
        "capability": "vertical-contact-and-landing-state-rewrite",
        "status": "source-only",
        "scope": "0x080191b4 returns collision after Y advance; 0x0801f674 retains it, then rewrites state/history and invokes 0x08016dc4 landing update.",
        "evidence": [
          "research/deep-extraction/resume/megaman-zero/next-extraction/system.json"
        ]
      }
    ],
    "integration": "Select once across roles; preserve this module instance and its source actor. Cross-game state, units and services require explicit mapping.",
    "planIds": [
      "character-traversal"
    ]
  },
  {
    "id": "kirby-mirror-hop-bundle",
    "label": "Proximity activation & timed actor hop \u00b7 Kirby Amazing Mirror",
    "sourceGame": "kirby-and-the-amazing-mirror",
    "sourceSystemId": "kirby-amazing-mirror.pool-eligibility-proximity-hop",
    "moduleId": "kirby-amazing-mirror.pool-eligibility-proximity-hop",
    "packageIds": [
      "kirby-amazing-mirror.actor.callback_phase_reset"
    ],
    "availability": "published-subset",
    "description": "Actor-pool eligibility and live target proximity install callbacks for a timed hop/approach state machine. This is actor behavior evidence; it does not establish a player controller. Only callback/phase reset is published.",
    "scope": "Actor-pool eligibility and live target proximity install callbacks for a timed hop/approach state machine. This is actor behavior evidence; it does not establish a player controller. Only callback/phase reset is published.",
    "gaps": [
      "Hop consumes collision flags, animation flags and vertical velocity whose writers and scheduling are unresolved.",
      "Pool bounds, dispatcher timing, allocator/lifetime and persistence are open.",
      "Callback reset alone supplies neither hop integration nor terrain contact."
    ],
    "evidence": [
      "research/deep-extraction/resume/kirby-and-the-amazing-mirror/next-extraction/system.json"
    ],
    "runtimeQualified": false,
    "canonicalState": {
      "identity": "kirby-amazing-mirror.pool-eligibility-proximity-hop:canonical-actor",
      "fields": [
        "callback/phase/timer/animation cursors",
        "position x/y:s32",
        "velocity x/y:s16",
        "collision_flags:u8",
        "live target EntityRef",
        "canonical actor pool"
      ],
      "aliasRule": "Same task payload across callbacks; live target/pool entries remain references. Byte and halfword velocity stores alias."
    },
    "roleFacets": [
      {
        "roleId": "control",
        "capability": "proximity-driven-actor-hop",
        "status": "source-only",
        "scope": "0x08023d68 contains horizontal acceleration/clamp, timed phases and vertical impulse; published 0x0809f7d8 only resets callback/phase metadata.",
        "evidence": [
          "research/deep-extraction/resume/kirby-and-the-amazing-mirror/next-extraction/system.json"
        ]
      },
      {
        "roleId": "terrain",
        "capability": "hop-contact-feedback",
        "status": "missing",
        "scope": "Hop consumes collision_flags, but source terrain writer and integration order have not been established. No ground-contact implementation claimed.",
        "evidence": [
          "research/deep-extraction/resume/kirby-and-the-amazing-mirror/next-extraction/system.json"
        ]
      }
    ],
    "integration": "Select once across roles; preserve this module instance and its source actor. Cross-game state, units and services require explicit mapping.",
    "planIds": []
  },
  {
    "id": "crash-phase-payload-bundle",
    "label": "Phase requests & signed actor payload \u00b7 Crash",
    "sourceGame": "crash-bandicoot-the-huge-adventure",
    "sourceSystemId": "crash.phase_request_actor_application",
    "moduleId": "crash.phase_request_actor_application",
    "packageIds": [
      "crash.actor.apply_phase_payload_reset_scalar",
      "crash.actor.apply_phase_payload_preserve_scalar",
      "crash.input.direction_lookup"
    ],
    "availability": "published-subset",
    "description": "Controller phase/request/latch selects one synchronous signed actor payload application, then clears dirty state; rearm is a later source operation. Payload channels have unknown units, so this is an actor action-state mechanism rather than established physical movement.",
    "scope": "Controller phase/request/latch selects one synchronous signed actor payload application, then clears dirty state; rearm is a later source operation. Payload channels have unknown units, so this is an actor action-state mechanism rather than established physical movement.",
    "gaps": [
      "Producer\u2192mapping\u2192one-variant apply\u2192dirtyclear closure remains unqualified.",
      "Payload channels and scalar have unknown physical meaning/units; no ground contact or airborne steering inferred.",
      "Rearm schedule and clock/audio effects remain open."
    ],
    "evidence": [
      "research/deep-extraction/resume/crash-bandicoot-the-huge-adventure/next-extraction/source-l2-contract.json"
    ],
    "runtimeQualified": false,
    "canonicalState": {
      "identity": "crash.phase_request_actor_application:canonical-actor",
      "fields": [
        "controller phase/latch/request/dirty/apply_variant",
        "same actor back-reference",
        "actor sign flag",
        "scalar64 and payload channels54/58/5c"
      ],
      "aliasRule": "Controller+0x10 and global actor reference denote the same actor under source bind; reset/preserve variants are exclusive choices, never a sequential pair."
    },
    "roleFacets": [
      {
        "roleId": "control",
        "capability": "phase-request-to-actor-payload",
        "status": "published-subset",
        "scope": "0x080151c8 produces requests; 0x08012af4 chooses reset0x0800b6d0 or preserve0x0800b6a0 and clears dirty. Only the apply leaves and direction lookup are published.",
        "evidence": [
          "research/deep-extraction/resume/crash-bandicoot-the-huge-adventure/next-extraction/source-l2-contract.json"
        ]
      }
    ],
    "integration": "Select once across roles; preserve this module instance and its source actor. Cross-game state, units and services require explicit mapping.",
    "planIds": []
  }
];
