
void FUN_08026698(void)

{
  ushort uVar1;
  short sVar2;
  undefined4 uVar3;
  short sVar4;
  undefined4 *puVar5;
  ushort *puVar6;
  int *piVar7;
  uint uVar8;
  int *piVar9;
  uint *puVar10;
  code *UNRECOVERED_JUMPTABLE;
  
  if ((*(ushort *)(iRam030035d0 + 0x12) & 0x10) == 0) {
    puVar5 = (undefined4 *)(*(ushort *)(iRam030035d0 + 6) + 0x3000000);
  }
  else {
    puVar5 = (undefined4 *)((uint)*(ushort *)(iRam030035d0 + 6) * 4 + 0x2000000);
  }
  if ((uRam030039fc & 0xb) != 0) {
    puVar5[0xd5] = puVar5[0xd5] | 0x40000000;
  }
  puVar10 = puVar5 + 0xd5;
  uVar8 = *puVar10;
  if ((uVar8 & 0x60000000) == 0x40000000) {
    sVar4 = sRam030024ec;
    if ((uVar8 & 0x40000000) != 0) {
      if ((uVar8 & 0x80000000) == 0) {
        uRam030024e8 = 0xbf;
        sRam030024ec = 0;
        *(undefined2 *)((int)puVar5 + 0x35a) = 0;
        FUN_081502b4(0x30016a0,3);
        FUN_081502b4(0x30016e0,3);
        FUN_081502b4(0x3001720,3);
        FUN_081502b4(0x3001770,3);
        *puVar10 = *puVar10 | 0x80000000;
        sVar4 = sRam030024ec;
      }
      else {
        sVar2 = *(short *)((int)puVar5 + 0x35a);
        sVar4 = sVar2 + 1;
        *(short *)((int)puVar5 + 0x35a) = sVar4;
        if (0xf < (ushort)(sVar2 + 1U)) {
          func_0x08029618(puVar5);
          goto LAB_0802692a;
        }
      }
    }
  }
  else {
    FUN_0815a29c(puVar5,*puVar5);
    if (sRam03000008 != 0) goto LAB_0802692a;
    if ((*puVar10 & 0x1000000) != 0) {
      puVar6 = (ushort *)((int)puVar5 + 0x35e);
      if (*puVar6 < 6) {
        uVar1 = **(ushort **)(&UNK_08d60b0c + (uint)*puVar6 * 4);
        puVar6 = *(ushort **)(&UNK_08d60b0c + (uint)*puVar6 * 4) + 1;
        sVar4 = *(short *)(puVar5 + 0xd8) + 1;
        *(short *)(puVar5 + 0xd8) = sVar4;
        if (sVar4 == 1) {
          if ((uRam03002440 & 0x10000) == 0) {
            REG_DMA3SAD = (dword)puVar6;
            REG_DMA3DAD = 0x3003880;
            Ram040000dc = 0x80000070;
            uVar3 = Ram040000dc;
            uRam03002440 = uRam03002440 | 1;
          }
          else {
            FUN_08158334(puVar6,0x70,0x70);
          }
        }
        if (uVar1 <= *(ushort *)(puVar5 + 0xd8)) {
          *(short *)((int)puVar5 + 0x35e) = *(short *)((int)puVar5 + 0x35e) + 1;
          *(ushort *)(puVar5 + 0xd8) = 0;
        }
      }
      else {
        *puVar6 = 0;
        *(undefined2 *)(puVar5 + 0xd8) = 0;
      }
    }
    if ((puVar5[0xd5] & 0x2000000) != 0) {
      piVar9 = puVar5 + 0xb6;
      *piVar9 = *piVar9 + (int)*(short *)(puVar5 + 0xb8);
      piVar7 = puVar5 + 0xb7;
      *piVar7 = *piVar7 + (int)*(short *)((int)puVar5 + 0x2e2);
      uRam03003684 = (undefined2)((uint)*piVar9 >> 8);
      uRam03003686 = (undefined2)((uint)*piVar7 >> 8);
      if ((puVar5[0xd5] & 0x8000) != 0) {
        puVar6 = (ushort *)((int)puVar5 + 0x34e);
        sVar4 = (short)((int)*(short *)(puVar5 + 0xd4) *
                        (int)*(short *)(&UNK_08d5fe14 + (uint)*puVar6 * 2) >> 0xe) +
                *(short *)((int)puVar5 + 0x106);
        *(short *)((int)puVar5 + 0x106) = sVar4;
        *(short *)((int)puVar5 + 0x12e) = sVar4;
        *puVar6 = *puVar6 + 4 & 0x3ff;
      }
    }
    *(short *)(puVar5 + 0xd6) = *(short *)(puVar5 + 0xd6) + 1;
    sVar4 = sRam030024ec;
  }
  sRam030024ec = sVar4;
  if (sRam03000008 == 0) {
    FUN_08026168(puVar5);
  }
LAB_0802692a:
                    /* WARNING: Could not recover jumptable at 0x08026934. Too many branches */
                    /* WARNING: Treating indirect jump as call */
  (*UNRECOVERED_JUMPTABLE)();
  return;
}

