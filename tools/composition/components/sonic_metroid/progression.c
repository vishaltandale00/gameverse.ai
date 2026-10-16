#include "game.h"
void gv_stage_begin(GvState *s,GvPlayer *p)
{
    unsigned level=GV_R8(0x0300514c);if(level>=18)return;
    s->stage=(uint8_t)level;s->terrain=GV_R32(0x03005a0c);
    gv_zero(s->prefabs,sizeof(s->prefabs));gv_zero(s->aliens,sizeof(s->aliens));
    gv_zero(s->natives,sizeof(s->natives));gv_zero(s->shots,sizeof(s->shots));gv_zero(s->drops,sizeof(s->drops));
    s->morph=0;s->ledge=0;s->momentum=0;
    s->visited|=1u<<level;s->energy=s->max_energy;
    if(s->upgrades&GV_MISSILE)s->missiles=s->max_missiles;
    gv_message(s,level==0?1:level>=12?10:13);
    (void)p;
}
static void activate_prefab(GvState *s,GvPlayer *p,const GvPrefabSpec *spec,unsigned slot)
{
    GvPrefab *f=&s->prefabs[slot];int ground=gv_floor_y(spec->x,gv_px(p->y)+p->oy,112);
    *f=(GvPrefab){(int16_t)spec->x,(int16_t)(ground+spec->y_offset),spec->kind,spec->param,spec->id,1};
    if(spec->kind==GV_FREEZE_GATEWAY){
        /* A typed compound prefab: a renewable freeze target plus its gate.
         * Native coast has open headroom; the Factory ingress does not. The
         * target top stays42..50px above its own floor, within ordinary jump;
         * a second jump from it clears the86px barrier. */
        f->kind=GV_GATE;f->param=GV_GATE_ICE;
        for(unsigned i=0;i<8;i++)if(!s->aliens[i].active){
            int x=spec->x-60,y=gv_floor_y(x,ground,112)+spec->y_offset-32;
            s->aliens[i]=(GvAlien){x*256,y*256,x*256,160,(int16_t)y,6,0,0,GV_FLYER,0,spec->id,2};break;
        }
    }
    if(spec->kind==GV_ALIEN){
        for(unsigned i=0;i<8;i++)if(!s->aliens[i].active){
            int y=f->y-(spec->param==GV_FLYER?64:spec->param==GV_GUARDIAN?20:10);
            unsigned hp=spec->param==GV_GUARDIAN?60:spec->param==GV_PIRATE?16:spec->param==GV_CRAWLER?4:6;
            s->aliens[i]=(GvAlien){spec->x*256,y*256,spec->x*256,0,(int16_t)y,(uint16_t)hp,0,0,spec->param,0,spec->id,spec->reserved?2:1};break;
        }
        f->active=2;
    }
}
static void relic(GvState *s,GvPrefab *f)
{
    unsigned bit=1u<<f->param;s->upgrades|=bit;s->picked[s->stage]|=(uint16_t)(1u<<f->id);
    s->relics_collected++;
    if(bit==GV_MISSILE){s->max_missiles=10;s->missiles=10;}
    if(bit==GV_VARIA){s->max_energy+=50;s->energy=s->max_energy;}
    gv_message(s,2+f->param);gv_sound(0x6c);f->active=2;
}
void gv_progression_step(GvState *s,GvPlayer *p,uint16_t keys,uint16_t edges)
{
    (void)edges;const GvStageSpec *stage=&gv_stages[s->stage];
    int px=gv_px(p->x),py=gv_px(p->y);
    for(unsigned i=0;i<stage->count && i<8;i++){
        const GvPrefabSpec *spec=&stage->prefabs[i];GvPrefab *f=&s->prefabs[i];
        if(!f->active && gv_abs(px-spec->x)<180){
            if(spec->kind==GV_ALIEN && (s->opened[s->stage]&(1u<<spec->id))){f->active=2;f->kind=0;}
            else activate_prefab(s,p,spec,i);
        }
        if(!f->active || gv_abs(px-f->x)>340)continue;
        if(f->kind==GV_RELIC){
            unsigned bit=1u<<f->param;
            if(!(s->picked[s->stage]&(1u<<f->id)) && gv_abs(px-f->x)<20 && gv_abs(py-(f->y-18))<42)relic(s,f);
            else if((s->upgrades&bit) && gv_abs(px-f->x)<24 && (keys&0x80)){
                if(s->frame%6==0){if(s->energy<s->max_energy)s->energy++;if(s->missiles<s->max_missiles)s->missiles++;}
            }
            continue;
        }
        if(f->kind==GV_RECHARGE && gv_abs(px-f->x)<24 && (keys&0x80)){
            s->energy=s->max_energy;s->missiles=s->max_missiles;continue;
        }
        if(f->kind==GV_HEAT){
            if(gv_abs(px-f->x)<100 && !(s->upgrades&GV_VARIA) && s->frame%45==0)gv_damage_player(s,p,10);
            continue;
        }
        if(f->kind!=GV_GATE || (s->opened[s->stage]&(1u<<f->id)))continue;
        int open=0,height=f->param==GV_GATE_HIGH?68:f->param==GV_GATE_ICE?86:96;
        uint16_t dummy=1,freeze=0;
        if(f->param<=GV_GATE_BOMB){
            unsigned vul=f->param==GV_GATE_BEAM?2|8|16:f->param==GV_GATE_MISSILE?8:16;
            if(gv_hit_shots(s,f->x,f->y-24,8,30,&dummy,&freeze,vul))open=1;
        }else if(f->param==GV_GATE_HIGH){
            if((s->upgrades&GV_HIGH) && py+p->oy<f->y-height)open=1;
        }else if(f->param==GV_GATE_ICE){
            for(unsigned a=0;a<8;a++)if(s->frozen_support && s->aliens[a].active && s->aliens[a].freeze && gv_abs(gv_px(s->aliens[a].x)-f->x)<80 && py+p->oy<f->y-65)open=1;
        }else if(f->param==GV_GATE_SPEED){
            if((s->upgrades&GV_SPEED) && gv_abs(p->speed)>=1024 && gv_abs(px-f->x)<28)open=1;
        }else if((s->upgrades&GV_SCREW) && (p->flags&6)==6 && gv_abs(px-f->x)<28)open=1;
        if(open){s->opened[s->stage]|=(uint16_t)(1u<<f->id);s->gates_opened++;gv_sound(0x7f);continue;}
        /* A gate occupies an actual world interval. It can be jumped when
         * short enough; the high gate is deliberately beyond the normal arc. */
        if(gv_abs(px-f->x)<14 && py+p->oy>f->y-height && py-p->oy<f->y+12){
            if(s->last_x<=f->x)p->x=(f->x-14)*256;else p->x=(f->x+14)*256;
            p->vx=p->speed=0;
        }
    }
    s->last_x=gv_px(p->x);s->last_y=gv_px(p->y);
}
