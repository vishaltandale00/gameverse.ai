#ifndef GV_SONIC_METROID_GAME_H
#define GV_SONIC_METROID_GAME_H
#include <stdint.h>
#include <stddef.h>
enum { GV_MORPH=1,GV_MISSILE=2,GV_BOMB=4,GV_HIGH=8,GV_ICE=16,GV_VARIA=32,GV_SPEED=64,GV_SCREW=128 };
enum { GV_BEAM=1,GV_CHARGED=2,GV_MISSILE_SHOT=3,GV_BOMB_SHOT=4,GV_ENEMY_SHOT=5 };
enum { GV_CRAWLER=1,GV_FLYER=2,GV_PIRATE=3,GV_GUARDIAN=4 };
enum { GV_RELIC=1,GV_GATE=2,GV_ALIEN=3,GV_RECHARGE=4,GV_HEAT=5,GV_FREEZE_GATEWAY=6 };
enum { GV_GATE_BEAM=1,GV_GATE_MISSILE=2,GV_GATE_BOMB=3,GV_GATE_HIGH=4,GV_GATE_ICE=5,GV_GATE_SPEED=6,GV_GATE_SCREW=7 };
typedef struct {
    int32_t x,y;int16_t vx,vy,speed;int8_t ox,oy;uint32_t flags;
    uint8_t angle;uint8_t unknown15[5];int16_t lock,iframe,invincible;
    uint8_t unknown20[12];int32_t max_speed,acceleration,deceleration;
    uint16_t held,pressed;uint8_t player_index,ability_used,action,action_timer;
    int8_t pose;uint8_t unknown41[23];uint8_t ability88;int8_t character;
    uint8_t unknown5a[6];uint32_t task,sprite,secondary_sprite;
} GvPlayer;
typedef struct {int32_t x,y;int16_t vx,vy;uint16_t life;uint8_t kind,damage;} GvShot;
typedef struct {
    int32_t x,y,home_x;int16_t vx,home_y;uint16_t hp,clock,freeze;
    uint8_t species,state,id,active;
} GvAlien;
typedef struct {int32_t x,y;uint16_t life;uint8_t kind,amount;} GvDrop;
typedef struct {
    uint32_t task,callback,sprite;int16_t x,y;uint16_t freeze;
    uint8_t hp,pending_kill;
} GvNativeEnemy;
typedef struct {int16_t x,y;uint8_t kind,param,id,active;} GvPrefab;
typedef struct {
    uint32_t magic,frame,upgrades,visited,terrain,tiles;
    uint16_t energy,max_energy,missiles,max_missiles;
    uint16_t old_keys,charge,cooldown,iframe,run_clock,story_clock;
    uint16_t shots_fired,shots_hit,native_kills,alien_kills,gates_opened,relics_collected,damage_taken,deaths;
    uint16_t picked[18],opened[18];
    uint16_t palette_backup[16];
    int32_t ledge_x,ledge_y;
    int16_t last_x,last_y;uint8_t stage,morph,ledge,palette;
    uint8_t momentum,frozen_support,wall_kicks,ledge_grabs;
    uint8_t palette_valid,stage_active,last_dead,message;
    GvShot shots[8];GvAlien aliens[8];GvDrop drops[6];GvNativeEnemy natives[16];GvPrefab prefabs[8];uint16_t control_steps,observed_steps,relay_trips;uint8_t relay_from,relay_to;
} GvState;
typedef struct {uint8_t kind,param,id,reserved;uint16_t x;int16_t y_offset;} GvPrefabSpec;
typedef struct {const char *region,*entry;uint8_t count,heat,guardian,reserved;GvPrefabSpec prefabs[8];} GvStageSpec;
typedef struct {uint8_t stage,source_id,kind,param,ledger_id,requires;} GvReturnSpec;
extern const GvReturnSpec gv_return_variants[];
extern const unsigned gv_return_variant_count;
extern const GvStageSpec gv_stages[18];
extern const uint32_t gv_tile_pixels[96*8];
extern const uint16_t gv_palette[16];
extern const char *const gv_messages[];
#define GV_STATE_BYTES 1536
#define GV_MAGIC 0x324d5647u
#define GV_PLAYER ((GvPlayer *)0x03005a20u)
#define GV_R8(a) (*(volatile uint8_t *)(uintptr_t)(a))
#define GV_R16(a) (*(volatile uint16_t *)(uintptr_t)(a))
#define GV_R32(a) (*(volatile uint32_t *)(uintptr_t)(a))
_Static_assert(offsetof(GvPlayer,pose)==64,"player pose ABI");
_Static_assert(offsetof(GvPlayer,task)==96,"player task ABI");
_Static_assert(sizeof(GvState)<=GV_STATE_BYTES,"native task allocation extent");
_Static_assert(offsetof(GvState,prefabs)==932,"native observation prefab ABI");
_Static_assert(offsetof(GvState,relay_trips)==1000,"native observation relay ABI");
static inline int gv_abs(int v){return v<0?-v:v;}
static inline int gv_px(int32_t v){return v>=0?v/256:-((255-v)/256);}
static inline void gv_zero(void *p,unsigned bytes){uint8_t *b=p;while(bytes--)*b++=0;}
typedef void *(*GvTaskCreate)(void (*)(void),uint16_t,uint16_t,uint16_t,void (*)(void *));
typedef uint16_t *(*GvOamAllocate)(unsigned);
typedef void *(*GvVramAllocate)(unsigned);
typedef void (*GvNativeVoidActor)(void *);
typedef void (*GvNativePose)(void *,int);
static inline void gv_sound(unsigned id){((void (*)(unsigned))0x080977e5)(id);}
static inline void gv_pose(GvPlayer *p,int height){((GvNativePose)0x08045139)(p,height);}
GvState *gv_find_state(void);
GvState *gv_ensure_state(void (*callback)(void));
void gv_game_task(void);
void gv_tick_components(GvState *,GvPlayer *,uint16_t,uint16_t);
void gv_travel_step(GvState *,GvPlayer *,uint16_t,uint16_t);
void gv_stage_begin(GvState *,GvPlayer *);
void gv_progression_step(GvState *,GvPlayer *,uint16_t,uint16_t);
void gv_ecology_step(GvState *,GvPlayer *);
void gv_weapons_step(GvState *,GvPlayer *,uint16_t,uint16_t);
void gv_resources_step(GvState *,GvPlayer *);
int gv_damage_player(GvState *,GvPlayer *,unsigned);
void gv_make_drop(GvState *,int,int,unsigned,unsigned);
int gv_hit_shots(GvState *,int,int,int,int,uint16_t *,uint16_t *,unsigned);
void gv_restore_palette(GvState *);
void gv_draw_game(GvState *,GvPlayer *);
void gv_message(GvState *,unsigned);
int gv_floor_y(int,int,int);
int gv_is_solid(int,int);
void gv_movement_step(GvState *,GvPlayer *,uint16_t,uint16_t);
void gv_frozen_native(void);
int32_t gv_native_enemy(void *,int16_t,int16_t);
int32_t gv_native_hurt(void *);
void gv_native_player(void);
void gv_native_input(void *);
int32_t gv_native_jump(void *);
void gv_native_ground(void *);
void gv_native_release(void *);
void gv_native_air_control(void *);
void gv_native_gravity(void *,uint32_t);
void gv_native_integrate(void *,uint32_t,uint32_t);
void gv_native_vram_reset(void);
int32_t gv_native_boss(void *,int16_t,int16_t,void *);
int32_t gv_native_boss_dual(void *,int16_t,int16_t,void *);
int32_t gv_native_boss_shielded(void *,int16_t,int16_t,void *);
int32_t gv_native_boss_attack(void *,int16_t,int16_t,void *);
int gv_boss_projectile(GvState *,void *,int,int);
#endif
