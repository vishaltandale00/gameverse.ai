/* Original USA tile-lookup Thumb execution vs self-recovered terrain C.
 * All ROM remains immutable; only synthetic private RAM caches/registers vary.
 */
#include <mgba/core/core.h>
#include <mgba/core/config.h>
#include <mgba/core/log.h>
#include <mgba/gba/core.h>
#include <mgba/internal/arm/arm.h>
#include <mgba/internal/arm/isa-inlines.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <limits.h>
#include <stdarg.h>
#include "sonic-recovered-terrain.c"
static void quiet_log(struct mLogger *logger,int category,enum mLogLevel level,const char *format,va_list args)
{(void)logger;(void)category;(void)level;(void)format;(void)args;}
static struct mLogger logger={.log=quiet_log};
static uint32_t u32(const uint8_t *p){return p[0]|p[1]<<8|p[2]<<16|(uint32_t)p[3]<<24;}
static uint16_t u16(const uint8_t *p){return p[0]|p[1]<<8;}
static unsigned original(struct mCore *core,unsigned entry,unsigned header,unsigned x,unsigned y,unsigned layer,unsigned *result,int8_t *angle)
{
    struct ARMCore *cpu=core->cpu;
    core->busWrite32(core,0x03005a0c,header);
    core->busWrite32(core,0x03000408,0xffffffff);
    core->busWrite32(core,0x03000418,0xffffffff);
    for(unsigned i=0;i<16;i++)cpu->gprs[i]=0;
    cpu->gprs[0]=x;cpu->gprs[1]=y;cpu->gprs[2]=layer;
    cpu->gprs[3]=0x03007100;core->busWrite8(core,0x03007100,0x55);
    cpu->gprs[ARM_SP]=0x03007e00;cpu->gprs[ARM_LR]=0x08000001;
    cpu->cpsr.i=1;cpu->cycles=0;cpu->nextEvent=INT_MAX;
    _ARMSetMode(cpu,MODE_THUMB);cpu->gprs[ARM_PC]=entry;ThumbWritePC(cpu);
    unsigned n=0;
    while((uint32_t)cpu->gprs[ARM_PC]-2!=0x08000000 && n<2048){ARMRun(cpu);n++;}
    if(n==2048)return 0;
    *result=cpu->gprs[0];*angle=(int8_t)core->busRead8(core,0x03007100);return n;
}
int main(int argc,char **argv)
{
    if(argc!=2)return 2;
    mLogSetDefaultLogger(&logger);
    FILE *f=fopen(argv[1],"rb");if(!f)return 3;
    uint8_t *rom=malloc(8388608);if(!rom||fread(rom,1,8388608,f)!=8388608)return 4;fclose(f);
    struct mCore *core=GBACoreCreate();if(!core||!core->init(core))return 5;
    mCoreInitConfig(core,NULL);mCoreConfigSetDefaultIntValue(&core->config,"skipBios",1);
    mCoreConfigSetDefaultIntValue(&core->config,"useBios",0);mCoreLoadConfig(core);
    if(!mCoreLoadFile(core,argv[1]))return 6;core->reset(core);
    unsigned checked=0,instructions=0;uint32_t rng=0x534f4e49;
    for(unsigned stage=0;stage<18;stage++){
        unsigned header=u32(rom+0x4a6da4+stage*4);const uint8_t *h=rom+header-0x08000000;
        SonicRecoveredTerrain terrain={(const uint16_t *)(rom+u32(h+8)-0x08000000),
            {rom+u32(h+12)-0x08000000,rom+u32(h+16)-0x08000000},u16(h+24),u16(h+26),
            (const int8_t *)(rom+u32(h)-0x08000000),(const int8_t *)(rom+u32(h+4)-0x08000000),
            (const uint16_t *)(rom+u32(h+20)-0x08000000)};
        for(unsigned i=0;i<128;i++)for(unsigned layer=0;layer<2;layer++){
            rng=rng*1664525+1013904223;unsigned x=(rng>>4)%u16(h+28);
            rng=rng*1664525+1013904223;unsigned y=(rng>>4)%u16(h+30);
            if(i==0)x=y=0;if(i==1){x=u16(h+28)-1;y=u16(h+30)-1;}
            unsigned actual;int8_t actualAngle,expectedAngle;
            unsigned n=original(core,0x08040080,header,x,y,layer,&actual,&actualAngle);
            if(!n){fprintf(stderr,"instruction limit stage%u\n",stage);return 7;}
            unsigned expected=sonic_recovered_tile_at(&terrain,x,y,layer);
            if(actual!=expected){fprintf(stderr,"stage%u (%u,%u) layer%u ROM%u C%u\n",stage,x,y,layer,actual,expected);return 8;}
            instructions+=n;checked++;
            for(unsigned suppress=0;suppress<2;suppress++){
                int32_t px=i==2?-17:i==3?u16(h+28)+7:(int32_t)x;
                int32_t py=i==2?-9:i==3?u16(h+30)+7:(int32_t)y;
                unsigned mode=layer|(suppress?0x80:0);
                n=original(core,0x0803fe10,header,px,py,mode,&actual,&actualAngle);
                int32_t expectedHeight=sonic_recovered_profile_y(&terrain,px,py,mode,&expectedAngle);
                if(!n || (int32_t)actual!=expectedHeight || actualAngle!=expectedAngle){
                    fprintf(stderr,"profile stage%u x%d y%d mode%u ROM{%d,%d} C{%d,%d}\n",stage,px,py,mode,(int32_t)actual,actualAngle,expectedHeight,expectedAngle);return 9;
                }
                instructions+=n;checked++;
                n=original(core,0x0803ff50,header,py,px,mode,&actual,&actualAngle);
                expectedHeight=sonic_recovered_profile_x(&terrain,px,py,mode,&expectedAngle);
                if(!n || (int32_t)actual!=expectedHeight || actualAngle!=expectedAngle){
                    fprintf(stderr,"X profile stage%u x%d y%d mode%u ROM{%d,%d} C{%d,%d}\n",stage,px,py,mode,(int32_t)actual,actualAngle,expectedHeight,expectedAngle);return 10;
                }
                instructions+=n;checked++;
            }
        }
    }
    printf("{\"outcome\":\"pass\",\"stages\":18,\"layers\":2,\"vectors\":%u,\"original_thumb_instructions\":%u,\"scope\":\"descriptor lookup plus both-axis profiles/angles; material meaning/full route geometry unqualified\"}\n",checked,instructions);
    core->deinit(core);free(rom);return 0;
}
