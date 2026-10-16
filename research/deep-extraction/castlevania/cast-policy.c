#include "cast-policy.h"

/* Independently reconstructed from USA ROM 0x08034624..0x0803479e.
 * Callbacks previously hidden inside the engine are explicit service/results.
 * Preserve the surprising native rules: MP must EXCEED the cost; changing the
 * selected type with no active effect commits before later checks can fail;
 * allocation installs a slot but does not increment active_count in this phase. */
GvAosCastResult gv_aos_cast(GvAosCastState *s, GvAosCaster *a,
                          const GvAosAbility *table,
                          const GvAosCastServices *services) {
    GvAosCastResult r = {0};
    if ((a->flags & 0x540u) || !(s->held & 0x40u) ||
        !(s->pressed & s->attack_button)) return r;
    const GvAosAbility *ability = table + s->equipped;
    if (!s->active_count && s->active_type != s->equipped)
        s->active_type = s->equipped;
    if (s->active_type != s->equipped || !ability->effect_token ||
        ability->mp_cost >= s->mp ||
        table[s->active_type].maximum_active <= s->active_count) return r;
    unsigned slot = 0;
    while (slot < 8 && s->active_slots[slot]) ++slot;
    if (slot == 8) return r;
    r.allocation_attempted = 1;
    uint32_t entity = services->allocate(services->context,
                                        ability->effect_token, 2, 16);
    if (!entity) return r;
    s->mp = (int16_t)((uint16_t)s->mp - (uint16_t)ability->mp_cost);
    s->active_slots[slot] = entity;
    if (!ability->actor_cast_mode) {
        r.animation_kind = 1; /* host animation request (actor, 23, 0) */
        a->state = 2;
    } else {
        r.animation_kind = 2; /* host cast-pose request (2) */
        a->state = 10;
        a->substate = 0;
        a->velocity_x = a->velocity_y = 0;
        a->acceleration_x = a->acceleration_y = 0;
        a->timer = 32;
    }
    a->flags = (a->flags | 0x100u) & 0xffdfff9fu;
    r.entity = entity;
    r.slot = (uint8_t)slot;
    r.ability = s->equipped;
    r.inherited_metadata = (uint16_t)(ability->metadata >> 16);
    return r;
}

void gv_aos_cast_step(GvAosCastContext *c) {
    c->result = gv_aos_cast(&c->state, &c->caster, c->table, &c->services);
}
