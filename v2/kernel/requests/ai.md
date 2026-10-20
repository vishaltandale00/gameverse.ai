# Kernel requests from the ai workstream

Each request lists the workaround already in place inside the ai files, so nothing is blocked.

## 1. Apply nested field defaults for omitted `object` params

`checkParam` returns `schema.default` as-is when an object param is omitted. With `default: {}` none of the object's field defaults are applied, so `config.perception.sight` is `undefined` in `install`. The same happens with any object param that declares field defaults.

**Ask:** when an object param is omitted and has `fields`, run `checkFields(fields, schema.default ?? {}, …)` so the field defaults are applied.

**Workaround:** `objectParam(schema)` in `gameplay/ai-lib.js` builds the default object from the field defaults. It is used for brain `perception`, attacks `bullet`, level `curve` and wanted `arrest`.

## 2. Subject-relative spatial predicates in AI rules

Kernel `near`/`zone` resolve a missing `who` to the player. Inside an AI rule (`ai.brain[].when`, `attacks[].when`), the documents write `{near: 'player', within: 7}` and mean "this agent is within 7 of the player". As written, the kernel reads it as "the player is near the player", which is never true.

**Ask:** let a predicate context carry a default subject (`context.subject`, falling back to the player), and have `zone`/`near` use `who ?? context.subject`.

**Workaround:** `selfRelative(pred)` in `ai-lib.js` rewrites `near`/`zone` predicates without `who` to `who: 'self'` before the ai primitives evaluate them. The cards document this.

## 3. Read access to registered action names per entity (optional)

`progression.abilities` grants verbs. It can't wrap other primitives' `rt.action` handlers to block verbs that haven't been unlocked, because there is no hook between input and actions.

**Ask:** an optional action guard, e.g. `rt.guardAction(fn(name, value, rt) → bool)`, consulted in `step()` before an action runs.

**Workaround:** the `abilities` service (`grants(who, verb)`) and the `grants` predicate. Movement and combat primitives check these themselves (agreed with ws-move).
