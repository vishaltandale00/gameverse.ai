/* Actual original six-argument scanner vs emitted own recovered Thumb;
 * original profile/lookup instructions are the oracle, not the recovered C. */
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
static void quiet(struct mLogger *l,int c,enum mLogLevel v,const char *f,va_list a)
{(void)l;(void)c;(void)v;(void)f;(void)a;}
static struct mLogger logger={.log=quiet};
static uint32_t u32(const uint8_t *p){return p[0]|p[1]<<8|p[2]<<16|(uint32_t)p[3]<<24;}
static uint16_t u16(const uint8_t *p){return p[0]|p[1]<<8;}
static unsigned long calls,instructions;
static int32_t invoke(struct mCore *c,uint32_t entry,unsigned header,
                      int32_t a,int32_t b,unsigned flags,int32_t step,
                      unsigned axis,int8_t *angle)
{
    struct ARMCore *cpu=c->cpu;
    c->busWrite32(c,0x03005a0c,header);c->busWrite32(c,0x03000408,~0u);
    c->busWrite32(c,0x03000418,~0u);c->busWrite8(c,0x03007100,0x55);
    for(unsigned i=0;i<16;i++)cpu->gprs[i]=0;
    cpu->gprs[0]=a;cpu->gprs[1]=b;cpu->gprs[2]=flags;cpu->gprs[3]=step;
    cpu->gprs[ARM_SP]=0x03007d00;cpu->gprs[ARM_LR]=0x08000001;
    c->busWrite32(c,0x03007d00,0x03007100);
    c->busWrite32(c,0x03007d04,axis?0x0803ff51:0x0803fe11);
    cpu->cpsr.i=1;cpu->cycles=0;cpu->nextEvent=INT_MAX;
    _ARMSetMode(cpu,MODE_THUMB);cpu->gprs[ARM_PC]=entry;ThumbWritePC(cpu);
    unsigned n=0;while((uint32_t)cpu->gprs[ARM_PC]-2!=0x08000000 && n<16000){ARMRun(cpu);n++;}
    if(n==16000){fprintf(stderr,"instruction cap at %08x entry%08x\n",cpu->gprs[ARM_PC],entry);exit(6);}
    instructions+=n;calls++;*angle=c->busRead8(c,0x03007100);return cpu->gprs[0];
}
int main(int argc,char **argv)
{
    if(argc!=4)return 2;mLogSetDefaultLogger(&logger);
    FILE *f=fopen(argv[1],"rb");uint8_t *rom=malloc(8388608);
    if(!f||!rom||fread(rom,1,8388608,f)!=8388608)return 3;fclose(f);
    struct mCore *c=GBACoreCreate();if(!c||!c->init(c))return 4;
    mCoreInitConfig(c,NULL);mCoreConfigSetDefaultIntValue(&c->config,"skipBios",1);
    mCoreConfigSetDefaultIntValue(&c->config,"useBios",0);mCoreLoadConfig(c);
    if(!mCoreLoadFile(c,argv[1]))return 5;c->reset(c);
    f=fopen(argv[2],"rb");if(!f)return 3;unsigned bytes=0;int byte;
    while((byte=fgetc(f))!=EOF){if(bytes>=8192)return 3;c->busWrite8(c,0x02010000+bytes++,byte);}fclose(f);
    unsigned entry=(unsigned)strtoul(argv[3],NULL,0),checked=0;
    uint32_t rng=0x5343414e;
    for(unsigned stage=0;stage<18;stage++){
      unsigned header=u32(rom+0x4a6da4+stage*4);const uint8_t *h=rom+header-0x08000000;
      for(unsigned i=0;i<32;i++)for(unsigned layer=0;layer<2;layer++)
       for(unsigned axis=0;axis<2;axis++)for(unsigned direction=0;direction<2;direction++)for(unsigned suppress=0;suppress<2;suppress++){
        rng=rng*1664525+1013904223;int32_t x=(rng>>4)%u16(h+28);
        rng=rng*1664525+1013904223;int32_t y=(rng>>4)%u16(h+30);
        if(i==0)x=y=0;if(i==1){x=u16(h+28)-1;y=u16(h+30)-1;}
        if(i==2){x=-17;y=-9;}if(i==3){x=u16(h+28)+7;y=u16(h+30)+7;}
        int32_t a=axis?y:x,b=axis?x:y,step=direction?8:-8;
        int8_t originalAngle,recoveredAngle;unsigned flags=layer|(suppress?128:0);
        int32_t original=invoke(c,0x0803fa40,header,a,b,flags,step,axis,&originalAngle);
        int32_t recovered=invoke(c,entry,header,a,b,flags,step,axis,&recoveredAngle);
        if(original!=recovered || originalAngle!=recoveredAngle){
          fprintf(stderr,"mismatch vector%u stage%u axis%u a%d b%d flags%u step%d: native{%d,%d} recovered{%d,%d}\n",checked,stage,axis,a,b,flags,step,original,originalAngle,recovered,recoveredAngle);return 7;
        }checked++;
       }
    }
    printf("{\"outcome\":\"pass\",\"vectors\":%u,\"calls\":%lu,\"thumb_instructions\":%lu,\"stages\":18,\"scope\":\"full scanner/profile/geometry dependency chain; returned distance/angle; no quotient-cache or cycle parity claim\"}\n",checked,calls,instructions);
    c->deinit(c);free(rom);return 0;
}
