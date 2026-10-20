#ifndef GUARD_WHOLE_GAME_BRIDGE_H
#define GUARD_WHOLE_GAME_BRIDGE_H

#include "global.h"
#include "pokemon.h"

#define WG_MAGIC 0x57474D31u
#define WG_SCHEMA 1
#define WG_REGION_FIRERED 1
#define WG_REGION_EMERALD 2
#define WG_CMD_NONE 0
#define WG_CMD_EXPORT 1
#define WG_CMD_IMPORT 2
#define WG_CMD_BOOTSTRAP 3
#define WG_CMD_MERGE 4
#define WG_STATUS_IDLE 0
#define WG_STATUS_PENDING 1
#define WG_STATUS_READY 2
#define WG_STATUS_DONE 3
#define WG_STATUS_ERROR 4
#define WG_STATUS_MERGE_READY 5
#define WG_ERROR_NONE 0
#define WG_ERROR_SCHEMA 1
#define WG_ERROR_PARTY 2
#define WG_ERROR_MON 3
#define WG_ERROR_MAIL 4
#define WG_ERROR_ITEM 5
#define WG_ERROR_CRC 6
#define WG_ERROR_CONTEXT 7
#define WG_ERROR_IDENTITY 8
#define WG_ERROR_SEQUENCE 9
#define WG_ERROR_SAVE 10

struct WholeGameBridge
{
    u32 magic;          // 0
    u32 schema;         // 4
    u32 region;         // 8: target ROM identity
    u32 sequence;       // 12: host transaction nonce
    u32 command;        // 16: MERGE appends imported mons to native starter party
    u32 status;         // 20
    u32 error;          // 24
    u32 payloadCrc;     // 28: FNV-1a over bytes 32..647
    u8 trainerId[4];    // 32
    u8 playerName[8];   // 36: source character encoding
    u8 playerGender;    // 44
    u8 partyCount;      // 45
    u8 sourceRegion;    // 46
    u8 reserved;        // 47
    u8 party[PARTY_SIZE][100]; // 48
};

extern struct WholeGameBridge gWholeGameBridge;
void WholeGame_BridgePreCallbacks(void);
void WholeGame_BridgeFieldTick(void);
void WholeGame_BridgeAfterNewGame(void);
void WholeGame_RequestTravel(void);

#endif
