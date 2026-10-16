/* Own USA ROM terrain contact recovery. The distance scanner is reviewed from
 * 0x0803FA40..0x0803FC30, including its six-argument Thumb ABI (the lift had
 * missed the sixth callback argument). It searches at most two neighboring
 * eight-pixel cells and carries the angle of the selected contact.
 * This closes scanner→profile→descriptor→ROM geometry rather than treating
 * terrain contact as a distance guessed from a rendered screenshot.
 */
#include "sonic-recovered-terrain.c"

/* ARM7 has no integer divide instruction. This bounded runtime belongs to the
 * recovered component's native lowering closure, not to the game ROM. */
#if defined(__arm__)
unsigned __aeabi_uidiv(unsigned numerator,unsigned denominator)
{
    unsigned quotient=0,remainder=0;
    if(!denominator)return 0;
    /* Terrain's clamped tile coordinate is <65536 and divisor is12. This
     * exact 16-bit reciprocal avoids 32 long-division steps per tile probe;
     * the general fallback remains for any other input. */
    if(numerator<=65535){
        if(denominator==12)return (numerator*0xaaabu)>>19;
        /* Clang can fold (coordinate>>3)/12 into coordinate/96. */
        if(denominator==96)return (numerator*0xaaabu)>>22;
    }
    for(unsigned i=32;i;i--){
        unsigned high=remainder>>31;
        remainder=(remainder<<1)|((numerator>>(i-1))&1);
        if(high || remainder>=denominator){remainder-=denominator;quotient|=1u<<(i-1);}
    }
    return quotient;
}
#endif
static int32_t contact_height(const SonicRecoveredTerrain *t,int32_t a,int32_t b,
                              unsigned flags,int8_t *angle,int axis)
{
    return axis?sonic_recovered_profile_x(t,b,a,flags,angle):
                sonic_recovered_profile_y(t,a,b,flags,angle);
}
static int32_t profile_distance(int32_t height,unsigned offset)
{
    return height>0?height-1-(int32_t)offset:height+(int32_t)offset;
}
int32_t sonic_recovered_scan_distance(const SonicRecoveredTerrain *terrain,
                                     int32_t a,int32_t b,unsigned flags,
                                     int32_t step,int8_t *angle,int axis)
{
    int8_t temporary,discard;if(!angle)angle=&discard;
    unsigned offset=(uint32_t)a&7;
    int32_t height=contact_height(terrain,a,b,flags,&temporary,axis);
    if(!height){
        for(unsigned k=1;k<=2;k++){
            height=contact_height(terrain,(int32_t)((uint32_t)a+(uint32_t)step*k),b,flags,&temporary,axis);
            if(!height)continue;
            *angle=temporary;
            if(height==8)return step>0?(int32_t)(8*k-1-offset):(int32_t)(8*(k-1)+offset);
            return profile_distance(height,offset)+(int32_t)(8*k);
        }
        return step>0?24-(int32_t)offset:17+(int32_t)offset;
    }
    *angle=temporary;
    if(height==8){
        for(unsigned k=1;k<=2;k++){
            height=contact_height(terrain,(int32_t)((uint32_t)a-(uint32_t)step*k),b,flags,&temporary,axis);
            if(height==8){*angle=temporary;continue;}
            if(!height)return step>0?-1-(int32_t)offset-(int32_t)(8*(k-1)):
                                      (int32_t)offset-(int32_t)(8*k);
            *angle=temporary;return profile_distance(height,offset)-(int32_t)(8*k);
        }
        return step>0?-17-(int32_t)offset:(int32_t)offset-24;
    }
    return profile_distance(height,offset);
}
static SonicRecoveredTerrain live_terrain(void)
{
    const uint32_t *h=*(const uint32_t *volatile *)0x03005a0c;
    const uint16_t *dimensions=(const uint16_t *)(h+6);
    SonicRecoveredTerrain t={(const uint16_t *)(uintptr_t)h[2],
        {(const uint8_t *)(uintptr_t)h[3],(const uint8_t *)(uintptr_t)h[4]},
        dimensions[0],dimensions[1],(const int8_t *)(uintptr_t)h[0],
        (const int8_t *)(uintptr_t)h[1],(const uint16_t *)(uintptr_t)h[5]};
    return t;
}
/* Exact six-argument original native ABI. Supported ROM callbacks are a
 * finite enum of the two recovered axis probes, not arbitrary function calls.
 * All reviewed scanner callers use one of these two ROM entry pointers. */
int32_t sonic_native_scan_distance(int32_t a,int32_t b,unsigned flags,int32_t step,
                                   int8_t *angle,uintptr_t profile)
{
    SonicRecoveredTerrain t=live_terrain();
    return sonic_recovered_scan_distance(&t,a,b,flags,step,angle,
                                         (profile&~1u)==0x0803ff50);
}

typedef struct {
    int32_t x,y;int16_t vx,vy,speed;int8_t ox,oy;uint32_t flags;
    uint8_t angle,unknown15[3];int8_t contact_angles[2];
    uint8_t unknown1a[13],layer;
} SonicRecoveredContactActor;
static int32_t contact_asr8(int32_t value)
{
    return (int32_t)(((uint32_t)value>>8)|(value<0?0xff000000u:0));
}

