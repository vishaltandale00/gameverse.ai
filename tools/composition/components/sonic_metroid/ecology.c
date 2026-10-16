#include "game.h"
static void hostile_shot(GvState *s,GvAlien *a,GvPlayer *p)
{
    for(unsigned i=0;i<8;i++)if(!s->shots[i].life){
        int dx=p->x<a->x?-512:512;
        s->shots[i]=(GvShot){a->x,a->y-4*256,(int16_t)dx,0,90,GV_ENEMY_SHOT,20};return;
    }
}
static void defeat(GvState *s,GvAlien *a,int x,int y)
{
    int renewable=a->active==2;
    a->active=0;s->alien_kills++;gv_sound(0x7f);
    if(renewable){a->state=128;a->clock=120;}
    else s->opened[s->stage]|=(uint16_t)(1u<<a->id);
    gv_make_drop(s,x,y,s->alien_kills%3==0?2:1,s->alien_kills%3==0?2:20);
    if(a->species==GV_GUARDIAN){s->opened[s->stage]|=(uint16_t)(1u<<a->id);gv_message(s,11);}
}

void gv_ecology_step(GvState *s,GvPlayer *p)
{
    for(unsigned i=0;i<8;i++){
        GvAlien *a=&s->aliens[i];
        if(!a->active){
            /* Freeze-platform dependencies are renewable populations, not
             * permanent once-only rewards. Killing the tutorial prey cannot
             * remove the only way through its gate. State128 is a timed
             * despawn phase; active2 is the explicit renewable population. */
            if(a->state&128){if(a->clock)a->clock--;else{gv_zero(&s->mzm_alien[i],sizeof(s->mzm_alien[0]));a->active=2;a->state=0;a->hp=6;a->freeze=0;a->vx=0;a->x=a->home_x;a->y=(int32_t)a->home_y*256;}}
            if(!a->active)continue;
        }
        int x=gv_px(a->x),y=gv_px(a->y),px=gv_px(p->x),py=gv_px(p->y);
        if(gv_abs(x-px)>360)continue;
        int hit=gv_hit_shots_state(s,x,y,a->species==GV_GUARDIAN?18:10,a->species==GV_GUARDIAN?22:10,
                            &a->hp,&a->freeze,a->species==GV_GUARDIAN && a->state==0?8|16:2|8|16,&s->mzm_alien[i]);
        if(hit==2){defeat(s,a,x,y);continue;}
        if(a->freeze){
            a->freeze--;
            if(p->vy>=0 && gv_abs(px-x)<20 && py+p->oy>=y-10 && py+p->oy<=y+8){
                p->y=(y-10-p->oy)*256;p->vy=0;p->flags&=~2u;p->speed=p->vx;p->angle=0;s->frozen_support=90;
            }
            continue;
        }
        a->clock++;
        if(a->species==GV_CRAWLER){
            if(!a->vx)a->vx=128;
            int nx=gv_px(a->x+a->vx),floor=gv_floor_y(nx,y+9,24);
            if(gv_abs(floor-y-9)>12 || gv_is_solid(nx+(a->vx>0?9:-9),y))a->vx=-a->vx;
            else{a->x+=a->vx;a->y=(floor-9)*256;}
            if(gv_abs(a->x-a->home_x)>96*256)a->vx=-a->vx;
        }else if(a->species==GV_FLYER){
            if(!a->vx)a->vx=160;
            if(a->state==0){
                a->x+=a->vx;if(gv_abs(a->x-a->home_x)>64*256)a->vx=-a->vx;
                a->y+=(a->clock&32)?64:-64;
                if(gv_abs(x-px)<96 && a->clock>60){a->state=1;a->clock=0;}
            }else if(a->clock<20){if(a->clock&4)a->y-=32;}
            else if(a->clock<52){a->vx=px<x?-384:384;a->x+=a->vx;a->y+=512;}
            else{a->y-=320;if(a->clock>90){a->state=0;a->clock=0;a->x=a->home_x;a->vx=160;a->y=(int32_t)a->home_y*256;}}
        }else if(a->species==GV_PIRATE){
            /* Patrol → aim telegraph → fire → reposition, authored adapter of
             * the source-readable threat/cue pattern, not an imported AI body. */
            if(a->clock%120<60){a->vx=px<x?-128:128;a->x+=a->vx;a->y=(gv_floor_y(gv_px(a->x),y+12,24)-12)*256;a->state=0;}
            else{a->state=1;if(a->clock%120==84)hostile_shot(s,a,p);}
        }else{
            /* Staged guardian: armored telegraph, exposed beam window, volley.
             * This is a new campaign prefab using explicit MZM damage/weapon
             * vulnerabilities; the retained Eggman campaign bosses also remain. */
            unsigned phase=a->clock%180;a->state=phase>=60 && phase<125;
            if(phase==140 || phase==156)hostile_shot(s,a,p);
            if(a->hp<20 && a->clock%30==0)hostile_shot(s,a,p);
        }
        x=gv_px(a->x);y=gv_px(a->y);
        if(gv_abs(x-px)<(a->species==GV_GUARDIAN?22:16) && gv_abs(y-py)<(a->species==GV_GUARDIAN?30:20)){
            if((s->upgrades&GV_SCREW) && (p->flags&4) && (p->flags&2)){
                gv_apply_impact(s,&s->mzm_alien[i],&a->hp,a->hp);defeat(s,a,x,y);
            }else gv_damage_player(s,p,a->species==GV_GUARDIAN?30:15);
        }
    }
}
