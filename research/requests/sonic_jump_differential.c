/* Original full jump function vs emitted recovered Thumb, both using the
 * actual native clearance/pose/sound services and identical private snapshot.
 * This is not a model mock; no ROM instruction bytes are altered. */
#include <mgba/core/core.h>
#include <mgba/core/config.h>
#include <mgba/core/log.h>
#include <mgba/core/serialize.h>
#include <mgba/gba/core.h>
#include <mgba/internal/arm/arm.h>
#include <mgba/internal/arm/isa-inlines.h>
#include <mgba-util/vfs.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <limits.h>
#include <fcntl.h>
#include <stdarg.h>
static void quiet(struct mLogger *l,int c,enum mLogLevel v,const char *f,va_list a)
{(void)l;(void)c;(void)v;(void)f;(void)a;}
static struct mLogger logger={.log=quiet};
static unsigned long instructions,calls;
static unsigned invoke(struct mCore *c,const void *state,const unsigned char *code,
                       unsigned codeSize,unsigned entry,unsigned angle,unsigned flags,
                       unsigned held,int character,unsigned pressed,unsigned stage,
                       unsigned char result[144])
{
    if(!c->loadState(c,state)){fprintf(stderr,"state restore failed\n");exit(5);}
    for(unsigned i=0;i<codeSize;i++)c->busWrite8(c,0x0203f000+i,code[i]);
    const uint32_t p=0x03005a20;
    c->busWrite8(c,p+20,angle);c->busWrite32(c,p+16,flags);
    c->busWrite16(c,p+56,held);c->busWrite16(c,p+58,pressed);
    c->busWrite8(c,p+89,character);c->busWrite16(c,0x03005004,stage);
    c->busWrite16(c,0x030060e0,1);
    struct ARMCore *cpu=c->cpu;memset(cpu->gprs,0,sizeof(cpu->gprs));
    cpu->gprs[0]=p;cpu->gprs[1]=0;cpu->gprs[ARM_SP]=0x03007d00;
    cpu->gprs[ARM_LR]=0x08000001;cpu->cpsr.i=1;cpu->cycles=0;cpu->nextEvent=INT_MAX;
    _ARMSetMode(cpu,MODE_THUMB);cpu->gprs[ARM_PC]=entry;ThumbWritePC(cpu);
    unsigned n=0;while((uint32_t)cpu->gprs[ARM_PC]-2!=0x08000000 && n<10000){ARMRun(cpu);n++;}
    if(n==10000){fprintf(stderr,"instruction cap at %08x entry%08x\n",cpu->gprs[ARM_PC],entry);exit(6);}
    for(unsigned i=0;i<144;i++)result[i]=c->busRead8(c,p+i);
    instructions+=n;calls++;return cpu->gprs[0];
}
int main(int argc,char **argv)
{
    if(argc!=5)return 2;mLogSetDefaultLogger(&logger);
    struct mCore *c=GBACoreCreate();if(!c||!c->init(c))return 3;
    mCoreInitConfig(c,NULL);mCoreConfigSetDefaultIntValue(&c->config,"skipBios",1);
    mCoreConfigSetDefaultIntValue(&c->config,"useBios",0);mCoreLoadConfig(c);
    if(!mCoreLoadFile(c,argv[1]))return 4;c->reset(c);
    struct VFile *vf=VFileOpen(argv[2],O_RDONLY);
    if(!vf||!mCoreLoadStateNamed(c,vf,0)){fprintf(stderr,"checkpoint load failed\n");return 5;}
    vf->close(vf);void *state=malloc(c->stateSize(c));if(!state||!c->saveState(c,state))return 5;
    FILE *f=fopen(argv[3],"rb");unsigned char code[4096];unsigned size=f?fread(code,1,sizeof(code),f):0;
    if(!f||!size||size==4096)return 7;fclose(f);unsigned entry=(unsigned)strtoul(argv[4],NULL,0);
    unsigned angles[]={0,16,64,128,240},flagsets[]={0,1,4,0x40,0x44};
    unsigned checked=0,jumped=0,blocked=0;
    for(unsigned a=0;a<5;a++)for(unsigned fl=0;fl<5;fl++)for(unsigned h=0;h<2;h++)
      for(int ch=-1;ch<4;ch++)for(unsigned press=0;press<2;press++)for(unsigned inv=0;inv<2;inv++){
        unsigned char original[144],recovered[144];
        unsigned x=invoke(c,state,code,size,0x0804421c,angles[a],flagsets[fl],h?128:0,ch,press,inv?128:0,original);
        unsigned y=invoke(c,state,code,size,entry,angles[a],flagsets[fl],h?128:0,ch,press,inv?128:0,recovered);
        if(x!=y||memcmp(original,recovered,144)){
          fprintf(stderr,"mismatch vector%u angle%u flags%x held%u char%d press%u inv%u return%u/%u\n",checked,angles[a],flagsets[fl],h,ch,press,inv,x,y);
          for(unsigned i=0;i<144;i++)if(original[i]!=recovered[i])fprintf(stderr," offset%u: %02x/%02x\n",i,original[i],recovered[i]);return 8;
        }
        checked++;if(x)jumped++;else blocked++;
      }
    printf("{\"outcome\":\"pass\",\"vectors\":%u,\"jumped\":%u,\"blocked_or_no_input\":%u,\"original_plus_emitted_calls\":%lu,\"thumb_instructions\":%lu,\"scope\":\"full jump entry, 144 actor bytes and return; actual native clearance/pose/sound; one private early-stage snapshot\"}\n",checked,jumped,blocked,calls,instructions);
    c->deinit(c);free(state);return 0;
}
