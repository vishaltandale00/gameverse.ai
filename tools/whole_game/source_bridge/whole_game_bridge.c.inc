// Compiled by inclusion at the end of the source game's overworld.c.
// Source trees remain pristine; source_bridge/install.py installs this only in build copies.
#include "whole_game_bridge.h"
#include "constants/items.h"
#include "constants/species.h"
#include "constants/moves.h"
#include "save.h"

typedef char WgPokemonSize[(sizeof(struct Pokemon) == 100) ? 1 : -1];
typedef char WgBridgeSize[(sizeof(struct WholeGameBridge) == 648) ? 1 : -1];

#if defined(WG_BUILD_FIRERED)
#define WG_LOCAL_REGION WG_REGION_FIRERED
#else
#define WG_LOCAL_REGION WG_REGION_EMERALD
#endif

EWRAM_DATA struct WholeGameBridge gWholeGameBridge = {0};
static EWRAM_DATA u32 sWgLastSequence = 0;
static EWRAM_DATA bool8 sWgAwaitStarterMerge = FALSE;

static void WgEnsureInitialized(void)
{
    if (gWholeGameBridge.magic == 0)
    {
        gWholeGameBridge.magic = WG_MAGIC;
        gWholeGameBridge.schema = WG_SCHEMA;
        gWholeGameBridge.region = WG_LOCAL_REGION;
    }
}

static u32 WgPayloadCrc(void)
{
    const u8 *bytes = (const u8 *)&gWholeGameBridge.trainerId[0];
    u32 crc = 2166136261u;
    u32 i;
    for (i = 0; i < 616; i++)
    {
        crc ^= bytes[i];
        crc *= 16777619u;
    }
    return crc;
}

static bool8 WgBytesEqual(const u8 *left, const u8 *right, u32 length)
{
    u32 i;
    for (i = 0; i < length; i++)
        if (left[i] != right[i])
            return FALSE;
    return TRUE;
}

static bool8 WgValidMon(struct Pokemon *mon, u32 *error)
{
    u32 i, key, sum = 0, decrypted;
    u32 species, item;
    if (mon->box.isBadEgg)
        goto badMon;
    key = mon->box.personality ^ mon->box.otId;
    for (i = 0; i < 12; i++)
    {
        decrypted = mon->box.secure.raw[i] ^ key;
        sum += (decrypted & 0xFFFF) + (decrypted >> 16);
    }
    if ((u16)sum != mon->box.checksum)
        goto badMon;
    // GetMonData decrypts/re-encrypts and sets bad-egg flags on a bad
    // checksum. Validate first, and run it only on a private copy.
    species = GetMonData(mon, MON_DATA_SPECIES, NULL);
    item = GetMonData(mon, MON_DATA_HELD_ITEM, NULL);
    // Deoxys battle stats/forms are game-version specific and need the
    // original trade receive recalculation before this bridge can carry it.
    if (species == SPECIES_NONE || species >= NUM_SPECIES || species == SPECIES_DEOXYS)
        goto badMon;
    for (i = 0; i < MAX_MON_MOVES; i++)
        if (GetMonData(mon, MON_DATA_MOVE1 + i, NULL) >= MOVES_COUNT)
            goto badMon;
    if (GetMonData(mon, MON_DATA_MAIL, NULL) != MAIL_NONE)
    {
        *error = WG_ERROR_MAIL;
        return FALSE;
    }
    // Both pinned sources assign the same meaning to every normal held
    // item ID below MACH_BIKE. Key/story items and reserved IDs cannot travel.
    if (item >= ITEM_MACH_BIKE || item == ITEM_ENIGMA_BERRY ||
        (item >= 52 && item <= 62) || item == 72 || item == 82 ||
        (item >= 87 && item <= 92) ||
        (item >= 99 && item <= 102) || item == 105 ||
        (item >= 112 && item <= 120) ||
        (item >= 226 && item <= 253))
    {
        *error = WG_ERROR_ITEM;
        return FALSE;
    }
    return TRUE;
badMon:
    *error = WG_ERROR_MON;
    return FALSE;
}

