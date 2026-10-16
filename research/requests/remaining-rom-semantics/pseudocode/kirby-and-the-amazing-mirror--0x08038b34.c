
void FUN_08038b34(void)

{
  byte bVar1;
  char cVar2;
  int iVar3;
  int iVar4;
  ushort *puVar5;
  byte *pbVar6;
  uint uVar7;
  ushort uVar8;
  int iVar9;
  uint uVar10;
  int iVar11;
  code *UNRECOVERED_JUMPTABLE;
  uint uStack_2c;
  
  uStack_2c = 0;
  if (bRam0203ad44 != 0) {
    do {
      iVar3 = uStack_2c * 0x1a8;
      iVar11 = iVar3 + 0x2020ee0;
      if (((((((uint)bRam03000514 & (1 << uStack_2c | 0x10U)) == 0) &&
            ((*(uint *)(iVar3 + 0x2020ee8) & 0x3800f00) == 0)) &&
           (*(undefined **)(iVar3 + 0x2020f58) != &UNK_080566e1)) &&
          ((0xf < (ushort)(*(short *)(iVar3 + 0x2020fb4) - 0x4aU) &&
           (*(short *)(iVar3 + 0x2020efc) != 0x220)))) &&
         (uVar10 = uStack_2c + 1 & 0xff, uVar10 < bRam0203ad44)) {
        do {
          iVar9 = uVar10 * 0x1a8;
          if ((((*(uint *)(iVar9 + 0x2020ee8) & 0x3800f00) == 0) &&
              (*(undefined **)(iVar9 + 0x2020f58) != &UNK_080566e1)) &&
             ((puVar5 = (ushort *)(iVar3 + 0x2020fb4), 0xf < (ushort)(*puVar5 - 0x4a) &&
              ((*(short *)(iVar9 + 0x2020efc) != 0x220 &&
               (*(short *)(iVar9 + 0x2020f40) == *(short *)(iVar3 + 0x2020f40))))))) {
            cVar2 = FUN_0803912c(iVar11,iVar9 + 0x2020ee0);
            if ((cVar2 != '\0') && (*(char *)(iVar3 + 0x2020fe3) != '\x17')) {
              if (((*(char *)(iVar9 + 0x2020fe3) == '\x17') ||
                  (*(char *)(iVar3 + 0x2020fc5) == '\0')) ||
                 (pbVar6 = (byte *)(iVar3 + 0x2020fc1), ((int)(uint)*pbVar6 >> uVar10 & 1U) != 0)) {
                if (((*(char *)(iVar3 + 0x2020fe3) == '\x17') ||
                    (iVar4 = uVar10 * 0x1a8, *(char *)(iVar4 + 0x2020fe3) == '\x17')) ||
                   ((*(char *)(iVar4 + 0x2020fc5) == '\0' ||
                    (((int)(uint)*(byte *)(iVar4 + 0x2020fc1) >> uStack_2c & 1U) != 0))))
                goto LAB_08038ea4;
                if (*(char *)(iVar3 + 0x2020fe3) == '\x0e') {
LAB_08038de2:
                  if ((0x12 < *puVar5) && (0xd < (ushort)(*puVar5 - 0x21))) goto LAB_08038ea4;
                }
                else {
                  uVar8 = *puVar5;
                  if (((((0x15 < uVar8) && (uVar8 != 0x19)) && (uVar8 != 0x2f)) || (*puVar5 == 0xd))
                     && (7 < (ushort)(*puVar5 - 0x38))) {
                    if (*(char *)(iVar3 + 0x2020fe3) != '\x0e') goto LAB_08038ea4;
                    goto LAB_08038de2;
                  }
                }
                if (*(char *)(uVar10 * 0x1a8 + 0x2020fe3) == '\x0e') {
LAB_08038e42:
                  uVar8 = *(ushort *)(uVar10 * 0x1a8 + 0x2020fb4);
                  if ((0x12 < uVar8) && (0xd < (ushort)(uVar8 - 0x21))) goto LAB_08038ea4;
                }
                else {
                  uVar8 = *(ushort *)(uVar10 * 0x1a8 + 0x2020fb4);
                  if (((((0x15 < uVar8) && (uVar8 != 0x19)) && (uVar8 != 0x2f)) ||
                      (*(short *)(uVar10 * 0x1a8 + 0x2020fb4) == 0xd)) &&
                     (7 < (ushort)(*(short *)(uVar10 * 0x1a8 + 0x2020fb4) - 0x38U))) {
                    if (*(char *)(uVar10 * 0x1a8 + 0x2020fe3) != '\x0e') goto LAB_08038ea4;
                    goto LAB_08038e42;
                  }
                }
                if ((*(byte *)(iVar3 + 0x2020f36) < bRam0203ad30) ||
                   (*(byte *)(uVar10 * 0x1a8 + 0x2020f36) < bRam0203ad30)) {
                  func_0x08053dac(uVar10 * 0x1a8 + 0x2020ee0,uStack_2c);
                  func_0x08054414(iVar11,uVar10);
                  pbVar6 = (byte *)(uVar10 * 0x1a8 + 0x2020fc1);
                  *pbVar6 = (byte)(1 << uStack_2c) | *pbVar6;
                  goto LAB_080390f4;
                }
              }
              else {
                if (*(char *)(iVar3 + 0x2020fe3) == '\x0e') {
LAB_08038c92:
                  if ((0x12 < *puVar5) && (0xd < (ushort)(*puVar5 - 0x21))) goto LAB_08038ea4;
                }
                else {
                  uVar8 = *puVar5;
                  if (((((0x15 < uVar8) && (uVar8 != 0x19)) && (uVar8 != 0x2f)) || (*puVar5 == 0xd))
                     && (7 < (ushort)(*puVar5 - 0x38))) {
                    if (*(char *)(iVar3 + 0x2020fe3) != '\x0e') goto LAB_08038ea4;
                    goto LAB_08038c92;
                  }
                }
                if (*(char *)(uVar10 * 0x1a8 + 0x2020fe3) == '\x0e') {
LAB_08038cfa:
                  uVar8 = *(ushort *)(uVar10 * 0x1a8 + 0x2020fb4);
                  if ((0x12 < uVar8) && (0xd < (ushort)(uVar8 - 0x21))) goto LAB_08038ea4;
                }
                else {
                  uVar8 = *(ushort *)(uVar10 * 0x1a8 + 0x2020fb4);
                  if (((((0x15 < uVar8) && (uVar8 != 0x19)) && (uVar8 != 0x2f)) ||
                      (*(short *)(uVar10 * 0x1a8 + 0x2020fb4) == 0xd)) &&
                     (7 < (ushort)(*(short *)(uVar10 * 0x1a8 + 0x2020fb4) - 0x38U))) {
                    if (*(char *)(uVar10 * 0x1a8 + 0x2020fe3) != '\x0e') goto LAB_08038ea4;
                    goto LAB_08038cfa;
                  }
                }
                if ((*(byte *)(iVar3 + 0x2020f36) < bRam0203ad30) ||
                   (*(byte *)(uVar10 * 0x1a8 + 0x2020f36) < bRam0203ad30)) {
                  func_0x08053dac(iVar11,uVar10);
                  func_0x08054414(uVar10 * 0x1a8 + 0x2020ee0,uStack_2c);
                  *pbVar6 = (byte)(1 << uVar10) | *pbVar6;
                  goto LAB_080390f4;
                }
              }
            }
LAB_08038ea4:
            pbVar6 = (byte *)(iVar3 + 0x2020f42);
            bVar1 = *pbVar6;
            if (((bVar1 & 4) == 0) || ((*(byte *)(iVar9 + 0x2020f42) & 4) == 0)) {
              puVar5 = (ushort *)(iVar3 + 0x2020fe4);
              uVar7 = uVar10 * 4;
              if (((uint)*puVar5 & 7 << (uVar7 & 0xff)) == 0) {
LAB_08038ffe:
                if (cVar2 == '\0') goto LAB_08039004;
              }
              else {
                if (cVar2 != '\0') {
                  if (*(int *)(iVar3 + 0x2020f24) < *(int *)(iVar9 + 0x2020f24)) {
                    *(uint *)(iVar3 + 0x2020eec) = *(uint *)(iVar3 + 0x2020eec) | 0x100;
                    *pbVar6 = *pbVar6 | 4;
                    *(undefined2 *)(iVar3 + 0x2020f32) = 0;
                    *puVar5 = *puVar5 - (short)(1 << (uVar7 & 0xff));
                  }
                  else {
                    *(char *)(iVar3 + 0x2020f35) = *(char *)(iVar3 + 0x2020f35) + '\x01';
                  }
                  goto LAB_08038ffe;
                }
LAB_08039004:
                uVar8 = *(ushort *)(iVar3 + 0x2020fe4);
                uVar7 = 7 << (uVar7 & 0xff);
                if ((uVar8 & uVar7) == uVar7) {
                  uVar8 = uVar8 | (ushort)(uVar8 & uVar7);
                }
                else if (*(int *)(iVar9 + 0x2020f24) + -0x1000 < *(int *)(iVar3 + 0x2020f24)) {
                  uVar8 = uVar8 & ~(ushort)uVar7;
                }
                else {
                  uVar8 = uVar8 | (ushort)uVar7;
                }
                *(ushort *)(iVar3 + 0x2020fe4) = uVar8;
              }
              cVar2 = FUN_0803912c(iVar9 + 0x2020ee0,iVar11);
              puVar5 = (ushort *)(uVar10 * 0x1a8 + 0x2020fe4);
              uVar7 = uStack_2c * 4;
              if (((uint)*puVar5 & 7 << (uVar7 & 0xff)) == 0) {
LAB_080390ae:
                if (cVar2 != '\0') goto LAB_080390f4;
              }
              else if (cVar2 != '\0') {
                if (*(int *)(iVar9 + 0x2020f24) < *(int *)(iVar3 + 0x2020f24)) {
                  *(uint *)(iVar9 + 0x2020eec) = *(uint *)(iVar9 + 0x2020eec) | 0x100;
                  *(byte *)(iVar9 + 0x2020f42) = *(byte *)(iVar9 + 0x2020f42) | 4;
                  *(undefined2 *)(iVar9 + 0x2020f32) = 0;
                  *puVar5 = *puVar5 - (short)(1 << (uVar7 & 0xff));
                }
                else {
                  *(char *)(iVar9 + 0x2020f35) = *(char *)(iVar9 + 0x2020f35) + '\x01';
                }
                goto LAB_080390ae;
              }
              puVar5 = (ushort *)(uVar10 * 0x1a8 + 0x2020fe4);
              uVar8 = *puVar5;
              uVar7 = 7 << (uVar7 & 0xff);
              if ((uVar8 & uVar7) == uVar7) {
                uVar8 = uVar8 | (ushort)(uVar8 & uVar7);
              }
              else if (*(int *)(iVar3 + 0x2020f24) + -0x1000 < *(int *)(iVar9 + 0x2020f24)) {
                uVar8 = uVar8 & ~(ushort)uVar7;
              }
              else {
                uVar8 = uVar8 | (ushort)uVar7;
              }
              *puVar5 = uVar8;
            }
            else if (cVar2 == '\0') {
              *(ushort *)(iVar3 + 0x2020fe4) =
                   (ushort)(7 << ((uVar10 & 0x3f) << 2)) | *(ushort *)(iVar3 + 0x2020fe4);
            }
            else if (*(int *)(iVar9 + 0x2020f20) < *(int *)(iVar3 + 0x2020f20)) {
              if ((((bVar1 & 1) == 0) || ((*(uint *)(iVar3 + 0x2020ee8) & 1) != 0)) &&
                 (((bVar1 & 2) == 0 || ((*(uint *)(iVar3 + 0x2020ee8) & 1) == 0)))) {
                *(short *)(iVar3 + 0x2020fd4) = *(short *)(iVar3 + 0x2020fd4) + 0x80;
              }
              if ((((*pbVar6 & 1) == 0) || ((*(uint *)(iVar3 + 0x2020ee8) & 1) == 0)) &&
                 (((*pbVar6 & 2) == 0 || ((*(uint *)(iVar3 + 0x2020ee8) & 1) != 0)))) {
                *(short *)(iVar9 + 0x2020fd4) = *(short *)(iVar9 + 0x2020fd4) + -0x40;
              }
            }
            else {
              if ((((bVar1 & 1) == 0) || ((*(uint *)(iVar3 + 0x2020ee8) & 1) == 0)) &&
                 (((bVar1 & 2) == 0 || ((*(uint *)(iVar3 + 0x2020ee8) & 1) != 0)))) {
                *(short *)(iVar3 + 0x2020fd4) = *(short *)(iVar3 + 0x2020fd4) + -0x80;
              }
              if ((((*pbVar6 & 1) == 0) || ((*(uint *)(iVar3 + 0x2020ee8) & 1) != 0)) &&
                 (((*pbVar6 & 2) == 0 || ((*(uint *)(iVar3 + 0x2020ee8) & 1) == 0)))) {
                *(short *)(iVar9 + 0x2020fd4) = *(short *)(iVar9 + 0x2020fd4) + 0x40;
              }
            }
          }
LAB_080390f4:
          uVar10 = uVar10 + 1 & 0xff;
        } while (uVar10 < bRam0203ad44);
      }
      uStack_2c = uStack_2c + 1 & 0xff;
    } while (uStack_2c < bRam0203ad44);
  }
                    /* WARNING: Could not recover jumptable at 0x08039124. Too many branches */
                    /* WARNING: Treating indirect jump as call */
  (*UNRECOVERED_JUMPTABLE)();
  return;
}

