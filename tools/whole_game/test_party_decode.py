"""Offline differential against extracted original source C, not model evidence."""
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import unittest

from .party_decode import decode

SOURCE = Path('local/decomps/pokeemerald/src/pokemon.c')


@unittest.skipUnless(SOURCE.exists() and shutil.which('cc'), 'requires local pinned source and existing C compiler')
class SourcePartyDifferential(unittest.TestCase):
    def test_all_native_source_substruct_permutations_and_bad_checksum(self):
        source = SOURCE.read_text()
        start = source.index('static void DecryptBoxMon(struct BoxPokemon *boxMon)\n{')
        end = source.index('\n/* GameFreak called GetMonData',start)
        original = source[start:end]
        preamble = '''#include <stdint.h>
#include <stdio.h>
typedef uint32_t u32;typedef uint16_t u16;typedef uint8_t u8;typedef int32_t s32;
#define ARRAY_COUNT(a) (sizeof(a)/sizeof((a)[0]))
union PokemonSubstruct {u16 raw[6];};
struct BoxPokemon {u32 personality;u32 otId;uint8_t middle[24];union {u32 raw[12];union PokemonSubstruct substructs[4];} secure;};
'''
        main = '''int main(void){struct BoxPokemon mon;while(fread(&mon,1,80,stdin)==80){DecryptBoxMon(&mon);for(int type=0;type<4;++type){union PokemonSubstruct*p=GetSubstruct(&mon,mon.personality,type);fwrite(p,1,12,stdout);}}return 0;}'''
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);(folder/'oracle.c').write_text(preamble+original+main)
            compilation=subprocess.run(['cc','-O2',str(folder/'oracle.c'),'-o',str(folder/'oracle')],capture_output=True)
            self.assertEqual(compilation.returncode,0,compilation.stderr.decode())
            inputs=[]
            for personality in range(24):
                raw=bytearray(100);struct.pack_into('<II',raw,0,personality,0x81234567)
                plaintext=bytes((i*7+personality)%256 for i in range(48))
                struct.pack_into('<H',raw,28,sum(struct.unpack('<24H',plaintext))&0xffff)
                words=[w^personality^0x81234567 for w in struct.unpack('<12I',plaintext)]
                struct.pack_into('<12I',raw,32,*words);raw[84]=5;struct.pack_into('<HH',raw,86,17,20)
                inputs.append(bytes(raw))
            actual=subprocess.run([str(folder/'oracle')],input=b''.join(raw[:80] for raw in inputs),capture_output=True,check=True).stdout
            self.assertEqual(len(actual),24*48)
            for index,raw in enumerate(inputs):
                logical=actual[index*48:(index+1)*48];decoded=decode(raw)
                self.assertTrue(decoded['valid']);self.assertEqual(decoded['species'],struct.unpack_from('<H',logical)[0])
                self.assertEqual(decoded['experience'],struct.unpack_from('<I',logical,4)[0])
                self.assertEqual(decoded['moves'],list(struct.unpack_from('<4H',logical,12)))
                self.assertEqual(decoded['hp'],17)
            broken=bytearray(inputs[0]);broken[32]^=1
            self.assertEqual(decode(bytes(broken))['error'],'native_party_checksum_mismatch')


if __name__=='__main__':unittest.main()
