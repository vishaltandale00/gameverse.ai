"""Lower bounded reward strategy predicates into a pinned recovered policy.

The insertion point has a specific recovered transaction contract. This is an
authored policy extension, not recovery of arbitrary C or a universal IR pass.
"""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = "research/deep-extraction/castlevania"
BASE_POLICY_SHA = "7737885f3946a07f4faf46b98a77e4959fb628220d9f8b16d2741e1a6eb38ea8"
FIELDS = {"owned_count": "owned_count", "soul_rarity": "d->soul_rarity",
          "soul_kind": "d->soul_kind", "soul_id": "d->soul_id", "species": "e->species"}
CAPACITIES = (56, 26, 36, 8)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def lower_predicate(expression):
    remaining = [32]

    def node(value, depth=0):
        remaining[0] -= 1
        if remaining[0] < 0 or depth > 8 or not isinstance(value, dict):
            raise ValueError("predicate exceeds 32 nodes/depth8 or is malformed")
        op = value.get("op")
        if op == "field" and set(value) == {"op", "name", "type"}:
            if value["type"] != "u32" or value["name"] not in FIELDS:
                raise ValueError("unknown or mistyped reward predicate field")
            return FIELDS[value["name"]], "u32"
        if op == "const" and set(value) == {"op", "value", "type"}:
            if value["type"] != "u32" or type(value["value"]) is not int or not 0 <= value["value"] <= 0xffffffff:
                raise ValueError("predicate constant outside u32 domain")
            return str(value["value"]) + "u", "u32"
        if set(value) != {"op", "args", "type"} or value["type"] != "bool" or not isinstance(value["args"], list):
            raise ValueError("unsupported predicate record")
        operators = {"equal": ("==", "u32"), "not_equal": ("!=", "u32"),
                     "less_unsigned": ("<", "u32"), "and": ("&&", "bool"), "or": ("||", "bool")}
        if op not in operators or len(value["args"]) != 2:
            raise ValueError("unsupported predicate operator or arity")
        symbol, expected = operators[op]
        left, lt = node(value["args"][0], depth+1)
        right, rt = node(value["args"][1], depth+1)
        if lt != expected or rt != expected:
            raise ValueError("predicate operand type mismatch")
        return f"({left} {symbol} {right})", "bool"

    code, kind = node(expression)
    if kind != "bool":
        raise ValueError("strategy condition must be boolean")
    return code


