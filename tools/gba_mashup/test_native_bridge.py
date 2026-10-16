"""Small host qualification for the new native C bridge, no emulator/models."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class NativeBridgeTest(unittest.TestCase):
    def test_native_boundaries_and_source_damage(self):
        if not (ROOT / "tools/gba_mashup/native/generated/provenance.json").exists():
            self.skipTest("Run pinned source extraction before native bridge qualification")
        driver = r'''
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "emerald_bridge.c"
int main(void) {
    GvBattle state, copy;
    unsigned int seed, steps, wins=0, losses=0;
    unsigned char slot, action;
    memset(&state,0,sizeof(state));
    GvBattleBegin(&state,42,0);
    /* Actual Emerald CalculateBaseDamage + TypeCalc expected values.
     * Lv20 Charmander EMBER vs Bulbasaur, neutral IV15/noEV/noitems.
     * Integer truncation matters: clear26, rain14, sun36. */
    assert(GvDamage(&state,&state.player[1],&state.enemy[0],MOVE_EMBER,0)==26);
    state.weather=B_WEATHER_RAIN_TEMPORARY;
    assert(GvDamage(&state,&state.player[1],&state.enemy[0],MOVE_EMBER,0)==14);
    state.weather=B_WEATHER_SUN_TEMPORARY;
    assert(GvDamage(&state,&state.player[1],&state.enemy[0],MOVE_EMBER,0)==36);
    GvBattleBegin(&state,42,0);
    copy=state;
    assert(!GvBattleTurn(&state,7));
    assert(!memcmp(&state,&copy,sizeof(state)));
    assert(!GvBattleTurn(&state,4)); /* already active */
    state.player[0].hp=0;
    assert(!GvBattleTurn(&state,0));
    assert(GvBattleTurn(&state,5));
    assert(state.turn==0 && state.playerIndex==1); /* faint replacement free */
    GvBattleBegin(&state,42,0);
    copy=state;
    assert(GvBattleTurn(&state,1));
    assert(GvBattleTurn(&copy,1));
    assert(!memcmp(&state,&copy,sizeof(state))); /* deterministic seed */
    for(seed=1;seed<=16;seed++) {
        GvBattleBegin(&state,seed,seed%4);
        for(steps=0;steps<96 && !state.result;steps++) {
            if(!state.player[state.playerIndex].hp) action=4+GvFirstHealthy(state.player);
            else {GvBestMove(&state,&state.player[state.playerIndex],&state.enemy[state.enemyIndex],&slot);action=slot;}
            assert(GvBattleTurn(&state,action));
            assert(state.playerIndex<3 && state.enemyIndex<3);
            for(slot=0;slot<3;slot++) {
                assert(state.player[slot].hp<=state.player[slot].maxHP);
                assert(state.enemy[slot].hp<=state.enemy[slot].maxHP);
            }
        }
        assert(state.result); /* bounded encounters terminate */
        if(state.result==1) wins++; else losses++;
    }
    printf("{\"seeds\":16,\"wins\":%u,\"losses\":%u}\n",wins,losses);
    return 0;
}
'''
        with tempfile.TemporaryDirectory(prefix="gv-native-") as tmp:
            path = Path(tmp)
            (path / "qualification.c").write_text(driver)
            built = subprocess.run(["cc", "-std=gnu89", "-O1", "-fsanitize=address,undefined", "-I", str(ROOT / "tools/gba_mashup/native"), str(path / "qualification.c"), "-o", str(path / "qualification")], capture_output=True, text=True)
            self.assertEqual(built.returncode, 0, built.stderr)
            result = subprocess.run([str(path / "qualification")], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)["seeds"], 16)


if __name__ == "__main__":
    unittest.main()
