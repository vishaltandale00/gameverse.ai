#ifndef GAMEVERSE_NATIVE_ENCOUNTER_H
#define GAMEVERSE_NATIVE_ENCOUNTER_H
#include "emerald_bridge.h"
struct SpriteData;
typedef struct {
    GvU32 identity;
    GvU16 species, x, y;
    GvU8 ramSlot, nativeSpriteId, area, room, active, resolution;
    GvU16 wins, retreats;
} GvWildLink;
extern GvWildLink gGvWildLink;
extern GvBattle gGvBattle;
unsigned int GvWildContact(struct SpriteData *sprite);
unsigned int GvWildDraw(struct SpriteData *sprite, int slot);
void GvWildWorldTick(void);
void GvWildInvalidateGraphics(void);
extern unsigned char gGvEncounterPending;
unsigned int GvNativePollEncounter(void);
unsigned int GvNativeBattleHandler(void);
#endif
