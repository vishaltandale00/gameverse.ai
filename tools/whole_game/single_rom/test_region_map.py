import hashlib
import json
from pathlib import Path
import tempfile
import subprocess
import unittest
from .region_map import stage_region_map, section_tables
ROOT=Path(__file__).resolve().parents[3]
BASE=ROOT/'local/decomps/pokeemerald'
DONOR=ROOT/'local/decomps/pokefirered'

class RegionMapTests(unittest.TestCase):
    def test_complete_donor_provider_and_native_dispatch(self):
        with tempfile.TemporaryDirectory(prefix='fr-region-map-') as directory:
            out=Path(directory)
            for rel in ('src/region_map.c','src/field_region_map.c'):
                target=out/rel;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes((BASE/rel).read_bytes())
            report=stage_region_map(BASE,DONOR,out)
            self.assertFalse(report['buildEligible'])
            self.assertGreater(report['coverage']['sourceFunctions']['src/region_map.c'],100)
            self.assertEqual(report['coverage']['assets'],sum(p.is_file() for folder in ('graphics/region_map','graphics/map_preview') for p in (DONOR/folder).rglob('*')))
            source=(out/'src/firered_region_map.c').read_text()
            for name in ('FR_Task_FlyMap','FR_Task_RegionMap','FR_Task_DungeonMapPreview','FR_FreeFlyMap','FR_SetFlyWarpDestination'):
                self.assertIn(name,source)
            self.assertIn('SetWarpDestinationToHealLocation(FR_sMapFlyDestinations[idx][2])',source)
            self.assertIn('FR_SetUsedFlyQuestLogEvent(FR_sMapFlyDestinations[idx])',source)
            self.assertIn('FR_HEAL_LOCATION_ONE_ISLAND',source)
            self.assertIn('FR_GetDungeonMapPreviewScreenInfo',source)
            self.assertIn('#define FR_MAP_PAIR(map) MAP_GROUP(map), MAP_NUM(map)',source)
            self.assertIn('JOY_REPEAT(',source)
            self.assertIn('FR_sMapsecName_POK__MON_MANSION',(out/'src/data/firered/region_map/region_map_entry_strings.h').read_text())
            self.assertIn('DPAD_ANY        = F8 0C',(out/'charmap.txt').read_text())
            self.assertIn('graphics/firered/region_map/sevii_67.bin.lz',source)
            for rel in ('src/region_map.c','src/field_region_map.c'):
                self.assertIn('if (WholeGame_IsKanto())',(out/rel).read_text())
            preview=(out/'src/firered_map_preview_screen.c').read_text()
            self.assertIn('FR_gQuestLogState == FR_QL_STATE_PLAYBACK',preview)
            self.assertIn('FR_ForestMapPreviewScreenIsRunning',preview)
            quest_constants=(out/'include/constants/firered_quest_log.h').read_text()
            self.assertIn('#define FR_IS_LINK_QL_EVENT',quest_constants)
            self.assertIn('#define FR_IS_VALID_QL_EVENT',quest_constants)
            self.assertNotIn('gQuestLogState ==',quest_constants.replace('FR_gQuestLogState ==',''))
            self.assertIn('DestroyTask(taskId)',preview)
            self.assertIn('FR_QuestLog_CutRecording()', (out/'src/firered_town_map.c').read_text())
            # Compile exact original/staged layout arrays together and compare
            # every cell, independently of screen callbacks or text rendering.
            _,constants,_,_=section_tables(DONOR)
            original_constants=constants.replace('FR_','')
            preamble='#include <stdint.h>\n#include <assert.h>\ntypedef uint8_t u8;\n'
            for prefix in ('','FR_'):
                for name,value in (('LAYER_COUNT',2),('LAYER_MAP',0),('LAYER_DUNGEON',1),('MAP_HEIGHT',15),('MAP_WIDTH',22)):
                    preamble+=f'#define {prefix}{name} {value}\n'
            probe=preamble+constants+original_constants
            for suffix in ('kanto','sevii_123','sevii_45','sevii_67'):
                name='region_map_layout_'+suffix+'.h'
                probe+=(DONOR/'src/data/region_map'/name).read_text()+'\n'
                probe+=(out/'src/data/firered/region_map'/name).read_text()+'\n'
            probe+='int main(void){ unsigned l,y,x;\n'
            for name in ('Kanto','Sevii123','Sevii45','Sevii67'):
                probe+=f'for(l=0;l<2;l++)for(y=0;y<15;y++)for(x=0;x<22;x++)assert(sRegionMapSections_{name}[l][y][x]==FR_sRegionMapSections_{name}[l][y][x]);\n'
            probe+='return 0;}\n'
            cfile=out/'map-data-probe.c';cfile.write_text(probe)
            subprocess.run(['cc','-std=c99','-Wall','-Werror',str(cfile),'-o',str(cfile.with_suffix(''))],check=True,capture_output=True)
            subprocess.run([str(cfile.with_suffix(''))],check=True,capture_output=True)
            for asset in report['assets']:
                self.assertEqual(asset['sourceSha256'],hashlib.sha256((out/asset['path']).read_bytes()).hexdigest())

    def test_section_tables_preserve_native_raw_ids_and_coordinates(self):
        sections,constants,strings,entries=section_tables(DONOR)
        pallet=next(i for i,s in enumerate(sections) if s['id']=='MAPSEC_PALLET_TOWN')
        self.assertIn(f'FR_MAPSEC_PALLET_TOWN = {pallet}',constants)
        self.assertIn('FR_sMapsecName_PALLET_TOWN',strings)
        self.assertIn('[FR_MAPSEC_PALLET_TOWN - FR_KANTO_MAPSEC_START]',entries)
        self.assertIn('FR_sMapSectionDimensions',entries)

    def test_reject_canonical_output(self):
        with self.assertRaises(ValueError):stage_region_map(BASE,DONOR,BASE)

if __name__=='__main__':unittest.main()
