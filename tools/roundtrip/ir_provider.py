"""Rebuild MZM's equipment/event transaction from automatically recovered L1.

The only authored C is a mechanical adapter-derived storage/entry binding.
Behavior comes exclusively from the existing machine SSA lifter and lowerer.
"""
from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
import platform
import re
import shutil
import struct
import subprocess
import sys
import time

from .reassemble import sha
from .native_provider import assemble_native_layout

ROOT = Path(__file__).resolve().parents[2]
COMPILER = ROOT / "tools/behavior_ir"
TARGETS = (("events", "mzm.progress.events", "080608bc"),
           ("acquire", "mzm.progress.acquire", "080138d8"))


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def storage_moves(adapter, *, state="s", argument_expressions=None):
    """Canonical storage moves shared by entry binding and service barriers.

    Entity views require aligned caller-owned mutable canonical RAM covering all
    declared offsets, disjoint from globals and other views for this invocation.
    Allocation/lifetime and whole-game pointer domains are not established here.
    """
    argument_expressions=argument_expressions or {"r"+str(i):"r"+str(i) for i in range(4)}
    if any(f["owner"] not in ("global", "entity") for f in adapter["fields"]):
        raise ValueError("This storage binder supports global/entity state only")
    spans=[]
    for f in adapter["fields"]:
        key="global" if f["owner"]=="global" else f["argument"]
        start=(f.get("address") or 0)+f["offset"]
        spans.append((key,start,start+f["width"]//8))
    entity_arguments=set()
    for c in adapter.get("collections",[]):
        if (c.get("size") not in (1,2,4) or type(c.get("count")) is not int or not 1<=c["count"]<=4096
                or c.get("stride",c["size"])!=c["size"]):
            raise ValueError("Unsupported collection storage binding")
        if c.get("address") is not None:
            spans.append(("global",c["address"],c["address"]+c["size"]*c["count"]))
        else:
            argument,offset=c.get("argument"),c.get("offset")
            if (c.get("owner")!="entity" or argument not in argument_expressions
                    or c.get("reference") is not None or type(offset) is not int or offset<0
                    or offset%c["size"] or offset+c["size"]*c["count"]>8192):
                raise ValueError("Unsupported entity collection storage binding")
            entity_arguments.add(argument)
            spans.append((argument,offset,offset+c["size"]*c["count"]))
    if entity_arguments and (len(entity_arguments)!=1 or any(f["owner"]=="entity" and f["argument"] not in entity_arguments for f in adapter["fields"])):
        raise ValueError("Entity collection binding requires one canonical argument base")
    for i,(owner,lo,hi) in enumerate(spans):
        if owner=="global" and not (0x02000000<=lo<hi<=0x02040000 or 0x03000000<=lo<hi<=0x03008000):
            raise ValueError("State writeback requires canonical RAM")
        if any(owner==other and lo<end and start<hi for other,start,end in spans[:i]):
            raise ValueError("Canonical state aliases must be coalesced by the IR compiler before binding")
    loads, stores = [], []
    for field in adapter["fields"]:
        address = (field.get("address") or 0) + field["offset"]
        location = f"0x{address:x}u" if field["owner"] == "global" else f"({argument_expressions[field['argument']]}+{field['offset']}u)"
        cell = f"*(volatile uint{field['width']}_t*){location}"
        loads.append(f"{state}.{field['name']}={cell};")
        stores.append(f"{cell}={state}.{field['name']};")
    for collection in adapter.get("collections", []):
        location=(f"0x{collection['address']:x}u" if collection.get("address") is not None
                  else f"({argument_expressions[collection['argument']]}+{collection['offset']}u)")
        cell = f"((volatile uint{8*collection['size']}_t*){location})[i]"
        loads.append(f"for(unsigned i=0;i<{collection['count']};i++){state}.{collection['name']}[i]={cell};")
        stores.append(f"for(unsigned i=0;i<{collection['count']};i++){cell}={state}.{collection['name']}[i];")
    return loads,stores



def validate_entry_binding(adapter):
    """Admit only inputs preserved by the current 8-byte Thumb entry transfer.

    LDR r3,[PC]; BX r3 preserves r0-r2, LR, SP and NZCV, but replaces r3
    before the C wrapper can copy its fourth argument. Callee-scratch status at
    return does not permit destroying an incoming argument at entry.
    """
    if adapter.get("native_abi") or adapter.get("native_sequence") or adapter.get("continuation_tokens"):
        raise ValueError("ordinary entry veneer requires standard scalar AAPCS input context")
    parameters=adapter.get("parameters",[])
    if any(p.get("register")=="r3" for p in parameters):
        raise ValueError("entry veneer clobbers incoming r3 before fourth argument binding")
    if any(p.get("register") not in ("r0","r1","r2") for p in parameters):
        raise ValueError("entry veneer does not support stack or non-AAPCS register arguments")
    entities=[f for f in adapter.get("fields",[]) if f.get("owner")=="entity"]
    entities.extend(c for c in adapter.get("collections",[]) if c.get("address") is None and c.get("owner")=="entity")
    if any(item.get("argument")=="r3" for item in entities):
        raise ValueError("entry veneer clobbers incoming r3 entity base before storage binding")
    if any(item.get("argument") not in ("r0","r1","r2") for item in entities):
        raise ValueError("entry veneer does not support non-AAPCS entity arguments")
    return {"mode":"thumb","transfer":"ldr_r3_literal_bx_r3","bytes":8,
            "incoming_registers_available":["r0","r1","r2"],"clobbers":["r3"],
            "preserves":["r4-r12","lr","sp","nzcv"],
            "scope":"entry transfer only; source function behavior and caller domains require separate qualification"}


def binding(adapter, label):
    """Generate storage moves, never expressions implementing game behavior."""
    validate_entry_binding(adapter)
    loads,stores=storage_moves(adapter)
    params = ["r" + str(i) for i in range(4)]
    args = [params[int(p["register"][1:])] for p in adapter["parameters"]]
    result = "" if adapter["return_type"] == "void" else "uint32_t result="
    finish = "return;" if adapter["return_type"] == "void" else "return result;"
    ret = "void" if adapter["return_type"] == "void" else "uint32_t"
    return (f"\n{ret} native_{label}(uint32_t r0,uint32_t r1,uint32_t r2,uint32_t r3){{\n"
            + f"State_{label} s;\n" + "\n".join(loads)
            + f"\n{result}lifted_{label}(&s" + "".join("," + a for a in args) + ");\n"
            + "\n".join(stores) + "\n" + finish + "\n}\n")


def trampoline(target):
    if target & 1 or not 0x08000000 <= target < 0x0a000000:
        raise ValueError("Expected aligned ROM Thumb destination")
    return struct.pack("<HHI", 0x4b00, 0x4718, target | 1)


def rooted_path(path):
    candidate=(ROOT/Path(path)).resolve()
    if not candidate.is_relative_to(ROOT) or not candidate.is_file():
        raise ValueError("Profile input must be an existing workspace file")
    return candidate


def validate_embedded_assets(x,adapter,raw):
    """Only immutable ROM-proven bytes are embedded; none enter RAM writeback."""
    assets={a["name"]:a for a in x.get("assets",[])}
    if len(assets)!=len(adapter.get("assets",[])):
        raise ValueError("IR/adapter immutable asset inventory differs")
    receipts=[]
    for a in adapter.get("assets",[]):
        data=bytes(assets[a["name"]]["data"])
        offset=a["address"]-0x08000000
        if len(data)!=a["bytes"] or not 0<=offset<=len(raw)-len(data) or raw[offset:offset+len(data)]!=data:
            raise ValueError("Embedded readonly asset does not match pinned original ROM")
        receipts.append({"name":a["name"],"address":a["address"],"bytes":len(data),"sha256":sha(data),"mode":"embedded-readonly-no-writeback"})
    return receipts


def _run(profile, original, baseline, output, vectors=4096):
    if any(name in sys.modules for name in ("lift","lower","qualify")):
        raise ValueError("Run provider in a fresh Python process; cached compiler imports cannot certify current source")
    def source_hashes():
        inputs=[*COMPILER.glob("*.py"),*COMPILER.glob("*.in"),Path(__file__),
                Path(__file__).with_name("ir_layout.py"),Path(__file__).with_name("dependency_frontier.py"),
                Path(__file__).with_name("compiler_dependencies.py"),Path(__file__).with_name("native_provider.py")]
        inputs.append(Path(__file__).with_name("elf_assets.py"))
        if profile.get("native_entry_backend"):inputs.append(Path(__file__).with_name("arm_entry.py"))
        if profile.get("native_service_backend"):
            inputs.extend([Path(__file__).with_name("retained_services.py"),Path(__file__).with_name("firered_text_profile.py"),
                ROOT/"research/ir-workshop/roundtrip-20261016/wave2/firered-text/service-boundary/native_service_oracle.c.in"])
        return {str(p.relative_to(ROOT)):sha(p.read_bytes()) for p in inputs}
    arm_backend=profile.get("native_entry_backend")
    if arm_backend:
        from .arm_entry import BACKEND
        if arm_backend!=BACKEND or not profile.get("arena_append") or profile.get("native_service_backend"):
            raise ValueError("Registered ARM global/void entry requires append arena and no retained-service backend")
    source_hashes_before=source_hashes()
    sys.path.insert(0, str(COMPILER))
    from lift import Lifter
    from lower import lower
    from qualify import qualify

    original, baseline, output = Path(original).resolve(), Path(baseline).resolve(), Path(output).resolve()
    started = time.perf_counter()
    raw = original.read_bytes()
    original_hash = sha(raw)
    expected = profile["original_sha256"]
    if original_hash != expected:
        raise ValueError("Pinned original ROM required")
    output.mkdir(parents=True, exist_ok=False)
    stages, dependencies, modules = [], {}, {}
    service_evidence={}
    if profile.get("native_service_backend"):
        if profile.get("retained_ir") or profile.get("reuse_original_proof"):
            raise ValueError("Retained-service backend requires fresh source-SSA lift and actual host-effect proof")
        from .retained_services import load_evidence
        service_evidence=load_evidence(profile["native_service_backend"])
        (output/"retained-service-evidence").mkdir()
        for digest,data in service_evidence.items():
            (output/"retained-service-evidence"/(digest+".source")).write_bytes(data)
    from .dependency_frontier import validate_profile_frontier
    frontier=validate_profile_frontier(profile)
    seed_modules={}
    for seed in profile.get("dependency_seeds",[]):
        label,entry=seed["label"],seed["entry"]
        source=rooted_path(seed.get("l0_path",f"local/ir/packages/{seed['package']}/l0.json"))
        l0=json.loads(source.read_text())
        if int(l0["entry"],16)!=int(entry,16):
            raise ValueError("Dependency seed entry identity mismatch")
        x,adapter=Lifter(l0,raw,dependencies,**seed.get("lifter_kwargs",{})).build()
        dependencies[entry]=(x,adapter)
        directory=output/"dependencies"/label
        directory.mkdir(parents=True)
        for name,data in (("l0.json",l0),("l1.json",x),("validation-adapter.json",adapter)):
            write_json(directory/name,data)
        (directory/"generated.c").write_text(lower(x))
        seed_modules[label]={"package":seed["package"],"entry":int(entry,16),"adapter":adapter,
                             "l1_sha256":sha((directory/"l1.json").read_bytes()),"installed":False,"inlined_dependency":True}

    def stage(name, command):
        start = time.perf_counter()
        proc = subprocess.run(list(map(str, command)), capture_output=True, text=True, timeout=30)
        stages.append({"name": name, "seconds": time.perf_counter()-start,
                       "command": list(map(str, command)), "outcome": "pass" if not proc.returncode else "fail",
                       "stdout": proc.stdout, "stderr": proc.stderr})
        write_json(output / "build-stages.json", stages)
        proc.check_returncode()
        return proc.stdout

    for label, package, entry in profile["targets"]:
        start = time.perf_counter()
        directory = output / label
        directory.mkdir()
        package_root=(ROOT/profile.get("package_roots",{}).get(package,"local/ir/packages/"+package)).resolve()
        source=rooted_path(profile.get("l0_paths",{}).get(label,str((package_root/"l0.json").relative_to(ROOT))))
        l0 = json.loads(source.read_text())
        if int(l0["entry"],16)!=int(entry,16):
            raise ValueError("Target entry identity mismatch")
        if profile.get("retained_ir", False):
            x = json.loads((package_root / "l1.json").read_text())
            adapter = json.loads((package_root / "validation-adapter.json").read_text())
            package_manifest = json.loads((package_root / "package.json").read_text())
            receipt = json.loads((package_root / "receipt.json").read_text())
            if (package_manifest["qualification"]["status"] != "pass" or receipt["outcome"] != "pass"
                    or package_manifest["behavior_sha256"] != sha((package_root / "l1.json").read_bytes())
                    or receipt["artifacts"]["l1.json"]["sha256"] != package_manifest["behavior_sha256"]
                    or receipt["rom_sha256"] != original_hash):
                raise ValueError("Retained qualified IR provenance mismatch")
        else:
            kwargs=dict(profile.get("lifter_kwargs",{}).get(label,{}))
            if kwargs.get("retained_services"):
                if not service_evidence:
                    raise ValueError("Retained service lift requires explicit native backend/evidence")
                kwargs["service_evidence"]=service_evidence
            x, adapter = Lifter(l0, raw, dependencies,**kwargs).build()
        if arm_backend:
            from .arm_entry import contract as arm_contract
            entry_abi=arm_contract(adapter,raw)
        else:
            entry_abi=validate_entry_binding(adapter)
        asset_receipt=validate_embedded_assets(x,adapter,raw)
        dependencies[entry] = (x, adapter)
        write_json(directory / "l0.json", l0)
        write_json(directory / "l1.json", x)
        write_json(directory / "validation-adapter.json", adapter)
        if profile.get("retained_ir",False):
            shutil.copy2(package_root/"l1.json",directory/"l1.json")
            shutil.copy2(package_root/"validation-adapter.json",directory/"validation-adapter.json")
        service_emitter=None
        if x.get("retained_services"):
            if not profile.get("native_service_backend"):
                raise ValueError("Retained-service module requires native-only provider backend")
            from .retained_services import NativeServiceEmitter
            service_emitter=NativeServiceEmitter(x,adapter,raw,service_evidence)
        elif profile.get("native_service_backend"):
            raise ValueError("Native service backend target has no retained-service statement")
        code = lower(x,native_service_emitter=service_emitter) if service_emitter else lower(x)
        (directory / "generated.c").write_text(code)
        fixture_ref=profile.get("fixtures",{}).get(label)
        fixture_path=rooted_path(fixture_ref) if fixture_ref else package_root/"fixtures.json"
        fixtures=json.loads(fixture_path.read_text()) if fixture_path.is_file() else None
        if fixtures is not None:
            write_json(directory/"fixtures.json",fixtures)
        reused_original=False
        if service_emitter:
            # The registered proof runs the actual original and rebuilt entries
            # after assembly. Never turn this pending stage into scalar parity.
            proof=None
        elif profile.get("reuse_original_proof",False):
            if not profile.get("retained_ir",False):
                raise ValueError("Original proof reuse requires a retained qualified package")
            from causal import digest
            expected_receipt=json.loads((package_root/"receipt.json").read_text())
            if (expected_receipt["outcome"]!="pass" or expected_receipt["rom_sha256"]!=original_hash
                    or expected_receipt.get("parity",{}).get("vectors")!=vectors
                    or expected_receipt.get("fixture_input_sha256")!=digest(fixtures)):
                raise ValueError("Original qualification reuse ROM/vector/fixture mismatch")
            for filename in ("l1.json","validation-adapter.json","generated.c"):
                if sha((directory/filename).read_bytes())!=expected_receipt["artifacts"][filename]["sha256"]:
                    raise ValueError("Original qualification reuse exact input mismatch")
            for filename in ("generated.bin","generated.elf","generated.ld","generated.o","validation-adapter.c"):
                source_artifact=package_root/filename
                if source_artifact.is_file():
                    if filename in expected_receipt["artifacts"] and sha(source_artifact.read_bytes())!=expected_receipt["artifacts"][filename]["sha256"]:
                        raise ValueError("Original qualification artifact pin mismatch")
                    shutil.copy2(source_artifact,directory/filename)
            shutil.copy2(package_root/"receipt.json",directory/"receipt.json")
            proof=expected_receipt;reused_original=True
        else:
            proof = qualify(directory, original, vectors, True,fixtures=fixtures)
        if not service_emitter:
            if proof["outcome"] != "pass":
                raise ValueError("Original native parity failed: " + label)
            shutil.copy2(directory / "receipt.json", directory / "original-proof.json")
        native = code.replace("LiftedState", "State_" + label).replace("behavior_0", "lifted_" + label)
        native = re.sub(r"(?m)^(void|uint(?:8|16|32|64)_t) (lifted_\w+\()", r"__attribute__((noinline)) \1 \2", native)
        if arm_backend:
            from .arm_entry import binding as arm_binding
            bound=arm_binding(adapter,label,storage_moves)
        else:
            bound=service_emitter.binding(label) if service_emitter else binding(adapter,label)
        (directory / "bound.c").write_text(native+bound)
        stage("compile_" + label, ["cc", "-target", "armv4t-none-eabi", "-mcpu=arm7tdmi", "-marm" if arm_backend else "-mthumb",
              "-ffreestanding", "-fno-builtin", "-Os", "-c", directory / "bound.c", "-o", directory / "bound.o"])
        modules[label] = {"package": package, "entry": int(entry, 16), "l0_sha256": sha(source.read_bytes()),
                          "l1_sha256": sha((directory / "l1.json").read_bytes()), "adapter": adapter,
                          "assets":asset_receipt,"installed":True,"inlined_dependency":False,
                          "original_proof_origin":("registered-original-versus-rebuilt-native-host-effects" if service_emitter else "exact-prior-original-ROM-qualification" if reused_original else "fresh-native-qualification"),
                          "native_service_bound":bool(service_emitter),"entry_abi":entry_abi,
                          ("lift_and_codegen_seconds" if service_emitter else "lift_and_original_proof_seconds"): time.perf_counter()-start}

    # Acquisition's original 780-byte body has room for both portable bodies and
    # generated storage bindings. No new ROM bank, new execution policy or fill copy.
    address, capacity = profile["arena_address"], profile["arena_capacity"]
    linker = output / "native.ld"
    append = profile.get("arena_append", False)
    if append and address != 0x08000000+len(raw):
        raise ValueError("Append arena must begin at original EOF")
    linker.write_text(f"SECTIONS {{ . = 0x{address+(0 if append else 8):x}; .text : {{ *(.text*) *(.rodata*) }} /DISCARD/ : {{ *(.ARM.exidx*) *(.comment*) *(.note*) }} }}\n")
    stage("link", ["arm-none-eabi-ld", "-T", linker, "-e", "native_"+profile["targets"][0][0],
                    *[output / label / "bound.o" for label, _, _ in profile["targets"]], "-o", output / "native.elf"])
    symbols = stage("symbols", ["arm-none-eabi-nm", "-S", output / "native.elf"])
    symbol_records=[{"name":p[3],"address":int(p[0],16),"bytes":int(p[1],16),"kind":p[2]}
                    for line in symbols.splitlines() if len(p:=line.split())==4]
    native_entries = {p[3]: int(p[0], 16) & ~1 for line in symbols.splitlines() if len(p := line.split()) == 4}
    symbol_sizes = {p[3]: int(p[1], 16) for line in symbols.splitlines() if len(p := line.split()) == 4}
    stage("binary", ["arm-none-eabi-objcopy", "-O", "binary", output / "native.elf", output / "native.bin"])
    image = (output / "native.bin").read_bytes()
    if len(image) + (0 if append else 8) > capacity:
        raise ValueError(f"Generated transaction exceeds pinned space: {len(image)}>{capacity}")
    replacements = []
    if not append:
        generated = trampoline(native_entries["native_"+profile["arena_entry"]]) + image
        generated += b"\xff" * (capacity - len(generated))
        replacements.append((address-0x08000000, generated, profile["id"]+".bodies", "ir-regenerated"))
    def entry_transfer(label):
        target=native_entries["native_"+label]
        if arm_backend:
            from .arm_entry import veneer
            return veneer(target)
        return trampoline(target)
    replacements += [(int(entry,16)-0x08000000, entry_transfer(label), profile["id"]+"."+label+".entry", "native-relocated")
                     for label,_,entry in profile["targets"] if append or int(entry,16) != address]
    from .ir_layout import build_layout
    rebuilt, layout, manifest = build_layout(original, baseline, output, replacements, image if append else b"")
    service_proof=None
    if profile.get("native_service_backend"):
        from .retained_services import qualify_registered
        for module in modules.values():
            for service in module["adapter"].get("retained_services",[]):
                entry=service["entry"] if isinstance(service["entry"],int) else int(service["entry"],16)
                off=entry-0x08000000
                if rebuilt[off:off+service["span_size"]]!=raw[off:off+service["span_size"]]:
                    raise ValueError("Reconstruction overwrote retained native service")
        proof_started=time.perf_counter()
        service_proof=qualify_registered(profile,original,output/"rebuilt.gba",output/"native-service-proof")
        stages.append({"name":"registered-native-service-host-effect-proof","seconds":time.perf_counter()-proof_started,
                       "outcome":"pass","proof_schema":service_proof["schema"],"proof":"native-service-proof/parity-report.json",
                       "nested_compile_and_native_stages":True})
        write_json(output/"build-stages.json",stages)
    else:
        for label, _, _ in profile["targets"]:
            fixture_path=output/label/"fixtures.json"
            fixtures=json.loads(fixture_path.read_text()) if fixture_path.exists() else None
            if arm_backend:
                from .arm_entry import qualify_installed
                proof_started=time.perf_counter()
                proof=qualify_installed(output/label,original,output/"rebuilt.gba",modules[label]["adapter"],
                                        native_entries["native_"+label],native_entries["native_body_"+label],vectors,fixtures)
                stages.append({"name":"registered-installed-arm-entry-"+label,"seconds":time.perf_counter()-proof_started,
                               "outcome":proof["outcome"],"nested_compile_and_native_stages":True})
                write_json(output/"build-stages.json",stages)
            else:
                proof = qualify(output / label, output / "rebuilt.gba", vectors, True,fixtures=fixtures)
            if not arm_backend:shutil.copy2(output / label / "receipt.json", output / label / "rebuilt-proof.json")
            if proof["outcome"] != "pass":
                raise ValueError("Reconstructed original-entry parity failed: " + label)
    changed = [i for i, (a,b) in enumerate(zip(raw, rebuilt)) if a != b]
    appended = max(0,len(rebuilt)-len(raw))
    write_json(output / "raw-diff.json", {"original_sha256": original_hash, "rebuilt_sha256": sha(rebuilt),
               "equal": raw == rebuilt, "changed_byte_count": len(changed)+abs(len(rebuilt)-len(raw)),
               "original_changed_bytes":len(changed),"appended_bytes":appended,
               "removed_bytes":max(0,len(raw)-len(rebuilt)),"changed_offsets": changed,
               "original_size": len(raw), "rebuilt_size": len(rebuilt), "masks": []})
    if sha(original.read_bytes()) != original_hash:
        raise ValueError("Original ROM changed")
    write_json(output/"prefab-graph.json", prefab_graph(profile,modules,output,seed_modules))
    source_hashes_after=source_hashes()
    if source_hashes_before!=source_hashes_after:
        raise ValueError("Compiler sources changed during run; retain artifacts but generation provenance not admitted")
    asset_spans=sorted((a["address"],a["address"]+a["bytes"]) for m in modules.values() for a in m["assets"])
    frontier_end=unique_asset_bytes=0
    for lo,hi in asset_spans:
        unique_asset_bytes+=max(0,hi-max(lo,frontier_end));frontier_end=max(frontier_end,hi)
    from .elf_assets import linked_asset_objects
    asset_objects=linked_asset_objects((output/"native.elf").read_bytes(),
        [a for label,_,_ in profile["targets"] for a in json.loads((output/label/"l1.json").read_text()).get("assets",[])])
    embedded_asset_bytes=asset_objects["emitted_unique_bytes"]
    report = {"schema": "gameverse.ir-roundtrip-provider/1", "outcome": "pass", "original_sha256": original_hash,
              "rebuilt_sha256": sha(rebuilt), "source_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
              "platform": platform.platform(), "modules": modules,"dependency_seeds":seed_modules,"dependency_frontier":frontier, "native_entries": native_entries,
              "generated_native_bytes": len(image), "native_symbol_sizes": symbol_sizes,
              "native_symbols":symbol_records,"embedded_asset_bytes":embedded_asset_bytes,
              "embedded_asset_objects":asset_objects["objects"],
              "unique_immutable_source_bytes":unique_asset_bytes,
              "emitted_source_asset_bytes_before_compiler":sum(a["bytes"] for m in modules.values() for a in m["assets"]),
              "generated_behavior_function_bytes":sum(v for k,v in symbol_sizes.items() if k.startswith("lifted_")),
              "mechanical_binding_function_bytes":sum(v for k,v in symbol_sizes.items() if k.startswith("native_")),
              "veneer_bytes":sum(m["entry_abi"]["bytes"]for m in modules.values()),
              "deterministic_fill_bytes":0 if append else capacity-8-len(image), "replacement_span_bytes": sum(len(r[1]) for r in replacements),
              "raw_changed_bytes": len(changed)+abs(len(rebuilt)-len(raw)),
              "original_changed_bytes":len(changed),"appended_bytes":appended,"exact_original_bytes": False,
              "profile":profile,"ir_origin":"retained-qualified-automatic-lift" if profile.get("retained_ir") else "fresh-machine-SSA-lift",
              "compiler_source_hashes_stable":source_hashes_before,
              "whole_game_equivalent": None, "queue_seconds": None, "cache": "clean generated compilation; retained machine SSA inputs",
              "timing": {"total_seconds": time.perf_counter()-started, "stages_nested_in_total": stages}}
    if service_proof:
        report["native_service_proof"]={"schema":service_proof["schema"],"path":"native-service-proof/parity-report.json",
            "sha256":sha((output/"native-service-proof/parity-report.json").read_bytes()),"scope":service_proof["scope"]}
        report["execution_scope"]="source_pinned_native_only"
        report["semantic_closure"]="OPEN"
        report["generated_behavior_function_byte_scope"]="Lifted control/state function symbols include mechanical service synchronization; not source behavior coverage"
        report["source_behavior_bytes_regenerated"]=None
        report["in_function_sync_bytes"]=None
        report["in_function_sync_byte_measurement"]="Unavailable: synchronization is mixed into lifted symbols and is not double-counted"
        report["native_context_limitations"]=["Entry veneer clobbers incoming r3; parameter/entity bindings using r3 rejected", "Entity context restricted to aligned disjoint EWRAM, IWRAM globals exclude qualified stack arena; allocator/lifetime/IRQ closure unproven"]
        report["preserved_native_service_bytes"]=sum(c["span_size"] for m in modules.values() for c in m["adapter"].get("retained_services",[]))
    seal_provenance(report,output)
    report["toolchain"] = {tool:subprocess.check_output([tool,"--version"],text=True).splitlines()[0]
                            for tool in ("cc","arm-none-eabi-ld","arm-none-eabi-objcopy")}
    if source_hashes_before!=source_hashes():
        raise ValueError("Compiler/provider source changed while capturing provenance")
    report["timing"]["before_provenance_seconds"]=report["timing"]["total_seconds"]
    report["timing"]["total_seconds"]=time.perf_counter()-started
    report["timing"]["measurement_boundary"]="Immediately before final receipt serialization; final receipt write excluded"
    write_json(output / "provider-report.json", report)
    return report


def run(profile,original,baseline,output,vectors=4096):
    """Retain bounded failed attempts without touching an existing packet."""
    started=time.perf_counter()
    output=Path(output)
    existed=output.exists()
    try:
        return _run(profile,original,baseline,output,vectors)
    except Exception as error:
        if not existed:
            output.mkdir(parents=True,exist_ok=True)
            write_json(output/"failure-receipt.json",{
                "schema":"gameverse.ir-roundtrip-failure/1","outcome":"failed",
                "error":str(error),"profile":profile,"original":str(original),"baseline":str(baseline),
                "limits":{"vectors":vectors},"total_seconds":time.perf_counter()-started,"queue_seconds":None,
                "completed_stages":"Retained build-stages.json and any per-module native receipts; no successful provider claim"})
        raise


def verify_producer(row, root):
    """Authenticate retained actual lowering/build/proof chain without rebuilding."""
    if row.get("role") != "generated-output":
        return False
    sys.path.insert(0, str(COMPILER))
    from lower import lower
    from .source_provider import elf_range
    root = Path(root)
    report = json.loads((root / "provider-report.json").read_text())
    if report.get("outcome") != "pass" or any(s["outcome"] != "pass" for s in report["timing"]["stages_nested_in_total"]):
        return False
    for name, digest in report["producer_pins"].items():
        path = root / name
        if not path.resolve().is_relative_to(root.resolve()) or sha(path.read_bytes()) != digest:
            return False
    for name,digest in report["compiler_pins"].items():
        if sha((root/"compiler-snapshots"/Path(name).name).read_bytes()) != digest:
            return False
    service_backend=report["profile"].get("native_service_backend")
    service_raw=None;service_evidence={}
    if service_backend:
        from .reassemble import assemble
        service_raw,_=assemble(root/"manifest.json")
        if sha(service_raw)!=report["original_sha256"]:
            return False
        for digest in service_backend["evidence"]:
            payload=(root/"retained-service-evidence"/(digest+".source")).read_bytes()
            if sha(payload)!=digest:return False
            service_evidence[digest]=payload
        from .retained_services import validate_registered_proof
        retained=json.loads((root/"native-service-proof/parity-report.json").read_text())
        validate_registered_proof(retained,service_raw,(root/"rebuilt.gba").read_bytes(),artifact_root=root/"native-service-proof")
        if report.get("native_service_proof",{}).get("sha256")!=sha((root/"native-service-proof/parity-report.json").read_bytes()):return False
    for label, _, _ in report["profile"]["targets"]:
        directory = root / label
        x = json.loads((directory/"l1.json").read_text())
        adapter = json.loads((directory/"validation-adapter.json").read_text())
        emitter=None
        if service_backend:
            from .retained_services import NativeServiceEmitter
            emitter=NativeServiceEmitter(x,adapter,service_raw,service_evidence)
        code = lower(x,native_service_emitter=emitter) if emitter else lower(x)
        if code != (directory/"generated.c").read_text():
            return False
        native = code.replace("LiftedState","State_"+label).replace("behavior_0","lifted_"+label)
        native = re.sub(r"(?m)^(void|uint(?:8|16|32|64)_t) (lifted_\w+\()",r"__attribute__((noinline)) \1 \2",native)
        if report["profile"].get("native_entry_backend"):
            from .arm_entry import binding as arm_binding
            expected_binding=arm_binding(adapter,label,storage_moves)
        else:
            expected_binding=emitter.binding(label) if emitter else binding(adapter,label)
        if native+expected_binding != (directory/"bound.c").read_text():
            return False
        for filename,rom_hash in (() if emitter else (("original-proof.json",report["original_sha256"]),("rebuilt-proof.json",report["rebuilt_sha256"]))):
            proof = json.loads((directory/filename).read_text())
            if (proof["outcome"] != "pass" or proof["rom_sha256"] != rom_hash
                    or proof["parity"]["outcome"] != "pass"
                    or proof["artifacts"]["l1.json"]["sha256"] != sha((directory/"l1.json").read_bytes())):
                return False
    image = (root/"native.bin").read_bytes()
    start = report["profile"]["arena_address"]+(0 if report["profile"].get("arena_append") else 8)
    if elf_range((root/"native.elf").read_bytes(),start,len(image)) != image:
        return False
    if row.get("sourceComponent") is None and row.get("role") == "generated-output":
        if row["artifact"]["sha256"] != sha(image):
            return False
        return {"verified":True,"behavior_bytes":report["generated_behavior_function_bytes"],
                "binding_bytes":report["mechanical_binding_function_bytes"],
                "asset_bytes":report.get("embedded_asset_bytes",0),
                "alignment_bytes":len(image)-report["generated_behavior_function_bytes"]-report["mechanical_binding_function_bytes"]-report.get("embedded_asset_bytes",0)}
    return False


def seal_provenance(report,output):
    output = Path(output)
    from .compiler_dependencies import capture_runtime_dependencies
    runtime = capture_runtime_dependencies(output/"compiler-runtime")
    write_json(output/"compiler-runtime-dependencies.json",runtime)
    snapshot = output/"compiler-snapshots"
    snapshot.mkdir(exist_ok=True)
    sources = [COMPILER/"lift.py",COMPILER/"lower.py",COMPILER/"qualify.py",COMPILER/"oracle.c.in",
               Path(__file__),Path(__file__).with_name("ir_layout.py")]
    if report["profile"].get("native_entry_backend"):sources.append(Path(__file__).with_name("arm_entry.py"))
    for p in sources:
        (snapshot/p.name).write_bytes(p.read_bytes())
    report["compiler_pins"] = {str(p.relative_to(ROOT)):sha(p.read_bytes()) for p in sources}
    report["producer_pins"] = {str(p.relative_to(output)):sha(p.read_bytes()) for p in output.rglob("*")
                               if p.is_file() and p.name != "provider-report.json" and p.suffix in (".json",".c",".o",".elf",".bin",".ld",".gba",".py",".in",".source")}


def refresh_metadata(output,profile,reason):
    """Version a receipt supplement; never rerun or claim new native execution."""
    output = Path(output)
    path = output/"provider-report.json"
    previous = path.read_bytes()
    (output/("provider-report-retained-"+sha(previous)[:12]+".json")).write_bytes(previous)
    report = json.loads(previous)
    report.update(profile=profile,ir_origin="fresh-machine-SSA-lift" if not profile.get("retained_ir") else "retained-qualified-automatic-lift")
    original_changed = report.get("original_changed_bytes", report["raw_changed_bytes"])
    raw = json.loads((output/"raw-diff.json").read_text())
    appended = max(0,raw["rebuilt_size"]-raw["original_size"])
    report.update(original_changed_bytes=original_changed,appended_bytes=appended,raw_changed_bytes=original_changed+appended)
    report["metadata_revision"] = {"reason":reason,"prior_report_sha256":sha(previous),"native_rerun":False,
                                   "snapshot_scope":"Current reproducible verification recipe; initial provider script identity unavailable. Retained compiler lowerer and C outputs verified exactly."}
    layoutpath = output/"layout.json"
    layout = json.loads(layoutpath.read_text())
    for row in layout["components"]:
        if row.get("role") == "generated-output":
            row["evidence"] = [{"path":"native.elf","sha256":sha((output/"native.elf").read_bytes())},
                               {"path":"native.bin","sha256":sha((output/"native.bin").read_bytes())}]
    write_json(layoutpath,layout)
    write_json(output/"prefab-graph.json",prefab_graph(profile,report["modules"],output))
    seal_provenance(report,output)
    write_json(path,report)
    return report


def prefab_graph(profile,modules,output,seeds=None):
    """Describe actual recovered state/call topology without claiming host closure."""
    nodes, edges = [], []
    retained_nodes={}
    entries = {int(entry,16):label for label,_,entry in profile["targets"]}
    entries.update({int(seed["entry"],16):seed["label"] for seed in profile.get("dependency_seeds",[])})
    for label, package, entry in profile["targets"]:
        adapter = modules[label]["adapter"]
        services={int(c["entry"],16) if isinstance(c["entry"],str) else c["entry"]:c for c in adapter.get("retained_services",[])}
        for service in services.values():
            retained_nodes[service["id"]]={"id":service["id"],"installed":False,"implementation":"preserved_native_opaque",
                "execution_scope":"source_pinned_native_only","closure":"open","original_entry":service["entry"],
                "original_rom_sha256":service["rom_sha256"],"source_span_sha256":service["span_sha256"],"source_span_bytes":service["span_size"],
                "effects":service["effects"],"source_evidence":service["source_evidence"]}
        l0 = json.loads((Path(output)/label/"l0.json").read_text())
        varnodes = {v["id"]:v for v in l0["varnodes"]}
        calls = []
        for block in l0["blocks"]:
            for op in block["ops"]:
                if op["opcode"] == "CALL":
                    target = int(varnodes[op["inputs"][0]]["offset"])
                    component=services[target]["id"] if target in services else entries.get(target)
                    calls.append({"pc":op["pc"],"target":hex(target),"component":component,
                                  "status":"retained-native-service" if target in services else "inlined-source-dependency" if target in entries else "unresolved"})
                    edges.append({"from":label,"to":component or "opaque-host","kind":"retained-native-service" if target in services else "source-call",
                                  "native_pc":op["pc"],"target":hex(target),"closure":"bounded" if target in entries else "open"})
        nodes.append({"id":label,"package":package,"original_entry":entry,
                      ("native_bound_ir" if services else "portable_ir"):{"path":label+"/l1.json","sha256":modules[label]["l1_sha256"]},
                      "parameters":adapter["parameters"],"return_type":adapter["return_type"],
                      "state_fields":adapter["fields"],"state_collections":adapter.get("collections",[]),
                      "assets":adapter.get("assets",[]),"source_calls":calls,"installed":True})
        edges.append({"from":"opaque-host","to":label,"kind":"original-entry-dispatch","closure":"open",
                      "reason":"Whole-game caller schedule, save ownership and interrupt/intermediate-write observations unproven"})
    nodes.extend(retained_nodes.values())
    for label,seed in (seeds or {}).items():
        nodes.append({"id":label,"package":seed["package"],"original_entry":hex(seed["entry"]),"installed":False,
                      "inlined_dependency":True,"portable_ir":{"path":"dependencies/"+label+"/l1.json","sha256":seed["l1_sha256"]},
                      "state_fields":seed["adapter"]["fields"],"state_collections":seed["adapter"].get("collections",[]),
                      "assets":seed["adapter"].get("assets",[])})
    return {"schema":"gameverse.ir-prefab-graph/1","id":profile["id"],"components":nodes,"dependencies":edges,
            "source_context":profile.get("source_context",{}),"state_lifecycle":profile.get("state_lifecycle",{}),
            "storage_authority":"Original canonical RAM remains authoritative; generated binding snapshots and commits at synchronous invocation boundaries",
            "lifecycle":{"clock":"original host calls","init":"original host initialization preserved","save":"original host save code retained; lifecycle proof open",
                         "concurrency":"No concurrent writer assumed for bounded call proof; interrupt-visible write order unproven"},
            "closure":"open","unknowns":["Whole-game callers and indirect interior entrypoints","Interrupt-visible intermediate memory writes",
                                            "Original scene/scheduler/save lifecycle","Whole-game campaign equivalence"]}

