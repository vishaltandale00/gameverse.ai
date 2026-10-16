
void FUN_080216d8(uint param_1,uint param_2)

{
  int iVar1;
  int iVar2;
  uint uVar3;
  code *UNRECOVERED_JUMPTABLE;
  
  uRam03005508 = ((ushort)param_2 & 0xf) * 0x10 + ((ushort)param_1 & 0xf);
  uVar3 = (uint)sRam03005620;
  if ((param_1 >> 4 < uVar3) && (param_2 >> 4 < (uint)(int)sRam0300561c)) {
    iVar2 = uVar3 * (param_2 >> 4) + (param_1 >> 4);
    if ((int)sRam030055e4 < (int)(iVar2 + uVar3)) {
      uRam030055ac = 0;
      uRam03005588 = 0;
    }
    else {
      iVar1 = iVar2 * 4 + iRam03005660;
      uRam03005588 = (ushort)*(byte *)(uVar3 * 4 + iVar1 + 3);
      uRam030055ac = (ushort)*(byte *)(sRam03005620 * 4 + iVar1 + 2);
    }
    iVar2 = iVar2 * 4 + iRam03005660;
    uRam03005578 = (ushort)*(byte *)(iVar2 + 3);
    uRam03005574 = (ushort)*(byte *)(iVar2 + 2);
    iVar2 = (int)*(char *)(*(int *)(&UNK_087328f0 + (uint)uRam03005578 * 4) + (uint)uRam03005508);
  }
  else {
    uRam030055ac = 0;
    uRam03005588 = 0;
    uRam03005574 = 0;
    uRam03005578 = 0;
    uRam03005508 = 0;
    iVar2 = 0;
  }
                    /* WARNING: Could not recover jumptable at 0x080217c8. Too many branches */
                    /* WARNING: Treating indirect jump as call */
  (*UNRECOVERED_JUMPTABLE)(iVar2);
  return;
}

