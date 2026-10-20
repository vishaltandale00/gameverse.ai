# Original producer admission before the shared queue

[producer-admission-v001.json](producer-admission-v001.json) records the source caller, initializer, guards, original fixtures and limits. [closure-result-v004.json](closure-result-v004.json) retains the cumulative versioned result; earlier consumer evidence is reused unchanged.

Original caller045fc saves the actor/world register context and dispatches actor byte+0x14 through its ROM table: mode0 selects initializer04fd0, mode1 selects producer042cc. The initializer establishes mode1 and the original hitbox0813e7cc. Its inner phases use caller-owned scratch registers, rather than an external AAPCS return convention.

Four finite original-ROM policy cases pass after that real initializer:

- Fresh bit2 activates mode1 to129, reloads timer240 and enqueues105 exactly once.
- Mode129 with timer1 expires to mode1/timer0 without activation event.
- Mode1 with timer2 decrements to1 without an edge or event.
- Source flags+0x36 bit0x10 rejects the timer region even with the activation edge.

The two edge cases were refined separately using the real KEYINPUT sampler0bba0: mGBA key2 produces held2/fresh2 before the original producer runs. This corrects the first synthetic boundary fixture's inconsistent held0/fresh2; its earlier result is retained and explicitly limited. Timer-only cases were not rerun. The two source-key cases pass with3,361 original instructions and0.111818s original execution. The earlier four-case producer run used8,952 instructions and0.121052s execution.

The initial probe failed before producer execution: the retained attract actor contained spritebank28, outside the selected four-bank context, and the harness imposed the wrong register preservation rule. That failure remains in attempt005. Attempt006 uses sourcebank0 and source inner-phase ABI; attempt007 adds actual key sampling. No service or callee is stubbed, and no C mechanics enter the recovered compiler.

The special-mode and cancellation inputs remain explicit boundary preconditions. Source terrain-dispatch index41 reaches handler024ac, whose instruction path can initialize mode26 to8 and count toward1. Natural tile admission, actor+0x45 ownership and full scene scheduling remain open. Passing original-only fixtures do not establish emitted parity, a portable controller, or whole-game readiness.
