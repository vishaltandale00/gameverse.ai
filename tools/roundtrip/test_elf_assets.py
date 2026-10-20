"""Readonly arrays in executable output sections are data, not padding."""
import struct
import unittest
from .elf_assets import linked_asset_objects


def image(symbol_type=1):
    data=bytearray(416)
    ident=b"\x7fELF\x01\x01\x01"+b"\0"*9
    struct.pack_into("<16sHHIIIIIHHHHHH",data,0,ident,2,40,1,0x08800000,52,256,0,52,32,1,40,4,0)
    struct.pack_into("<IIIIIIII",data,52,1,128,0x08800000,0x08800000,2,2,5,4)
    data[128:130]=b"\x07\x09"
    data[160:169]=b"\0asset_0\0"
    struct.pack_into("<IIIBBH",data,192,1,0x08800000,2,symbol_type,0,1)
    sections=[(0,0,0,0,0,0,0,0,0,0),(0,1,6,0x08800000,128,2,0,0,1,0),
              (0,2,0,0,176,32,3,1,4,16),(0,3,0,0,160,9,0,0,1,0)]
    for i,section in enumerate(sections):
        struct.pack_into("<IIIIIIIIII",data,256+40*i,*section)
    return bytes(data)


class ElfAssetTests(unittest.TestCase):
    def test_object_in_text_counts_as_asset(self):
        result=linked_asset_objects(image(),[{"name":"asset_0","data":[7,9]}])
        self.assertEqual(result["emitted_unique_bytes"],2)
        self.assertEqual(result["objects"][0]["elf_symbol_type"],"STT_OBJECT")

    def test_mismatched_emitted_bytes_reject(self):
        with self.assertRaisesRegex(ValueError,"differs"):
            linked_asset_objects(image(),[{"name":"asset_0","data":[7,8]}])

    def test_function_name_is_not_immutable_object(self):
        self.assertEqual(linked_asset_objects(image(2),[{"name":"asset_0","data":[7,9]}])["emitted_unique_bytes"],0)


if __name__=="__main__":
    unittest.main()
