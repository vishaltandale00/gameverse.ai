#include "game.h"
int gv_damage_player(GvState *s,GvPlayer *p,unsigned damage)
{
    if(!s || s->iframe || p->iframe>0 || p->invincible>0 || (p->flags&0x80))return 0;
    if(s->upgrades&GV_VARIA)damage=damage*8/10;
    if(!damage)damage=1;
    s->energy=s->energy>damage?s->energy-damage:0;s->damage_taken+=damage;
    s->iframe=60;p->iframe=60;
    p->vx=p->vx<0 || (!p->vx && (p->flags&1))?384:-384;
    p->vy=p->flags&0x40?-384:-768;
    p->flags=(p->flags&0xfffffac3u)|2;p->pose=15;gv_pose(p,14);p->ox=6;p->oy=14;
    p->ability_used=p->action=p->action_timer=0;s->morph=s->ledge=0;
    gv_sound(0x77);
    if(!s->energy){p->flags|=0x80;s->last_dead=1;s->deaths++;}
    return 1;
}
int32_t gv_native_hurt(void *actor)
{
    return gv_damage_player(gv_find_state(),actor,20);
}
void gv_make_drop(GvState *s,int x,int y,unsigned kind,unsigned amount)
{
    for(unsigned i=0;i<6;i++)if(!s->drops[i].life){
        s->drops[i]=(GvDrop){x*256,y*256,480,(uint8_t)kind,(uint8_t)amount};return;
    }
}
void gv_resources_step(GvState *s,GvPlayer *p)
{
    if(s->iframe)s->iframe--;
    int px=gv_px(p->x),py=gv_px(p->y);
    for(unsigned i=0;i<6;i++){
        GvDrop *d=&s->drops[i];if(!d->life)continue;d->life--;
        if(gv_abs(gv_px(d->x)-px)<18 && gv_abs(gv_px(d->y)-py)<24){
            if(d->kind==1){unsigned n=s->energy+d->amount;s->energy=n>s->max_energy?s->max_energy:n;}
            else{unsigned n=s->missiles+d->amount;s->missiles=n>s->max_missiles?s->max_missiles:n;}
            d->life=0;gv_sound(0x6c);
        }
    }
    if(p->flags&0x80)s->last_dead=1;
    else if(s->last_dead){s->last_dead=0;s->energy=s->max_energy;s->missiles=s->max_missiles;s->iframe=120;gv_zero(s->shots,sizeof(s->shots));gv_message(s,12);}
}
