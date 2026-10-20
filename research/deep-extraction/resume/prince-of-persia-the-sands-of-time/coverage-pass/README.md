# Prince of Persia Mashup admission

Actual generic Composer validation admitted one finite **initialize → advance → read** sequence sharing a single public `u32` pulse slot. The request uses exact published behavior hashes and the original semantic quantity, unit and frame. Receipt: `local/ir/mashup-coverage/prince-of-persia-the-sands-of-time/shared-pulse-finite.validation.json`; validation took **0.011017125 s**.

This is a partial binding proof. Advance's packed stop word remains private at its zero default. The initialization stop byte does not alias it in this admitted graph. Query return is discarded because the published package lacks a return semantic contract. No runtime scheduler or recurring phase graph is established.

A second request tried to preserve the original shared stop gate. Actual validation rejected it in **0.000487458 s** with:

> private opaque field cannot be a public binding: advanceClock.field_1

The source initializer writes a `u8` stop byte; advance reads a `u32` view and tests only its low byte. The current Composer requires equal storage widths and does not supply a proved packed shared-view adapter. Giving the whole word an invented semantic type or splitting it into independent objects would hide the blocker.

No published Prince of Persia damage/protection controller exists in this package set, so there is no honest damage → protection → timer connection to assemble. The four available packages provide clock initialization, advance/query, and a separate world-gate query. The hazard, hit, expiry/drain and history system remains open.

[result.json](result.json) pins both requests and actual receipts, published component identities, owned/shared slots, domains, effects, order, and gaps. This pass performed no mining, exports, ROM generation, builds or native runs. Admission does not qualify the composed graph natively or complete the source system.
