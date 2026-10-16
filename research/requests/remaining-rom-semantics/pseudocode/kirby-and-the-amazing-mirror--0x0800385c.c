
void FUN_0800385c(int param_1,ushort param_2)

{
  undefined2 uVar1;
  uint uVar2;
  undefined4 *puVar3;
  int iVar4;
  uint uVar5;
  ushort uVar6;
  byte *pbVar7;
  int iVar8;
  bool bVar9;
  byte *pbVar10;
  uint uVar11;
  code *UNRECOVERED_JUMPTABLE;
  uint uStack_4c;
  uint uStack_48;
  int iStack_44;
  int iStack_40;
  int iStack_3c;
  int iStack_38;
  char cStack_34;
  char cStack_33;
  char cStack_32;
  char cStack_31;
  undefined2 uStack_30;
  undefined2 uStack_2e;
  short sStack_2c;
  short sStack_2a;
  ushort uStack_28;
  ushort uStack_26;
  byte bStack_24;
  byte bStack_23;
  byte bStack_22;
  
  uVar11 = 0xf;
  if (param_2 == 0) {
    FUN_080037e8();
  }
  uStack_4c = *(uint *)(param_1 + 0x40);
  uStack_48 = *(uint *)(param_1 + 0x44);
  iStack_44 = uStack_4c + *(char *)(param_1 + 0x3c) * 0x100;
  iStack_3c = uStack_4c + *(char *)(param_1 + 0x3e) * 0x100;
  iStack_40 = uStack_48 + *(char *)(param_1 + 0x3d) * 0x100;
  cStack_34 = *(char *)(param_1 + 0x3c);
  cStack_32 = *(char *)(param_1 + 0x3e);
  cStack_33 = *(char *)(param_1 + 0x3d);
  cStack_31 = *(char *)(param_1 + 0x3f);
  pbVar10 = (byte *)(param_1 + 0x62);
  bStack_24 = *pbVar10;
  bStack_23 = 0;
  bStack_22 = 0;
  sStack_2c = *(short *)(param_1 + 0x50);
  sStack_2a = *(short *)(param_1 + 0x52);
  if (param_2 == 0) {
    sStack_2c = *(short *)(param_1 + 0xd0) + sStack_2c;
    sStack_2a = *(short *)(param_1 + 0xd2) + sStack_2a;
  }
  pbVar7 = (byte *)(param_1 + 0x56);
  uStack_28 = *(ushort *)((uint)*pbVar7 * 0x668 + 0x20235ec) >> 4;
  uStack_26 = *(ushort *)((uint)*pbVar7 * 0x668 + 0x20235ee) >> 4;
  *pbVar10 = 0;
  *(undefined4 *)(param_1 + 0x58) = 0;
  *(char *)(param_1 + 0x57) = '\0';
  iStack_38 = uStack_48 + *(char *)(param_1 + 0x3f) * 0x100 + 1;
  if (((param_2 == 0) && ((*(uint *)(param_1 + 8) & 0x70) == 0x10)) &&
     (iStack_3c - iStack_44 < 0x1000)) {
    iStack_44 = *(int *)(param_1 + 0x40) + -0x800;
    iStack_3c = *(int *)(param_1 + 0x40) + 0x800;
  }
  if (sStack_2a < 1) {
    if ((param_2 != 1) && (sStack_2a < 0)) {
      uVar2 = iStack_44 + iStack_3c >> 0xd;
      uStack_30 = (undefined2)uVar2;
      uStack_2e = (undefined2)(iStack_40 >> 0xc);
      bStack_23 = FUN_080023e4(*pbVar7,uVar2 & 0xffff,iStack_40 >> 0xc & 0xffff);
      if ((*(uint *)(&UNK_082d88b8 + (uint)bStack_23 * 4) & 1) == 0) {
        uVar11 = FUN_0815a2a4(param_1,&uStack_4c,param_2 | 0x420,
                              *(undefined4 *)(&UNK_082d8da4 + (uint)bStack_23 * 4));
        uVar11 = uVar11 & 0xffff;
      }
    }
    uVar2 = iStack_44 + iStack_3c >> 0xd;
    uStack_30 = (undefined2)uVar2;
    uStack_2e = (undefined2)(iStack_38 >> 0xc);
    bStack_22 = FUN_080023e4(*pbVar7,uVar2 & 0xffff,iStack_38 >> 0xc & 0xffff);
    uVar2 = (uint)bStack_22;
    if (param_2 == 1) {
      uVar6 = 0x450;
LAB_08003afe:
      puVar3 = (undefined4 *)(&UNK_082d8da4 + uVar2 * 4);
    }
    else {
      puVar3 = (undefined4 *)(&UNK_082d8da4 + uVar2 * 4);
      uVar6 = 0x50;
    }
  }
  else {
    if (param_2 != 1) {
      uVar2 = iStack_44 + iStack_3c >> 0xd;
      uStack_30 = (undefined2)uVar2;
      uStack_2e = (undefined2)(iStack_38 >> 0xc);
      bStack_22 = FUN_080023e4(*pbVar7,uVar2 & 0xffff,iStack_38 >> 0xc & 0xffff);
      if ((*(uint *)(&UNK_082d88b8 + (uint)bStack_22 * 4) & 1) == 0) {
        uVar11 = FUN_0815a2a4(param_1,&uStack_4c,param_2 | 0x450,
                              *(undefined4 *)(&UNK_082d8da4 + (uint)bStack_22 * 4));
        uVar11 = uVar11 & 0xffff;
      }
    }
    uVar2 = iStack_44 + iStack_3c >> 0xd;
    uStack_30 = (undefined2)uVar2;
    uStack_2e = (undefined2)(iStack_40 >> 0xc);
    bStack_23 = FUN_080023e4(*pbVar7,uVar2 & 0xffff,iStack_40 >> 0xc & 0xffff);
    uVar2 = (uint)bStack_23;
    if (param_2 == 1) {
      uVar6 = 0x420;
      goto LAB_08003afe;
    }
    puVar3 = (undefined4 *)(&UNK_082d8da4 + uVar2 * 4);
    uVar6 = 0x20;
  }
  uVar2 = FUN_0815a2a4(param_1,&uStack_4c,param_2 | uVar6,*puVar3);
  uVar11 = uVar11 & uVar2;
  iVar8 = 0;
  iStack_44 = *(int *)(param_1 + 0x40) + cStack_34 * 0x100 + -1;
  iStack_3c = *(int *)(param_1 + 0x40) + cStack_32 * 0x100 + 1;
  if (param_2 == 0) {
    if ((int)cStack_31 - (int)cStack_33 < 9) {
LAB_08003b98:
      iStack_40 = uStack_48 + cStack_33 * 0x100;
      iVar4 = (int)cStack_31;
    }
    else {
      iStack_40 = uStack_48 + (cStack_33 + 4) * 0x100;
      iVar4 = cStack_31 + -4;
    }
  }
  else {
    if ((int)cStack_31 - (int)cStack_33 < 9) goto LAB_08003b98;
    iStack_40 = uStack_48 + (cStack_33 + 2) * 0x100;
    iVar4 = cStack_31 + -2;
  }
  iStack_38 = uStack_48 + iVar4 * 0x100;
  if (sStack_2c < 0) goto LAB_08003bf2;
  if (sStack_2c < 1) {
    if ((*(uint *)(param_1 + 8) & 1) == 0) {
      if ((bStack_24 & 1) == 0) {
        if ((bStack_24 & 2) == 0) goto LAB_08003bf4;
        goto LAB_08003bf2;
      }
      goto LAB_08003bda;
    }
    if ((bStack_24 & 1) == 0) {
      if ((bStack_24 & 2) != 0) goto LAB_08003bda;
    }
    else {
LAB_08003bf2:
      iVar8 = 1;
    }
  }
  else {
LAB_08003bda:
    iVar8 = 2;
  }
LAB_08003bf4:
  uVar2 = iStack_44 >> 0xc;
  uVar5 = iStack_40 >> 0xc;
  uVar1 = (undefined2)uVar5;
  if (iVar8 == 1) {
    if ((uVar11 & 1) != 0) {
      bVar9 = true;
      if ((((*(uint *)(&UNK_082d88b8 + (uint)bStack_22 * 4) & 0xf0000000) == 0x40000000) ||
          ((*(uint *)(&UNK_082d88b8 + (uint)bStack_22 * 4) & 0xf0000000) == 0x60000000)) &&
         (cStack_31 * 0x100 + cStack_33 * -0x100 == 0)) {
        bVar9 = false;
      }
      if (bVar9) {
        uStack_30 = (short)uVar2;
        uStack_2e = uVar1;
        uVar2 = FUN_080023e4(*pbVar7,uVar2 & 0xffff,uVar5 & 0xffff);
        uVar2 = FUN_0815a2a4(param_1,&uStack_4c,param_2,
                             *(undefined4 *)(&UNK_082d8da4 + (uVar2 & 0xff) * 4));
        uVar11 = uVar11 & uVar2;
      }
    }
    if (((uVar11 & 2) == 0) || ((*pbVar10 & 3) != 0)) goto LAB_08003f3e;
    uStack_30 = (undefined2)(iStack_44 >> 0xc);
    uStack_2e = (undefined2)(iStack_38 >> 0xc);
    uVar11 = FUN_080023e4(*pbVar7,iStack_44 >> 0xc & 0xffff,iStack_38 >> 0xc & 0xffff);
    uVar6 = 0x10;
  }
  else {
    if (iVar8 != 2) {
      if (param_2 != 1) {
        if ((uVar11 & 1) != 0) {
          bVar9 = true;
          if ((((*(uint *)(&UNK_082d88b8 + (uint)bStack_22 * 4) & 0xf0000000) == 0x40000000) ||
              ((*(uint *)(&UNK_082d88b8 + (uint)bStack_22 * 4) & 0xf0000000) == 0x60000000)) &&
             (cStack_31 * 0x100 + cStack_33 * -0x100 == 0)) {
            bVar9 = false;
          }
          if (bVar9) {
            uStack_30 = (short)uVar2;
            uStack_2e = uVar1;
            uVar2 = FUN_080023e4(*pbVar7,uVar2 & 0xffff,uVar5 & 0xffff);
            uVar2 = FUN_0815a2a4(param_1,&uStack_4c,param_2,
                                 *(undefined4 *)(&UNK_082d8da4 + (uVar2 & 0xff) * 4));
            uVar11 = uVar11 & uVar2;
          }
        }
        if (((uVar11 & 2) != 0) && ((*pbVar10 & 3) == 0)) {
          uStack_30 = (undefined2)(iStack_44 >> 0xc);
          uStack_2e = (undefined2)(iStack_38 >> 0xc);
          uVar2 = FUN_080023e4(*pbVar7,iStack_44 >> 0xc & 0xffff,iStack_38 >> 0xc & 0xffff);
          uVar2 = FUN_0815a2a4(param_1,&uStack_4c,param_2 | 0x10,
                               *(undefined4 *)(&UNK_082d8da4 + (uVar2 & 0xff) * 4));
          uVar11 = uVar11 & uVar2;
        }
        if (((uVar11 & 4) != 0) && ((*pbVar10 & 3) == 0)) {
          bVar9 = true;
          if ((((*(uint *)(&UNK_082d88b8 + (uint)bStack_22 * 4) & 0xf0000000) == 0x20000000) ||
              ((*(uint *)(&UNK_082d88b8 + (uint)bStack_22 * 4) & 0xf0000000) == 0x30000000)) &&
             (cStack_31 * 0x100 + cStack_33 * -0x100 == 0)) {
            bVar9 = false;
          }
          if (bVar9) {
            uStack_30 = (undefined2)(iStack_3c >> 0xc);
            uStack_2e = (undefined2)(iStack_40 >> 0xc);
            uVar2 = FUN_080023e4(*pbVar7,iStack_3c >> 0xc & 0xffff,iStack_40 >> 0xc & 0xffff);
            uVar2 = FUN_0815a2a4(param_1,&uStack_4c,param_2 | 0x30,
                                 *(undefined4 *)(&UNK_082d8da4 + (uVar2 & 0xff) * 4));
            uVar11 = uVar11 & uVar2;
          }
        }
        if (((uVar11 & 8) != 0) && ((*pbVar10 & 3) == 0)) {
          uStack_30 = (undefined2)(iStack_3c >> 0xc);
          uStack_2e = (undefined2)(iStack_38 >> 0xc);
          uVar11 = FUN_080023e4(*pbVar7,iStack_3c >> 0xc & 0xffff,iStack_38 >> 0xc & 0xffff);
          FUN_0815a2a4(param_1,&uStack_4c,param_2 | 0x40,
                       *(undefined4 *)(&UNK_082d8da4 + (uVar11 & 0xff) * 4));
        }
      }
      goto LAB_08003f3e;
    }
    if ((uVar11 & 4) != 0) {
      bVar9 = true;
      if ((((*(uint *)(&UNK_082d88b8 + (uint)bStack_22 * 4) & 0xf0000000) == 0x20000000) ||
          ((*(uint *)(&UNK_082d88b8 + (uint)bStack_22 * 4) & 0xf0000000) == 0x30000000)) &&
         (cStack_31 * 0x100 + cStack_33 * -0x100 == 0)) {
        bVar9 = false;
      }
      if (bVar9) {
        uStack_30 = (undefined2)(iStack_3c >> 0xc);
        uStack_2e = uVar1;
        uVar2 = FUN_080023e4(*pbVar7,iStack_3c >> 0xc & 0xffff,uVar5 & 0xffff);
        uVar2 = FUN_0815a2a4(param_1,&uStack_4c,param_2 | 0x30,
                             *(undefined4 *)(&UNK_082d8da4 + (uVar2 & 0xff) * 4));
        uVar11 = uVar11 & uVar2;
      }
    }
    if (((uVar11 & 8) == 0) || ((*pbVar10 & 3) != 0)) goto LAB_08003f3e;
    uStack_30 = (undefined2)(iStack_3c >> 0xc);
    uStack_2e = (undefined2)(iStack_38 >> 0xc);
    uVar11 = FUN_080023e4(*pbVar7,iStack_3c >> 0xc & 0xffff,iStack_38 >> 0xc & 0xffff);
    uVar6 = 0x40;
  }
  FUN_0815a2a4(param_1,&uStack_4c,param_2 | uVar6,
               *(undefined4 *)(&UNK_082d8da4 + (uVar11 & 0xff) * 4));
LAB_08003f3e:
  if (*(char *)(param_1 + 0x57) == '\0') {
    *(uint *)(param_1 + 0x58) = *(uint *)(param_1 + 0x58) | 1;
  }
  uVar11 = FUN_080023e4(*pbVar7,(uStack_4c & 0xfffffff) >> 0xc,(uStack_48 & 0xfffffff) >> 0xc);
  uVar11 = *(uint *)(&UNK_082d88b8 + (uVar11 & 0xff) * 4);
  *(uint *)(param_1 + 0x58) = *(uint *)(param_1 + 0x58) | uVar11 & 0xff0fffff;
  if (param_2 == 0) {
    if ((uVar11 & 0x800) == 0) {
      if ((uVar11 & 0x2000) != 0) {
        *(uint *)(param_1 + 0x58) = *(uint *)(param_1 + 0x58) & 0xff0fffff | uVar11;
      }
    }
    else if ((uVar11 & 2) == 0) {
      func_0x080097c4(param_1,uVar11);
    }
    else {
      func_0x080098c4(param_1,uVar11);
    }
  }
  *(uint *)(param_1 + 0x40) = uStack_4c;
  *(uint *)(param_1 + 0x44) = uStack_48;
  if ((*pbVar10 & 4) != 0) {
    *(uint *)(param_1 + 8) = *(uint *)(param_1 + 8) & 0xffffffdf;
  }
                    /* WARNING: Could not recover jumptable at 0x08004002. Too many branches */
                    /* WARNING: Treating indirect jump as call */
  (*UNRECOVERED_JUMPTABLE)(*pbVar10);
  return;
}

