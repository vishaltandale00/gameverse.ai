/* Self-decompiled USA ROM0x08040080 tile descriptor lookup.
 * Evidence: literal pointer0x03005A0C, two /12 helper calls, byte map index,
 * metatile stride0x120 and final LDRH. Coordinates are already clamped by
 * callers; this package explicitly rejects out-of-range/negative inputs.
 * Native quotient caches are removed as an intentional pure adapter change.
 */
#include <stdint.h>
typedef struct {
    const uint16_t *metatile_descriptors;
    const uint8_t *maps[2];
    uint16_t map_columns, map_rows;
    const int8_t *height_profiles, *surface_angles;
    const uint16_t *packed_flags;
} SonicRecoveredTerrain;

uint16_t sonic_recovered_tile_at(const SonicRecoveredTerrain *terrain,
                                uint32_t x, uint32_t y, unsigned layer)
{
    uint32_t tile_x=x>>3, tile_y=y>>3;
    uint32_t region_x=tile_x/12, region_y=tile_y/12;
    if(layer>1 || region_x>=terrain->map_columns || region_y>=terrain->map_rows)
        return 0;
    unsigned metatile=terrain->maps[layer][region_y*terrain->map_columns+region_x];
    unsigned inside=(tile_y-region_y*12)*12+(tile_x-region_x*12);
    return terrain->metatile_descriptors[metatile*144+inside];
}

/* ROM0x0803FE10: coordinate clamp, low-nibble profile and transformed angle.
 * Bit0x80 requests a packed-flag suppression branch. Its higher-level material
 * meaning is deliberately not guessed from this function alone. */
int32_t sonic_recovered_profile_y(const SonicRecoveredTerrain *terrain,
                                int32_t x,int32_t y,unsigned layer,int8_t *angle)
{
    if(x<0)x=0;
    else if((uint32_t)x>=terrain->map_columns*96u)x=terrain->map_columns*96u-1;
    if(y<0)y=0;
    else if((uint32_t)y>=terrain->map_rows*96u)y=terrain->map_rows*96u-1;
    unsigned descriptor=sonic_recovered_tile_at(terrain,x,y,layer&1);
    unsigned id=descriptor&0x3ff;
    unsigned sample=(unsigned)y&7;
    if(descriptor&0x800)sample=7-sample;
    unsigned packed=(uint8_t)terrain->height_profiles[id*8+sample];
    int32_t height=packed&15;
    if(packed&8)height-=16;
    if(height==-8)height=8;
    if((layer&0x80) && ((terrain->packed_flags[id>>3]>>((descriptor&7)*2))&1))height=0;
    if((descriptor&0x400) && height!=8 && height)height+=height>0?-8:8;
    int32_t direction=terrain->surface_angles[id];
    if(descriptor&0x800)direction=-128-direction;
    if((descriptor&0x400) && height)direction=-direction;
    *angle=(int8_t)(uint8_t)direction;
    return height;
}

/* ROM0x0803FF50 takes native arguments(y,x,flags,angle_out); this public
 * adapter keeps conventional(x,y) ordering and names that transform explicitly.
 * High nibble sampled across X; flip operations intentionally differ from Y. */
int32_t sonic_recovered_profile_x(const SonicRecoveredTerrain *terrain,
                                int32_t x,int32_t y,unsigned layer,int8_t *angle)
{
    if(x<0)x=0;
    else if((uint32_t)x>=terrain->map_columns*96u)x=terrain->map_columns*96u-1;
    if(y<0)y=0;
    else if((uint32_t)y>=terrain->map_rows*96u)y=terrain->map_rows*96u-1;
    unsigned descriptor=sonic_recovered_tile_at(terrain,x,y,layer&1);
    unsigned id=descriptor&0x3ff;
    unsigned sample=(unsigned)x&7;
    if(descriptor&0x400)sample=7-sample;
    int32_t packed=terrain->height_profiles[id*8+sample];
    int32_t height=packed>=0?packed/16:-((15-packed)/16);
    if(height==-8)height=8;
    if((layer&0x80) && ((terrain->packed_flags[id>>3]>>((descriptor&7)*2))&1))height=0;
    if((descriptor&0x800) && height!=8 && height)height+=height>0?-8:8;
    int32_t direction=terrain->surface_angles[id];
    if(descriptor&0x400)direction=-direction;
    if((descriptor&0x800) && height)direction=-128-direction;
    *angle=(int8_t)(uint8_t)direction;
    return height;
}
