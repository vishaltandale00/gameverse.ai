#pragma once
#include <stdint.h>
#include "generated/mzm_progress/acquire/component.h"
typedef gv_mzm_acquire_State GvProgressState;
_Static_assert(sizeof(GvProgressState)==36,"owned source equipment and event bank extent");
/* Reward index follows existing GV_MORPH..GV_SCREW bit order. */
uint8_t gv_progress_event(GvProgressState *,uint32_t event,uint8_t operation);
uint32_t gv_progress_owned(GvProgressState *);
int gv_progress_acquire_reward(GvProgressState *,unsigned reward);
