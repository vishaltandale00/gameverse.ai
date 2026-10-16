
void FUN_08021634(uint param_1,uint param_2)

{
  int iVar1;
  code *UNRECOVERED_JUMPTABLE;
  
  uRam03005508 = ((ushort)param_2 & 0xf) * 0x10 + ((ushort)param_1 & 0xf);
  if ((param_1 >> 4 < (uint)(int)sRam03005620) && (param_2 >> 4 < (uint)(int)sRam0300561c)) {
    iVar1 = ((int)sRam03005620 * (param_2 >> 4) + (param_1 >> 4)) * 4 + iRam03005660;
    uRam03005578 = (ushort)*(byte *)(iVar1 + 3);
    uRam03005574 = (ushort)*(byte *)(iVar1 + 2);
    iRam030055a0 = *(int *)(&UNK_087328f0 + (uint)uRam03005578 * 4);
    iVar1 = (int)*(char *)(iRam030055a0 + (uint)uRam03005508);
  }
  else {
    uRam03005574 = 0;
    uRam03005578 = 0;
    uRam03005508 = 0;
    iVar1 = 0;
  }
                    /* WARNING: Could not recover jumptable at 0x080216ce. Too many branches */
                    /* WARNING: Treating indirect jump as call */
  (*UNRECOVERED_JUMPTABLE)(iVar1);
  return;
}