static bool8 WgValidPayload(u32 *error)
{
    u32 i;
    bool8 nameTerminated = FALSE;
    struct Pokemon mon;
    if (gWholeGameBridge.partyCount > PARTY_SIZE)
    {
        *error = WG_ERROR_PARTY;
        return FALSE;
    }
    if (gWholeGameBridge.playerGender > 1 ||
        (gWholeGameBridge.sourceRegion != WG_REGION_FIRERED &&
         gWholeGameBridge.sourceRegion != WG_REGION_EMERALD))
    {
        *error = WG_ERROR_IDENTITY;
        return FALSE;
    }
    for (i = 0; i < sizeof(gWholeGameBridge.playerName); i++)
        if (gWholeGameBridge.playerName[i] == EOS)
            nameTerminated = TRUE;
    if (!nameTerminated)
    {
        *error = WG_ERROR_IDENTITY;
        return FALSE;
    }
    for (i = 0; i < gWholeGameBridge.partyCount; i++)
    {
        memcpy(&mon, gWholeGameBridge.party[i], sizeof(mon));
        if (!WgValidMon(&mon, error))
            return FALSE;
    }
    if (gWholeGameBridge.payloadCrc != WgPayloadCrc())
    {
        *error = WG_ERROR_CRC;
        return FALSE;
    }
    return TRUE;
}

static void WgExport(void)
{
    u32 i, error = WG_ERROR_NONE;
    struct Pokemon mon;
    gWholeGameBridge.partyCount = gPlayerPartyCount;
    gWholeGameBridge.playerGender = gSaveBlock2Ptr->playerGender;
    gWholeGameBridge.sourceRegion = WG_LOCAL_REGION;
    gWholeGameBridge.reserved = 0;
    memcpy(gWholeGameBridge.trainerId, gSaveBlock2Ptr->playerTrainerId, 4);
    memcpy(gWholeGameBridge.playerName, gSaveBlock2Ptr->playerName, 8);
    for (i = 0; i < PARTY_SIZE; i++)
    {
        if (i < gPlayerPartyCount)
        {
            memcpy(&mon, &gPlayerParty[i], sizeof(mon));
            if (!WgValidMon(&mon, &error))
            {
                gWholeGameBridge.error = error;
                gWholeGameBridge.status = WG_STATUS_ERROR;
                return;
            }
            memcpy(gWholeGameBridge.party[i], &gPlayerParty[i], 100);
        }
        else
            memset(gWholeGameBridge.party[i], 0, 100);
    }
    gWholeGameBridge.payloadCrc = WgPayloadCrc();
    gWholeGameBridge.error = WG_ERROR_NONE;
    gWholeGameBridge.status = WG_STATUS_READY;
}

static void WgImport(bool8 bootstrap, bool8 merge)
{
    u32 i, error = WG_ERROR_NONE, base = merge ? gPlayerPartyCount : 0;
    if (!WgValidPayload(&error))
    {
        gWholeGameBridge.error = error;
        gWholeGameBridge.status = WG_STATUS_ERROR;
        return;
    }
    if (gWholeGameBridge.sourceRegion == WG_LOCAL_REGION)
    {
        gWholeGameBridge.error = WG_ERROR_IDENTITY;
        gWholeGameBridge.status = WG_STATUS_ERROR;
        return;
    }
    if (!bootstrap && (!WgBytesEqual(gSaveBlock2Ptr->playerTrainerId, gWholeGameBridge.trainerId, 4) ||
                       !WgBytesEqual(gSaveBlock2Ptr->playerName, gWholeGameBridge.playerName, 8) ||
                       gSaveBlock2Ptr->playerGender != gWholeGameBridge.playerGender))
    {
        gWholeGameBridge.error = WG_ERROR_IDENTITY;
        gWholeGameBridge.status = WG_STATUS_ERROR;
        return;
    }
    if (merge && (!sWgAwaitStarterMerge || gPlayerPartyCount == 0))
    {
        gWholeGameBridge.error = WG_ERROR_CONTEXT;
        gWholeGameBridge.status = WG_STATUS_ERROR;
        return;
    }
    if (bootstrap)
    {
        // Keep the source game's starter acquisition intact. First arrival
        // carries identity only; host later merges at a safe field scene.
        if (gWholeGameBridge.partyCount != 0)
        {
            gWholeGameBridge.error = WG_ERROR_PARTY;
            gWholeGameBridge.status = WG_STATUS_ERROR;
            return;
        }
        memcpy(gSaveBlock2Ptr->playerTrainerId, gWholeGameBridge.trainerId, 4);
        memcpy(gSaveBlock2Ptr->playerName, gWholeGameBridge.playerName, 8);
        gSaveBlock2Ptr->playerGender = gWholeGameBridge.playerGender;
    }
    if (base + gWholeGameBridge.partyCount > PARTY_SIZE)
    {
        gWholeGameBridge.error = WG_ERROR_PARTY;
        gWholeGameBridge.status = WG_STATUS_ERROR;
        return;
    }
    if (!merge)
        ZeroPlayerPartyMons();
    for (i = 0; i < gWholeGameBridge.partyCount; i++)
        memcpy(&gPlayerParty[base + i], gWholeGameBridge.party[i], 100);
    gPlayerPartyCount = base + gWholeGameBridge.partyCount;
    if (bootstrap)
        sWgAwaitStarterMerge = TRUE;
    if (merge)
        sWgAwaitStarterMerge = FALSE;
    sWgLastSequence = gWholeGameBridge.sequence;
    gWholeGameBridge.error = WG_ERROR_NONE;
    gWholeGameBridge.status = WG_STATUS_DONE;
}

