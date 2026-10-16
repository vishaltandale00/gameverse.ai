#include "game.h"
/* Authored campaign adapter, not a ROM patch or test teleport. A relay is an
 * already collected cache/recharge point. SELECT+DOWN+LEFT/RIGHT chooses the
 * nearest previously visited ordinary stage; unvisited stages never unlock.
 * The native engine owns scene destruction, fresh start coordinates, terrain,
 * player tasks, render objects, camera and music. Original restart0x0803D55C
 * proves the byte-width cleanup transaction (STRB at0x0803D606/60C/614); fresh-stage0x0803CE20 resets checkpoint/home
 * coordinates through its native0x08046C84 initialization dependency.
 */
void gv_travel_step(GvState *s,GvPlayer *p,uint16_t keys,uint16_t edges)
{
    if(!(edges&4) || !(keys&0x80) || !(keys&0x30) || GV_R8(0x0300505c)!=0 ||
       (p->flags&0x600080))return;
    int near=0,px=gv_px(p->x),py=gv_px(p->y);
    for(unsigned i=0;i<8;i++){
        GvPrefab *f=&s->prefabs[i];if(!f->active)continue;
        int relay=f->kind==GV_RECHARGE || (f->kind==GV_RELIC && (s->picked[s->stage]&(1u<<f->id)));
        if(relay && gv_abs(px-f->x)<24 && gv_abs(py-(f->y-18))<42){near=1;break;}
    }
    if(!near)return;
    int direction=keys&0x20?-1:1,destination=(int)s->stage+direction;
    while(destination>=0 && destination<12 && !(s->visited&(1u<<destination)))destination+=direction;
    if(destination<0 || destination>=12)return;
    s->relay_trips++;s->relay_from=s->stage;s->relay_to=(uint8_t)destination;
    gv_restore_palette(s);
    if(s->tiles)((void (*)(void *))0x08006c35)((void *)(uintptr_t)s->tiles);
    s->tiles=0;s->stage_active=0;s->morph=s->ledge=0;s->last_dead=0;
    GV_R16(0x03005004)|=0x20;
    ((void (*)(uint16_t,uint16_t))0x08001955)(0,0xffff);
    GV_R8(0x03002384)=GV_R8(0x0300211c);
    GV_R8(0x03004c30)=0;GV_R8(0x030045f8)=GV_R8(0x03002324);
    GV_R8(0x0300514c)=(uint8_t)destination;
    ((void (*)(void))0x0803ce21)();
}
