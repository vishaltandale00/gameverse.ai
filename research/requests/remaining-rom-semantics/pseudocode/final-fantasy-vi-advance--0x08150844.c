
void FUN_08150844(int *param_1,uint param_2)

{
  undefined2 uVar1;
  code *UNRECOVERED_JUMPTABLE;
  
  if ((int)(param_2 * 0x1000000) < 0) {
    uVar1 = 0xffff;
  }
  else {
    uVar1 = *(undefined2 *)(*param_1 + 0xc + (param_2 & 0xff) * 2);
  }
                    /* WARNING: Could not recover jumptable at 0x08150864. Too many branches */
                    /* WARNING: Treating indirect jump as call */
  (*UNRECOVERED_JUMPTABLE)(uVar1);
  return;
}

