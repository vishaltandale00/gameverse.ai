#include "game.h"
/* USA callback recovered from 0x080454D8. Character dispatch, death flow,
 * render and item timers retain their original ordered native services. The
 * new component scheduler is inserted between native input and control. */
static void call_actor(uint32_t address,GvPlayer *p){((GvNativeVoidActor)(uintptr_t)(address|1))(p);}
void gv_native_input(void *actor)
{
    GvPlayer *p=actor;uint16_t old=p->held,raw=GV_R16(0x03001b50);
    unsigned mode=GV_R8(0x0300505c);
    if(mode<2 || ((GV_R16(0x04000128)&0x3f)>>4)==GV_R8(0x03005a0a)){
        if(!(p->flags&0x200000)){
            p->held=raw;
            if(mode>1 && (GV_R8((uintptr_t)p+0x26)&0x40)){
                unsigned rotate=(GV_R16((uintptr_t)p+0x22)+GV_R32(0x03005120))&3;if(!rotate)rotate=1;
                unsigned d=((raw&0xf0)>>4)<<rotate;
                p->held=(raw&0xff0f)|(((d&15) | ((d&255)>>4))<<4);
                if(--GV_R16((uintptr_t)p+0x22)==0)GV_R8((uintptr_t)p+0x26)&=~0x40u;
            }
            ((void (*)(unsigned))0x0804d109)(p->held);
        }else ((void (*)(unsigned))0x0804d109)(0);
    }else {p->held=0;old=0;((void (*)(unsigned))0x0804d109)(0);}
    /* Explicit control bridge: B/R/L/Select belong to weapons/aim, not the
     * retained Sonic spin-dash/character special input policy. */
    if(GV_R8(0x0300514c)!=13)p->held&=~(2u|4u|0x100u|0x200u);p->pressed=(old^p->held)&p->held;
    if(p->held&0x30)p->held&=~0xc0u;if(p->pressed&0x30)p->pressed&=~0xc0u;
}
void gv_native_player(void)
{
    GvPlayer *p=GV_PLAYER;GvState *s=gv_ensure_state(gv_game_task);if(s)s->control_steps++;
    if(!(p->flags&0x80)){
        if(s && (!s->stage_active || s->stage!=GV_R8(0x0300514c))){gv_stage_begin(s,p);s->stage_active=1;}
        gv_native_input(p);call_actor(0x08044a38,p);
        if(s){uint16_t keys=GV_R16(0x03001b50);gv_movement_step(s,p,keys,keys&~s->old_keys);}
        if(!(p->flags&0x400000)){
            static const uint32_t controllers[4]={0x08047379,0x08047b6d,0x08048fcd,0x08049779};
            if((unsigned)p->character<4)call_actor(controllers[(unsigned)p->character],p);
        }
    }else{
        GV_R32(GV_R32(0x03001f90)+8)=0x080453e5;p->pose=1;p->vx=0;p->iframe=2;
        GV_R8((uintptr_t)p+0x26)=0;p->flags&=0xffffffd7;GV_R16((uintptr_t)p+0x28)=0;
        GV_R16(0x030059f6)|=3;if(GV_R8(0x0300505c)<2)GV_R16(0x03005004)|=1;
        GV_R32(p->sprite+0x1c)=(GV_R32(p->sprite+0x1c)&0xffffcfff)|0x1000;
        GV_R16((uintptr_t)p+0x54)=GV_R16((uintptr_t)p+0x56)=0x100;
        ((void (*)(unsigned))0x080978b1)(0x1c);((void (*)(unsigned))0x080978b1)(0x1b);((void (*)(unsigned))0x080978b1)(0x78);
        gv_sound((int8_t)GV_R8((uintptr_t)p+0x5a)<0?0xc0:0x77);
    }
    if(s && s->morph && !(p->flags&0x80)){gv_pose(p,9);p->ox=6;p->oy=9;p->flags|=4;p->pose=6;}
    ((void (*)(void *,void *))0x08045fd5)(p,(void *)(uintptr_t)p->sprite);
    ((void (*)(void *,void *))0x080462c9)(p,(void *)(uintptr_t)p->sprite);
    ((void (*)(void *,void *))0x08046ac1)(p,(void *)(uintptr_t)p->secondary_sprite);
    if(p->pose!=15 && p->iframe>0)p->iframe--;
    uint8_t *effects=(uint8_t *)p+0x26;
    if(*effects&4){if(--GV_R16((uintptr_t)p+0x20)==0){((void (*)(unsigned,unsigned))0x08098765)(0x02002540,0x100);*effects&=~4u;}}
    if(*effects&0x10){if(--GV_R16((uintptr_t)p+0x20)==0){((void (*)(unsigned,unsigned))0x08098765)(0x02002540,0x100);*effects&=~0x10u;}}
    if(*effects&2){if(--GV_R16((uintptr_t)p+0x1e)==0){*effects&=~2u;((void (*)(unsigned))0x080978b1)(0x1c);}}
    if(*effects&0x20){if(--GV_R16((uintptr_t)p+0x24)==0){*effects&=~0x20u;GV_R16(0x030020e0)&=0x7fff;GV_R8(0x03001b3a)=0x3f;}}
}
void gv_native_vram_reset(void)
{
    for(unsigned i=0;i<256;i++)GV_R16(0x03004a30+i*2)=0;
    GvState *s=gv_find_state();if(s){gv_restore_palette(s);s->tiles=s->mzm_tiles=0;}
}
void gv_game_task(void)
{
    GvState *s=gv_find_state();if(!s)return;GvPlayer *p=GV_PLAYER;
    unsigned task=p->task;
    int active=task>=0x03000000 && task<0x03008000 && GV_R32(task+8)==0x080454d9 && GV_R8(0x0300514c)<18;
    if((p->flags&0x80) && task>=0x03000000 && task<0x03008000){
        if(!s->last_dead){s->last_dead=1;s->deaths++;}
        /* Native USA restart0x0803D55C decrements0x03005024 and enters
         * GameOver at0. The Metroid recovery contract replaces limited lives
         * with unlimited beacon retries through the SAME native restart. */
        if(GV_R8(0x0300505c)<2 && GV_R8(0x03005024)<3)GV_R8(0x03005024)=3;
    }
    if(!active){s->stage_active=0;gv_draw_game(s,0);return;}
    if(s->control_steps==s->observed_steps){gv_draw_game(s,0);return;}
    s->observed_steps=s->control_steps;
    if(!s->stage_active || s->stage!=GV_R8(0x0300514c)){gv_stage_begin(s,p);s->stage_active=1;}
    s->frame++;if(s->frozen_support)s->frozen_support--;uint16_t keys=GV_R16(0x03001b50),edges=keys&~s->old_keys;
    gv_tick_components(s,p,keys,edges);
    if(!s->stage_active)return; /* A native relay scene transaction completed. */
    if(!(p->flags&0x80)){
        /* A collected ability remains a discoverable recharge point on return.
         * The final region's signal is resolved by its last alien guardian. */
        if(s->stage>=12 && (s->opened[s->stage]&0x80) && s->message!=14)gv_message(s,14);
    }
    s->old_keys=keys;if(s->story_clock)s->story_clock--;
}
