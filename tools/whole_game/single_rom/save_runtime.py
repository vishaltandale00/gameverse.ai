"""Streaming fresh-schema 128-KiB save adapter. Never patches canonical source."""
from __future__ import annotations
from pathlib import Path
import hashlib
import json
from .save_codec import emit as emit_box_codec

HEADER = r'''#ifndef WG_SAVE_RUNTIME_H
#define WG_SAVE_RUNTIME_H
#include "wg_box_codec.h"
#define WG_SAVE_SECTORS 13
#define WG_SAVE_PAYLOAD 4084
#define WG_SAVE_CAPACITY (13*4084)
typedef unsigned char WgByte;
typedef unsigned WgWord;
/* read/write return zero on success. Buffer is exactly4096 bytes. */
typedef int (*WgSectorRead)(void *, unsigned, unsigned char *);
typedef int (*WgByteCommit)(void *, unsigned, unsigned, unsigned char);
typedef int (*WgSectorWrite)(void *, unsigned, const unsigned char *);
struct WgSaveView {
    unsigned char *block2, *block1, *storage;
    unsigned size2, size1, storageSize, boxOffset, tailOffset;
};
struct WgSaveIo {
    WgSectorRead read;
    WgSectorWrite write;
    void *context;
    unsigned char *sector;
    WgByteCommit commitByte;
};
/* Return0 success;1 invalid source/shape;2 I/O;3 no valid fresh-schema slot.
 * Source and flash must remain stable during each synchronous transaction.
 * No additional sector buffer allocated; scratch consists of single records.
 */
unsigned WgSnapshotSize(const struct WgSaveView *);
int WgSnapshotSave(const struct WgSaveView *,struct WgSaveIo *,unsigned *generation,unsigned allowNewGameOverwrite);
int WgSnapshotPrepare(const struct WgSaveView *,struct WgSaveIo *,unsigned *generation,unsigned *slot);
int WgSnapshotCommit(const struct WgSaveView *,struct WgSaveIo *,unsigned generation,unsigned slot);
int WgSnapshotLoad(const struct WgSaveView *,struct WgSaveIo *,unsigned *generation);
int WgSnapshotTrainerId(const struct WgSaveView *,struct WgSaveIo *,unsigned offset,unsigned *sum);
int WgHistorySave(struct WgSaveIo *,const unsigned char *,unsigned,unsigned);
int WgHistoryLoad(struct WgSaveIo *,unsigned char *,unsigned,unsigned);
/* Native adapter latch reset: call only from initialized NewGame path. */
void WholeGameSave_NewGame(void);
#endif
'''

