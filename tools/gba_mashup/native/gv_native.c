/* Native GBA encounter display/input. Metroid's campaign engine remains intact.
 * Entry uses its actual pause fade, OBJ backup and room-reload path. Combat math
 * and move/type records come from the versioned Emerald bridge beside this file.
 * This file is new glue, not a recovered Metroid or Pokemon runtime. */
#include "gv_native.h"
#include "gba.h"
#include "callbacks.h"
#include "color_fading.h"
#include "menus/pause_screen.h"
#include "structs/game_state.h"
#include "structs/samus.h"
#include "structs/connection.h"
#include "constants/game_state.h"
#include "constants/demo.h"
#include "structs/demo.h"
#include "structs/sprite.h"
#include "structs/bg_clip.h"
#include "sprite_util.h"
#include "oam.h"
#include "constants/particle.h"

extern unsigned int ProcessPauseButtonPress(void);
extern const GvU16 *GvSpeciesSprite(GvU16 species, GvU8 back);

#define GV_RAM __attribute__((section("iwram_data")))
GvBattle gGvBattle GV_RAM = {0};
GvU8 gGvEncounterPending GV_RAM = 0;
GvU8 gGvNativeEntered GV_RAM = 0;
GvU8 gGvNativeSelection GV_RAM = 0;
GvU8 gGvNativePartyMenu GV_RAM = 0;
GvU16 gGvNativePreviousEnergy GV_RAM = 0;
GvU16 gGvNativeCooldown GV_RAM = 0;
GvU16 gGvNativeBattlesWon GV_RAM = 0;
GvWildLink gGvWildLink GV_RAM = {0};
GvU8 gGvPartyInitialized GV_RAM = 0;
/* Bounded per-session world history. Full means oldest identity is evicted. */
GvU32 gGvDefeatedIdentities[128] GV_RAM = {0};
GvU16 gGvDefeatedCount GV_RAM = 0;
GvU16 gGvDefeatedCursor GV_RAM = 0;
GvU16 gGvFieldSlotSpecies[8] GV_RAM = {0};
GvU32 gGvWorldDrawIdentity GV_RAM = 0;
GvU16 gGvWorldDrawSpecies GV_RAM = 0;
GvU32 gGvWorldDrawCount GV_RAM = 0;
extern unsigned int GvSourceGraphicsBytes(unsigned char id);

static GvU16 GvWildSpecies(GvU8 id)
{
    switch(id) {
    case PSPRITE_ZOOMER_YELLOW: case PSPRITE_ZOOMER_RED: return 46; /* Paras */
    case PSPRITE_ZEELA: return 74; /* Geodude */
    case PSPRITE_ZEELA_RED: return 288; /* Zigzagoon */
    case PSPRITE_RIPPER_BROWN: case PSPRITE_RIPPER_PURPLE: return 41; /* Zubat */
    case PSPRITE_WAVER: case PSPRITE_WAVER_UNUSED: return 309; /* Wingull */
    default: return 0;
    }
}
static GvU32 GvWildIdentity(const struct SpriteData *sprite)
{
    return ((GvU32)gCurrentArea<<24)|((GvU32)gCurrentRoom<<16)|((GvU32)sprite->roomSlot<<8)|sprite->spriteId;
}
static GvU8 GvWildEligible(const struct SpriteData *sprite)
{
    return (sprite->status&SPRITE_STATUS_EXISTS) && !(sprite->properties&SP_SECONDARY_SPRITE) && GvWildSpecies(sprite->spriteId);
}
void GvWildInvalidateGraphics(void)
{
    unsigned int i;
    for(i=0;i<8;i++)gGvFieldSlotSpecies[i]=0;
}
/* Reject allocations aliased by a different/unmapped actor, including a larger
 * earlier allocation spanning this slot. Original graphics remain in that case. */
