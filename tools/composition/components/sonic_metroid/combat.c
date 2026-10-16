#include "game.h"
/* Behavioral inputs recovered independently from Zero Mission's ROM:
 * ordinary/charged damage2/8, missile20, cooldown7, active caps6/2,
 * steady beam speed20quarterpx/frame, ice26, diagonal7/10, freeze240,
 * energy5/20 and missile2 drops. See first-draft-combat-evidence.json.
 * AABBs, new prefab state and Sonic native entity-lifecycle linkage below
 * are explicitly authored adapters; no unchanged Sonic combat is called MZM.
 */
static void shoot(GvState *s,GvPlayer *p,unsigned kind,uint16_t keys)
{
    unsigned count=0;for(unsigned i=0;i<8;i++)if(s->shots[i].life && s->shots[i].kind==kind)count++;
    if(count>=(kind==GV_CHARGED?2:6))return;
    if(kind==GV_MISSILE_SHOT && (!s->missiles || !(s->upgrades&GV_MISSILE)))return;
    if(kind==GV_BOMB_SHOT && !(s->upgrades&GV_BOMB))return;
    for(unsigned i=0;i<8;i++)if(!s->shots[i].life){
        GvShot *q=&s->shots[i];int dx=p->flags&1?-1:1,dy=0;
        if(keys&0x200){
            if(keys&0x40)dy=-1;else if(keys&0x80)dy=1;
            if(dy && !(keys&0x30))dx=0;
        }else if(keys&0x40){dy=-1;if(!(keys&0x30))dx=0;}
        int speed=(s->upgrades&GV_ICE?26:20)*64;
        if(dx && dy)speed=speed*7/10;
        *q=(GvShot){p->x+dx*12*256,p->y+dy*12*256-4*256,
            (int16_t)(dx*speed),(int16_t)(dy*speed),48,(uint8_t)kind,
            kind==GV_MISSILE_SHOT?20:kind==GV_CHARGED?8:2};
        if(kind==GV_MISSILE_SHOT){s->missiles--;q->life=72;q->vx=dx*512;q->vy=dy*512;}
        if(kind==GV_BOMB_SHOT){q->x=p->x;q->y=p->y+4*256;q->vx=q->vy=0;q->life=45;q->damage=8;}
        s->shots_fired++;s->cooldown=7;gv_sound(kind==GV_MISSILE_SHOT?0x79:0x6d);return;
    }
}
void gv_weapons_step(GvState *s,GvPlayer *p,uint16_t keys,uint16_t edges)
{
    if(s->cooldown)s->cooldown--;
    if(keys&2){if(s->charge<90)s->charge++;}
    else{
        if(s->charge>=30 && !s->morph)shoot(s,p,GV_CHARGED,keys);
        s->charge=0;
    }
    if(!s->cooldown && ((edges&2) || ((keys&2) && s->charge<30 && s->frame%8==0))){
        shoot(s,p,s->morph?GV_BOMB_SHOT:(keys&0x100)?GV_MISSILE_SHOT:GV_BEAM,keys);
    }
    for(unsigned i=0;i<8;i++){
        GvShot *q=&s->shots[i];if(!q->life)continue;
        if(q->kind==GV_BOMB_SHOT){
            q->life--;
            if(q->life==8){gv_sound(0x7f);if(s->morph && gv_abs(q->x-p->x)<20*256 && gv_abs(q->y-p->y)<24*256){p->vy=-1024;p->flags|=2;}}
            continue;
        }
        if(q->kind==GV_MISSILE_SHOT){
            if(gv_abs(q->vx)<3072)q->vx+=q->vx<0?-128:q->vx>0?128:0;
            if(gv_abs(q->vy)<3072)q->vy+=q->vy<0?-128:q->vy>0?128:0;
        }
        q->life--;q->x+=q->vx;q->y+=q->vy;
        if(q->kind!=GV_ENEMY_SHOT && gv_is_solid(gv_px(q->x),gv_px(q->y)))q->life=0;
        if(q->kind==GV_ENEMY_SHOT && gv_abs(q->x-p->x)<10*256 && gv_abs(q->y-p->y)<16*256){gv_damage_player(s,p,20);q->life=0;}
    }
}
int gv_hit_shots_state(GvState *s,int x,int y,int rx,int ry,uint16_t *hp,uint16_t *freeze,unsigned vulnerability,gv_mzm_impact_State *effect)
{
    for(unsigned i=0;i<8;i++){
        GvShot *q=&s->shots[i];if(!q->life || q->kind==GV_ENEMY_SHOT)continue;
        unsigned radius=q->kind==GV_BOMB_SHOT?24:q->kind==GV_CHARGED?9:4;
        if(q->kind==GV_BOMB_SHOT && q->life>8)continue;
        if(gv_abs(gv_px(q->x)-x)>rx+(int)radius || gv_abs(gv_px(q->y)-y)>ry+(int)radius)continue;
        unsigned required=q->kind==GV_MISSILE_SHOT?8:q->kind==GV_CHARGED?3:2;
        if(q->kind==GV_BOMB_SHOT)required=16;
        if(!(vulnerability&required)){q->life=0;gv_sound(0x6f);continue;}
        unsigned damage=q->damage;
        /* Original MZM policy separates nonlethal ice freeze from lethal
         * damage/death. Newly authored prefabs advertise explicit capability. */
        if((s->upgrades&GV_ICE) && freeze && (q->kind==GV_BEAM || q->kind==GV_CHARGED) && *hp>damage)*freeze=240;
        unsigned lethal;
        if(effect)lethal=gv_apply_impact(s,effect,hp,(uint16_t)damage);
        else{*hp=*hp>damage?*hp-damage:0;lethal=!*hp;} /* Authored ephemeral lock transaction. */
        q->life=0;s->shots_hit++;return lethal?2:1;
    }
    return 0;
}
int gv_hit_shots(GvState *s,int x,int y,int rx,int ry,uint16_t *hp,uint16_t *freeze,unsigned vulnerability)
{return gv_hit_shots_state(s,x,y,rx,ry,hp,freeze,vulnerability,0);}
static int overlap(int ax,int ay,const int8_t *a,int bx,int by,const int8_t *b)
{return ax+a[0]<=bx+b[2] && ax+a[2]>=bx+b[0] && ay+a[1]<=by+b[3] && ay+a[3]>=by+b[1];}
static GvNativeEnemy *native_slot(GvState *s,void *sprite,int x,int y,unsigned initial_hp)
{
    unsigned task=GV_R32(0x03001f90);GvNativeEnemy *free=0;
    for(unsigned i=0;i<16;i++){
        GvNativeEnemy *n=&s->natives[i];
        if(n->task==task && n->sprite==(uint32_t)(uintptr_t)sprite)return n;
        if(!n->task || GV_R32(n->task+8)==0x080019bd)free=n;
    }
    if(!free)free=&s->natives[(task>>2)&15];
    gv_zero(&s->mzm_native[free-s->natives],sizeof(s->mzm_native[0]));
    *free=(GvNativeEnemy){task,GV_R32(task+8),(uint32_t)(uintptr_t)sprite,(int16_t)x,(int16_t)y,0,(uint8_t)initial_hp,0};return free;
}
static void killed_native(GvState *s,int x,int y)
{
    ((void (*)(int,int))0x0801fea1)(x,y);
    ((void (*)(int,int))0x08054921)(x,y);
    ((void (*)(int,int))0x080095cd)(x,y);
    gv_make_drop(s,x,y,s->native_kills%3==2?2:1,s->native_kills%3==2?2:5);s->native_kills++;
}
int32_t gv_native_enemy(void *sprite,int16_t x,int16_t y)
{
    GvState *s=gv_find_state();if(!s || GV_R32((uintptr_t)sprite+0x28)==0xffffffffu)return 0;
    GvNativeEnemy *n=native_slot(s,sprite,x,y,4);n->x=x;n->y=y;
    const int8_t *bounds=(const int8_t *)sprite+0x2c;
    int cx=x+(bounds[0]+bounds[2])/2,cy=y+(bounds[1]+bounds[3])/2;
    uint16_t hp=n->hp;int hit=gv_hit_shots_state(s,cx,cy,(bounds[2]-bounds[0])/2,(bounds[3]-bounds[1])/2,&hp,&n->freeze,2|8|16,&s->mzm_native[n-s->natives]);n->hp=(uint8_t)hp;
    if(hit==2 || n->pending_kill){killed_native(s,x,y);n->task=0;return 1;}
    if(n->freeze){n->callback=GV_R32(n->task+8);GV_R32(n->task+8)=(uint32_t)(uintptr_t)gv_frozen_native|1u;return 0;}
    GvPlayer *p=GV_PLAYER;if(p->flags&0x80)return 0;
    const int8_t *enemy=(const int8_t *)sprite+0x2c;
    int px=gv_px(p->x),py=gv_px(p->y);uint8_t *render=(uint8_t *)(uintptr_t)p->sprite;
    int damaging=(s->upgrades&GV_SCREW) && (p->flags&6)==6;
    if((s->upgrades&GV_SPEED) && gv_abs(p->speed)>=1280)damaging=1;
    if(damaging && GV_R32((uintptr_t)render+0x3c)!=0xffffffffu && overlap(x,y,enemy,px,py,(const int8_t *)render+0x40)){
        uint16_t killed_hp=n->hp;gv_apply_impact(s,&s->mzm_native[n-s->natives],&killed_hp,killed_hp);
        if(p->vy>0)p->vy=-p->vy;killed_native(s,x,y);n->task=0;return 1;
    }
    if(GV_R32((uintptr_t)render+0x34)!=0xffffffffu && overlap(x,y,enemy,px,py,(const int8_t *)render+0x38))gv_damage_player(s,p,20);
    return 0;
}
void gv_frozen_native(void)
{
    GvState *s=gv_find_state();if(!s)return;unsigned task=GV_R32(0x03001f90);
    for(unsigned i=0;i<16;i++){
        GvNativeEnemy *n=&s->natives[i];if(n->task!=task)continue;
        uint16_t hp=n->hp;int hit=gv_hit_shots_state(s,n->x,n->y,12,12,&hp,&n->freeze,2|8|16,&s->mzm_native[i]);n->hp=(uint8_t)hp;
        if(hit==2){n->pending_kill=1;GV_R32(task+8)=n->callback;((void (*)(void))(uintptr_t)n->callback)();return;}
        GvPlayer *p=GV_PLAYER;
        if(p->vy>=0 && gv_abs(gv_px(p->x)-n->x)<18 && gv_px(p->y)+p->oy>=n->y-12 && gv_px(p->y)+p->oy<=n->y+4){
            p->y=(n->y-12-p->oy)*256;p->vy=0;p->flags&=~2u;p->speed=p->vx;p->angle=0;s->frozen_support=90;
        }
        GV_R16(n->sprite+0x16)=n->x-(int16_t)GV_R16(0x030059d0);
        GV_R16(n->sprite+0x18)=n->y-(int16_t)GV_R16(0x030059d2);
        ((GvNativeVoidActor)0x08004159)((void *)(uintptr_t)n->sprite);
        if(n->freeze)n->freeze--;else GV_R32(task+8)=n->callback;
        return;
    }
}

/* Explicit damage-unit bridge for retained staged bosses. Their original AI
 * owns health/death/escape and vulnerable windows. Eight MZM damage units map
 * to one original native hit; overflow is discarded at the phase boundary.
 * This preserves the native encounter rather than writing unknown boss RAM. */
int gv_boss_projectile(GvState *s,void *sprite,int x,int y)
{
    GvNativeEnemy *n=native_slot(s,sprite,x,y,8);uint16_t hp=n->hp;
    const int8_t *b=(const int8_t *)sprite+0x2c;
    int hit=gv_hit_shots_state(s,x+(b[0]+b[2])/2,y+(b[1]+b[3])/2,(b[2]-b[0])/2,(b[3]-b[1])/2,&hp,0,2|8|16,&s->mzm_native[n-s->natives]);
    if(hit==2)gv_zero(&s->mzm_native[n-s->natives],sizeof(s->mzm_native[0])); /* Phase-local meter consumed by original boss. */
    n->hp=hit==2?8:(uint8_t)hp;
    return hit==2;
}