RUNTIME = r'''#include "wg_save_runtime.h"
typedef unsigned char B;
typedef unsigned U;
#define MAIN_MAGIC 0x57474d31U
#define HISTORY_MAGIC 0x57475131U
#define SCHEMA 0x00010001U /* native layout1, unified namespace/state semantics1; bump on mapping changes */
static U r32(const B *p) { return p[0]|((U)p[1]<<8)|((U)p[2]<<16)|((U)p[3]<<24); }
static void w32(B *p,U n) { p[0]=(B)n;p[1]=(B)(n>>8);p[2]=(B)(n>>16);p[3]=(B)(n>>24); }
static void cp(B *d,const B *s,U n) { while(n--) *d++=*s++; }
static void zero(B *p,U n) { while(n--) *p++=0; }
static U crc(U value,const B *p,U n) {
    U i; while(n--) { value^=*p++; for(i=0;i<8;i++) value=(value>>1)^((0-(value&1))&0xedb88320U); } return value;
}
static U sector_crc(const B *p,U physical) {
    B index[4]; w32(index,physical); return ~crc(crc(~0U,p,4092),index,4);
}
static void footer(B *p,U magic,U generation,U physical) {
    w32(p+4084,magic);w32(p+4088,generation);w32(p+4092,sector_crc(p,physical));
}
static int sector_valid(const B *p,U magic,U physical) {
    return r32(p+4084)==magic && r32(p+4092)==sector_crc(p,physical);
}
unsigned WgSnapshotSize(const struct WgSaveView *v) {
    return 32+v->size2+v->size1+v->storageSize-420*5;
}
static int shape(const struct WgSaveView *v) {
    if(!v || !v->block1 || !v->block2 || !v->storage) return 1;
    if(v->storageSize>WG_SAVE_CAPACITY || v->size1>WG_SAVE_CAPACITY || v->size2>WG_SAVE_CAPACITY) return 1;
    if(v->boxOffset>v->storageSize || v->tailOffset!=v->boxOffset+420*80 || v->tailOffset>v->storageSize) return 1;
    return WgSnapshotSize(v)>WG_SAVE_CAPACITY;
}
static U header_word(const struct WgSaveView *v,U i) {
    switch(i) {
    case 0:return MAIN_MAGIC;case 1:return SCHEMA;case 2:return v->size2;
    case 3:return v->size1;case 4:return v->storageSize;case 5:return v->boxOffset;
    case 6:return v->tailOffset;default:return WgSnapshotSize(v);
    }
}
static void source_read(const struct WgSaveView *v,U offset,B *out,U count,U imageCrc) {
    B packed[75]; U k,n,index,start=32+v->size2+v->size1;
    while(count) {
        if(offset<32) { *out++=(B)((offset/4==7?imageCrc:header_word(v,offset/4))>>((offset%4)*8));offset++;count--;continue; }
        if(offset<32+v->size2) { n=32+v->size2-offset; if(n>count)n=count;cp(out,v->block2+offset-32,n); }
        else if(offset<start) { n=start-offset;if(n>count)n=count;cp(out,v->block1+offset-32-v->size2,n); }
        else if(offset<start+v->boxOffset) { n=start+v->boxOffset-offset;if(n>count)n=count;cp(out,v->storage+offset-start,n); }
        else if(offset<start+v->boxOffset+420*75) {
            k=offset-start-v->boxOffset;index=k/75;k%=75;n=75-k;if(n>count)n=count;
            WgBoxEncodeSlots(v->storage+v->boxOffset+index*80,packed,1);cp(out,packed+k,n);
        } else { k=offset-(start+v->boxOffset+420*75);n=count;cp(out,v->storage+v->tailOffset+k,n); }
        offset+=n;out+=n;count-=n;
    }
}
struct Reader { struct WgSaveIo *io; U slot; U cached; };
static int read_stream(struct Reader *r,U offset,B *out,U count) {
    U sector,k,n;
    while(count) {
        sector=offset/4084;k=offset%4084;n=4084-k;if(n>count)n=count;
        if(sector>=13) return 1;
        if(r->cached!=sector) {
            if(r->io->read(r->io->context,r->slot*13+sector,r->io->sector)) return 1;
            r->cached=sector;
        }
        cp(out,r->io->sector+k,n);offset+=n;out+=n;count-=n;
    } return 0;
}
static int validate_slot(const struct WgSaveView *v,struct WgSaveIo *io,U slot,U *generation) {
    U i,g=0,imageCrc=~0U,expectedCrc=0,n,total=WgSnapshotSize(v); B record[80]; struct Reader reader;
    for(i=0;i<13;i++) {
        if(io->read(io->context,slot*13+i,io->sector)) return 2;
        if(!sector_valid(io->sector,MAIN_MAGIC,slot*13+i)) return 1;
        if(i==0) {
            g=r32(io->sector+4088);
            { U j;for(j=0;j<7;j++) if(r32(io->sector+j*4)!=header_word(v,j)) return 1; }
                    expectedCrc=r32(io->sector+28);
        } else if(r32(io->sector+4088)!=g) return 1;
        if(i*4084<total) {
            n=total-i*4084;if(n>4084)n=4084;
            if(i==0){imageCrc=crc(imageCrc,io->sector,28);imageCrc=crc(imageCrc,io->sector+32,n-32);}
            else imageCrc=crc(imageCrc,io->sector,n);
        }
    }
    if(~imageCrc!=expectedCrc)return 1;
    reader.io=io;reader.slot=slot;reader.cached=~0U;
    for(i=0;i<420;i++) {
        /* Decode into game storage is forbidden until all sectors and records validate.
         * The codec's separate80-byte output keeps this preflight nonoverlapping. */
        B native[80];
        if(read_stream(&reader,32+v->size2+v->size1+v->boxOffset+i*75,record,75))return 2;
        if(WgBoxDecodeSlots(record,native,1))return 1;
    }
    *generation=g;return 0;
}
static int select_slot(const struct WgSaveView *v,struct WgSaveIo *io,U *slot,U *gen) {
    U a=0,b=0;int ar=validate_slot(v,io,0,&a),br=validate_slot(v,io,1,&b),av=ar==0,bv=br==0;
    if(ar==2||br==2)return 2;
    if(!av&&!bv)return 1;
    if(bv&&(!av||((b-a)!=0 && (b-a)<0x80000000U))) {*slot=1;*gen=b;}else{*slot=0;*gen=a;}
    return 0;
}
static int save_impl(const struct WgSaveView *v,struct WgSaveIo *io,U *generation,U allowNewGameOverwrite,U *pendingSlot) {
    U i,slot,gen,offset,n,total,imageCrc=~0U;int selection; B packed[75];
    if(shape(v)||!io||!io->read||!io->write||!io->sector||!generation)return 1;
    /* Validate every native record before first erase/program operation. */
    for(i=0;i<420;i++)if(WgBoxEncodeSlots(v->storage+v->boxOffset+i*80,packed,1))return 1;
    selection=select_slot(v,io,&slot,&gen);
    if(selection==2)return 2;
    if(selection) {
        U j;int erased=1;
        for(i=0;i<26;i++) {
            if(io->read(io->context,i,io->sector))return 2;
            for(j=0;j<4096;j++)if(io->sector[j]!=255)erased=0;
        }
        if(!erased&&!allowNewGameOverwrite)return 3;
        slot=1;gen=0;
    }
    slot^=1;gen++;total=WgSnapshotSize(v);
    source_read(v,0,io->sector,28,0);imageCrc=crc(imageCrc,io->sector,28);
    for(offset=32;offset<total;offset+=n){n=total-offset;if(n>4084)n=4084;source_read(v,offset,io->sector,n,0);imageCrc=crc(imageCrc,io->sector,n);}
    imageCrc=~imageCrc;
    for(i=0;i<13;i++) {
        zero(io->sector,4096);offset=i*4084;
        if(offset<total){n=total-offset;if(n>4084)n=4084;source_read(v,offset,io->sector,n,imageCrc);}
        footer(io->sector,MAIN_MAGIC,gen,slot*13+i);
        if(pendingSlot&&i==12)io->sector[4084]=255;
        if(io->write(io->context,slot*13+i,io->sector))return 2;
    }
    /* Commit is validity of all13 sector CRCs and shared generation. Sector12
     * is written last; the opposite complete slot is never modified. */
    if(pendingSlot){*pendingSlot=slot;*generation=gen;return 0;}
    if(validate_slot(v,io,slot,&i)||i!=gen)return 2;
    *generation=gen;return 0;
}
int WgSnapshotSave(const struct WgSaveView *v,struct WgSaveIo *io,U *generation,U allowNewGameOverwrite) {
    return save_impl(v,io,generation,allowNewGameOverwrite,0);
}
int WgSnapshotPrepare(const struct WgSaveView *v,struct WgSaveIo *io,U *generation,U *slot) {
    if(!slot||!io||!io->commitByte)return 1;
    return save_impl(v,io,generation,0,slot);
}
struct PreparedReader { struct WgSaveIo *actual; U last; };
static int prepared_read(void *context,U sector,B *out) {
    struct PreparedReader *p=context;
    if(p->actual->read(p->actual->context,sector,out))return 1;
    if(sector==p->last){if(out[4084]!=255)return 1;out[4084]=(B)MAIN_MAGIC;}
    return 0;
}
int WgSnapshotCommit(const struct WgSaveView *v,struct WgSaveIo *io,U generation,U slot) {
    U gen;struct WgSaveIo staged;struct PreparedReader reader;
    if(shape(v)||!io||!io->read||!io->sector||!io->commitByte||slot>1)return 1;
    staged=*io;reader.actual=io;reader.last=slot*13+12;staged.read=prepared_read;staged.context=&reader;
    if(validate_slot(v,&staged,slot,&gen)||gen!=generation)return 2;
    if(io->commitByte(io->context,slot*13+12,4084,(B)MAIN_MAGIC))return 2;
    if(validate_slot(v,io,slot,&gen)||gen!=generation)return 2;
    return 0;
}
int WgSnapshotLoad(const struct WgSaveView *v,struct WgSaveIo *io,U *generation) {
    U slot,gen,i,offset;B packed[75];struct Reader r;int selection;
    if(shape(v)||!io||!io->read||!io->sector||!generation)return 1;
    selection=select_slot(v,io,&slot,&gen);if(selection)return selection==2?2:3;
    r.io=io;r.slot=slot;r.cached=~0U;offset=32;
    if(read_stream(&r,offset,v->block2,v->size2))return 2;offset+=v->size2;
    if(read_stream(&r,offset,v->block1,v->size1))return 2;offset+=v->size1;
    if(read_stream(&r,offset,v->storage,v->boxOffset))return 2;offset+=v->boxOffset;
    for(i=0;i<420;i++) {
        if(read_stream(&r,offset,packed,75))return 2;
        if(WgBoxDecodeSlots(packed,v->storage+v->boxOffset+i*80,1))return 2;offset+=75;
    }
    if(read_stream(&r,offset,v->storage+v->tailOffset,v->storageSize-v->tailOffset))return 2;
    *generation=gen;return 0;
}
int WgSnapshotTrainerId(const struct WgSaveView *v,struct WgSaveIo *io,U offset,U *sum) {
    U slot,gen; B bytes[4];struct Reader r;int selection;
    if(shape(v)||!io||!io->read||!io->sector||offset>v->size2||v->size2-offset<4||!sum)return 1;
    selection=select_slot(v,io,&slot,&gen);if(selection)return selection==2?2:3;
    r.io=io;r.slot=slot;r.cached=~0U;
    if(read_stream(&r,32+offset,bytes,4))return 2;
    *sum=bytes[0]+bytes[1]+bytes[2]+bytes[3];return 0;
}
int WgHistorySave(struct WgSaveIo *io,const B *history,U size,U generation) {
    U i,j,n,k,imageCrc;
    if(!io||!io->write||!io->sector||!history || size>2*4084-16)return 1;
    imageCrc=~crc(~0U,history,size);
    for(i=0;i<2;i++) {
        zero(io->sector,4096);
        for(j=0;j<4084;j++) {
            k=i*4084+j;
            if(k<16){n=k/4;io->sector[j]=(B)((n==0?HISTORY_MAGIC:n==1?SCHEMA:n==2?size:imageCrc)>>((k%4)*8));}
            else if(k-16<size)io->sector[j]=history[k-16];
        }
        footer(io->sector,HISTORY_MAGIC,generation,26+i);
        if(io->write(io->context,26+i,io->sector))return 2;
    }return 0;
}
int WgHistoryLoad(struct WgSaveIo *io,B *history,U size,U generation) {
    U i,start,n,value=~0U,expectedCrc=0;
    if(!io||!io->read||!io->sector||!history||size>2*4084-16)return 1;
    for(i=0;i<2;i++) {
        if(io->read(io->context,26+i,io->sector))return 2;
        if(!sector_valid(io->sector,HISTORY_MAGIC,26+i)||r32(io->sector+4088)!=generation)return 3;
        if(i==0&&(r32(io->sector)!=HISTORY_MAGIC||r32(io->sector+4)!=SCHEMA||r32(io->sector+8)!=size))return 3;
        if(i==0)expectedCrc=r32(io->sector+12);
        start=i==0?0:4084-16;
        if(start<size){n=i==0?4084-16:size-start;if(n>size-start)n=size-start;value=crc(value,io->sector+(i==0?16:0),n);}
    }
    if(~value!=expectedCrc)return 3;
    for(i=0;i<2;i++) {
        if(io->read(io->context,26+i,io->sector))return 2;
        start=i==0?0:4084-16;if(start>=size)continue;n=i==0?4084-16:size-start;if(n>size-start)n=size-start;
        cp(history+start,io->sector+(i==0?16:0),n);
    }return 0;
}
'''

