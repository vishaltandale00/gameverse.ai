# Bounded assembly schedule contract

`assembly.validate` now accepts optional guards and explicit temporal obligations in existing `gameverse.mechanic-assembly/0.1` requests. Existing calls remain compatible. The returned `materialized_statements` are executable Composer input, including actual `if` bodies; `statement_sha256` covers those guards. No source/native proof or package was changed.

See `minish-conditional.assembly.json` for a complete admitted graph using the explicitly authored `(skills & 1) != 0` rule, `minish-conditional.c` for the actual generated recovered functions and conditional wrappers, and `verification.json` for bounded host results. Structural schema: `tools/behavior_ir/mechanic-assembly-schedule.schema.json`. The Python validator additionally enforces types, source effects and schedule/path obligations.

Each invocation, including an authored adapter invocation, can carry:

```json
{
  "component": "exchange",
  "arguments": {
    "param_0": {"op":"const", "type":"u32", "value":0},
    "param_1": {"op":"const", "type":"u32", "value":1}
  },
  "id": "action_call",
  "phase": "action",
  "when": {
    "op":"not_equal", "type":"u8",
    "args":[{"op":"slot", "type":"u16", "name":"skills"},
            {"op":"const", "type":"u16", "value":0}]
  },
  "requires":[{"slot":"skills", "producer":"refresh_call", "after_writes":["inventory"]}]
}
```

Declare `schedule:{"phases":["learn","refresh","action"]}` at the request root to require a declared, monotonically ordered phase on every call. Phase labels express caller obligations; they do not infer source dispatch or a once-per-event policy. IDs are optional except when another call references them, unique, and distinct from component names.

Conditions are pure bounded expression trees: exact typed scalar `slot`, finite `const`, `bit_and`, `bit_or`, `bit_xor`, comparisons (`equal`, `not_equal`, `less_unsigned`, `less_equal_unsigned`, `less_signed`, `less_equal_signed`), and predicate `bool_and`, `bool_or`, `bool_not`. Comparison operands have matching integer widths and compatible quantity/unit/frame/encoding; constants inherit the compared quantity. Predicate results use `u8`; integer truthiness is rejected. Signed ordering requires evidenced two's-complement slot semantics. No code, call, callback dereference, arithmetic scaling, loop or dynamic array index is accepted. Conditions are capped at 64 nodes and depth12; the graph retains its existing 128-call bound.

A requirement means the referenced earlier invocation synchronizes that canonical scalar/collection/result slot, is its latest writer, and runs on every path. Each `after_writes` dependency must actually be read by the producer, cannot also be written by that producer (internal chronology would be ambiguous), and cannot be written between producer and consumer. Source stores are conservatively counted as may-writes; the source need not change the value to synchronize it. Conditional producers are rejected even if a human believes two guards imply each other. No value is invented for a skipped producer. Field, collection and `invocation.result` writes all invalidate freshness. Adapter producers and mappings must similarly be unconditional and current; conditional final consumers are supported.

A guard counts as a real state reader for shared ownership. A guard on an internally owned written slot must declare freshness. External state represents caller-supplied input; its freshness remains the caller's responsibility. An internally owned otherwise unwritten guard slot needs explicit initialization or a prior producer. Thus the example marks `skills.shared=true` when the exchange's guard consumes refresh-owned skills.

Failures use existing `errors[].code=assembly_contract` with an `assembly schedule:` message. `must precede consumer`, `may be skipped`, `stale or overwritten`, `dependency changed`, and `producer also writes dependency` reject an unsatisfied/ambiguous data path. `phase order regressed` rejects declared callback/update order. Type, arity, semantic, expression-limit and unknown-field failures reject unsupported condition contracts. Success remains `binding_valid_obligations_unproven`: the check proves only the explicit declared schedule/data obligations, not complete gameplay policy.

The focused verifier checks consumer-first cache use, a skipped producer, writes after refresh, overwritten results, false/true/revoked permission paths, malformed predicates and phase regression. Its real compiled Minish source path shows stale nonzero skills refreshed to0 prevents exchange; learned state1 permits paired exchange; revoke state2 refreshes to0 and preserves both current order lanes; unrelated item115 produces skills512 and remains denied. Repeating a permitted call swaps again: duplicate command delivery still belongs to the runtime lifecycle owner. Source SMA1 death/retry phase order is checked without claiming recovered dispatch, fixed-point repair or callback validity. The legacy DB→authored bit mapper→Minish graph still passes and skipped producer/mapper paths fail.

Reproduce only the focused checks:

```sh
python3 -B tools/behavior_ir/verify_assembly_schedule.py
python3 -B tools/behavior_ir/verify_assembly.py
python3 -B tools/behavior_ir/verify_bit_mapping.py
```

No dependency, CI job, full campaign or native qualification was added. One clean host compile is capped at15s and its process at5s. Existing before/after verifiers use identical fixtures and environments; their retained wall times are in `timing-comparison.json`. Single-run differences are noise-scale and no speedup or SLA claim is made. Build and execution timings are nested in focused total; queue, model evaluation, game build and cache hit/miss measurements are unavailable.
