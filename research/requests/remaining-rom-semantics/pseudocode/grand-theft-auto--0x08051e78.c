
void FUN_08051e78(int param_1)

{
  byte bVar1;
  ushort uVar2;
  int iVar3;
  uint uVar4;
  undefined4 *puVar5;
  int iVar6;
  code *UNRECOVERED_JUMPTABLE;
  undefined1 auStack_1c [12];
  
  if ((((param_1 == 0) || (iVar6 = *(int *)(param_1 + 0x2c), iVar6 == 0)) ||
      (uVar4 = *(uint *)(param_1 + 0x18), (uVar4 & 0x4000) != 0)) ||
     ((sRam02000e72 != 0 && (*(short *)(iVar6 + 0x18) == sRam02000e72)))) goto LAB_080522fe;
  if ((uVar4 & 0x100) != 0) {
    FUN_08051cc4(param_1);
    goto LAB_080522fe;
  }
  bVar1 = *(byte *)(param_1 + 0xb);
  if ((bVar1 & 1) == 0) {
    if ((0 < (int)((uint)bVar1 << 0x18) >> 0x1c) &&
       (((iVar3 = (uint)*(ushort *)(param_1 + 0x14) - iRam03000000,
         *(short *)(param_1 + 0x14) = (short)iVar3, iVar3 * 0x10000 < 1 || ((uVar4 & 2) != 0)) ||
        (((bVar1 & 0xc) != 0 || ((*(ushort *)(param_1 + 0x1e) & 0x40) != 0)))))) {
      *(short *)(param_1 + 0x14) = (short)((int)((uint)*(ushort *)(iVar6 + 10) * 0xf) >> 2);
      if (((uVar4 & 0x80) != 0) && (iVar6 = func_0x08061ee4(), iVar6 != 0)) goto LAB_080522fe;
      iVar6 = FUN_080544c0(param_1,*(undefined4 *)(param_1 + 0x24),auStack_1c);
      if ((iVar6 == 0) || (iVar6 = FUN_08053d68(param_1,auStack_1c), iVar6 == 0)) {
        uVar2 = FUN_08032198();
        *(ushort *)(param_1 + 0x14) = (uVar2 & 0x1f) * 4 + 0x20;
        goto LAB_080522de;
      }
      iVar6 = *(int *)(*(int *)(param_1 + 0x2c) + 4);
      if (iVar6 != 0) {
        FUN_08051960(param_1,*(undefined4 *)(iVar6 + 8),*(undefined2 *)(iVar6 + 6));
      }
      *(undefined1 *)(param_1 + 10) = 0xff;
      bVar1 = *(byte *)(param_1 + 0xb);
      *(byte *)(param_1 + 0xb) = bVar1 | 1;
      if (((*(uint *)(param_1 + 0x18) & 2) != 0) && ((bVar1 & 0xc) == 0)) {
        *(undefined4 *)(*(int *)(param_1 + 0x24) + 0x1c) = 1;
      }
      if ((*(short *)(param_1 + 0x16) == 0x3ff) || ((*(ushort *)(param_1 + 0x1e) & 0x40) != 0)) {
        iVar6 = 0;
        iVar3 = 0;
      }
      else {
        iVar3 = FUN_080541c0(*(undefined2 *)(param_1 + 0x16));
        iVar6 = iVar3;
        if (iVar3 != 0) {
          if ((*(ushort *)(iVar3 + 0x1e) & 8) != 0) {
            *(ushort *)(param_1 + 0x1e) = *(ushort *)(param_1 + 0x1e) | 8;
          }
          if ((*(uint *)(iVar3 + 0x18) & 0x1000) != 0) {
            *(uint *)(param_1 + 0x18) = *(uint *)(param_1 + 0x18) | 0x1000;
          }
          if ((*(uint *)(iVar3 + 0x18) & 0x800) != 0) {
            *(uint *)(param_1 + 0x18) = *(uint *)(param_1 + 0x18) | 0x800;
          }
          if ((*(uint *)(iVar3 + 0x18) & 0x1000000) != 0) {
            *(uint *)(param_1 + 0x18) = *(uint *)(param_1 + 0x18) | 0x1000000;
          }
          if ((*(ushort *)(iVar3 + 0x1e) & 1) != 0) {
            *(ushort *)(param_1 + 0x1e) = *(ushort *)(param_1 + 0x1e) | 1;
          }
          if ((*(uint *)(iVar3 + 0x18) & 0x400) != 0) {
            *(uint *)(param_1 + 0x18) = *(uint *)(param_1 + 0x18) | 0x400;
          }
          if ((*(uint *)(iVar3 + 0x18) & 0x200000) != 0) {
            *(uint *)(param_1 + 0x18) = *(uint *)(param_1 + 0x18) | 0x200000;
          }
          if ((*(uint *)(iVar3 + 0x18) & 0x200) != 0) {
            *(uint *)(param_1 + 0x18) = *(uint *)(param_1 + 0x18) | 0x200;
          }
          if (((*(uint *)(iVar3 + 0x18) & 0x400) == 0) && ((*(uint *)(param_1 + 0x18) & 0x400) == 0)
             ) {
            iVar6 = 0;
          }
        }
        if (iVar3 != 0) {
          if ((*(uint *)(iVar3 + 0x18) & 0x1000000) != 0) {
            *(uint *)(param_1 + 0x18) = *(uint *)(param_1 + 0x18) | 0x1000000;
          }
          if ((*(uint *)(iVar3 + 0x18) & 0x8000000) != 0) {
            *(uint *)(param_1 + 0x18) = *(uint *)(param_1 + 0x18) | 0x8000000;
          }
          if ((*(ushort *)(iVar3 + 0x1e) & 8) != 0) {
            *(ushort *)(param_1 + 0x1e) = *(ushort *)(param_1 + 0x1e) | 8;
          }
          if ((*(ushort *)(iVar3 + 0x1e) & 0x20) != 0) {
            *(ushort *)(param_1 + 0x1e) = *(ushort *)(param_1 + 0x1e) | 0x20;
          }
        }
      }
      if (((iVar6 == 0) && ((*(uint *)(param_1 + 0x18) & 0x400) != 0)) &&
         (iVar6 = param_1, iVar3 != 0)) {
        iVar6 = iVar3;
      }
      iVar3 = FUN_08055784(param_1);
      if (iVar3 == 0) {
        if (iVar6 == 0) {
          if (*(int *)(*(int *)(param_1 + 0x28) + 0x28) != 0) {
            FUN_08042550();
          }
          iVar6 = *(int *)(*(int *)(param_1 + 0x28) + 0x28);
          if ((iVar6 != 0) &&
             (*(uint *)(iVar6 + 0x28) = *(uint *)(iVar6 + 0x28) | 0x80,
             *(int *)(*(int *)(iVar6 + 4) + 0x13c) != 0)) {
            FUN_0804233c(iVar6,0x27,0);
          }
          *(uint *)(*(int *)(param_1 + 0x28) + 0xc) =
               *(uint *)(*(int *)(param_1 + 0x28) + 0xc) & 0xfffffdff;
          if ((*(byte *)(param_1 + 0xb) & 0xc) == 0) {
            *(undefined4 *)(*(int *)(param_1 + 0x24) + 0x1c) = 1;
          }
          *(uint *)(*(int *)(param_1 + 0x28) + 0xc) =
               *(uint *)(*(int *)(param_1 + 0x28) + 0xc) | 0x18;
          *(uint *)(param_1 + 0x18) = *(uint *)(param_1 + 0x18) | 0x10000000;
          iVar6 = FUN_08055674(param_1);
          if (iVar6 != 0) {
            *(uint *)(*(int *)(param_1 + 0x28) + 0xc) =
                 *(uint *)(*(int *)(param_1 + 0x28) + 0xc) | 0x200;
          }
        }
        else {
          uVar4 = *(uint *)(param_1 + 0x18) & 0xff;
          if (uVar4 == 4) {
            FUN_08041b30(*(undefined4 *)(param_1 + 0x28));
            uVar4 = *(uint *)(param_1 + 0x18);
            *(uint *)(param_1 + 0x18) = uVar4 | 0x400;
            if ((*(uint *)(iVar6 + 0x18) & 0x800) == 0) {
              FUN_08041b48(*(undefined1 *)(*(int *)(param_1 + 0x28) + 9),0xffffffff);
            }
            else {
              *(uint *)(param_1 + 0x18) = uVar4 | 0xc00;
              *(uint *)(*(int *)(param_1 + 0x28) + 0xc) =
                   *(uint *)(*(int *)(param_1 + 0x28) + 0xc) | 2;
            }
            if (((*(uint *)(iVar6 + 0x18) & 0x1000) != 0) ||
               (iVar3 = *(int *)(param_1 + 0x28), (*(uint *)(param_1 + 0x18) & 0x1000) != 0)) {
              iVar3 = *(int *)(param_1 + 0x28);
              *(uint *)(iVar3 + 0xc) = *(uint *)(iVar3 + 0xc) | 0x20018;
            }
LAB_0805220e:
            *(uint *)(param_1 + 0x18) = *(uint *)(param_1 + 0x18) | 0x800000;
            puVar5 = *(undefined4 **)(iVar3 + 0x18);
            if (puVar5 != (undefined4 *)0x0) {
              puVar5[2] = 0;
              puVar5[1] = 0;
              *puVar5 = 0;
            }
            if ((*(uint *)(iVar3 + 0xc) & 0x80) != 0) {
              *(uint *)(iVar3 + 0xc) = *(uint *)(iVar3 + 0xc) & 0xffffff7f;
            }
            if ((*(uint *)(iVar3 + 0xc) & 1) != 0) {
              *(uint *)(iVar3 + 0xc) = *(uint *)(iVar3 + 0xc) & 0xfffffeff | 0x40;
            }
          }
          else if (uVar4 == 8) {
            iVar3 = *(int *)(param_1 + 0x28);
            *(uint *)(iVar3 + 0xc) = *(uint *)(iVar3 + 0xc) & 0xffffffe7;
            uVar4 = *(uint *)(param_1 + 0x18);
            *(uint *)(param_1 + 0x18) = uVar4 | 0x400;
            if ((*(uint *)(iVar6 + 0x18) & 0x800) != 0) {
              *(uint *)(param_1 + 0x18) = uVar4 | 0xc00;
              *(uint *)(iVar3 + 0xc) = *(uint *)(iVar3 + 0xc) | 2;
            }
            if (((*(uint *)(iVar6 + 0x18) & 0x1000) != 0) ||
               ((*(uint *)(param_1 + 0x18) & 0x1000) != 0)) {
              *(uint *)(iVar3 + 0xc) = *(uint *)(iVar3 + 0xc) | 0x20018;
            }
            goto LAB_0805220e;
          }
          iVar6 = *(int *)(*(int *)(param_1 + 0x28) + 0x28);
          if ((iVar6 != 0) &&
             (*(uint *)(iVar6 + 0x28) = *(uint *)(iVar6 + 0x28) | 0x100,
             *(int *)(*(int *)(iVar6 + 4) + 0x144) != 0)) {
            FUN_0804233c(iVar6,0x28,0);
          }
        }
      }
      else if ((*(uint *)(param_1 + 0x18) & 0xff) == 4) {
        FUN_08041b30(*(undefined4 *)(param_1 + 0x28));
        *(uint *)(param_1 + 0x18) = *(uint *)(param_1 + 0x18) | 0x400;
      }
      iVar6 = *(int *)(param_1 + 0x28);
      if (*(int *)(param_1 + 0x30) != 0) {
        if ((*(uint *)(iVar6 + 0xc) & 0x80) != 0) {
          *(uint *)(iVar6 + 0xc) = *(uint *)(iVar6 + 0xc) & 0xffffff7f;
        }
        if ((*(uint *)(iVar6 + 0xc) & 1) != 0) {
          *(uint *)(iVar6 + 0xc) = *(uint *)(iVar6 + 0xc) & 0xfffffeff | 0x40;
        }
      }
      if ((iVar6 != 0) && (iVar6 = FUN_08062034(*(undefined2 *)(param_1 + 0x1c)), iVar6 != 0)) {
        *(uint *)(*(int *)(param_1 + 0x28) + 0xc) =
             *(uint *)(*(int *)(param_1 + 0x28) + 0xc) & 0xffffbfff | 0x10;
      }
    }
LAB_080522de:
    if ((*(byte *)(param_1 + 0xb) & 1) == 0) goto LAB_080522fe;
  }
  FUN_08051960(param_1,*(undefined4 *)(*(int *)(param_1 + 0x2c) + 0x14),
               *(undefined2 *)(*(int *)(param_1 + 0x2c) + 0xe));
  if (*(int *)(param_1 + 0x28) != 0) {
    *(ushort *)(param_1 + 0x1c) = (ushort)*(byte *)(*(int *)(param_1 + 0x28) + 9);
  }
LAB_080522fe:
                    /* WARNING: Could not recover jumptable at 0x08052304. Too many branches */
                    /* WARNING: Treating indirect jump as call */
  (*UNRECOVERED_JUMPTABLE)();
  return;
}

