/* Original USA ROM instructions are the oracle, including a deliberately
 * bounded basic-block entry/exit for vertical integration. No ROM mutation. */
#include <mgba/core/core.h>
#include <mgba/core/config.h>
#include <mgba/gba/core.h>
#include <mgba/internal/arm/arm.h>
#include <mgba/internal/arm/isa-inlines.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <limits.h>
#include "metroid-recovered-motion.c"
static unsigned long calls,instructions;
static int oracle(struct mCore *core,MzmRecoveredMotion *p,int vertical,
                  int16_t acceleration,int16_t cap,int16_t down)
{
    struct ARMCore *cpu=core->cpu;
    const uint32_t actor=0x03007000,context=0x03007200;
    for(unsigned i=0;i<sizeof(*p);i++)core->busWrite8(core,actor+i,((uint8_t *)p)[i]);
    core->busWrite16(core,context+98,acceleration);
    core->busWrite16(core,context+100,cap);
    core->busWrite16(core,context+102,down);
    memset(cpu->gprs,0,sizeof(cpu->gprs));
    cpu->gprs[0]=acceleration;cpu->gprs[1]=cap;cpu->gprs[2]=actor;
    cpu->gprs[3]=context;cpu->gprs[4]=actor;
    cpu->gprs[ARM_SP]=0x03007e00;cpu->gprs[ARM_LR]=0x08000001;
    cpu->cpsr.i=1;cpu->cycles=0;cpu->nextEvent=INT_MAX;
    _ARMSetMode(cpu,MODE_THUMB);cpu->gprs[ARM_PC]=vertical?0x0800a5e8:0x08008278;ThumbWritePC(cpu);
    unsigned n=0;uint32_t end=vertical?0x0800a646:0x08000000;
    while((uint32_t)cpu->gprs[ARM_PC]-2!=end && n<128){ARMRun(cpu);n++;}
    if(n==128){fprintf(stderr,"instruction cap at %08x\n",cpu->gprs[ARM_PC]);return 0;}
    for(unsigned i=0;i<sizeof(*p);i++)((uint8_t *)p)[i]=core->busRead8(core,actor+i);
    calls++;instructions+=n;return 1;
}
int main(int argc,char **argv)
{
    if(argc!=2)return 2;
    struct mCore *core=GBACoreCreate();if(!core||!core->init(core))return 3;
    mCoreInitConfig(core,NULL);mCoreConfigSetDefaultIntValue(&core->config,"skipBios",1);
    mCoreConfigSetDefaultIntValue(&core->config,"useBios",0);mCoreLoadConfig(core);
    if(!mCoreLoadFile(core,argv[1]))return 4;core->reset(core);
    int16_t speeds[]={-32768,-32767,-1024,-232,-231,-230,-192,-128,-1,0,1,64,96,128,192,193,32766,32767};
    int16_t accelerations[]={-32768,-64,-1,0,1,4,8,16,32767};
    int16_t caps[]={-32768,-1,0,1,48,64,96,160,32767};
    unsigned checked=0;
    for(unsigned v=0;v<sizeof(speeds)/2;v++)for(unsigned a=0;a<sizeof(accelerations)/2;a++)
      for(unsigned c=0;c<sizeof(caps)/2;c++)for(unsigned dir=0;dir<2;dir++){
        MzmRecoveredMotion p={0};p.vx=speeds[v];p.direction=dir?0x10:0;
        MzmRecoveredMotion expected=p;
        if(!oracle(core,&p,0,accelerations[a],caps[c],0))return 5;
        mzm_recovered_accelerate(accelerations[a],caps[c],&expected);
        if(memcmp(&p,&expected,sizeof(p))){fprintf(stderr,"acceleration mismatch v%d a%d c%d dir%u: %d/%d\n",speeds[v],accelerations[a],caps[c],dir,p.vx,expected.vx);return 6;}checked++;
      }
    int16_t gravities[]={0,5,10,32767};int16_t ups[]={0,40,192,32767};int16_t downs[]={0,40,128,32767};
    for(unsigned v=0;v<sizeof(speeds)/2;v++)for(unsigned g=0;g<4;g++)
      for(unsigned u=0;u<4;u++)for(unsigned d=0;d<4;d++)for(unsigned y=0;y<2;y++){
        MzmRecoveredMotion p={0};p.vy=speeds[v];p.y=y?65535:0;MzmRecoveredMotion expected=p;
        if(!oracle(core,&p,1,gravities[g],ups[u],downs[d]))return 5;
        mzm_recovered_vertical(&expected,gravities[g],ups[u],downs[d]);
        if(memcmp(&p,&expected,sizeof(p))){fprintf(stderr,"vertical mismatch v%d g%d u%d d%d y%u: y%u/%u vy%d/%d\n",speeds[v],gravities[g],ups[u],downs[d],y,p.y,expected.y,p.vy,expected.vy);return 7;}checked++;
      }
    printf("{\"outcome\":\"pass\",\"vectors\":%u,\"original_rom_calls\":%lu,\"original_thumb_instructions\":%lu,\"scope\":\"one leaf and one ordinary-airborne basic block; finite vectors\"}\n",checked,calls,instructions);
    core->deinit(core);return 0;
}