static GvU8 GvWildSafeSlot(const struct SpriteData *sprite, GvU16 species)
{
    unsigned int i,start,bytes,end,slot=sprite->spritesetGfxSlot;
    GvU8 id;
    if(slot>=8)return 0;
    for(i=0;i<MAX_AMOUNT_OF_SPRITE_TYPES;i++) {
        id=gSpritesetSpritesId[i];if(id<=PSPRITE_UNUSED16)continue;
        start=gSpritesetGfxSlots[i];bytes=GvSourceGraphicsBytes(id);end=start+(bytes+2047)/2048;
        if(start<=slot && end>slot && (start!=slot || GvWildSpecies(id)!=species))return 0;
    }
    return 1;
}
unsigned int GvWildDraw(struct SpriteData *sprite, int slot)
{
    GvU16 species; unsigned int i,part,frame,tile,gfx,palette;
    int x,y,dx,dy;
    volatile GvU16 *dst;
    const GvU16 *src;
    if(!GvWildEligible(sprite))return 0;
    species=GvWildSpecies(sprite->spriteId);
    if(!GvWildSafeSlot(sprite,species))return 0;
    gfx=sprite->spritesetGfxSlot;palette=8+gfx;
    if(gGvFieldSlotSpecies[gfx]!=species) {
        src=GvFieldTiles(species);if(!src)return 0;
        dst=(volatile GvU16 *)(0x06014000+gfx*2048);
        for(i=0;i<1024;i++)dst[i]=src[i];
        src=GvFieldPalette(species);dst=(volatile GvU16 *)(0x05000300+gfx*32);
        for(i=0;i<16;i++)dst[i]=src[i];
        gGvFieldSlotSpecies[gfx]=species;
    }
    if(gNextOamSlot+4>=OAM_BUFFER_DATA_SIZE)return 1;
    x=((int)sprite->xPosition-(int)gBg1XPosition)/4;
    y=((int)sprite->yPosition-(int)gBg1YPosition)/4;
    /* Center on the native hitbox. Original AI/hitbox stay authoritative. */
    x+=(sprite->hitboxLeft+sprite->hitboxRight)/8-16;
    y+=(sprite->hitboxTop+sprite->hitboxBottom)/8-16;
    frame=(gFrameCounter16Bit/16)&1;
    for(part=0;part<4;part++) {
        dx=(part&1)*16;dy=(part/2)*16;
        tile=512+gfx*64+frame*8+part*2;
        i=gNextOamSlot++;
        gOamData[i].all.attr0=(y+dy)&255;
        gOamData[i].all.attr1=((x+dx)&511)|0x4000; /* 16x16 square */
        gOamData[i].all.attr2=tile|((sprite->bgPriority&3)<<10)|(palette<<12);
    }
    gGvWorldDrawIdentity=GvWildIdentity(sprite);gGvWorldDrawSpecies=species;gGvWorldDrawCount++;
    return 1;
}
void GvWildWorldTick(void)
{
    unsigned int i,j;
    struct SpriteData *sprite;
    for(i=0;i<MAX_AMOUNT_OF_SPRITES;i++) {
        sprite=&gSpriteData[i];if(!GvWildEligible(sprite))continue;
        for(j=0;j<gGvDefeatedCount;j++)if(gGvDefeatedIdentities[j]==GvWildIdentity(sprite)) {
            sprite->status=0;break; /* already rewarded: never duplicate drops */
        }
    }
}
unsigned int GvWildContact(struct SpriteData *sprite)
{
    if(!GvWildEligible(sprite) || sprite->freezeTimer || !GvWildSafeSlot(sprite,GvWildSpecies(sprite->spriteId)))return 0;
    if(gGvNativeCooldown || gGvWildLink.active || gGvEncounterPending)return 1;
    if(gDemoState || gPauseScreenFlag || gShipLandingFlag || gPreventMovementTimer || !gEquipment.currentEnergy)return 0;
    gGvWildLink.identity=GvWildIdentity(sprite);gGvWildLink.species=GvWildSpecies(sprite->spriteId);
    gGvWildLink.x=sprite->xPosition;gGvWildLink.y=sprite->yPosition;
    gGvWildLink.ramSlot=sprite-gSpriteData;gGvWildLink.nativeSpriteId=sprite->spriteId;
    gGvWildLink.area=gCurrentArea;gGvWildLink.room=gCurrentRoom;
    gGvWildLink.active=1;gGvWildLink.resolution=0;
    return 1;
}
static void GvWildResolveVictory(void)
{
    struct SpriteData saved;struct SpriteData *sprite;
    unsigned int i;
    for(i=0;i<gGvDefeatedCount;i++)if(gGvDefeatedIdentities[i]==gGvWildLink.identity)return;
    if(gGvDefeatedCount<128)gGvDefeatedIdentities[gGvDefeatedCount++]=gGvWildLink.identity;
    else {gGvDefeatedIdentities[gGvDefeatedCursor++]=gGvWildLink.identity;gGvDefeatedCursor%=128;}
    if(gGvWildLink.ramSlot<MAX_AMOUNT_OF_SPRITES) {
        sprite=&gSpriteData[gGvWildLink.ramSlot];
        if(GvWildEligible(sprite) && GvWildIdentity(sprite)==gGvWildLink.identity) {
            saved=gCurrentSprite;gCurrentSprite=*sprite;
            SpriteUtilSpriteDeath(DEATH_NORMAL,sprite->yPosition,sprite->xPosition,1,PE_SPRITE_EXPLOSION_SMALL);
            *sprite=gCurrentSprite;gCurrentSprite=saved;
        }
    }
    gGvWildLink.wins++;gGvWildLink.resolution=1;
}

