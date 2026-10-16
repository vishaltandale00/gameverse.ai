
void FUN_0815115c(void)

{
  bool bVar1;
  char cVar2;
  byte bVar3;
  short sVar4;
  ushort uVar5;
  short sVar6;
  uint uVar7;
  undefined1 uVar8;
  undefined2 uVar9;
  int iVar10;
  int extraout_r1;
  int extraout_r1_00;
  undefined4 uVar11;
  byte *pbVar12;
  uint uVar13;
  byte bVar14;
  uint uVar15;
  undefined2 *puVar16;
  uint uVar17;
  int iVar18;
  code *UNRECOVERED_JUMPTABLE;
  undefined8 uVar19;
  int iStack_34;
  int iStack_30;
  uint uStack_2c;
  uint uStack_28;
  uint uStack_24;
  
  uVar17 = 0x3002518;
  iVar18 = 0;
  iStack_30 = 1;
  bVar1 = false;
  uVar5 = uRam0300298c;
  if (cRam030027d4 == '\x06') {
    uVar5 = uRam03002998;
  }
  uStack_28 = uVar5 & 1;
  uVar7 = FUN_0811b30c();
  uStack_24 = (uint)(byte)(&UNK_084e8370)[uVar7 & 0xff];
  puVar16 = (undefined2 *)0x30024b8;
  cVar2 = '\0';
  uRam030024b8 = 0;
  iStack_34 = iRam03002554;
  uStack_2c = (uint)bRam03002531;
  if (0 < sRam03002534) {
    sRam03002534 = sRam03002534 + -1;
    cVar2 = '\0';
    uVar19 = FUN_08151a66();
    uRam03002532 = (undefined2)((int)uVar19 << 0xc);
    uVar17 = (uint)((ulonglong)uVar19 >> 0x21);
    puVar16 = (undefined2 *)&UNK_000000b8;
  }
  if (0 < *(short *)(uVar17 + 0x1e)) {
    *(short *)(uVar17 + 0x1e) = *(short *)(uVar17 + 0x1e) + -1;
    iVar10 = 0;
    if (*(char *)(uVar17 + 0x10) != '\0') {
      iVar10 = func_0x08151a84(uVar17);
      bVar1 = true;
      if ((int)(uint)*(byte *)(uVar17 + 1) < (int)uStack_2c) {
        uStack_2c = (uint)*(byte *)(uVar17 + 1);
      }
    }
    if (((cRam030027d4 != '\x06') || (*(short *)(uVar17 + 0x1e) < 0x37)) && (uStack_28 != 0)) {
      *(undefined2 *)(uVar17 + 0x1e) = 0;
    }
    if (*(char *)(uVar17 + 0x10) == '\0') {
      FUN_081519f4();
      iVar10 = extraout_r1;
    }
    cVar2 = '\x1e';
    if (*(short *)(uVar17 + 0x1e) != 0) {
      cVar2 = '\x1e';
      FUN_081519f4();
      iVar10 = extraout_r1_00;
    }
    iStack_30 = iVar10 + 2;
    FUN_081519f4();
  }
  bVar14 = *(byte *)(uVar17 + 0x15);
  if ((bVar14 & 0x80) != 0) {
    uRam03003128 = 1;
    cRam03003129 = cRam03003129 + '\x01';
    if (uStack_28 == 0) {
      FUN_08151a66();
    }
    *(byte *)(uVar17 + 0x15) = bVar14 & 0x7f;
    if (cRam030027d4 == '\x06') {
      FUN_08151a66();
    }
    *puVar16 = 0x138;
    if (cRam03003120 == '\x01') {
      cRam03003120 = cVar2;
      cRam0300313c = cVar2;
    }
    uVar8 = 0;
    if (cRam0300313c != '\0') {
      uVar8 = 0x28;
    }
    *(undefined1 *)(uVar17 + 0x16) = uVar8;
    *(undefined1 *)(uVar17 + 0x18) = uVar8;
    *(undefined1 *)(uVar17 + 0x19) = *(undefined1 *)(uVar17 + 0x17);
    *(undefined1 *)(uVar17 + 0x3b) = *(undefined1 *)(uVar17 + 0x17);
    FUN_08136890(0,0x2022500,0x4000);
    FUN_08151a66();
    iVar18 = 0xd4;
    bVar14 = 0;
  }
  if ((bVar14 & 0x20) == 0) {
    if (iVar18 == 0) {
      uVar7 = 0;
      do {
        uVar11 = *(undefined4 *)(iStack_34 + 0x18);
        if (*(int *)(uVar17 + 0x2c) == 0) {
          if (*(int *)(uVar17 + 0x30) == 0) {
            uVar5 = FUN_081509b8(iStack_34,1);
            if (uVar5 == uRam030024de) {
              cVar2 = FUN_08150e88(&iStack_34);
              if (cVar2 == '\0') {
                iStack_30 = 0;
              }
              break;
            }
          }
          else {
            cVar2 = *(char *)(uVar17 + 0x12);
            *(char *)(uVar17 + 0x12) = cVar2 + '\x01';
            cVar2 = *(char *)(*(int *)(uVar17 + 0x30) + (int)cVar2);
            if (cVar2 == '\0') {
              if (*(char *)(uVar17 + 0x1a) != '\0') {
                FUN_08150e88(&iStack_34);
              }
              *(undefined4 *)(uVar17 + 0x30) = 0;
              *(undefined1 *)(uVar17 + 0x12) = 0;
              goto LAB_081519ee;
            }
            uVar5 = FUN_08150844(*(undefined4 *)(uVar17 + 0x40),cVar2);
          }
LAB_081514ac:
          if (uVar5 < 0x10d) {
            if (0xf0 < *(byte *)(uVar17 + 0x18)) {
              *(undefined1 *)(uVar17 + 0x18) = 0;
              break;
            }
            cVar2 = FUN_08150894(*(undefined4 *)(uVar17 + 0x40),0x2022500,0x20,uVar5,
                                 *(undefined1 *)(uVar17 + 0x18),*(undefined1 *)(uVar17 + 0x19),0);
            *(char *)(uVar17 + 0x18) = cVar2 + *(char *)(uVar17 + 0x18);
            cVar2 = *(char *)(uVar17 + 0x20);
LAB_081518fc:
            bVar1 = true;
            uVar7 = (uint)(-(int)cVar2 | (int)cVar2) >> 0x1f;
          }
          else {
            uRam030024b8 = uVar5;
            if (uVar5 == 0x13b) {
              *(undefined4 *)(uVar17 + 0x30) = 0x30024e2;
LAB_08151988:
              *(undefined1 *)(uVar17 + 0x12) = 0;
            }
            else if (uVar5 < 0x13c) {
              if (uVar5 < 0x135) {
                if (uVar5 < 0x127) {
                  if (uVar5 == 0x10f) {
                    cVar2 = FUN_08150e88(&iStack_34);
                    if (cVar2 != '\0') break;
                    if ((*(byte *)(uVar17 + 0x15) & 0x40) == 0) {
                      uVar7 = 1;
                      iStack_30 = 0;
                    }
                    else {
                      iVar18 = 0;
                      uVar7 = 1;
                      if (*(char *)(uVar17 + 0x10) != '\0') {
                        iVar18 = func_0x08151a84(uVar17);
                        bVar1 = true;
                        if ((int)(uint)*(byte *)(uVar17 + 1) < (int)uStack_2c) {
                          uStack_2c = (uint)*(byte *)(uVar17 + 1);
                        }
                      }
                      if (uStack_28 == 0) {
                        if (*(char *)(uVar17 + 0x10) == '\0') {
                          uRam03003128 = 1;
                          cRam03003129 = cRam03003129 + '\x01';
                        }
LAB_08151926:
                        uVar7 = 1;
                        FUN_08150a28(iStack_34,uVar11);
                      }
                      else {
                        iStack_30 = 0;
                        if (*(char *)(uVar17 + 0x10) != '\0') {
                          iStack_30 = iVar18 + 2;
                        }
                      }
                    }
                  }
                  else if (uVar5 < 0x110) {
                    if (uVar5 == 0x10e) {
                      if (cRam030027d4 == '\x06') {
                        if (uRam030024bc != 7) {
                          uRam030024b8 = 0;
                          *(undefined2 *)(uVar17 + 0x1c) = (undefined2)uStack_24;
                          goto LAB_08151840;
                        }
                      }
                      else if (uRam030024bc != 7) {
                        pbVar12 = (byte *)(uVar17 + 0x3b);
                        if ((int)(*(byte *)(uVar17 + 0x3a) - 1) <= (int)(uint)*pbVar12)
                        goto LAB_08151794;
                        *(undefined1 *)(uVar17 + 0x18) = *(undefined1 *)(uVar17 + 0x16);
                        *(char *)(uVar17 + 0x19) = *(char *)(uVar17 + 0x19) + '\f';
                        *pbVar12 = *pbVar12 + 1;
                        goto LAB_081519ee;
                      }
                      pbVar12 = (byte *)(uVar17 + 0x3b);
                      if (*pbVar12 < 2) {
                        *(undefined1 *)(uVar17 + 0x18) = *(undefined1 *)(uVar17 + 0x16);
                        *(char *)(uVar17 + 0x19) = *(char *)(uVar17 + 0x19) + '\f';
                        *pbVar12 = *pbVar12 + 1;
                      }
                    }
                  }
                  else {
                    *(undefined1 *)(uVar17 + 0x16) = 0x28;
                    *(undefined1 *)(uVar17 + 0x18) = 0x28;
                    cRam0300313c = '\x01';
                    func_0x0813c6ec(uVar5 - 0x110 & 0xff);
                  }
                }
                else {
                  func_0x0813c678(uVar5 - 0x127,0x30024be,1);
                  *(undefined4 *)(uVar17 + 0x2c) = 0x30024be;
                  *(undefined1 *)(uVar17 + 0x13) = 0;
                }
              }
              else if (uVar5 == 0x137) {
                *(undefined1 *)(uVar17 + 0x18) = *(undefined1 *)(uVar17 + 0x16);
                *(undefined1 *)(uVar17 + 0x19) = *(undefined1 *)(uVar17 + 0x17);
                *(char *)(uVar17 + 0x3b) = *(char *)(uVar17 + 0x3b) + '\x01';
                *(undefined1 *)(uVar17 + 0x16) = 0;
                *(undefined1 *)(uVar17 + 0x3a) = 1;
                uVar7 = 1;
                *(byte *)(uVar17 + 0x15) = *(byte *)(uVar17 + 0x15) & 0xbf;
              }
              else if (uVar5 < 0x138) {
                if (uVar5 == 0x135) {
                  *(undefined2 *)(uVar17 + 0x1c) = 0x3c;
                  break;
                }
                if (uVar5 == 0x136) {
                  if (cRam030027d4 == '\x06') {
                    *(undefined2 *)(uVar17 + 0x1c) = (undefined2)uStack_24;
                  }
                  else {
                    sVar4 = FUN_081509b8(iStack_34,1);
                    *(short *)(uVar17 + 0x1c) = (sVar4 + -0x144) * 0xf;
                  }
                  break;
                }
              }
              else {
                if (uVar5 != 0x139) {
                  if (uVar5 < 0x13a) {
LAB_08151794:
                    uRam030024b8 = 0;
                    bVar3 = *(byte *)(uVar17 + 0x15);
                    bVar14 = 0x80;
                  }
                  else {
                    if (cRam030027d4 != '\x06') {
                      sVar4 = FUN_081509b8(iStack_34,1);
                      *(short *)(uVar17 + 0x1e) = (sVar4 + -0x144) * 0xf;
                      break;
                    }
                    *(undefined2 *)(uVar17 + 0x1e) = 0x3c;
                    bVar14 = *(byte *)(uVar17 + 0x15);
                    bVar3 = 0x80;
                  }
                  *(byte *)(uVar17 + 0x15) = bVar3 | bVar14;
                  break;
                }
                *(undefined1 *)(uVar17 + *(char *)(uVar17 + 0x10) * 2) =
                     *(undefined1 *)(uVar17 + 0x18);
                *(undefined1 *)(uVar17 + 1 + *(char *)(uVar17 + 0x10) * 2) =
                     *(undefined1 *)(uVar17 + 0x19);
                *(char *)(uVar17 + 0x10) = *(char *)(uVar17 + 0x10) + '\x01';
                *(char *)(uVar17 + 0x18) = *(char *)(uVar17 + 0x18) + '\f';
              }
            }
            else if (uVar5 == 0x143) {
              *(undefined1 *)(uVar17 + 0x18) = 0x48;
            }
            else if (uVar5 < 0x144) {
              if (uVar5 == 0x13e) {
                uRam030024b8 = 0;
                uVar9 = 0;
                if (cRam030027d4 != '\x06') {
                  uVar9 = 0x1e;
                }
                *(undefined2 *)(uVar17 + 0x1c) = uVar9;
LAB_08151840:
                uVar7 = 1;
                *(byte *)(uVar17 + 0x15) = *(byte *)(uVar17 + 0x15) & 0xbf | 0x20;
              }
              else if (uVar5 < 0x13f) {
                if (uVar5 == 0x13c) {
                  sVar4 = *(short *)(uVar17 + 0x34) + 0x11ce;
                }
                else {
                  if (uVar5 != 0x13d) goto LAB_081519ee;
                  sVar4 = *(short *)(uVar17 + 0x36) + 0x13ed;
                }
                func_0x08150e4c(&iStack_34,sVar4);
              }
              else if (uVar5 == 0x140) {
                iStack_34 = *(int *)(uVar17 + 0x3c);
                uVar9 = *(undefined2 *)(iStack_34 + 0x18);
                uVar13 = FUN_08150ee4();
                *(char *)(uVar17 + 0x18) = (char)((int)(0xf0 - (uVar13 & 0xffff)) >> 1) + -8;
                FUN_08150a28(iStack_34,uVar9);
              }
              else if (uVar5 < 0x140) {
                cRam03003120 = '\x01';
              }
            }
            else {
              if (uVar5 == 0x155) {
                uVar11 = func_0x08146adc(1);
                FUN_08151bbc(0x30024f2,&UNK_084e8304,uVar11);
                *(undefined4 *)(uVar17 + 0x30) = 0x30024f2;
                goto LAB_08151988;
              }
              if (uVar5 < 0x156) {
                if (uVar5 == 0x14b) {
                  func_0x08146ad0();
                  if (uStack_28 == 0) goto LAB_08151926;
                  if (cRam030027d4 == '\x06') {
                    uVar7 = 1;
                    *(undefined2 *)(uVar17 + 0x1e) = 5;
                    *(byte *)(uVar17 + 0x15) = *(byte *)(uVar17 + 0x15) | 0x40;
                  }
                }
                else if (uVar5 == 0x154) {
                  uVar11 = func_0x08146adc(0);
                  FUN_08151bbc(0x30024f2,&UNK_084e8304,uVar11);
                  *(undefined4 *)(uVar17 + 0x30) = 0x30024f2;
                  *(undefined1 *)(uVar17 + 0x12) = 0;
                }
              }
              else if (uVar5 == 0x156) {
                sVar4 = FUN_081509b8(iStack_34,1);
                if (sVar4 != 0x144) {
                  sVar6 = func_0x08146adc(0);
                  if (sVar4 == 0x145) {
                    sVar6 = sVar6 + 0x11ce;
                  }
                  else {
                    if (sVar4 != 0x146) {
                      if (sVar4 == 0x147) {
                        func_0x08150e4c(&iStack_34,sVar6 + 0x15cd);
                        uVar7 = 1;
                      }
                      goto LAB_081519ee;
                    }
                    sVar6 = sVar6 + 0x13ed;
                  }
                  func_0x08150e4c(&iStack_34,sVar6);
                  break;
                }
                func_0x08146af8(0x30024be,1);
                *(undefined4 *)(uVar17 + 0x2c) = 0x30024be;
                *(undefined1 *)(uVar17 + 0x13) = 0;
              }
              else if ((uVar5 < 0x261) && (0x243 < uVar5)) {
                iStack_34 = *(int *)(uVar17 + 0x3c);
                uVar11 = *(undefined4 *)(iStack_34 + 0x18);
                uVar9 = *(undefined2 *)(uVar17 + 0x38);
                FUN_08150958(iStack_34,0xcb3,uRam02039009);
                for (iVar18 = (ushort)(uVar5 - 0x244) + 1; iVar18 != 0; iVar18 = iVar18 + -1) {
                  uVar5 = FUN_081509b8(iStack_34,1);
                }
                cVar2 = FUN_08150894(*(undefined4 *)(uVar17 + 0x40),0x2022500,0x20,uVar5,
                                     *(undefined1 *)(uVar17 + 0x18),*(undefined1 *)(uVar17 + 0x19),0
                                    );
                *(char *)(uVar17 + 0x18) = cVar2 + *(char *)(uVar17 + 0x18);
                FUN_08150958(iStack_34,uVar9,uRam02039009);
                FUN_08150a28(iStack_34,uVar11);
                cVar2 = *(char *)(uVar17 + 0x20);
                goto LAB_081518fc;
              }
            }
          }
        }
        else {
          bVar14 = *(byte *)(uVar17 + 0x13);
          *(byte *)(uVar17 + 0x13) = bVar14 + 1;
          uVar5 = *(ushort *)(((int)((uint)bVar14 << 0x18) >> 0x17) + *(int *)(uVar17 + 0x2c));
          if (uVar5 != uRam030024de) goto LAB_081514ac;
          if (*(char *)(uVar17 + 0x1a) != '\0') {
            FUN_08150e88(&iStack_34);
          }
          *(undefined4 *)(uVar17 + 0x2c) = 0;
          *(undefined1 *)(uVar17 + 0x13) = 0;
        }
LAB_081519ee:
      } while (uVar7 == 0);
    }
    if (bVar1) {
      uVar7 = uStack_2c & 0xfffffff8;
      uVar13 = *(byte *)(uVar17 + 0x19) + 0xc;
      uVar15 = uVar13 & 0xfffffff8;
      if ((uVar13 & 7) != 0) {
        uVar15 = uVar15 + 8;
      }
      uStack_2c = (int)(uVar7 << 0x17) >> 0x10;
      if (cRam030027d4 == '\x06') {
        iRam03003600 = uStack_2c + 0x2022500;
        iRam03003604 = *(int *)(uVar17 + 0x28) + uStack_2c;
        uRam03003608 = (uint)uRam030024bc;
      }
      else {
        FUN_08136808(uStack_2c + 0x2022500,*(int *)(uVar17 + 0x28) + uStack_2c,
                     (uVar15 - uVar7 & 0x1ff) << 7);
      }
    }
  }
  else {
    *(byte *)(uVar17 + 0x15) = bVar14 & 0xdf;
    if (cRam03003120 == '\x01') {
      cRam03003120 = cVar2;
      cRam0300313c = cVar2;
    }
    if (cRam030027d4 == '\x06') {
      if (uRam030024bc == 7) {
        *(undefined1 *)(uVar17 + 0x18) = *(undefined1 *)(uVar17 + 0x16);
        *(undefined1 *)(uVar17 + 0x19) = *(undefined1 *)(uVar17 + 0x17);
        *(undefined1 *)(uVar17 + 0x3b) = *(undefined1 *)(uVar17 + 0x17);
        FUN_08136890(0,0x600e000,0x2000);
        FUN_08136890(0,0x2022500,0x4000);
        FUN_081509b8(iStack_34,1);
      }
      else {
        *(undefined1 *)(uVar17 + 0x18) = *(undefined1 *)(uVar17 + 0x16);
        *(undefined1 *)(uVar17 + 0x19) = *(undefined1 *)(uVar17 + 0x17);
        *(undefined1 *)(uVar17 + 0x3b) = *(undefined1 *)(uVar17 + 0x17);
        FUN_08136890(0,0x2022500,0x4000);
      }
    }
    else {
      *(byte *)(uVar17 + 0x15) = *(byte *)(uVar17 + 0x15) | 0x40;
      *puVar16 = 0x138;
      *(char *)(uVar17 + 0x16) = cVar2;
      *(char *)(uVar17 + 0x18) = cVar2;
      *(undefined1 *)(uVar17 + 0x19) = *(undefined1 *)(uVar17 + 0x17);
      *(undefined1 *)(uVar17 + 0x3b) = *(undefined1 *)(uVar17 + 0x17);
      FUN_08136890(0,0x6008000,0x2000);
      FUN_08136890(0,0x2022500,0x4000);
      FUN_081509b8(iStack_34,1);
    }
  }
                    /* WARNING: Could not recover jumptable at 0x08151a76. Too many branches */
                    /* WARNING: Treating indirect jump as call */
  (*UNRECOVERED_JUMPTABLE)(iStack_30);
  return;
}

