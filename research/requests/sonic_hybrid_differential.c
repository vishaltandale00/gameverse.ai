/* Bridge qualification uses two immutable carts as separate instruction
 * oracles. It tests emitted contract semantics, not campaign-wide safety. */
#include <mgba/core/core.h>
#include <mgba/core/config.h>
#include <mgba/gba/core.h>
#include <mgba/internal/arm/arm.h>
#include <mgba/internal/arm/isa-inlines.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <limits.h>
#include "metroid-sonic-native-bridge.c"
typedef union { SonicRecoveredMotion p; uint8_t bytes[96]; } Actor;
static unsigned long instructions,calls;
static struct mCore *load(const char *path)
{
    struct mCore *c=GBACoreCreate();if(!c||!c->init(c))exit(3);
    mCoreInitConfig(c,NULL);mCoreConfigSetDefaultIntValue(&c->config,"skipBios",1);
    mCoreConfigSetDefaultIntValue(&c->config,"useBios",0);mCoreLoadConfig(c);
    if(!mCoreLoadFile(c,path))exit(4);c->reset(c);return c;
}
static void enter(struct mCore *c,uint32_t pc,uint32_t stop)
{
    struct ARMCore *cpu=c->cpu;cpu->gprs[ARM_SP]=0x03007e00;cpu->gprs[ARM_LR]=0x08000001;
    cpu->cpsr.i=1;cpu->cycles=0;cpu->nextEvent=INT_MAX;
    _ARMSetMode(cpu,MODE_THUMB);cpu->gprs[ARM_PC]=pc;ThumbWritePC(cpu);
    unsigned n=0;while((uint32_t)cpu->gprs[ARM_PC]-2!=stop && n<256){ARMRun(cpu);n++;}
    if(n==256){fprintf(stderr,"instruction limit\n");exit(5);}calls++;instructions+=n;
}
static void sonic(struct mCore *c,Actor *a,int gravity,unsigned stage,unsigned prior)
{
    struct ARMCore *cpu=c->cpu;memset(cpu->gprs,0,sizeof(cpu->gprs));
    for(unsigned i=0;i<96;i++)c->busWrite8(c,0x03007000+i,a->bytes[i]);
    c->busWrite16(c,0x03005004,stage);c->busWrite16(c,0x0300502c,prior);
    cpu->gprs[0]=0x03007000;enter(c,gravity?0x08047100:0x080470b4,0x08000000);
    for(unsigned i=0;i<96;i++)a->bytes[i]=c->busRead8(c,0x03007000+i);
}
static int16_t metroid(struct mCore *c,int16_t vy,int slowed)
{
    struct ARMCore *cpu=c->cpu;memset(cpu->gprs,0,sizeof(cpu->gprs));
    for(unsigned i=0;i<26;i++)c->busWrite8(c,0x03007000+i,0);
    c->busWrite16(c,0x03007018,vy);c->busWrite16(c,0x03007262,slowed?5:10);
    c->busWrite16(c,0x03007264,slowed?40:192);c->busWrite16(c,0x03007266,slowed?40:128);
    cpu->gprs[3]=0x03007200;cpu->gprs[4]=0x03007000;enter(c,0x0800a5e8,0x0800a646);
    return (int16_t)c->busRead16(c,0x03007018);
}
int main(int argc,char **argv)
{
    if(argc!=3)return 2;struct mCore *s=load(argv[1]),*m=load(argv[2]);
    unsigned checked=0,adapted=0,bypassed=0;
    int16_t v[]={-32768,-1856,-1536,-1248,-769,-768,-1,0,1,767,768,769,1024,1848,1856,32767};
    unsigned flagsets[]={0,2,4,6,0x106,0x146,0x906};
    for(unsigned i=0;i<16;i++)for(unsigned j=0;j<16;j++)for(unsigned f=0;f<7;f++)
      for(unsigned mode=0;mode<8;mode++){
        Actor input={0};input.p.x=0x7fffff80;input.p.y=-0x7fffff80;
        input.p.vx=v[i];input.p.vy=v[j];input.p.flags=flagsets[f];
        input.p.surface_angle=mode&1?16:0;input.bytes[64]=mode&2?15:5;
        input.bytes[89]=mode&4?1:0;
        for(unsigned inv=0;inv<2;inv++){
          unsigned stage=inv?0x80:0,prior=0;
          int eligible=!inv && f>=4 && f<=6 && !(mode&7) && v[i]>=-768 && v[i]<=768;
          Actor expected=input,actual=input;
          if(eligible){
            int16_t original=expected.p.vy;int up=f==5?320:1536,down=f==5?320:1024;
            if(expected.p.vy < -up)expected.p.vy=-up;else if(expected.p.vy>down)expected.p.vy=down;
            sonic(s,&expected,0,stage,prior);expected.p.vy=original;adapted++;
          }else{sonic(s,&expected,0,stage,prior);bypassed++;}
          sonic_metroid_hybrid_integrate(&actual.p,stage,prior);
          if(memcmp(&expected,&actual,sizeof(actual))){fprintf(stderr,"integrate mismatch case%u\n",checked);return 6;}checked++;
          actual=expected=input;
          if(eligible){
            int q=input.p.vy/8;if(input.p.vy<0 && input.p.vy%8)q--;
            int16_t native=metroid(m,(int16_t)-q,f==5);
            expected.p.vy=narrow16(-(int32_t)native*8+(input.p.vy-q*8));
          }else sonic(s,&expected,1,stage,prior);
          sonic_metroid_hybrid_gravity(&actual.p,stage);
          if(memcmp(&expected,&actual,sizeof(actual))){fprintf(stderr,"gravity mismatch case%u: %d/%d\n",checked,expected.p.vy,actual.p.vy);return 7;}checked++;
        }
      }
    printf("{\"outcome\":\"pass\",\"vectors\":%u,\"original_rom_calls\":%lu,\"original_thumb_instructions\":%lu,\"adapted_pairs\":%u,\"bypassed_pairs\":%u,\"scope\":\"two-cart arithmetic bridge; authority predicate not a campaign proof\"}\n",checked,calls,instructions,adapted,bypassed);
    s->deinit(s);m->deinit(m);return 0;
}
