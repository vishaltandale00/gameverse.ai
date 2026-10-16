#include "runtime.h"
#define REG32(a) (*(volatile uint32_t*)(a))
#define REG16(a) (*(volatile uint16_t*)(a))
static volatile uint16_t*draw;
static unsigned page;
void*memset(void*p,int v,unsigned n){unsigned char*q=p;while(n--)*q++=(unsigned char)v;return p;}
void*memcpy(void*p,const void*s,unsigned n){unsigned char*q=p;const unsigned char*r=s;while(n--)*q++=*r++;return p;}
unsigned __aeabi_uidiv(unsigned n,unsigned d){if(!d)return 0;unsigned q=0,r=0;for(int i=31;i>=0;i--){unsigned carry=r>>31;r=(r<<1)|((n>>i)&1);if(carry||r>=d){r-=d;q|=1u<<i;}}return q;}
void __aeabi_memclr(void*p,unsigned n){memset(p,0,n);}
void __aeabi_memclr4(void*p,unsigned n){memset(p,0,n);}
void __aeabi_memcpy(void*p,const void*s,unsigned n){memcpy(p,s,n);}
void __aeabi_memcpy4(void*p,const void*s,unsigned n){memcpy(p,s,n);}
static uint16_t rgb(unsigned r,unsigned g,unsigned b){return r|(g<<5)|(b<<10);}
void runtime_initialize(void){draw=(volatile uint16_t*)0x0600a000;REG16(0x04000208)=0;REG16(0x04000000)=0x404;volatile uint16_t*p=(volatile uint16_t*)0x05000000;const uint8_t palette[][3]={{2,3,6},{3,5,9},{4,8,12},{5,12,16},{8,18,20},{10,27,25},{24,30,28},{31,21,10},{31,12,7},{16,6,12},{8,14,19},{7,10,14},{31,30,24},{12,22,25},{15,8,17},{5,5,10}};for(unsigned i=0;i<16;i++)p[i]=rgb(palette[i][0],palette[i][1],palette[i][2]);}
void runtime_wait_frame(void){while(REG16(0x04000006)>=160){}while(REG16(0x04000006)<160){}REG16(0x04000000)=0x404|(page?16:0);page^=1;draw=(volatile uint16_t*)(page?0x0600a000:0x06000000);}
uint32_t runtime_input_keys(void){return(~REG16(0x04000130))&1023;}
uint32_t runtime_floor_query(uint32_t x,uint32_t before,uint32_t after){int32_t px=(int32_t)x,py=(int32_t)before,ny=(int32_t)after;int32_t best=0x7fffffff;for(unsigned i=0;i<world_terrain_count;i++){const RuntimeRect*r=&world_terrain[i];if(px+5>=r->x&&px-5<r->x+r->w&&py<=r->y&&ny>=r->y&&r->y<best)best=r->y;}return(uint32_t)best;}
void runtime_clear(uint32_t color){uint32_t fill=(color&255)*0x01010101u;REG32(0x040000d4)=(uint32_t)&fill;REG32(0x040000d8)=(uint32_t)draw;REG32(0x040000dc)=0x85002580;while(REG32(0x040000dc)&0x80000000u){}}
static void pixel(int32_t x,int32_t y,unsigned c){if((unsigned)x>=240||(unsigned)y>=160)return;unsigned p=(y*240+x)>>1;uint16_t old=draw[p];draw[p]=x&1?(old&255)|((c&255)<<8):(old&0xff00)|(c&255);}
void runtime_rect(int32_t x,int32_t y,int32_t w,int32_t h,uint32_t c){if(x<0){w+=x;x=0;}if(y<0){h+=y;y=0;}if(x+w>240)w=240-x;if(y+h>160)h=160-y;if(w<=0||h<=0)return;for(int32_t yy=y;yy<y+h;yy++){int32_t xx=x;if(xx&1){pixel(xx++,yy,c);}if((xx&3)&&xx+1<x+w){draw[(yy*240+xx)>>1]=(c&255)*257;xx+=2;}for(;xx+3<x+w;xx+=4)((volatile uint32_t*)draw)[(yy*240+xx)>>2]=(c&255)*0x01010101u;if(xx+1<x+w){draw[(yy*240+xx)>>1]=(c&255)*257;xx+=2;}if(xx<x+w)pixel(xx,yy,c);}}
void runtime_line(int32_t x,int32_t y,int32_t w,uint32_t c){runtime_rect(x,y,w,1,c);}
/* Authored compact3x5 UI glyphs. Rendering service, not recovered game logic. */
static const uint16_t glyphs[]={0x7b6f,0x2492,0x73e7,0x73cf,0x5bc9,0x79cf,0x79ef,0x7249,0x7bef,0x7bcf,0x2bed,0x6bae,0x7927,0x6b6e,0x79a7,0x79a4,0x796f,0x5bed,0x7497,0x126a,0x5bad,0x4927,0x5fed,0x5f6d,0x7b6f,0x7be4,0x7b7b,0x7bad,0x79cf,0x7492,0x5b6f,0x5b6a,0x5bfd,0x5aad,0x5a92,0x72a7};
void runtime_text(int32_t x,int32_t y,const char*s,uint32_t c){while(*s){unsigned char a=*s++;if(a>='a'&&a<='z')a-=32;uint16_t bits=0;if(a>='0'&&a<='9')bits=glyphs[a-'0'];else if(a>='A'&&a<='Z')bits=glyphs[a-'A'+10];else if(a=='-')bits=0x1c0;else if(a==':')bits=0x410;for(int j=0;j<5;j++)for(int i=0;i<3;i++)if(bits&(1u<<(14-j*3-i)))pixel(x+i,y+j,c);x+=4;}}
void runtime_number(int32_t x,int32_t y,uint32_t n,uint32_t c){char s[11];unsigned i=10;s[i]=0;do{unsigned q=0,r=n;/* Small UI numbers; no division runtime dependency. */while(r>=10){r-=10;q++;}s[--i]='0'+r;n=q;}while(n&&i);runtime_text(x,y,s+i,c);}
