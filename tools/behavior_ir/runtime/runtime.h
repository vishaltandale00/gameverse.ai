#ifndef GAMEVERSE_THIN_RUNTIME_H
#define GAMEVERSE_THIN_RUNTIME_H
#include <stdint.h>
typedef struct {int16_t x,y,w,h;} RuntimeRect;
extern const RuntimeRect world_terrain[];
extern const unsigned world_terrain_count;
void runtime_initialize(void);
void runtime_wait_frame(void);
uint32_t runtime_input_keys(void);
uint32_t runtime_floor_query(uint32_t x,uint32_t previous_bottom,uint32_t next_bottom);
void runtime_clear(uint32_t color);
void runtime_rect(int32_t x,int32_t y,int32_t w,int32_t h,uint32_t color);
void runtime_line(int32_t x,int32_t y,int32_t w,uint32_t color);
void runtime_text(int32_t x,int32_t y,const char*text,uint32_t color);
void runtime_number(int32_t x,int32_t y,uint32_t value,uint32_t color);
#endif
