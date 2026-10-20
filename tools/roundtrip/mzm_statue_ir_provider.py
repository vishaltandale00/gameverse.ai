"""Install actual lifted statue consumption; retain original grant/event entries."""
import argparse
from pathlib import Path
import json
from .ir_provider import ROOT,run
from .reassemble import sha

CONTRACT="research/ir-workshop/roundtrip-20261016/mzm-ir/statue-consumption-contract/contract.json"
RETURN_PROOF="local/roundtrip/mzm-ir-equipment-events-u32-return-20261016/receipt.json"
FRONTIER="research/ir-workshop/roundtrip-20261016/wave2/frontier/mzm-statue-consumption-v2.json"
EXPORT="local/roundtrip/mzm-statue-consumption-20261016/l0"


def profile():
    return {
        "id":"mzm.ir.statue-consumption",
        "original_sha256":"fc94f65380b65b870a30b9b04b39cca1dc63d6e46a4a373d3904adc0912ebc37",
        "targets":[("behavior","mzm.statue.behavior","08013de0"),
                   ("wait","mzm.statue.wait-collected","08014468"),
                   ("timer","mzm.statue.after-item-timer","08014494")],
        "l0_paths":{"behavior":EXPORT+"/08013de0.json","wait":EXPORT+"/08014468.json","timer":EXPORT+"/08014494.json"},
        "dependency_seeds":[{"label":"events","package":"mzm.progress.events","entry":"080608bc",
            "lifter_kwargs":{"argument_contract":{"return_abi":{"unsigned_extension":"u32",
                "evidence":[{"path":RETURN_PROOF,"sha256":sha((ROOT/RETURN_PROOF).read_bytes()),
                             "scope":"Source u32 boolean plus8192 original/rebuilt full-r0 native comparisons"}]}}}}],
        "arena_address":0x08800000,"arena_capacity":8192,"arena_append":True,
        "dependency_frontier":{"path":FRONTIER,"sha256":sha((ROOT/FRONTIER).read_bytes())},
        "source_context":{"contract":{"path":CONTRACT,"sha256":sha((ROOT/CONTRACT).read_bytes())},
                          "prior_ir_library":{"report":"local/roundtrip/mzm-ir-equipment-events-20261016/provider-report.json",
                                              "installed_in_this_candidate":False},
                          "retained_original_entries":["080138d8","080608bc"]},
        "state_lifecycle":{"actor_storage":"Borrowed current-record scratch03000738/56bytes, not independent persistent entity",
                           "persistent_records":"Original scheduler owns030001ac/24records/stride56",
                           "source_phase":"SpriteUpdate src/sprite.c932 slot-to-scratch;942/944 AI;955 same-slot copyback",
                           "allowed_mutation":"Only current scratch pose/work0; equipment/event authorities preserved",
                           "known_route_limit":"Selectors88/89/148 use UnknownItemChozoStatue; direct-entry consumer tests do not establish their normal ChozoStatue dispatcher reachability"},
    }


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--original",type=Path,required=True)
    parser.add_argument("--baseline",type=Path,required=True)
    parser.add_argument("--output",type=Path,required=True)
    parser.add_argument("--vectors",type=int,default=4096)
    args=parser.parse_args()
    result=run(profile(),args.original,args.baseline,args.output,args.vectors)
    print(json.dumps({k:result[k] for k in ("outcome","rebuilt_sha256","generated_native_bytes","raw_changed_bytes","timing")},indent=2))
