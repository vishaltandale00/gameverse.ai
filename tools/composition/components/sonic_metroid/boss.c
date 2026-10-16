#include "game.h"
/* Own-ROM native helper contracts:0x0800B8B4 returns1 on accepted attack,
 *2 on hurt contact; its callers own boss hit counts, invulnerability windows,
 * phase changes and death.0x0800C0E0 is attack-only. Each has four AAPCS args.
 * Recovered AABB/bounce policy is retained; projectiles add an explicit input.
 * No guessed boss structure or direct HP/ending writes are used. */
static int overlap(int ax,int ay,const int8_t *a,int bx,int by,const int8_t *b)
{return ax+a[0]<=bx+b[2] && ax+a[2]>=bx+b[0] && ay+a[1]<=by+b[3] && ay+a[3]>=by+b[1];}
static int boss_contact(void *sprite,int16_t x,int16_t y,GvPlayer *p,int hurt)
{
    GvState *s=gv_find_state();if(!s || p->flags&0x80 || GV_R32((uintptr_t)sprite+0x28)==0xffffffff)return 0;
    if(gv_boss_projectile(s,sprite,x,y))return 1;
    unsigned render=p->sprite;int px=gv_px(p->x),py=gv_px(p->y);
    int body=((s->upgrades&GV_SCREW) && (p->flags&6)==6) || ((s->upgrades&GV_SPEED) && gv_abs(p->speed)>=1280);
    if(body && GV_R32(render+0x3c)!=0xffffffff && overlap(x,y,(const int8_t *)sprite+0x2c,px,py,(const int8_t *)(uintptr_t)(render+0x40))){
        if(GV_R8(0x0300514c)!=13){p->vx=p->character==3?p->vx/2:-p->vx;p->vy=-p->vy;}
        return 1;
    }
    if(hurt && GV_R32(render+0x34)!=0xffffffff && overlap(x,y,(const int8_t *)sprite+0x2c,px,py,(const int8_t *)(uintptr_t)(render+0x38))){gv_damage_player(s,p,20);return 2;}
    return 0;
}
int32_t gv_native_boss(void *sprite,int16_t x,int16_t y,void *player)
{return boss_contact(sprite,x,y,player,1);}
int32_t gv_native_boss_attack(void *sprite,int16_t x,int16_t y,void *player)
{return boss_contact(sprite,x,y,player,0);}
/* The hammer boss uses0x0800BCBC, not0x0800B8B4. Its secondary
 * hitbox remains dangerous even while the primary cockpit is disabled.
 * The shielded variant0x0800BA5C requires both source hitboxes active. */
int32_t gv_native_boss_dual(void *sprite,int16_t x,int16_t y,void *player)
{
    int result=boss_contact(sprite,x,y,player,1);if(result)return result;
    GvState *s=gv_find_state();GvPlayer *p=player;unsigned r=p->sprite;
    if(s && !(p->flags&0x80) && GV_R32((uintptr_t)sprite+0x30)!=0xffffffff && GV_R32(r+0x34)!=0xffffffff &&
       overlap(x,y,(const int8_t *)sprite+0x34,gv_px(p->x),gv_px(p->y),(const int8_t *)(uintptr_t)(r+0x38))){gv_damage_player(s,p,20);return 2;}
    return 0;
}
int32_t gv_native_boss_shielded(void *sprite,int16_t x,int16_t y,void *player)
{
    if(GV_R32((uintptr_t)sprite+0x28)==0xffffffff || GV_R32((uintptr_t)sprite+0x30)==0xffffffff)return 0;
    GvState *s=gv_find_state();GvPlayer *p=player;unsigned r=p->sprite;
    if(s && !(p->flags&0x80) && GV_R32(r+0x34)!=0xffffffff &&
       overlap(x,y,(const int8_t *)sprite+0x34,gv_px(p->x),gv_px(p->y),(const int8_t *)(uintptr_t)(r+0x38))){gv_damage_player(s,p,20);return 2;}
    return boss_contact(sprite,x,y,player,1);
}
