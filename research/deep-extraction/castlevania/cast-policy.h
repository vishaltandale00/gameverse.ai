#ifndef GV_AOS_CAST_POLICY_H
#define GV_AOS_CAST_POLICY_H
#include <stdint.h>

/* Stable, explicit gameplay interface. Native adapters translate these records;
 * a descriptor's effect_token is a selected entity component, not executable
 * authority to dereference an arbitrary imported ROM address. */
typedef struct {
    uint32_t effect_token;
    uint16_t actor_cast_mode;
    int16_t mp_cost;
    uint8_t maximum_active, reserved;
    uint16_t descriptor_u16_10; /* meaning not established by this policy */
    uint32_t metadata;
} GvAosAbility;

typedef struct {
    uint32_t flags;
    int32_t velocity_x, velocity_y, acceleration_x, acceleration_y;
    uint8_t state, substate, timer;
} GvAosCaster;

typedef struct {
    uint16_t held, pressed, attack_button;
    int16_t mp;
    uint8_t equipped, active_type, active_count;
    uint32_t active_slots[8];
} GvAosCastState;

typedef struct {
    uint32_t entity;
    uint8_t slot, ability, allocation_attempted;
    uint16_t inherited_metadata;
    uint8_t animation_kind;
} GvAosCastResult;

typedef uint32_t (*GvAosAllocate)(void *context, uint32_t effect_token,
                                uint8_t first_pool_slot, uint8_t last_pool_slot);
typedef struct { void *context; GvAosAllocate allocate; } GvAosCastServices;

/* One call processes one already-sampled input event. This is not a projectile
 * update, ability acquisition rule, animation renderer or complete player tick.
 * Precondition: equipped and active_type identify entries in the provided table;
 * the character is the ordinary branch, whose table was recovered here. */
GvAosCastResult gv_aos_cast(GvAosCastState *, GvAosCaster *,
                          const GvAosAbility *, const GvAosCastServices *);
typedef struct {
    GvAosCastState state;
    GvAosCaster caster;
    const GvAosAbility *table;
    GvAosCastServices services;
    GvAosCastResult result;
} GvAosCastContext;
#if UINTPTR_MAX == UINT32_MAX
_Static_assert(sizeof(GvAosAbility) == 16, "ability table ABI");
_Static_assert(sizeof(GvAosCastState) == 44, "cast state ABI");
_Static_assert(sizeof(GvAosCaster) == 24, "caster state ABI");
_Static_assert(sizeof(GvAosCastContext) == 92, "cast context ABI v1");
#endif
/* One explicit versioned context port for native component assembly. */
void gv_aos_cast_step(GvAosCastContext *);
#endif
