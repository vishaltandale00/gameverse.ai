/* Own USA Zero Mission instruction recovery, not an imported source body.
 * Reviewed ranges: 0x08008278..0x080082B6 and basic block
 * 0x0800A5E8..0x0800A62A -> 0x0800A640..0x0800A646.
 * Position is in quarter pixels. Velocity is in 1/32 pixel/frame,
 * positive Y velocity is upward. The native block integrates OLD velocity
 * before storing gravity's new velocity; preserving that order matters.
 */
#include <stdint.h>
typedef struct {
    uint8_t unknown_00[14];
    uint16_t direction;
    uint8_t unknown_10[2];
    uint16_t x, y;
    int16_t vx, vy;
} MzmRecoveredMotion;

static int16_t mzm_narrow16(int32_t v)
{
    uint16_t b=(uint16_t)(uint32_t)v;
    return b<=32767 ? (int16_t)b : (int16_t)((int32_t)b-65536);
}
static int32_t mzm_asr3(int32_t v)
{
    return (int32_t)(((uint32_t)v>>3) | (v<0 ? 0xe0000000u : 0));
}

/* Actual leaf ABI: r0=acceleration, r1=cap, r2=actor. Native halfword
 * truncation happens BEFORE signed cap comparison, including overflow. */
void mzm_recovered_accelerate(int16_t acceleration, int16_t cap,
                             MzmRecoveredMotion *p)
{
    if(p->direction&0x10){
        p->vx=mzm_narrow16((int32_t)p->vx+acceleration);
        if(p->vx>cap)p->vx=cap;
    }else{
        p->vx=mzm_narrow16((int32_t)p->vx-acceleration);
        if(p->vx<-(int32_t)cap)p->vx=mzm_narrow16(-(int32_t)cap);
    }
}

/* Recovered ordinary airborne block only: the caller selects eligible poses.
 * Other poses, slope integration, collision and animations are NOT included. */
void mzm_recovered_vertical(MzmRecoveredMotion *p, int16_t gravity,
                            int16_t upward_cap, int16_t downward_cap)
{
    int32_t displacement=p->vy;
    if(displacement>upward_cap)displacement=upward_cap;
    else if(displacement<-(int32_t)downward_cap)displacement=-(int32_t)downward_cap;
    if(p->vy>=-231)p->vy=mzm_narrow16((int32_t)p->vy-gravity);
    p->y=(uint16_t)((uint32_t)p->y-(uint32_t)mzm_asr3(displacement));
}
