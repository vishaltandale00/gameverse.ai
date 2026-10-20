"""Read-only observation guards; no emulator/model/network calls."""
import json
from pathlib import Path
import struct
import unittest
from types import SimpleNamespace

from .observations import SourceObserver

PROFILE=Path('research/ir-workshop/whole-game-mashup-20261016/source-observation/profile.json')


@unittest.skipUnless(PROFILE.exists(),'requires recorded source layout profile')
class ObservationGuards(unittest.TestCase):
    def fixture(self, printer_state=2, player_active=True, callback_name='CB2_MainMenu'):
        profile=json.loads(PROFILE.read_text());observer=SourceObserver.__new__(SourceObserver)
        observer.profile=profile;observer.regions=profile['regions'];observer.sha256='fixture-layout'
        observer.functions={'emerald':{'0x08000100':[callback_name]}}
        addresses={key:int(value,0) for key,value in profile['regions']['emerald']['symbols'].items()}
        memory={}
        def write(address,raw):memory.update({address+i:byte for i,byte in enumerate(raw)})
        write(addresses['gMain']+4,struct.pack('<I',0x08000101))
        write(addresses['sTextPrinters']+27,bytes([1,printer_state]))
        if player_active:
            write(addresses['gObjectEvents'],b'\x01\0\x01')
            write(addresses['gObjectEvents']+16,struct.pack('<hhhh',10,11,9,11))
        engine=SimpleNamespace(read_memory=lambda address,length:bytes(memory.get(address+i,0) for i in range(length)))
        return observer,SimpleNamespace(active='emerald',engine=engine)

    def test_title_does_not_present_stale_avatar_as_loaded_field(self):
        observer,session=self.fixture(player_active=True)
        result=observer.enrich(session,{'facts':{},'progress':{}})
        self.assertIsNone(result['facts']['live_player'])
        self.assertEqual(result['facts']['native_party_count'],0)
        self.assertEqual(result['facts']['source_callback2'],0x08000101)

    def test_restored_cached_wait_flag_is_recomputed_from_current_input_boundary(self):
        observer,session=self.fixture(printer_state=2)
        result=observer.enrich(session,{'facts':{'noninteractive_wait_safe':True},'progress':{}})
        self.assertTrue(result['facts']['source_text_awaiting_input'])
        self.assertFalse(result['facts']['noninteractive_wait_safe'])

    def test_field_coordinates_require_active_player_object_and_field_callback(self):
        observer,session=self.fixture(callback_name='CB2_Overworld')
        result=observer.enrich(session,{'facts':{},'progress':{}})
        self.assertEqual(result['facts']['live_player']['x'],10)
        self.assertEqual(result['facts']['live_player']['y'],11)
        observer,session=self.fixture(callback_name='CB2_Overworld',player_active=False)
        self.assertIsNone(observer.enrich(session,{'facts':{},'progress':{}})['facts']['live_player'])


if __name__=='__main__':unittest.main()