# Native implementation is generated separately below.

NATIVE = r'''/* Included by native save.c after its global save buffer definitions. */
#include "wg_save_runtime.h"
#if WG_HAS_QUESTLOG_HISTORY
#include "whole_game_fr_quest_log.h"
#endif
typedef char WgMainSnapshotMustFit[(32+sizeof(struct SaveBlock2)+sizeof(struct SaveBlock1)+sizeof(struct PokemonStorage)-420*5<=WG_SAVE_CAPACITY)?1:-1];
typedef char WgNativeBufferIs4096[(sizeof(gSaveDataBuffer)==4096)?1:-1];
typedef char WgNativeBoxCountIs420[(TOTAL_BOXES_COUNT*IN_BOX_COUNT==420)?1:-1];
static struct WgSaveView WgNativeView(void)
{
    struct WgSaveView v;
    v.block2=(u8 *)gSaveBlock2Ptr;v.block1=(u8 *)gSaveBlock1Ptr;v.storage=(u8 *)gPokemonStoragePtr;
    v.size2=sizeof(struct SaveBlock2);v.size1=sizeof(struct SaveBlock1);v.storageSize=sizeof(struct PokemonStorage);
    v.boxOffset=offsetof(struct PokemonStorage,boxes);v.tailOffset=offsetof(struct PokemonStorage,boxNames);
    return v;
}
static int WgNativeRead(void *context,unsigned sector,unsigned char *out)
{
    (void)context;ReadFlash(sector,0,out,4096);return 0;
}
static int WgNativeWrite(void *context,unsigned sector,const unsigned char *data)
{
    int result;
    (void)context;result=ProgramFlashSectorAndVerify(sector,(u8 *)data);
    if(result && sector<26)gDamagedSaveSectors|=1U<<sector;
    return result;
}
static int WgNativeCommitByte(void *context,unsigned sector,unsigned offset,unsigned char value)
{
    int result;(void)context;result=ProgramFlashByte(sector,offset,value);
    if(result)gDamagedSaveSectors|=1U<<sector;
    return result;
}
static struct WgSaveIo WgNativeIo(void)
{
    struct WgSaveIo io;
    io.read=WgNativeRead;io.write=WgNativeWrite;io.context=NULL;io.sector=(u8 *)&gSaveDataBuffer;io.commitByte=WgNativeCommitByte;
    return io;
}
COMMON_DATA static unsigned sWgLoadBlocked=0;
static u8 WgNativeSave(unsigned allowNewGameOverwrite)
{
    struct WgSaveView v=WgNativeView();struct WgSaveIo io=WgNativeIo();unsigned generation=gSaveCounter;
    gDamagedSaveSectors=0;
    if(sWgLoadBlocked&&!allowNewGameOverwrite){gSaveAttemptStatus=SAVE_STATUS_ERROR;return SAVE_STATUS_ERROR;}
    if(WgSnapshotSave(&v,&io,&generation,allowNewGameOverwrite)) {gSaveAttemptStatus=SAVE_STATUS_ERROR;return SAVE_STATUS_ERROR;}
    sWgLoadBlocked=0;gSaveAttemptStatus=SAVE_STATUS_OK;
    gLastSaveCounter=gSaveCounter;gSaveCounter=generation;gLastWrittenSector=0;
#if WG_HAS_QUESTLOG_HISTORY
    /* Independent nonredundant history; failure never invalidates main commit. */
    WgHistorySave(&io,FR_QuestLog_GetHistoryBuffer(),FR_QuestLog_GetHistorySize(),generation);
#endif
    return SAVE_STATUS_OK;
}
static u8 WgNativeLoad(void)
{
    struct WgSaveView v=WgNativeView();struct WgSaveIo io=WgNativeIo();unsigned generation=0,i,j;int result;
    result=WgSnapshotLoad(&v,&io,&generation);
    if(result) {
        sWgLoadBlocked=1;
        if(result!=3) {
            /* A re-read failure after validation must not expose partially decoded
             * RAM to gameplay; boot's native corrupt-save path initializes defaults. */
            memset(v.block1,0,v.size1);memset(v.block2,0,v.size2);memset(v.storage,0,v.storageSize);
            return SAVE_STATUS_CORRUPT;
        }
        /* A foreign/native schema is corrupt for this fresh-save-only format. */
        for(i=0;i<26;i++) { WgNativeRead(NULL,i,io.sector);for(j=0;j<4096;j++)if(io.sector[j]!=255)return SAVE_STATUS_CORRUPT; }
        return SAVE_STATUS_EMPTY;
    }
    sWgLoadBlocked=0;gSaveCounter=generation;gLastWrittenSector=0;
#if WG_HAS_QUESTLOG_HISTORY
    if(WgHistoryLoad(&io,FR_QuestLog_GetHistoryBuffer(),FR_QuestLog_GetHistorySize(),generation))
        memset(FR_QuestLog_GetHistoryBuffer(),0,FR_QuestLog_GetHistorySize());
#endif
    return SAVE_STATUS_OK;
}
COMMON_DATA static unsigned sWgPendingSlot=0;
COMMON_DATA static unsigned sWgPendingGeneration=0;
COMMON_DATA static unsigned sWgPendingActive=0;
static u8 WgNativePrepare(void)
{
    struct WgSaveView v=WgNativeView();struct WgSaveIo io=WgNativeIo();
    gDamagedSaveSectors=0;sWgPendingActive=0;
    if(sWgLoadBlocked){gSaveAttemptStatus=SAVE_STATUS_ERROR;return SAVE_STATUS_ERROR;}
    if(WgSnapshotPrepare(&v,&io,&sWgPendingGeneration,&sWgPendingSlot)) {
        gSaveAttemptStatus=SAVE_STATUS_ERROR;return SAVE_STATUS_ERROR;
    }
    sWgPendingActive=1;gSaveAttemptStatus=SAVE_STATUS_OK;return SAVE_STATUS_OK;
}
static u8 WgNativeCommit(void)
{
    struct WgSaveView v=WgNativeView();struct WgSaveIo io=WgNativeIo();
    if(!sWgPendingActive||WgSnapshotCommit(&v,&io,sWgPendingGeneration,sWgPendingSlot)) {
        sWgPendingActive=0;gSaveAttemptStatus=SAVE_STATUS_ERROR;return SAVE_STATUS_ERROR;
    }
    sWgPendingActive=0;gLastSaveCounter=gSaveCounter;gSaveCounter=sWgPendingGeneration;gSaveAttemptStatus=SAVE_STATUS_OK;
#if WG_HAS_QUESTLOG_HISTORY
    WgHistorySave(&io,FR_QuestLog_GetHistoryBuffer(),FR_QuestLog_GetHistorySize(),gSaveCounter);
#endif
    return SAVE_STATUS_OK;
}
void WholeGameSave_NewGame(void)
{
    sWgLoadBlocked=0;sWgPendingActive=0;
}
'''


