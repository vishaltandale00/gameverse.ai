"""Mechanical helper API for qualified IR v2 replay admission.

This public module exports unchanged storage/entry binding and integrity helpers
from the reviewed provider baseline. It does not expose a producer CLI, run API,
source lifting, or native qualification. The published executable frontend is
``python -m tools.roundtrip.ir_bundle`` (admit/rebuild); admit consumes an already
qualified private producer packet and an exported private component bundle.
The full producer frontend remains a separate unpublished prerequisite.
"""
import struct
from .reassemble import sha


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
