/* Execute the original casting policy plus its real ROM descriptor/count/slot
 * helpers. Allocation and two animation services are intercepted at explicit
 * dependency boundaries; their internals are NOT qualified by this experiment. */
#include <mgba/core/core.h>
#include <mgba/core/config.h>
#include <mgba/gba/core.h>
#include <mgba/internal/arm/arm.h>
#include <mgba/internal/arm/isa-inlines.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <limits.h>
#include "cast-policy.h"

#define ACTOR 0x02013800u
#define ENTITY 0x02013a00u
static unsigned long instructions, allocations, animations;
static unsigned calls, animation;
static uint32_t allocation_result, effect_arg;
static uint32_t emitted_entry;
static uint16_t rd16(const uint8_t *p) { return p[0] | (uint16_t)p[1]<<8; }
static uint32_t rd32(const uint8_t *p) { return rd16(p) | (uint32_t)rd16(p+2)<<16; }
static void wr16(uint8_t *p,uint16_t v) {p[0]=v;p[1]=v>>8;}
static void wr32(uint8_t *p,uint32_t v) {wr16(p,v);wr16(p+2,v>>16);}
static uint32_t allocate(void *ctx,uint32_t token,uint8_t first,uint8_t last) {
    (void)ctx;
    if(first!=2||last!=16||token!=effect_arg) return 0;
    ++calls;
    return allocation_result;
}
static int emitted(struct mCore *core,const GvAosCastState *s,const GvAosCaster *a) {
    uint8_t input[92]={0};
    memcpy(input,s,44);memcpy(input+44,a,24);
    wr32(input+68,0x02024000);wr32(input+76,0x08000005);
    for(unsigned i=0;i<92;i++)core->busWrite8(core,0x02023000+i,input[i]);
    struct ARMCore *cpu=core->cpu;
    for(unsigned i=0;i<16;i++)cpu->gprs[i]=0;
    cpu->gprs[0]=0x02023000;cpu->gprs[ARM_SP]=0x03007e00;cpu->gprs[ARM_LR]=0x08000001;
    cpu->cpsr.i=1;cpu->cycles=0;cpu->nextEvent=INT_MAX;
    _ARMSetMode(cpu,MODE_THUMB);cpu->gprs[ARM_PC]=emitted_entry;ThumbWritePC(cpu);
    unsigned steps=0;
    while((uint32_t)cpu->gprs[ARM_PC]-2!=0x08000000 && steps<1500) {
        if((uint32_t)cpu->gprs[ARM_PC]-2==0x08000004) {
            if(cpu->gprs[0]!=0||(uint32_t)cpu->gprs[1]!=effect_arg||cpu->gprs[2]!=2||cpu->gprs[3]!=16)return 0;
            cpu->gprs[0]=allocation_result;cpu->gprs[ARM_PC]=cpu->gprs[ARM_LR]&~1u;ThumbWritePC(cpu);
        }else{ARMRun(cpu);++steps;}
    }
    if(steps==1500)return 0;
    return 1;
}
static int original(struct mCore *core,const uint8_t *actor,const GvAosCastState *s,
                    uint8_t out_actor[0x84],GvAosCastState *out,uint8_t entity[0x84]) {
    struct ARMCore *cpu=core->cpu;
    for(unsigned i=0;i<0x84;i++) {core->busWrite8(core,ACTOR+i,actor[i]);core->busWrite8(core,ENTITY+i,0xa5);}
    core->busWrite16(core,0x0200001c,s->held);core->busWrite16(core,0x0200001e,s->pressed);
    core->busWrite16(core,0x02013398,s->attack_button);
    core->busWrite16(core,0x0201327c,(uint16_t)s->mp);
    core->busWrite8(core,0x02013269,s->equipped);core->busWrite8(core,0x020131bf,s->active_type);
    core->busWrite8(core,0x020131be,s->active_count);core->busWrite8(core,0x02013266,0);
    for(unsigned i=0;i<8;i++)core->busWrite32(core,0x02013124+4*i,s->active_slots[i]);
    for(unsigned i=0;i<16;i++)cpu->gprs[i]=0;
    cpu->gprs[0]=ACTOR;cpu->gprs[ARM_SP]=0x03007e00;cpu->gprs[ARM_LR]=0x08000001;
    cpu->cpsr.i=1;cpu->cycles=0;cpu->nextEvent=INT_MAX;
    _ARMSetMode(cpu,MODE_THUMB);cpu->gprs[ARM_PC]=0x08034624;ThumbWritePC(cpu);
    unsigned steps=0;
    while((uint32_t)cpu->gprs[ARM_PC]-2!=0x08000000 && steps<1500) {
        uint32_t pc=cpu->gprs[ARM_PC]-2;
        if(pc==0x08000da0 || pc==0x08021438 || pc==0x08021518) {
            if(pc==0x08000da0) {
                if(cpu->gprs[0]!=2||cpu->gprs[1]!=16||(uint32_t)cpu->gprs[2]!=effect_arg)return 0;
                ++calls;++allocations;cpu->gprs[0]=allocation_result;
            } else {
                if(pc==0x08021438 && ((uint32_t)cpu->gprs[0]!=ACTOR||cpu->gprs[1]!=23||cpu->gprs[2]!=0))return 0;
                if(pc==0x08021518 && cpu->gprs[0]!=2)return 0;
                animation=pc==0x08021438?1:2;++animations;
            }
            cpu->gprs[ARM_PC]=cpu->gprs[ARM_LR]&~1u;ThumbWritePC(cpu);
        } else {ARMRun(cpu);++steps;}
    }
    if(steps==1500)return 0;instructions+=steps;
    for(unsigned i=0;i<0x84;i++){out_actor[i]=core->busRead8(core,ACTOR+i);entity[i]=core->busRead8(core,ENTITY+i);}
    *out=*s;out->mp=(int16_t)core->busRead16(core,0x0201327c);
    out->active_type=core->busRead8(core,0x020131bf);out->active_count=core->busRead8(core,0x020131be);
    for(unsigned i=0;i<8;i++)out->active_slots[i]=core->busRead32(core,0x02013124+4*i);
    return 1;
}
int main(int argc,char **argv) {
    if(argc!=2&&argc!=4)return 2;struct mCore *core=GBACoreCreate();if(!core||!core->init(core))return 3;
    mCoreInitConfig(core,NULL);mCoreConfigSetDefaultIntValue(&core->config,"skipBios",1);
    mCoreConfigSetDefaultIntValue(&core->config,"useBios",0);mCoreLoadConfig(core);
    if(!mCoreLoadFile(core,argv[1]))return 4;core->reset(core);
    if(argc==4){
        FILE *f=fopen(argv[2],"rb");if(!f)return 7;int byte;unsigned count=0;
        while((byte=fgetc(f))!=EOF){if(count>=4096)return 8;core->busWrite8(core,0x02010000+count++,byte);}
        fclose(f);emitted_entry=(uint32_t)strtoul(argv[3],NULL,0);
    }
    GvAosAbility table[56]={0};
    for(unsigned i=0;i<56;i++) {
        uint32_t a=0x080e1598+16*i;
        table[i].effect_token=core->busRead32(core,a);table[i].actor_cast_mode=core->busRead16(core,a+4);
        table[i].mp_cost=(int16_t)core->busRead16(core,a+6);table[i].maximum_active=core->busRead8(core,a+8);
        table[i].descriptor_u16_10=core->busRead16(core,a+10);table[i].metadata=core->busRead32(core,a+12);
        for(unsigned j=0;j<16;j++)core->busWrite8(core,0x02024000+16*i+j,core->busRead8(core,a+j));
    }
    const uint32_t flags[]={0,0x40,0x100,0x400,0x200020,0xffffffff};
    unsigned vectors=0,successes=0;
    for(unsigned ability=0;ability<56;ability++)for(unsigned variation=0;variation<96;variation++) {
        GvAosCastState s={0};s.held=0x40;s.pressed=1;s.attack_button=1;
        s.equipped=ability;s.active_type=ability;s.active_count=0;
        s.mp=table[ability].mp_cost+1;allocation_result=ENTITY;
        uint8_t actor[0x84],native_actor[0x84],entity[0x84];memset(actor,0x5a,sizeof(actor));
        wr32(actor+0x10,0);actor[0xa]=3;actor[0xb]=4;actor[0xd]=5;
        unsigned q=variation%16;
        if(q==0)s.mp=table[ability].mp_cost;
        if(q==1)s.mp=table[ability].mp_cost-1;
        if(q==2)s.mp=32767;
        if(q==3)s.mp=-1;
        if(q==4)s.held=0;
        if(q==5)s.pressed=0;
        if(q==6)s.attack_button=2;
        if(q==7)s.active_type=(ability+1)%56;
        if(q==8){s.active_type=(ability+1)%56;s.active_count=1;}
        if(q==9)s.active_count=table[ability].maximum_active;
        if(q==10)s.active_count=table[ability].maximum_active?table[ability].maximum_active-1:0;
        if(q==11)s.active_count=255;
        if(q==12)allocation_result=0;
        if(q==13)for(unsigned i=0;i<8;i++)s.active_slots[i]=0x02015000+0x84*i;
        if(q==14)for(unsigned i=0;i<7;i++)s.active_slots[i]=0x02015000+0x84*i;
        wr32(actor+0x10,flags[variation/16]);
        GvAosCaster a={.flags=rd32(actor+0x10),.velocity_x=(int32_t)rd32(actor+0x48),
          .velocity_y=(int32_t)rd32(actor+0x50),.acceleration_x=(int32_t)rd32(actor+0x4c),
          .acceleration_y=(int32_t)rd32(actor+0x54),.state=actor[0xa],.substate=actor[0xb],.timer=actor[0xd]};
        GvAosCastState input_state=s;GvAosCaster input_caster=a;
        GvAosCastState native=s;effect_arg=table[ability].effect_token;calls=animation=0;
        if(!original(core,actor,&s,native_actor,&native,entity)){fprintf(stderr,"native failure ability%u variation%u\n",ability,variation);return 5;}
        unsigned original_calls=calls,original_animation=animation;calls=0;
        GvAosCastServices services={.allocate=allocate};GvAosCastResult r=gv_aos_cast(&s,&a,table,&services);
        wr32(actor+0x10,a.flags);wr32(actor+0x48,a.velocity_x);wr32(actor+0x50,a.velocity_y);
        wr32(actor+0x4c,a.acceleration_x);wr32(actor+0x54,a.acceleration_y);
        actor[0xa]=a.state;actor[0xb]=a.substate;actor[0xd]=a.timer;
        uint8_t expected_entity[0x84];memset(expected_entity,0xa5,sizeof(expected_entity));
        if(r.entity){++successes;wr32(expected_entity+0x14,ACTOR);wr16(expected_entity+0x1a,r.slot);
          wr16(expected_entity+0x1c,r.ability);wr16(expected_entity+0x1e,r.inherited_metadata);expected_entity[0x59]|=4;}
        if(memcmp(actor,native_actor,sizeof(actor))||memcmp(&s,&native,sizeof(s))||
           memcmp(entity,expected_entity,sizeof(entity))||calls!=original_calls||r.animation_kind!=original_animation) {
            fprintf(stderr,"mismatch ability%u variation%u state%d actor%d entity%d calls%u/%u animation%u/%u\n",
              ability,variation,memcmp(&s,&native,sizeof(s)),memcmp(actor,native_actor,sizeof(actor)),
              memcmp(entity,expected_entity,sizeof(entity)),calls,original_calls,r.animation_kind,original_animation);return 6;
        }
        if(emitted_entry){
            if(!emitted(core,&input_state,&input_caster))return 9;
            uint8_t state_bytes[44],caster_bytes[24];
            for(unsigned j=0;j<44;j++)state_bytes[j]=core->busRead8(core,0x02023000+j);
            for(unsigned j=0;j<24;j++)caster_bytes[j]=core->busRead8(core,0x02023000+44+j);
            if(memcmp(state_bytes,&s,44)||memcmp(caster_bytes,&a,24)||
               core->busRead32(core,0x02023000+80)!=r.entity||
               core->busRead8(core,0x02023000+84)!=r.slot||
               core->busRead8(core,0x02023000+85)!=r.ability||
               core->busRead8(core,0x02023000+86)!=r.allocation_attempted||
               core->busRead16(core,0x02023000+88)!=r.inherited_metadata||
               core->busRead8(core,0x02023000+90)!=r.animation_kind){
                fprintf(stderr,"emitted mismatch ability%u variation%u\n",ability,variation);return 10;
            }
        }
        ++vectors;
    }
    printf("{\"outcome\":\"passed\",\"vectors\":%u,\"emitted_thumb_vectors\":%u,\"successful_casts\":%u,\"original_thumb_instructions\":%lu,\"allocation_boundary_calls\":%lu,\"animation_boundary_calls\":%lu,\"scope\":\"complete local cast transaction with original descriptor/slot helpers; declared allocator/animation boundary stubs; no projectile or gameplay qualification\"}\n",vectors,emitted_entry?vectors:0,successes,instructions,allocations,animations);
    core->deinit(core);return 0;
}
