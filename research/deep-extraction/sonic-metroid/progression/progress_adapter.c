#include "progress_adapter.h"
#include "generated/mzm_progress/events/component.h"
/* Six source sprite IDs are exact 080138d8 cases. Morph/missile are NEW
 * composition events64/65; source event operations are reused, but their
 * meanings here are authored (the source games use these IDs differently).
 * The private bank never aliases source-game memory or save storage. */
typedef struct {uint8_t sprite,event,lane,mask;} Reward;
static const Reward rewards[8]={
 {0,64,0,0},{0,65,0,0},
 {0x29,9,1,0x80},{0x2d,18,2,1},{0x25,10,1,2},
 {0x31,19,2,0x10},{0x2b,11,2,2},{0x2f,21,2,8}
};
uint8_t gv_progress_event(GvProgressState *s,uint32_t event,uint8_t operation)
{
    /* Explicit copy joins the two generated collection ABIs without type
     * punning or creating two independently persistent event banks. */
    gv_mzm_events_State e;
    for(unsigned i=0;i<8;i++)e.collection_0[i]=s->dependency_0_collection_0[i];
    uint8_t result=gv_mzm_events(&e,event,operation);
    for(unsigned i=0;i<8;i++)s->dependency_0_collection_0[i]=e.collection_0[i];
    return result;
}
uint32_t gv_progress_owned(GvProgressState *s)
{
    uint32_t owned=0;
    for(unsigned i=0;i<8;i++){
        const Reward *r=&rewards[i];
        unsigned bits=r->lane==1?s->field_0:s->field_1;
        if(gv_progress_event(s,r->event,3) && (!r->lane || (bits&r->mask)))owned|=1u<<i;
    }
    return owned;
}
int gv_progress_acquire_reward(GvProgressState *s,unsigned reward)
{
    if(reward>=8)return 0;
    const Reward *r=&rewards[reward];
    if(gv_progress_event(s,r->event,3))return 0;
    if(r->lane)gv_mzm_acquire(s,r->sprite);
    else gv_progress_event(s,r->event,1);
    return (gv_progress_owned(s)&(1u<<reward))!=0;
}
