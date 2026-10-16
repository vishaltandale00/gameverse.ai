#ifndef GAMEVERSE_EMERALD_BRIDGE_H
#define GAMEVERSE_EMERALD_BRIDGE_H

/* Version 2: native singles encounter bridge. All state belongs to the GBA ROM.
 * No heap, host RPC, or external model is involved in combat resolution. */
typedef unsigned char GvU8;
typedef unsigned short GvU16;
typedef unsigned int GvU32;

typedef struct {
    const char *name;
    GvU16 species;
    GvU8 types[2], level;
    GvU16 hp, maxHP, attack, defense, spAttack, spDefense, speed;
    GvU8 ability;
    GvU32 status1;
    GvU16 moves[4];
    GvU8 pp[4];
} GvCombatant;

typedef struct {
    GvU32 magic;
    GvU8 active, result;
    GvU16 turn;
    GvU8 weather, playerIndex, enemyIndex;
    GvU16 lastPlayerMove, lastEnemyMove, lastDamage;
    GvCombatant player[3], enemy[3];
    GvU32 rng;
} GvBattle;

/* result: 0 ongoing, 1 victory, 2 defeat. action: 0..3 move, 4..6 switch.
 * A fainted active player must choose a healthy replacement; this is free.
 * Switching a healthy active player consumes a turn. Invalid actions return 0. */
void GvBattleBegin(GvBattle *state, GvU32 seed, GvU8 area);
void GvBattleBeginWild(GvBattle *state, GvU32 seed, GvU8 area, GvU16 species, GvU8 preserveParty);
void GvBattleRescueParty(GvBattle *state);
const GvU16 *GvFieldTiles(GvU16 species);
const GvU16 *GvFieldPalette(GvU16 species);
GvU8 GvBattleChooseEnemyAction(GvBattle *state);
GvU8 GvBattleTurn(GvBattle *state, GvU8 action);
const char *GvMoveName(GvU16 move);
GvU8 GvMoveType(GvU16 move);
GvU8 GvMovePower(GvU16 move);
const char *GvTypeName(GvU8 type);
/* Original Emerald 64x64 first frames, RGB555; 0x8000 is transparent. */
const GvU16 *GvSpeciesSprite(GvU16 species, GvU8 back);

#endif
