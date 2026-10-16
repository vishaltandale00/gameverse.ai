
/* WARNING: Possible PIC construction at 0x08014ad0: Changing call to branch */
/* WARNING: Restarted to delay deadcode elimination for space: ram */

void FUN_08014a6c(void)

{
  char cVar1;
  byte bVar2;
  short sVar3;
  uint uVar4;
  int iVar5;
  int iVar6;
  int iVar7;
  code *UNRECOVERED_JUMPTABLE;
  uint uStack_28;
  
  iVar6 = iRam020205b0;
  uStack_28 = 0;
  if ((iRam020206b0 != 0) &&
     (((*(uint *)(iRam020206b0 + 8) & 0x8000) != 0 ||
      ((*(uint *)(iRam020206b0 + 0xc) & 0x4000) != 0)))) {
    sRam020206a4 = 0;
    sRam020206a6 = 0;
    iRam020206b0 = 0;
  }
  cVar1 = FUN_08003dc0(0x20205a0);
  if (cVar1 != '\0') goto SUB_080153b4;
  FUN_080149dc(0x20205a0);
  if ((((uRam020205a8 & 0x8000000) != 0) || ((uRam02028118 & 8) == 0)) &&
     (((uRam020205a8 & 0x1000) != 0 || ((uRam02028118 & 2) == 0)))) {
    if (uRam02020650._2_2_ != 0) {
      if ((sRam0202064a < sRam0202064e) || ((uRam02028118 & 0x40) != 0)) {
        uRam02020650 = uRam02020650 & 0xffff;
      }
      if (uRam02020650._2_2_ != 0) {
        sVar3 = uRam02020650._2_2_ + -1;
        uRam02020650 = CONCAT22(sVar3,(short)uRam02020650);
        if (sVar3 != 0) goto LAB_08014b78;
      }
      sRam0202064e = 0;
    }
LAB_08014b78:
    if (uRam02020658 != 0) {
      uRam02020658 = uRam02020658 - 1;
      if ((uRam02028118 & 0x40) != 0) {
        uRam02020658 = 0;
      }
      uRam020205ec = 0x405;
      uRam020205f4 = 0x40000021;
      if (uRam02020658 == 0) {
        uRam020205ec = 0x402;
        uRam020205f4 = 0x40000421;
      }
    }
    if ((short)uRam02020650 != 0) {
      uRam02020650._0_2_ = (short)uRam02020650 + -1;
      if ((uRam02028118 & 0x40) != 0) {
        uRam02020650._0_2_ = 0;
      }
      uRam020205ec = 0x1fdff;
      uRam020205f4 = 0x40000021;
      if ((uRam02028114 & 0x18) == 0) {
        uRam020205f4 = 0x33;
      }
      if ((short)uRam02020650 == 0) {
        uRam020205ec = 0x402;
        uRam020205f4 = 0x40000421;
      }
    }
    if (((uRam02020650 != 0) && ((uRam02028110 & 7) == 0)) && ((uRam020205a8 & 0x800) == 0)) {
      if (100 < (short)uRam02020650) {
        uVar4 = uRam03006c50 * 0x196225 + 0x3c6ef35f;
        uRam03006c50 = uVar4 * 0x196225 + 0x3c6ef35f;
        func_0x0800de84(0x20205a0,(int)((0xf - (uVar4 >> 0x10 & 0x1f)) * 0x10000) >> 0x10,
                        (int)((0xf - (uRam03006c50 >> 0x10 & 0x1f)) * 0x10000) >> 0x10);
      }
      uRam02020633 = 0;
      func_0x0800c7c8(0x20205a0,&UNK_08a41558);
    }
    uVar4 = (uint)bRam02020673;
    if (uVar4 != 0) {
      if (uVar4 < 9) {
        uRam020205dc = (&UNK_08a384d8)[-uVar4];
      }
      bRam02020673 = bRam02020673 - 1;
      if (bRam02020673 == 0) {
        uRam020205a8 = uRam020205a8 & 0xfffdffff;
        uRam020205dc = 0;
      }
    }
    if (bRam02020680 != 0) {
      if (bRam02020680 < 9) {
        uRam020205dc = (&UNK_08a384d8)[-(uint)bRam02020680];
      }
      if (bRam02020680 < 5) {
        uRam02020633 = 0;
      }
      else if (bRam02020680 == 8) {
        uRam02020633 = 3;
      }
      bRam02020680 = bRam02020680 - 1;
      if (bRam02020680 == 0) {
        uRam020205dc = 0;
      }
    }
    if (bRam0202066d == 0) {
LAB_08014da4:
      if ((cRam0202066e != '\0') && (cRam0202066e = cRam0202066e + -1, (uRam020205a8 & 0x20) == 0))
      {
        cRam0202066e = '\0';
      }
      if (((uRam020205ac & 0x1000) == 0) && ((uRam020205a8 & 0x900) == 0)) {
        if ((((bRam020205a1 & 1) == 0) || ((bRam020205a1 & 2) == 0)) &&
           ((bRam020205a1 & 0xc) != 0xc)) {
          cRam0202067b = '\0';
        }
        else {
          if ((uRam020205a8 & 0x100) == 0) {
            cRam0202067b = cRam0202067b + '\x01';
          }
          if (('\x10' < cRam0202067b) && (0 < sRam02020646)) {
            sRam02020646 = 0;
            func_0x080259bc(0x20205a0);
          }
        }
      }
      if (iRam020205b0 != 0) {
        FUN_08116a20(0x20205a0);
        if ((uRam020205ac & 0x800) != 0) {
          uRam020205ac = uRam020205ac & 0xfffff7ff;
          goto SUB_080153b4;
        }
        if (iVar6 != iRam020205b0) {
          FUN_08116a20(0x20205a0);
        }
      }
      if ((uRam020205ac & 0x800) != 0) {
        uRam020205ac = uRam020205ac & 0xfffff7ff;
        goto SUB_080153b4;
      }
      if (iRam02020698 != 0) {
        if ((uRam020205ac & 0x2000) == 0) {
          iRam02020694 = iRam02020698;
          uRam020205ac = uRam020205ac | 0x2000;
        }
        uRam02020692 = uRam02020690;
      }
      if (uRam02020654 != 0) {
        sRam020205cc = uRam02020654 + sRam020205cc;
      }
      if ((uRam020205a8 & 0x800) == 0) {
        if (((uRam020205a8 & 0x20) != 0) &&
           ((((bRam020205a1 & 1) == 0 || ((uRam020205a8 & 0x100) != 0)) &&
            (sRam020205ce = sRam020205d4 + sRam020205ce, sRam020205d6 < sRam020205ce)))) {
          sRam020205ce = sRam020205d6;
        }
        uRam020205c4 = uRam020205bc;
        iRam020205c8 = iRam020205c0;
        sRam020205cc = sRam020205d0 + sRam020205cc;
        sRam020205ce = sRam020205d2 + sRam020205ce;
        iRam020205c0 = iRam020205c0 + sRam020205ce;
        uRam020205bc = uRam020205bc + (int)sRam020205cc & uRam0202811c;
      }
      if ((uRam020205ac & 0x1000) != 0) {
        uRam020205bc = uRam020205bc + (int)sRam020206a0;
        iRam020205c0 = iRam020205c0 + sRam020206a2;
      }
      sRam020206a0 = 0;
      sRam020206a2 = 0;
      sRam0202068c = sRam020205ce;
      if ((short)uRam02020690 != 0) {
        iRam020205c0 = iRam020205c0 + (short)uRam02020690;
        if ((short)uRam02020690 < 0) {
          iVar6 = (uint)uRam02020690 + (uint)*(ushort *)(&UNK_08a416f6 + (uint)bRam0202066a * 2);
          uRam02020690 = (ushort)iVar6;
          if (0 < iVar6 * 0x10000) {
            uRam02020690 = 0;
          }
        }
        else {
          iVar6 = (uint)uRam02020690 - (uint)*(ushort *)(&UNK_08a416f6 + (uint)bRam0202066a * 2);
          uRam02020690 = (ushort)iVar6;
          if (iVar6 * 0x10000 < 0) {
            uRam02020690 = 0;
          }
        }
        if (((int)sRam02020612 <= (iRam020205c0 >> 8) + 0x10 + (int)cRam0202060b) &&
           (iRam020205c0 = ((sRam02020612 + -0x10) - (int)cRam0202060b) * 0x100, iRam02020698 != 0))
        {
          iRam02020698 = iRam02020694 + -1;
        }
      }
      FUN_08005d08(0x20205a0);
      if (uRam02020654 != 0) {
        sRam020205cc = sRam020205cc - uRam02020654;
        if ((short)uRam02020654 < 1) {
          iVar6 = uRam02020654 + 0x14;
          uRam02020654 = (ushort)iVar6;
          if (0 < iVar6 * 0x10000) goto LAB_08015052;
        }
        else {
          iVar6 = uRam02020654 - 0x14;
          uRam02020654 = (ushort)iVar6;
          if (iVar6 * 0x10000 < 0) {
LAB_08015052:
            uRam02020654 = 0;
          }
        }
      }
      if (iRam02020698 == 0) {
        if ((uRam020205ac & 0x1000) != 0) {
          bRam020205a1 = bRam020205a1 | 1;
        }
      }
      else {
        sVar3 = sRam020205ce;
        if (((bRam020205a1 & 1) != 0) && ((uRam020205a8 & 0x20) == 0)) {
          sVar3 = (short)iRam020205c0 - (short)iRam020205c8;
        }
        iRam02020694 = iRam02020694 + sVar3;
        if ((bRam020205a1 & 1) != 0) {
          if (((uRam020205ac & 0x1000) != 0) && (iRam02020698 - iRam02020694 < 0x1500)) {
            sRam0202068e = (short)((uint)((int)&UNK_00001500 - (iRam02020698 - iRam02020694)) >> 8);
            iRam02020698 = iRam02020698 + sRam0202068e * 0x100;
          }
          uRam020205ac = uRam020205ac & 0xffffefff;
        }
        if (((int)sRam02020612 <= (iRam020205c0 >> 8) + 0x10 + (int)cRam0202060b) &&
           (iRam020205c0 = ((sRam02020612 + -0x10) - (int)cRam0202060b) * 0x100, iRam02020698 != 0))
        {
          iRam02020698 = iRam02020694 + -1;
        }
        if (iRam02020698 < iRam02020694) {
          bRam020205a1 = bRam020205a1 | 1;
          iRam02020698 = 0;
          uRam020205ac = uRam020205ac & 0xffffdfff | 0x1000;
        }
      }
      uRam02020620 = *(undefined2 *)
                      (sRam02020644 * 4 + *(int *)(&UNK_08d2bd24 + (uint)bRam0202066a * 4));
      uRam0202062e = *(undefined1 *)
                      (sRam02020644 * 4 + *(int *)(&UNK_08d2bd24 + (uint)bRam0202066a * 4) + 2);
    }
    else {
      bVar2 = bRam0202066d - 1;
      if (bRam0202066d == 1) {
        uRam020205dc = 0;
        bRam0202066d = bVar2;
        goto LAB_08014da4;
      }
      uStack_28 = uRam020205a8 & 8;
      uRam020205dc = (&UNK_08a384d0)[5 - bVar2 & 3];
      uRam020205a8 = uRam020205a8 | 8;
      uRam0202068a = uRam0202068a | uRam02020684;
      uRam020205bc = uRam020205bc & uRam0202811c;
      bRam0202066d = bVar2;
      FUN_08005d08(0x20205a0);
    }
    if ((sRam02020656 != 0) && ((uRam02028110 & 3) == 0)) {
      sRam02020656 = sRam02020656 + -1;
    }
  }
  if (uRam02020658 != 0) {
    uRam020205ec = 0x405;
    uRam020205f4 = 0x40000021;
  }
  if ((short)uRam02020650 != 0) {
    uRam020205ec = 0x1fdff;
    uRam020205f4 = 0x40000021;
    if ((uRam02028114 & 0x18) == 0) {
      uRam020205f4 = 0x33;
    }
  }
  FUN_08003314(0x20205a0,0x2020614);
  if (bRam0202066d == 0) {
    uRam0202068a = 0;
  }
  else if (uStack_28 == 0) {
    uRam020205a8 = uRam020205a8 & 0xfffffff7;
  }
  if ((uRam020205ac & 0x40) == 0) {
    if (iRam020206b0 != 0) {
      sRam020206a4 = (short)((int)(*(int *)(iRam020206b0 + 0x1c) - uRam020205bc) >> 9);
      if (0x48 < sRam020206a4) {
        sRam020206a4 = 0x48;
      }
      if (sRam020206a4 < -0x48) {
        sRam020206a4 = -0x48;
      }
      sRam020206a6 = (short)(*(int *)(iRam020206b0 + 0x20) - iRam020205c0 >> 9);
      if (0x40 < sRam020206a6) {
        sRam020206a6 = 0x40;
      }
      if (sRam020206a6 < -0x24) {
        sRam020206a6 = -0x24;
      }
    }
    iVar7 = (int)sRam020206a8;
    iVar6 = (int)sRam020206a4;
    if (iVar7 != iVar6) {
      iVar5 = iVar7 - iVar6 >> 3;
      if (iVar5 == 0) {
        if (iVar6 < iVar7) {
          sRam020206a8 = sRam020206a8 + -1;
        }
        else {
          sRam020206a8 = sRam020206a8 + 1;
        }
      }
      else {
        sRam020206a8 = sRam020206a8 - (short)iVar5;
      }
    }
    iVar7 = (int)sRam020206aa;
    iVar6 = (int)sRam020206a6;
    if (iVar7 != iVar6) {
      iVar5 = iVar7 - iVar6 >> 3;
      if (iVar5 == 0) {
        if (iVar6 < iVar7) {
          sRam020206aa = sRam020206aa + -1;
        }
        else {
          sRam020206aa = sRam020206aa + 1;
        }
      }
      else {
        sRam020206aa = sRam020206aa - (short)iVar5;
      }
    }
    if ((uRam02028118 & 0x10040) == 0x40) {
      FUN_080a7850((int)uRam020205bc >> 8,iRam020205c0 >> 8);
    }
    else {
      if (iRam02024780 != 0) {
        if (iRam02024780 >> 3 == 0) {
          if (iRam02024780 < 1) {
            iRam02024780 = iRam02024780 + 1;
          }
          else {
            iRam02024780 = iRam02024780 + -1;
          }
        }
        else {
          iRam02024780 = iRam02024780 - (iRam02024780 >> 3);
        }
      }
      if (iRam02024784 != 0) {
        if (iRam02024784 >> 3 == 0) {
          if (iRam02024784 < 1) {
            iRam02024784 = iRam02024784 + 1;
          }
          else {
            iRam02024784 = iRam02024784 + -1;
          }
        }
        else {
          iRam02024784 = iRam02024784 - (iRam02024784 >> 3);
        }
      }
      FUN_080a7850(((int)uRam020205bc >> 8) + (int)sRam020206a8,
                   (iRam020205c0 >> 8) + (int)sRam020206aa);
    }
  }
  else {
    FUN_080a7850(((int)uRam020205c4 >> 8) + (int)sRam020206a8,
                 (iRam020205c8 >> 8) + (int)sRam020206aa);
  }
  if ((uRam02020658 & 2) == 0) {
    FUN_08003498(0x20205a0,0x2020614);
  }
  FUN_080050b4(0x20205a0);
SUB_080153b4:
                    /* WARNING: Could not recover jumptable at 0x080153c2. Too many branches */
                    /* WARNING: Treating indirect jump as call */
  (*UNRECOVERED_JUMPTABLE)();
  return;
}

