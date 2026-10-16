#include "game.h"
GvState *gv_find_state(void)
{
    uint32_t t=GV_R32(0x03001220);
    for(unsigned n=0;n<128 && t>=0x03000000 && t<0x03008000;n++){
        if((GV_R16(t+18)&2) && GV_R16(t+16)==0xff00){
            uint16_t offset=GV_R16(t+6);
            if(offset && offset<0x8000){GvState *s=(GvState *)(uintptr_t)(0x03000000u+offset);if(s->magic==GV_MAGIC)return s;}
        }
        t=0x03000000u+GV_R16(t+4);if(t==0x03000000)break;
    }
    return 0;
}
GvState *gv_ensure_state(void (*callback)(void))
{
    GvState *s=gv_find_state();if(s)return s;
    uint32_t task=(uint32_t)(uintptr_t)((GvTaskCreate)0x08001589)(callback,GV_STATE_BYTES,0xff00,2,0);
    uint16_t offset=GV_R16(task+6);
    if(task==0x030011c0 || !offset || offset+GV_STATE_BYTES>0x8000)return 0;
    s=(GvState *)(uintptr_t)(0x03000000u+offset);gv_zero(s,GV_STATE_BYTES);
    s->magic=GV_MAGIC;s->energy=s->max_energy=99;s->stage=255;s->palette=255;
    return s;
}
void gv_message(GvState *s,unsigned id){s->message=(uint8_t)id;s->story_clock=180;}
