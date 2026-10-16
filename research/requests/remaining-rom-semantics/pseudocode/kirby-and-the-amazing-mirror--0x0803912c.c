
void FUN_0803912c(int param_1,int param_2)

{
  undefined4 uVar1;
  int iVar2;
  int iVar3;
  code *UNRECOVERED_JUMPTABLE;
  undefined1 uStack_18;
  undefined1 uStack_16;
  undefined1 uStack_14;
  undefined1 uStack_12;
  
  if ((*(uint *)(param_1 + 8) & 1) == 0) {
    uStack_18 = *(char *)(param_1 + 0x3c);
    uStack_16 = *(char *)(param_1 + 0x3e);
  }
  else {
    uStack_16 = -*(char *)(param_1 + 0x3c);
    uStack_18 = -*(char *)(param_1 + 0x3e);
  }
  if ((*(uint *)(param_2 + 8) & 1) == 0) {
    uStack_14 = *(char *)(param_2 + 0x3c);
    uStack_12 = *(char *)(param_2 + 0x3e);
  }
  else {
    uStack_12 = -*(char *)(param_2 + 0x3c);
    uStack_14 = -*(char *)(param_2 + 0x3e);
  }
  iVar3 = *(int *)(param_1 + 0x40) + uStack_18 * 0x100;
  iVar2 = *(int *)(param_2 + 0x40) + uStack_14 * 0x100;
  if (iVar2 < iVar3) {
LAB_080391f2:
    if (iVar3 <= iVar2 + ((int)uStack_12 - (int)uStack_14) * 0x100) {
LAB_08039200:
      iVar3 = *(int *)(param_1 + 0x44) + *(char *)(param_1 + 0x3d) * 0x100;
      iVar2 = *(int *)(param_2 + 0x44) + *(char *)(param_2 + 0x3d) * 0x100;
      if (iVar2 < iVar3) {
LAB_08039234:
        if (iVar2 + ((int)*(char *)(param_2 + 0x3f) - (int)*(char *)(param_2 + 0x3d)) * 0x100 <
            iVar3) goto LAB_08039252;
      }
      else if (iVar3 + ((int)*(char *)(param_1 + 0x3f) - (int)*(char *)(param_1 + 0x3d)) * 0x100 <
               iVar2) {
        if (iVar3 < iVar2) goto LAB_08039252;
        goto LAB_08039234;
      }
      if (*(short *)(param_1 + 0x52) < 1) {
        uVar1 = 1;
        goto LAB_08039254;
      }
    }
  }
  else {
    if (iVar2 <= iVar3 + ((int)uStack_16 - (int)uStack_18) * 0x100) goto LAB_08039200;
    if (iVar2 <= iVar3) goto LAB_080391f2;
  }
LAB_08039252:
  uVar1 = 0;
LAB_08039254:
                    /* WARNING: Could not recover jumptable at 0x0803925a. Too many branches */
                    /* WARNING: Treating indirect jump as call */
  (*UNRECOVERED_JUMPTABLE)(uVar1);
  return;
}

