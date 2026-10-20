#include "mzm_ripper.h"
/* Own original-ROM live-controller closure:
 * 0801BD8C init,1BDFC patrol entry,1BE1C patrol,1BE88 turn entry,
 * 1BEA8 turn completion,1BEE0 recovery,1BEFC dispatcher;
 * animation policy0800D32C, completion predicates0800FBC8/0800FC00.
 * The common source damage/freeze/death dispatch is an explicit separate
 * dependency, not discarded or claimed recovered by this live controller.
 */
static void animation(MzmRipper *m,unsigned kind)
{m->animation=(uint8_t)kind;m->frame=0;m->tick=0;}
static int ending(const MzmRipper *m,const MzmRipperProfile *p,unsigned advance)
{
    unsigned f=m->frame;if(m->animation>2 || f>=4)return 0;
    return p->durations[m->animation][f]<(uint8_t)(m->tick+advance) && !p->durations[m->animation][f+1];
}
void mzm_ripper_control(MzmRipper *m,const MzmRipperProfile *p,uint8_t terrain_type,uint8_t random_bit)
{
    switch(m->pose){
    case 0:
        m->top=-36;m->bottom=0;m->left=-32;m->right=32;
        m->range_up=16;m->range_down=8;m->range_side=16;
        animation(m,0);m->draw_distance=4;m->hp=p->max_hp;m->y=(uint16_t)(m->y-8);
        if(!(random_bit&1))m->flags|=0x40;else m->flags&=(uint16_t)~0x40;
        m->pose=8;break;
    case 8:m->pose=9;animation(m,0);/* Original dispatcher falls through. */
    case 9:
        if(terrain_type==0x11)m->pose=10;
        else{unsigned speed=m->species==0x17?4:2;m->x=(uint16_t)(m->x+((m->flags&0x40)?(int)speed:-(int)speed));}
        break;
    case 10:m->pose=11;animation(m,1);/* Original dispatcher falls through. */
    case 11:
        if(ending(m,p,1)){m->flags^=0x40;m->pose=12;animation(m,2);}break;
    case 12:if(ending(m,p,2))m->pose=8;break;
    default:break;/* Source common death service is owned by host impact graph. */
    }
}
void mzm_ripper_animate(MzmRipper *m,const MzmRipperProfile *p)
{
    if(m->animation>2 || m->frame>=4)return;
    m->tick=(uint8_t)(m->tick+1);
    if(p->durations[m->animation][m->frame]<m->tick){
        m->tick=1;m->frame++;
        if(!p->durations[m->animation][m->frame])m->frame=0;
    }
}
