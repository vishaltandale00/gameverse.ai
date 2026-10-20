"""Small fail-closed regressions for provider inputs; no compiler/emulator runs."""
import copy
import unittest
from .ir_provider import binding,validate_embedded_assets,trampoline,validate_entry_binding


class ProviderInputs(unittest.TestCase):
    def test_fourth_argument_is_destroyed_before_wrapper_and_rejected(self):
        # Exact entry transfer, not a mock game behavior: LDR r3 takes the
        # literal destination before BX. A leaf returning arg4 loses its value.
        import struct
        incoming_fourth=0x12345678
        first,second,loaded_r3=struct.unpack("<HHI",trampoline(0x08010000))
        self.assertEqual((first,second),(0x4b00,0x4718))
        self.assertNotEqual(incoming_fourth,loaded_r3)
        adapter={"fields":[],"parameters":[{"name":"arg"+str(i),"register":"r"+str(i),"type":"u32"}for i in range(4)],"return_type":"u32"}
        with self.assertRaisesRegex(ValueError,"fourth argument"):
            binding(adapter,"returns_fourth")
        adapter["parameters"].pop()
        self.assertIn("lifted_three(&s,r0,r1,r2)",binding(adapter,"three"))

    def test_r3_entity_field_and_collection_entry_rejected(self):
        base={"fields":[],"parameters":[],"return_type":"void"}
        field=dict(name="value",owner="entity",argument="r3",address=None,offset=0,width=32)
        collection=dict(name="values",owner="entity",argument="r3",address=None,offset=0,size=1,count=4)
        for name,value in (("fields",field),("collections",collection)):
            adapter=copy.deepcopy(base);adapter[name]=[value]
            with self.assertRaisesRegex(ValueError,"r3 entity base"):
                binding(adapter,"entity_fourth")

    def test_custom_and_stack_entry_contexts_fail_closed(self):
        base={"fields":[],"parameters":[],"return_type":"void"}
        for key,value in (("native_abi",{"mode":"thumb"}),("native_sequence",[{}]),("continuation_tokens",[{}])):
            adapter=dict(base,**{key:value})
            with self.assertRaisesRegex(ValueError,"AAPCS input context"):
                validate_entry_binding(adapter)
        adapter=dict(base,parameters=[{"register":"r4"}])
        with self.assertRaisesRegex(ValueError,"stack or non-AAPCS"):
            validate_entry_binding(adapter)

    def test_readonly_asset_exact_rom_pin(self):
        x={"assets":[{"name":"asset_0","data":[7,9]}]}
        adapter={"assets":[{"name":"asset_0","address":0x08000001,"bytes":2}]}
        result=validate_embedded_assets(x,adapter,b"\x00\x07\x09")
        self.assertEqual(result[0]["mode"],"embedded-readonly-no-writeback")
        with self.assertRaises(ValueError):
            validate_embedded_assets(x,adapter,b"\x00\x07\x08")
        wrong=copy.deepcopy(adapter);wrong["assets"][0]["bytes"]=1
        with self.assertRaises(ValueError):
            validate_embedded_assets(x,wrong,b"\x00\x07\x09")

    def test_state_alias_rejected_before_snapshot(self):
        adapter={"fields":[{"name":"a","width":16,"owner":"global","address":0,"offset":0x0300075c},
                           {"name":"b","width":8,"owner":"global","address":0,"offset":0x0300075d}],
                 "parameters":[],"return_type":"void"}
        with self.assertRaisesRegex(ValueError,"aliases"):
            binding(adapter,"alias")

    def test_rom_cannot_be_state_writeback(self):
        adapter={"fields":[{"name":"a","width":8,"owner":"global","address":0,"offset":0x08000100}],
                 "parameters":[],"return_type":"void"}
        with self.assertRaisesRegex(ValueError,"canonical RAM"):
            binding(adapter,"rom")

    def test_embedded_asset_never_generates_ram_store(self):
        adapter={"fields":[],"collections":[],"assets":[{"name":"asset_0","address":0x08000000,"bytes":2}],
                 "parameters":[],"return_type":"u8"}
        code=binding(adapter,"readonly")
        self.assertNotIn("volatile",code)
        self.assertNotIn("08000000",code)

    def test_entity_collections_use_original_canonical_base(self):
        adapter={"fields":[{"name":"before","width":8,"owner":"entity","argument":"r0","address":None,"offset":303}],
                 "collections":[{"name":"ring","owner":"entity","argument":"r0","address":None,"offset":304,"size":1,"count":64},
                                {"name":"bitmap","owner":"entity","argument":"r0","address":None,"offset":368,"size":4,"count":2}],
                 "parameters":[],"return_type":"void"}
        code=binding(adapter,"entity")
        self.assertIn("((volatile uint8_t*)(r0+304u))[i]",code)
        self.assertIn("((volatile uint32_t*)(r0+368u))[i]",code)
        self.assertIn("s.ring[i]=",code)
        self.assertIn("[i]=s.bitmap[i]",code)
        for changes in ({"stride":2},{"offset":369},{"owner":"reference"},{"argument":"r4"},{"count":0}):
            bad=copy.deepcopy(adapter);bad["collections"][1].update(changes)
            with self.assertRaises(ValueError):binding(bad,"invalid")
        bad=copy.deepcopy(adapter);bad["fields"][0]["offset"]=304
        with self.assertRaisesRegex(ValueError,"aliases"):binding(bad,"overlap")
        bad=copy.deepcopy(adapter);bad["collections"][1]["argument"]="r1"
        with self.assertRaisesRegex(ValueError,"one canonical"):binding(bad,"multiple")


if __name__=="__main__":
    unittest.main()
