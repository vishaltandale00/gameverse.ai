#include <stdint.h>
static __attribute__((unused)) uint64_t ir_mask(unsigned w){return w==64?UINT64_MAX:(UINT64_C(1)<<w)-1;}
static __attribute__((unused)) uint64_t ir_shl(uint64_t v,unsigned n,unsigned w){return n>=w?0:(v<<n)&ir_mask(w);}
static __attribute__((unused)) uint64_t ir_lsr(uint64_t v,unsigned n,unsigned w){return n>=w?0:(v&ir_mask(w))>>n;}
static __attribute__((unused)) uint64_t ir_asr(uint64_t v,unsigned n,unsigned w){uint64_t m=ir_mask(w);v&=m;uint64_t sign=(v>>(w-1))&1;if(n>=w)return sign?m:0;if(!n)return v;return (v>>n)|(sign?(m^(m>>n)):0);}
static __attribute__((unused)) uint64_t ir_sext(uint64_t v,unsigned src,unsigned dst){uint64_t m=ir_mask(src);v&=m;return v& (UINT64_C(1)<<(src-1))?v|(ir_mask(dst)^m):v;}
typedef struct {
 uint16_t field_0;
 uint8_t field_1;
 uint8_t field_2;
 uint8_t field_3;
 uint8_t field_4;
 uint8_t field_5;
 uint8_t field_6;
 uint8_t field_7;
 uint8_t field_8;
} gv_mzm_impact_State;
uint32_t gv_mzm_impact(gv_mzm_impact_State*s,uint16_t param_0){
 uint16_t value_6 __attribute__((unused));
 uint8_t value_22 __attribute__((unused));
 uint8_t value_46 __attribute__((unused));
 uint8_t value_54 __attribute__((unused));
 uint32_t value_96 __attribute__((unused));
 uint8_t value_103 __attribute__((unused));
 uint8_t value_112 __attribute__((unused));
 value_6 = s->field_0;
 if (((uint8_t)((param_0) < (value_6)))) {
  s->field_0 = ((uint16_t)((uint32_t)(value_6) - (uint32_t)(param_0)));
  value_96 = ((uint32_t)UINT64_C(0));
  value_103 = s->field_4;
  s->field_4 = ((uint8_t)((uint32_t)(((uint8_t)((uint32_t)(value_103) & (uint32_t)(((uint8_t)UINT64_C(128)))))) | (uint32_t)(((uint8_t)UINT64_C(17)))));
  value_112 = s->field_7;
  s->field_7 = ((uint8_t)((uint32_t)(value_112) | (uint32_t)(((uint8_t)UINT64_C(2)))));
  return value_96;
 } else {
  s->field_0 = ((uint16_t)UINT64_C(0));
  value_22 = s->field_7;
  s->field_7 = ((uint8_t)((uint32_t)(value_22) | (uint32_t)(((uint8_t)UINT64_C(16)))));
  s->field_5 = ((uint8_t)UINT64_C(0));
  s->field_1 = ((uint8_t)UINT64_C(0));
  value_46 = s->field_6;
  if (((uint8_t)((value_46) != (((uint8_t)UINT64_C(0)))))) {
   value_54 = s->field_8;
   if (((uint8_t)((value_54) == (((uint8_t)UINT64_C(1)))))) {
    s->field_8 = ((uint8_t)UINT64_C(2));
    s->field_6 = ((uint8_t)UINT64_C(0));
    s->field_2 = ((uint8_t)UINT64_C(98));
    s->field_3 = ((uint8_t)UINT64_C(1));
    value_96 = ((uint32_t)UINT64_C(1));
    value_103 = s->field_4;
    s->field_4 = ((uint8_t)((uint32_t)(((uint8_t)((uint32_t)(value_103) & (uint32_t)(((uint8_t)UINT64_C(128)))))) | (uint32_t)(((uint8_t)UINT64_C(17)))));
    value_112 = s->field_7;
    s->field_7 = ((uint8_t)((uint32_t)(value_112) | (uint32_t)(((uint8_t)UINT64_C(2)))));
    return value_96;
   } else {
    s->field_2 = ((uint8_t)UINT64_C(98));
    s->field_3 = ((uint8_t)UINT64_C(1));
    value_96 = ((uint32_t)UINT64_C(1));
    value_103 = s->field_4;
    s->field_4 = ((uint8_t)((uint32_t)(((uint8_t)((uint32_t)(value_103) & (uint32_t)(((uint8_t)UINT64_C(128)))))) | (uint32_t)(((uint8_t)UINT64_C(17)))));
    value_112 = s->field_7;
    s->field_7 = ((uint8_t)((uint32_t)(value_112) | (uint32_t)(((uint8_t)UINT64_C(2)))));
    return value_96;
   }
  } else {
   s->field_2 = ((uint8_t)UINT64_C(98));
   s->field_3 = ((uint8_t)UINT64_C(1));
   value_96 = ((uint32_t)UINT64_C(1));
   value_103 = s->field_4;
   s->field_4 = ((uint8_t)((uint32_t)(((uint8_t)((uint32_t)(value_103) & (uint32_t)(((uint8_t)UINT64_C(128)))))) | (uint32_t)(((uint8_t)UINT64_C(17)))));
   value_112 = s->field_7;
   s->field_7 = ((uint8_t)((uint32_t)(value_112) | (uint32_t)(((uint8_t)UINT64_C(2)))));
   return value_96;
  }
 }
}