/* Original, compact 5x7 menu font. Rows are bit masks, A-Z then 0-9. */
static const GvU8 sGlyphs[36][7] = {
 {14,17,17,31,17,17,17},{30,17,17,30,17,17,30},{14,17,16,16,16,17,14},
 {30,17,17,17,17,17,30},{31,16,16,30,16,16,31},{31,16,16,30,16,16,16},
 {14,17,16,23,17,17,15},{17,17,17,31,17,17,17},{14,4,4,4,4,4,14},
 {7,2,2,2,18,18,12},{17,18,20,24,20,18,17},{16,16,16,16,16,16,31},
 {17,27,21,21,17,17,17},{17,25,21,19,17,17,17},{14,17,17,17,17,17,14},
 {30,17,17,30,16,16,16},{14,17,17,17,21,18,13},{30,17,17,30,20,18,17},
 {15,16,16,14,1,1,30},{31,4,4,4,4,4,4},{17,17,17,17,17,17,14},
 {17,17,17,17,17,10,4},{17,17,17,21,21,21,10},{17,17,10,4,10,17,17},
 {17,17,10,4,4,4,4},{31,1,2,4,8,16,31},
 {14,17,19,21,25,17,14},{4,12,4,4,4,4,14},{14,17,1,2,4,8,31},
 {30,1,1,14,1,1,30},{2,6,10,18,31,2,2},{31,16,16,30,1,1,30},
 {14,16,16,30,17,17,14},{31,1,2,4,8,8,8},{14,17,17,14,17,17,14},
 {14,17,17,15,1,1,14}
};
#define RGB(r,g,b) ((r)|((g)<<5)|((b)<<10))
#define PAPER RGB(29,30,27)
#define INK RGB(3,6,8)
#define ACCENT RGB(6,19,18)
#define BG RGB(5,10,15)

