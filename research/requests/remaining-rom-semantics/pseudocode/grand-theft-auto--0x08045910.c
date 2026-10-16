
void FUN_08045910(int param_1)

{
  int iVar1;
  ushort *puVar2;
  int iVar3;
  int iVar4;
  uint uVar5;
  undefined4 uVar6;
  short *psVar7;
  int iVar8;
  int iVar9;
  int *piVar10;
  int *piVar11;
  code *UNRECOVERED_JUMPTABLE;
  
  iVar1 = *(int *)(*(int *)(param_1 + 0x28) + 0x24);
  psVar7 = (short *)(iVar1 + 10);
  puVar2 = (ushort *)(iVar1 + 0xc);
  iVar8 = *(int *)(param_1 + 0x2c);
  iVar1 = iRam02000f10;
  if ((cRam02000cec != '\0') &&
     ((param_1 != iRam0202f3d8 || (iVar1 = iRam0202f3dc, iRam02000224 != iRam0202f3d0)))) {
    if ((iRam02000f10 == 0) || (param_1 == 0)) {
      iVar1 = 0x7fffffff;
    }
    else {
      if ((*(byte *)(iRam02000f10 + 8) & 0x30) == 0) {
        piVar11 = *(int **)(iRam02000f10 + 0x18);
      }
      else {
        piVar11 = (int *)(*(int *)(iRam02000f10 + 0x20) + 4);
      }
      if ((*(byte *)(param_1 + 8) & 0x30) == 0) {
        piVar10 = *(int **)(param_1 + 0x18);
      }
      else {
        piVar10 = (int *)(*(int *)(param_1 + 0x20) + 4);
      }
      iVar1 = *piVar11 - *piVar10;
      if (iVar1 < 0) {
        iVar1 = -iVar1;
      }
      iVar4 = piVar11[1] - piVar10[1];
      if (iVar4 < 0) {
        iVar4 = -iVar4;
      }
      iVar3 = iVar4;
      if (iVar1 < iVar4) {
        iVar3 = iVar1;
      }
      iVar1 = (((iVar1 + iVar4) - (iVar3 >> 1)) - (iVar3 >> 2)) + (iVar3 >> 4);
      if (iVar1 < 0) {
        iVar1 = -iVar1;
      }
    }
    if ((iRam02001140 == 0) || (param_1 == 0)) {
      iVar4 = 0x7fffffff;
    }
    else {
      if ((*(byte *)(iRam02001140 + 8) & 0x30) == 0) {
        piVar11 = *(int **)(iRam02001140 + 0x18);
      }
      else {
        piVar11 = (int *)(*(int *)(iRam02001140 + 0x20) + 4);
      }
      if ((*(byte *)(param_1 + 8) & 0x30) == 0) {
        piVar10 = *(int **)(param_1 + 0x18);
      }
      else {
        piVar10 = (int *)(*(int *)(param_1 + 0x20) + 4);
      }
      iVar4 = *piVar11 - *piVar10;
      if (iVar4 < 0) {
        iVar4 = -iVar4;
      }
      iVar3 = piVar11[1] - piVar10[1];
      if (iVar3 < 0) {
        iVar3 = -iVar3;
      }
      iVar9 = iVar3;
      if (iVar4 < iVar3) {
        iVar9 = iVar4;
      }
      iVar4 = (((iVar4 + iVar3) - (iVar9 >> 1)) - (iVar9 >> 2)) + (iVar9 >> 4);
      if (iVar4 < 0) {
        iVar4 = -iVar4;
      }
    }
    iRam0202f3d0 = iRam02000224;
    if (iVar1 < iVar4) {
      piVar11 = (int *)0x2000f10;
    }
    else {
      piVar11 = (int *)0x2001140;
    }
    iRam0202f3dc = *piVar11;
    iVar1 = iRam0202f3dc;
    iRam0202f3d8 = param_1;
  }
  iVar4 = FUN_0803c050(param_1);
  if (iVar4 == 0) {
    if ((iVar8 == 0) || ((*(uint *)(iVar8 + 0x18) & 0x100000) == 0)) {
      uVar5 = *(uint *)(param_1 + 0xc);
      *(uint *)(param_1 + 0xc) = uVar5 | 0x10000;
      if (((uVar5 & 0x200) == 0) || ((param_1 == 0 || (*(char *)(param_1 + 8) != '\x04')))) {
        uVar6 = 1;
        goto LAB_08045c86;
      }
      if (iVar1 != 0) {
        iVar8 = FUN_080505e4();
        if (iVar8 != 0) {
          func_0x0804cb04(param_1,iVar1);
        }
        if ((*(byte *)(param_1 + 8) & 0x30) == 0) {
          piVar11 = *(int **)(param_1 + 0x18);
        }
        else {
          piVar11 = (int *)(*(int *)(param_1 + 0x20) + 4);
        }
        if ((*(byte *)(iVar1 + 8) & 0x30) == 0) {
          piVar10 = *(int **)(iVar1 + 0x18);
        }
        else {
          piVar10 = (int *)(*(int *)(iVar1 + 0x20) + 4);
        }
        iVar8 = *piVar11 - *piVar10;
        if (iVar8 < 0) {
          iVar8 = -iVar8;
        }
        iVar4 = piVar11[1] - piVar10[1];
        if (iVar4 < 0) {
          iVar4 = -iVar4;
        }
        iVar3 = iVar4;
        if (iVar8 < iVar4) {
          iVar3 = iVar8;
        }
        iVar8 = (((iVar8 + iVar4) - (iVar3 >> 1)) - (iVar3 >> 2)) + (iVar3 >> 4);
        if (iVar8 < 0) {
          iVar8 = -iVar8;
        }
        if (iVar8 < 0x800000) {
          FUN_080505e4();
        }
        if (*psVar7 == 0) {
          *(uint *)(param_1 + 0xc) = *(uint *)(param_1 + 0xc) | 0x10000;
          FUN_08041b30(param_1);
          FUN_0803f348(*(undefined4 *)(param_1 + 0x24));
          uVar5 = FUN_080505cc();
          uVar6 = FUN_080505d8();
          iVar1 = *(int *)(param_1 + 0x28);
          if ((iVar1 != 0) &&
             (*(uint *)(iVar1 + 0x28) = *(uint *)(iVar1 + 0x28) | 1 << (uVar5 & 0xff),
             *(int *)(*(int *)(iVar1 + 4) + 4 + uVar5 * 8) != 0)) {
            FUN_0804233c(iVar1,uVar5,uVar6);
          }
          iVar1 = FUN_080505cc();
          if (iVar1 == 0x28) {
            FUN_0801d4f0(*(undefined4 *)(*(int *)(param_1 + 0x24) + 4),1);
          }
          else {
            FUN_0801d4f0(*(undefined4 *)(*(int *)(param_1 + 0x24) + 4),0);
          }
          *psVar7 = 1;
          *puVar2 = 0xf;
        }
        else {
          iVar8 = (uint)*puVar2 - iRam03000000;
          *puVar2 = (ushort)iVar8;
          if (iVar8 * 0x10000 < 0) {
            iVar8 = FUN_080456f4(param_1);
            if (iVar8 != 0) {
              *(uint *)(param_1 + 0xc) = *(uint *)(param_1 + 0xc) | 0x100;
              func_0x080505f0();
              iVar8 = *(int *)(param_1 + 0x28);
              if ((iVar8 != 0) &&
                 (*(uint *)(iVar8 + 0x28) = *(uint *)(iVar8 + 0x28) | 0x2000000,
                 *(int *)(*(int *)(iVar8 + 4) + 0xcc) != 0)) {
                FUN_0804233c(iVar8,0x19,iVar1);
              }
            }
            *puVar2 = 0xf;
          }
        }
      }
    }
    else {
      iVar1 = *(int *)(*(int *)(param_1 + 0x28) + 0x24);
      if (((*(uint *)(param_1 + 0xc) & 0x200) != 0) &&
         (((*(int *)(param_1 + 0x2c) == 0 ||
           ((*(uint *)(*(int *)(param_1 + 0x2c) + 0x18) & 0x2000) == 0)) &&
          (*(short *)(iVar1 + 10) == 0)))) {
        *(uint *)(param_1 + 0xc) = *(uint *)(param_1 + 0xc) & 0xfffefeff;
        FUN_08041b30(param_1);
        FUN_0803f348(*(undefined4 *)(param_1 + 0x24));
        FUN_0801d4f0(*(undefined4 *)(*(int *)(param_1 + 0x24) + 4),1);
        *(undefined2 *)(iVar1 + 10) = 1;
      }
    }
  }
  uVar6 = 0;
LAB_08045c86:
                    /* WARNING: Could not recover jumptable at 0x08045c94. Too many branches */
                    /* WARNING: Treating indirect jump as call */
  (*UNRECOVERED_JUMPTABLE)(uVar6);
  return;
}

