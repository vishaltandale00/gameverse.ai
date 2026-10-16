
/* WARNING: Possible PIC construction at 0x0801e470: Changing call to branch */
/* WARNING: Removing unreachable block (ram,0x0801e474) */

void FUN_0801e178(void)

{
  byte bVar1;
  short sVar2;
  int iVar3;
  uint uVar4;
  uint uVar5;
  char cVar6;
  uint uVar7;
  uint uVar8;
  uint uVar9;
  int iVar10;
  code *UNRECOVERED_JUMPTABLE;
  
  if ((((cRam02005574 == '\0') && ((bRam03005568 & 4) != 0)) &&
      (iVar3 = FUN_08021634((int)sRam03005560,(int)sRam03005570 + (int)sRam03005584), iVar3 != 0))
     && (((&UNK_087336f0)[uRam03005578] == '\0' ||
         (((bRam0300553b & 1) != 0 &&
          ((int)(uint)bRam0300553c <= (int)sRam03005570 + (int)sRam03005584 >> 4)))))) {
    cVar6 = cRam03005564;
    if ((iRam03005598 != 0) && (cVar6 = -1, 0 < iRam03005598)) {
      cVar6 = '\x01';
    }
    if (cVar6 == '\x01') {
      iVar3 = func_0x08021ab4((int)sRam03005560 + (int)sRam0300559c,
                              (int)sRam03005570 + (int)sRam03005584);
      if (iVar3 != 0) {
        uVar7 = (uint)uRam03005578;
        if ((&UNK_087336f0)[uVar7] != '\0') {
          uVar7 = (uint)(char)(&UNK_087338f0)[uVar7];
        }
        cRam03005530 = cVar6;
        sVar2 = FUN_080219f0(uVar7 & 0xffff);
        sRam03005560 = sRam03005560 + sVar2;
        iVar3 = FUN_08021634((int)sRam03005560,(int)sRam03005570 + (int)sRam03005584);
        if (iVar3 != 0) {
          uVar7 = (uint)uRam03005578;
          if ((&UNK_087336f0)[uVar7] != '\0') {
            uVar7 = (uint)(char)(&UNK_087338f0)[uVar7];
          }
          sVar2 = FUN_080219f0(uVar7 & 0xffff);
LAB_0801e3e8:
          sRam03005560 = sRam03005560 + sVar2;
        }
      }
    }
    else {
      iVar3 = func_0x08021ab4((int)sRam03005560 + (int)sRam0300551c,
                              (int)sRam03005570 + (int)sRam03005584);
      if (iVar3 != 0) {
        cRam03005530 = '\x02';
        uVar7 = (uint)uRam03005578;
        if ((&UNK_087336f0)[uVar7] != '\0') {
          uVar7 = (uint)(char)(&UNK_087338f0)[uVar7];
        }
        sVar2 = FUN_080219d0(uVar7 & 0xffff);
        sRam03005560 = sRam03005560 + sVar2;
        iVar3 = FUN_08021634((int)sRam03005560,(int)sRam03005570 + (int)sRam03005584);
        if (iVar3 != 0) {
          uVar7 = (uint)uRam03005578;
          if ((&UNK_087336f0)[uVar7] != '\0') {
            uVar7 = (uint)(char)(&UNK_087338f0)[uVar7];
          }
          sVar2 = FUN_080219d0(uVar7 & 0xffff);
          goto LAB_0801e3e8;
        }
      }
    }
  }
  iVar10 = 0;
  iVar3 = FUN_080216d8((int)sRam03005560,(int)sRam03005584 + (int)sRam03005570);
  if ((bRam0300553d & 0x10) == 0) {
    if ((ushort)(uRam03005578 - 0x30) < 2) {
      bRam0300553d = 3;
    }
    else {
      bRam0300553d = 0;
    }
  }
  else {
    bRam0300553b = 1;
    if ((ushort)(uRam03005578 - 0x30) < 2) {
      bRam0300553d = 3;
      goto SUB_0801ecba;
    }
    bRam0300553d = 0;
  }
  if (iVar3 == 0) goto LAB_0801e600;
  if (((&UNK_087336f0)[uRam03005578] == '\0') ||
     (((bRam0300553b & 0x30) != 0 &&
      (bRam0300553b = 1,
      ((int)sRam03005570 & 0xfff0U) < ((int)sRam03005570 + (int)sRam03005584 & 0xfff0U))))) {
LAB_0801e532:
    uRam03005536 = 1;
    uRam03005532 = 1;
    uRam03005534 = (&UNK_08732cf0)[uRam03005578];
    sVar2 = FUN_080219b0(uRam03005578);
    sRam03005570 = sRam03005570 + sVar2;
    iVar3 = FUN_08021634((int)sRam03005560,(int)sRam03005570 + (int)sRam03005584);
    if ((iVar3 != 0) &&
       (((((&UNK_087336f0)[uRam03005578] == '\0' || ((&UNK_08732ef0)[uRam03005578] != '\x01')) ||
         ((bRam0300553b & 0x30) != 0)) ||
        (((bRam0300553b & 1) != 0 &&
         ((int)(uint)bRam0300553c <= (int)sRam03005570 + (int)sRam03005584 >> 4)))))) {
      uRam03005534 = (&UNK_08732cf0)[uRam03005578];
      sVar2 = FUN_080219b0(uRam03005578);
      sRam03005570 = sRam03005570 + sVar2;
    }
    bRam0300553c = (byte)((int)sRam03005570 + (int)sRam03005584 + 1 >> 4);
    goto SUB_0801ecba;
  }
  if ((bRam0300553b & 1) == 0) {
    if ((&UNK_08732ef0)[uRam03005578] == '\x01') goto LAB_0801e600;
  }
  else {
    if (((&UNK_08732ef0)[uRam03005578] != '\x01') ||
       ((int)(uint)bRam0300553c <= (int)sRam03005570 + (int)sRam03005584 >> 4)) goto LAB_0801e532;
LAB_0801e600:
    if ((&UNK_087336f0)[uRam03005588] == '\0') {
      bRam0300553b = bRam0300553b & 0xfe;
    }
    else {
      bRam0300553b = bRam0300553b | 1;
      if (((&UNK_087336f0)[uRam03005578] == '\0') || ((&UNK_08732cf0)[uRam03005578] == '\0')) {
        bRam0300553c = (byte)((int)sRam03005570 + (int)sRam03005584 + 0x10 >> 4);
      }
      else {
        bRam0300553c = (byte)((int)sRam03005570 + (int)sRam03005584 >> 4);
      }
    }
    uVar7 = (uint)*(ushort *)(&UNK_08735018 + (uint)uRam03005574 * 2);
    if (uVar7 != 0) {
      iVar10 = 2;
      if ((uRam03005574 & 1) != 0) {
        iVar10 = 1;
      }
      if (*(char *)(*(int *)(&UNK_087328f0 + uVar7 * 4) + (uint)uRam03005508) != '\0') {
        if ((uRam03005574 & 1) == 0) {
          if (((int)sRam03005560 & 0xfff0U) < ((int)sRam03005560 + (int)sRam0300559c & 0xfff0U)) {
            if ((&UNK_087336f0)[uVar7] != '\0') {
              bVar1 = bRam0300553b & 0x20;
              goto joined_r0x0801e74e;
            }
            goto LAB_0801e750;
          }
        }
        else if (((int)sRam03005560 + (int)sRam0300551c & 0xfff0U) < ((int)sRam03005560 & 0xfff0U))
        {
          if ((&UNK_087336f0)[uVar7] != '\0') {
            bVar1 = bRam0300553b & 0x10;
joined_r0x0801e74e:
            if (bVar1 == 0) goto LAB_0801e79c;
          }
LAB_0801e750:
          uRam03005536 = 1;
          uRam03005532 = 1;
          uRam03005534 = (&UNK_08732cf0)[uVar7];
          sVar2 = FUN_080219b0(uVar7);
          sRam03005570 = sRam03005570 + sVar2;
          bRam0300553c = (byte)((int)sRam03005570 + (int)sRam03005584 + 1 >> 4);
          goto SUB_0801ecba;
        }
      }
    }
  }
LAB_0801e79c:
  uVar8 = (uint)uRam03005578;
  uVar4 = (uint)uRam03005588;
  uVar9 = (uint)uRam03005574;
  uVar7 = (uint)uRam030055ac;
  iVar3 = FUN_080216d8((int)sRam03005560 + (int)sRam0300551c,(int)sRam03005570 + (int)sRam03005584);
  if (iVar3 == 0) {
    if ((&UNK_08732cf0)[uRam03005578] == '\0') {
LAB_0801e9a4:
      if (((iRam03005514 < 0) || ((&UNK_087336f0)[uRam03005588] == '\0')) ||
         ((&UNK_08732ef0)[uRam03005588] != '\x01')) goto LAB_0801e9fc;
      if ((&UNK_08732ef0)[uVar4] == '\0') {
        bRam0300553b = bRam0300553b | 2;
      }
      else {
        bRam0300553b = bRam0300553b & 0xfd;
      }
    }
    else {
LAB_0801e924:
      if (((iRam03005514 < 0) || ((&UNK_087336f0)[uRam03005588] == '\0')) ||
         ((&UNK_08732ef0)[uRam03005588] != '\x01')) {
LAB_0801e9fc:
        bVar1 = 0xed;
      }
      else {
        if (((&UNK_08732df0)[uRam03005578] & 0xf0) == 0x90) {
          uVar5 = uVar7;
          if (((&UNK_08732df0)[uRam03005578] & 0xcf) == 0x83) {
            uVar5 = uVar9;
          }
          if (*(short *)(&UNK_08735018 + uVar5 * 2) != 0) {
            bRam0300553b = bRam0300553b | 0x10;
            goto LAB_0801ea32;
          }
        }
        bVar1 = 0xef;
      }
      bRam0300553b = bVar1 & bRam0300553b;
    }
  }
  else {
    uVar5 = (uint)uRam03005578;
    if ((&UNK_08732cf0)[uVar5] == '\0') {
      if ((iVar10 != 1) &&
         (((&UNK_087339f0)[uVar8] == '\0' ||
          (((&UNK_087336f0)[uVar8] != '\0' && ((bRam0300553b & 1) == 0)))))) {
        if (((&UNK_087336f0)[uVar5] != '\0') &&
           (((bRam0300553b & 0x10) == 0 &&
            ((((bRam0300553b & 2) == 0 ||
              (((int)sRam03005560 + (int)sRam0300551c & 0xfff0U) != ((int)sRam0300550c & 0xfff0U)))
             || (((int)sRam03005570 + (int)sRam03005584 & 0xfff0U) <= ((int)sRam030055b0 & 0xfff0U))
             ))))) goto LAB_0801e9a4;
        bRam0300553b = bRam0300553b | 1;
        sVar2 = FUN_080219b0(uRam03005578);
        sRam03005570 = sRam03005570 + sVar2;
        uRam03005536 = 1;
        uRam03005532 = 1;
        bRam0300553c = (byte)((int)sRam03005570 + (int)sRam03005584 + 1 >> 4);
      }
    }
    else if (((&UNK_08732df0)[uVar5] != -0x6d) ||
            (((int)sRam03005570 + (int)sRam03005584 & 0xfU) < 8)) goto LAB_0801e924;
  }
LAB_0801ea32:
  iVar3 = FUN_080216d8((int)sRam03005560 + (int)sRam0300559c,(int)sRam03005570 + (int)sRam03005584);
  if (iVar3 == 0) {
    if ((&UNK_08732cf0)[uRam03005578] == '\0') goto LAB_0801ec24;
LAB_0801eba4:
    if (((-1 < iRam03005514) && ((&UNK_087336f0)[uRam03005588] != '\0')) &&
       ((&UNK_08732ef0)[uRam03005588] == '\x01')) {
      if (((&UNK_08732df0)[uRam03005578] & 0xf0) == 0xa0) {
        if (((&UNK_08732df0)[uRam03005578] & 0xcf) == 0x83) {
          uVar7 = uVar9;
        }
        if (*(short *)(&UNK_08735018 + uVar7 * 2) != 0) {
          bRam0300553b = bRam0300553b | 0x20;
          goto SUB_0801ecba;
        }
      }
      bRam0300553b = bRam0300553b & 0xdf;
      goto SUB_0801ecba;
    }
  }
  else {
    uVar5 = (uint)uRam03005578;
    if ((&UNK_08732cf0)[uVar5] != '\0') {
      if (((&UNK_08732df0)[uVar5] == -0x5d) && (7 < ((int)sRam03005570 + (int)sRam03005584 & 0xfU)))
      goto SUB_0801ecba;
      goto LAB_0801eba4;
    }
    if ((iVar10 == 2) ||
       (((&UNK_087339f0)[uVar8] != '\0' &&
        (((&UNK_087336f0)[uVar8] == '\0' || ((bRam0300553b & 1) != 0)))))) goto SUB_0801ecba;
    if (((&UNK_087336f0)[uVar5] == '\0') || ((bRam0300553b & 0x20) != 0)) {
LAB_0801eb40:
      bRam0300553b = bRam0300553b | 1;
      sVar2 = FUN_080219b0(uRam03005578);
      sRam03005570 = sRam03005570 + sVar2;
      uRam03005536 = 1;
      uRam03005532 = 1;
      bRam0300553c = (byte)((int)sRam03005570 + (int)sRam03005584 + 1 >> 4);
      goto SUB_0801ecba;
    }
    if ((bRam0300553b & 4) != 0) {
      if (((int)sRam03005560 + (int)sRam0300559c & 0xfff0U) != ((int)sRam03005590 & 0xfff0U))
      goto SUB_0801ecba;
      if (((int)sRam030055b0 & 0xfff0U) < ((int)sRam03005570 + (int)sRam03005584 & 0xfff0U))
      goto LAB_0801eb40;
    }
LAB_0801ec24:
    if (((-1 < iRam03005514) && ((&UNK_087336f0)[uRam03005588] != '\0')) &&
       ((&UNK_08732ef0)[uRam03005588] == '\x01')) {
      if ((&UNK_08732ef0)[uVar4] == '\0') {
        bRam0300553b = bRam0300553b | 4;
      }
      else {
        bRam0300553b = bRam0300553b & 0xfb;
      }
      goto SUB_0801ecba;
    }
  }
  bRam0300553b = bRam0300553b & 0xdb;
SUB_0801ecba:
                    /* WARNING: Could not recover jumptable at 0x0801ecc8. Too many branches */
                    /* WARNING: Treating indirect jump as call */
  (*UNRECOVERED_JUMPTABLE)();
  return;
}

