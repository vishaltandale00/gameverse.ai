#ifndef GV_MZM_RIPPER_H
#define GV_MZM_RIPPER_H
#include <stdint.h>
/* Portable live-controller state recovered from original species16/17. Position
 * uses unsigned quarter pixels, +Y down. Physical RAM/ROM bindings are absent;
 * asset scripts and terrain result are explicit input ports. All initializer
 * writes are retained, including range/animation/bounds state. */
typedef struct {
    uint16_t flags,y,x;
    int16_t top,bottom,left,right;
    uint16_t hp,frame;
    uint8_t tick,species,pose,draw_distance,contact,range_up,range_down,range_side,animation;
} MzmRipper;
typedef struct {uint8_t image,duration;} MzmRipperCel;
typedef struct {uint16_t max_hp;const uint8_t (*durations)[5];} MzmRipperProfile;
void mzm_ripper_control(MzmRipper *,const MzmRipperProfile *,uint8_t terrain_type,uint8_t random_bit);
void mzm_ripper_animate(MzmRipper *,const MzmRipperProfile *);
#endif