/* Sensor-pair clearance closure: native helpers0x08042590,0x08042668,
 * 0x0804273C,0x08046EAC. Their nullable output pointers are made explicit.
 * The suppression bit is velocity-dependent and must travel with the sensor.
 */
int32_t sonic_recovered_clearance_pair(const SonicRecoveredTerrain *t,
    const SonicRecoveredContactActor *p,unsigned orientation,int8_t *angle,int32_t *other)
{
    int32_t x=contact_asr8(p->x),y=contact_asr8(p->y),a,b0,b1,step;
    unsigned axis,flags=p->layer;
    if(p->vy<(orientation==0?0:768))flags|=0x80;
    switch(orientation){
    case 0:a=y+p->oy;b0=x-2-p->ox;b1=x+2+p->ox;step=8;axis=1;break;
    case 1:a=x-2-p->ox;b0=y-p->oy;b1=y+p->oy;step=-8;axis=0;break;
    case 2:a=y-p->oy;b0=x-2-p->ox;b1=x+2+p->ox;step=-8;axis=1;break;
    default:a=x+2+p->ox;b0=y-p->oy;b1=y+p->oy;step=8;axis=0;break;
    }
    int8_t angles[2];
    int32_t d0=sonic_recovered_scan_distance(t,a,b0,flags,step,&angles[0],axis);
    int32_t d1=sonic_recovered_scan_distance(t,a,b1,flags,step,&angles[1],axis);
    if(d0<d1){if(angle)*angle=angles[0];if(other)*other=d1;return d0;}
    if(angle)*angle=angles[1];if(other)*other=d0;return d1;
}
int32_t sonic_native_head_clearance(uint32_t angle,SonicRecoveredContactActor *p)
{
    angle=(uint8_t)angle;
    SonicRecoveredTerrain t=live_terrain();
    p->contact_angles[0]=p->contact_angles[1]=(int8_t)angle;
    /* Native's selected angle is a dead local here; the caller consumes the
     * distance. Discarding it does not claim identical stack scratch bytes. */
    return sonic_recovered_clearance_pair(&t,p,(((unsigned)angle+32)&0xc0)>>6,0,0);
}

/* Attached contact response0x0804342C/43544/43654/43764. These functions
 * perform two probes, choose a contact, apply penetration/snap limits, detach
 * when contact is too far, then update the native surface angle. */
void sonic_recovered_attached_contact(const SonicRecoveredTerrain *t,
    SonicRecoveredContactActor *p,unsigned orientation,uint16_t stage)
{
    int32_t x=contact_asr8(p->x),y=contact_asr8(p->y),a,b0,b1,step;
    unsigned axis;
    switch(orientation){
    case 0:a=y+p->oy;b0=x-2-p->ox;b1=x+2+p->ox;step=8;axis=1;break;
    case 1:a=x-p->oy;b0=y-2-p->ox;b1=y+2+p->ox;step=-8;axis=0;break;
    case 2:a=y-p->oy;b0=x+2+p->ox;b1=x-2-p->ox;step=-8;axis=1;break;
    default:a=x+p->oy;b0=y+2+p->ox;b1=y-2-p->ox;step=8;axis=0;break;
    }
    int32_t d0=sonic_recovered_scan_distance(t,a,b0,p->layer,step,&p->contact_angles[0],axis);
    int32_t d1=sonic_recovered_scan_distance(t,a,b1,p->layer,step,&p->contact_angles[1],axis);
    int32_t distance=d0<d1?d0:d1;
    uint8_t selected=(uint8_t)(d0<d1?p->contact_angles[0]:p->contact_angles[1]);
    if(distance < -11)return;
    if(distance>0){
        int32_t magnitude=orientation==0||orientation==2?p->vx:p->vy;
        if(magnitude<0)magnitude=-magnitude;
        int32_t limit=(magnitude>>8)+3;if(limit>11)limit=11;
        if(distance>limit){
            if(orientation==0 && (p->flags&0x800))selected=p->angle;
            else{p->flags=(p->flags&~32u)|2;return;}
        }
    }
    int32_t correction=distance*256;
    if(orientation==0)p->y=(int32_t)((uint32_t)p->y+(uint32_t)correction);
    else if(orientation==2)p->y=(int32_t)((uint32_t)p->y-(uint32_t)correction);
    else if(orientation==1)p->x=(int32_t)((uint32_t)p->x-(uint32_t)correction);
    else p->x=(int32_t)((uint32_t)p->x+(uint32_t)correction);
    if(!(selected&1))p->angle=stage&128?(uint8_t)(128-selected):selected;
}
void sonic_native_attached_contact(SonicRecoveredContactActor *p,uint32_t stage)
{
    if(p->flags&8){p->contact_angles[0]=p->contact_angles[1]=0;return;}
    int32_t angle=(int8_t)(stage&128?(uint8_t)(128-p->angle):p->angle);
    /* Native signed-angle tie rule differs from generic nearest quadrant at
     * exact +/-32 boundaries; retaining it matters on curved contact. */
    unsigned orientation=(uint8_t)(angle+((angle>-32 && angle<=0)?32:31))>>6;
    SonicRecoveredTerrain t=live_terrain();
    sonic_recovered_attached_contact(&t,p,orientation,stage);
}
