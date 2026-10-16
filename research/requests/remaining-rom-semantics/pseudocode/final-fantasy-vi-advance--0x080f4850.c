
void FUN_080f4850(void)

{
  word wVar1;
  byte bVar2;
  byte *pbVar3;
  uint uVar4;
  uint uVar5;
  code *UNRECOVERED_JUMPTABLE;
  
  wVar1 = REG_KEYINPUT;
  pbVar3 = (byte *)0x3002620;
  uVar4 = 0;
  uRam03002650 = ~wVar1 & 0x3ff & ~uRam0300264c;
  uVar5 = 0x200;
  uRam0300264c = ~wVar1 & 0x3ff;
  do {
    if ((uVar5 & uRam03002650) == 0) {
      if ((uVar5 & uRam0300264c) == 0) goto LAB_080f48e2;
      if (*pbVar3 < bRam03002648) {
        bVar2 = *pbVar3 + 1;
        goto LAB_080f48e6;
      }
      if (pbVar3[1] < bRam03002649) {
        pbVar3[1] = pbVar3[1] + 1;
      }
      else {
        pbVar3[1] = 0;
        uVar4 = uVar4 | uVar5;
      }
    }
    else {
      uVar4 = uVar4 | uVar5;
LAB_080f48e2:
      bVar2 = 0;
      pbVar3[1] = 0;
LAB_080f48e6:
      *pbVar3 = bVar2;
    }
    uVar5 = uVar5 >> 1;
    pbVar3 = pbVar3 + 4;
    if (uVar5 == 0) {
      uRam03002654 = (undefined2)uVar4;
                    /* WARNING: Could not recover jumptable at 0x080f48fe. Too many branches */
                    /* WARNING: Treating indirect jump as call */
      (*UNRECOVERED_JUMPTABLE)();
      return;
    }
  } while( true );
}

