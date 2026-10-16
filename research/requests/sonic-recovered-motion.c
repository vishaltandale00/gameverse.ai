/* Independently reconstructed from USA Sonic Advance ROM instructions.
 * ROM SHA1 d842afa7dd1e84de08addb94a51506f1bcafd551.
 * No community game-source bodies are used here. This is a small recovered
 * arithmetic package, NOT a complete game or a claim of binary equivalence.
 * Evidence/boundaries/dependencies: sonic-self-decomp-evidence.json.
 */
#include <stdint.h>

typedef struct {
    int32_t x, y;                 /* native offsets 0,4: Q24.8 world position */
    int16_t vx, vy, ground_speed;  /* offsets 8,10,12: Q8.8/frame */
    uint8_t unknown_0e[2];
    uint32_t flags;               /* offset16, only reviewed bits named below */
    uint8_t surface_angle;        /* offset20: 256 steps/turn */
    uint8_t unknown_15[5];
    int16_t slope_lock;           /* offset26: native detach/control timer */
} SonicRecoveredMotion;

/* Explicit arithmetic shift avoids implementation-defined negative >> in C.
 * All callers below use shifts <31 and products safely inside int32 range. */
static int32_t asr32(int32_t value, unsigned shift)
{
    uint32_t bits=(uint32_t)value;
    if (!shift) return value;
    return (int32_t)((bits>>shift) | (value<0 ? (~0u<<(32-shift)) : 0));
}
static int16_t narrow16(int32_t value)
{
    uint16_t bits=(uint16_t)(uint32_t)value;
    return bits<=32767 ? (int16_t)bits : (int16_t)((int32_t)bits-65536);
}

/* 0x080470B4..0x08047100, Thumb: world +Y is downward. Caller owns
 * collision corrections; this function does not resolve terrain. */
void sonic_recovered_integrate(SonicRecoveredMotion *p,
                              uint32_t stage_flags, uint32_t previous_flags)
{
    p->x=(int32_t)((uint32_t)p->x+(uint32_t)(int32_t)p->vx);
    if ((stage_flags^previous_flags)&0x80)
        p->vy=narrow16(-(int32_t)p->vy);
    p->y=(int32_t)((uint32_t)p->y + (uint32_t)(
        stage_flags&0x80 ? -(int32_t)p->vy : (int32_t)p->vy));
}

/* 0x08047100..0x0804711A, Thumb. Bit0x40 of actor flags selects the
 * slower acceleration branch; water interpretation has separate evidence. */
void sonic_recovered_gravity(SonicRecoveredMotion *p)
{
    p->vy=narrow16((int32_t)p->vy+(p->flags&0x40 ? 12 : 42));
}

/* 0x08047078..0x080470AE, Thumb. sin_q14 points to ROM0x0809B3F0.
 * Cosine uses the same table +256 entries, so dependency includes1280 i16s.
 * Preserve shifts BEFORE multiply, then narrow AFTER the final shift. */
void sonic_recovered_surface_projection(SonicRecoveredMotion *p,
                                       const int16_t *sin_q14)
{
    unsigned index=(unsigned)p->surface_angle*4;
    p->vx=narrow16(asr32((int32_t)p->ground_speed *
                        asr32(sin_q14[index+256],6),8));
    p->vy=narrow16(asr32((int32_t)p->ground_speed *
                        asr32(sin_q14[index],6),8));
}

/* 0x08046F78..0x08046FB0, Thumb. Native attached-surface acceleration.
 * This operation is retained under the human's Sonic ramp/loop authority. */
void sonic_recovered_slope_acceleration(SonicRecoveredMotion *p,
                                      const int16_t *sin_q14)
{
    if ((uint8_t)(p->surface_angle+0x60)<0xc0 && p->ground_speed)
        p->ground_speed=narrow16((int32_t)p->ground_speed+
            asr32(asr32(sin_q14[(unsigned)p->surface_angle*4],6)*3,5));
}

/* 0x080471A0..0x080471EC, Thumb. Steep-surface low-speed detachment.
 * The literal threshold at0x080471EC is a separate data dependency. */
void sonic_recovered_surface_detach(SonicRecoveredMotion *p)
{
    int32_t magnitude=p->ground_speed;
    if(p->flags&0x800)return;
    if(p->slope_lock){p->slope_lock=narrow16((int32_t)p->slope_lock-1);return;}
    if(((p->surface_angle+0x20)&0xc0)==0)return;
    if(magnitude<0)magnitude=-magnitude;
    if(magnitude>0x1df)return;
    p->ground_speed=0;p->flags|=2;p->slope_lock=30;
}
