/* Execute actual USA ROM Thumb leaf functions against recovered C.
 * Private synthetic machine states; no gameplay save or ROM writes.
 * Native instruction execution is the oracle, not a second prose-derived model.
 */
#include <mgba/core/core.h>
#include <mgba/core/config.h>
#include <mgba/gba/core.h>
#include <mgba/internal/arm/arm.h>
#include <mgba/internal/arm/isa-inlines.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <limits.h>
#include <stddef.h>
#include "sonic-recovered-motion.c"

static unsigned long calls, instructions;
static int original(struct mCore *core,uint32_t entry,
                    SonicRecoveredMotion *state,uint32_t flags,uint32_t previous)
{
    struct ARMCore *cpu=core->cpu;
    unsigned char *bytes=(unsigned char *)state;
    const uint32_t ram=0x03007000, sentinel=0x08000000;
    for(unsigned i=0;i<sizeof(*state);i++)core->busWrite8(core,ram+i,bytes[i]);
    core->busWrite16(core,0x03005004,flags);
    core->busWrite16(core,0x0300502c,previous);
    for(unsigned i=0;i<16;i++)cpu->gprs[i]=0;
    cpu->gprs[0]=ram;cpu->gprs[ARM_SP]=0x03007e00;
    cpu->gprs[ARM_LR]=sentinel|1;
    cpu->cpsr.i=1;cpu->cycles=0;cpu->nextEvent=INT_MAX;
    _ARMSetMode(cpu,MODE_THUMB);cpu->gprs[ARM_PC]=entry;ThumbWritePC(cpu);
    unsigned n=0;
    while((uint32_t)cpu->gprs[ARM_PC]-2!=sentinel && n<256){ARMRun(cpu);n++;}
    if(n==256){fprintf(stderr,"instruction limit at%08x\n",entry);return 0;}
    calls++;instructions+=n;
    for(unsigned i=0;i<sizeof(*state);i++)bytes[i]=core->busRead8(core,ram+i);
    return 1;
}
static void compare(const char *label,const SonicRecoveredMotion *a,
                    const SonicRecoveredMotion *b,unsigned input)
{
    if(memcmp(a,b,sizeof(*a))){
        fprintf(stderr,"mismatch %s case%u: orig{%d,%d,%d,%d,%d} recovered{%d,%d,%d,%d,%d}\n",
          label,input,a->x,a->y,a->vx,a->vy,a->ground_speed,b->x,b->y,b->vx,b->vy,b->ground_speed);
        exit(7);
    }
}
int main(int argc,char **argv)
{
    if(argc!=2 || offsetof(SonicRecoveredMotion,surface_angle)!=20)return 2;
    struct mCore *core=GBACoreCreate();
    if(!core||!core->init(core))return 3;
    mCoreInitConfig(core,NULL);mCoreConfigSetDefaultIntValue(&core->config,"skipBios",1);
    mCoreConfigSetDefaultIntValue(&core->config,"useBios",0);mCoreLoadConfig(core);
    if(!mCoreLoadFile(core,argv[1]))return 4;
    core->reset(core);
    FILE *rom=fopen(argv[1],"rb");int16_t table[1280];
    if(!rom||fseek(rom,0x9b3f0,SEEK_SET)||fread(table,2,1280,rom)!=1280)return 5;
    fclose(rom);
    int16_t speeds[]={INT16_MIN,-2304,-768,-1,0,1,768,2304,INT16_MAX};
    unsigned checked=0;
    for(unsigned angle=0;angle<256;angle++)for(unsigned j=0;j<9;j++){
        SonicRecoveredMotion input={0};input.surface_angle=angle;input.ground_speed=speeds[j];
        SonicRecoveredMotion a=input,b=input;
        if(!original(core,0x08047078,&a,0,0))return 6;
        sonic_recovered_surface_projection(&b,table);compare("projection",&a,&b,checked++);
        a=b=input;if(!original(core,0x08046f78,&a,0,0))return 6;
        sonic_recovered_slope_acceleration(&b,table);compare("slope",&a,&b,checked++);
    }
    for(unsigned angle=0;angle<256;angle++)for(unsigned j=0;j<9;j++)
      for(unsigned locked=0;locked<3;locked++)for(unsigned special=0;special<2;special++){
        SonicRecoveredMotion a={0};a.surface_angle=angle;a.ground_speed=speeds[j];
        a.slope_lock=locked==2?-1:locked;a.flags=special?0x800:0;
        SonicRecoveredMotion b=a;if(!original(core,0x080471a0,&a,0,0))return 6;
        sonic_recovered_surface_detach(&b);compare("detach",&a,&b,checked++);
    }
    for(unsigned j=0;j<9;j++)for(unsigned water=0;water<2;water++){
        SonicRecoveredMotion a={0};a.vy=speeds[j];a.flags=water?0x40:0;
        SonicRecoveredMotion b=a;if(!original(core,0x08047100,&a,0,0))return 6;
        sonic_recovered_gravity(&b);compare("gravity",&a,&b,checked++);
    }
    for(unsigned j=0;j<9;j++)for(unsigned k=0;k<9;k++)for(unsigned mode=0;mode<4;mode++){
        SonicRecoveredMotion a={0};a.x=INT32_MAX-128;a.y=INT32_MIN+128;
        a.vx=speeds[j];a.vy=speeds[k];SonicRecoveredMotion b=a;
        unsigned f=mode&1?0x80:0,prev=mode&2?0x80:0;
        if(!original(core,0x080470b4,&a,f,prev))return 6;
        sonic_recovered_integrate(&b,f,prev);compare("integrate",&a,&b,checked++);
    }
    printf("{\"outcome\":\"pass\",\"vectors\":%u,\"original_rom_calls\":%lu,\"original_thumb_instructions\":%lu,\"scope\":\"five leaf functions only; finite vectors, not exhaustive equivalence\"}\n",checked,calls,instructions);
    core->deinit(core);return 0;
}
