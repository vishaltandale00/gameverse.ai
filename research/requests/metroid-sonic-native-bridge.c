/* Partial native composition: independently recovered MZM airborne arithmetic
 * on the retained Sonic USA campaign. This is deliberately a movement backend
 * milestone, not a completed ecology/weapon/progression mashup.
 * Sources and typed authority limits are pinned in the adjacent package.
 */
#include "sonic-recovered-motion.c"
#include "metroid-recovered-motion.c"

/* No persistent scratch RAM, no SRAM extension and no actor-structure growth.
 * Boundary is conservative and stateless: a native ordinary flat jump, Sonic
 * character, without inherited speed >3px/frame or gravity inversion. Native
 * jump initializer proves flags0x100 and charstate5, but this finite guard has
 * not been proven sufficient for all campaign routes/external impulses.
 */
static int hybrid_ordinary_jump(const SonicRecoveredMotion *p,uint32_t stage)
{
    const uint8_t *actor=(const uint8_t *)p;
    return !(stage&0x80) && (p->flags&0x100) &&
        (p->flags&6)==6 && actor[64]==5 && actor[89]==0 &&
        p->surface_angle==0 && p->vx>=-768 && p->vx<=768;
}

/* ABI conversion is exact for representable multiples of8. Preserve Sonic's
 * fractional remainder rather than repeatedly quantizing velocity. MZM's
 * actual recovered vertical block supplies the gravity state transition;
 * displacement is implemented separately below in Sonic's finer position unit.
 */
void sonic_metroid_hybrid_gravity(SonicRecoveredMotion *p,uint32_t stage)
{
    if(!hybrid_ordinary_jump(p,stage)){sonic_recovered_gravity(p);return;}
    int16_t before=(int16_t)-asr32(p->vy,3);
    int32_t remainder=(int32_t)p->vy+(int32_t)before*8;
    MzmRecoveredMotion m={0};m.vy=before;
    int slowed=(p->flags&0x40)!=0;
    mzm_recovered_vertical(&m,slowed?5:10,slowed?40:192,slowed?40:128);
    p->vy=narrow16(-(int32_t)m.vy*8+remainder);
}

/* Native Sonic integrates before adding gravity, as does MZM's recovered
 * ordinary-air block. MZM clamps displacement, not stored velocity. Keeping
 * these as distinct phases avoids changing Sonic spring/loop impulses.
 * Adaptation intentionally retains 1/256px precision instead of MZM's1/4px
 * position quantization; this is a declared bridge, not binary equivalence.
 */
void sonic_metroid_hybrid_integrate(SonicRecoveredMotion *p,
                                  uint32_t stage,uint32_t previous)
{
    if(!hybrid_ordinary_jump(p,stage)){
        sonic_recovered_integrate(p,stage,previous);return;
    }
    int16_t original=p->vy;
    int slowed=(p->flags&0x40)!=0;
    int32_t upward=(slowed?40:192)*8,downward=(slowed?40:128)*8;
    if(p->vy < -upward)p->vy=(int16_t)-upward;
    else if(p->vy>downward)p->vy=(int16_t)downward;
    sonic_recovered_integrate(p,stage,previous);
    p->vy=original;
}
