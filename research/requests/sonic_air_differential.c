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
    c->busWrite8(c,p+20,0);
    int16_t velocities[]={-32768,-3025,-1248,-769,-768,-384,-1,0,1,768,1248,32767};
    c->busWrite16(c,p+8,velocities[angle%12]);c->busWrite16(c,p+10,velocities[(angle/12)%12]);
    c->busWrite32(c,p+44,768);c->busWrite32(c,p+48,64);
    c->busWrite8(c,p+64,(angle/144)%3==0?5:(angle/144)%3==1?15:23);
    c->busWrite8(c,p+61,0);c->busWrite32(c,p+16,flags);
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
    if(argc<5)return 2;mLogSetDefaultLogger(&logger);
    struct mCore *c=GBACoreCreate();if(!c||!c->init(c))return 3;
    mCoreInitConfig(c,NULL);mCoreConfigSetDefaultIntValue(&c->config,"skipBios",1);
    mCoreConfigSetDefaultIntValue(&c->config,"useBios",0);mCoreLoadConfig(c);
    if(!mCoreLoadFile(c,argv[1]))return 4;c->reset(c);
    struct VFile *vf=VFileOpen(argv[2],O_RDONLY);
    if(!vf||!mCoreLoadStateNamed(c,vf,0)){fprintf(stderr,"checkpoint load failed\n");return 5;}
    vf->close(vf);void *state=malloc(c->stateSize(c));if(!state||!c->saveState(c,state))return 5;
    FILE *f=fopen(argv[3],"rb");unsigned char code[4096];unsigned size=f?fread(code,1,sizeof(code),f):0;
    if(!f||!size||size==4096)return 7;fclose(f);unsigned entry=(unsigned)strtoul(argv[4],NULL,0);
    unsigned checked=0;
    unsigned originalEntry=argc>5?0x0804463c:0x0804456c;
    unsigned flagsets[]={0,1,4,16,0x106,0x146,0x206};
    for(unsigned v=0;v<432;v++)for(unsigned fl=0;fl<7;fl++)for(unsigned h=0;h<4;h++){
        unsigned char original[144],recovered[144];
        unsigned held=h==0?0:h==1?0x10:h==2?0x20:1;
        unsigned x=invoke(c,state,code,size,originalEntry,v,flagsets[fl],held,0,0,0,original);
        unsigned y=invoke(c,state,code,size,entry,v,flagsets[fl],held,0,0,0,recovered);
        (void)x;(void)y;
        if(memcmp(original,recovered,144)){
          fprintf(stderr,"mismatch vector%u v%u flags%x held%u\n",checked,v,flagsets[fl],held);
          for(unsigned i=0;i<144;i++)if(original[i]!=recovered[i])fprintf(stderr," offset%u: %02x/%02x\n",i,original[i],recovered[i]);return 8;
        }checked++;
    }
    unsigned abilityVectors=0;
    if(argc>5)for(int character=0;character<4;character++)
      for(unsigned water=0;water<2;water++)for(unsigned speed=0;speed<3;speed++){
        unsigned char original[144],recovered[144];
        unsigned vector=7*12+(speed==0?0:speed==1?7:11);
        unsigned flags=water?0x146:0x106;
        invoke(c,state,code,size,originalEntry,vector,flags,1,character,1,0,original);
        invoke(c,state,code,size,entry,vector,flags,1,character,1,0,recovered);
        if(memcmp(original,recovered,144)){
          fprintf(stderr,"ability mismatch character%d water%u speed%u\n",character,water,speed);
          for(unsigned i=0;i<144;i++)if(original[i]!=recovered[i])fprintf(stderr," offset%u: %02x/%02x\n",i,original[i],recovered[i]);return 9;
        }
        checked++;abilityVectors++;
      }
    printf("{\"outcome\":\"pass\",\"vectors\":%u,\"ability_vectors\":%u,\"calls\":%lu,\"thumb_instructions\":%lu,\"original_entry\":%u,\"scope\":\"144 actor bytes; actual native character abilities invoked, their full spawned-task state is not compared\"}\n",checked,abilityVectors,calls,instructions,originalEntry);
    c->deinit(c);free(state);return 0;
}