void WholeGame_RequestTravel(void)
{
    WgEnsureInitialized();
    if (gWholeGameBridge.status != WG_STATUS_IDLE)
        return;
    gWholeGameBridge.sequence++;
    gWholeGameBridge.command = WG_CMD_EXPORT;
    gWholeGameBridge.status = WG_STATUS_PENDING;
}

void WholeGame_BridgePreCallbacks(void)
{
    u32 error = WG_ERROR_NONE;
    WgEnsureInitialized();
    if (gWholeGameBridge.command != WG_CMD_BOOTSTRAP || gWholeGameBridge.status != WG_STATUS_PENDING)
        return;
    if (gWholeGameBridge.magic != WG_MAGIC || gWholeGameBridge.schema != WG_SCHEMA ||
        gWholeGameBridge.region != WG_LOCAL_REGION)
    {
        gWholeGameBridge.error = WG_ERROR_SCHEMA;
        gWholeGameBridge.status = WG_STATUS_ERROR;
        return;
    }
    if (gWholeGameBridge.sequence == 0 || gWholeGameBridge.sequence <= sWgLastSequence)
    {
        gWholeGameBridge.error = WG_ERROR_SEQUENCE;
        gWholeGameBridge.status = WG_STATUS_ERROR;
        return;
    }
    if (gSaveFileStatus != SAVE_STATUS_EMPTY)
    {
        gWholeGameBridge.error = WG_ERROR_SAVE;
        gWholeGameBridge.status = WG_STATUS_ERROR;
        return;
    }
    if (!WgValidPayload(&error) || gWholeGameBridge.partyCount != 0 ||
        gWholeGameBridge.sourceRegion == WG_LOCAL_REGION)
    {
        gWholeGameBridge.error = error ? error : WG_ERROR_PARTY;
        gWholeGameBridge.status = WG_STATUS_ERROR;
        return;
    }
    // Arm the original title/intro path. The model-driven player chooses New
    // Game and completes the source intro, including rival name selection.
    // Only that original flow may call CB2_NewGame.
    gWholeGameBridge.status = WG_STATUS_READY;
}

void WholeGame_BridgeAfterNewGame(void)
{
    if (gWholeGameBridge.command == WG_CMD_BOOTSTRAP && gWholeGameBridge.status == WG_STATUS_READY)
        WgImport(TRUE, FALSE);
}

void WholeGame_BridgeFieldTick(void)
{
    if (ScriptContext_IsEnabled() || gPaletteFade.active)
        return;
    if (sWgAwaitStarterMerge && gWholeGameBridge.status == WG_STATUS_IDLE && gPlayerPartyCount != 0)
    {
        gWholeGameBridge.status = WG_STATUS_MERGE_READY;
        return;
    }
    if (gWholeGameBridge.status != WG_STATUS_PENDING)
        return;
    if (gWholeGameBridge.magic != WG_MAGIC || gWholeGameBridge.schema != WG_SCHEMA ||
        gWholeGameBridge.region != WG_LOCAL_REGION)
    {
        gWholeGameBridge.error = WG_ERROR_SCHEMA;
        gWholeGameBridge.status = WG_STATUS_ERROR;
        return;
    }
    if (gWholeGameBridge.sequence == 0 || gWholeGameBridge.sequence <= sWgLastSequence)
    {
        gWholeGameBridge.error = WG_ERROR_SEQUENCE;
        gWholeGameBridge.status = WG_STATUS_ERROR;
        return;
    }
    if (gWholeGameBridge.command == WG_CMD_EXPORT)
    {
        WgExport();
        sWgLastSequence = gWholeGameBridge.sequence;
    }
    else if (gWholeGameBridge.command == WG_CMD_IMPORT)
        WgImport(FALSE, FALSE);
    else if (gWholeGameBridge.command == WG_CMD_MERGE)
        WgImport(FALSE, TRUE);
    else
    {
        gWholeGameBridge.error = WG_ERROR_CONTEXT;
        gWholeGameBridge.status = WG_STATUS_ERROR;
    }
}
