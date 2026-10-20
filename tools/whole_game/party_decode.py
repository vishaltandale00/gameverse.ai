"""Read-only Gen3 party decoding, source-matched to Emerald Pokemon APIs.

Only enabled by a source observation profile that explicitly declares this
verified layout. Bad checksums remain errors rather than invented species.
"""
import hashlib
import struct

# Exact GetSubstruct SUBSTRUCT_CASE positions by personality % 24; each tuple
# maps logical growth/attacks/effort/misc to its physical 12-byte secure block.
ORDERS = ((0,1,2,3),(0,1,3,2),(0,2,1,3),(0,3,1,2),(0,2,3,1),(0,3,2,1),
          (1,0,2,3),(1,0,3,2),(2,0,1,3),(3,0,1,2),(2,0,3,1),(3,0,2,1),
          (1,2,0,3),(1,3,0,2),(2,1,0,3),(3,1,0,2),(2,3,0,1),(3,2,0,1),
          (1,2,3,0),(1,3,2,0),(2,1,3,0),(3,1,2,0),(2,3,1,0),(3,2,1,0))
SCHEMA = 'emerald-gen3-party-source/1'


def decode(raw):
    if not isinstance(raw,bytes) or len(raw)!=100:
        raise ValueError('invalid_native_party_slot')
    personality, trainer = struct.unpack_from('<II',raw)
    words = [word ^ personality ^ trainer for word in struct.unpack_from('<12I',raw,32)]
    secure = struct.pack('<12I',*words)
    checksum = sum(struct.unpack('<24H',secure)) & 0xffff
    if checksum != struct.unpack_from('<H',raw,28)[0]:
        return {'valid':False,'error':'native_party_checksum_mismatch','raw_sha256':hashlib.sha256(raw).hexdigest()}
    order = ORDERS[personality % 24]
    growth = order[0]*12
    attacks = order[1]*12
    return {'valid':True,'schema':SCHEMA,'personality':personality,'trainer_id':trainer,
            'species':struct.unpack_from('<H',secure,growth)[0],
            'held_item':struct.unpack_from('<H',secure,growth+2)[0],
            'experience':struct.unpack_from('<I',secure,growth+4)[0],
            'moves':list(struct.unpack_from('<4H',secure,attacks)),
            'status':struct.unpack_from('<I',raw,80)[0], 'level':raw[84],
            'hp':struct.unpack_from('<H',raw,86)[0],'max_hp':struct.unpack_from('<H',raw,88)[0],
            'checksum':checksum,'raw_sha256':hashlib.sha256(raw).hexdigest()}