static void GvRect(int x, int y, int w, int h, GvU16 color)
{
    int i,j;
    volatile GvU16 *v = (volatile GvU16 *)0x06000000;
    for(j=y;j<y+h && j<160;j++)
        for(i=x;i<x+w && i<240;i++)
            if(i>=0 && j>=0) v[j*240+i]=color;
}
static void GvText(int x, int y, const char *text, GvU16 color)
{
    unsigned int i,row,col,c,index;
    volatile GvU16 *v=(volatile GvU16 *)0x06000000;
    for(i=0;text[i] && x+5<240;i++,x+=6)
    {
        c=(unsigned char)text[i];
        if(c>='a' && c<='z') c-=32;
        if(c>='A' && c<='Z') index=c-'A';
        else if(c>='0' && c<='9') index=26+c-'0';
        else { if(c=='-' || c=='/') GvRect(x,y+3,4,1,color); if(c=='>'){GvRect(x,y+2,2,3,color);GvRect(x+2,y+3,2,1,color);} continue; }
        for(row=0;row<7;row++) for(col=0;col<5;col++)
            if(sGlyphs[index][row] & (1<<(4-col))) v[(y+row)*240+x+col]=color;
    }
}
static void GvNumber(int x,int y,unsigned int n,GvU16 color)
{
    char digits[6]; unsigned int i=0,j; char t;
    do { digits[i++]=(n%10)+'0'; n/=10; } while(n && i<5);
    digits[i]=0;
    for(j=0;j<i/2;j++){t=digits[j];digits[j]=digits[i-1-j];digits[i-1-j]=t;}
    GvText(x,y,digits,color);
}
static void GvSprite(int x,int y,GvU16 species,GvU8 back)
{
    const GvU16 *pixels=GvSpeciesSprite(species,back);
    int i,j; GvU16 color;
    if(!pixels) return;
    for(j=0;j<64;j++) for(i=0;i<64;i++)
    {
        color=pixels[j*64+i];
        if(!(color&0x8000) && x+i<240 && y+j<160)
            ((volatile GvU16 *)0x06000000)[(y+j)*240+x+i]=color;
    }
}
static void GvHealth(int x,int y,const GvCombatant *mon)
{
    GvRect(x,y,76,4,RGB(19,22,20));
    if(mon->maxHP) GvRect(x,y,76*mon->hp/mon->maxHP,4,mon->hp*4<mon->maxHP?RGB(26,8,7):ACCENT);
    GvNumber(x,y+6,mon->hp,INK); GvText(x+22,y+6,"/",INK);
    GvNumber(x+32,y+6,mon->maxHP,INK);
}
static void GvRender(void)
{
    const GvCombatant *player=&gGvBattle.player[gGvBattle.playerIndex];
    const GvCombatant *enemy=&gGvBattle.enemy[gGvBattle.enemyIndex];
    unsigned int i; int x,y; GvU16 move;
    WRITE_16(REG_DISPCNT,0x0080); /* forced blank during infrequent bitmap redraw */
    GvRect(0,0,240,160,BG);
    GvRect(0,0,240,15,ACCENT);
    GvText(7,4,"METROID X POKEMON - WILD",PAPER);
    GvRect(0,16,240,85,RGB(23,27,24));
    GvRect(8,20,110,31,PAPER);GvText(12,23,enemy->name,INK);GvHealth(12,32,enemy);
    GvSprite(163,17,enemy->species,0);
    GvSprite(18,41,player->species,1);
    GvRect(121,67,111,32,PAPER);GvText(126,70,player->name,INK);GvHealth(126,79,player);
    if(gGvBattle.result)
    {
        GvText(8,110,gGvBattle.result==1?"VICTORY - ENERGY RECOVERED":"DEFEAT - RETURN TO THE MISSION",PAPER);
        GvText(8,128,"A - RESUME METROID",PAPER);
    }
    else if(gGvNativePartyMenu)
    {
        for(i=0;i<3;i++)
        {
            y=106+i*15;GvText(8,y,gGvNativeSelection==i?">":" ",PAPER);
            GvText(18,y,gGvBattle.player[i].name,PAPER);GvNumber(100,y,gGvBattle.player[i].hp,PAPER);
        }
        GvText(146,113,"A - SWITCH",PAPER);GvText(146,129,"B - MOVES",PAPER);
    }
    else
    {
        for(i=0;i<4;i++)
        {
            x=8+(i%2)*119;y=106+(i/2)*18;move=player->moves[i];
            if(gGvNativeSelection==i) GvRect(x-3,y-2,113,14,ACCENT);
            GvText(x,y,GvMoveName(move),PAPER);GvNumber(x+98,y,player->pp[i],PAPER);
        }
        GvText(8,145,"A-MOVE B-PARTY SELECT-RETREAT",PAPER);
    }
    WRITE_16(REG_BLDCNT,0); WRITE_16(REG_BLDY,0); WRITE_16(REG_MOSAIC,0);
    WRITE_16(REG_BG2PA,0x100); WRITE_16(REG_BG2PB,0);
    WRITE_16(REG_BG2PC,0); WRITE_16(REG_BG2PD,0x100);
    WRITE_32(REG_BG2X_L,0); WRITE_32(REG_BG2Y_L,0);
    WRITE_16(REG_DISPCNT,0x0403); /* Mode 3, BG2 only; no external display */
}

