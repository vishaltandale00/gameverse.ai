
void FUN_08016c84(int param_1)

{
  undefined4 uVar1;
  undefined *puVar2;
  code *UNRECOVERED_JUMPTABLE;
  
  if (((((uRam02028114 & 0x18) == 0) && ((*(uint *)(param_1 + 0xc4) & 0x40) != 0)) &&
      (((*(ushort *)(param_1 + 0xe4) | *(ushort *)(param_1 + 0xea)) & 0x200) != 0)) &&
     (0xff < *(short *)(param_1 + 0xaa))) {
    if ((*(ushort *)(param_1 + 0xe2) & 0x100) == 0) {
      func_0x080232b4(param_1);
    }
    else {
      func_0x08022d80(param_1);
    }
    goto LAB_08016d24;
  }
  if (((*(uint *)(param_1 + 0xc4) & 0x10) == 0) ||
     (((*(ushort *)(param_1 + 0xe4) | *(ushort *)(param_1 + 0xea)) & 2) == 0)) {
    uVar1 = 0;
    goto LAB_08016e20;
  }
  puVar2 = *(undefined **)(param_1 + 0x10);
  if (puVar2 == &UNK_0801dbd1) {
LAB_08016d1e:
    func_0x080211e8(param_1);
  }
  else if ((*(uint *)(param_1 + 8) & 0x20) == 0) {
    if ((*(uint *)(param_1 + 8) & 0x10) == 0) {
      if (puVar2 == (undefined *)0x801e585) {
        func_0x0801e9f8(param_1);
      }
      else if (puVar2 == &UNK_0801ecd1) {
        func_0x0801f128(param_1);
      }
      else if (puVar2 == &UNK_0801f419) {
        func_0x0801f88c(param_1);
      }
      else if (puVar2 == &UNK_0801f9f9) {
        func_0x0801fe38(param_1);
      }
      else if (puVar2 == &UNK_08020009) {
        func_0x0802065c(param_1);
      }
      else if (((*(uint *)(param_1 + 0xc) & 2) == 0) || ((*(ushort *)(param_1 + 0xe2) & 0x30) == 0))
      {
        if ((*(ushort *)(param_1 + 0xe2) & 0x40) == 0) {
          FUN_0801e2b0(param_1);
        }
        else {
          func_0x08023668(param_1);
        }
      }
      else {
        func_0x08020a7c(param_1);
      }
    }
    else {
      func_0x08022060(param_1);
    }
  }
  else {
    if (((*(ushort *)(param_1 + 0xe2) & 0x40) != 0) && (puVar2 != &UNK_08021561)) goto LAB_08016d1e;
    if (((*(ushort *)(param_1 + 0xe2) & 0x80) == 0) || (puVar2 == &UNK_08021a9d)) {
      FUN_08020cc0(param_1);
    }
    else {
      func_0x08021904(param_1);
    }
  }
LAB_08016d24:
  uVar1 = 1;
LAB_08016e20:
                    /* WARNING: Could not recover jumptable at 0x08016e24. Too many branches */
                    /* WARNING: Treating indirect jump as call */
  (*UNRECOVERED_JUMPTABLE)(uVar1);
  return;
}

