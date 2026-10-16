/* Generated executable typed frame graph from campaign IR. */
#include "game.h"
void gv_tick_components(GvState *state,GvPlayer *player,uint16_t keys,uint16_t edges){
gv_resources_step(state,player);
if(!(player->flags&0x80))gv_weapons_step(state,player,keys,edges);
if(!(player->flags&0x80))gv_progression_step(state,player,keys,edges);
if(!(player->flags&0x80))gv_ecology_step(state,player);
gv_draw_game(state,player);
}