def generate_strategy(spec, output_prefix, root=ROOT):
    """Materialize source/package pins; never certify native execution.

    strategy0 uses original behavior; strategy1 evaluates the bounded authored
    condition only inside the original soul-eligibility branch. Other strategy
    values are forbidden by the exported native constant domain.
    """
    root, prefix = Path(root), Path(output_prefix)
    if not prefix.is_absolute():
        prefix = root / prefix
    prefix.resolve().relative_to(root.resolve())
    if (spec.get("schema") != "gameverse.reward-strategy/1" or spec.get("insertion") != "before-soul-roll"
            or spec.get("action") != "spawn-descriptor-soul-and-return"
            or spec.get("eligible_descriptor_policy") != "reviewed-source-soul-eligibility"):
        raise ValueError("unsupported reward strategy contract")
    predicate = lower_predicate(spec["when"])
    allowed = spec.get("eligible_species")
    if (not isinstance(allowed, list) or not allowed or len(allowed) > 128
            or any(type(n) is not int or not 0 <= n < 128 for n in allowed) or len(set(allowed)) != len(allowed)):
        raise ValueError("explicit distinct eligible_species0..127 required")
    ordinary = json.loads((root / BASE / "acquisition-qualification.json").read_text())
    package_path = root / BASE / "defeat.package.json"
    package = json.loads(package_path.read_text())
    policy_path, host_path = root / BASE / "defeat-policy.c", root / BASE / "defeat-host.c"
    descriptor_path = root / BASE / "enemy-reward-descriptors.json"
    inventory_path = root / BASE / "soul-inventory.c"
    if sha(policy_path) != BASE_POLICY_SHA:
        raise ValueError("qualified policy insertion point source changed")
    for ref in package["lowering"]["native_v1"]["sources"]:
        if sha(root / ref["ref"]) != ref["sha256"]:
            raise ValueError("base package source pin changed")
    descriptors = json.loads(descriptor_path.read_text())
    if descriptors["rom_sha256"] != package["native_implementation"]["recovery"]["rom_sha256"]:
        raise ValueError("descriptor table belongs to a different host")
    rom_path = root / "local/roms/Castlevania - Aria of Sorrow (USA).gba"
    rom = rom_path.read_bytes()
    if hashlib.sha256(rom).hexdigest() != descriptors["rom_sha256"]:
        raise ValueError("descriptor source ROM identity mismatch")
    from tools.prefab_pipeline.soul_eligibility import verify_eligibility
    eligibility_proof = verify_eligibility(root, rom)
    if not set(allowed) <= set(eligibility_proof["ordinary_species"]):
        raise ValueError("requested species lack source-reviewed ordinary reward eligibility")
    # Bind capacities to the recovered inventory implementation, not assumptions.
    source_inventory = inventory_path.read_text()
    if sha(inventory_path) != ordinary.get("source_pins", {}).get(BASE + "/soul-inventory.c"):
        raise ValueError("inventory implementation is not covered by retained qualification")
    if any(f"s.capacity[{index}]={size}" not in source_inventory for index, size in enumerate(CAPACITIES)):
        raise ValueError("recovered inventory capacity contract changed")
    eligible = []
    seen = set()
    for row in descriptors["rows"]:
        species, kind, identity = row["species"], row["soul_kind"], row["soul_id_one_based"]
        if type(species) is not int or species in seen or not 0 <= species < 128:
            raise ValueError("invalid descriptor species domain")
        seen.add(species)
        if species >= 113:  # Original descriptor table ends before old sentinel rows.
            continue
        start = int(descriptors["address"], 16) - 0x08000000 + species * descriptors["stride"]
        raw = rom[start:start + descriptors["stride"]]
        if (len(raw) != 36 or hashlib.sha256(raw).hexdigest() != row["record_sha256"]
                or (raw[18], raw[23], raw[24]) != (row["soul_rarity"], kind, identity)):
            raise ValueError("descriptor eligibility differs from source ROM bytes")
        if species in allowed and row["soul_rarity"] and 0 <= kind < 4 and 1 <= identity <= CAPACITIES[kind]:
            eligible.append(row)
    if len(eligible) != len(allowed):
        raise ValueError("allowlisted descriptor lacks source soul eligibility/capacity")
    eligibility = "static int strategy_descriptor_eligible(const GvAosDefeated *e,const GvAosEnemyReward *d){\n switch(e->species){\n"
    for row in eligible:
        eligibility += (f" case {row['species']}: return d->soul_kind=={row['soul_kind']}u && "
                        f"d->soul_id=={row['soul_id_one_based']}u && d->soul_rarity=={row['soul_rarity']}u;\n")
    eligibility += " default:return 0;\n }\n}\n"
    policy = policy_path.read_text()
    policy = policy.replace('#include "defeat-policy.h"', '#include "first-soul-policy.h"\n' + eligibility, 1)
    policy = policy.replace("void gv_aos_defeat(", "void gv_aos_first_soul(", 1)
    policy = policy.replace("uint32_t scale) {", "uint32_t strategy) {\n if(e->species>=128)return;", 1)
    policy = policy.replace(" xp*=scale;", " /* Authored discovery policy retains original XP. */", 1)
    needle = "  if(!v->soul_count(v->context,d->soul_kind,d->soul_id-1))threshold=(s->special_drop_flags&0xf0)?7:6;"
    if policy.count(needle) != 1:
        raise ValueError("expected exactly one qualified soul ownership query")
    replacement = ("  uint32_t owned_count=v->soul_count(v->context,d->soul_kind,d->soul_id-1);\n"
                   f"  if(strategy==1 && strategy_descriptor_eligible(e,d) && {predicate}){{\n"
                   "   v->spawn(v->context,1,x,y,d->soul_kind,d->soul_id-1);return;\n  }\n"
                   "  if(!owned_count)threshold=(s->special_drop_flags&0xf0)?7:6;")
    policy = policy.replace(needle, replacement)
    header = (root / BASE / "defeat-policy.h").read_text().replace("GV_AOS_DEFEAT_H", "GV_AOS_FIRST_SOUL_H")
    header = header.replace("xp_scale1=original;2=explicit new balance variant.", "strategy0=original XP/reward semantics;1=authored descriptor-guarded strategy.")
    header = header.replace("gv_aos_defeat", "gv_aos_first_soul").replace("xp_scale", "strategy")
    # The original host adapter remains the only source of campaign/entity state.
    host = host_path.read_text().replace('"defeat-policy.h"', '"first-soul-policy.h"').replace("gv_aos_defeat", "gv_aos_first_soul")
    host = host.replace("unsigned species=a[0x36];", "unsigned species=a[0x36];if(species>=128)return;", 1)
    outputs = {"policy": prefix.with_name(prefix.name + "-policy.c"), "header": prefix.with_name(prefix.name + "-policy.h"),
               "host": prefix.with_name(prefix.name + "-host.c"), "package": prefix.with_name(prefix.name + ".package.json")}
    prefix.parent.mkdir(parents=True, exist_ok=True)
    for key, content in (("policy", policy), ("header", header), ("host", host)):
        outputs[key].write_text(content)
    derived = copy.deepcopy(package)
    derived["id"], derived["version"] = "castlevania.aria.first_soul_rewards", "1.0.0"
    derived["concept"]["pattern"] = "Authored predicate controls a native soul pickup request; recovered collection owns persistent inventory."
    native = derived["native_implementation"]
    native["origin"] = "new_bridge"
    native["abi"] = "void gv_aos_first_soul_native(actor*,u32strategy);0 parity,1 authored predicate"
    native["compiler_ref"] = "pending native qualification; generated strategy evidence is structural only"
    native["recovery"]["lift_ref"] = str(outputs["policy"].relative_to(root))
    native["recovery"]["lift_sha256"] = sha(outputs["policy"])
    native["recovery"]["semantic_status"] = "authored_variant_pending_native_qualification"
    native["recovery"]["unknowns"] = ["Authored variant is not original recovered behavior", "New candidate native gameplay remains to be tested", "Allocation failure can prevent collection; request guarantee is not inventory mutation"]
    derived["extraction"]["preconditions"] = ["Exact pinned USA host", "Enemy species0..127", "Strategy0or1", "Guaranteed request only for reviewed eligible descriptor tuples"]
    derived["extraction"]["semantic_changes"] = ["Bounded predicate on current ownership before soul RNG", "On authored match issue one real soul pickup request and return; XP and once-only guards retained", "No new RAM; collection alone changes persistent soul inventory"]
    derived["qualification"] = {"scenarios": [], "required_witnesses": ["strategy0 native parity", "first unowned soul spawn then actual collection", "owned soul follows original RNG", "duplicate/mode/no-soul guards"], "known_limits": ["Native candidate not yet qualified"]}
    for behavior in derived.get("behaviors", []):
        behavior["invariants"] = [text.replace("preserve exact sequential RNG draws", "strategy0/non-match preserve exact RNG order; strategy1 match intentionally bypasses RNG")
                                  for text in behavior.get("invariants", [])]
    lowering = derived["lowering"]["native_v1"]
    lowering["sources"] = [{"ref": str(outputs[key].relative_to(root)), "sha256": sha(outputs[key])} for key in ("policy", "header", "host")]
    lowering["translation_units"] = [str(outputs[key].relative_to(root)) for key in ("policy", "host")]
    lowering["exports"] = [{"symbol": "gv_aos_first_soul_native", "return": "void", "args": ["ptr", "u32"], "constant_choices": {"1": [0, 1]}}]
    derived["strategy_contract"] = {"spec": spec, "base_package": {"ref": str(package_path.relative_to(root)), "sha256": sha(package_path)},
                                    "lowerer": {"ref": str(Path(__file__).relative_to(root)), "sha256": sha(Path(__file__))},
                                    "descriptor_table": {"ref": str(descriptor_path.relative_to(root)), "sha256": sha(descriptor_path)},
                                    "inventory_contract": {"ref": str(inventory_path.relative_to(root)), "sha256": sha(inventory_path)},
                                    "ordinary_enemy_evidence": eligibility_proof,
                                    "eligibility_verifier": {"ref": "tools/prefab_pipeline/soul_eligibility.py", "sha256": sha(root / "tools/prefab_pipeline/soul_eligibility.py")},
                                    "eligible_species": [row["species"] for row in eligible], "new_ram_bytes": 0,
                                    "lifecycle": "defeat once -> optional real pickup entity -> recovered collection -> persistent original inventory",
                                    "rng_policy": "Authored match bypasses soul RNG and later drops; non-match and strategy0 retain original calls/order"}
    outputs["package"].write_text(json.dumps(derived, indent=2) + "\n")
    return {"schema": "gameverse.reward-strategy-lowering/1", "status": "generated-awaiting-native-proof",
            "outputs": {key: {"path": str(path.relative_to(root)), "sha256": sha(path)} for key, path in outputs.items()},
            "eligible_species": derived["strategy_contract"]["eligible_species"], "new_ram_bytes": 0,
            "lowerer_sha256": sha(Path(__file__))}


def lower_reward_strategy(strategy, output_dir):
    """Public request frontend: deterministic IR -> pinned package in attempt dir."""
    output = Path(output_dir).resolve()
    output.relative_to(ROOT)
    if output.exists():
        raise ValueError("strategy output must be a fresh isolated directory")
    result = generate_strategy(strategy, output / "first-soul")
    (output / "lowering-receipt.json").write_text(json.dumps(result, indent=2) + "\n")
    return {**result, "package": result["outputs"]["package"],
            "receipt": {"path": str((output / "lowering-receipt.json").relative_to(ROOT)),
                        "sha256": sha(output / "lowering-receipt.json")}}
