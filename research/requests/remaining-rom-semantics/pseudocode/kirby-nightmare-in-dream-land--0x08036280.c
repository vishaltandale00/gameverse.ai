
void FUN_08036280(void)

{
  int iVar1;
  undefined1 *puVar2;
  undefined1 uVar3;
  code *UNRECOVERED_JUMPTABLE;
  
  if ((*(char *)(iRam03002490 + 0x73) != '\x06') && (iVar1 = FUN_08040340(), iVar1 != 0)) {
    if (*(char *)(iRam03002490 + 0x73) == '\x05') {
      *(char *)(iRam03002490 + 0x73) = '\x02';
    }
    goto LAB_080366b8;
  }
  FUN_0803f870();
  switch(*(undefined1 *)(iRam03002490 + 0x73)) {
  case 0:
    iVar1 = FUN_08040298();
    if (iVar1 == 0) {
      if ((*(ushort *)(**(char **)(iRam03002490 + 0x88) * 2 + 0x3002458) & 0x41) == 0) {
        if ((*(byte *)(iRam03002490 + 0x7a) & 1) == 0) {
          if ((*(byte *)(iRam03002490 + 0x7b) & 1) != 0) {
            *(undefined1 *)(iRam03002490 + 0x73) = 4;
            goto code_r0x08036650;
          }
          FUN_080413a4(7);
        }
        else {
          FUN_0803e050(2);
        }
      }
      else {
        FUN_080413a4(8);
      }
      *(undefined1 *)(iRam03002490 + 0x7a) = 0;
      FUN_08040b40(6,0x48);
      FUN_0803f9c0();
    }
    break;
  case 1:
    iVar1 = FUN_08040298();
    if (iVar1 == 0) {
      *(undefined1 *)(iRam03002490 + 0x7a) = 0;
      FUN_080413a4(8);
      FUN_08040b40(6,0x48);
      FUN_0803f9c0();
      if ((*(byte *)(iRam03002490 + 0x7a) & 1) != 0) {
        FUN_0803e050(2);
      }
      if ((*(ushort *)(**(char **)(iRam03002490 + 0x88) * 2 + 0x30023c0) & 2) != 0) {
        *(undefined1 *)(iRam03002490 + 0x73) = 4;
        goto code_r0x08036650;
      }
    }
    break;
  case 2:
    iVar1 = FUN_08040298();
    if (iVar1 == 0) {
      if ((*(byte *)(iRam03002490 + 0x7a) & 1) == 0) {
        FUN_080413a4(7);
      }
      else {
        FUN_0803e050(2);
      }
      FUN_08040b40(6,0x48);
      FUN_0803f9c0();
      if ((*(byte *)(iRam03002490 + 0x7a) & 1) == 0) {
        iVar1 = **(char **)(iRam03002490 + 0x88) * 2;
        if ((*(ushort *)(iVar1 + 0x3002458) & 0x41) == 0) {
          if ((*(ushort *)(iVar1 + 0x30023c0) & 2) == 0) {
            if ((*(byte *)(iRam03002490 + 0x7b) & 1) != 0) {
              FUN_0803e050(2);
              iVar1 = iRam03002490;
              *(undefined4 *)(iRam03002490 + 0x28) = 0xffffffff;
              puVar2 = (undefined1 *)(iVar1 + 0x73);
              uVar3 = 5;
              goto code_r0x0803664e;
            }
            break;
          }
          *(undefined1 *)(iRam03002490 + 0x73) = 4;
        }
        else {
          *(undefined1 *)(iRam03002490 + 0x73) = 1;
        }
        goto code_r0x08036650;
      }
      *(undefined1 *)(iRam03002490 + 0x73) = 3;
      FUN_08006148(0x80359f9,uRam0300248c);
      FUN_0803e050(2);
    }
    break;
  case 3:
    iVar1 = FUN_08040298();
    if (iVar1 == 0) {
      if ((*(byte *)(iRam03002490 + 0x7a) & 1) == 0) {
        FUN_080413a4(7);
      }
      else {
        FUN_0803e050(2);
      }
      FUN_08040b40(6,0x48);
      FUN_0803f9c0();
      if ((*(byte *)(iRam03002490 + 0x7a) & 1) == 0) {
        *(undefined1 *)(iRam03002490 + 0x73) = 2;
      }
      else {
        iVar1 = **(char **)(iRam03002490 + 0x88) * 2;
        if ((*(ushort *)(iVar1 + 0x3002458) & 0x41) == 0) {
          if ((*(ushort *)(iVar1 + 0x30023c0) & 2) == 0) break;
          *(undefined1 *)(iRam03002490 + 0x73) = 4;
        }
        else {
          *(undefined1 *)(iRam03002490 + 0x73) = 1;
        }
      }
      goto code_r0x08036650;
    }
    break;
  case 4:
    if ((*(byte *)(iRam03002490 + 0x7a) & 1) == 0) {
      if ((*(byte *)(iRam03002490 + 0x7b) & 1) == 0) {
        FUN_080413a4(2);
      }
      else {
        FUN_080413a4(0xd);
      }
    }
    FUN_08040b40(7,0x48);
    if ((int)*(uint *)(iRam03002490 + 0x58) < 0) {
      if (cRam03005551 != '\0') {
        *(undefined4 *)(iRam03002490 + 0x58) = 0;
      }
    }
    else if ((*(byte *)(iRam03002490 + 0x7a) & 1) != 0) {
      if (*(uint *)(iRam03002490 + 0x58) < 0xc001) {
        FUN_0803fa44();
      }
      else {
        FUN_0803e4ec(1);
      }
    }
    FUN_0803f9e8();
    break;
  case 5:
    FUN_08040b40(6,0x48);
    FUN_0803f9e8();
    iVar1 = **(char **)(iRam03002490 + 0x88) * 2;
    if ((*(ushort *)(iVar1 + 0x3002458) & 0x41) == 0) {
      if ((*(ushort *)(iVar1 + 0x30023c0) & 2) == 0) break;
      FUN_0803e050(2);
      puVar2 = (undefined1 *)(iRam03002490 + 0x73);
      uVar3 = 4;
    }
    else {
      FUN_0803e050(2);
      puVar2 = (undefined1 *)(iRam03002490 + 0x73);
      uVar3 = 1;
    }
code_r0x0803664e:
    *puVar2 = uVar3;
code_r0x08036650:
    FUN_08006148(0x80359f9,uRam0300248c);
    break;
  case 6:
    FUN_0804042c();
    if ((*(byte *)(iRam03002490 + 0x7a) & 1) != 0) {
      if (*(uint *)(iRam03002490 + 0x58) < 0xc001) {
        FUN_0803fa44();
      }
      else {
        FUN_0803e4ec(1);
      }
    }
  }
  iVar1 = FUN_0803fce4(0);
  if (iVar1 != 0) {
    *(undefined1 *)(*(int *)(iRam03002490 + 0x88) + 6) = 0;
    *(undefined1 *)(*(int *)(iRam03002490 + 0x88) + 1) = 0x17;
  }
LAB_080366b8:
                    /* WARNING: Could not recover jumptable at 0x080366bc. Too many branches */
                    /* WARNING: Treating indirect jump as call */
  (*UNRECOVERED_JUMPTABLE)();
  return;
}

