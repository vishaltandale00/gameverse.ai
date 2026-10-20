"""Attribute embedded immutable data by ELF object identity, not section letters."""
import struct
from .reassemble import sha
from .source_provider import elf_range


def linked_asset_objects(elf,assets):
    """Return exact known L1 arrays emitted as STT_OBJECT symbols in an ARM ELF.

    Linker scripts may place readonly data inside .text, where nm prints `t`.
    Object type, identity, extent and emitted contents must all agree instead.
    """
    if elf[:6]!=b"\x7fELF\x01\x01":
        raise ValueError("Expected 32-bit little-endian ELF")
    header=struct.unpack_from("<16sHHIIIIIHHHHHH",elf)
    if header[2]!=40:
        raise ValueError("Expected ARM ELF")
    shoff,shsize,count=header[6],header[11],header[12]
    if shsize<40 or shoff+shsize*count>len(elf):
        raise ValueError("Invalid ELF section table")
    sections=[struct.unpack_from("<IIIIIIIIII",elf,shoff+i*shsize) for i in range(count)]
    expected={}
    for asset in assets:
        expected.setdefault(asset["name"],[]).append(bytes(asset["data"]))
    objects=[]
    for section in sections:
        if section[1]!=2:
            continue
        offset,size,link,entsize=section[4],section[5],section[6],section[9]
        if link>=count or entsize<16 or offset+size>len(elf) or size%entsize:
            raise ValueError("Invalid ELF symbol table")
        strings=sections[link]
        names=elf[strings[4]:strings[4]+strings[5]]
        for position in range(offset,offset+size,entsize):
            name,address,length,info,other,index=struct.unpack_from("<IIIBBH",elf,position)
            if name>=len(names):
                raise ValueError("Invalid ELF symbol name")
            symbol=names[name:].split(b"\0",1)[0].decode("ascii")
            if symbol not in expected or info&15!=1 or not length:
                continue
            if not 0<index<count:
                raise ValueError("Immutable object must have a file-backed section")
            owner=sections[index]
            if owner[1]==8 or not owner[3]<=address<=owner[3]+owner[5]-length:
                raise ValueError("Immutable object exceeds its section")
            payload=elf_range(elf,address,length)
            if payload not in expected[symbol]:
                raise ValueError("Emitted immutable object differs from known L1 asset")
            objects.append({"name":symbol,"address":address,"bytes":length,"sha256":sha(payload),
                            "elf_symbol_type":"STT_OBJECT","section_index":index,
                            "origin":"ROM-captured immutable bytes embedded by L1 lowering"})
    end=total=0
    for row in sorted(objects,key=lambda r:r["address"]):
        total+=max(0,row["address"]+row["bytes"]-max(end,row["address"]))
        end=max(end,row["address"]+row["bytes"])
    return {"objects":objects,"emitted_unique_bytes":total}
