#include "game.h"
/* The behavior below is the emitted address-free original-ROM L1 core, not a
 * copied arithmetic substitute. Host position/vulnerability/drop/animation
 * ownership remains explicit. All unknown split fields survive per instance;
 * field8 is rebound to one shared campaign context as in the original global.
 */
uint32_t gv_apply_impact(GvState *s,gv_mzm_impact_State *effect,uint16_t *hp,uint16_t damage)
{
    effect->field_0=*hp;effect->field_8=s->mzm_context_counter;
    uint32_t death=gv_mzm_impact(effect,damage);
    *hp=effect->field_0;s->mzm_context_counter=effect->field_8;
    s->mzm_impact_calls++;if(death)s->mzm_impact_deaths++;
    return death;
}
