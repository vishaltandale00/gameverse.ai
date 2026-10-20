#include "game.h"
#include "../../../../local/composition-assets/mzm-flyer-02/assets.h"
/* Authored host adapter: real recovered controller uses quarter-pixel world
 * coordinates, unsigned16 domain0..16383px. Sonic keeps Q8; displacement is
 * converted exactly64x and its fractional position remainder survives. Native
 * terrain plane/geometry supplies the original controller's collision port.
 * New spawn entropy is explicit; the original RNG sequence is not imported. */
/* Optional authored habitat boundaries are geometry inputs to the original
 * terrain-classification port. They never reverse velocity/skip turn states.
 * The world IR marks their span; native physical terrain remains authoritative
 * when present. Zero radius means native geometry only. */
unsigned gv_ripper_radius(const GvState *s,const GvAlien *a)
{
    const GvStageSpec *stage=&gv_stages[s->stage];
    for(unsigned i=0;i<stage->count;i++)if(stage->prefabs[i].kind==GV_ALIEN && stage->prefabs[i].param==GV_RIPPER && stage->prefabs[i].id==a->id)return stage->prefabs[i].reserved*8u;
    return 0;
}
void gv_ripper_step(GvState *s,GvAlien *a,unsigned index)
{
    MzmRipper *m=&s->rippers[index];
    if(!m->species){gv_zero(m,sizeof(*m));m->species=0x16;m->flags=1;m->x=(uint16_t)(a->x/64);m->y=(uint16_t)(a->y/64);}
    m->hp=a->hp;uint16_t before_x=m->x,before_y=m->y;
    int direction=m->flags&0x40?1:-1;
    unsigned radius=gv_ripper_radius(s,a);int probe_x=gv_px(a->x)+direction*9;
    unsigned habitat_wall=radius && gv_abs(probe_x-gv_px(a->home_x))>(int)radius;
    unsigned terrain=(habitat_wall || gv_is_solid(probe_x,gv_px(a->y)-4))?0x11:0;
    MzmRipperProfile profile={20,gv_mzm_flyer_durations};
    mzm_ripper_control(m,&profile,(uint8_t)terrain,(uint8_t)(s->frame+a->id));
    mzm_ripper_animate(m,&profile);
    a->x+=(int16_t)(m->x-before_x)*64;a->y+=(int16_t)(m->y-before_y)*64;
    a->hp=m->hp;a->state=m->pose;a->vx=(m->flags&0x40)?128:-128;s->mzm_ripper_steps++;
}
/* Own-ROM vulnerability0x0064 (descriptor082B0D68+0x16*0x12) and ice handler
 * 08050724: no ordinary beam damage; vulnerability0x40 freezes240 without
 * changing HP. Native missile20 is also blocked (no bit8). The existing
 * authored Screw/body bridge owns that separately declared attack path. */
int gv_ripper_hit(GvState *s,GvAlien *a)
{
    int x=gv_px(a->x),y=gv_px(a->y)-4;
    for(unsigned i=0;i<8;i++){
        GvShot *q=&s->shots[i];if(!q->life || q->kind==GV_ENEMY_SHOT)continue;
        if(gv_abs(gv_px(q->x)-x)>12 || gv_abs(gv_px(q->y)-y)>8)continue;
        q->life=0;s->shots_hit++;
        if((s->upgrades&GV_ICE) && (q->kind==GV_BEAM || q->kind==GV_CHARGED)){a->freeze=240;return 1;}
        gv_sound(0x7f);return 0;
    }
    return 0;
}
