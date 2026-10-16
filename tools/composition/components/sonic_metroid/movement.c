#include "game.h"
/* Recovered components are linked from their pinned packages, not copied or
 * patched for each variant. These signatures describe their native ABI. */
extern int sonic_native_jump(void *,int);
extern void sonic_recovered_air_control(void *);
extern void sonic_native_release(void *);
extern void sonic_recovered_gravity(void *);
extern void sonic_recovered_integrate(void *,uint32_t,uint32_t);
extern void sonic_metroid_hybrid_gravity(void *,uint32_t);
extern void sonic_metroid_hybrid_integrate(void *,uint32_t,uint32_t);
extern int32_t sonic_native_head_clearance(uint32_t,void *);
static int ordinary(GvState *s,GvPlayer *p)
{return s && !s->momentum && !(GV_R16(0x03005004)&128) && (p->flags&0x100) && p->pose==5 && p->angle==0;}
void gv_movement_step(GvState *s,GvPlayer *p,uint16_t keys,uint16_t edges)
{
    /* Own-ROM moving-handle controller0x08087640 sets flags0x400008 while
     * attached and releases into native5px upward/2px horizontal launch.
     * Attachment is an explicit transfer of motion authority. Keep that
     * launch's original tangent/gravity/release until normal ground arrest;
     * otherwise the precision controller silently halves its reachable arc. */
    if((p->flags&0x400008)==0x400008)s->momentum=1;
    int grounded=!(p->flags&2);
    if(grounded){
        if(!p->angle && gv_abs(p->speed)<64)s->momentum=0;
        if(p->angle || gv_abs(p->speed)>768)s->momentum=1;
        if((keys&0x30) && !(keys&0x200)){if(s->run_clock<120)s->run_clock++;}else s->run_clock=0;
        if(!s->momentum && (p->flags&6)==0){p->max_speed=768;p->acceleration=64;p->deceleration=64;}
        /* A sustained run transfers to native Sonic flow BEFORE the ramp. Waiting
         * until nonzero ground angle stranded the first-draft bot at a halfpipe.
         * Ordinary short movements retain Metroid-like precision; campaign
         * momentum never depends on a later upgrade. Speed raises that ceiling. */
        if(s->run_clock>=40 && !s->morph){p->max_speed=1536;p->acceleration=32;s->momentum=1;}
        if((s->upgrades&GV_SPEED) && s->run_clock>=60){p->max_speed=2560;p->acceleration=64;s->momentum=1;}
    }
    if((s->upgrades&GV_MORPH) && (edges&0x80) && grounded && !p->angle && !(keys&0x200))s->morph=1;
    if(s->morph){
        if((edges&0x40) && sonic_native_head_clearance(128,p)>7){s->morph=0;gv_pose(p,14);p->oy=14;p->flags&=~4u;}
        else{gv_pose(p,9);p->ox=6;p->oy=9;p->flags|=4;p->pose=6;p->pressed&=~1u;}
    }
    if(keys&0x200){p->held&=~0x30u;if(grounded){p->speed=0;p->vx=0;}}
    /* A Sonic launch retains its authority while moving. A real wall arrest
     * with zero tangent velocity and explicit L+A transfers to precision;
     * otherwise a spring-fed vertical shaft could permanently retain FLOW
     * while neither native running nor the Metroid wall kick could escape it.
     * Never make this transfer on a loop, moving launch, or attached object. */
    unsigned side=keys&0x20?64:keys&0x10?192:0;
    if(!grounded && s->momentum && !p->angle && !p->speed &&
       gv_abs(p->vx)<128 && (keys&0x200) && (edges&1) && !(p->flags&0x400080) && side &&
       sonic_native_head_clearance(side,p)<4)s->momentum=0;
    if(!grounded && !s->momentum && !s->morph && !(p->flags&0x80)){
        if(side && sonic_native_head_clearance(side,p)<4){
            if(edges&1){p->vx=side==64?768:-768;p->vy=-1536;p->flags|=0x106;p->pose=5;p->pressed&=~1u;s->ledge=0;s->wall_kicks++;gv_sound(0x74);}
            else if((s->upgrades&GV_HIGH) && p->vy>=0 && !gv_is_solid(gv_px(p->x)+(side==64?-12:12),gv_px(p->y)-24)){
                if(!s->ledge){s->ledge_x=p->x;s->ledge_y=p->y;s->ledge=1;s->ledge_grabs++;}
            }
        }
    }
    if(s->ledge){
        p->x=s->ledge_x;p->y=s->ledge_y;p->vx=p->vy=0;
        if(edges&1){p->y-=24*256;p->x+=(p->flags&1?-12:12)*256;p->vy=-768;s->ledge=0;}
        else if(keys&0x80)s->ledge=0;
    }
}
int32_t gv_native_jump(void *actor)
{
    GvPlayer *p=actor;GvState *s=gv_find_state();
    int adapt=s && !s->momentum && !p->angle && !(GV_R16(0x03005004)&128) && gv_abs(p->speed)<=768 && p->character==0;
    int result=sonic_native_jump(p,0);
    if(result && adapt){int wanted=p->flags&0x40?0x74*8:(s->upgrades&GV_HIGH)?0xe8*8:0xc0*8;
        p->vy-=(int16_t)(wanted-(p->flags&0x40?672:1248));}
    return result;
}
void gv_native_air_control(void *actor)
{
    GvPlayer *p=actor;GvState *s=gv_find_state();
    if(!ordinary(s,p)){sonic_recovered_air_control(p);return;}
    if(p->pose==15)return;
    if(p->held&0x20){p->flags|=1;p->vx-=64;if(p->vx<-512)p->vx=-512;}
    else if(p->held&0x10){p->flags&=~1u;p->vx+=64;if(p->vx>512)p->vx=512;}
    else if(p->vx>0){p->vx-=64;if(p->vx<0)p->vx=0;}
    else if(p->vx<0){p->vx+=64;if(p->vx>0)p->vx=0;}
}
void gv_native_release(void *actor)
{
    GvPlayer *p=actor;GvState *s=gv_find_state();
    if(!ordinary(s,p)){sonic_native_release(p);return;}
    /* Own MZM release block0x08008DD4: releasedjump and positive(upward)
     * vertical velocity stores zero. Sonic frame uses+Ydown, hence vy<0. */
    if(!(p->held&1) && p->vy<0)p->vy=0;
}
void gv_native_gravity(void *actor,uint32_t stage)
{
    GvState *s=gv_find_state();
    if(s && s->momentum)sonic_recovered_gravity(actor);else sonic_metroid_hybrid_gravity(actor,stage);
}
void gv_native_integrate(void *actor,uint32_t stage,uint32_t prior)
{
    GvState *s=gv_find_state();
    if(s && s->momentum)sonic_recovered_integrate(actor,stage,prior);else sonic_metroid_hybrid_integrate(actor,stage,prior);
}
