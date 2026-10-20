"""Small source-stage + native C semantic checks; no dependency setup/ROM build."""
import json
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from .map_semantics import stage_map_semantics

ROOT = Path(__file__).resolve().parents[3]
EMERALD = ROOT / 'local/decomps/pokeemerald'
FIRERED = ROOT / 'local/decomps/pokefirered'
FILES = ['src/metatile_behavior.c','src/wild_encounter.c','src/battle_setup.c',
         'src/field_player_avatar.c','src/fldeff_cut.c']


class MapSemanticsTests(unittest.TestCase):
    def test_staged_consumers_and_compiled_predicate_dispatch(self):
        before = {str(root / rel):(root / rel).read_bytes() for root in (EMERALD,FIRERED) for rel in FILES}
        with tempfile.TemporaryDirectory(prefix='whole-game-map-semantics-') as tmp:
            out = Path(tmp)
            for rel in FILES:
                dest=out/rel; dest.parent.mkdir(parents=True,exist_ok=True)
                shutil.copyfile(EMERALD/rel,dest)
            report=stage_map_semantics(EMERALD,FIRERED,out)
            self.assertFalse(report['semantic_coverage_complete'])
            self.assertGreater(len(report['predicate_dispatch']),90)
            text=(out/'src/metatile_behavior.c').read_text()
            # Compile the actual generated C (only replace platform headers/types).
            text=re.sub(r'^#include[^\n]*\n','',text,flags=re.M)
            constants=(EMERALD/'include/constants/metatile_behaviors.h').read_text()
            declarations=(EMERALD/'include/metatile_behavior.h').read_text()
            declarations=re.sub(r'^#include[^\n]*\n','',declarations,flags=re.M)
            fixture='''#include <stdint.h>
#include <stddef.h>
#include <assert.h>
typedef uint8_t u8; typedef uint16_t u16; typedef uint32_t u32;
typedef int16_t s16; typedef u8 bool8; typedef u32 bool32;
#define TRUE 1
#define FALSE 0
#define DIR_NORTH 2
#define CONNECTION_NORTH 2
#define UNUSED __attribute__((unused))
struct Tileset { const u32 *fireRedMetatileAttributes; };
struct MapLayout { const struct Tileset *primaryTileset; };
struct MapHeader { const struct MapLayout *mapLayout; };
struct MapHeader gMapHeader;
static u32 raw;
u32 WholeGameFireRedAttribute(const struct MapLayout *l, u16 id, u8 field) {
 (void)l; (void)id; return field == 1 ? (raw >> 9) & 31 : (raw >> 24) & 7;
}
u16 MapGridGetMetatileIdAt(s16 x, s16 y) { (void)x; (void)y; return 0; }
bool8 WholeGameIsFireRedMap(void);
u16 WholeGameFireRedBehavior(u16 behavior);
'''
            fixture+=constants+'\n'+declarations+'\n'+text
            tests='''
int main(void) {
 struct Tileset native={NULL}, donor={&raw};
 struct MapLayout layout={&donor}; unsigned i;
 gMapHeader.mapLayout=&layout;
 assert(WholeGameFireRedBehavior(0x1ff)==0x1ff);
 for(i=0;i<32;i++) {
  raw=i<<9;
  assert(WholeGameFireRedTerrainAt(0,0)==(i==0 ? 0 : i<=4 ? 1u<<(i-1) : 0));
 }
 for(i=0;i<8;i++) {raw=i<<24;assert(WholeGameFireRedEncounterAt(0,0)==i);}
 assert(MetatileBehavior_IsJumpEast(WGFR_MB_JUMP_EAST));
 assert(MetatileBehavior_IsWarpDoor(WGFR_MB_WARP_DOOR));
'''
            # Every admitted wrapper equals original donor predicate for every byte.
            # Two-argument predicates also exercise all facing directions.
            donor_decl=(out/'include/whole_game_fr_semantics.h').read_text()
            for host,donor_name in report['predicate_dispatch'].items():
                match=re.search(r'WGFR_'+donor_name+r'\(([^)]*)\)',donor_decl)
                if ',' in match[1]:
                    tests+=f' for(i=0;i<256;i++) {{ unsigned j; for(j=0;j<5;j++) assert({host}(i,j)==WGFR_{donor_name}(i,j)); }}\n'
                else:
                    tests+=f' for(i=0;i<256;i++) assert({host}(i)==WGFR_{donor_name}(i));\n'
            tests+='''
 layout.primaryTileset=&native;
 assert(!WholeGameIsFireRedMap());
 assert(MetatileBehavior_IsTallGrass(MB_TALL_GRASS));
 assert(MetatileBehavior_IsLongGrass(MB_LONG_GRASS));
 return 0;
}
'''
            fixture+=tests
            probe=out/'probe.c'; probe.write_text(fixture)
            compile_result=subprocess.run(['cc','-std=c99','-Wall','-Werror',str(probe),'-o',str(out/'probe')],capture_output=True,text=True)
            self.assertEqual(compile_result.returncode,0,compile_result.stderr)
            subprocess.run([str(out/'probe')],check=True,capture_output=True)
            self.assertIn('WholeGameFireRedBattleEnvironment', (out/'src/battle_setup.c').read_text())
            cut=(out/'src/fldeff_cut.c').read_text()
            self.assertIn('wgfrCutMapping',cut)
            self.assertNotIn('METATILE_ID(',cut)
            # Compile the emitted replacement table and executor against a map
            # grid stub, checking every donor Cut pair and unknown metatile.
            a=cut.index('static const u16 wgfrCutMapping')
            b=cut.index('\nstatic void SetCutGrassMetatile(s16 x, s16 y)',a)
            cut_probe=out/'cut-probe.c'
            cut_probe.write_text("""#include <stdint.h>
#include <assert.h>
typedef uint16_t u16; typedef int16_t s16;
static u16 tile;
u16 MapGridGetMetatileIdAt(s16 x,s16 y) {(void)x;(void)y;return tile;}
void MapGridSetMetatileIdAt(s16 x,s16 y,u16 value) {(void)x;(void)y;tile=value;}
"""+cut[a:b]+"""
int main(void) {
 u16 i;
 for(i=0;wgfrCutMapping[i][0]!=0xffff;i++) {
  tile=wgfrCutMapping[i][0];WholeGameFireRedCutAt(7,7);
  assert(tile==wgfrCutMapping[i][1]);
 }
 assert(i==9);
 tile=0xffff;WholeGameFireRedCutAt(7,7);assert(tile==0xffff);
 return 0;
}
""")
            cut_result=subprocess.run(['cc','-std=c99','-Wall','-Werror',str(cut_probe),'-o',str(out/'cut-probe')],capture_output=True,text=True)
            self.assertEqual(cut_result.returncode,0,cut_result.stderr)
            subprocess.run([str(out/'cut-probe')],check=True,capture_output=True)

        for path,data in before.items():
            self.assertEqual(Path(path).read_bytes(),data)


if __name__ == '__main__':
    unittest.main()
