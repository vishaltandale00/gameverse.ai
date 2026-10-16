
/* WARNING: Possible PIC construction at 0x08017288: Changing call to branch */
/* WARNING: Possible PIC construction at 0x0801729c: Changing call to branch */
/* WARNING: Possible PIC construction at 0x080172e4: Changing call to branch */
/* WARNING: Possible PIC construction at 0x08017314: Changing call to branch */
/* WARNING: Possible PIC construction at 0x08017382: Changing call to branch */
/* WARNING: Possible PIC construction at 0x080173ae: Changing call to branch */
/* WARNING: Removing unreachable block (ram,0x08017318) */

void FUN_08017244(int param_1)

{
  short sVar1;
  char cVar2;
  ushort uVar3;
  int iVar4;
  char *pcVar5;
  short *psVar6;
  ushort *puVar7;
  uint *puVar8;
  ushort *puVar9;
  uint uVar10;
  int iVar11;
  code *UNRECOVERED_JUMPTABLE;
  
  if (((0 < *(short *)(param_1 + 0xa6)) && ((*(uint *)(param_1 + 0xc) & 0x1000000) == 0)) &&
     (iVar11 = *(int *)(param_1 + 0x20), iVar4 = FUN_080a30e0(),
     (uint)(iVar4 + (*(char *)(param_1 + 0x6b) + -8) * 2) <= (uint)(iVar11 >> 8))) {
    *(short *)(param_1 + 0xa6) = 0;
    func_0x080259bc(param_1);
    goto SUB_08017b88;
  }
  if ((*(byte *)(param_1 + 1) & 1) == 0) {
    FUN_0801c3a0(param_1);
    goto SUB_08017b88;
  }
  puVar8 = (uint *)(param_1 + 0xc4);
  uVar10 = *puVar8;
  if (((uVar10 & 2) != 0) &&
     (((*(ushort *)(param_1 + 0xe4) | *(ushort *)(param_1 + 0xea)) & 1) != 0)) {
    if ((*(ushort *)(param_1 + 0xe2) & 0x40) != 0) {
      if ((uVar10 & 0x40000) != 0) {
        func_0x0801d3a8(param_1);
        goto SUB_08017b88;
      }
      if ((((*(uint *)(param_1 + 0xc) & 0x8000) == 0) && ((uVar10 & 8) != 0)) &&
         ((uRam02028114 & 0x18) == 0)) {
        func_0x0801db6c(param_1);
        goto SUB_08017b88;
      }
    }
LAB_0801759c:
    FUN_0801b93c(param_1);
    goto SUB_08017b88;
  }
  if ((((*puVar8 & 0x800) == 0) || ((*(uint *)(param_1 + 0xc) & 0x10000) != 0)) ||
     (((*(ushort *)(param_1 + 0xe4) | *(ushort *)(param_1 + 0xea)) & 1) == 0)) {
    if (((*puVar8 & 0x1000000) == 0) ||
       (((*(ushort *)(param_1 + 0xe4) | *(ushort *)(param_1 + 0xea)) & 1) == 0)) {
      if (((*puVar8 & 0x8000000) != 0) &&
         (((*(ushort *)(param_1 + 0xe4) | *(ushort *)(param_1 + 0xea)) & 1) != 0)) {
        func_0x08042ae4(param_1);
        goto SUB_08017b88;
      }
      if (((*puVar8 & 0x8000) != 0) && ((*(ushort *)(param_1 + 0xe2) & 0x200) != 0)) {
        func_0x080181c8(param_1);
        goto SUB_08017b88;
      }
      if ((uRam02028114 & 8) == 0) {
        if ((*(byte *)(param_1 + 0xca) < 0x1e) &&
           (cVar2 = FUN_08116a20(param_1,*(undefined4 *)
                                          (&UNK_08a415ac + (uint)*(byte *)(param_1 + 0xca) * 4)),
           cVar2 != '\0')) {
          FUN_0810ae84(0xd9);
          goto SUB_08017b88;
        }
      }
      else if ((*(ushort *)(param_1 + 0xe4) & 2) != 0) {
        func_0x08023b3c(param_1);
        goto SUB_08017b88;
      }
      if (((((uRam02028114 & 0x78) == 0) && (iVar4 = FUN_0800c370(), iVar4 != 0)) &&
          ((*(ushort *)(param_1 + 0xe4) & 4) != 0)) && ((*(uint *)(param_1 + 0xc) & 1) == 0)) {
        func_0x0801668c();
      }
      if (*(short *)(param_1 + 0x2c) < 0) {
        iVar4 = (uint)*(ushort *)(param_1 + 0x2c) +
                (uint)*(ushort *)(&UNK_08a41822 + (uint)bRam0202066a * 2) * 2;
        *(short *)(param_1 + 0x2c) = (short)iVar4;
        if (0 < iVar4 * 0x10000) {
LAB_080174aa:
          *(undefined2 *)(param_1 + 0x2c) = 0;
        }
      }
      else {
        iVar4 = (uint)*(ushort *)(param_1 + 0x2c) +
                (uint)*(ushort *)(&UNK_08a41822 + (uint)bRam0202066a * 2) * -2;
        *(short *)(param_1 + 0x2c) = (short)iVar4;
        if (iVar4 * 0x10000 < 0) goto LAB_080174aa;
      }
      if (*(short *)(param_1 + 4) != 0) {
        *(short *)(param_1 + 4) = *(short *)(param_1 + 4) + -1;
      }
      if (((*(uint *)(param_1 + 0xc) & 1) == 0) || ((*puVar8 & 0x4000) != 0)) {
        uVar10 = *puVar8;
        if ((uVar10 & 1) == 0) {
          if ((uVar10 & 0x200) == 0) {
            if ((uVar10 & 0x800000) == 0) {
              if (((uVar10 & 0x4000000) != 0) && ((*(ushort *)(param_1 + 0xe2) & 0x30) != 0))
              goto LAB_0801759c;
            }
            else if ((*(ushort *)(param_1 + 0xe2) & 0x30) != 0) {
              func_0x0801aa44(param_1);
              goto SUB_08017b88;
            }
          }
          else if ((*(ushort *)(param_1 + 0xe2) & 0x30) != 0) goto LAB_0801755c;
        }
        else {
          if (((uVar10 & 4) == 0) || (*(short *)(param_1 + 4) == 0)) {
            if (((*puVar8 & 0x200) != 0) &&
               ((*(short *)(param_1 + 4) != 0 && ((*(ushort *)(param_1 + 0xe4) & 0x30) != 0)))) {
LAB_0801755c:
              func_0x08019d7c(param_1);
              goto SUB_08017b88;
            }
          }
          else if ((*(ushort *)(param_1 + 0xe4) & 0x30) != 0) {
            func_0x08019608(param_1);
            goto SUB_08017b88;
          }
          if ((*(ushort *)(param_1 + 0xe2) & 0x30) != 0) {
            FUN_08018e68(param_1);
            goto SUB_08017b88;
          }
        }
      }
      if (((*(uint *)(param_1 + 0xc) & 1) == 0) ||
         (pcVar5 = (char *)(param_1 + 0xca), *pcVar5 == '\f')) {
        psVar6 = (short *)(param_1 + 0xa4);
        sVar1 = *psVar6;
        if (sVar1 == 0xb) {
          if ((*(uint *)(param_1 + 8) & 2) != 0) {
LAB_0801776c:
            *psVar6 = 0;
code_r0x08017770:
            uVar10 = *(uint *)(param_1 + 8) | 4;
LAB_08017776:
            *(uint *)(param_1 + 8) = uVar10;
          }
        }
        else {
          if (*(char *)(param_1 + 0xca) != '\x12') {
            if (*(char *)(param_1 + 0xca) == '\x14') {
              if ((sVar1 != 0x1d) || ((*(ushort *)(param_1 + 0xe2) & 0x80) == 0)) {
                *psVar6 = 0;
                *(uint *)(param_1 + 8) = *(uint *)(param_1 + 8) | 4;
                if ((*(ushort *)(param_1 + 0xe2) & 0x80) == 0) goto LAB_08017778;
              }
              *psVar6 = 0x1d;
              uVar10 = *(uint *)(param_1 + 8) & 0xfffffff9;
              goto LAB_08017776;
            }
            goto LAB_0801776c;
          }
          if (((sVar1 != 0x1d) || ((*(uint *)(param_1 + 8) & 2) != 0)) ||
             ((*(ushort *)(param_1 + 0xe2) & 0x40) == 0)) {
            *psVar6 = 0;
            *(uint *)(param_1 + 8) = *(uint *)(param_1 + 8) | 4;
          }
          if ((*(ushort *)(param_1 + 0xe4) & 0x40) != 0) {
            *psVar6 = 0x1d;
            uVar10 = *(uint *)(param_1 + 8) & 0xfffffff9;
            goto LAB_08017776;
          }
        }
      }
      else {
        psVar6 = (short *)(param_1 + 0xa4);
        if (*psVar6 == 0x2c) {
          if ((*(uint *)(param_1 + 8) & 2) != 0) {
            *psVar6 = 0x2d;
            switch(*pcVar5) {
            case '\0':
            case '\x01':
            case '\x05':
            case '\a':
            case '\x0e':
            case '\x0f':
            case '\x10':
            case '\x11':
            case '\x12':
            case '\x13':
              goto code_r0x08017770;
            default:
              uVar10 = *(uint *)(param_1 + 8) & 0xfffffffb;
              goto LAB_08017776;
            }
          }
        }
        else if (*psVar6 != 0x2d) {
          *psVar6 = 0x2d;
          switch(*pcVar5) {
          case '\0':
          case '\x01':
          case '\x05':
          case '\a':
          case '\x0e':
          case '\x0f':
          case '\x10':
          case '\x11':
          case '\x12':
          case '\x13':
            goto code_r0x08017770;
          default:
            uVar10 = *(uint *)(param_1 + 8) & 0xfffffffb;
          }
          goto LAB_08017776;
        }
      }
LAB_08017778:
      if ((uRam02028114 & 0x18) == 0) {
        if ((*puVar8 & 0x20) != 0) {
          puVar7 = (ushort *)(param_1 + 0xaa);
          if ((0xff < (short)*puVar7) && ((*(ushort *)(param_1 + 0xe2) & 0x100) != 0)) {
            if ((*(uint *)(param_1 + 0xc) & 1) == 0) {
              *(undefined1 *)(param_1 + 0x93) = 0;
              func_0x0800c694(param_1,&UNK_08a4158c);
              switch(*(undefined1 *)(param_1 + 0xca)) {
              case 0:
              case 1:
              case 0xf:
              case 0x10:
              case 0x11:
              case 0x12:
              case 0x14:
                func_0x08028df0(param_1);
              }
            }
            *(uint *)(param_1 + 0xc) = *(uint *)(param_1 + 0xc) | 1;
            switch(*(undefined1 *)(param_1 + 0xca)) {
            case 6:
            case 8:
            case 0xc:
            case 0x19:
              uVar3 = *(short *)(param_1 + 0xac) + 0xc;
              break;
            case 7:
              uVar3 = *(short *)(param_1 + 0xac) + 4;
              break;
            default:
              uVar3 = *(short *)(param_1 + 0xac) + 8;
              break;
            case 10:
              uVar3 = *(short *)(param_1 + 0xac) + 6;
              break;
            case 0x1b:
              uVar3 = *(short *)(param_1 + 0xac) + 0x10;
              break;
            case 0x1c:
              uVar3 = *(short *)(param_1 + 0xac) + 4;
            }
            puVar9 = (ushort *)(param_1 + 0xac);
            *puVar9 = uVar3;
            if ((int)((int)(short)*puVar7 & 0xffff00U) < (int)(short)*puVar9) {
              *puVar9 = *puVar7 & 0xff00;
            }
          }
          goto LAB_0801791a;
        }
LAB_080179b2:
        psVar6 = (short *)(param_1 + 0xac);
        if (*psVar6 != 0) {
          *psVar6 = *psVar6 >> 1;
        }
        if (*psVar6 < *(short *)(param_1 + 0xae)) {
          *psVar6 = *(short *)(param_1 + 0xae);
        }
      }
      else {
LAB_0801791a:
        if ((*puVar8 & 0x20) == 0) goto LAB_080179b2;
        if ((*(ushort *)(param_1 + 0xe2) & 0x100) == 0) {
          psVar6 = (short *)(param_1 + 0xac);
          if ((*(uint *)(param_1 + 0xc) & 1) != 0) {
            *(uint *)(param_1 + 0xc) = *(uint *)(param_1 + 0xc) & 0xfffffffe;
            *(undefined1 *)(param_1 + 0x93) = 0;
            FUN_0800cfdc(param_1);
            if (0xff < *psVar6) {
              FUN_08116a20(param_1,*(undefined4 *)
                                    (&UNK_08a41624 + (uint)*(byte *)(param_1 + 0xca) * 4));
              goto SUB_08017b88;
            }
          }
          *(uint *)(param_1 + 0xc) = *(uint *)(param_1 + 0xc) & 0xfffffffe;
          if (*psVar6 != 0) {
            *psVar6 = *psVar6 >> 1;
          }
          if (*psVar6 < *(short *)(param_1 + 0xae)) {
            *psVar6 = *(short *)(param_1 + 0xae);
          }
        }
      }
      if ((*puVar8 & 0x20) == 0) {
LAB_08017b16:
        if ((((*(uint *)(param_1 + 0xc) & 1) != 0) && (*(short *)(param_1 + 0xa4) == 0)) &&
           (*(char *)(param_1 + 0xca) != '\f')) {
          *(short *)(param_1 + 0xa4) = 0x2c;
          *(uint *)(param_1 + 8) = *(uint *)(param_1 + 8) & 0xfffffffb;
        }
      }
      else if ((*(uint *)(param_1 + 0xc) & 1) != 0) {
        uVar3 = *(ushort *)(param_1 + 0xac) >> 8;
        if (uVar3 == 1) {
          if ((((uRam02028110 & 0xf) == 0) && ((iRam03001e84 < 0 || (bRam03001e89 < 0x3d)))) &&
             ((uRam02028114 & 0x400) == 0)) {
            FUN_0810adb8(0x135);
          }
        }
        else if ((uVar3 < 2) && (uVar3 == 0)) {
          if ((((uRam02028110 & 0xf) == 0) && ((iRam03001e84 < 0 || (bRam03001e89 < 0x3d)))) &&
             ((uRam02028114 & 0x400) == 0)) {
            FUN_0810adb8(0x134);
          }
        }
        else if (((uRam02028110 & 0xf) == 0) &&
                (((iRam03001e84 < 0 || (bRam03001e89 < 0x3d)) && ((uRam02028114 & 0x400) == 0)))) {
          FUN_0810adb8(0x136);
        }
        goto LAB_08017b16;
      }
      if ((*puVar8 & 0x2000) != 0) {
        uVar3 = *(ushort *)(param_1 + 0xe2) & 0x80;
        if ((*(ushort *)(param_1 + 0xe2) & 0x80) != 0) {
          if (7 < *(short *)(param_1 + 6)) {
            *(uint *)(param_1 + 8) = *(uint *)(param_1 + 8) | 0x100000;
            goto SUB_08017b88;
          }
          uVar3 = *(short *)(param_1 + 6) + 1;
        }
        *(ushort *)(param_1 + 6) = uVar3;
      }
      goto SUB_08017b88;
    }
    *(uint *)(param_1 + 0xc) = *(uint *)(param_1 + 0xc) | 0x10000;
  }
  FUN_0801b93c(param_1);
  *(uint *)(param_1 + 0xc) = *(uint *)(param_1 + 0xc) | 0x10000;
SUB_08017b88:
                    /* WARNING: Could not recover jumptable at 0x08017b90. Too many branches */
                    /* WARNING: Treating indirect jump as call */
  (*UNRECOVERED_JUMPTABLE)();
  return;
}

