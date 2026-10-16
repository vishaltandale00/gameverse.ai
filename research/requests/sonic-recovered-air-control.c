/* Own USA Sonic ROM recovery. Air steering0x0804456C..0x0804463C;
 * release/air-ability dispatcher0x0804463C..0x08044716. The native character
 * ability bodies remain explicit pinned host services, not recovered here. */
#include <stdint.h>
typedef struct {
    int32_t x,y;int16_t vx,vy,speed;uint8_t offsets[2];uint32_t flags;
    uint8_t angle,unknown15[23];int32_t max_speed,acceleration,deceleration;
    uint16_t held,pressed;uint8_t unknown3c,ability_used,action_state,action_timer;
    int8_t character_state;uint8_t unknown41[24];int8_t character;
} SonicRecoveredAir;
static int16_t air_narrow(int32_t value)
{
    uint16_t b=(uint16_t)(uint32_t)value;
    return b<=32767?(int16_t)b:(int16_t)((int32_t)b-65536);
}
static int32_t air_asr5(int32_t value)
{
    return (int32_t)(((uint32_t)value>>5)|(value<0?0xf8000000u:0));
}
void sonic_recovered_air_control(SonicRecoveredAir *p)
{
    if(p->character_state==15)return;
    if(!(p->flags&16)){
        int16_t velocity=p->vx;int32_t cap=p->max_speed;
        if(p->held&0x20){
            if(p->character_state!=23)p->flags|=1;
            velocity=air_narrow((int32_t)velocity-p->acceleration*2);
            cap=-cap;
            if(velocity<cap){
                velocity=air_narrow((int32_t)velocity+p->acceleration*2);
                if(velocity>cap)velocity=air_narrow(cap);
            }
        }else if(p->held&0x10){
            if(p->character_state!=23)p->flags&=~1u;
            velocity=air_narrow((int32_t)velocity+p->acceleration*2);
            if(velocity>cap){
                velocity=air_narrow((int32_t)velocity-p->acceleration*2);
                if(velocity<cap)velocity=air_narrow(cap);
            }
        }
        p->vx=velocity;
    }
    if((uint16_t)p->vy>=0xbd00){
        int32_t drag=air_asr5(p->vx),velocity=(int32_t)p->vx-drag;
        if(drag<0){if(velocity>0)velocity=0;p->vx=air_narrow(velocity);}
        else if(drag>0){if(velocity<0)velocity=0;p->vx=air_narrow(velocity);}
    }
}
typedef void (*SonicAirAbility)(SonicRecoveredAir *);
void sonic_recovered_release(SonicRecoveredAir *p,uint16_t jump_mask,
                             uint8_t game_mode,const SonicAirAbility ability[3])
{
    int16_t cap=p->flags&0x40?-384:-768;
    if(!(p->flags&0x100)){
        if(!(p->flags&0x200) && p->vy<-3024)p->vy=-3024;
    }else if(p->vy<cap){
        if(!(p->held&jump_mask))p->vy=cap;
    }else if(game_mode!=6 && !p->ability_used && (p->pressed&jump_mask) &&
             p->character_state!=15){
        p->flags&=~16u;p->ability_used=1;
        if(p->character>=0 && p->character<=2)ability[(unsigned)p->character](p);
    }
}
void sonic_native_release(SonicRecoveredAir *p)
{
    const SonicAirAbility abilities[]={
        (SonicAirAbility)0x080478ad,(SonicAirAbility)0x08047ff1,
        (SonicAirAbility)0x08048115};
    sonic_recovered_release(p,*(volatile uint16_t *)0x030060e0,
        *(volatile uint8_t *)0x0300505c,abilities);
}
