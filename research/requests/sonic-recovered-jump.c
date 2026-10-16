/* Independently recovered USA Sonic Advance jump initializer, ROM
 * 0x0804421C..0x080443FE. Remaining native dependencies are explicit services:
 * head clearance0x08043AA4, sound0x080977E4, pose hitbox0x08045138.
 * Character3 has a distinct down+jump impulse and must retain that branch.
 * No original-source bodies are used. Native parity qualification required.
 */
#include <stdint.h>
typedef struct {
    int32_t x,y;int16_t vx,vy,speed;uint8_t ox,oy;uint32_t flags;
    uint8_t angle,unknown15[0x38-0x15];uint16_t held,pressed;
    uint8_t unknown3c[4];int8_t character_state;uint8_t unknown41[24];
    int8_t character;uint8_t unknown5a[38];uint8_t ability_state;
} SonicRecoveredJumpActor;
static int16_t jump_narrow(int32_t value)
{
    uint16_t b=(uint16_t)(uint32_t)value;
    return b<=32767?(int16_t)b:(int16_t)((int32_t)b-65536);
}
static int32_t jump_asr(int32_t value,unsigned n)
{
    return (int32_t)(((uint32_t)value>>n)|(value<0?(~0u<<(32-n)):0));
}
/* Services are typed ports so the same recovered body can be native-linked or
 * instruction-oracle tested without claiming their implementations recovered. */
typedef int (*SonicHeadClearance)(uint8_t,SonicRecoveredJumpActor *);
typedef void (*SonicPlaySound)(uint16_t);
typedef void (*SonicPoseHitbox)(SonicRecoveredJumpActor *,int);

int sonic_recovered_jump(SonicRecoveredJumpActor *p,uint16_t jump_mask,
                         uint16_t stage_flags,const int16_t *sine,
                         SonicHeadClearance head,SonicPlaySound sound,
                         SonicPoseHitbox hitbox,int ordinary_impulse)
{
    uint8_t angle=p->angle;
    if(!(p->pressed&jump_mask))return 0;
    if(stage_flags&0x80)angle=(uint8_t)(128-angle);
    if(head((uint8_t)(angle+128),p)<=3)return 0;
    p->flags=(((p->flags|2)&0xfeffffdfu)|0x100)&0xfffff7ffu;
    int impulse=0;
    if(p->character>=0 && p->character<=2){
        p->character_state=5;impulse=p->flags&0x40?672:1248;
        /* Authored adapter port:0 retains original arithmetic. A nonzero
         * impulse is permitted only by an outer ordinary-jump authority guard. */
        if(ordinary_impulse)impulse=ordinary_impulse;
    }else if(p->character==3){
        if(!(p->held&0x80)){
            p->character_state=85;impulse=p->flags&0x40?672:1248;
        }else{
            p->character_state=91;
            p->flags=((p->flags&0xfffffdffu)|0x04000000u)&0xfffffeffu;
            p->ability_state=2;
            int horizontal=p->flags&0x40?640:1024;
            impulse=p->flags&0x40?192:320;
            int sign=p->flags&1?-1:1;
            p->vx=jump_narrow(jump_asr(sign*jump_asr(sine[(unsigned)p->angle*4+256],6)*horizontal,8));
            p->vy=jump_narrow(jump_asr(sign*jump_asr(sine[(unsigned)p->angle*4],6)*horizontal,8));
        }
    }
    unsigned index=(unsigned)(uint8_t)(p->angle-64)*4;
    p->vx=jump_narrow((int32_t)p->vx+jump_asr(jump_asr(sine[index+256],6)*impulse,8));
    p->vy=jump_narrow((int32_t)p->vy+jump_asr(jump_asr(sine[index],6)*impulse,8));
    sound(116);
    if(p->character!=3){
        if(!(p->flags&4)){
            p->flags|=4;hitbox(p,9);p->ox=6;p->oy=9;
        }else p->flags|=16;
    }
    return 1;
}

/* Native wrapper is the complete recovered outer jump function. It retains
 * original headroom/contact, animation, hitbox and sound dependencies. */
int sonic_native_jump(SonicRecoveredJumpActor *p,int profile)
{
    uint16_t stage=*(volatile uint16_t *)0x03005004;
    int impulse=0;
    if(profile && !(stage&0x80) && p->character==0 && p->angle==0 &&
       (p->flags&6)==0 && p->speed>=-768 && p->speed<=768 &&
       !(p->flags&(0x800000|0x04000000))){
        /* Own MZM jump initialization0x08006950: normal0xC0 native units;
         * slowed branch0x74. Convert velocity unit1/32→1/256 by8×. */
        impulse=(p->flags&0x40?0x74:0xc0)*8;
    }
    return sonic_recovered_jump(p,*(volatile uint16_t *)0x030060e0,
        stage,(const int16_t *)0x0809b3f0,
        (SonicHeadClearance)0x08043aa5,(SonicPlaySound)0x080977e5,
        (SonicPoseHitbox)0x08045139,impulse);
}
