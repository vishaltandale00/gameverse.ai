#include "game.h"
void gv_restore_palette(GvState *s)
{
    if(!s->palette_valid || s->palette>15)return;
    int same=1;for(unsigned i=0;i<16;i++)if(GV_R16(0x03001920+s->palette*32+i*2)!=gv_palette[i])same=0;
    if(same){for(unsigned i=0;i<16;i++)GV_R16(0x03001920+s->palette*32+i*2)=s->palette_backup[i];GV_R32(0x03001100)|=2;}
    s->palette_valid=0;
}
static int lease_palette(GvState *s)
{
    gv_restore_palette(s);unsigned used=0,count=GV_R8(0x030011b0);
    for(unsigned i=0;i<count && i<128;i++){
        unsigned a0=GV_R16(0x03001b80+i*8),a2=GV_R16(0x03001b84+i*8);
        if(!(a0&0x2000))used|=1u<<(a2>>12);
    }
    for(int bank=15;bank>=0;bank--)if(!(used&(1u<<bank))){
        s->palette=(uint8_t)bank;s->palette_valid=1;
        for(unsigned i=0;i<16;i++){s->palette_backup[i]=GV_R16(0x03001920+bank*32+i*2);GV_R16(0x03001920+bank*32+i*2)=gv_palette[i];}
        GV_R32(0x03001100)|=2;return 1;
    }
    return 0;
}
static void tile(GvState *s,int x,int y,unsigned number,int large,int flip,int hud)
{
    if(x<-(large?16:8) || x>239 || y<-(large?16:8) || y>159 || GV_R8(0x030011b0)>=124)return;
    uint16_t *o=((GvOamAllocate)0x080047fd)(hud?0:12);if((uintptr_t)o==GV_R32(0x0300642c))return;
    unsigned base=(s->tiles-0x06010000)/32;
    o[0]=(uint16_t)(y&255);o[1]=(uint16_t)((x&511)|(large?0x4000:0)|(flip?0x1000:0));
    o[2]=(uint16_t)((base+number)&1023)|((s->palette&15)<<12)|(hud?0:0x400);
}
static void text(GvState *s,int x,int y,const char *p,unsigned limit)
{for(unsigned i=0;p[i] && i<limit;i++){unsigned c=(uint8_t)p[i];if(c>=32 && c<96)tile(s,x+i*8,y,c-32,0,0,1);}}
static void number(GvState *s,int x,int y,unsigned n,unsigned digits)
{
    unsigned divisor=1;for(unsigned i=1;i<digits;i++)divisor*=10;
    while(divisor){tile(s,x,y,16+(n/divisor)%10,0,0,1);x+=8;divisor/=10;}
}
void gv_draw_game(GvState *s,GvPlayer *p)
{
    if(!p){gv_restore_palette(s);return;}
    if(!s->tiles){
        unsigned ptr=(unsigned)(uintptr_t)((GvVramAllocate)0x08006b55)(96);
        if(ptr<0x06010000 || ptr+96*32>0x06018000)return;
        s->tiles=ptr;for(unsigned i=0;i<96*8;i++)GV_R32(ptr+i*4)=gv_tile_pixels[i];
    }
    if(!lease_palette(s))return;
    int cx=(int16_t)GV_R16(0x030059d0),cy=(int16_t)GV_R16(0x030059d2);
    for(unsigned i=0;i<8;i++){
        GvPrefab *f=&s->prefabs[i];if(!f->active)continue;int x=f->x-cx,y=f->y-cy;
        if(f->kind==GV_RELIC){
            int collected=s->picked[s->stage]&(1u<<f->id);tile(s,x-8,y-26,88,1,0,0);
            if(!collected){tile(s,x-4,y-38,70,0,0,0);tile(s,x-4,y-18,16+f->param+1,0,0,0);}
        }else if(f->kind==GV_GATE && !(s->opened[s->stage]&(1u<<f->id))){
            int height=f->param==GV_GATE_HIGH?68:f->param==GV_GATE_ICE?86:96;
            for(int h=0;h<height;h+=16)tile(s,x-8,y-h-16,92,1,(s->frame>>3)&1,0);
            tile(s,x-4,y-height-12,16+f->param,0,0,0);
        }else if(f->kind==GV_RECHARGE)tile(s,x-8,y-16,88,1,0,0);
        else if(f->kind==GV_HEAT){for(int j=-4;j<=4;j++)tile(s,x+j*24,y-16-(s->frame+j*7)%32,69,0,0,0);}
    }
    for(unsigned i=0;i<8;i++){
        GvAlien *a=&s->aliens[i];if(!a->active)continue;int x=gv_px(a->x)-cx-8,y=gv_px(a->y)-cy-8;
        unsigned shape=72+(a->species-1)*4;tile(s,x,y,shape,1,a->vx<0,0);
        if(a->freeze){tile(s,x-2,y-3,69,0,0,0);tile(s,x+10,y+10,69,0,0,0);}
        else if(a->state && (s->frame&8))tile(s,x+4,y-9,70,0,0,0);
        if(a->species==GV_GUARDIAN){tile(s,x+8,y-8,shape,1,1,0);tile(s,x,y+8,shape,1,0,0);}
    }
    for(unsigned i=0;i<8;i++){
        GvShot *q=&s->shots[i];if(!q->life)continue;
        unsigned t=q->kind==GV_MISSILE_SHOT?65:q->kind==GV_BOMB_SHOT?(q->life<=8?69:66):q->kind==GV_ENEMY_SHOT?69:64;
        tile(s,gv_px(q->x)-cx-4,gv_px(q->y)-cy-4,t,0,q->vx<0,0);
        if(q->kind==GV_CHARGED){tile(s,gv_px(q->x)-cx+2,gv_px(q->y)-cy-6,64,0,0,0);}
    }
    for(unsigned i=0;i<6;i++)if(s->drops[i].life && (s->drops[i].life>90 || s->frame&4))tile(s,gv_px(s->drops[i].x)-cx-4,gv_px(s->drops[i].y)-cy-4,s->drops[i].kind==1?67:68,0,0,0);
    if(!s->morph && ((GV_R16(0x03001b50)&(2|0x200)) || s->charge)){
        int facing=p->flags&1?-1:1;int mx=gv_px(p->x)-cx+facing*10-4,my=gv_px(p->y)-cy-6;
        tile(s,mx,my,(GV_R16(0x03001b50)&0x100)?65:64,0,facing<0,0);
        if(s->charge>=30 && (s->frame&4))tile(s,mx-2,my-2,69,0,0,0);
    }
    /* Compact HUD is always present: energy replaces ring-loss health while
     * original ring collection/score and campaign HUD remain native. */
    text(s,88,4,"E",1);number(s,96,4,s->energy,3);
    text(s,160,4,"M",1);number(s,168,4,s->missiles,2);
    text(s,200,4,s->morph?"BALL":s->momentum?"FLOW":"BEAM",4);
    if(s->charge>=30)text(s,88,14,"CHARGED",7);
    if(s->story_clock){
        text(s,8,128,gv_messages[s->message*2],28);text(s,8,138,gv_messages[s->message*2+1],28);
    }else if(s->frame<600){text(s,8,144,"B FIRE  R+B MISSILE  L AIM",28);}
}
