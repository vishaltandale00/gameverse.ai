#ifndef GAMEVERSE_NATIVE_ENCOUNTER_H
#define GAMEVERSE_NATIVE_ENCOUNTER_H
#include "emerald_bridge.h"
extern GvBattle gGvBattle;
extern unsigned char gGvEncounterPending;
unsigned int GvNativePollEncounter(void);
unsigned int GvNativeBattleHandler(void);
#endif
