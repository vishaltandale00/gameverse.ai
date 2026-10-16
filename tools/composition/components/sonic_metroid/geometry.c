#include "game.h"
#include "../../../../research/requests/sonic-recovered-contact.c"
int gv_is_solid(int x,int y)
{
    SonicRecoveredTerrain t=live_terrain();int8_t angle;
    int h=sonic_recovered_profile_x(&t,x,y,GV_R8(0x03005a47),&angle);
    int sample=(uint32_t)y&7;
    return h==8 || (h>0 && sample>=h-1) || (h<0 && sample<=-h);
}
int gv_floor_y(int x,int preferred,int extent)
{
    SonicRecoveredTerrain t=live_terrain();int best=preferred,bestDistance=0x7fffffff;
    for(int y=preferred-extent;y<=preferred+extent;y+=8){
        int8_t angle=0;int d=sonic_recovered_scan_distance(&t,y,x,GV_R8(0x03005a47),8,&angle,1);
        if(d>=-8 && d<=8 && ((uint8_t)(angle+32)&0xc0)==0){
            int candidate=y+d,delta=gv_abs(candidate-preferred);
            if(delta<bestDistance){best=candidate;bestDistance=delta;}
        }
    }
    return best;
}
#if defined(__arm__)
/* ARM EABI divmod returns quotient in r0 and remainder in r1, matching the
 * low/high words of this freestanding 64-bit scalar return. No libc/BSS. */
uint64_t __aeabi_uidivmod(unsigned n,unsigned d)
{unsigned q=__aeabi_uidiv(n,d);return ((uint64_t)(n-q*d)<<32)|q;}
#endif