def replace_function(text: str, name: str, body: str) -> str:
    import re
    # Match the definition, not a declaration or function call.
    match=re.search(r'(?m)^(?:static )?\w+ '+re.escape(name)+r'\([^;{}]*\)\s*\{',text)
    if not match: raise ValueError(f'missing native save entry point {name}')
    end=match.end(); depth=1
    while depth:
        depth+=(text[end]=='{')-(text[end]=='}');end+=1
    return text[:match.end()]+'\n'+body+'\n}'+text[end:]


def apply(base: Path, *, codec_source: Path | None = None) -> dict:
    """Emit runtime/codec and reroute all native main-save entrypoints in staging.

    Caller supplies an isolated stage after state/world and optional QuestLog
    provider transforms. No canonical tree or save.h's auxiliary sector ABI changes.
    """
    base=Path(base).resolve()
    if base.name in ('pokeemerald','pokefirered'):
        raise ValueError('refusing canonical source tree')
    root=Path(__file__).resolve().parents[3]
    codec_source=Path(codec_source or root/'local/decomps/pokeemerald')
    codec_dir=base/'whole-game-save-codec'
    emit_box_codec(codec_source,codec_dir)
    (base/'include/wg_box_codec.h').write_text((codec_dir/'wg_box_codec.h').read_text())
    (base/'src/wg_box_codec.c').write_text((codec_dir/'wg_box_codec.c').read_text())
    (base/'include/wg_save_runtime.h').write_text(HEADER)
    (base/'src/wg_save_runtime.c').write_text(RUNTIME)
    history=(base/'include/whole_game_fr_quest_log.h').is_file()
    native='#define WG_HAS_QUESTLOG_HISTORY '+str(int(history))+'\n'+NATIVE
    (base/'include/whole_game_save_runtime.inc').write_text(native)
    path=base/'src/save.c';text=path.read_text()
    anchor='EWRAM_DATA static u8 sUnusedVar = 0;'
    if text.count(anchor)!=1:raise ValueError('unsupported native save buffer anchor')
    text=text.replace(anchor,anchor+'\n#include "whole_game_save_runtime.inc"',1)
    text=replace_function(text,'WriteSaveSectorOrSlot','    (void)sectorId;(void)locations;return WgNativeSave(0);')
    text=replace_function(text,'TryLoadSaveSlot','    (void)sectorId;(void)locations;return WgNativeLoad();')
    text=replace_function(text,'HandleSavingData',r'''    u32 *backupVar=gTrainerHillVBlankCounter;
    u8 result;
    gTrainerHillVBlankCounter=NULL;
    if(saveType==SAVE_HALL_OF_FAME || saveType==SAVE_HALL_OF_FAME_ERASE_BEFORE)
        if(GetGameStat(GAME_STAT_ENTERED_HOF)<999)IncrementGameStat(GAME_STAT_ENTERED_HOF);
    CopyPartyAndObjectsToSave();
    result=WgNativeSave(saveType==SAVE_OVERWRITE_DIFFERENT_FILE);
    if(result==SAVE_STATUS_OK) {
        if(saveType==SAVE_OVERWRITE_DIFFERENT_FILE || saveType==SAVE_HALL_OF_FAME_ERASE_BEFORE) {
            u8 i;for(i=SECTOR_ID_HOF_1;i<SECTORS_COUNT;i++)EraseFlashSector(i);
        }
        if(saveType==SAVE_HALL_OF_FAME || saveType==SAVE_HALL_OF_FAME_ERASE_BEFORE) {
            HandleWriteSectorNBytes(SECTOR_ID_HOF_1,gDecompressionBuffer,SECTOR_DATA_SIZE);
            HandleWriteSectorNBytes(SECTOR_ID_HOF_2,gDecompressionBuffer+SECTOR_DATA_SIZE,SECTOR_DATA_SIZE);
        }
    }
    gTrainerHillVBlankCounter=backupVar;gSaveAttemptStatus=result;
    return result;''')
    text=replace_function(text,'LinkFullSave_Init',r'''    if(gFlashMemoryPresent!=TRUE)return TRUE;
    CopyPartyAndObjectsToSave();gDamagedSaveSectors=0;return FALSE;''')
    text=replace_function(text,'LinkFullSave_WriteSector',r'''    if(WgNativePrepare()!=SAVE_STATUS_OK)DoSaveFailedScreen(SAVE_NORMAL);
    return TRUE;''')
    text=replace_function(text,'LinkFullSave_ReplaceLastSector','    return FALSE;')
    text=replace_function(text,'LinkFullSave_SetLastSectorSignature','    if(WgNativeCommit()!=SAVE_STATUS_OK)DoSaveFailedScreen(SAVE_NORMAL);\n    return FALSE;')
    text=replace_function(text,'WriteSaveBlock2',r'''    if(gFlashMemoryPresent!=TRUE)return TRUE;
    CopyPartyAndObjectsToSave();
    if(WgNativeSave(0)!=SAVE_STATUS_OK)DoSaveFailedScreen(SAVE_LINK);
    return FALSE;''')
    text=replace_function(text,'WriteSaveBlock1Sector','    return TRUE;')
    text=replace_function(text,'GetSaveBlocksPointersBaseOffset',r'''    struct WgSaveView view=WgNativeView();struct WgSaveIo io=WgNativeIo();unsigned sum=0;
    if(gFlashMemoryPresent!=TRUE)return 0;
    /* Boot calls this before SetSaveBlocksPointers: validation only, no game writes. */
    view.block1=view.block2=view.storage=(u8 *)&gSaveDataBuffer;
    if(WgSnapshotTrainerId(&view,&io,offsetof(struct SaveBlock2,playerTrainerId),&sum))return 0;
    return sum;''')
    text=replace_function(text,'TrySavingData',r'''    if(gFlashMemoryPresent!=TRUE){gSaveAttemptStatus=SAVE_STATUS_ERROR;return SAVE_STATUS_ERROR;}
    gSaveAttemptStatus=HandleSavingData(saveType);
    if(gSaveAttemptStatus!=SAVE_STATUS_OK)DoSaveFailedScreen(saveType);
    return gSaveAttemptStatus;''')
    failure_path=base/'src/save_failed_screen.c'
    failure=failure_path.read_text()
    failure=replace_function(failure,'CB2_WipeSave',r'''    u8 attempts;
    sClockInfo[CLOCK_RUNNING]=TRUE;
    /* No sector wiping: every retry revalidates source and preserves active slot. */
    for(attempts=0;attempts<3;attempts++)if(HandleSavingData(sSaveFailedType)==SAVE_STATUS_OK)break;
    FillWindowPixelBuffer(sWindowIds[TEXT_WIN_ID],PIXEL_FILL(1));
    if(attempts==3)SaveFailedScreenTextPrint(gText_BackupMemoryDamaged,1,0);
    else if(gGameContinueCallback==NULL)SaveFailedScreenTextPrint(gText_SaveCompleteGameCannotContinue,1,0);
    else SaveFailedScreenTextPrint(gText_SaveCompletePressA,1,0);
    SetMainCallback2(CB2_FadeAndReturnToTitleScreen);''')
    failure_path.write_text(failure)
    hof_path=base/'src/hall_of_fame.c'
    hof=hof_path.read_text().replace(' && gDamagedSaveSectors != 0','').replace(' && gDamagedSaveSectors','')
    hof_path.write_text(hof)
    reload_path=base/'src/reload_save.c';reload_text=reload_path.read_text()
    reload_text=reload_text.replace('#include "save.h"','#include "save.h"\n#include "title_screen.h"')
    reload_text=reload_text.replace('    LoadGameSave(SAVE_NORMAL);','''    if(LoadGameSave(SAVE_NORMAL)!=SAVE_STATUS_OK) {
        InitHeap(gHeap,HEAP_SIZE);SetMainCallback2(CB2_InitTitleScreen);return;
    }''')
    reload_path.write_text(reload_text)
    newgame_path=base/'src/new_game.c';newgame=newgame_path.read_text()
    newgame=newgame.replace('#include "global.h"','#include "global.h"\n#include "wg_save_runtime.h"',1)
    newgame=newgame.replace('void NewGameInitData(void)\n{','void NewGameInitData(void)\n{\n    WholeGameSave_NewGame();',1)
    newgame_path.write_text(newgame)
    # Prevent the original loader from copying unvalidated/default RAM into party
    # after a corrupt or absent snapshot.
    text=text.replace('        CopyPartyAndObjectsFromSave();','        if(status==SAVE_STATUS_OK)CopyPartyAndObjectsFromSave();')
    path.write_text(text)
    receipt={'schemaVersion':1,'status':'implemented','buildEligible':True,'ready':history,'unresolved':['nativeflash/full-ROM gameplay qualification']+([] if history else ['actual QuestLog history provider missing']),'mainSectors':[[0,12],[13,25]],'questLogSectors':[26,27],
        'auxiliarySectorsUnchanged':[28,29,30,31],'mainPayloadPerSector':4084,'mainCapacity':53092,
        'capacityGuard':'32+sizeof(SaveBlock2)+sizeof(SaveBlock1)+sizeof(PokemonStorage)-2100<=53092',
        'schemaPolicy':'fresh saves only; native Emerald saves are not migrated',
        'questLogProvider':'present' if history else 'unresolved: actual 6560-byte source provider absent',
        'saveSchemaIdentity':'layout1-unified-namespace/state-semantics1 (0x00010001; bump for same-size semantic changes)',
        'recovery':'all13 distinct fixed sector positions, common generation, sector CRC32, complete-image CRC32 and codec domain before game writes; inactive slot only',
        'memory':'existing gSaveDataBuffer4096; bounded per-record stack; no image-sized EWRAM allocation',
        'partialSavePolicy':'SAVE_LINK/EREADER and link partial APIs dispatch full snapshots',
        'qualification':'host fault model and ARM compile required; nativeflash/gameplay qualification outstanding',
        'sourceTransformSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    (base/'whole-game-save-runtime.json').write_text(json.dumps(receipt,indent=2)+'\n')
    return receipt