unsigned int GvNativePollEncounter(void)
{
    if(gGvNativeCooldown)gGvNativeCooldown--;
    if(!gGvWildLink.active || gGvEncounterPending)return 0;
    if(!ProcessPauseButtonPress())return 0;
    gGvEncounterPending=1;gGvNativeEntered=0;return 1;
}
unsigned int GvNativeBattleHandler(void)
{
    unsigned int redraw=0,action;
    if(!gGvNativeEntered)
    {
        PauseScreenInit(); /* real source backs up OBJ VRAM, minimap, palettes */
        CallbackSetVblank(PauseScreenVBlank_Empty);
        CallbackSetHblank(NULL);CallbackSetVcount(NULL);
        WRITE_16(REG_IME,0);
        WRITE_16(REG_IE,READ_16(REG_IE)&~(IF_HBLANK|IF_VCOUNT));
        WRITE_16(REG_DISPSTAT,READ_16(REG_DISPSTAT)&~(DSTAT_IF_HBLANK|DSTAT_IF_VCOUNT));
        WRITE_16(REG_DMA0_CNT_H,0);
        WRITE_16(REG_IME,1);
        GvBattleBeginWild(&gGvBattle,0x47A10000+gFrameCounter16Bit+(gCurrentRoom<<16),gCurrentArea,gGvWildLink.species,gGvPartyInitialized);
        gGvPartyInitialized=1;
        gGvNativeSelection=0;gGvNativePartyMenu=0;gGvNativeEntered=1;redraw=1;
    }
    else if((gGvBattle.result && (gChangedInput&KEY_A)) || (!gGvBattle.result && (gChangedInput&KEY_SELECT)))
    {
        if(gGvBattle.result==1)
        {
            GvWildResolveVictory();gGvNativeBattlesWon++;gEquipment.currentEnergy+=8;
            if(gEquipment.currentEnergy>gEquipment.maxEnergy)gEquipment.currentEnergy=gEquipment.maxEnergy;
        }
        else if(gGvBattle.result==2) {
            if(gEquipment.currentEnergy>1)gEquipment.currentEnergy/=2;
            GvBattleRescueParty(&gGvBattle);gGvWildLink.resolution=2;
        }
        else {gGvWildLink.retreats++;gGvWildLink.resolution=3;}
        gGvWildLink.active=0;GvWildInvalidateGraphics();
        gGvNativePreviousEnergy=gEquipment.currentEnergy;gGvNativeCooldown=180;
        gGvBattle.active=0;gGvEncounterPending=0;gGvNativeEntered=0;
        CallbackSetVblank(PauseScreenVBlank_Empty);
        return 1;
    }
    else if(!gGvBattle.result)
    {
        if(gChangedInput&KEY_B){gGvNativePartyMenu^=1;gGvNativeSelection=0;redraw=1;}
        if(gChangedInput&(KEY_LEFT|KEY_UP))
        {gGvNativeSelection=(gGvNativeSelection+(gGvNativePartyMenu?2:3))%(gGvNativePartyMenu?3:4);redraw=1;}
        if(gChangedInput&(KEY_RIGHT|KEY_DOWN))
        {gGvNativeSelection=(gGvNativeSelection+1)%(gGvNativePartyMenu?3:4);redraw=1;}
        if(gChangedInput&KEY_A)
        {
            action=gGvNativeSelection+(gGvNativePartyMenu?4:0);
            if(GvBattleTurn(&gGvBattle,action))
            {
                gGvNativePartyMenu=gGvBattle.player[gGvBattle.playerIndex].hp==0;
                gGvNativeSelection=0;
            }
            redraw=1;
        }
    }
    if(redraw)GvRender();
    return 0;
}
